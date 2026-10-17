import { Line as DLine } from '@react-three/drei'
import { useMemo } from 'react'
import type { Line, Station } from '../contracts/types'
import { stationWorld } from '../lib/layout'
import { useT } from './clock'
import { boxGeo, CellGuard, cylGeo, Edged, Humanoid, Person, RobotArm } from './prims'
import { T, ease, hash, lerp, night, pulse, seg } from './theme'

const TEST = new Set(['evacuation_leak_test', 'run_test'])
const M = T.morph[0]

/** The machine at a station, by kind, in line art. */
function Machine({ kind, opacity, glow }: { kind: string; opacity: number; glow: number }) {
  if (TEST.has(kind))
    return (
      <>
        <Edged geometry={boxGeo(1.8, 2.1, 1.1)} position={[0, 0, -1.2]} opacity={opacity} glow={glow} />
        <Edged geometry={boxGeo(1.2, 0.5, 0.05)} position={[0, 1.3, -0.62]} opacity={opacity} glow={glow} />
      </>
    )
  if (kind === 'brazing')
    return (
      <>
        <Edged geometry={boxGeo(2.4, 0.9, 1.1)} position={[0, 0, -1.2]} opacity={opacity} glow={glow} />
        <Edged geometry={cylGeo(0.22, 1.3)} position={[0.9, 0.9, -1.4]} opacity={opacity} glow={glow} />
        <Edged geometry={cylGeo(0.22, 1.3)} position={[0.4, 0.9, -1.4]} opacity={opacity} glow={glow} />
      </>
    )
  if (kind === 'kitting' || kind === 'packing')
    return (
      <>
        <Edged geometry={boxGeo(1.1, 1.4, 1.0)} position={[-0.7, 0, -1.2]} opacity={opacity} glow={glow} />
        <Edged geometry={boxGeo(1.1, 0.9, 1.0)} position={[0.6, 0, -1.2]} opacity={opacity} glow={glow} />
      </>
    )
  return (
    <>
      <Edged geometry={boxGeo(2.4, 0.9, 1.1)} position={[0, 0, -1.2]} opacity={opacity} glow={glow} />
      <Edged geometry={boxGeo(0.6, 0.35, 0.4)} position={[-0.6, 0.9, -1.3]} opacity={opacity} glow={glow} />
    </>
  )
}

/** Who works a station: a person, or the rented robot type. */
function Worker({ s, opacity, rise, phase, glow }: { s: Station; opacity: number; rise: number; phase: number; glow: number }) {
  if (s.staff !== 'robot') return <Person position={[0, 0, 0.95]} opacity={opacity} sink={1 - rise} />
  if (s.robot === 'humanoid') return <Humanoid position={[0, 0, 0.95]} opacity={opacity} rise={rise} phase={phase} glow={glow} />
  return <RobotArm position={[0, 0.08, 0.95]} opacity={opacity} rise={rise} phase={phase} glow={glow} />
}

/** Floor-wide look: dims in the analysis beats, the turn and the ending; the focus beat burns the bottlenecks. */
function floorLook(t: number) {
  let opacity = 1 - 0.75 * pulse(t, T.turn[0] - 0.2, T.turn[1] + 0.3, 0.5)
  opacity *= 1 - 0.55 * seg(t, T.feeds[0] - 0.5, T.feeds[0] + 0.5) * (1 - seg(t, T.graph[1] - 2, T.graph[1]))
  opacity *= 1 - 0.75 * seg(t, T.swarm[0], T.swarm[0] + 1) * (1 - seg(t, M - 0.8, M))
  opacity *= 1 - seg(t, T.world[0] + 1, T.world[0] + 3)
  return { opacity, focus: pulse(t, T.focus[0], T.swarm[0] + 1.5, 0.8) }
}

/** Old station i folds away toward the new station that replaces it. */
const foldK = (t: number, i: number) => ease(seg(t, M + 0.2 + i * 0.1, M + 1.5 + i * 0.1))
/** New station j rises in its place. */
const riseK = (t: number, j: number) => ease(seg(t, M + 0.9 + j * 0.16, M + 2.1 + j * 0.16))

function OldStation({ s, i, wave, target, t, bottleneck }: { s: Station; i: number; wave?: Station; target?: number; t: number; bottleneck: boolean }) {
  const l = floorLook(t)
  const k = foldK(t, i)
  if (k >= 1) return null
  const glow = bottleneck ? l.focus * (0.6 + 0.4 * Math.sin(t * 6)) : 0
  const op = l.opacity * (bottleneck ? 1 : 1 - 0.7 * l.focus) * (1 - k)
  const [x, , z] = stationWorld(s)
  // Wave one (beat 1): a robot drops in where the person stood; the line looks and moves the same.
  const drop = wave?.staff === 'robot' ? ease(seg(t, T.today[0] + 1 + (i % 6) * 0.35, T.today[0] + 1.7 + (i % 6) * 0.35)) : 0
  const waveOut = seg(t, T.turn[0], T.turn[0] + 1.2)
  const w = drop * (1 - waveOut)
  return (
    <group position={[lerp(x, target ?? x, k), 0, z]} scale={[1 - 0.6 * k, 1 - 0.8 * k, 1 - 0.6 * k]}>
      <Machine kind={s.kind} opacity={op} glow={glow} />
      <Person position={[0, 0, 0.95]} opacity={op * (1 - w)} />
      {w > 0.001 && <RobotArm position={[0, 6 * (1 - drop), 0.95]} opacity={op * (1 - waveOut)} phase={t * 3 + i} />}
    </group>
  )
}

function NewStation({ s, j, t }: { s: Station; j: number; t: number }) {
  const l = floorLook(t)
  const k = riseK(t, j)
  if (k <= 0) return null
  const op = l.opacity * k
  const [x, , z] = stationWorld(s)
  const cell = s.kind === ('robot_cell' as string) || s.staff === 'robot'
  const bays = Math.max(1, s.bays ?? 1)
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: bays }, (_, b) => (
        <group key={b} position={[0, 0, -3.1 * b * ease(seg(k, 0.4, 1))]} scale={[1, Math.max(0.001, k), 1]}>
          {cell ? <CellGuard opacity={op} glow={0.15} /> : <Machine kind={s.kind} opacity={op} glow={0} />}
          {cell && <Edged geometry={boxGeo(1.6, 0.8, 0.9)} position={[0, 0.08, -0.7]} opacity={op} />}
          <Worker s={s} opacity={op} rise={k} phase={t * 3 + j} glow={0.15} />
        </group>
      ))}
    </group>
  )
}

/** Walk and search waste: a person pacing a dashed loop. Vanishes when the redesign eliminates it. */
function Waste({ x, t, opacity }: { x: number; t: number; opacity: number }) {
  const n = 10
  if (opacity < 0.01) return null
  return (
    <group position={[x, 0.02, 2.4]}>
      {Array.from({ length: n }, (_, j) => {
        const a = (j / n) * Math.PI * 2 + t * 0.8
        return <Edged key={j} geometry={boxGeo(0.25, 0.02, 0.08)} position={[Math.cos(a) * 1.1, 0, Math.sin(a) * 0.6]} rotation={[0, -a, 0]} opacity={opacity} />
      })}
    </group>
  )
}

/**
 * The factory floor in MicroAGI-style line art. Beat 1 shows today's line and wave one
 * (robots where people stood, from the best rebalance design). Beat 3 folds the old
 * stations into the stations that replace them (rebuild `replaces`) and raises the new line.
 */
export function Floor({ line, waveOne, redesign, bottlenecks }: { line: Line; waveOne: Line; redesign: Line; bottlenecks: string[] }) {
  const t = useT()
  const b = useMemo(() => new Set(bottlenecks), [bottlenecks])
  const waveById = useMemo(() => new Map(waveOne.stations.map((s) => [s.id, s])), [waveOne])
  const serial = useMemo(() => redesign.stations.filter((s) => !s.offline), [redesign])
  /** Old station → x of the first new station that replaces it (same id when the design keeps it). */
  const target = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of serial) {
      if (!s.replaces?.length) m.set(s.id, s.x)
      for (const r of s.replaces ?? []) if (!m.has(r)) m.set(r, s.x)
    }
    return m
  }, [serial])
  const wasteStations = useMemo(() => {
    const gone = new Set(redesign.operations.filter((o) => o.mode === 'eliminated').map((o) => o.id))
    return line.stations.filter((s) => s.operations.some((o) => gone.has(o)))
  }, [line, redesign])
  const fb = redesign.stations.find((s) => s.offline)
  const show = t > T.today[0] - 1 && t < T.world[1] - 5.5
  if (!show) return null
  const l = floorLook(t)
  const rise = ease(seg(t, T.today[0] - 1, T.today[0] + 0.4))
  const span0 = Math.max(...line.stations.map((s) => s.x)) + 7
  const span1 = Math.max(...serial.map((s) => s.x)) + 7
  const shrink = ease(seg(t, M + 1, M + 2.6))
  const span = lerp(span0, span1, shrink)
  const cx = span / 2 - 3.5
  // Units flow at the same pace through beat 1 (nothing changes), twice as fast on the new line.
  const dist = 2.2 * t + 2.2 * Math.max(0, t - M - 3)
  const convOp = l.opacity * (1 - 0.6 * l.focus)
  const links = pulse(t, M + 0.4, M + 3.2, 0.5)
  const lineCol = night(t) > 0.5 ? '#ffffff' : '#1a1a1a'
  return (
    <group scale={[1, rise, 1]}>
      <Edged geometry={boxGeo(1, 0.25, 10.5)} position={[cx, -0.25, -1.4]} scale={[span, 1, 1]} opacity={l.opacity} />
      <Edged geometry={boxGeo(1, 0.75, 0.7)} position={[cx, 0, 0]} scale={[span - 4, 1, 1]} opacity={convOp} />
      {Array.from({ length: 14 }, (_, i) => {
        const u = (((dist + i * 4.1) % span) + span) % span - 3
        const w = 0.5 + 0.2 * hash(i)
        return <Edged key={i} geometry={boxGeo(w, w * 0.9, w)} position={[u, 0.75, 0]} opacity={convOp} />
      })}
      {line.stations.map((s, i) => (
        <OldStation key={s.id} s={s} i={i} wave={waveById.get(s.id)} target={target.get(s.id)} t={t} bottleneck={b.has(s.id)} />
      ))}
      {links > 0.01 &&
        serial.flatMap((s) =>
          (s.replaces ?? []).map((r) => {
            const o = line.stations.find((x) => x.id === r)
            if (!o) return null
            return <DLine key={`${s.id}-${r}`} points={[[o.x, 1.2, 0.2], [(o.x + s.x) / 2, 3.2, 0.2], [s.x, 1.2, 0.2]]} color={lineCol} lineWidth={1.2} dashed dashSize={0.2} gapSize={0.15} transparent opacity={links * 0.8} />
          }),
        )}
      {serial.map((s, j) => (
        <NewStation key={s.id} s={s} j={j} t={t} />
      ))}
      {wasteStations.map((s) => (
        <Waste key={s.id} x={s.x} t={t + s.x} opacity={l.opacity * (1 - foldK(t, line.stations.indexOf(s))) * (1 - 0.7 * l.focus)} />
      ))}
      {fb && <NewStation s={fb} j={serial.length} t={t} />}
    </group>
  )
}
