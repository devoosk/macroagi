import { useMemo } from 'react'
import * as THREE from 'three'
import { box, cyl, merge, rod, xf, type V3 } from './geometry'
import { Inst, M, type InstItem } from './Inst'
import type { HallLayout } from './layout'
import { useMats } from './materials'

const unitRod = () => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0)

/** Vertical rod items (unit rod scaled), from y0 to y1. */
function vrod(x: number, z: number, y0: number, y1: number, r: number): InstItem {
  return { p: [x, y0, z], s: [r, y1 - y0, r] }
}

/** Linear LED high-bay luminaires on wire suspensions. */
function HighBays({ L, cutaway }: { L: HallLayout; cutaway: boolean }) {
  const { m } = useMats()
  const geo = useMemo(() => {
    const housing = merge([
      box(1.25, 0.06, 0.34, [0, 0.03, 0]),
      // Heat-sink fins.
      ...[-0.11, -0.055, 0, 0.055, 0.11].map((z) => box(1.18, 0.05, 0.012, [0, 0.085, z])),
      box(0.3, 0.05, 0.12, [0.38, 0.13, 0]),
    ])
    const face = box(1.16, 0.006, 0.28, [0, -0.002, 0])
    return { housing, face, wire: unitRod() }
  }, [])
  const { fixtures, wires } = useMemo(() => {
    const fixtures: InstItem[] = []
    const wires: InstItem[] = []
    const y = 8.05
    const s = L.width / 30
    const rows = [-12.2, -8.4, -4.6, -1.6, 1.6, 4.6, 8.4, 12.2].map((z) => L.ridgeZ + z * s)
    for (let i = 0; i < L.frameXs.length - 1; i++) {
      for (const f of [0.25, 0.75]) {
        const x = L.frameXs[i] + L.bay * f
        for (const z of rows) {
          fixtures.push({ p: [x, y, z] })
          const top = L.roofY(z) + 0.05
          for (const dx of [-0.5, 0.5]) wires.push(vrod(x + dx, z, y + 0.06, top, 0.003))
        }
      }
    }
    return { fixtures, wires }
  }, [L])
  return (
    <group>
      <Inst geometry={geo.housing} material={m.ledHousing} items={fixtures} receiveShadow={false} />
      <Inst geometry={geo.face} material={m.ledFace} items={fixtures} receiveShadow={false} />
      {!cutaway && <Inst geometry={geo.wire} material={m.hanger} items={wires} receiveShadow={false} />}
    </group>
  )
}

interface TrayRun {
  x0: number
  x1: number
  y: number
  z: number
  w: number
}

/** Ladder cable trays with cables, rungs and trapeze hangers. */
function CableTrays({ L, cabinetX }: { L: HallLayout; cabinetX: number }) {
  const { m } = useMats()
  const b = L.bounds
  const runs = useMemo<TrayRun[]>(
    () => [
      { x0: L.x0 + 1.2, x1: L.x1 - 1.2, y: 6.2, z: b.maxZ - 0.9, w: 0.5 },
      { x0: L.x0 + 1.2, x1: L.x1 - 1.2, y: 6.2, z: b.minZ + 0.9, w: 0.4 },
      { x0: L.x0 + 1.2, x1: L.x1 - 1.2, y: 7.3, z: L.z1 - 0.9, w: 0.6 },
    ],
    [L, b.maxZ, b.minZ],
  )
  const geo = useMemo(() => {
    const rails: THREE.BufferGeometry[] = []
    const cables: THREE.BufferGeometry[] = []
    for (const r of runs) {
      const len = r.x1 - r.x0
      const cx = (r.x0 + r.x1) / 2
      for (const s of [-1, 1]) {
        rails.push(box(len, 0.1, 0.012, [cx, r.y + 0.05, r.z + (s * r.w) / 2]))
        rails.push(box(len, 0.012, 0.03, [cx, r.y + 0.1, r.z + (s * r.w) / 2 - s * 0.015]))
      }
      // Cable bundles lying in the tray.
      cables.push(box(len - 0.1, 0.035, r.w * 0.7, [cx, r.y + 0.03, r.z - r.w * 0.08]))
      for (const dz of [-0.12, 0, 0.1]) cables.push(rod([r.x0 + 0.05, r.y + 0.06, r.z + dz * r.w], [r.x1 - 0.05, r.y + 0.06, r.z + dz * r.w], 0.018, 6))
      // Trapeze hangers: strut below the tray.
      for (let x = r.x0 + 1; x < r.x1; x += 2.5) rails.push(box(0.04, 0.04, r.w + 0.2, [x, r.y - 0.02, r.z]))
    }
    // Vertical riser from the electrical cabinets up to the wall tray.
    const vr = { x: cabinetX, z: L.z1 - 0.9 }
    for (const s of [-1, 1]) rails.push(box(0.012, 7.3 - 2.25, 0.1, [vr.x + s * 0.3, (7.3 + 2.25) / 2, vr.z]))
    cables.push(box(0.4, 7.3 - 2.25, 0.04, [vr.x, (7.3 + 2.25) / 2, vr.z + 0.03]))
    return { rails: merge(rails), cables: merge(cables) }
  }, [runs, L, cabinetX])
  const { rungs, hangers } = useMemo(() => {
    const rungs: InstItem[] = []
    const hangers: InstItem[] = []
    for (const r of runs) {
      for (let x = r.x0 + 0.15; x < r.x1; x += 0.3) rungs.push({ p: [x, r.y + 0.008, r.z], s: [1, 1, r.w] })
      const top = L.clearH + 0.05
      for (let x = r.x0 + 1; x < r.x1; x += 2.5) {
        for (const s of [-1, 1]) hangers.push(vrod(x, r.z + s * (r.w / 2 + 0.07), r.y - 0.04, top, 0.006))
      }
    }
    for (let y = 2.4; y < 7.2; y += 0.3) rungs.push({ p: [cabinetX, y, L.z1 - 0.9], r: [0, Math.PI / 2, 0], s: [1, 1, 0.6] })
    return { rungs, hangers }
  }, [runs, L, cabinetX])
  const rungGeo = useMemo(() => box(0.025, 0.016, 1), [])
  const rodGeo = useMemo(unitRod, [])
  return (
    <group>
      <M g={geo.rails} m={m.trayRail} />
      <M g={geo.cables} m={m.cable} />
      <Inst geometry={rungGeo} material={m.trayRail} items={rungs} />
      <Inst geometry={rodGeo} material={m.hanger} items={hangers} receiveShadow={false} />
    </group>
  )
}

/** Wet sprinkler system: mains, branch lines and pendent heads. */
function Sprinklers({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const { pipes, heads } = useMemo(() => {
    const pipes: THREE.BufferGeometry[] = []
    const heads: InstItem[] = []
    const ym = 9.45
    const yb = 9.55
    for (const dz of [-6, 6]) {
      const z = L.ridgeZ + dz
      pipes.push(rod([L.x0 + 0.5, ym, z], [L.x1 - 0.5, ym, z], 0.055, 12))
    }
    // Riser on the gable.
    pipes.push(rod([L.x0 + 0.5, 0.0, L.ridgeZ - 6], [L.x0 + 0.5, ym, L.ridgeZ - 6], 0.07, 12))
    pipes.push(box(0.25, 0.3, 0.25, [L.x0 + 0.5, 1.4, L.ridgeZ - 6]))
    for (let x = L.x0 + L.bay / 4; x < L.x1; x += L.bay / 2) {
      // Skip positions that coincide with frames.
      if (L.frameXs.some((f) => Math.abs(f - x) < 0.3)) continue
      const za = L.z0 + 1.0
      const zb = L.z1 - 1.0
      pipes.push(rod([x, yb, za], [x, yb, zb], 0.025, 8))
      for (const dz of [-6, 6]) pipes.push(rod([x, ym, L.ridgeZ + dz], [x, yb, L.ridgeZ + dz], 0.025, 8))
      for (let z = za + 1.4; z < zb; z += 3.0) heads.push({ p: [x, yb, z] })
    }
    return { pipes: merge(pipes), heads }
  }, [L])
  const headGeo = useMemo(
    () => merge([cyl(0.012, 0.012, 0.12, [0, -0.06, 0], [0, 0, 0], 6), cyl(0.035, 0.035, 0.006, [0, -0.13, 0], [0, 0, 0], 10), box(0.03, 0.03, 0.006, [0, -0.1, 0])]),
    [],
  )
  return (
    <group>
      <M g={pipes} m={m.sprinkler} receive={false} />
      <Inst geometry={headGeo} material={m.brass} items={heads} receiveShadow={false} />
    </group>
  )
}

/** Spiral-seam ventilation ducts with drop diffusers and a roof riser. */
function Ducts({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const runs = useMemo(() => [L.ridgeZ - 8.6, L.ridgeZ + 8.6], [L])
  const R = 0.4
  const y = 7.7
  const xa = L.x0 + 3
  const xb = L.x1 - 5
  const geo = useMemo(() => {
    const ducts: THREE.BufferGeometry[] = []
    for (const z of runs) {
      const g = new THREE.CylinderGeometry(R, R, xb - xa, 32, 1, false)
      // UV in metres for the galvanised map.
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * (xb - xa))
      xf(g, [(xa + xb) / 2, y, z], [0, 0, Math.PI / 2])
      ducts.push(g)
      // Elbow up to the roof at the far end.
      ducts.push(cyl(R, R, L.roofY(z) - y + 0.4, [xb + 0.1, (y + L.roofY(z) + 0.4) / 2, z], [0, 0, 0], 32))
      ducts.push(new THREE.SphereGeometry(R, 24, 12).translate(xb + 0.1, y, z))
      ducts.push(new THREE.SphereGeometry(R, 24, 12).translate(xa, y, z))
    }
    return merge(ducts)
  }, [runs, L, xa, xb])
  const { rings, diffusers, straps } = useMemo(() => {
    const rings: InstItem[] = []
    const diffusers: InstItem[] = []
    const straps: InstItem[] = []
    for (const z of runs) {
      for (let x = xa + 1.5; x < xb; x += 3) {
        rings.push({ p: [x, y, z], r: [0, 0, Math.PI / 2] })
        straps.push(vrod(x, z - R * 0.7, y, L.clearH + 0.05, 0.008))
        straps.push(vrod(x, z + R * 0.7, y, L.clearH + 0.05, 0.008))
      }
      for (let x = xa + 3.5; x < xb - 1; x += L.bay) diffusers.push({ p: [x, y, z] })
    }
    return { rings, diffusers, straps }
  }, [runs, L, xa, xb])
  const ringGeo = useMemo(() => new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.06, 32, 1, true), [])
  const diffGeo = useMemo(
    () =>
      merge([
        cyl(0.22, 0.22, 0.55, [0, -0.5, 0], [0, 0, 0], 20),
        cyl(0.22, 0.45, 0.18, [0, -0.86, 0], [0, 0, 0], 24),
        cyl(0.45, 0.45, 0.03, [0, -0.96, 0], [0, 0, 0], 24),
        cyl(0.3, 0.3, 0.02, [0, -0.99, 0], [0, 0, 0], 24),
      ]),
    [],
  )
  const rodGeo = useMemo(unitRod, [])
  return (
    <group>
      <M g={geo} m={m.galv} receive={false} />
      <Inst geometry={ringGeo} material={m.galv} items={rings} />
      <Inst geometry={diffGeo} material={m.galv} items={diffusers} />
      <Inst geometry={rodGeo} material={m.hanger} items={straps} receiveShadow={false} />
    </group>
  )
}

/** Compressed-air ring main (blue aluminium) around the line with drops and FRL units. */
function AirMain({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const b = L.bounds
  const y = 4.0
  const zP = b.maxZ + 0.45
  const zN = b.minZ - 0.45
  const xa = b.minX - 1.2
  const xb = b.maxX + 1.2
  const dropXs = useMemo(() => {
    const n = 11
    const a = b.minX + 3
    const c = b.maxX - 5
    return Array.from({ length: n }, (_, i) => a + ((c - a) * i) / (n - 1))
  }, [b.minX, b.maxX])
  const geo = useMemo(() => {
    const pipe: THREE.BufferGeometry[] = []
    const grey: THREE.BufferGeometry[] = []
    const red: THREE.BufferGeometry[] = []
    const r = 0.032
    const corners: V3[] = [
      [xa, y, zN],
      [xb, y, zN],
      [xb, y, zP],
      [xa, y, zP],
    ]
    for (let i = 0; i < 4; i++) pipe.push(rod(corners[i], corners[(i + 1) % 4], r, 12))
    for (const c of corners) pipe.push(new THREE.SphereGeometry(r * 1.4, 10, 8).translate(...c))
    // Feed from the compressor room along the back wall.
    const fx = L.x0 + 3.6
    pipe.push(rod([xa, y, zN], [fx, y, zN], r, 12))
    pipe.push(rod([fx, y, zN], [fx, y, L.z0 + 0.5], r, 12))
    pipe.push(rod([fx, y, L.z0 + 0.5], [fx, 1.2, L.z0 + 0.5], r, 12))
    for (const x of dropXs) {
      // Goose-neck tee off the top of the main, then the drop.
      pipe.push(rod([x, y, zP], [x, y + 0.15, zP], 0.02, 8))
      pipe.push(rod([x, y + 0.15, zP], [x, y + 0.15, zP + 0.12], 0.02, 8))
      pipe.push(rod([x, y + 0.15, zP + 0.12], [x, 1.25, zP + 0.12], 0.02, 8))
      // FRL unit: body, filter bowl, regulator, gauge.
      grey.push(box(0.16, 0.08, 0.07, [x, 1.55, zP + 0.12]))
      grey.push(cyl(0.025, 0.025, 0.12, [x - 0.04, 1.45, zP + 0.12], [0, 0, 0], 12))
      grey.push(cyl(0.025, 0.025, 0.12, [x + 0.04, 1.45, zP + 0.12], [0, 0, 0], 12))
      grey.push(cyl(0.025, 0.025, 0.012, [x, 1.55, zP + 0.165], [Math.PI / 2, 0, 0], 16))
      grey.push(box(0.06, 0.06, 0.04, [x, 1.68, zP + 0.12]))
      // Ball valve with red lever and a quick coupling.
      red.push(box(0.1, 0.012, 0.02, [x + 0.05, 1.8, zP + 0.12]))
      grey.push(cyl(0.012, 0.012, 0.06, [x, 1.2, zP + 0.12], [0, 0, 0], 8))
    }
    return { pipe: merge(pipe), grey: merge(grey), red: merge(red) }
  }, [L, xa, xb, zN, zP, dropXs])
  const hangers = useMemo(() => {
    const out: InstItem[] = []
    for (let x = xa + 0.5; x < xb; x += 3.5) {
      out.push(vrod(x, zP, y + 0.03, L.clearH + 0.05, 0.005))
      out.push(vrod(x, zN, y + 0.03, L.clearH + 0.05, 0.005))
    }
    return out
  }, [L, xa, xb, zN, zP])
  const rodGeo = useMemo(unitRod, [])
  return (
    <group>
      <M g={geo.pipe} m={m.airPipe} />
      <M g={geo.grey} m={m.steelGrey} />
      <M g={geo.red} m={m.fireRed} />
      <Inst geometry={rodGeo} material={m.hanger} items={hangers} receiveShadow={false} />
    </group>
  )
}

export function Services({ L, cabinetX, cutaway = false }: { L: HallLayout; cabinetX: number; cutaway?: boolean }) {
  return (
    <group>
      <HighBays L={L} cutaway={cutaway} />
      <CableTrays L={L} cabinetX={cabinetX} />
      {!cutaway && <Sprinklers L={L} />}
      <Ducts L={L} />
      <AirMain L={L} />
    </group>
  )
}
