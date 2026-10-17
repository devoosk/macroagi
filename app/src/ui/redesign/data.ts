import type { CapabilityEstimate, CapabilityTable, DesignResult, Line, Results, SegmentLog, Station } from '../../contracts/types'
import { loadJson } from '../../lib/data'

/** Everything the redesign sequence shows. Optional files are left undefined when missing. */
export interface StudioData {
  current: Line
  /** Solver designs in rank order (line_solver_1..3). */
  designs: Line[]
  segments?: SegmentLog
  capability?: CapabilityTable
  results?: Results
}

const optional = <T>(path: string) => loadJson<T>(path).catch(() => undefined)

export async function loadStudioData(current: Line): Promise<StudioData> {
  const [segments, capability, results, ...designs] = await Promise.all([
    optional<SegmentLog>('/data/segments.json'),
    optional<CapabilityTable>('/data/capability.json'),
    optional<Results>('/data/results.json'),
    ...[1, 2, 3].map((n) => optional<Line>(`/data/line_solver_${n}.json`)),
  ])
  return { current, segments, capability, results, designs: designs.filter((d): d is Line => !!d) }
}

/** Stations on the serial flow, in line order (off-line fallback stations left out). */
export const flowStations = (line: Line): Station[] => line.stations.filter((s) => !s.offline).sort((a, b) => a.x - b.x)

export function resultFor(data: StudioData, line: Line): DesignResult | undefined {
  return data.results?.designs.find((d) => d.design === line.id)
}

export interface Range {
  p05: number
  mean: number
  p95: number
}

export interface CapabilityRow {
  op: string
  name: string
  station: string
  waste: boolean
  /** Best rentable robot on the task as it stands today. */
  today?: Range
  /** Best robot with the best single design lever. */
  lever?: Range & { lever: string }
  /** Mode in the chosen design. */
  mode?: 'human' | 'robot' | 'eliminated'
}

const best = (rows: CapabilityEstimate[]) => rows.reduce<CapabilityEstimate | undefined>((a, r) => (!a || r.mean > a.mean ? r : a), undefined)

/** Per operation: robot success today vs with a lever, from capability.json. */
export function capabilityRows(data: StudioData): CapabilityRow[] {
  const design = data.designs[0]
  const modes = new Map(design?.operations.map((o) => [o.id, o.mode]))
  const order = new Map(flowStations(data.current).map((s, i) => [s.id, i]))
  const ops = [...data.current.operations].sort((a, b) => (order.get(a.station) ?? 0) - (order.get(b.station) ?? 0))
  return ops.map((o) => {
    const est = (data.capability?.operations ?? []).filter((e) => e.operation === o.id && e.feasible && !e.eliminated)
    const today = best(est.filter((e) => e.levers.length === 0))
    const lever = best(est.filter((e) => e.levers.length > 0))
    const waste = est.some((e) => e.waste) || o.verb === 'walk' || o.verb === 'search'
    return {
      op: o.id,
      name: o.name,
      station: o.station,
      waste,
      today: today && { p05: today.p05, mean: today.mean, p95: today.p95 },
      lever: lever && lever.mean > (today?.mean ?? 0) ? { p05: lever.p05, mean: lever.mean, p95: lever.p95, lever: lever.levers.join(' + ') } : undefined,
      mode: modes.get(o.id),
    }
  })
}

/** Euros → "€3.2M" / "€322k". */
export function euros(v: number): string {
  if (v >= 1e6) return `€${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `€${Math.round(v / 1e3)}k`
  return `€${Math.round(v)}`
}
