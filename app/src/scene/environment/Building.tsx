import { useMemo } from 'react'
import * as THREE from 'three'
import { box, boxM, cShape, extrudeX, extrudeY, iShape, member, merge, ribbedSheet, rod, type V3 } from './geometry'
import { Inst, M, type InstItem } from './Inst'
import type { Door, HallLayout } from './layout'
import { useMats } from './materials'

const COL_D = 0.5 // column depth (in the frame plane)
const COL_B = 0.3 // flange width

/** Map a sheet built in local (u, v, crown) into world space with u and v axes (n = u x v). */
function placeSheet(g: THREE.BufferGeometry, origin: V3, u: V3, v: V3) {
  const U = new THREE.Vector3(...u).normalize()
  const Vv = new THREE.Vector3(...v).normalize()
  const N = new THREE.Vector3().crossVectors(U, Vv).normalize()
  const m = new THREE.Matrix4().makeBasis(U, Vv, N).setPosition(...origin)
  g.applyMatrix4(m)
  return g
}

/** Columns, wind posts, trusses, purlins, girts and bracing. */
function Frame({ L, cutaway }: { L: HallLayout; cutaway: boolean }) {
  const { m } = useMats()
  const geos = useMemo(() => {
    const cols: THREE.BufferGeometry[] = []
    const steel: THREE.BufferGeometry[] = []
    const light: THREE.BufferGeometry[] = []
    const rods: THREE.BufferGeometry[] = []
    const colZ = [L.z0 + COL_D / 2 + 0.05, L.z1 - COL_D / 2 - 0.05]
    const colH = L.eaveH
    // Portal columns (I-sections, web in the frame plane) with base plates and bolts.
    for (const x of L.frameXs) {
      for (const z of colZ) {
        const c = extrudeY(iShape(COL_D, COL_B, 0.022, 0.013), colH)
        c.rotateY(Math.PI / 2)
        c.translate(x, 0, z)
        cols.push(c)
        cols.push(box(0.5, 0.03, 0.7, [x, 0.015, z]))
        for (const dx of [-0.18, 0.18]) for (const dz of [-0.28, 0.28]) cols.push(box(0.04, 0.06, 0.04, [x + dx, 0.05, z + dz]))
        // Knee haunch plate.
        steel.push(member([x, colH - 1.2, z], [x, colH - 0.4, z + (z < 0 ? 0.9 : -0.9)], 0.02, 0.35))
      }
    }
    // Gable wind posts every ~5 m.
    for (const x of [L.x0 + 0.2, L.x1 - 0.2]) {
      const n = Math.round(L.width / 5)
      for (let i = 1; i < n; i++) {
        const z = L.z0 + (i * L.width) / n
        const h = L.roofY(z) - 0.05
        const c = extrudeY(iShape(0.3, 0.2, 0.016, 0.01), h)
        c.translate(x, 0, z)
        cols.push(c)
      }
    }
    // Trusses: parallel-ish duo-pitch with Pratt webs.
    const zA = colZ[0] + COL_D / 2
    const zB = colZ[1] - COL_D / 2
    const bottomY = L.clearH + 0.09
    for (const x of L.frameXs) {
      const topAt = (z: number) => L.roofY(z) - 0.09
      steel.push(member([x, bottomY, zA], [x, bottomY, zB], 0.16, 0.18))
      steel.push(member([x, topAt(zA), zA], [x, topAt(L.ridgeZ), L.ridgeZ], 0.18, 0.18))
      steel.push(member([x, topAt(L.ridgeZ), L.ridgeZ], [x, topAt(zB), zB], 0.18, 0.18))
      const nPanels = Math.round((zB - zA) / 1.5)
      for (let i = 0; i <= nPanels; i++) {
        const z = zA + ((zB - zA) * i) / nPanels
        const zn = zA + ((zB - zA) * (i + 1)) / nPanels
        steel.push(member([x, bottomY + 0.09, z], [x, topAt(z) - 0.09, z], 0.08, 0.08))
        if (i < nPanels) {
          // Diagonals slope down towards mid-span (Pratt).
          const towardsMid = z < L.ridgeZ
          const a: V3 = towardsMid ? [x, topAt(z) - 0.09, z] : [x, bottomY + 0.09, z]
          const b: V3 = towardsMid ? [x, bottomY + 0.09, zn] : [x, topAt(zn) - 0.09, zn]
          steel.push(member(a, b, 0.07, 0.07))
        }
      }
      // Bottom-chord restraint bracing to the next frame is handled by purlin ties below.
    }
    // Purlins (lipped C) along X on the top chords, and wall girts.
    const pz: number[] = []
    for (let z = zA + 0.2; z < L.ridgeZ - 0.4; z += 1.5) pz.push(z)
    for (let z = zB - 0.2; z > L.ridgeZ + 0.4; z -= 1.5) pz.push(z)
    pz.push(L.ridgeZ - 0.3, L.ridgeZ + 0.3)
    for (const z of pz) {
      const g = extrudeX(cShape(0.2, 0.075, 0.004), L.length)
      g.translate(L.x0, L.roofY(z) + 0.1, z + (z < L.ridgeZ ? 0.04 : -0.04))
      light.push(g)
    }
    for (const y of [2.6, 4.6, 6.45, 7.75, 9.3]) {
      for (const [z, flip] of [
        [L.z0 + 0.05, 1],
        [L.z1 - 0.05, -1],
      ] as const) {
        const g = extrudeX(cShape(0.18, 0.07, 0.004), L.length)
        if (flip < 0) g.rotateX(Math.PI)
        g.translate(L.x0, y, z - flip * 0.0)
        light.push(g)
      }
    }
    // Gable girts.
    for (const x of [L.x0 + 0.05, L.x1 - 0.05]) {
      for (const y of [2.6, 4.6, 6.6, 8.6]) light.push(box(0.07, 0.18, L.width - 0.2, [x, y, L.ridgeZ]))
    }
    // Eaves beams.
    for (const z of colZ) light.push(box(L.length, 0.25, 0.15, [L.x0 + L.length / 2, L.eaveH + 0.05, z]))
    // Roof and wall X-bracing in the end bays and one middle bay.
    const bays = L.frameXs.length - 1
    const braced = [0, Math.floor(bays / 2), bays - 1]
    for (const bi of braced) {
      const xa = L.frameXs[bi]
      const xb = L.frameXs[bi + 1]
      const n = 4
      for (let i = 0; i < n; i++) {
        const za = zA + ((zB - zA) * i) / n
        const zb = zA + ((zB - zA) * (i + 1)) / n
        rods.push(rod([xa, L.roofY(za) - 0.05, za], [xb, L.roofY(zb) - 0.05, zb], 0.012, 6))
        rods.push(rod([xb, L.roofY(za) - 0.05, za], [xa, L.roofY(zb) - 0.05, zb], 0.012, 6))
      }
      for (const z of [colZ[0] - 0.15, colZ[1] + 0.15]) {
        rods.push(rod([xa, 0.4, z], [xb, L.eaveH - 0.3, z], 0.014, 6))
        rods.push(rod([xb, 0.4, z], [xa, L.eaveH - 0.3, z], 0.014, 6))
      }
    }
    // Longitudinal ties between bottom chords.
    for (const z of [L.ridgeZ - 7.5, L.ridgeZ, L.ridgeZ + 7.5]) {
      light.push(box(L.length, 0.06, 0.06, [L.x0 + L.length / 2, bottomY, z]))
    }
    return { cols: merge(cols), steel: merge(steel), light: merge(light), rods: merge(rods) }
  }, [L])
  return (
    <group>
      <M g={geos.cols} m={m.steelFrame} cast />
      {!cutaway && (
        <>
          <M g={geos.steel} m={m.steelFrame} receive={false} />
          <M g={geos.light} m={m.purlin} />
          <M g={geos.rods} m={m.steelDark} />
        </>
      )}
    </group>
  )
}

/** Plinth, cladding, clerestory window bands, roof sheet and rooflights. */
function Envelope({ L, cutaway }: { L: HallLayout; cutaway: boolean }) {
  const { m } = useMats()
  const geos = useMemo(() => {
    const walls: THREE.BufferGeometry[] = []
    const nearWalls: THREE.BufferGeometry[] = []
    const roof: THREE.BufferGeometry[] = []
    const sky: THREE.BufferGeometry[] = []
    const plinth: THREE.BufferGeometry[] = []
    const windows: THREE.BufferGeometry[] = []
    const mullions: THREE.BufferGeometry[] = []
    const P = L.plinthH
    const wTop = L.eaveH + 0.25
    const winY0 = 6.6
    const winY1 = 7.6
    const flat = () => wTop
    // Long walls: plinth, lower cladding, window band, upper cladding.
    for (const side of [0, 1]) {
      const z = side === 0 ? L.z0 - 0.06 : L.z1 + 0.06
      const origin: V3 = side === 0 ? [L.x0, 0, z] : [L.x1, 0, z]
      const u: V3 = side === 0 ? [1, 0, 0] : [-1, 0, 0]
      const W = side === 0 ? walls : nearWalls
      W.push(placeSheet(ribbedSheet(L.length, P, () => winY0), origin, u, [0, 1, 0]))
      W.push(placeSheet(ribbedSheet(L.length, winY1, flat), origin, u, [0, 1, 0]))
      plinth.push(boxM(L.length + 0.4, P, 0.2, [L.x0 + L.length / 2, P / 2, side === 0 ? L.z0 + 0.04 : L.z1 - 0.04]))
      if (side === 0) {
        windows.push(box(L.length, winY1 - winY0, 0.02, [L.x0 + L.length / 2, (winY0 + winY1) / 2, z]))
        for (let x = L.x0; x <= L.x1 + 1e-6; x += 1.75) mullions.push(box(0.06, winY1 - winY0, 0.08, [x, (winY0 + winY1) / 2, z + 0.03]))
        for (const y of [winY0, winY1]) mullions.push(box(L.length, 0.08, 0.1, [L.x0 + L.length / 2, y, z + 0.03]))
      } else {
        nearWalls.push(box(L.length, winY1 - winY0, 0.02, [L.x0 + L.length / 2, (winY0 + winY1) / 2, z]))
      }
    }
    // Gable walls with the loading door openings.
    const gable = (x: number, door: Door, side: 0 | 1) => {
      const top = (s: number) => L.roofY(side === 0 ? L.z1 - s : L.z0 + s) + 0.22
      // Local u runs -z on the x0 gable (from z1) and +z on the x1 gable (from z0).
      const toU = (z: number) => (side === 0 ? L.z1 - z : z - L.z0)
      const ua = Math.min(toU(door.z - door.w / 2), toU(door.z + door.w / 2))
      const ub = Math.max(toU(door.z - door.w / 2), toU(door.z + door.w / 2))
      const xx = side === 0 ? x - 0.06 : x + 0.06
      const origin = (s: number): V3 => (side === 0 ? [xx, 0, L.z1 - s] : [xx, 0, L.z0 + s])
      const u: V3 = side === 0 ? [0, 0, -1] : [0, 0, 1]
      const seg = (s0: number, s1: number, y0: number) => {
        walls.push(placeSheet(ribbedSheet(s1 - s0, y0, top, 0.25, 0.035, s0), origin(s0), u, [0, 1, 0]))
      }
      seg(0, ua, P)
      seg(ub, L.width, P)
      seg(ua, ub, door.h + 0.3)
      const zA = side === 0 ? L.z1 - ua : L.z0 + ua
      const zB = side === 0 ? L.z1 - ub : L.z0 + ub
      const px = side === 0 ? x + 0.04 : x - 0.04
      const span = (za: number, zb: number) => {
        const lo = Math.min(za, zb)
        const hi = Math.max(za, zb)
        if (hi - lo > 0.01) plinth.push(boxM(0.2, P, hi - lo, [px, P / 2, (lo + hi) / 2]))
      }
      span(L.z0, Math.min(zA, zB))
      span(Math.max(zA, zB), L.z1)
    }
    gable(L.x0, L.doorIn, 0)
    gable(L.x1, L.doorOut, 1)
    // Roof sheet (two slopes) with rooflight panels just beneath it.
    const tanP = (L.roofY(L.ridgeZ) - L.eaveH) / (L.width / 2)
    const slopeLen = Math.hypot(L.width / 2, L.width / 2 * tanP)
    const sheetY = (z: number) => L.roofY(z) + 0.2
    for (const side of [0, 1]) {
      const eaveZ = side === 0 ? L.z0 - 0.1 : L.z1 + 0.1
      const v: V3 = side === 0 ? [0, tanP, 1] : [0, tanP, -1]
      const origin: V3 = side === 0 ? [L.x1, sheetY(L.z0), eaveZ] : [L.x0, sheetY(L.z1), eaveZ]
      const u: V3 = side === 0 ? [-1, 0, 0] : [1, 0, 0]
      roof.push(placeSheet(ribbedSheet(L.length, 0, () => slopeLen + 0.12, 0.333, 0.04), origin, u, v))
      // Rooflights: panels between frames (not in end bays), two bands per slope.
      for (const band of [4.2, 10.2]) {
        for (let i = 1; i < L.frameXs.length - 2; i++) {
          const xa = L.frameXs[i] + 0.7
          const xb = L.frameXs[i + 1] - 0.7
          const vv = new THREE.Vector3(...v).normalize()
          const nrm = new THREE.Vector3(...u).cross(vv).normalize()
          const o = new THREE.Vector3(side === 0 ? xb : xa, sheetY(L.z0), eaveZ).addScaledVector(vv, band).addScaledVector(nrm, -0.012)
          sky.push(placeSheet(ribbedSheet(xb - xa, 0, () => 1.6, 0.333, 0.04), [o.x, o.y, o.z], u, v))
        }
      }
    }
    return {
      walls: merge(walls),
      nearWalls: merge(nearWalls),
      roof: merge(roof),
      sky: merge(sky),
      plinth: merge(plinth),
      windows: merge(windows),
      mullions: merge(mullions),
    }
  }, [L])
  return (
    <group>
      <M g={geos.walls} m={m.claddingInner} />
      {!cutaway && <M g={geos.nearWalls} m={m.claddingInner} />}
      {!cutaway && <M g={geos.roof} m={m.roofInner} receive={false} />}
      {!cutaway && <mesh geometry={geos.sky} material={m.skylight} />}
      <M g={geos.plinth} m={m.concrete} cast />
      <mesh geometry={geos.windows} material={m.windowBand} />
      <M g={geos.mullions} m={m.steelGrey} />
    </group>
  )
}

/** Insulated sectional door with tracks, spring shaft, frame and bollards. Local: opening in XY, interior +Z. */
function SectionalDoor({ door, side }: { door: Door; side: 0 | 1 }) {
  const { m } = useMats()
  const g = useMemo(() => {
    const { w, h } = door
    const panels: THREE.BufferGeometry[] = []
    const steel: THREE.BufferGeometry[] = []
    const yellow: THREE.BufferGeometry[] = []
    const black: THREE.BufferGeometry[] = []
    const glass: THREE.BufferGeometry[] = []
    const n = Math.round(h / 0.62)
    const sh = h / n
    for (let i = 0; i < n; i++) {
      const y = i * sh + sh / 2
      panels.push(box(w, sh - 0.012, 0.045, [0, y, 0.03]))
      // Micro-ribs on each section.
      for (const f of [-0.22, 0.22]) panels.push(box(w, 0.012, 0.012, [0, y + f * sh, 0.058]))
      if (i === n - 3) {
        for (let k = 0; k < 6; k++) {
          const x = -w / 2 + (w / 6) * (k + 0.5)
          glass.push(box(w / 6 - 0.25, sh * 0.45, 0.06, [x, y, 0.03]))
        }
      }
    }
    // Bottom rubber seal.
    black.push(box(w, 0.04, 0.06, [0, 0.02, 0.03]))
    // Vertical and horizontal tracks.
    for (const sx of [-1, 1]) {
      steel.push(box(0.08, h + 0.3, 0.12, [sx * (w / 2 + 0.06), (h + 0.3) / 2, 0.12]))
      steel.push(box(0.08, 0.12, 4.4, [sx * (w / 2 + 0.06), h + 0.45, 2.4]))
      steel.push(box(0.04, 3, 0.04, [sx * (w / 2 + 0.06), h + 2.0, 4.4]))
    }
    // Torsion spring shaft and drums.
    steel.push(rod([-w / 2, h + 0.55, 0.22], [w / 2, h + 0.55, 0.22], 0.025, 8))
    for (const sx of [-1, 1]) steel.push(rod([sx * (w / 2 - 0.05), h + 0.55, 0.22], [sx * (w / 2 - 0.25), h + 0.55, 0.22], 0.08, 12))
    // Operator motor box.
    steel.push(box(0.35, 0.45, 0.3, [w / 2 + 0.35, h + 0.4, 0.3]))
    // Frame (jamb angles and header).
    for (const sx of [-1, 1]) yellow.push(box(0.12, h, 0.14, [sx * (w / 2 + 0.17), h / 2, 0.08]))
    // Bollards with black bands.
    for (const sx of [-1, 1]) {
      const bx = sx * (w / 2 + 0.45)
      yellow.push(rod([bx, 0, 0.45], [bx, 1.1, 0.45], 0.08, 16))
      black.push(rod([bx, 0.6, 0.45], [bx, 0.75, 0.45], 0.082, 16))
      black.push(rod([bx, 0.9, 0.45], [bx, 1.0, 0.45], 0.082, 16))
    }
    // Chevron kick plates on the jambs.
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 5; k++) black.push(box(0.125, 0.06, 0.145, [sx * (w / 2 + 0.17), 0.15 + k * 0.2, 0.081], [0, 0, sx * 0.6]))
    }
    return {
      panels: merge(panels),
      steel: merge(steel),
      yellow: merge(yellow),
      black: merge(black),
      glass: merge(glass),
    }
  }, [door])
  const pos: V3 = [door.x + (side === 0 ? 0.0 : -0.0), 0, door.z]
  return (
    <group position={pos} rotation-y={side === 0 ? Math.PI / 2 : -Math.PI / 2}>
      <M g={g.panels} m={m.doorPanel} />
      <M g={g.steel} m={m.steelGrey} />
      <M g={g.yellow} m={m.safetyYellow} cast />
      <M g={g.black} m={m.safetyBlack} />
      <mesh geometry={g.glass} material={m.glass} />
    </group>
  )
}

/** Personnel doors (instanced pieces) with green running-exit lights above. */
function PersonnelDoors({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const parts = useMemo(() => {
    const leaf = merge([box(1.0, 2.1, 0.05, [0, 1.05, 0.03])])
    const frame = merge([
      box(0.08, 2.2, 0.12, [-0.54, 1.1, 0.04]),
      box(0.08, 2.2, 0.12, [0.54, 1.1, 0.04]),
      box(1.16, 0.08, 0.12, [0, 2.16, 0.04]),
      // Push bar and hinge-side kick plate.
      box(0.8, 0.05, 0.05, [0, 1.0, 0.1]),
      box(0.04, 0.05, 0.08, [-0.38, 1.0, 0.08]),
      box(0.04, 0.05, 0.08, [0.38, 1.0, 0.08]),
      box(0.95, 0.25, 0.01, [0, 0.13, 0.06]),
      // Closer arm.
      box(0.3, 0.06, 0.06, [-0.2, 2.05, 0.1]),
    ])
    const vision = merge([box(0.22, 0.6, 0.06, [0.2, 1.55, 0.03])])
    const sign = merge([box(0.42, 0.18, 0.05, [0, 2.45, 0.05])])
    // Pictogram: arrow + running figure abstraction (white shapes, no text).
    const arrow = new THREE.Shape()
    arrow.moveTo(-0.08, -0.025)
    arrow.lineTo(0.02, -0.025)
    arrow.lineTo(0.02, -0.055)
    arrow.lineTo(0.09, 0)
    arrow.lineTo(0.02, 0.055)
    arrow.lineTo(0.02, 0.025)
    arrow.lineTo(-0.08, 0.025)
    arrow.closePath()
    const pict = merge([
      new THREE.ShapeGeometry(arrow).translate(0.08, 2.45, 0.077),
      box(0.03, 0.03, 0.005, [-0.1, 2.5, 0.077]),
      box(0.025, 0.06, 0.005, [-0.1, 2.45, 0.077], [0, 0, 0.4]),
      box(0.02, 0.05, 0.005, [-0.12, 2.4, 0.077], [0, 0, -0.5]),
      box(0.02, 0.05, 0.005, [-0.07, 2.4, 0.077], [0, 0, 0.6]),
    ])
    return { leaf, frame, vision, sign, pict }
  }, [])
  const items = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    const xs = [L.x0 + L.bay * 1.5, L.x0 + L.bay * 4.5, L.x0 + L.bay * 7.5]
    for (const x of xs) out.push({ p: [x, 0, L.z1 - 0.12], r: [0, Math.PI, 0] })
    out.push({ p: [L.x0 + L.bay * 3.5, 0, L.z0 + 0.12], r: [0, 0, 0] })
    out.push({ p: [L.x1 - 0.12, 0, L.z1 - 4], r: [0, -Math.PI / 2, 0] })
    out.push({ p: [L.x0 + 0.12, 0, L.z1 - 4], r: [0, Math.PI / 2, 0] })
    return out
  }, [L])
  return (
    <group>
      <Inst geometry={parts.leaf} material={m.doorLeaf} items={items} />
      <Inst geometry={parts.frame} material={m.steelDark} items={items} />
      <Inst geometry={parts.vision} material={m.glass} items={items} />
      <Inst geometry={parts.sign} material={m.exitGlow} items={items} />
      <Inst geometry={parts.pict} material={m.signWhite} items={items} />
    </group>
  )
}

/** Yellow column guards at every portal column. */
function ColumnGuards({ L }: { L: HallLayout }) {
  const { m } = useMats()
  const g = useMemo(
    () =>
      merge([
        box(0.5, 1.0, 0.05, [0, 0.5, 0.3]),
        box(0.5, 1.0, 0.05, [0, 0.5, -0.3]),
        box(0.05, 1.0, 0.65, [0.27, 0.5, 0]),
        box(0.05, 1.0, 0.65, [-0.27, 0.5, 0]),
      ]),
    [],
  )
  const bands = useMemo(() => merge([box(0.6, 0.12, 0.7, [0, 0.35, 0]), box(0.6, 0.12, 0.7, [0, 0.75, 0])]), [])
  const items = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    for (const x of L.frameXs) {
      out.push({ p: [x, 0, L.z0 + COL_D / 2 + 0.05] })
      out.push({ p: [x, 0, L.z1 - COL_D / 2 - 0.05] })
    }
    return out
  }, [L])
  return (
    <group>
      <Inst geometry={g} material={m.safetyYellow} items={items} castShadow />
      <Inst geometry={bands} material={m.safetyBlack} items={items} />
    </group>
  )
}

export function Building({ L, cutaway = false }: { L: HallLayout; cutaway?: boolean }) {
  return (
    <group>
      <Frame L={L} cutaway={cutaway} />
      <Envelope L={L} cutaway={cutaway} />
      <SectionalDoor door={L.doorIn} side={0} />
      <SectionalDoor door={L.doorOut} side={1} />
      <PersonnelDoors L={L} />
      <ColumnGuards L={L} />
    </group>
  )
}
