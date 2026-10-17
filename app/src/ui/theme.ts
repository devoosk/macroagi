import type { Lever, Line } from '../contracts/types'
import type { StationState } from '../playback/types'

export const STATE_COLORS: Record<StationState, string> = {
  working: '#35c759',
  blocked: '#f5a524',
  starved: '#7d92ad',
  failed: '#ff453a',
  idle: '#555d6b',
}

export const STATE_LABELS: Record<StationState, string> = {
  working: 'Working',
  blocked: 'Blocked',
  starved: 'Starved',
  failed: 'Failed',
  idle: 'Idle',
}

/** MicroAGI ink; the brand is monochrome, so the accent is the ink colour. */
export const ACCENT = '#1a1a1a'
export const REWORK = '#ff9f0a'

/** Seconds → hh:mm:ss (sim time). */
export function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** Applied levers (by id in `line.appliedLevers`) whose operations touch the station. */
export function stationLevers(line: Line, station: string): Lever[] {
  const applied = line.appliedLevers
  if (!applied?.length) return []
  const s = line.stations.find((x) => x.id === station)
  if (!s) return []
  const ops = new Set(s.operations)
  return line.levers.filter((l) => applied.includes(l.id) && l.operations.some((o) => ops.has(o)))
}

export const LEVER_LABELS: Record<Lever['type'], string> = {
  eliminate: 'ELIMINATE',
  fixture: 'FIXTURE',
  kit: 'KIT',
  goods_to_robot: 'GOODS→ROBOT',
  regroup: 'REGROUP',
  decouple: 'DECOUPLE',
}
