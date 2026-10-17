// Reference implementation: the original linear-scan stub, kept for tests only.
import type { EventLog, Line, SimEvent, Station } from '../contracts/types'
import type { SceneState, StationState, WorkerActivity } from './types'

type NaiveWorker = Pick<WorkerActivity, 'station' | 'operation' | 'phase'>
type NaiveUnit = { unit: string; variant: string; station: string; travel: number }
export type NaiveState = Pick<SceneState, 'stations'> & { workers: Record<string, NaiveWorker>; units: NaiveUnit[] }

/**
 * Pure: scene state at time t. Stub implementation (linear scan); the playback
 * workstream replaces this with an indexed version with the same signature.
 */
export function selectStateAtNaive(line: Line, log: EventLog, t: number): NaiveState {
  const stations: Record<string, StationState> = {}
  const workers: Record<string, NaiveWorker> = {}
  const lastAt = new Map<string, SimEvent>()
  const opAt = new Map<string, { ev: SimEvent; end?: number }>()
  const unitAt = new Map<string, SimEvent>()

  for (const s of line.stations) stations[s.id] = 'idle'
  for (const ev of log.events) {
    if (ev.time > t) break
    if (ev.event === 'op_start') opAt.set(ev.station, { ev })
    else if (ev.event === 'op_end') opAt.delete(ev.station)
    else lastAt.set(ev.station, ev)
    if (ev.event === 'start') unitAt.set(ev.unit, ev)
    if (ev.event === 'end' && ev.station === line.stations[line.stations.length - 1]?.id) unitAt.delete(ev.unit)
  }
  for (const [sid, ev] of lastAt) {
    stations[sid] =
      ev.event === 'start' ? 'working' : ev.event === 'blocked' ? 'blocked' : ev.event === 'starved' ? 'starved' : ev.event === 'failed' ? 'failed' : 'idle'
  }
  for (const s of line.stations as Station[]) {
    const op = opAt.get(s.id)
    let phase = 0
    if (op) {
      const end = log.events.find((e) => e.event === 'op_end' && e.station === s.id && e.operation === op.ev.operation && e.time >= op.ev.time)
      phase = end ? Math.min(1, (t - op.ev.time) / Math.max(1e-6, end.time - op.ev.time)) : 0
    }
    workers[s.id] = { station: s.id, operation: op?.ev.operation, phase }
  }
  const units: NaiveUnit[] = [...unitAt.values()].map((ev) => ({ unit: ev.unit, variant: ev.variant, station: ev.station, travel: 0 }))
  return { stations, workers, units }
}
