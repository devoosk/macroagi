import { useMemo } from 'react'
import * as THREE from 'three'
import { rng } from '../../lib/rng'
import { box, boxM, member, merge } from './geometry'
import { Inst, type InstItem } from './Inst'
import type { HallLayout } from './layout'
import type { FloorPlan } from './Floor'
import { useMats } from './materials'

/** EUR pallet (1.2 x 0.8 x 0.144), long side along local z, origin at floor centre. */
function palletGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const t = 0.022
  // Top deck boards along z.
  for (const x of [-0.345, -0.17, 0, 0.17, 0.345]) parts.push(boxM(x === 0 || Math.abs(x) > 0.3 ? 0.145 : 0.1, t, 1.2, [x, 0.144 - t / 2, 0]))
  // Stringer boards across.
  for (const z of [-0.55, 0, 0.55]) parts.push(boxM(0.8, t, 0.145, [0, 0.1 - t / 2, z]))
  // Blocks.
  for (const x of [-0.33, 0, 0.33]) for (const z of [-0.55, 0, 0.55]) parts.push(boxM(0.145, 0.078, x === 0 ? 0.145 : 0.1, [x, 0.022 + 0.039, z]))
  // Bottom boards.
  for (const x of [-0.33, 0, 0.33]) parts.push(boxM(0.145, t, 1.2, [x, t / 2, 0]))
  return merge(parts)
}

interface Load {
  items: InstItem[]
  wraps: InstItem[]
}

/** Stack cardboard boxes on a pallet whose floor-centre is at p. Pallet top is +0.144. */
function stackLoad(r: () => number, p: [number, number, number], maxH: number, out: Load, rotY = 0) {
  const kind = r()
  const y0 = p[1] + 0.144
  const tint = () => {
    const v = 0.82 + r() * 0.2
    return new THREE.Color(v, v * (0.96 + r() * 0.04), v * (0.9 + r() * 0.08))
  }
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const place = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, j = 0.01) => {
    const jx = (r() - 0.5) * j
    const jz = (r() - 0.5) * j
    const wx = lx + jx
    const wz = lz + jz
    out.items.push({
      p: [p[0] + wx * cos + wz * sin, y0 + ly, p[2] - wx * sin + wz * cos],
      r: [0, rotY + (r() - 0.5) * 0.03, 0],
      s: [sx, sy, sz],
      c: tint(),
    })
  }
  if (kind < 0.35) {
    // 2 x 3 grid of medium cartons, 2-3 layers.
    const layers = Math.max(1, Math.min(3, Math.floor((maxH - 0.05) / 0.36)))
    const n = 1 + Math.floor(r() * layers)
    for (let l = 0; l < n; l++) for (const x of [-0.2, 0.2]) for (const z of [-0.4, 0, 0.4]) place(x, l * 0.36 + 0.17, z, 0.39, 0.34, 0.39)
    if (r() < 0.45) out.wraps.push({ p: [p[0], y0 + (n * 0.36) / 2, p[2]], r: [0, rotY, 0], s: [0.82, n * 0.36 + 0.02, 1.22] })
  } else if (kind < 0.7) {
    // One large carton (component, e.g. coil or casing set).
    const h = Math.min(maxH - 0.05, 0.6 + r() * 0.7)
    place(0, h / 2, 0, 0.78, h, 1.18, 0.02)
  } else if (kind < 0.9) {
    // Small cartons, mixed heights.
    const layers = Math.max(1, Math.min(4, Math.floor((maxH - 0.05) / 0.26)))
    for (const x of [-0.27, 0, 0.27]) {
      for (const z of [-0.45, -0.15, 0.15, 0.45]) {
        const n = 1 + Math.floor(r() * layers)
        for (let l = 0; l < n; l++) place(x, l * 0.26 + 0.125, z, 0.25, 0.24, 0.28, 0.02)
      }
    }
  } else {
    // Stretch-wrapped tall load.
    const h = Math.min(maxH - 0.05, 0.9 + r() * 0.5)
    place(0, h / 2, 0, 0.76, h, 1.16, 0.005)
    out.wraps.push({ p: [p[0], y0 + h / 2, p[2]], r: [0, rotY, 0], s: [0.8, h + 0.02, 1.2] })
  }
}

/** Selective pallet racking along the back wall plus the finished-goods staging area. */
function PalletRacking({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m } = useMats()
  const pitch = 2.8
  const levels = [0, 1.65, 3.3, 4.95]
  const H = 6.3
  const [zb, zf] = L.zones.rack
  const depth = zf - zb
  const zc = (zb + zf) / 2
  const rx0 = L.x0 + 8
  const nBays = Math.floor((L.x1 - 6 - rx0) / pitch)
  const geo = useMemo(() => {
    const upright = boxM(0.1, H, 0.08, [0, H / 2, 0])
    // Frame bracing (zig-zag between front and back uprights).
    const br: THREE.BufferGeometry[] = []
    const hz = depth / 2 - 0.04
    for (let y = 0.15; y < H - 0.6; y += 0.9) {
      br.push(member([0, y, -hz], [0, y + 0.9, hz], 0.04, 0.03))
      br.push(box(0.04, 0.03, depth - 0.08, [0, y, 0]))
    }
    br.push(box(0.04, 0.03, depth - 0.08, [0, H - 0.1, 0]))
    // Feet and front protectors handled separately.
    const brace = merge(br)
    const beam = box(pitch - 0.1, 0.12, 0.05)
    const guard = merge([box(0.18, 0.45, 0.04, [0, 0.225, 0.07]), box(0.04, 0.45, 0.14, [0.09, 0.225, 0]), box(0.04, 0.45, 0.14, [-0.09, 0.225, 0])])
    const endBarrier = merge([box(0.06, 0.4, depth + 0.3, [0, 0.3, 0]), box(0.12, 0.08, 0.12, [0, 0.04, -depth / 2 - 0.1]), box(0.12, 0.08, 0.12, [0, 0.04, depth / 2 + 0.1])])
    return { upright, brace, beam, guard, endBarrier, pallet: palletGeometry(), carton: new THREE.BoxGeometry(1, 1, 1), wrap: new THREE.BoxGeometry(1, 1, 1) }
  }, [depth])
  const data = useMemo(() => {
    const r = rng('env', 'racking')
    const uprights: InstItem[] = []
    const braces: InstItem[] = []
    const beams: InstItem[] = []
    const guards: InstItem[] = []
    const pallets: InstItem[] = []
    const load: Load = { items: [], wraps: [] }
    for (let i = 0; i <= nBays; i++) {
      const x = rx0 + i * pitch
      uprights.push({ p: [x, 0, zb + 0.04] }, { p: [x, 0, zf - 0.04] })
      braces.push({ p: [x, 0, zc] })
      guards.push({ p: [x, 0, zf + 0.02] })
    }
    for (let i = 0; i < nBays; i++) {
      const xc = rx0 + i * pitch + pitch / 2
      for (let li = 0; li < levels.length; li++) {
        const y = levels[li]
        if (li > 0) {
          beams.push({ p: [xc, y - 0.06, zf - 0.04] }, { p: [xc, y - 0.06, zb + 0.04] })
        }
        const maxH = (li < levels.length - 1 ? levels[li + 1] - 0.12 : H + 0.6) - y - 0.15
        for (const dx of [-0.88, 0, 0.88]) {
          if (r() < 0.16) continue
          const p: [number, number, number] = [xc + dx, y, zc + 0.03]
          pallets.push({ p, r: [0, (r() - 0.5) * 0.02, 0] })
          stackLoad(r, p, Math.min(maxH, 1.45), load)
        }
      }
    }
    // Finished goods staging: boxed heat-pump units on pallets, some double-stacked.
    const s = plan.staging
    for (let x = s.minX + 1.25; x < s.maxX - 0.5; x += 2.5) {
      for (const z of [s.minZ + 0.9, s.maxZ - 0.9]) {
        if (r() < 0.2) continue
        const stack = r() < 0.5 ? 2 : 1
        for (let k = 0; k < stack; k++) {
          const y = k * 1.2
          for (const dx of [-0.5, 0.5]) {
            const p: [number, number, number] = [x + dx + (r() - 0.5) * 0.04, y, z]
            pallets.push({ p, r: [0, Math.PI / 2 + (r() - 0.5) * 0.04, 0] })
            const v = 0.9 + r() * 0.1
            load.items.push({ p: [p[0], y + 0.144 + 0.52, z], r: [0, Math.PI / 2 + (r() - 0.5) * 0.02, 0], s: [0.78, 1.04, 1.18], c: new THREE.Color(v, v * 0.97, v * 0.92) })
            if (r() < 0.3) load.wraps.push({ p: [p[0], y + 0.144 + 0.52, z], r: [0, Math.PI / 2, 0], s: [0.8, 1.06, 1.2] })
          }
        }
      }
    }
    return { uprights, braces, beams, guards, pallets, load }
  }, [L, plan, nBays, rx0, zb, zf, zc])
  const ends = useMemo<InstItem[]>(() => [{ p: [rx0 - 0.25, 0, zc] }, { p: [rx0 + nBays * pitch + 0.25, 0, zc] }], [rx0, nBays, zc])
  return (
    <group>
      <Inst geometry={geo.upright} material={m.rackUpright} items={data.uprights} castShadow />
      <Inst geometry={geo.brace} material={m.rackUpright} items={data.braces} />
      <Inst geometry={geo.beam} material={m.rackBeam} items={data.beams} castShadow />
      <Inst geometry={geo.guard} material={m.safetyYellow} items={data.guards} />
      <Inst geometry={geo.endBarrier} material={m.safetyYellow} items={ends} castShadow />
      <Inst geometry={geo.pallet} material={m.wood} items={data.pallets} castShadow />
      <Inst geometry={geo.carton} material={m.cardboard} items={data.load.items} castShadow />
      <Inst geometry={geo.wrap} material={m.wrap} items={data.load.wraps} receiveShadow={false} />
    </group>
  )
}

/** Gravity flow racks (line-side supermarket) with coloured bins, on the far side of the line. */
function FlowRacks({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  const { m, binColors } = useMats()
  const b = L.bounds
  const [zBack, zFront] = L.zones.flowRack
  const depth = zFront - zBack
  const modW = 2.4
  const lanes = 6
  const shelves = [0.42, 0.92, 1.42]
  const drop = 0.22
  const slope = Math.atan2(drop, depth)
  const modules = useMemo(() => {
    const xs: number[] = []
    for (let x = b.minX - 1.0; x + modW <= b.maxX + 1.0; x += modW + 0.1) {
      const xc = x + modW / 2
      if (plan.crossings.some((c) => Math.abs(c - xc) < modW / 2 + 1.3)) continue
      xs.push(xc)
    }
    return xs
  }, [b.minX, b.maxX, plan.crossings])
  const geo = useMemo(() => {
    // Frame: four posts, side rails per shelf, top return shelf rails.
    const fr: THREE.BufferGeometry[] = []
    const hw = modW / 2
    for (const sx of [-hw, hw]) {
      for (const z of [zBack, zFront]) fr.push(box(0.045, 2.05, 0.045, [sx, 1.025, z - (zBack + zFront) / 2]))
      fr.push(box(0.045, 0.045, depth, [sx, 0.1, 0]))
      fr.push(member([sx, 0.15, -depth / 2], [sx, 1.9, depth / 2], 0.03, 0.03))
    }
    const zc0 = -depth / 2
    for (const y of shelves) {
      for (const sx of [-hw + 0.03, hw - 0.03]) fr.push(member([sx, y + drop, zc0], [sx, y, zc0 + depth], 0.04, 0.05))
      // Front stop bar.
      fr.push(box(modW, 0.04, 0.03, [0, y + 0.05, depth / 2 - 0.02]))
    }
    // Top empties-return shelf (slopes the other way) and top cross members.
    for (const sx of [-hw + 0.03, hw - 0.03]) fr.push(member([sx, 1.86, zc0], [sx, 1.98, zc0 + depth], 0.04, 0.05))
    for (const z of [zc0, -zc0]) fr.push(box(modW, 0.045, 0.045, [0, 2.04, z]))
    const frame = merge(fr)
    const track = box(0.03, 0.025, depth, [0, 0, 0])
    // Bin: open-top hopper-front tote (0.3 w x 0.18 h x 0.4 d), origin at bottom centre, front +z.
    const bw = 0.3
    const bh = 0.18
    const bd = 0.4
    const t = 0.006
    const sideShape = new THREE.Shape()
    sideShape.moveTo(-bd / 2, 0)
    sideShape.lineTo(bd / 2, 0)
    sideShape.lineTo(bd / 2, bh * 0.55)
    sideShape.lineTo(bd / 2 - 0.08, bh)
    sideShape.lineTo(-bd / 2, bh)
    sideShape.closePath()
    const side = (x: number) => {
      const g = new THREE.ExtrudeGeometry(sideShape, { depth: t, bevelEnabled: false })
      g.rotateY(-Math.PI / 2)
      g.translate(x + t / 2, 0, 0)
      return g
    }
    const bin = merge([
      box(bw, t, bd, [0, t / 2, 0]),
      box(bw, bh, t, [0, bh / 2, -bd / 2 + t / 2]),
      box(bw, bh * 0.55, t, [0, (bh * 0.55) / 2, bd / 2 - t / 2]),
      side(-bw / 2 + t / 2),
      side(bw / 2 - t / 2),
      // Rim.
      box(bw + 0.01, 0.012, 0.012, [0, bh, -bd / 2]),
    ])
    const label = box(0.12, 0.05, 0.004, [0, bh * 0.3, bd / 2 + 0.002])
    const part = new THREE.BoxGeometry(1, 1, 1)
    return { frame, track, bin, label, part }
  }, [depth, zBack, zFront])
  const data = useMemo(() => {
    const r = rng('env', 'flowrack')
    const frames: InstItem[] = []
    const tracks: InstItem[] = []
    const bins: InstItem[] = []
    const labels: InstItem[] = []
    const parts: InstItem[] = []
    const zMid = (zBack + zFront) / 2
    const laneW = modW / lanes
    for (const xc of modules) {
      frames.push({ p: [xc, 0, zMid] })
      const shelfColors = shelves.map(() => binColors[Math.floor(r() * binColors.length)])
      shelves.forEach((y0, si) => {
        for (let li = 0; li < lanes; li++) {
          const x = xc - modW / 2 + laneW * (li + 0.5)
          for (const dx of [-0.11, 0.11]) tracks.push({ p: [x + dx, y0 + drop / 2 + 0.01, zMid], r: [slope, 0, 0] })
          const color = r() < 0.75 ? shelfColors[si] : binColors[Math.floor(r() * binColors.length)]
          const nBins = r() < 0.15 ? 1 : r() < 0.5 ? 2 : 3
          for (let k = 0; k < nBins; k++) {
            const dz = depth / 2 - 0.24 - k * 0.43
            const z = zMid + dz
            const y = y0 + drop * (0.5 - dz / depth) + 0.03
            bins.push({ p: [x, y, z], r: [slope, 0, 0], c: color })
            if (k === 0) {
              labels.push({ p: [x, y, z], r: [slope, 0, 0] })
              // Parts visible in the front bin.
              const fill = Math.floor(r() * 5)
              for (let q = 0; q < fill; q++) {
                const sx = 0.05 + r() * 0.07
                parts.push({
                  p: [x + (r() - 0.5) * 0.16, y + 0.03 + q * 0.012, z + (r() - 0.5) * 0.22],
                  r: [slope, r() * Math.PI, 0],
                  s: [sx, 0.03 + r() * 0.04, sx * (0.6 + r())],
                })
              }
            }
          }
        }
      })
      // Empties on the top return shelf.
      for (let li = 0; li < lanes; li += 2) {
        if (r() < 0.4) continue
        const x = xc - modW / 2 + laneW * (li + 0.5)
        bins.push({ p: [x, 1.94, zMid - 0.25], r: [-Math.atan2(0.12, depth), Math.PI, 0], c: binColors[Math.floor(r() * binColors.length)] })
      }
    }
    return { frames, tracks, bins, labels, parts }
  }, [modules, binColors, zBack, zFront, depth, slope])
  return (
    <group>
      <Inst geometry={geo.frame} material={m.aluProfile} items={data.frames} castShadow />
      <Inst geometry={geo.track} material={m.roller} items={data.tracks} />
      <Inst geometry={geo.bin} material={m.bin} items={data.bins} castShadow />
      <Inst geometry={geo.label} material={m.signWhite} items={data.labels} />
      <Inst geometry={geo.part} material={m.partGrey} items={data.parts} />
    </group>
  )
}

export function Storage({ L, plan }: { L: HallLayout; plan: FloorPlan }) {
  return (
    <group>
      <PalletRacking L={L} plan={plan} />
      <FlowRacks L={L} plan={plan} />
    </group>
  )
}
