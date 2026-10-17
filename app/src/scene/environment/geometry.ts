import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type V3 = [number, number, number]

/** Merge geometries after normalising them to non-indexed position/normal/uv. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry()
  const norm = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(n.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k)
    }
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2))
    }
    if (!n.attributes.normal) n.computeVertexNormals()
    n.clearGroups()
    return n
  })
  const out = mergeGeometries(norm, false)
  if (!out) throw new Error('mergeGeometries failed')
  for (const g of geos) g.dispose()
  out.computeBoundingSphere()
  out.computeBoundingBox()
  return out
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** Transform a geometry in place by position, Euler rotation and scale. */
export function xf<G extends THREE.BufferGeometry>(g: G, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): G {
  _m.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...s))
  g.applyMatrix4(_m)
  return g
}

/** Box centred at p. */
export function box(w: number, h: number, d: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]) {
  return xf(new THREE.BoxGeometry(w, h, d), p, r)
}

/** Box with UVs in metres for tiled textures. */
export function boxM(w: number, h: number, d: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d)
  const pos = g.attributes.position
  const nrm = g.attributes.normal
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nrm.getX(i)) > 0.5) uv.setXY(i, z, y)
    else if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, x, z)
    else uv.setXY(i, x, y)
  }
  return xf(g, p, r)
}

function orientBetween(g: THREE.BufferGeometry, a: V3, b: V3) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const dir = vb.clone().sub(va).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir)
  g.applyMatrix4(new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)))
  return g
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Box member between two points (truss webs, bracing). */
export function member(a: V3, b: V3, w: number, h: number = w) {
  return orientBetween(new THREE.BoxGeometry(w, dist(a, b), h), a, b)
}

/** Cylinder between two points. */
export function rod(a: V3, b: V3, radius: number, seg = 8) {
  return orientBetween(new THREE.CylinderGeometry(radius, radius, dist(a, b), seg, 1, true), a, b)
}

export function cyl(rt: number, rb: number, h: number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], seg = 16) {
  return xf(new THREE.CylinderGeometry(rt, rb, h, seg), p, r)
}

/** I/H section: depth d along shape-x, flange width b along shape-y. */
export function iShape(d: number, b: number, tf: number, tw: number) {
  const s = new THREE.Shape()
  const hd = d / 2
  const hb = b / 2
  const hw = tw / 2
  s.moveTo(-hd, -hb)
  s.lineTo(-hd + tf, -hb)
  s.lineTo(-hd + tf, -hw)
  s.lineTo(hd - tf, -hw)
  s.lineTo(hd - tf, -hb)
  s.lineTo(hd, -hb)
  s.lineTo(hd, hb)
  s.lineTo(hd - tf, hb)
  s.lineTo(hd - tf, hw)
  s.lineTo(-hd + tf, hw)
  s.lineTo(-hd + tf, hb)
  s.lineTo(-hd, hb)
  s.closePath()
  return s
}

/** Lipped C (channel) section: depth d along shape-y, flange b along shape-x, open towards +x. */
export function cShape(d: number, b: number, t: number, lip = 0.02) {
  const s = new THREE.Shape()
  const hd = d / 2
  s.moveTo(0, -hd)
  s.lineTo(b, -hd)
  s.lineTo(b, -hd + lip)
  s.lineTo(b - t, -hd + lip)
  s.lineTo(b - t, -hd + t)
  s.lineTo(t, -hd + t)
  s.lineTo(t, hd - t)
  s.lineTo(b - t, hd - t)
  s.lineTo(b - t, hd - lip)
  s.lineTo(b, hd - lip)
  s.lineTo(b, hd)
  s.lineTo(0, hd)
  s.closePath()
  return s
}

/** Extrude a section along +Y from 0 to length. Shape x maps to world x, shape y to world -z. */
export function extrudeY(shape: THREE.Shape, length: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

/** Extrude along +X from 0 to length. Shape x maps to world z, shape y to world y. */
export function extrudeX(shape: THREE.Shape, length: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  g.rotateY(Math.PI / 2)
  return g
}

/**
 * Trapezoidal profiled sheet (wall cladding / roof sheet) in the local XY plane.
 * Ribs run along Y, the profile repeats along X, crowns stand out towards +Z.
 * Flat-shaded quads give crisp rib shading. `topY(u)` lets the top edge follow a gable.
 * UVs are in metres.
 */
export function ribbedSheet(width: number, y0: number, topY: (u: number) => number, pitch = 0.25, depth = 0.035, u0 = 0) {
  const prof: [number, number][] = [
    [0, 0],
    [0.36, 0],
    [0.46, depth],
    [0.72, depth],
    [0.82, 0],
  ]
  const pts: [number, number][] = []
  const n = Math.ceil(width / pitch)
  for (let i = 0; i < n; i++) {
    for (const [f, d] of prof) {
      const u = i * pitch + f * pitch
      if (u < width - 1e-4) pts.push([u, d])
    }
  }
  pts.push([width, 0])
  const pos: number[] = []
  const nor: number[] = []
  const uvs: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, za] = pts[i]
    const [ub, zb] = pts[i + 1]
    const ta = topY(u0 + ua)
    const tb = topY(u0 + ub)
    const du = ub - ua
    const dz = zb - za
    const l = Math.hypot(du, dz) || 1
    const nx = -dz / l
    const nz = du / l
    const quad: V3[] = [
      [ua, y0, za],
      [ub, y0, zb],
      [ub, tb, zb],
      [ua, y0, za],
      [ub, tb, zb],
      [ua, ta, za],
    ]
    for (const [x, y, z] of quad) {
      pos.push(x, y, z)
      nor.push(nx, 0, nz)
      uvs.push(u0 + x, y)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return g
}

/** Flat strip on the floor from a to b with width w; UVs in metres (u along the length). */
export function floorStrip(ax: number, az: number, bx: number, bz: number, w: number, y = 0) {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  const g = new THREE.PlaneGeometry(len, w)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * w)
  g.rotateX(-Math.PI / 2)
  g.rotateY(-Math.atan2(dz, dx))
  g.translate((ax + bx) / 2, y, (az + bz) / 2)
  return g
}

/** Flat rectangle on the floor with world-space XZ UVs in metres. */
export function floorRect(minX: number, maxX: number, minZ: number, maxZ: number, y = 0) {
  const g = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ)
  g.rotateX(-Math.PI / 2)
  g.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i))
  return g
}

/** Rectangle outline on the floor as strips. */
export function floorOutline(r: { minX: number; maxX: number; minZ: number; maxZ: number }, w: number, y = 0) {
  const h = w / 2
  return [
    floorStrip(r.minX - h, r.minZ, r.maxX + h, r.minZ, w, y),
    floorStrip(r.minX - h, r.maxZ, r.maxX + h, r.maxZ, w, y),
    floorStrip(r.minX, r.minZ + h, r.minX, r.maxZ - h, w, y),
    floorStrip(r.maxX, r.minZ + h, r.maxX, r.maxZ - h, w, y),
  ]
}
