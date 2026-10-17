import { useMemo } from 'react'
import * as THREE from 'three'
import { box, floorOutline, floorRect, floorStrip, merge } from './geometry'
import { Inst, type InstItem } from './Inst'
import type { HallLayout, Rect } from './layout'
import { useMats } from './materials'

const Y = 0.0025 // paint layer height

/** Floor features shared with the peripheral layout so markings line up with the objects. */
export function floorPlan(L: HallLayout, hazardZones?: Rect[]) {
  const b = L.bounds
  const crossings = [b.minX + (b.maxX - b.minX) * 0.36, b.minX + (b.maxX - b.minX) * 0.74]
  const hazards: Rect[] =
    hazardZones ??
    // Default: behind the test stations of the reference line (leak test, charge, run test at 4.5 m pitch).
    [
      { minX: 16.6, maxX: 24.4, minZ: b.minZ + 0.25, maxZ: b.minZ + 1.6 },
      { minX: 34.4, maxX: 38.6, minZ: b.minZ + 0.25, maxZ: b.minZ + 1.6 },
    ]
  const staging: Rect = { minX: b.maxX - 6, maxX: b.maxX + 4, minZ: L.zones.walkway[1] + 1.2, maxZ: L.zones.walkway[1] + 4.6 }
  const forkliftPark: Rect = { minX: L.x1 - 8.6, maxX: L.x1 - 3.4, minZ: L.z1 - 4.2, maxZ: L.z1 - 0.6 }
  const gasCage: Rect = { minX: L.x0 + L.bay * 4.6, maxX: L.x0 + L.bay * 4.6 + 4.2, minZ: L.z1 - 2.6, maxZ: L.z1 - 0.35 }
  const cabinets: Rect = { minX: L.x0 + 2.2, maxX: L.x0 + 2.2 + 8 * 0.8, minZ: L.z1 - 0.95, maxZ: L.z1 - 0.35 }
  return { crossings, hazards, staging, forkliftPark, gasCage, cabinets }
}

export type FloorPlan = ReturnType<typeof floorPlan>

export function Floor({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m } = useMats()
  const floorGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(L.length + 0.6, L.width + 0.6)
    g.rotateX(-Math.PI / 2)
    g.translate(L.x0 + L.length / 2, 0, L.ridgeZ)
    // Keep hall UVs exact to the wall faces.
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - L.x0) / L.length, 1 - (pos.getZ(i) - L.z0) / L.width)
    return g
  }, [L])

  const marks = useMemo(() => {
    const b = L.bounds
    const yellow: THREE.BufferGeometry[] = []
    const white: THREE.BufferGeometry[] = []
    const green: THREE.BufferGeometry[] = []
    const hatch: THREE.BufferGeometry[] = []
    const dark: THREE.BufferGeometry[] = []
    const [w0, w1] = L.zones.walkway
    const lx0 = b.minX - 1.5
    const lx1 = b.maxX + 1.5
    // Operator-side walkway: green fill with yellow edges.
    green.push(floorRect(lx0, lx1, w0, w1, Y * 0.6))
    yellow.push(floorStrip(lx0, w0, lx1, w0, 0.1, Y))
    yellow.push(floorStrip(lx0, w1, lx1, w1, 0.1, Y))
    // Walkway connection to the personnel doors on the far wall.
    for (const x of [L.x0 + L.bay * 1.5, L.x0 + L.bay * 4.5]) {
      green.push(floorRect(x - 0.9, x + 0.9, w1, L.z1 - 0.3, Y * 0.6))
      yellow.push(floorStrip(x - 0.9, w1, x - 0.9, L.z1 - 0.3, 0.1, Y))
      yellow.push(floorStrip(x + 0.9, w1, x + 0.9, L.z1 - 0.3, 0.1, Y))
    }
    // Line work-zone boundary on the far side, and the line end caps.
    yellow.push(floorStrip(lx0, b.minZ - 0.35, lx1, b.minZ - 0.35, 0.1, Y))
    yellow.push(floorStrip(lx0, b.minZ - 0.35, lx0, w0, 0.1, Y))
    yellow.push(floorStrip(lx1, b.minZ - 0.35, lx1, w0, 0.1, Y))
    // AGV lane: white edges, dashed centre, fiducial markers.
    const [a0, a1] = L.zones.agvLane
    const ax0 = L.x0 + 1.2
    const ax1 = L.x1 - 1.2
    white.push(floorStrip(ax0, a0, ax1, a0, 0.08, Y))
    white.push(floorStrip(ax0, a1, ax1, a1, 0.08, Y))
    const ac = (a0 + a1) / 2
    for (let x = ax0 + 0.5; x < ax1 - 1; x += 2) white.push(floorStrip(x, ac, x + 1, ac, 0.08, Y))
    for (let x = ax0 + 1.5; x < ax1 - 0.5; x += 2) dark.push(floorRect(x - 0.06, x + 0.06, ac - 0.06, ac + 0.06, Y * 1.2))
    // Forklift aisle edge in front of the racking.
    yellow.push(floorStrip(L.x0 + 0.8, L.zones.rack[1] + 0.35, L.x1 - 0.8, L.zones.rack[1] + 0.35, 0.1, Y))
    // Pedestrian crossings from the line to the racking aisle (zebra).
    for (const cx of plan.crossings) {
      const z0 = L.zones.rack[1] + 0.5
      const z1 = b.minZ - 0.5
      for (let z = z0 + 0.15; z < z1 - 0.3; z += 0.8) white.push(floorRect(cx - 1.2, cx + 1.2, z, z + 0.4, Y))
    }
    // Hazard no-go zones near the test stations.
    for (const r of plan.hazards) {
      hatch.push(floorRect(r.minX, r.maxX, r.minZ, r.maxZ, Y))
      yellow.push(...floorOutline(r, 0.1, Y * 1.2))
    }
    // Finished-goods staging bays (white outlines, sub-divided).
    const s = plan.staging
    white.push(...floorOutline(s, 0.08, Y))
    for (let x = s.minX + 2.5; x < s.maxX - 0.1; x += 2.5) white.push(floorStrip(x, s.minZ, x, s.maxZ, 0.06, Y))
    // Forklift parking with hatched charge zone.
    const f = plan.forkliftPark
    yellow.push(...floorOutline(f, 0.1, Y))
    yellow.push(floorStrip((f.minX + f.maxX) / 2, f.minZ, (f.minX + f.maxX) / 2, f.maxZ, 0.1, Y))
    hatch.push(floorRect(f.minX, f.maxX, f.maxZ - 0.9, f.maxZ - 0.05, Y))
    // Gas cage keep-clear apron and electrical cabinet keep-clear.
    const g = plan.gasCage
    const apron = { minX: g.minX - 0.4, maxX: g.maxX + 0.4, minZ: g.minZ - 1.3, maxZ: g.minZ - 0.15 }
    hatch.push(floorRect(apron.minX, apron.maxX, apron.minZ, apron.maxZ, Y))
    yellow.push(...floorOutline(apron, 0.08, Y * 1.2))
    const c = plan.cabinets
    const keep = { minX: c.minX - 0.2, maxX: c.maxX + 0.2, minZ: c.minZ - 1.1, maxZ: c.minZ - 0.1 }
    hatch.push(floorRect(keep.minX, keep.maxX, keep.minZ, keep.maxZ, Y))
    yellow.push(...floorOutline(keep, 0.08, Y * 1.2))
    // Door swing / loading door keep-clear zones.
    for (const [d, dir] of [
      [L.doorIn, 1],
      [L.doorOut, -1],
    ] as const) {
      const r = { minX: Math.min(d.x, d.x + dir * 3), maxX: Math.max(d.x, d.x + dir * 3), minZ: d.z - d.w / 2, maxZ: d.z + d.w / 2 }
      yellow.push(...floorOutline(r, 0.1, Y))
      for (let k = 1; k < 6; k++) {
        const t = k / 6
        yellow.push(floorStrip(r.minX + 0.1, r.minZ + t * (r.maxZ - r.minZ) - 0.5, r.maxX - 0.1, r.minZ + t * (r.maxZ - r.minZ) + 0.5, 0.09, Y))
      }
    }
    return {
      yellow: merge(yellow),
      white: merge(white),
      green: merge(green),
      hatch: merge(hatch),
      dark: merge(dark),
    }
  }, [L, plan])

  // Floor drains: stainless frame with slotted grate.
  const drain = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [
      box(0.42, 0.006, 0.03, [0, 0.003, 0.195]),
      box(0.42, 0.006, 0.03, [0, 0.003, -0.195]),
      box(0.03, 0.006, 0.36, [0.195, 0.003, 0]),
      box(0.03, 0.006, 0.36, [-0.195, 0.003, 0]),
    ]
    for (let i = 0; i < 9; i++) parts.push(box(0.012, 0.005, 0.36, [-0.16 + i * 0.04, 0.0025, 0]))
    return merge(parts)
  }, [])
  const drainItems = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    for (let x = L.x0 + 3.5; x < L.x1 - 2; x += L.bay) {
      out.push({ p: [x, 0, L.zones.walkway[1] + 0.6] })
      out.push({ p: [x + 1.5, 0, L.zones.agvLane[0] - 0.7] })
    }
    return out
  }, [L])
  const holeGeo = useMemo(() => floorRect(-0.19, 0.19, -0.19, 0.19, 0.001), [])

  return (
    <group>
      <mesh geometry={floorGeo} material={m.floor} receiveShadow />
      <mesh geometry={marks.green} material={m.paintGreen} receiveShadow />
      <mesh geometry={marks.yellow} material={m.paintYellow} receiveShadow />
      <mesh geometry={marks.white} material={m.paintWhite} receiveShadow />
      <mesh geometry={marks.hatch} material={m.hatch} receiveShadow />
      <mesh geometry={marks.dark} material={m.paintBlack} receiveShadow />
      <Inst geometry={holeGeo} material={m.paintBlack} items={drainItems} />
      <Inst geometry={drain} material={m.chrome} items={drainItems} />
    </group>
  )
}
