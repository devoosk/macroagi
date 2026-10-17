import { memo, useMemo } from 'react'
import type { Station } from '../../contracts/types'
import { Static } from '../batch'
import { M, lampMat } from './lib/mats'
import { B, C, CX, Inst, boxGeo, cylGeo, type InstItem } from './lib/prims'

/** Powered roller conveyor. Conveyor top (roller tops) at y = 0.85; centreline z = 0 in section-local coords. */

export const CONV_TOP = 0.85
const ROLLER_R = 0.025
const PITCH = 0.12
const HALF_W = 0.42 // side frame offset from centreline
const ROLLER_L = 0.78

/** Straight roller section along local +x, centred on origin. */
export const RollerSection = memo(function RollerSection({ len, legs = true, guides = true }: { len: number; legs?: boolean; guides?: boolean }) {
  const rollers = useMemo<InstItem[]>(() => {
    const n = Math.max(1, Math.floor(len / PITCH))
    const start = -((n - 1) * PITCH) / 2
    return Array.from({ length: n }, (_, i) => ({ p: [start + i * PITCH, CONV_TOP - ROLLER_R, 0], r: [Math.PI / 2, 0, 0] }))
  }, [len])
  const rollerHubs = useMemo<InstItem[]>(() => rollers.flatMap((r) => [-1, 1].map((s) => ({ p: [r.p[0], r.p[1], s * (HALF_W - 0.035)], r: r.r }))), [rollers])
  const legItems = useMemo<InstItem[]>(() => {
    if (!legs) return []
    const n = Math.max(2, Math.ceil(len / 1.5) + 1)
    const out: InstItem[] = []
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.05 + (i * (len - 0.1)) / (n - 1)
      for (const s of [-1, 1]) out.push({ p: [x, (CONV_TOP - 0.1) / 2, s * (HALF_W - 0.02)] })
    }
    return out
  }, [len, legs])
  const feet = useMemo<InstItem[]>(() => legItems.map((l) => ({ p: [l.p[0], 0.006, l.p[2]] })), [legItems])
  const braces = useMemo<InstItem[]>(() => legItems.filter((_, i) => i % 2 === 0).map((l) => ({ p: [l.p[0], 0.22, 0] })), [legItems])
  return (
    <group>
      <Inst g={cylGeo(ROLLER_R, ROLLER_R, ROLLER_L, 16)} m={M.galv} items={rollers} />
      <Inst g={cylGeo(ROLLER_R * 1.08, ROLLER_R * 1.08, 0.02, 16)} m={M.plasticDark} items={rollerHubs} cast={false} />
      {/* side frames: aluminium profiles with slot shadow lines */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[len, 0.12, 0.04]} p={[0, CONV_TOP - 0.05, s * HALF_W]} m={M.alu} />
          <B s={[len, 0.008, 0.002]} p={[0, CONV_TOP - 0.03, s * (HALF_W + 0.021)]} m={M.aluDark} cast={false} />
          <B s={[len, 0.008, 0.002]} p={[0, CONV_TOP - 0.08, s * (HALF_W + 0.021)]} m={M.aluDark} cast={false} />
          {guides && <B s={[len, 0.03, 0.012]} p={[0, CONV_TOP + 0.035, s * (HALF_W - 0.01)]} m={M.palletWear} />}
          {guides && <B s={[len, 0.008, 0.03]} p={[0, CONV_TOP + 0.016, s * (HALF_W - 0.002)]} m={M.alu} />}
        </group>
      ))}
      {/* drive belt cover under the rollers on the far side */}
      <B s={[len, 0.05, 0.06]} p={[0, CONV_TOP - 0.13, -HALF_W + 0.05]} m={M.ral7016} />
      {legs && (
        <>
          <Inst g={boxGeo(0.05, CONV_TOP - 0.1, 0.05, 0.004)} m={M.alu} items={legItems} />
          <Inst g={boxGeo(0.12, 0.012, 0.12)} m={M.steelDark} items={feet} />
          <Inst g={boxGeo(0.04, 0.04, HALF_W * 2 - 0.04)} m={M.alu} items={braces} />
        </>
      )}
    </group>
  )
})

/** Drive motor + gearbox hung under the conveyor frame (far side). */
const DriveUnit = memo(function DriveUnit() {
  return (
    <group position={[0, CONV_TOP - 0.22, -HALF_W - 0.13]}>
      <B s={[0.18, 0.16, 0.16]} rad={0.01} m={M.ral5010} />
      <CX rt={0.07} h={0.24} p={[-0.2, 0, 0]} m={M.ral5010} seg={24} />
      {Array.from({ length: 6 }, (_, i) => <B key={i} s={[0.2, 0.004, 0.15]} p={[-0.2, -0.05 + i * 0.02, 0]} m={M.ral5010} />)}
      <B s={[0.08, 0.06, 0.06]} p={[0, 0.11, 0]} m={M.ral7016} />
      <B s={[0.12, 0.2, 0.012]} p={[0.0, 0.1, 0.09]} m={M.ral1003} />
    </group>
  )
})

/** Pneumatic pallet stop with sensor, at section-local x. */
const PalletStop = memo(function PalletStop() {
  return (
    <group>
      <B s={[0.07, 0.14, 0.07]} p={[0, CONV_TOP - 0.15, 0]} m={M.alu} />
      <C rt={0.012} h={0.08} p={[0, CONV_TOP - 0.05, 0]} m={M.chrome} seg={12} />
      <B s={[0.03, 0.05, 0.1]} rad={0.004} p={[0, CONV_TOP + 0.0, 0]} m={M.palletWear} />
      <C rt={0.006} h={0.08} p={[0, CONV_TOP - 0.17, 0.05]} r={[Math.PI / 2, 0, 0]} m={M.plasticBlue} seg={8} />
      {/* proximity sensor on the far rail */}
      <group position={[0.06, CONV_TOP - 0.02, -HALF_W + 0.02]}>
        <C rt={0.009} h={0.05} r={[Math.PI / 2, 0, 0]} m={M.chrome} seg={10} />
        <C rt={0.006} h={0.008} p={[0, 0, -0.03]} r={[Math.PI / 2, 0, 0]} m={lampMat('amber', true)} seg={10} />
      </group>
    </group>
  )
})

/** Short belt transfer (cross conveyor) between main line and a buffer lane, along local z. */
const Transfer = memo(function Transfer({ len }: { len: number }) {
  return (
    <group>
      {[-0.12, 0.12].map((x) => (
        <group key={x}>
          <B s={[0.05, 0.03, len]} p={[x, CONV_TOP - 0.01, -len / 2]} m={M.rubber} />
          <B s={[0.07, 0.08, len]} p={[x, CONV_TOP - 0.065, -len / 2]} m={M.alu} />
        </group>
      ))}
      <B s={[0.3, 0.1, 0.1]} p={[0, CONV_TOP - 0.2, -len / 2]} m={M.ral5010} />
    </group>
  )
})

interface Seg {
  cx: number
  cz: number
  len: number
  ang: number
}

function segment(x0: number, z0: number, x1: number, z1: number): Seg {
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, len: Math.hypot(x1 - x0, z1 - z0), ang: -Math.atan2(z1 - z0, x1 - x0) }
}

/** Continuous conveyor from before the first station to past the last, with stops, drives and buffer lanes. */
export function ConveyorLine({ stations }: { stations: Station[] }) {
  const data = useMemo(() => {
    if (stations.length === 0) return null
    const pts = stations.map((s) => [s.x, s.y] as [number, number])
    const first = pts[0]
    const last = pts[pts.length - 1]
    const d0 = pts.length > 1 ? norm(pts[1][0] - first[0], pts[1][1] - first[1]) : [1, 0]
    const d1 = pts.length > 1 ? norm(last[0] - pts[pts.length - 2][0], last[1] - pts[pts.length - 2][1]) : [1, 0]
    const path: [number, number][] = [[first[0] - d0[0] * 2.2, first[1] - d0[1] * 2.2], ...pts, [last[0] + d1[0] * 2.2, last[1] + d1[1] * 2.2]]
    const segs: Seg[] = []
    for (let i = 0; i < path.length - 1; i++) {
      const s = segment(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])
      if (s.len > 0.05) segs.push(s)
    }
    const buffers: (Seg & { n: number })[] = []
    stations.forEach((s, i) => {
      if (i === 0 || s.bufferBefore <= 1) return
      const p = stations[i - 1]
      const sg = segment(p.x, p.y, s.x, s.y)
      buffers.push({ ...sg, n: s.bufferBefore })
    })
    return { segs, buffers }
  }, [stations])
  if (!data) return null
  return (
    <Static>
      {data.segs.map((s, i) => (
        <group key={i} position={[s.cx, 0, s.cz]} rotation={[0, s.ang, 0]}>
          <RollerSection len={s.len + 0.002} />
          {i % 2 === 0 && <DriveUnit />}
        </group>
      ))}
      {stations.map((s) => (
        <group key={s.id} position={[s.x, 0, s.y]} rotation={[0, s.rot, 0]}>
          <group position={[0.78, 0, 0]}>
            <PalletStop />
          </group>
        </group>
      ))}
      {data.buffers.map((b, i) => {
        const lane = Math.max(1.0, Math.min(b.len - 3.4, 0.5 + b.n * 0.25))
        return (
          <group key={'b' + i} position={[b.cx, 0, b.cz]} rotation={[0, b.ang, 0]}>
            {/* parallel buffer lane on the far side, fed by two belt transfers */}
            <group position={[0, 0, -1.05]}>
              <RollerSection len={lane} />
            </group>
            {[-1, 1].map((sx) => (
              <group key={sx} position={[sx * (lane / 2 - 0.2), 0, 0]}>
                <Transfer len={1.05} />
              </group>
            ))}
          </group>
        )
      })}
    </Static>
  )
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1
  return [x / l, z / l]
}
