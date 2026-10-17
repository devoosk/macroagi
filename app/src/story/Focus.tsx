import type { Line } from '../contracts/types'
import { useT } from './clock'
import type { StoryData } from './data'
import { boxGeo, Edged } from './prims'
import { T, ease, pulse, seg } from './theme'

const BAR_Z = 3.2
const TAKT_H = 2.6

/**
 * Beat 2c: what the system will fix. Each station gets a load bar against one glowing
 * takt line; the bottlenecks burn white and ring, everything else dims.
 */
export function Focus({ story, line }: { story: StoryData; line: Line }) {
  const t = useT()
  const on = pulse(t, T.focus[0], T.swarm[0] + 0.6, 0.6)
  if (on <= 0.001) return null
  const grow = ease(seg(t, T.focus[0] + 0.2, T.focus[0] + 1.4))
  const x0 = Math.min(...line.stations.map((s) => s.x)) - 2.5
  const x1 = Math.max(...line.stations.map((s) => s.x)) + 2.5
  return (
    <group>
      <Edged geometry={boxGeo(x1 - x0, 0.04, 0.04)} position={[(x0 + x1) / 2, TAKT_H, BAR_Z]} opacity={on} glow={1} />
      {story.stations.map((s, i) => {
        const h = Math.max(0.02, TAKT_H * s.loadRatio * ease(seg(grow, i * 0.04, i * 0.04 + 0.6)))
        const hot = s.bottleneck
        const beat = 0.65 + 0.35 * Math.sin(t * 6 + i)
        return (
          <group key={s.id} position={[s.x, 0, BAR_Z]}>
            <Edged geometry={boxGeo(0.7, 1, 0.7)} scale={[1, h, 1]} opacity={on * (hot ? 1 : 0.4)} glow={hot ? beat : 0} filled={hot} />
            {hot &&
              [0, 1, 2].map((r) => {
                const p = (t * 0.6 + r / 3) % 1
                const w = 3 + p * 5
                return <Edged key={r} geometry={boxGeo(w, 0.02, w * 0.9)} position={[0, 0.03, -BAR_Z]} opacity={on * (1 - p) * grow} glow={1} filled={false} />
              })}
          </group>
        )
      })}
    </group>
  )
}
