import * as THREE from 'three'

// Shared procedural geometry and material caches for workers, tools and parts.
// Geometry and materials are immutable once created and shared across workers.

const geoCache = new Map<string, THREE.BufferGeometry>()
export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key)
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g as T
}

/** Tapered capsule: top hemisphere radius r1 at y=0, bottom hemisphere radius r2 at y=-length. */
export function limb(r1: number, r2: number, length: number, seg = 16): THREE.BufferGeometry {
  return geo(`limb:${r1.toFixed(4)}:${r2.toFixed(4)}:${length.toFixed(4)}:${seg}`, () => {
    const n = Math.max(4, Math.round(seg / 2))
    const pts: THREE.Vector2[] = []
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / n)
      pts.push(new THREE.Vector2(Math.max(1e-4, r2 * Math.cos(a)), -length + r2 * Math.sin(a)))
    }
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI / 2) * (i / n)
      pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), r1 * Math.sin(a)))
    }
    return new THREE.LatheGeometry(pts, seg)
  })
}

/** Lathe from a (radius, y) profile. */
export function lathe(key: string, profile: [number, number][], seg = 24): THREE.BufferGeometry {
  return geo(`lathe:${key}:${seg}`, () => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg))
}

export function sphere(seg = 16, thetaLength = Math.PI): THREE.SphereGeometry {
  return geo(`sphere:${seg}:${thetaLength.toFixed(3)}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.75)), 0, Math.PI * 2, 0, thetaLength))
}

export function cyl(rt: number, rb: number, h: number, seg = 16, open = false, thetaStart = 0, thetaLength = Math.PI * 2): THREE.CylinderGeometry {
  return geo(`cyl:${rt}:${rb}:${h}:${seg}:${open}:${thetaStart.toFixed(3)}:${thetaLength.toFixed(3)}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, thetaLength))
}

export function box(x: number, y: number, z: number): THREE.BoxGeometry {
  return geo(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z))
}

export function torus(r: number, tube: number, seg = 24, arc = Math.PI * 2): THREE.TorusGeometry {
  return geo(`torus:${r}:${tube}:${seg}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(r, tube, 8, seg, arc))
}

export function cone(r: number, h: number, seg = 16, open = true): THREE.ConeGeometry {
  return geo(`cone:${r}:${h}:${seg}:${open}`, () => new THREE.ConeGeometry(r, h, seg, 1, open))
}

interface MatOpts {
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
}
const matCache = new Map<string, THREE.Material>()
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `std:${color}:${JSON.stringify(o)}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.8,
      metalness: o.metalness ?? 0,
      emissive: o.emissive ?? '#000000',
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
    })
    matCache.set(key, m)
  }
  return m as THREE.MeshStandardMaterial
}

/** Glass/lens material. */
export function glass(tint: string, opacity = 0.32): THREE.MeshPhysicalMaterial {
  const key = `glass:${tint}:${opacity}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.05, metalness: 0, transparent: true, opacity, side: THREE.DoubleSide, clearcoat: 1, depthWrite: false })
    matCache.set(key, m)
  }
  return m as THREE.MeshPhysicalMaterial
}

/** Additive unlit material for flames and beams. */
export function glow(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const key = `glow:${color}:${opacity}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    matCache.set(key, m)
  }
  return m as THREE.MeshBasicMaterial
}

/** Flat ribbon (e.g. a reflective vest strap) over the shoulder in the y-z plane; width along x. */
export function strap(key: string, az: number, ay: number, y0: number, yBottom: number, width: number, n = 28): THREE.BufferGeometry {
  return geo(`strap:${key}:${az.toFixed(4)}:${ay}:${y0}:${yBottom}:${width}:${n}`, () => {
    const pts: [number, number][] = [[yBottom, -az]]
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI * i) / n
      const c = Math.cos(a)
      const s = Math.sin(a)
      pts.push([y0 + ay * Math.pow(s, 0.6), -az * Math.sign(c) * Math.pow(Math.abs(c), 0.45)])
    }
    pts.push([yBottom, az])
    const pos: number[] = []
    const nor: number[] = []
    const idx: number[] = []
    pts.forEach(([y, z], i) => {
      const [py, pz] = pts[Math.max(0, i - 1)]
      const [ny, nz] = pts[Math.min(pts.length - 1, i + 1)]
      const l = Math.hypot(ny - py, nz - pz) || 1
      let nyy = -(nz - pz) / l
      let nzz = (ny - py) / l
      if (nyy * (y - y0) + nzz * z < 0) {
        nyy = -nyy
        nzz = -nzz
      }
      pos.push(-width / 2, y, z, width / 2, y, z)
      nor.push(0, nyy, nzz, 0, nyy, nzz)
      if (i > 0) {
        const b = (i - 1) * 2
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    g.setIndex(idx)
    return g
  })
}
