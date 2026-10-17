import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * Low-poly stand-ins for the procedural primitives, rebuilt from their constructor parameters with
 * only as many segments as keep the silhouette within `LOD_ERROR` metres of the original.
 * Used (demo mode only) for the shadow pass and for batches seen from at least `LOD_DISTANCE`.
 * At that distance a 3 mm chord error is about half a pixel even on a 1.5x-dpr laptop screen.
 */
export const LOD_DISTANCE = 14
export const LOD_ERROR = 0.003

/** userData hint for geometries whose parameters three does not keep (rounded boxes). */
export interface LodHint {
  box: [number, number, number]
  radius: number
}

const TAU = Math.PI * 2

/** Segments for a full circle of radius r with chord error ≤ e. */
function circleSegments(r: number, e: number) {
  if (r <= e) return 3
  return Math.max(3, Math.ceil(Math.PI / Math.acos(1 - e / r)))
}
/** Segments for an arc, never more than the original. */
function arcSegments(r: number, original: number, arc: number, e: number, min = 1) {
  return Math.max(min, Math.min(original, Math.ceil((circleSegments(r, e) * arc) / TAU)))
}

const cache = new Map<string, THREE.BufferGeometry>()
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key)
  if (!g) {
    g = make()
    cache.set(key, g)
  }
  return g
}

/**
 * Low-poly version of `g` as seen at `scale` (largest world scale of the mesh). Returns `g` itself
 * when it is already coarse enough or of a kind that is not simplified (boxes, planes, custom shapes).
 */
export function lowPoly(g: THREE.BufferGeometry, scale: number, e = LOD_ERROR): THREE.BufferGeometry {
  const s = Math.max(scale, 1e-6)
  const tol = e / s // tolerance in geometry units
  const hint = g.userData.lod as LodHint | undefined
  if (hint) {
    const [w, h, d] = hint.box
    const r = hint.radius
    // A sharp box deviates from the bevel by r(√2 − 1); a one-step chamfer by r(1 − cos 45°).
    if (r * (Math.SQRT2 - 1) <= tol) return cached(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d))
    if (r * (1 - Math.SQRT1_2) <= tol) return cached(`rbox:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 1, r))
    return g
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (g as any).parameters
  if (!p) return g
  const k = (n: number[]) => `${g.uuid}:${n.join(',')}`
  switch (g.type) {
    case 'CylinderGeometry':
    case 'ConeGeometry': {
      const r = g.type === 'ConeGeometry' ? p.radius : Math.max(p.radiusTop, p.radiusBottom)
      const n = arcSegments(r, p.radialSegments, p.thetaLength, tol, 3)
      if (n >= p.radialSegments) return g
      return cached(k([n]), () =>
        g.type === 'ConeGeometry'
          ? new THREE.ConeGeometry(p.radius, p.height, n, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength)
          : new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, n, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength),
      )
    }
    case 'SphereGeometry': {
      const w = arcSegments(p.radius, p.widthSegments, p.phiLength, tol, 3)
      const h = arcSegments(p.radius, p.heightSegments, p.thetaLength, tol, 2)
      if (w >= p.widthSegments && h >= p.heightSegments) return g
      return cached(k([w, h]), () => new THREE.SphereGeometry(p.radius, w, h, p.phiStart, p.phiLength, p.thetaStart, p.thetaLength))
    }
    case 'TorusGeometry': {
      const radial = arcSegments(p.tube, p.radialSegments, TAU, tol, 3)
      const tubular = arcSegments(p.radius + p.tube, p.tubularSegments, p.arc, tol, 3)
      if (radial >= p.radialSegments && tubular >= p.tubularSegments) return g
      return cached(k([radial, tubular]), () => new THREE.TorusGeometry(p.radius, p.tube, radial, tubular, p.arc))
    }
    case 'TubeGeometry': {
      const radial = arcSegments(p.radius, p.radialSegments, TAU, tol, 3)
      // Hoses and cables bend gently; a third of the samples keeps the sagitta far below the tolerance.
      const tubular = Math.max(6, Math.min(p.tubularSegments, Math.ceil(p.tubularSegments / 3)))
      if (radial >= p.radialSegments && tubular >= p.tubularSegments) return g
      return cached(k([radial, tubular]), () => new THREE.TubeGeometry(p.path, tubular, p.radius, radial, p.closed))
    }
    case 'LatheGeometry': {
      const r = Math.max(...(p.points as THREE.Vector2[]).map((v) => Math.abs(v.x)))
      const n = arcSegments(r, p.segments, p.phiLength, tol, 3)
      if (n >= p.segments) return g
      return cached(k([n]), () => new THREE.LatheGeometry(p.points, n, p.phiStart, p.phiLength))
    }
    case 'CapsuleGeometry': {
      const radial = arcSegments(p.radius, p.radialSegments, TAU, tol, 3)
      const cap = Math.max(1, Math.min(p.capSegments, Math.ceil(radial / 4)))
      if (radial >= p.radialSegments && cap >= p.capSegments) return g
      return cached(k([radial, cap]), () => new THREE.CapsuleGeometry(p.radius, p.length, cap, radial))
    }
    case 'CircleGeometry': {
      const n = arcSegments(p.radius, p.segments, p.thetaLength, tol, 3)
      if (n >= p.segments) return g
      return cached(k([n]), () => new THREE.CircleGeometry(p.radius, n, p.thetaStart, p.thetaLength))
    }
    case 'RingGeometry': {
      const n = arcSegments(p.outerRadius, p.thetaSegments, p.thetaLength, tol, 3)
      if (n >= p.thetaSegments) return g
      return cached(k([n]), () => new THREE.RingGeometry(p.innerRadius, p.outerRadius, n, p.phiSegments, p.thetaStart, p.thetaLength))
    }
    default:
      return g
  }
}

/** Largest axis scale of a matrix (conservative for non-uniform scale). */
export function maxScale(m: THREE.Matrix4) {
  const e = m.elements
  return Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]))
}
