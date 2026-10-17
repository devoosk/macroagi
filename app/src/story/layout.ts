import type { Line } from '../contracts/types'
import type { StoryData } from './data'

/** Height of the analysis plate that floats above the factory floor. */
export const UPPER_Y = 4.2

export interface NodePos {
  id: string
  station: string
  /** On the analysis plate. */
  up: [number, number, number]
  /** Hovering over its station on the floor. */
  down: [number, number, number]
  size: number
  cv: number
}

/**
 * Graph layout: nodes sit over their station (so the graph can land on the factory),
 * layered left to right within a station by its hard edges; nodes with free order share a column.
 */
export function layoutGraph(story: StoryData, line: Line): Map<string, NodePos> {
  const sx = new Map(line.stations.map((s) => [s.id, s.x]))
  const hard = story.graph.edges.filter((e) => e.type === 'hard')
  const layer = new Map<string, number>()
  const nodes = story.graph.nodes
  for (let pass = 0; pass < nodes.length; pass++)
    for (const e of hard) {
      const a = nodes.find((n) => n.id === e.from)
      const b = nodes.find((n) => n.id === e.to)
      if (!a || !b || a.station !== b.station) continue
      layer.set(b.id, Math.max(layer.get(b.id) ?? 0, (layer.get(a.id) ?? 0) + 1))
    }
  const maxMean = Math.max(...nodes.map((n) => n.meanTime))
  const out = new Map<string, NodePos>()
  const byStation = new Map<string, typeof nodes>()
  for (const n of nodes) byStation.set(n.station, [...(byStation.get(n.station) ?? []), n])
  for (const [st, list] of byStation) {
    const L = Math.max(...list.map((n) => layer.get(n.id) ?? 0)) + 1
    const cols = new Map<number, typeof nodes>()
    for (const n of list) {
      const l = layer.get(n.id) ?? 0
      cols.set(l, [...(cols.get(l) ?? []), n])
    }
    for (const [l, col] of cols)
      col.forEach((n, k) => {
        const x = (sx.get(st) ?? 0) + (l - (L - 1) / 2) * 1.5
        const z = (k - (col.length - 1) / 2) * 1.9
        out.set(n.id, {
          id: n.id,
          station: st,
          up: [x, UPPER_Y, z],
          down: [x, 2.7, -1.2 + z * 0.35],
          size: 0.35 + 0.55 * Math.sqrt(n.meanTime / maxMean),
          cv: n.cv,
        })
      })
  }
  return out
}
