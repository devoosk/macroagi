import { Line as DLine } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, InstancedMesh, MeshBasicMaterial, Object3D, BoxGeometry } from 'three'
import type { Line } from '../contracts/types'
import { getT, useT } from './clock'
import type { StoryData } from './data'
import { feedPos } from './Feeds'
import { type NodePos, UPPER_Y } from './layout'
import { boxGeo, Edged } from './prims'
import { T, ease, easeOut, hash, lerp, seg } from './theme'

const o3 = new Object3D()
const col = new Color()
const G = T.graph[0]
/** Phase boundaries inside the graph beat. */
const P = { fall: [G, G + 1.9], fuse: [G + 1.9, G + 3.9], edges: [G + 3.9, G + 6], land: [G + 6, G + 7.6] } as const

/** Where a node is at time t: on the analysis plate, then landing on its station. */
export function nodeAt(n: NodePos, t: number): [number, number, number] {
  const k = ease(seg(t, P.land[0], P.land[1]))
  const w = n.cv * 0.5 * (1 - k) * Math.sin(t * 9 + n.up[0])
  return [lerp(n.up[0], n.down[0], k) + w * 0.4, lerp(n.up[1], n.down[1], k), lerp(n.up[2], n.down[2], k) + w * 0.3]
}

/** Graph visibility: in from the fuse, out when the swarm starts. */
const graphOn = (t: number) => seg(t, P.fuse[0], P.fuse[1]) * (1 - seg(t, T.swarm[0], T.swarm[0] + 0.8))

/** Beat 2b: sparks (observed actions) line up per station, fuse into operations, and their order becomes edges. */
function Sparks({ story, line, nodes }: { story: StoryData; line: Line; nodes: Map<string, NodePos> }) {
  const ref = useRef<InstancedMesh>(null)
  const sparks = story.sparks
  const geo = useMemo(() => new BoxGeometry(0.14, 0.14, 0.14), [])
  const mat = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  useFrame(() => {
    const m = ref.current
    if (!m) return
    const t = getT()
    m.visible = t > P.fall[0] - 0.1 && t < P.fuse[1] + 0.2
    if (!m.visible) return
    sparks.forEach((s, i) => {
      const src = feedPos(line, s.st, hash(i) > 0.6)
      const sx = line.stations.find((x) => x.id === s.st)?.x ?? 0
      const strip: [number, number, number] = [sx + (hash(i * 3) - 0.5) * 0.8, UPPER_Y + 0.15, lerp(-4, 4, s.t)]
      const n = nodes.get(s.node)
      const dst = n ? n.up : strip
      const a = ease(seg(t, P.fall[0] + s.t * 0.9, P.fall[0] + s.t * 0.9 + 0.8))
      const b = easeOut(seg(t, P.fuse[0] + hash(i * 7) * 0.6, P.fuse[0] + hash(i * 7) * 0.6 + 1.2))
      const x = lerp(lerp(src[0], strip[0], a), dst[0], b)
      const y = lerp(lerp(src[1], strip[1], a), dst[1] + 0.2, b) + Math.sin(a * Math.PI) * 0.8
      const z = lerp(lerp(src[2], strip[2], a), dst[2], b)
      const vis = a > 0 ? 1 - seg(b, 0.85, 1) : 0
      o3.position.set(x, y, z)
      o3.scale.setScalar(vis)
      o3.updateMatrix()
      m.setMatrixAt(i, o3.matrix)
      m.setColorAt(i, col.setScalar(1.6 + 2 * (1 - a)))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[geo, mat, sparks.length]} frustumCulled={false} />
}

function Edge({ a, b, type, k, t, idx, opacity }: { a: [number, number, number]; b: [number, number, number]; type: 'hard' | 'soft'; k: number; t: number; idx: number; opacity: number }) {
  const lift = (p: [number, number, number]): [number, number, number] => [p[0], p[1] + 0.12, p[2]]
  const end: [number, number, number] = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
  const flick = type === 'soft' ? 0.55 + 0.45 * Math.sin(t * 7 + idx * 1.7) : 1
  // Pulses: one way on a hard edge (always this order), both ways on a soft one.
  const p1 = (t * 0.8 + hash(idx)) % 1
  const p2 = 1 - ((t * 0.65 + hash(idx * 5)) % 1)
  const at = (p: number): [number, number, number] => [lerp(a[0], b[0], p), lerp(a[1], b[1], p) + 0.12, lerp(a[2], b[2], p)]
  return (
    <>
      <DLine
        points={[lift(a), lift(end)]}
        color={type === 'hard' ? '#ffffff' : '#bdbdbd'}
        lineWidth={type === 'hard' ? 2.2 : 1.4}
        dashed={type === 'soft'}
        dashSize={0.18}
        gapSize={0.16}
        transparent
        opacity={opacity * flick}
        toneMapped={false}
      />
      {k >= 1 && opacity > 0.05 && (
        <>
          <Edged geometry={boxGeo(0.12, 0.12, 0.12)} position={at(p1)} opacity={opacity} glow={1} />
          {type === 'soft' && <Edged geometry={boxGeo(0.12, 0.12, 0.12)} position={at(p2)} opacity={opacity * 0.7} glow={1} />}
        </>
      )}
    </>
  )
}

export function Graph({ story, line, nodes }: { story: StoryData; line: Line; nodes: Map<string, NodePos> }) {
  const t = useT()
  const on = graphOn(t)
  const plate = seg(t, P.fall[0] - 0.6, P.fall[0] + 0.4) * (1 - seg(t, P.land[0], P.land[0] + 1))
  const dim = 1 - 0.6 * seg(t, T.focus[0], T.focus[0] + 0.8)
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const s of story.sparks) c.set(s.node, (c.get(s.node) ?? 0) + 1)
    return c
  }, [story])
  return (
    <>
      {t > P.fall[0] - 1 && t < P.fuse[1] + 0.5 && <Sparks story={story} line={line} nodes={nodes} />}
      {plate > 0.01 && <Edged geometry={boxGeo(60, 0.05, 11)} position={[25.5, UPPER_Y - 0.05, 0]} opacity={plate * 0.6} filled={false} />}
      {on > 0.001 &&
        story.graph.nodes.map((n) => {
          const p = nodes.get(n.id)
          if (!p) return null
          // A node grows as its sparks arrive.
          const grow = easeOut(seg(t, P.fuse[0] + 0.3, P.fuse[0] + 1.6 + Math.min(1, (counts.get(n.id) ?? 0) / 60)))
          const s = p.size * grow
          return <Edged key={n.id} geometry={boxGeo(1, 0.35, 1)} position={nodeAt(p, t)} scale={[s, Math.max(0.01, grow), s]} opacity={on * dim} glow={0.9} />
        })}
      {t > P.edges[0] &&
        story.graph.edges.map((e, i) => {
          const a = nodes.get(e.from)
          const b = nodes.get(e.to)
          if (!a || !b) return null
          const k = ease(seg(t, P.edges[0] + (i % 12) * 0.08, P.edges[0] + 0.9 + (i % 12) * 0.08))
          const fade = e.redundant ? 1 - seg(t, P.edges[1] - 0.8, P.edges[1]) : 1
          return <Edge key={i} a={nodeAt(a, t)} b={nodeAt(b, t)} type={e.type} k={k} t={t} idx={i} opacity={on * fade * dim} />
        })}
    </>
  )
}
