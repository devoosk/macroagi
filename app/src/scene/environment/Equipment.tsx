import { useMemo } from 'react'
import * as THREE from 'three'
import { rng } from '../../lib/rng'
import { box, cyl, merge, rod, xf, type V3 } from './geometry'
import { Inst, M, type InstItem } from './Inst'
import type { HallLayout } from './layout'
import type { FloorPlan } from './Floor'
import { useMats } from './materials'

type Seg = [number, number, number, number]

/** Welded-mesh safety fence runs: posts, frames, mesh infill. Segments in XZ. */
function Fence({ segs, h = 2.0 }: { segs: Seg[]; h?: number }) {
  const { m } = useMats()
  const geo = useMemo(() => {
    const mesh: THREE.BufferGeometry[] = []
    const frame: THREE.BufferGeometry[] = []
    const posts: InstItem[] = []
    for (const [ax, az, bx, bz] of segs) {
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.round(len / 2))
      const ang = -Math.atan2(bz - az, bx - ax)
      for (let i = 0; i < n; i++) {
        const t0 = i / n
        const t1 = (i + 1) / n
        const pw = len / n - 0.08
        const cx = ax + (bx - ax) * ((t0 + t1) / 2)
        const cz = az + (bz - az) * ((t0 + t1) / 2)
        const panel = new THREE.PlaneGeometry(pw, h - 0.2)
        const uv = panel.attributes.uv
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * pw, uv.getY(k) * (h - 0.2))
        mesh.push(xf(panel, [cx, 0.15 + (h - 0.2) / 2, cz], [0, ang, 0]))
        for (const y of [0.13, h - 0.03]) frame.push(xf(new THREE.BoxGeometry(pw, 0.03, 0.02), [cx, y, cz], [0, ang, 0]))
        for (const s of [-1, 1]) {
          const ox = (Math.cos(ang) * s * pw) / 2
          const oz = (-Math.sin(ang) * s * pw) / 2
          frame.push(xf(new THREE.BoxGeometry(0.02, h - 0.15, 0.02), [cx + ox, 0.13 + (h - 0.15) / 2, cz + oz], [0, ang, 0]))
        }
      }
      for (let i = 0; i <= n; i++) posts.push({ p: [ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n], r: [0, ang, 0] })
    }
    return { mesh: merge(mesh), frame: merge(frame), posts }
  }, [segs, h])
  const postGeo = useMemo(() => merge([box(0.06, h, 0.06, [0, h / 2, 0]), box(0.15, 0.01, 0.15, [0, 0.005, 0])]), [h])
  return (
    <group>
      <mesh geometry={geo.mesh} material={m.fenceMesh} castShadow />
      <M g={geo.frame} m={m.fenceFrame} />
      <Inst geometry={postGeo} material={m.safetyYellow} items={geo.posts} castShadow />
    </group>
  )
}

/** Bank of electrical cabinets (RAL 7035) with lamps and pictogram warning triangles. */
function Cabinets({ plan }: { plan: FloorPlan }) {
  const { m } = useMats()
  const c = plan.cabinets
  const geo = useMemo(() => {
    const body = merge([
      box(0.79, 2.0, 0.58, [0, 1.1, 0]),
      // Door slightly proud with a shadow gap.
      box(0.74, 1.92, 0.02, [0, 1.1, 0.3]),
      // Roof vent hood.
      box(0.6, 0.06, 0.4, [0, 2.13, 0]),
    ])
    const dark = merge([
      box(0.8, 0.1, 0.6, [0, 0.05, 0]),
      // Swing handle and hinges.
      box(0.03, 0.18, 0.03, [0.3, 1.15, 0.33]),
      box(0.02, 0.08, 0.02, [-0.36, 1.8, 0.32]),
      box(0.02, 0.08, 0.02, [-0.36, 0.45, 0.32]),
      // Filter fan grilles.
      box(0.2, 0.2, 0.015, [0, 0.4, 0.315]),
      box(0.2, 0.2, 0.015, [0, 1.75, 0.315]),
    ])
    const tri = new THREE.Shape()
    tri.moveTo(-0.07, 0)
    tri.lineTo(0.07, 0)
    tri.lineTo(0, 0.12)
    tri.closePath()
    const yellow = new THREE.ShapeGeometry(tri).translate(0, 1.42, 0.312)
    const bolt = new THREE.Shape()
    bolt.moveTo(0.004, 0.1)
    bolt.lineTo(-0.018, 0.045)
    bolt.lineTo(0.002, 0.045)
    bolt.lineTo(-0.01, 0.012)
    bolt.lineTo(0.02, 0.06)
    bolt.lineTo(0.0, 0.06)
    bolt.lineTo(0.016, 0.1)
    bolt.closePath()
    const boltG = new THREE.ShapeGeometry(bolt).translate(0, 1.42, 0.313)
    return { body, dark, yellow, bolt: boltG }
  }, [])
  const items = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    const n = Math.round((c.maxX - c.minX) / 0.8)
    for (let i = 0; i < n; i++) out.push({ p: [c.minX + 0.4 + i * 0.8, 0, (c.minZ + c.maxZ) / 2], r: [0, Math.PI, 0] })
    return out
  }, [c])
  const lamps = useMemo(() => {
    const r = rng('env', 'cabinet-lamps')
    const green: InstItem[] = []
    const amber: InstItem[] = []
    const white: InstItem[] = []
    for (const it of items) {
      for (let k = 0; k < 3; k++) {
        const v = r()
        const p: V3 = [it.p[0] - 0.15 + k * 0.08, 1.6, it.p[2] - 0.315]
        if (v < 0.5) green.push({ p })
        else if (v < 0.65) amber.push({ p })
        else white.push({ p })
      }
    }
    return { green, amber, white }
  }, [items])
  const lampGeo = useMemo(() => cyl(0.014, 0.014, 0.02, [0, 0, 0], [Math.PI / 2, 0, 0], 12), [])
  return (
    <group>
      <Inst geometry={geo.body} material={m.cabinet} items={items} castShadow />
      <Inst geometry={geo.dark} material={m.cabinetPlinth} items={items} />
      <Inst geometry={geo.yellow} material={m.safetyYellow} items={items} />
      <Inst geometry={geo.bolt} material={m.safetyBlack} items={items} />
      <Inst geometry={lampGeo} material={m.lampGreen} items={lamps.green} />
      <Inst geometry={lampGeo} material={m.lampAmber} items={lamps.amber} />
      <Inst geometry={lampGeo} material={m.lampWhite} items={lamps.white} />
    </group>
  )
}

/** Fire extinguishers with sign boards, hose reels and call points. Local: wall at z=0, facing +z. */
function FireSafety({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m } = useMats()
  const geo = useMemo(() => {
    const red = merge([
      cyl(0.085, 0.085, 0.5, [0, 0.55, 0.12], [0, 0, 0], 16),
      new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.8, 0.12),
    ])
    const black = merge([
      cyl(0.02, 0.02, 0.06, [0, 0.87, 0.12], [0, 0, 0], 8),
      box(0.12, 0.015, 0.025, [0.03, 0.91, 0.12]),
      box(0.1, 0.012, 0.025, [0.03, 0.885, 0.12], [0, 0, 0.25]),
      rod([0.02, 0.88, 0.14], [0.09, 0.7, 0.2], 0.01, 6),
      rod([0.09, 0.7, 0.2], [0.09, 0.45, 0.2], 0.01, 6),
      box(0.12, 0.04, 0.04, [0, 0.62, 0.03]),
      box(0.03, 0.3, 0.02, [0, 0.62, 0.01]),
      cyl(0.088, 0.088, 0.03, [0, 0.3, 0.12], [0, 0, 0], 16),
    ])
    const sign = box(0.2, 0.2, 0.008, [0, 1.95, 0.005])
    // White pictogram: extinguisher silhouette with a flame tongue.
    const flame = new THREE.Shape()
    flame.moveTo(0.02, -0.06)
    flame.quadraticCurveTo(0.075, -0.02, 0.05, 0.05)
    flame.quadraticCurveTo(0.045, 0.01, 0.035, 0.02)
    flame.quadraticCurveTo(0.04, -0.03, 0.02, -0.06)
    const pict = merge([
      box(0.04, 0.1, 0.004, [-0.03, 1.935, 0.011]),
      box(0.025, 0.015, 0.004, [-0.03, 1.995, 0.011]),
      box(0.03, 0.006, 0.004, [-0.005, 2.005, 0.011]),
      new THREE.ShapeGeometry(flame).translate(0, 1.95, 0.011),
    ])
    const reel = merge([box(0.7, 0.7, 0.25, [0, 1.35, 0.125])])
    const reelFace = merge([
      cyl(0.25, 0.25, 0.02, [0, 1.35, 0.26], [Math.PI / 2, 0, 0], 28),
      cyl(0.08, 0.08, 0.04, [0, 1.35, 0.28], [Math.PI / 2, 0, 0], 16),
    ])
    const hose = new THREE.TorusGeometry(0.18, 0.03, 8, 28).translate(0, 1.35, 0.29)
    const call = merge([box(0.09, 0.09, 0.05, [0, 1.4, 0.025])])
    return { red, black, sign, pict, reel, reelFace, hose, call }
  }, [])
  const ext = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    // On every other portal column face along both long walls, plus by the loading doors.
    for (let i = 1; i < L.frameXs.length - 1; i += 2) {
      const x = L.frameXs[i] + 0.4
      out.push({ p: [x, 0, L.z0 + 0.05], r: [0, 0, 0] })
      out.push({ p: [x, 0, L.z1 - 0.05], r: [0, Math.PI, 0] })
    }
    for (const d of [L.doorIn, L.doorOut]) {
      const sx = d.x === L.x0 ? 1 : -1
      out.push({ p: [d.x + sx * 0.05, 0, d.z + d.w / 2 + 1.2], r: [0, (sx * Math.PI) / 2, 0] })
    }
    out.push({ p: [plan.cabinets.maxX + 0.6, 0, L.z1 - 0.05], r: [0, Math.PI, 0] })
    out.push({ p: [plan.gasCage.minX - 0.8, 0, L.z1 - 0.05], r: [0, Math.PI, 0] })
    return out
  }, [L, plan])
  const reels = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    for (let i = 2; i < L.frameXs.length - 1; i += 3) {
      out.push({ p: [L.frameXs[i] - 1.2, 0, L.z1 - 0.06], r: [0, Math.PI, 0] })
    }
    return out
  }, [L])
  const calls = useMemo<InstItem[]>(
    () => [L.x0 + L.bay * 1.5, L.x0 + L.bay * 4.5, L.x0 + L.bay * 7.5].map((x) => ({ p: [x + 0.9, 0, L.z1 - 0.06], r: [0, Math.PI, 0] })),
    [L],
  )
  return (
    <group>
      <Inst geometry={geo.red} material={m.fireRed} items={ext} castShadow />
      <Inst geometry={geo.black} material={m.safetyBlack} items={ext} />
      <Inst geometry={geo.sign} material={m.signRed} items={[...ext, ...reels.map((r) => ({ ...r, p: [r.p[0], 0.25, r.p[2]] as V3 }))]} />
      <Inst geometry={geo.pict} material={m.signWhite} items={ext} />
      <Inst geometry={geo.reel} material={m.fireRed} items={reels} castShadow />
      <Inst geometry={geo.reelFace} material={m.steelGrey} items={reels} />
      <Inst geometry={geo.hose} material={m.fireRed} items={reels} />
      <Inst geometry={geo.call} material={m.fireRed} items={calls} />
    </group>
  )
}

/** First-aid board with white cross, first-aid box and eyewash bottles. */
function FirstAid({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m } = useMats()
  const x = plan.cabinets.maxX + 1.8
  const z = L.z1 - 0.04
  const geo = useMemo(() => {
    const green = merge([
      box(0.7, 0.9, 0.02, [0, 1.6, -0.01]),
      // First-aid cabinet.
      box(0.42, 0.32, 0.16, [-0.1, 1.42, -0.1]),
      // Eyewash bottle holder.
      box(0.16, 0.26, 0.1, [0.22, 1.36, -0.07]),
    ])
    const white = merge([
      box(0.22, 0.07, 0.01, [0, 1.85, -0.025]),
      box(0.07, 0.22, 0.01, [0, 1.85, -0.025]),
      box(0.1, 0.03, 0.01, [-0.1, 1.45, -0.185]),
      box(0.03, 0.1, 0.01, [-0.1, 1.45, -0.185]),
      cyl(0.03, 0.03, 0.2, [0.19, 1.38, -0.09], [0, 0, 0], 10),
      cyl(0.03, 0.03, 0.2, [0.25, 1.38, -0.09], [0, 0, 0], 10),
    ])
    return { green, white }
  }, [])
  return (
    <group position={[x, 0, z]}>
      <M g={geo.green} m={m.signGreen} />
      <M g={geo.white} m={m.signWhite} />
    </group>
  )
}

/** R290 refrigerant cylinder cage with flammable-gas pictogram. */
function GasCage({ plan }: { plan: FloorPlan }) {
  const { m } = useMats()
  const g = plan.gasCage
  const segs = useMemo<Seg[]>(
    () => [
      [g.minX, g.maxZ, g.minX, g.minZ],
      [g.minX, g.minZ, g.minX + 1.2, g.minZ],
      [g.minX + 2.2, g.minZ, g.maxX, g.minZ],
      [g.maxX, g.minZ, g.maxX, g.maxZ],
    ],
    [g],
  )
  const cyls = useMemo(() => {
    const r = rng('env', 'gas')
    const out: InstItem[] = []
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 2; j++) {
        if (r() < 0.2) continue
        out.push({ p: [g.minX + 0.4 + i * 0.4 + (r() - 0.5) * 0.04, 0, g.maxZ - 0.35 - j * 0.42], r: [0, r() * 6, 0] })
      }
    }
    return out
  }, [g])
  const geo = useMemo(() => {
    const body = merge([cyl(0.15, 0.15, 1.1, [0, 0.6, 0], [0, 0, 0], 18), new THREE.SphereGeometry(0.15, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.15, 0)])
    const cap = merge([cyl(0.15, 0.15, 0.2, [0, 1.05, 0], [0, 0, 0], 18), cyl(0.06, 0.07, 0.12, [0, 1.32, 0], [0, 0, 0], 12), cyl(0.155, 0.155, 0.04, [0, 0.05, 0], [0, 0, 0], 18)])
    // Restraint chain rail along the back.
    const rail = merge([box(g.maxX - g.minX - 0.2, 0.04, 0.04, [(g.minX + g.maxX) / 2, 1.0, g.maxZ - 0.12])])
    // GHS-style flammable pictogram: red diamond, white inner, black flame.
    const diamond = (s: number, z: number) => {
      const sh = new THREE.Shape()
      sh.moveTo(0, -s)
      sh.lineTo(s, 0)
      sh.lineTo(0, s)
      sh.lineTo(-s, 0)
      sh.closePath()
      return new THREE.ShapeGeometry(sh).translate(0, 0, z)
    }
    const flame = new THREE.Shape()
    flame.moveTo(-0.07, -0.08)
    flame.lineTo(0.07, -0.08)
    flame.quadraticCurveTo(0.09, 0.02, 0.02, 0.11)
    flame.quadraticCurveTo(0.03, 0.03, -0.01, 0.0)
    flame.quadraticCurveTo(-0.02, 0.06, -0.05, 0.07)
    flame.quadraticCurveTo(-0.1, 0.0, -0.07, -0.08)
    const signPos: V3 = [(g.minX + g.maxX) / 2 + 0.6, 1.5, g.minZ - 0.02]
    const red = xf(diamond(0.22, 0), signPos, [0, Math.PI, 0])
    const white = xf(diamond(0.19, -0.002), signPos, [0, Math.PI, 0])
    const black = xf(new THREE.ShapeGeometry(flame).translate(0, -0.02, -0.004), signPos, [0, Math.PI, 0])
    return { body, cap, rail, red, white, black }
  }, [g])
  return (
    <group>
      <Fence segs={segs} h={2.0} />
      <Inst geometry={geo.body} material={m.gasCylinder} items={cyls} castShadow />
      <Inst geometry={geo.cap} material={m.gasCap} items={cyls} />
      <M g={geo.rail} m={m.steelGrey} />
      <mesh geometry={geo.red} material={m.signRed} />
      <mesh geometry={geo.white} material={m.signWhite} />
      <mesh geometry={geo.black} material={m.safetyBlack} />
    </group>
  )
}

/** Compressor room corner: screw compressor, dryer, receiver, fenced. */
function Compressor({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const x0 = L.x0 + 0.6
  const x1 = L.x0 + 6.4
  const z0 = L.z0 + 0.3
  const z1 = L.z0 + 2.9
  const segs = useMemo<Seg[]>(
    () => [
      [x0, z1, x1, z1],
      [x1, z1, x1, z0],
    ],
    [x0, x1, z0, z1],
  )
  const geo = useMemo(() => {
    const cab = merge([box(1.9, 1.7, 1.0, [x0 + 1.4, 0.85, z0 + 0.8]), box(0.9, 1.3, 0.8, [x0 + 3.1, 0.65, z0 + 0.7])])
    const grilles = merge([box(0.8, 0.5, 0.02, [x0 + 1.2, 1.15, z0 + 1.31]), box(0.5, 0.4, 0.02, [x0 + 3.1, 0.9, z0 + 1.11])])
    const tank = merge([
      cyl(0.4, 0.4, 1.6, [x0 + 4.6, 1.0, z0 + 0.7], [0, 0, 0], 24),
      new THREE.SphereGeometry(0.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(x0 + 4.6, 1.8, z0 + 0.7),
      new THREE.SphereGeometry(0.4, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.5, 1).translate(x0 + 4.6, 0.2, z0 + 0.7),
    ])
    const steel = merge([
      ...[0, 1, 2].map((k) => {
        const a = (k / 3) * Math.PI * 2
        return rod([x0 + 4.6 + Math.cos(a) * 0.3, 0, z0 + 0.7 + Math.sin(a) * 0.3], [x0 + 4.6 + Math.cos(a) * 0.3, 0.3, z0 + 0.7 + Math.sin(a) * 0.3], 0.03, 6)
      }),
      rod([x0 + 2.35, 1.4, z0 + 0.5], [x0 + 2.35, 2.2, z0 + 0.5], 0.04, 10),
      rod([x0 + 2.35, 2.2, z0 + 0.5], [x0 + 4.6, 2.2, z0 + 0.5], 0.04, 10),
      rod([x0 + 4.6, 2.2, z0 + 0.5], [x0 + 4.6, 1.9, z0 + 0.6], 0.04, 10),
      cyl(0.05, 0.05, 0.02, [x0 + 4.6, 1.2, z0 + 1.1], [Math.PI / 2, 0, 0], 16),
    ])
    return { cab, grilles, tank, steel }
  }, [x0, z0])
  return (
    <group>
      <Fence segs={segs} h={2.2} />
      <M g={geo.cab} m={m.cabinet} cast />
      <M g={geo.grilles} m={m.cabinetPlinth} />
      <M g={geo.tank} m={m.steelGrey} cast />
      <M g={geo.steel} m={m.airPipe} />
    </group>
  )
}

/** Counterbalance electric forklift in its parking bay, plus a wall charger. Local: forks along +x. */
function Forklift({ plan }: { plan: FloorPlan }) {
  const { m } = useMats()
  const f = plan.forkliftPark
  const geo = useMemo(() => {
    const yellow = merge([
      box(1.5, 0.55, 1.05, [-0.05, 0.55, 0]),
      // Battery hood and side steps.
      box(0.9, 0.12, 0.95, [-0.15, 0.88, 0]),
      // Mast cross members.
      box(0.06, 0.08, 0.72, [0.86, 2.15, 0]),
      box(0.06, 0.08, 0.72, [0.86, 1.2, 0]),
    ])
    const dark = merge([
      // Counterweight.
      box(0.45, 0.85, 1.08, [-0.88, 0.6, 0]),
      // Seat.
      box(0.45, 0.12, 0.5, [-0.35, 1.0, 0]),
      box(0.1, 0.5, 0.5, [-0.58, 1.25, 0]),
      // Overhead guard posts and roof grid.
      ...[[0.45, 0.48], [0.45, -0.48], [-0.75, 0.48], [-0.75, -0.48]].map(([x, z]) => box(0.06, 1.3, 0.06, [x, 1.5, z])),
      box(1.3, 0.05, 1.02, [-0.15, 2.15, 0]),
      // Steering column.
      rod([0.15, 0.85, 0], [0.0, 1.35, 0], 0.03, 8),
      // Mast channels.
      box(0.08, 2.25, 0.1, [0.86, 1.15, 0.33]),
      box(0.08, 2.25, 0.1, [0.86, 1.15, -0.33]),
      box(0.08, 2.1, 0.08, [0.92, 1.1, 0.25]),
      box(0.08, 2.1, 0.08, [0.92, 1.1, -0.25]),
      // Carriage plate.
      box(0.05, 0.45, 0.9, [0.98, 0.35, 0]),
      // Forks (L-shape).
      box(0.05, 0.45, 0.1, [1.01, 0.25, 0.28]),
      box(0.05, 0.45, 0.1, [1.01, 0.25, -0.28]),
      box(1.15, 0.04, 0.1, [1.6, 0.03, 0.28]),
      box(1.15, 0.04, 0.1, [1.6, 0.03, -0.28]),
    ])
    const tyres = merge([
      cyl(0.3, 0.3, 0.22, [0.45, 0.3, 0.45], [Math.PI / 2, 0, 0], 24),
      cyl(0.3, 0.3, 0.22, [0.45, 0.3, -0.45], [Math.PI / 2, 0, 0], 24),
      cyl(0.22, 0.22, 0.18, [-0.6, 0.22, 0.42], [Math.PI / 2, 0, 0], 20),
      cyl(0.22, 0.22, 0.18, [-0.6, 0.22, -0.42], [Math.PI / 2, 0, 0], 20),
      // Steering wheel.
      new THREE.TorusGeometry(0.16, 0.015, 8, 24).rotateX(Math.PI / 2).rotateZ(0.5).translate(0.0, 1.36, 0),
    ])
    const hubs = merge([
      cyl(0.16, 0.16, 0.23, [0.45, 0.3, 0.45], [Math.PI / 2, 0, 0], 16),
      cyl(0.16, 0.16, 0.23, [0.45, 0.3, -0.45], [Math.PI / 2, 0, 0], 16),
      cyl(0.11, 0.11, 0.19, [-0.6, 0.22, 0.42], [Math.PI / 2, 0, 0], 16),
      cyl(0.11, 0.11, 0.19, [-0.6, 0.22, -0.42], [Math.PI / 2, 0, 0], 16),
    ])
    const beacon = cyl(0.05, 0.05, 0.08, [-0.6, 2.22, 0.3], [0, 0, 0], 12)
    const charger = merge([box(0.5, 0.7, 0.3, [0, 1.3, 0]), box(0.1, 0.9, 0.05, [0.3, 0.6, 0.1])])
    const chargerCable = merge([rod([0.3, 1.0, 0.15], [0.3, 0.3, 0.6], 0.015, 6), rod([0.3, 0.3, 0.6], [0.0, 0.6, 1.4], 0.015, 6)])
    return { yellow, dark, tyres, hubs, beacon, charger, chargerCable }
  }, [])
  const cx = (f.minX + f.maxX) / 2
  const truckPos: V3 = [(f.minX + cx) / 2, 0, (f.minZ + f.maxZ) / 2 - 0.3]
  return (
    <group>
      <group position={truckPos} rotation-y={-Math.PI / 2}>
        <M g={geo.yellow} m={m.forklift} cast />
        <M g={geo.dark} m={m.forkliftDark} cast />
        <M g={geo.tyres} m={m.tyre} cast />
        <M g={geo.hubs} m={m.steelGrey} />
        <mesh geometry={geo.beacon} material={m.lampAmber} />
      </group>
      {[f.minX + 1.3, cx + 1.3].map((x) => (
        <group key={x} position={[x, 0, f.maxZ + 0.42]} rotation-y={Math.PI}>
          <M g={geo.charger} m={m.cabinet} cast />
          <M g={geo.chargerCable} m={m.cable} />
        </group>
      ))}
    </group>
  )
}

/** Waste segregation bins by the walkway. */
function WasteBins({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m } = useMats()
  const geo = useMemo(() => merge([box(0.58, 0.95, 0.7, [0, 0.5, 0]), box(0.62, 0.05, 0.75, [0, 1.0, 0.02])]), [])
  const wheels = useMemo(() => merge([cyl(0.1, 0.1, 0.05, [-0.25, 0.1, -0.3], [0, 0, Math.PI / 2], 12), cyl(0.1, 0.1, 0.05, [0.25, 0.1, -0.3], [0, 0, Math.PI / 2], 12)]), [])
  const items = useMemo<InstItem[]>(() => {
    const cols = ['#2c5fb3', '#e2b41b', '#5a6068', '#2c8a4b']
    const x0 = plan.staging.minX - 4.2
    const z = L.zones.walkway[1] + 1.0
    return cols.map((c, i) => ({ p: [x0 + i * 0.7, 0, z], r: [0, Math.PI, 0], c }))
  }, [L, plan])
  return (
    <group>
      <Inst geometry={geo} material={m.bin} items={items} castShadow />
      <Inst geometry={wheels} material={m.tyre} items={items} />
    </group>
  )
}

export function Equipment({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  return (
    <group>
      <Cabinets plan={plan} />
      <FireSafety L={L} plan={plan} />
      <FirstAid L={L} plan={plan} />
      <GasCage plan={plan} />
      <Compressor L={L} />
      <Forklift plan={plan} />
      <WasteBins L={L} plan={plan} />
    </group>
  )
}
