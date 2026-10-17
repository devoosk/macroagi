import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Draw-call batching for the procedural scene. Pure three.js (no React); see Batch.tsx for the components.
 *
 * Two batch kinds share one pipeline (collect meshes → bucket by material → merge geometry):
 *  - static: geometry baked into the batch root's space (stations, conveyor). One mesh per bucket.
 *  - articulated: one SkinnedMesh per bucket whose "bones" are the original objects, so groups keep
 *    animating (workers, robot arms, doors, units riding the line). Rigid skinning, weight 1.
 *
 * Plain MeshStandardMaterials (no maps, opaque, front-sided) that differ only in colour, roughness and
 * metalness share one palette material: colour goes into a vertex attribute, roughness/metalness into
 * `mxRM`. The shading maths is unchanged, so the pixels match the per-mesh materials.
 *
 * Source meshes stay in the scene graph (hidden), so anchors, transforms and React ownership are untouched.
 */

/** userData flag on an Object3D: enclosing batches do not merge this subtree. */
export const SKIP = 'mxSkip'
/** userData flag on a Material: swapped at runtime (lamps), never merged. */
export const DYNAMIC = 'mxDynamic'

const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile

/** Materials whose only differences are colour / roughness / metalness. */
function isPlain(m: THREE.Material): m is THREE.MeshStandardMaterial {
  if (m.type !== 'MeshStandardMaterial') return false
  const s = m as THREE.MeshStandardMaterial
  const black = s.emissive.r === 0 && s.emissive.g === 0 && s.emissive.b === 0
  return (
    !s.map && !s.roughnessMap && !s.metalnessMap && !s.normalMap && !s.bumpMap && !s.emissiveMap && !s.alphaMap && !s.aoMap && !s.lightMap && !s.displacementMap && !s.envMap &&
    (black || s.emissiveIntensity === 0) &&
    !s.transparent && s.opacity === 1 && s.alphaTest === 0 && s.side === THREE.FrontSide && !s.flatShading && !s.vertexColors && !s.wireframe &&
    s.envMapIntensity === 1 && s.toneMapped && s.depthTest && s.depthWrite && s.colorWrite && s.blending === THREE.NormalBlending && s.fog &&
    !s.polygonOffset && !s.clippingPlanes && s.onBeforeCompile === DEFAULT_OBC
  )
}

/**
 * What a merged material is drawn on. three re-selects the shader program whenever one material
 * alternates between plain, skinned and instanced meshes, so each kind gets its own material object.
 */
export type DrawKind = 'mesh' | 'skinned' | 'instanced'

const palettes = new Map<DrawKind, THREE.MeshStandardMaterial>()
/** Shared material for plain buckets: per-vertex colour, roughness and metalness. */
export function paletteMaterial(kind: DrawKind = 'mesh'): THREE.MeshStandardMaterial {
  const hit = palettes.get(kind)
  if (hit) return hit
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 })
  m.name = `mx-palette-${kind}`
  m.userData.mxPalette = true
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 mxRM;\nvarying vec2 vMxRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMxRM = mxRM;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMxRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMxRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMxRM.y;')
  }
  m.customProgramCacheKey = () => 'mx-palette'
  palettes.set(kind, m)
  return m
}

export const isPalette = (m: THREE.Material) => m.userData.mxPalette === true

const variants: Record<DrawKind, WeakMap<THREE.Material, THREE.Material>> = { mesh: new WeakMap(), skinned: new WeakMap(), instanced: new WeakMap() }
/**
 * The material a merged bucket draws with: the palette for plain materials (merged geometry carries the
 * colours), else a per-kind twin of the original. Instanced buckets share the source geometry as-is, so
 * they always use a twin of the original.
 */
export function bucketMaterial(m: THREE.Mesh, kind: DrawKind): THREE.Material {
  const src = m.material as THREE.Material
  if (kind !== 'instanced' && isPlain(src)) return paletteMaterial(kind)
  if (kind === 'mesh') return src
  let v = variants[kind].get(src)
  if (!v) {
    v = src.clone()
    variants[kind].set(src, v)
  }
  return v
}

/** Can this mesh be merged at all? */
export function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.visible || m.userData[SKIP]) return false
  if (Array.isArray(m.material) || m.material.userData[DYNAMIC] || m.material.transparent) return false
  if (m.renderOrder !== 0 || m.layers.mask !== 1 || m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false
  const g = m.geometry
  if (!g.attributes.position || Object.keys(g.morphAttributes).length || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false
  for (const a of Object.values(g.attributes)) if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return false
  return true
}

/** Bucket key: material (or the shared palette) plus shadow flags and the attribute layout. */
export function bucketKey(m: THREE.Mesh): string {
  const mat = m.material as THREE.Material
  const g = m.geometry
  const plain = isPlain(mat)
  const uv = plain ? '' : g.attributes.uv ? 'uv' : 'nouv'
  return `${plain ? 'palette' : mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${uv}|${(m as THREE.InstancedMesh).isInstancedMesh ? 'i' : ''}`
}

const _n = new THREE.Matrix3()
const _v = new THREE.Vector3()

/** Copy of `src` reduced to position/normal(/uv), transformed by `matrix`, indexed, with optional extras. */
export function prepare(
  src: THREE.BufferGeometry,
  matrix: THREE.Matrix4 | null,
  material: THREE.Material,
  keepUv: boolean,
  bone = -1,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = src.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const P = new Float32Array(n * 3)
  const N = new Float32Array(n * 3)
  const nrm = src.attributes.normal as THREE.BufferAttribute | undefined
  if (matrix) _n.getNormalMatrix(matrix)
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i)
    if (matrix) _v.applyMatrix4(matrix)
    P[i * 3] = _v.x
    P[i * 3 + 1] = _v.y
    P[i * 3 + 2] = _v.z
    if (nrm) {
      _v.fromBufferAttribute(nrm, i)
      if (matrix) _v.applyMatrix3(_n).normalize()
      N[i * 3] = _v.x
      N[i * 3 + 1] = _v.y
      N[i * 3 + 2] = _v.z
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3))
  if (!nrm) g.computeVertexNormals()
  if (keepUv) g.setAttribute('uv', src.attributes.uv ? (src.attributes.uv as THREE.BufferAttribute).clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2))

  let index: ArrayLike<number>
  if (src.index) index = src.index.array
  else index = Array.from({ length: n }, (_, i) => i)
  const I = new Uint32Array(index.length)
  // A mirrored transform flips triangle winding; the renderer would flip the face for a mirrored mesh.
  const flip = matrix ? matrix.determinant() < 0 : false
  for (let i = 0; i < index.length; i += 3) {
    I[i] = index[i]
    I[i + 1] = flip ? index[i + 2] : index[i + 1]
    I[i + 2] = flip ? index[i + 1] : index[i + 2]
  }
  g.setIndex(new THREE.BufferAttribute(I, 1))

  if (isPlain(material)) {
    const s = material as THREE.MeshStandardMaterial
    const C = new Float32Array(n * 3)
    const RM = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      C[i * 3] = s.color.r
      C[i * 3 + 1] = s.color.g
      C[i * 3 + 2] = s.color.b
      RM[i * 2] = s.roughness
      RM[i * 2 + 1] = s.metalness
    }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3))
    g.setAttribute('mxRM', new THREE.BufferAttribute(RM, 2))
  }
  if (bone >= 0) {
    const SI = new Uint16Array(n * 4)
    const SW = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      SI[i * 4] = bone
      SW[i * 4] = 1
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4))
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4))
  }
  return g
}

/** Merge prepared geometries (all share one attribute layout) and free the parts. */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  if (parts.length > 1) parts.forEach((p) => p.dispose())
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** True when the matrix scales uniformly without shear (normals survive rigid skinning). */
export function isConformal(m: THREE.Matrix4, eps = 1e-4): boolean {
  const e = m.elements
  const lx = Math.hypot(e[0], e[1], e[2])
  const ly = Math.hypot(e[4], e[5], e[6])
  const lz = Math.hypot(e[8], e[9], e[10])
  const l = Math.max(lx, ly, lz)
  if (l === 0) return false
  if (Math.abs(lx - ly) > eps * l || Math.abs(lx - lz) > eps * l) return false
  const d = (a: number, b: number) => Math.abs(e[a] * e[b] + e[a + 1] * e[b + 1] + e[a + 2] * e[b + 2]) / (l * l)
  return d(0, 4) < eps && d(0, 8) < eps && d(4, 8) < eps
}
