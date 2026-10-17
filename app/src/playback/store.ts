import { create } from 'zustand'
import type { EventLog, Line, SimEvent, Station } from '../contracts/types'

export type StationState = 'idle' | 'working' | 'blocked' | 'starved' | 'failed'

export interface WorkerActivity {
  station: string
  operation?: string
  /** 0..1 progress through the current operation. */
  phase: number
}

export interface UnitPosition {
  unit: string
  variant: string
  /** Station the unit is at or moving toward. */
  station: string
  /** 0 = at station, (0,1) = travelling from previous station. */
  travel: number
}

export interface SceneState {
  stations: Record<string, StationState>
  workers: Record<string, WorkerActivity>
  units: UnitPosition[]
}

export type DesignKey = 'current' | 'redesign'

export interface PlaybackStore {
  simTime: number
  speed: number
  playing: boolean
  lines: Partial<Record<DesignKey, Line>>
  logs: Partial<Record<DesignKey, EventLog>>
  setTime: (t: number) => void
  setSpeed: (s: number) => void
  setPlaying: (p: boolean) => void
  load: (design: DesignKey, line: Line, log: EventLog) => void
}

export const usePlayback = create<PlaybackStore>((set) => ({
  simTime: 0,
  speed: 10,
  playing: false,
  lines: {},
  logs: {},
  setTime: (t) => set({ simTime: Math.max(0, t) }),
  setSpeed: (speed) => set({ speed }),
  setPlaying: (playing) => set({ playing }),
  load: (design, line, log) =>
    set((s) => ({ lines: { ...s.lines, [design]: line }, logs: { ...s.logs, [design]: log } })),
}))

/**
 * Pure: scene state at time t. Stub implementation (linear scan); the playback
 * workstream replaces this with an indexed version with the same signature.
 */
export function selectStateAt(line: Line, log: EventLog, t: number): SceneState {
  const stations: Record<string, StationState> = {}
  const workers: Record<string, WorkerActivity> = {}
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
  const units: UnitPosition[] = [...unitAt.values()].map((ev) => ({ unit: ev.unit, variant: ev.variant, station: ev.station, travel: 0 }))
  return { stations, workers, units }
}
