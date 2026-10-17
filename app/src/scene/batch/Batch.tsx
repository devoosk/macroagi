import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { isCapture } from '../../lib/mode'
import { LOD_DISTANCE, lowPoly, maxScale } from './lod'
import { SKIP, bucketKey, bucketMaterial, isConformal, isPalette, mergeAll, mergeable, prepare } from './merge'

/**
 * React side of the draw-call batching (see merge.ts):
 *
 *   <StaticBatch>             one merged mesh per material for every <Static> region inside it
 *     <Static>…</Static>      geometry that never moves or changes (frames, benches, guards, racks)
 *       <Articulated>…        moving parts: rigidly skinned to their own groups, one draw per material
 *         <MergeSkip>…        rendered as-is (geometry rebuilt every frame, tools swapping in a hand)
 *   <Rigid>…</Rigid>          an assembly that only moves as a whole (a unit riding the line): merged in
 *                             its own frame, so it follows its parent without any per-part work
 *
 * Batches rebuild by themselves when meshes mount or unmount inside them (three's childadded /
 * childremoved events) or when a merged mesh changes material or geometry. A rebuild only depends on
 * what is mounted, never on history, so capture frames stay a pure function of (simTime, events, seed).
 * Without a <StaticBatch> ancestor (preview pages), <Static> is a plain group.
 *
 * Demo mode only (capture always draws full detail):
 *  - shadows are cast by low-poly twins on SHADOW_LAYER, which only the shadow cameras see;
 *  - a batch the camera is at least LOD_DISTANCE away from draws its low-poly twin.
 */

const LOD = !isCapture
/** Demo checks a quarter of the merged meshes per frame; capture checks every one, every frame. */
const STRIDE = isCapture ? 1 : 4
/** Layer seen only by shadow cameras (see ensureShadowLayer). */
export const SHADOW_LAYER = 2
/** `?batchcheck=1`: keep checking that <Static> regions really are static (warns), instead of freezing them. */
const CHECK = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('batchcheck')

type Mode = 'static' | 'rigid' | 'skinned'

interface Rec {
  mesh: THREE.Mesh
  material: THREE.Material
  geometry: THREE.BufferGeometry
  /** Objects whose matrices were baked in, with their values then (static: matrixWorld; else local matrix). */
  chain: THREE.Object3D[]
  snap: number[][]
  inst?: { version: number; count: number }
}

interface Bucket {
  material: THREE.Material
  cast: boolean
  receive: boolean
  high: THREE.BufferGeometry[]
  low: THREE.BufferGeometry[]
  simplified: boolean
  recs: Rec[]
  /** static instanced bucket: shared geometry + instance matrices (no copy of the geometry). */
  inst?: { geometry: THREE.BufferGeometry; low: THREE.BufferGeometry; matrices: THREE.Matrix4[] }
}

/** Instanced meshes are expanded into skinned batches only when small. */
const MAX_EXPANDED_VERTS = 24000

const _m = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _c = new THREE.Vector3()
const IDENTITY = new THREE.Matrix4()

/** Bones are the scene objects themselves and bind at identity: a bone matrix is just its matrixWorld. */
class RigidSkeleton extends THREE.Skeleton {
  update() {
    const bones = this.bones
    for (let i = 0; i < bones.length; i++) bones[i].matrixWorld.toArray(this.boneMatrices, i * 16)
    if (this.boneTexture) this.boneTexture.needsUpdate = true
  }
}

/** Let the scene's shadow cameras see SHADOW_LAYER (rescanned now and then in case lights remount). */
const shadowScan = new WeakMap<THREE.Object3D, number>()
function ensureShadowLayer(scene: THREE.Object3D, frame: number) {
  const last = shadowScan.get(scene)
  if (last !== undefined && frame - last < 600 && frame >= last) return
  shadowScan.set(scene, frame)
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight
    if (l.isLight && l.shadow) l.shadow.camera.layers.enable(SHADOW_LAYER)
  })
}

class Batch {
  readonly sources = new Set<THREE.Object3D>()
  out: THREE.Object3D | null = null
  dirty = true
  builds = 0
  private recs: Rec[] = []
  private outputs: THREE.Mesh[] = []
  private high: THREE.Mesh[] = []
  private low: THREE.Mesh[] = []
  private watched: THREE.Object3D[] = []
  private frozen: THREE.Object3D[] = []
  /** Groups hidden because everything under them is merged (renderer traversals stop there). */
  private folded: THREE.Object3D[] = []
  private skeleton: RigidSkeleton | null = null
  /** LOD distance test: static → world boxes of the sources; otherwise a sphere in the first source's space. */
  private boxes: THREE.Box3[] = []
  private sphere = new THREE.Sphere()
  private lowShown = false
  private cursor = 0

  constructor(readonly mode: Mode) {}

  private onChange = (e: { type: string; child: THREE.Object3D | null }) => {
    this.dirty = true
    if (CHECK && e.child) {
      const m = e.child as THREE.Mesh
      const desc = m.isMesh ? `${m.geometry.type} r=${JSON.stringify((m.geometry as THREE.CylinderGeometry).parameters ?? {})} ${(m.material as THREE.MeshStandardMaterial).color?.getHexString()}` : `with ${e.child.children.length} children`
      this.why = `${e.type} ${e.child.type} ${desc}`
    }
  }

  add(o: THREE.Object3D) {
    this.sources.add(o)
    this.dirty = true
    return () => {
      this.sources.delete(o)
      this.dirty = true
    }
  }

  dispose() {
    this.clear()
    this.out = null
  }

  /** Per frame, before render: rebuild if anything merged has changed, then pick the detail level. */
  update(camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    const out = this.out
    if (!out) return
    this.ticks++
    if (this.dirty || this.changed()) {
      this.build()
      if (CHECK) this.watchRebuilds()
    }
    if (!LOD || this.outputs.length === 0) return
    let root: THREE.Object3D = out
    while (root.parent) root = root.parent
    ensureShadowLayer(root, renderer.info.render.frame)
    if (this.low.length) this.showLow(this.distance(camera) >= LOD_DISTANCE)
  }

  /** `?batchcheck=1`: warn about batches that rebuild every few frames (something inside changes all the time). */
  private recent: number[] = []
  private why = ''
  private ticks = 0
  private watchRebuilds() {
    this.recent.push(this.ticks)
    this.recent = this.recent.filter((t) => this.ticks - t < 120)
    if (this.recent.length === 20) {
      let mod = ''
      for (let o: THREE.Object3D | null = [...this.sources][0]; o && !mod; o = o.parent) if (o.name.startsWith('mx:')) mod = o.name
      console.warn(`[batch] ${this.mode} batch in ${mod} rebuilt 20 times in 120 frames (last: ${this.why})`)
    }
    this.why = ''
  }

  private distance(camera: THREE.Camera) {
    camera.getWorldPosition(_v)
    if (this.mode === 'static') {
      let d = Infinity
      for (const b of this.boxes) d = Math.min(d, b.distanceToPoint(_v))
      return d
    }
    const src = this.sources.values().next().value as THREE.Object3D | undefined
    if (!src) return Infinity
    _c.copy(this.sphere.center).applyMatrix4(src.matrixWorld)
    return _c.distanceTo(_v) - this.sphere.radius * maxScale(src.matrixWorld)
  }

  private showLow(low: boolean) {
    if (low === this.lowShown) return
    this.lowShown = low
    for (const m of this.high) m.visible = !low
    for (const m of this.low) m.visible = low
  }

  private changed(): boolean {
    const n = this.recs.length
    const count = Math.ceil(n / STRIDE)
    const start = this.cursor
    this.cursor = n ? (start + count) % n : 0
    for (let j = 0; j < count; j++) {
      const r = this.recs[(start + j) % n]
      const m = r.mesh
      if (m.material !== r.material || m.geometry !== r.geometry) return this.flag(r, 'material/geometry swapped')
      if (r.inst) {
        const im = m as THREE.InstancedMesh
        if (im.instanceMatrix.version !== r.inst.version || im.count !== r.inst.count) return this.flag(r, 'instances changed')
      }
      if (this.mode !== 'skinned' && !CHECK) continue // frozen: matrices are not recomputed
      for (let i = 0; i < r.chain.length; i++) {
        const e = this.mode === 'static' ? r.chain[i].matrixWorld.elements : r.chain[i].matrix.elements
        const s = r.snap[i]
        for (let k = 0; k < 16; k++) if (e[k] !== s[k]) return this.flag(r, 'moved')
      }
    }
    return false
  }

  /** In a static or rigid batch any change means the region was mis-marked: render that mesh on its own from now on. */
  private flag(r: Rec, why: string) {
    if (CHECK) this.why = `${why}: ${r.mesh.geometry.type} ${(r.mesh.material as THREE.MeshStandardMaterial).color?.getHexString?.() ?? ''} ${r.mesh.parent?.type}`
    if (this.mode !== 'skinned') {
      r.mesh.userData[SKIP] = true
      if (import.meta.env.DEV) console.warn(`[batch] ${why} inside <${this.mode === 'static' ? 'Static' : 'Rigid'}>; wrap it in <Articulated> or <MergeSkip>`, r.mesh)
    }
    return true
  }

  private clear() {
    for (const r of this.recs) r.mesh.visible = true
    for (const g of this.folded) g.visible = true
    this.folded = []
    this.recs = []
    for (const o of this.outputs) {
      o.removeFromParent()
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
      else if (!o.userData.sharedGeometry) o.geometry.dispose()
    }
    this.outputs = []
    this.high = []
    this.low = []
    this.lowShown = false
    this.skeleton?.dispose()
    this.skeleton = null
    for (const w of this.watched) {
      w.removeEventListener('childadded', this.onChange)
      w.removeEventListener('childremoved', this.onChange)
    }
    this.watched = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of this.frozen) delete (f as any).updateMatrixWorld
    this.frozen = []
  }

  /** Every mergeable mesh under the sources, stopping at nested batches and <MergeSkip> (collected in `live`). */
  private collect(live: THREE.Object3D[]): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    // Meshes under a hidden group stay as they are (merging would show them).
    const visit = (o: THREE.Object3D, top: boolean, shown: boolean) => {
      if (!top && o.userData[SKIP]) {
        live.push(o)
        return
      }
      o.addEventListener('childadded', this.onChange)
      o.addEventListener('childremoved', this.onChange)
      this.watched.push(o)
      shown &&= o.visible
      if (shown && mergeable(o)) out.push(o)
      for (const c of o.children) visit(c, false, shown)
    }
    for (const s of this.sources) visit(s, true, true)
    return out
  }

  build() {
    this.clear()
    this.dirty = false
    const out = this.out
    if (!out || this.sources.size === 0) return
    this.builds++
    out.updateWorldMatrix(true, false)
    for (const s of this.sources) s.updateWorldMatrix(true, true)
    _inv.copy(out.matrixWorld).invert()
    const live: THREE.Object3D[] = []
    const meshes = this.collect(live)
    const skinned = this.mode === 'skinned'

    const buckets = new Map<string, Bucket>()
    const bucket = (key: string, m: THREE.Mesh, material: THREE.Material) => {
      let b = buckets.get(key)
      if (!b) {
        b = { material, cast: m.castShadow, receive: m.receiveShadow, high: [], low: [], simplified: false, recs: [] }
        buckets.set(key, b)
      }
      return b
    }
    const bones: THREE.Object3D[] = []
    const boneIndex = new Map<THREE.Object3D, number>()

    for (const m of meshes) {
      const im = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh) : null
      const inst = im ? { version: im.instanceMatrix.version, count: im.count } : undefined
      const src = m.material as THREE.Material
      const lowGeo = LOD ? lowPoly(m.geometry, maxScale(m.matrixWorld)) : m.geometry
      if (!skinned) {
        const rel = new THREE.Matrix4().multiplyMatrices(_inv, m.matrixWorld)
        const chain = this.mode === 'static' ? [m] : pathTo(m, this.sources)
        const snap = chain.map((o) => [...(this.mode === 'static' ? o.matrixWorld : o.matrix).elements])
        const rec: Rec = { mesh: m, material: src, geometry: m.geometry, chain, snap, inst }
        if (im) {
          // Same geometry + material across stations → one InstancedMesh.
          const b = bucket(`inst|${m.geometry.uuid}|${src.uuid}|${+m.castShadow}${+m.receiveShadow}`, m, bucketMaterial(m, 'instanced'))
          b.inst ??= { geometry: m.geometry, low: lowGeo, matrices: [] }
          b.simplified ||= lowGeo !== m.geometry
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, _m)
            b.inst.matrices.push(new THREE.Matrix4().multiplyMatrices(rel, _m))
          }
          b.recs.push(rec)
        } else {
          const material = bucketMaterial(m, 'mesh')
          const b = bucket(bucketKey(m), m, material)
          const keepUv = !isPalette(material)
          b.high.push(prepare(m.geometry, rel, src, keepUv))
          if (LOD) b.low.push(lowGeo === m.geometry ? b.high[b.high.length - 1] : prepare(lowGeo, rel, src, keepUv))
          b.simplified ||= lowGeo !== m.geometry
          b.recs.push(rec)
        }
        continue
      }

      // Skinned: the bone is the mesh's parent group (meshes rarely move against their group), or the
      // nearest ancestor whose world transform keeps normals rigid; the transforms in between are baked in.
      const chain: THREE.Object3D[] = [m]
      let bone: THREE.Object3D | null = m.parent
      while (bone && !isConformal(bone.matrixWorld)) {
        chain.push(bone)
        bone = bone.parent
      }
      if (!bone) continue
      if (im && im.count * m.geometry.attributes.position.count > MAX_EXPANDED_VERTS) continue
      const local = new THREE.Matrix4()
      for (const o of chain) local.premultiply(o.matrix)
      const material = bucketMaterial(m, 'skinned')
      const keepUv = !isPalette(material)
      const b = bucket(bucketKey(m).replace(/\|i$/, '|'), m, material)
      let bi = boneIndex.get(bone)
      if (bi === undefined) {
        bi = bones.length
        bones.push(bone)
        boneIndex.set(bone, bi)
      }
      const add = (mx: THREE.Matrix4 | null) => {
        const h = prepare(m.geometry, mx, src, keepUv, bi)
        b.high.push(h)
        if (LOD) b.low.push(lowGeo === m.geometry ? h : prepare(lowGeo, mx, src, keepUv, bi))
      }
      if (im) {
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, _m)
          add(new THREE.Matrix4().multiplyMatrices(local, _m))
        }
      } else add(local)
      b.simplified ||= lowGeo !== m.geometry
      b.recs.push({ mesh: m, material: src, geometry: m.geometry, chain, snap: chain.map((o) => [...o.matrix.elements]), inst })
    }

    if (skinned && bones.length) this.skeleton = new RigidSkeleton(bones as THREE.Bone[], bones.map(() => new THREE.Matrix4()))

    for (const b of buckets.values()) {
      // A bucket of one saves nothing; leave that mesh as it is.
      if (b.recs.length < 2) {
        new Set([...b.high, ...b.low]).forEach((p) => p.dispose())
        continue
      }
      // With a low-poly twin, the full-detail mesh draws only near the camera and never casts.
      const twin = LOD && b.simplified
      const make = (high: boolean) => (b.inst ? this.instanced(b, high) : this.merged(b, high))
      const hi = make(true)
      this.emit(hi, twin ? false : b.cast, b.receive)
      if (twin) {
        this.high.push(hi)
        const lo = make(false)
        lo.visible = false
        this.emit(lo, false, b.receive)
        this.low.push(lo)
        // Shadow caster: the low-poly geometry, on a layer only the shadow cameras render.
        if (b.cast) {
          const sh = b.inst ? this.instanced(b, false) : this.share(lo)
          sh.layers.set(SHADOW_LAYER)
          this.emit(sh, true, false)
        }
      }
      for (const r of b.recs) {
        r.mesh.visible = false
        this.recs.push(r)
      }
    }

    for (const s of this.sources) this.fold(s, true)
    if (!skinned && !CHECK) for (const s of this.sources) this.freeze(s, live)
    if (LOD && this.mode === 'static') this.boxes = [...this.sources].map(bounds)
    else if (LOD) {
      const src = this.sources.values().next().value as THREE.Object3D
      bounds(src).getBoundingSphere(this.sphere)
      this.sphere.applyMatrix4(_m.copy(src.matrixWorld).invert())
    }
  }

  /**
   * Hide every group whose subtree is entirely merged, so the renderer's scene traversals (main pass,
   * shadow pass) skip it. Matrices still update for hidden objects, so bones keep working.
   * Returns true when `o` is fully merged.
   */
  private fold(o: THREE.Object3D, top: boolean): boolean {
    if (!top && o.userData[SKIP]) return false
    if ((o as THREE.Mesh).isMesh) {
      if (o.visible) return false
    } else if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) return false
    let all = true
    for (const c of o.children) all = this.fold(c, false) && all
    if (all && !top && !(o as THREE.Mesh).isMesh && o.visible) {
      o.visible = false
      this.folded.push(o)
    }
    return all
  }

  /**
   * Merged parts never move against their source, so stop recomputing their matrices every frame:
   * only the source itself (which may ride along with its parent) and the paths down to nested live
   * parts (<Articulated>, <MergeSkip>) are updated.
   */
  private freeze(src: THREE.Object3D, live: THREE.Object3D[]) {
    const paths = live
      .filter((l) => isDescendant(l, src))
      .map((l) => {
        const path: THREE.Object3D[] = []
        for (let o = l.parent; o && o !== src; o = o.parent) path.unshift(o)
        return { l, path }
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(src as any).updateMatrixWorld = function () {
      if (src.matrixAutoUpdate) src.updateMatrix()
      if (src.parent) src.matrixWorld.multiplyMatrices(src.parent.matrixWorld, src.matrix)
      else src.matrixWorld.copy(src.matrix)
      for (const { l, path } of paths) {
        for (const o of path) o.matrixWorld.multiplyMatrices(o.parent!.matrixWorld, o.matrix)
        l.updateMatrixWorld(true)
      }
    }
    this.frozen.push(src)
  }

  private emit(mesh: THREE.Mesh, cast: boolean, receive: boolean) {
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    mesh.userData[SKIP] = true
    this.out!.add(mesh)
    this.outputs.push(mesh)
  }

  /** Merged mesh for a bucket. Low parts may be the high parts themselves (merging copies the data). */
  private merged(b: Bucket, high: boolean): THREE.Mesh {
    const geometry = mergeAll(high ? b.high : b.low)
    return this.mode === 'skinned' ? this.skin(new THREE.SkinnedMesh(geometry, b.material)) : new THREE.Mesh(geometry, b.material)
  }

  private skin(sm: THREE.SkinnedMesh) {
    sm.bindMode = THREE.DetachedBindMode
    sm.bind(this.skeleton!, IDENTITY)
    // Bones carry the full world transform, so the skinned mesh itself must stay at identity.
    sm.matrixAutoUpdate = false
    sm.matrixWorldAutoUpdate = false
    sm.frustumCulled = false
    return sm
  }

  private instanced(b: Bucket, high: boolean): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(high ? b.inst!.geometry : b.inst!.low, b.material, b.inst!.matrices.length)
    b.inst!.matrices.forEach((mx, i) => im.setMatrixAt(i, mx))
    im.computeBoundingSphere()
    return im
  }

  /** Second mesh on the same geometry (shadow twin). */
  private share(m: THREE.Mesh): THREE.Mesh {
    const s = (m as THREE.SkinnedMesh).isSkinnedMesh ? this.skin(new THREE.SkinnedMesh(m.geometry, m.material)) : new THREE.Mesh(m.geometry, m.material)
    s.userData.sharedGeometry = true
    return s
  }
}

/** World bounds of the source meshes (skinned outputs of nested batches are not measured). */
function bounds(src: THREE.Object3D) {
  const box = new THREE.Box3()
  const b = new THREE.Box3()
  src.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return
    const im = m as THREE.InstancedMesh
    if (im.isInstancedMesh) {
      im.computeBoundingBox()
      b.copy(im.boundingBox!)
    } else {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      b.copy(m.geometry.boundingBox!)
    }
    box.union(b.applyMatrix4(m.matrixWorld))
  })
  return box
}

/** Objects from the mesh up to (not including) the batch source it sits in. */
function pathTo(m: THREE.Object3D, sources: Set<THREE.Object3D>) {
  const out: THREE.Object3D[] = []
  for (let o: THREE.Object3D | null = m; o && !sources.has(o); o = o.parent) out.push(o)
  return out
}

function isDescendant(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true
  return false
}

const BatchContext = createContext<Batch | null>(null)

const markSkip = (o: THREE.Object3D | null) => {
  if (o) o.userData[SKIP] = true
}

/** Collects every <Static> region below it into one merged mesh per material (in its own space). */
export function StaticBatch({ children, name = 'mx:merged' }: { children?: ReactNode; name?: string }) {
  const [batch] = useState(() => new Batch('static'))
  const out = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    batch.out = out.current
    batch.build()
    return () => batch.dispose()
  }, [batch])
  useFrame(({ camera, gl }) => batch.update(camera, gl))
  return (
    <BatchContext.Provider value={batch}>
      {children}
      <group ref={out} name={name} />
    </BatchContext.Provider>
  )
}

/** Geometry that never moves or changes; merged by the nearest <StaticBatch>. */
export function Static({ children }: { children?: ReactNode }) {
  const batch = useContext(BatchContext)
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => (batch && ref.current ? batch.add(ref.current) : undefined), [batch])
  return <group ref={ref}>{children}</group>
}

/**
 * Moving rigid parts, one skinned draw per material. Groups inside keep animating as usual; mounting or
 * unmounting meshes inside rebuilds this batch only. Also opts the subtree out of an enclosing <Static>.
 */
export function Articulated({ children, enabled = true }: { children?: ReactNode; enabled?: boolean }) {
  const [batch] = useState(() => new Batch('skinned'))
  const src = useRef<THREE.Group>(null)
  const out = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    if (!enabled) return
    batch.out = out.current
    const off = batch.add(src.current!)
    batch.build()
    return () => {
      off()
      batch.dispose()
    }
  }, [batch, enabled])
  useFrame(({ camera, gl }) => {
    if (enabled) batch.update(camera, gl)
  })
  return (
    <group ref={markSkip}>
      <group ref={src}>{children}</group>
      <group ref={out} />
    </group>
  )
}

/**
 * An assembly that moves only as a whole: merged once in its own frame (one draw per material) and
 * carried along by its parent. Nest <Articulated> for parts that also move on their own (a fan).
 */
export function Rigid({ children }: { children?: ReactNode }) {
  const [batch] = useState(() => new Batch('rigid'))
  const src = useRef<THREE.Group>(null)
  const out = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    batch.out = out.current
    const off = batch.add(src.current!)
    batch.build()
    return () => {
      off()
      batch.dispose()
    }
  }, [batch])
  useFrame(({ camera, gl }) => batch.update(camera, gl))
  return (
    <group ref={markSkip}>
      <group ref={src}>{children}</group>
      <group ref={out} />
    </group>
  )
}

/** Rendered as-is: never merged by an enclosing batch. */
export function MergeSkip({ children }: { children?: ReactNode }) {
  return <group ref={markSkip}>{children}</group>
}
