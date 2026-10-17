import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D } from 'three'
import { getT, useT } from './clock'
import type { StoryData } from './data'
import { UPPER_Y } from './layout'
import { boxGeo, Edged } from './prims'
import { T, ease, easeOut, hash, lerp, seg } from './theme'

const S = T.swarm[0]
/** Phases inside the swarm beat. */
const P = { rain: [S + 0.2, S + 4.2], front: [S + 4.4, S + 5.6], win: [S + 5.6, S + 6.8], go: [S + 6.8, S + 8] } as const
const o3 = new Object3D()
const col = new Color()

interface Pt {
  x: number
  z: number
  ok: boolean
  arrive: number
  front: boolean
  win: number // -1, or winner rank 0..2
}

export function useSwarm(story: StoryData) {
  return useMemo(() => {
    const sw = story.swarm
    const all = [...sw.points, { ...sw.current, ok: false }]
    // Rank-based axes spread the field evenly; order (cheaper left, faster front) is what the eye reads.
    const q = (vals: number[]) => {
      const sorted = [...vals].sort((a, b) => a - b)
      return (v: number) => {
        let lo = 0
        let hi = sorted.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (sorted[mid] < v) lo = mid + 1
          else hi = mid
        }
        return lo / sorted.length
      }
    }
    const qc = q(all.map((p) => p.cost))
    const qr = q(all.map((p) => p.rate))
    const X = (c: number) => lerp(3, 48, qc(c))
    const Z = (r: number) => lerp(4.2, -4.2, qr(r))
    const ok = sw.points.filter((p) => p.ok)
    const front = (p: (typeof ok)[number]) => p.ok && !ok.some((q) => q !== p && q.cost <= p.cost && q.rate >= p.rate && (q.cost < p.cost || q.rate > p.rate))
    const n = sw.points.length
    const order = sw.points.map((_, i) => i).sort((a, b) => hash(a + 0.5) - hash(b + 0.5))
    const rank = new Array<number>(n)
    order.forEach((i, k) => (rank[i] = k))
    const pts: Pt[] = sw.points.map((p, i) => {
      const w = typeof (p as { winner?: number }).winner === 'number' ? (p as { winner?: number }).winner! : -1
      // Arrivals accelerate: a trickle, then a flood.
      return { x: X(p.cost), z: lerp(4.2, -4.2, 0.35 * qr(p.rate) + 0.65 * hash(i * 13 + 1)), ok: p.ok, arrive: P.rain[0] + (P.rain[1] - P.rain[0] - 0.4) * Math.pow(rank[i] / n, 0.55), front: front(p), win: w }
    })
    return { pts, current: { x: X(sw.current.cost), z: Z(sw.current.rate) }, evaluated: sw.evaluated }
  }, [story])
}

/** Where winner `w` sits at time t (it lifts, then the best one dives to the floor). */
export function winnerAt(p: { x: number; z: number }, w: number, t: number): [number, number, number] {
  const lift = ease(seg(t, P.win[0], P.win[1]))
  const dive = w === 0 ? ease(seg(t, P.go[0], P.go[1])) : 0
  return [lerp(p.x, 25.5, dive), lerp(UPPER_Y + 0.2 + lift * (1.6 + w * 0.5), 1.2, dive), lerp(p.z, 0, dive)]
}

/** Beat 2d: thousands of real scored line variants rain down; most burn out, the frontier forms, the winners lift out. */
export function Swarm({ story }: { story: StoryData }) {
  const t = useT()
  const ref = useRef<InstancedMesh>(null)
  const { pts, current } = useSwarm(story)
  const geo = useMemo(() => new BoxGeometry(0.34, 0.1, 0.34), [])
  const mat = useMemo(() => new MeshBasicMaterial({ toneMapped: false, transparent: true }), [])
  useFrame(() => {
    const m = ref.current
    if (!m) return
    const t = getT()
    m.visible = t > S && t < T.morph[0] + 0.5
    if (!m.visible) return
    const frontK = seg(t, P.front[0], P.front[1])
    const winK = seg(t, P.win[0], P.win[1])
    const out = seg(t, P.go[0], P.go[0] + 0.8)
    pts.forEach((p, i) => {
      const land = easeOut(seg(t, p.arrive, p.arrive + 0.35))
      const since = t - p.arrive - 0.35
      let b = land > 0 ? (since < 0 ? 3 : p.ok ? lerp(3, 0.75, seg(since, 0, 0.5)) : lerp(3, 0.07, seg(since, 0, 0.35))) : 0
      let s = land > 0 ? (p.ok ? 1 : lerp(1, 0.55, seg(since, 0, 0.4))) : 0
      if (p.ok && !p.front) b = lerp(b, 0.22, frontK)
      if (p.front) b = lerp(b, 1.6, frontK)
      if (p.win < 0) b *= 1 - 0.7 * winK
      b *= 1 - out
      if (p.win >= 0) s = 0 // drawn as a big glowing winner instead
      o3.position.set(p.x + (hash(i) - 0.5) * 0.5, lerp(UPPER_Y + 5, UPPER_Y, land), p.z + (hash(i * 2) - 0.5) * 0.3)
      o3.scale.setScalar(s * (1 - out))
      o3.updateMatrix()
      m.setMatrixAt(i, o3.matrix)
      m.setColorAt(i, col.setScalar(b))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  const on = seg(t, S - 0.4, S + 0.4) * (1 - seg(t, T.morph[0], T.morph[0] + 0.6))
  const winK = seg(t, P.win[0] - 0.4, P.win[0] + 0.2)
  return (
    <>
      <instancedMesh ref={ref} args={[geo, mat, pts.length]} frustumCulled={false} />
      {on > 0.01 && <Edged geometry={boxGeo(52, 0.04, 11)} position={[25.5, UPPER_Y - 0.06, 0]} opacity={on * 0.5} filled={false} />}
      {on > 0.01 && (
        // Today's line: a hollow square, cheap but too slow (off the frontier).
        <Edged geometry={boxGeo(0.6, 0.3, 0.6)} position={[current.x, UPPER_Y, current.z]} opacity={on * seg(t, S + 0.5, S + 1.2)} glow={1} filled={false} />
      )}
      {winK > 0 &&
        t < T.morph[0] + 0.6 &&
        pts
          .filter((p) => p.win >= 0)
          .map((p) => {
            const g = easeOut(winK)
            const fade = p.win === 0 ? 1 - seg(t, P.go[1] - 0.3, P.go[1] + 0.5) : 1 - seg(t, P.go[0], P.go[0] + 0.7)
            const s = 0.3 + g * (p.win === 0 ? 1.1 : 0.7)
            return <Edged key={p.win} geometry={boxGeo(1, 0.4, 1)} position={winnerAt(p, p.win, t)} scale={[s, 1, s]} opacity={fade} glow={1} />
          })}
    </>
  )
}
