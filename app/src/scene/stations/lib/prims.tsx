import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/** Shared, memoised geometry primitives. Everything here is pure and cached in module scope. */

export type V3 = [number, number, number]

const geoCache = new Map<string, THREE.BufferGeometry>()
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}
const q = (n: number) => Math.round(n * 1e4) / 1e4

export function boxGeo(w: number, h: number, d: number, r = 0) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
  return cached(`box:${q(w)}:${q(h)}:${q(d)}:${q(rr)}`, () =>
    rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d),
  )
}
export function cylGeo(rt: number, rb: number, h: number, seg = 24, open = false) {
  return cached(`cyl:${q(rt)}:${q(rb)}:${q(h)}:${seg}:${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open))
}
export function sphereGeo(r: number, ws = 20, hs = 14) {
  return cached(`sph:${q(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs))
}
export function torusGeo(R: number, r: number, rs = 8, ts = 32, arc = Math.PI * 2) {
  return cached(`tor:${q(R)}:${q(r)}:${rs}:${ts}:${q(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc))
}
export function coneGeo(r: number, h: number, seg = 20) {
  return cached(`cone:${q(r)}:${q(h)}:${seg}`, () => new THREE.ConeGeometry(r, h, seg))
}
export function ringGeo(ri: number, ro: number, seg = 32) {
  return cached(`ring:${q(ri)}:${q(ro)}:${seg}`, () => new THREE.RingGeometry(ri, ro, seg))
}
export function circleGeo(r: number, seg = 32) {
  return cached(`circ:${q(r)}:${seg}`, () => new THREE.CircleGeometry(r, seg))
}
export function planeGeo(w: number, h: number) {
  return cached(`plane:${q(w)}:${q(h)}`, () => new THREE.PlaneGeometry(w, h))
}
/** Hex prism (bolt heads, nuts). */
export function hexGeo(r: number, h: number) {
  return cached(`hex:${q(r)}:${q(h)}`, () => new THREE.CylinderGeometry(r, r, h, 6))
}
export function customGeo(key: string, make: () => THREE.BufferGeometry) {
  return cached('custom:' + key, make)
}
export function tubeGeo(pts: V3[], r: number, tubular = 48, radial = 8) {
  const key = `tube:${pts.map((p) => p.map(q).join(',')).join(';')}:${q(r)}:${tubular}:${radial}`
  return cached(key, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal')
    return new THREE.TubeGeometry(curve, tubular, r, radial, false)
  })
}

type Common = { p?: V3; r?: V3; m: THREE.Material; cast?: boolean; scale?: V3 }

/** Small details skip the shadow pass (halves their draw calls); big shapes cast. */
function castsByDefault(g: THREE.BufferGeometry) {
  if (!g.boundingSphere) g.computeBoundingSphere()
  return (g.boundingSphere?.radius ?? 1) > 0.09
}

function Mesh({ g, p, r, m, cast, scale }: Common & { g: THREE.BufferGeometry }) {
  return <mesh geometry={g} material={m} position={p} rotation={r} scale={scale} castShadow={cast ?? castsByDefault(g)} receiveShadow />
}

/** Box (bevelled when rad > 0). */
export function B({ s, rad = 0, ...c }: Common & { s: V3; rad?: number }) {
  return <Mesh g={boxGeo(s[0], s[1], s[2], rad)} {...c} />
}
/** Cylinder along local Y. */
export function C({ rt, rb, h, seg = 24, open, ...c }: Common & { rt: number; rb?: number; h: number; seg?: number; open?: boolean }) {
  return <Mesh g={cylGeo(rt, rb ?? rt, h, seg, open)} {...c} />
}
/** Cylinder along local X. */
export function CX(props: Common & { rt: number; rb?: number; h: number; seg?: number }) {
  const r = props.r ?? [0, 0, 0]
  return <group position={props.p} rotation={r}><C {...props} p={undefined} r={[0, 0, Math.PI / 2]} /></group>
}
/** Cylinder along local Z. */
export function CZ(props: Common & { rt: number; rb?: number; h: number; seg?: number }) {
  const r = props.r ?? [0, 0, 0]
  return <group position={props.p} rotation={r}><C {...props} p={undefined} r={[Math.PI / 2, 0, 0]} /></group>
}
export function Sph({ rad, ws, hs, ...c }: Common & { rad: number; ws?: number; hs?: number }) {
  return <Mesh g={sphereGeo(rad, ws, hs)} {...c} />
}
export function Tor({ R, rad, rs, ts, arc, ...c }: Common & { R: number; rad: number; rs?: number; ts?: number; arc?: number }) {
  return <Mesh g={torusGeo(R, rad, rs, ts, arc)} {...c} />
}
/** Flexible hose / cable along a smooth curve through the given points. */
export function Hose({ pts, rad, tub = 48, radial = 8, ...c }: Common & { pts: V3[]; rad: number; tub?: number; radial?: number }) {
  return <Mesh g={tubeGeo(pts, rad, tub, radial)} {...c} />
}

export interface InstItem {
  p: V3
  r?: V3
  s?: V3 | number
}

/** Instanced mesh from a static list of transforms (computed once). */
export function Inst({ g, m, items, cast = true }: { g: THREE.BufferGeometry; m: THREE.Material; items: InstItem[]; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const im = ref.current
    if (!im) return
    const o = new THREE.Object3D()
    items.forEach((it, i) => {
      o.position.set(...it.p)
      o.rotation.set(...(it.r ?? [0, 0, 0]))
      const s = it.s ?? 1
      if (typeof s === 'number') o.scale.setScalar(s)
      else o.scale.set(...s)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
  }, [items])
  return <instancedMesh ref={ref} args={[g, m, items.length]} castShadow={cast} receiveShadow frustumCulled={false} key={items.length} />
}

/** Memoise a static JSX subtree so React skips it on simTime re-renders. */
export function useStatic<T>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(make, deps)
}

export const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Piecewise keyframe interpolation with smoothstep easing. keys: [time, value][] sorted, time in [0,1]. */
export function keyed(keys: [number, number][], u: number) {
  if (u <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      return lerp(v0, v1, smooth((u - t0) / Math.max(1e-6, t1 - t0)))
    }
  }
  return keys[keys.length - 1][1]
}
export const frac = (x: number) => x - Math.floor(x)
