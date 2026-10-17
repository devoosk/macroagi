/**
 * Indexed playback engine. Render state is a pure function of (t, log): build the
 * index once per log (O(n log n)), then answer `stateAt` with binary searches.
 *
 * Event semantics (per station lane; a lane is a station or one bay of a multi-bay station):
 *   start → working   end → idle   blocked → blocked   starved → starved   failed → failed
 *   op_start → working (resumes after a failure)   op_end / rework → no state change
 * Station-level events without a `bay` on a multi-bay station apply to every bay.
 */
import type { EventLog, Line, Operation, SimEvent, ToolKind } from '../contracts/types'
import type { SceneState, StationState, UnitPosition, WorkerActivity, WorkerVerb } from './types'

export * from './types'

/** Seconds a unit takes to move between stations (when the log leaves a longer gap it waits at the source first). */
export const TRANSFER_TIME = 4

// ---------------------------------------------------------------------------
// Index types
// ---------------------------------------------------------------------------

export interface LaneIndex {
  /** `S05` or `S05#1`. */
  key: string
  station: string
  bay?: number
  /** State-change times (sorted) and the state from that time on. */
  stT: Float64Array
  stS: StationState[]
  /** Cumulative 'working' seconds from 0 up to stT[i]. */
  workCum: Float64Array
  /** Operation intervals (sorted by start). opE = Infinity if no op_end in the log. */
  opS: Float64Array
  /** Matching op_end (same unit + operation); Infinity if none in the log. */
  opE: Float64Array
  /** When the op stops being the lane's displayed op (next op_end on the lane, any unit). */
  opClose: Float64Array
  opId: string[]
  opUnit: string[]
}

export interface StationIndex {
  id: string
  /** Line-order index (stations not in line.json get indices after the last one). */
  order: number
  /** One lane for single-bay stations; one per bay otherwise. */
  lanes: LaneIndex[]
  multiBay: boolean
}

export interface Visit {
  station: string
  order: number
  bay?: number
  start: number
  /** Time processing ended (`end` event). NaN while unknown (still processing at log end). */
  end: number
  /** Whether this visit completed with an `end` event. */
  completed: boolean
  /** Running max stage after this visit completes. */
  stageAfter: number
  /** Stage before this visit started. */
  stageBefore: number
}

export interface UnitItinerary {
  unit: string
  variant: string
  visits: Visit[]
  visitStarts: Float64Array
  /** First start. */
  enter: number
  /** Time the unit left the line (end at last station), or Infinity. */
  exit: number
  reworkTimes: Float64Array
}

export interface PlaybackIndex {
  line: Line
  log: EventLog
  duration: number
  stations: StationIndex[]
  stationById: Map<string, StationIndex>
  units: UnitItinerary[]
  unitById: Map<string, UnitItinerary>
  /** Sorted times of `end` events at the last line station. */
  completions: Float64Array
  /** Sorted rework event times (all units). */
  reworkTimes: Float64Array
  /** Merged intervals where any lane is in 'failed' state. */
  failureBands: [number, number][]
  opById: Map<string, Operation>
  lastStationId?: string
  transfer: number
}

export interface BuildOptions {
  /** Seconds a unit visibly travels between stations. Default TRANSFER_TIME. */
  transfer?: number
}

// ---------------------------------------------------------------------------
// Binary search helpers
// ---------------------------------------------------------------------------

/** Index of the last element <= t, or -1. */
export function lastLE(arr: ArrayLike<number>, t: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface LaneBuilder {
  key: string
  station: string
  bay?: number
  stT: number[]
  stS: StationState[]
  opS: number[]
  opE: number[]
  opClose: number[]
  opId: string[]
  opUnit: string[]
  /** Displayed op (most recent op_start not yet followed by an op_end). */
  current: number
  /** Open ops by `${unit}|${operation}`. */
  open: Map<string, number>
}

const STATE_OF: Partial<Record<SimEvent['event'], StationState>> = {
  start: 'working',
  end: 'idle',
  blocked: 'blocked',
  starved: 'starved',
  failed: 'failed',
  op_start: 'working',
}

function newLane(station: string, bay?: number): LaneBuilder {
  return {
    key: bay === undefined ? station : `${station}#${bay}`,
    station,
    bay,
    stT: [],
    stS: [],
    opS: [],
    opE: [],
    opClose: [],
    opId: [],
    opUnit: [],
    current: -1,
    open: new Map(),
  }
}

function pushState(l: LaneBuilder, t: number, s: StationState) {
  const n = l.stT.length
  if (n && l.stT[n - 1] === t) l.stS[n - 1] = s
  else if (n && l.stS[n - 1] === s) return
  else {
    l.stT.push(t)
    l.stS.push(s)
  }
}

function isSorted(ev: SimEvent[]) {
  for (let i = 1; i < ev.length; i++) if (ev[i].time < ev[i - 1].time) return false
  return true
}

export function buildIndex(line: Line, log: EventLog, opts: BuildOptions = {}): PlaybackIndex {
  const transfer = opts.transfer ?? TRANSFER_TIME
  // Stable sort only if needed (contract says sorted).
  const events = isSorted(log.events)
    ? log.events
    : log.events.map((e, i) => [e, i] as const).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]).map((x) => x[0])

  const order = new Map<string, number>()
  line.stations.forEach((s, i) => order.set(s.id, i))
  // Units finish at the last station on the flow; an off-line fallback station (redesigns) is not the end.
  const lastStationId = line.stations.filter((s) => !s.offline).at(-1)?.id

  // Pass 1: which bays exist per station.
  const baysSeen = new Map<string, Set<number>>()
  for (const ev of events) {
    if (!order.has(ev.station)) order.set(ev.station, order.size)
    if (ev.bay !== undefined) {
      let s = baysSeen.get(ev.station)
      if (!s) baysSeen.set(ev.station, (s = new Set()))
      s.add(ev.bay)
    }
  }
  const stationIds = [...order.keys()]
  const lanesOf = new Map<string, LaneBuilder[]>()
  const multi = new Map<string, boolean>()
  for (const sid of stationIds) {
    const decl = line.stations.find((s) => s.id === sid)?.bays ?? 1
    const seen = baysSeen.get(sid)
    let bays: number[]
    if (seen && seen.size) {
      bays = [...seen].sort((a, b) => a - b)
      for (let b = 0; bays.length < decl && b < decl + 8; b++) if (!seen.has(b)) bays.push(b)
      bays.sort((a, b) => a - b)
    } else bays = decl > 1 ? Array.from({ length: decl }, (_, i) => i) : []
    const isMulti = bays.length > 1 || decl > 1
    multi.set(sid, isMulti)
    lanesOf.set(sid, isMulti ? bays.map((b) => newLane(sid, b)) : [newLane(sid)])
  }

  // Pass 2: lanes + unit visits.
  interface UB {
    unit: string
    variant: string
    visits: Visit[]
    open: Map<string, number>
    reworks: number[]
    exit: number
  }
  const ubs = new Map<string, UB>()
  const completions: number[] = []
  const reworkTimes: number[] = []

  const lanesFor = (ev: SimEvent): LaneBuilder[] => {
    const lanes = lanesOf.get(ev.station)!
    if (!multi.get(ev.station)) return lanes
    if (ev.bay === undefined) return lanes
    const l = lanes.find((x) => x.bay === ev.bay)
    return l ? [l] : lanes
  }

  for (const ev of events) {
    const t = ev.time
    const lanes = lanesFor(ev)
    const st = STATE_OF[ev.event]
    if (st) for (const l of lanes) pushState(l, t, st)

    if (ev.event === 'op_start') {
      for (const l of lanes) {
        // A new op_start supersedes the displayed op (it keeps its own end for phase).
        if (l.current >= 0 && l.opClose[l.current] === Infinity) l.opClose[l.current] = t
        l.opS.push(t)
        l.opE.push(Infinity)
        l.opClose.push(Infinity)
        l.opId.push(ev.operation ?? '')
        l.opUnit.push(ev.unit)
        l.current = l.opS.length - 1
        l.open.set(`${ev.unit}|${ev.operation ?? ''}`, l.current)
      }
    } else if (ev.event === 'op_end') {
      for (const l of lanes) {
        const key = `${ev.unit}|${ev.operation ?? ''}`
        const m = l.open.get(key) ?? l.current
        if (m >= 0 && l.opE[m] === Infinity) l.opE[m] = t
        l.open.delete(key)
        if (l.current >= 0) {
          if (l.opClose[l.current] === Infinity) l.opClose[l.current] = t
          l.current = -1
        }
      }
    }

    if (!ev.unit) continue
    let ub = ubs.get(ev.unit)
    if (ev.event === 'start') {
      if (!ub) ubs.set(ev.unit, (ub = { unit: ev.unit, variant: ev.variant, visits: [], open: new Map(), reworks: [], exit: Infinity }))
      // Close a still-open previous visit (e.g. failed + rework without end).
      for (const [, vi] of ub.open) {
        const v = ub.visits[vi]
        if (Number.isNaN(v.end)) v.end = t
      }
      ub.open.clear()
      ub.exit = Infinity
      ub.visits.push({
        station: ev.station,
        order: order.get(ev.station)!,
        bay: ev.bay,
        start: t,
        end: NaN,
        completed: false,
        stageAfter: 0,
        stageBefore: 0,
      })
      ub.open.set(ev.station, ub.visits.length - 1)
    } else if (ub) {
      if (ev.event === 'end') {
        const vi = ub.open.get(ev.station)
        if (vi !== undefined) {
          const v = ub.visits[vi]
          v.end = t
          v.completed = true
          ub.open.delete(ev.station)
        }
        if (ev.station === lastStationId) {
          completions.push(t)
          ub.exit = t
        }
      } else if (ev.event === 'rework') {
        ub.reworks.push(t)
        reworkTimes.push(t)
        const vi = ub.open.get(ev.station)
        if (vi !== undefined) {
          const v = ub.visits[vi]
          if (Number.isNaN(v.end)) v.end = t
          ub.open.delete(ev.station)
        }
      }
    }
  }

  // Finalise lanes.
  const failures: [number, number][] = []
  const stations: StationIndex[] = stationIds.map((sid) => {
    const lanes: LaneIndex[] = lanesOf.get(sid)!.map((l) => {
      const n = l.stT.length
      const workCum = new Float64Array(n)
      for (let i = 1; i < n; i++) workCum[i] = workCum[i - 1] + (l.stS[i - 1] === 'working' ? l.stT[i] - l.stT[i - 1] : 0)
      for (let i = 0; i < n; i++) if (l.stS[i] === 'failed') failures.push([l.stT[i], i + 1 < n ? l.stT[i + 1] : Math.max(l.stT[i], log.duration)])
      return {
        key: l.key,
        station: sid,
        bay: l.bay,
        stT: Float64Array.from(l.stT),
        stS: l.stS,
        workCum,
        opS: Float64Array.from(l.opS),
        opE: Float64Array.from(l.opE),
        opClose: Float64Array.from(l.opClose),
        opId: l.opId,
        opUnit: l.opUnit,
      }
    })
    return { id: sid, order: order.get(sid)!, lanes, multiBay: multi.get(sid)! }
  })

  failures.sort((a, b) => a[0] - b[0])
  const failureBands: [number, number][] = []
  for (const f of failures) {
    const last = failureBands[failureBands.length - 1]
    if (last && f[0] <= last[1]) last[1] = Math.max(last[1], f[1])
    else failureBands.push([f[0], f[1]])
  }

  const units: UnitItinerary[] = []
  for (const ub of ubs.values()) {
    let stage = 0
    for (const v of ub.visits) {
      v.stageBefore = stage
      if (v.completed) stage = Math.max(stage, v.order + 1)
      v.stageAfter = stage
    }
    units.push({
      unit: ub.unit,
      variant: ub.variant,
      visits: ub.visits,
      visitStarts: Float64Array.from(ub.visits.map((v) => v.start)),
      enter: ub.visits[0]?.start ?? Infinity,
      exit: ub.exit,
      reworkTimes: Float64Array.from(ub.reworks),
    })
  }
  units.sort((a, b) => a.enter - b.enter || (a.unit < b.unit ? -1 : 1))

  const lastT = events.length ? events[events.length - 1].time : 0
  return {
    line,
    log,
    duration: Math.max(log.duration ?? 0, lastT),
    stations,
    stationById: new Map(stations.map((s) => [s.id, s])),
    units,
    unitById: new Map(units.map((u) => [u.unit, u])),
    completions: Float64Array.from(completions),
    reworkTimes: Float64Array.from(reworkTimes),
    failureBands,
    opById: new Map(line.operations.map((o) => [o.id, o])),
    lastStationId,
    transfer,
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function laneStateAt(l: LaneIndex, t: number): StationState {
  const i = lastLE(l.stT, t)
  return i < 0 ? 'idle' : l.stS[i]
}

const PRIORITY: Record<StationState, number> = { working: 4, failed: 3, blocked: 2, starved: 1, idle: 0 }

export function stationStateAt(index: PlaybackIndex, station: string, t: number): StationState {
  const s = index.stationById.get(station)
  if (!s) return 'idle'
  let best: StationState = 'idle'
  for (const l of s.lanes) {
    const st = laneStateAt(l, t)
    if (PRIORITY[st] > PRIORITY[best]) best = st
  }
  return best
}

function laneWorker(index: PlaybackIndex, l: LaneIndex, state: StationState, t: number): WorkerActivity {
  const i = lastLE(l.opS, t)
  const active = i >= 0 && t < l.opClose[i]
  const base = { station: l.station, ...(l.bay !== undefined ? { bay: l.bay } : {}) }
  if (!active) {
    const verb: WorkerVerb = state === 'blocked' ? 'blocked' : 'idle'
    return { ...base, phase: 0, verb, tool: 'none' as ToolKind, cycle: Math.max(0, i + 1) }
  }
  const s = l.opS[i]
  const e = Number.isFinite(l.opE[i]) ? l.opE[i] : l.opClose[i]
  const op = index.opById.get(l.opId[i])
  const phase = Number.isFinite(e) ? Math.min(1, (t - s) / Math.max(1e-6, e - s)) : 0
  return {
    ...base,
    operation: l.opId[i],
    phase,
    verb: op?.verb ?? 'pick',
    tool: op?.tool ?? 'none',
    cycle: i,
    unit: l.opUnit[i] || undefined,
    opStart: s,
    opEnd: e,
  }
}

export function unitPositionAt(index: PlaybackIndex, u: UnitItinerary, t: number): UnitPosition | null {
  if (t < u.enter || t >= u.exit) return null
  const i = lastLE(u.visitStarts, t)
  if (i < 0) return null
  const v = u.visits[i]
  const reworks = lastLE(u.reworkTimes, t) + 1
  const base = { unit: u.unit, variant: u.variant, reworks }
  const processing = Number.isNaN(v.end) || t < v.end
  if (processing) {
    return { ...base, station: v.station, bay: v.bay, travel: 0, stage: v.stageBefore, motion: 'processing' }
  }
  const stage = v.stageAfter
  const next = u.visits[i + 1]
  if (!next) return { ...base, station: v.station, bay: v.bay, travel: 0, stage, motion: 'waiting' }
  const depart = Math.max(v.end, next.start - index.transfer)
  if (t < depart) return { ...base, station: v.station, bay: v.bay, travel: 0, stage, motion: 'waiting' }
  const span = next.start - depart
  const travel = span > 0 ? clamp01((t - depart) / span) : 1
  return {
    ...base,
    station: next.station,
    bay: next.bay,
    fromStation: v.station,
    fromBay: v.bay,
    travel,
    stage,
    motion: 'transit',
  }
}

/** Units completed at the last station at or before t. */
export function completedAt(index: PlaybackIndex, t: number): number {
  return lastLE(index.completions, t) + 1
}

/** Fraction of [0, t] the station spent working (mean over bays). */
export function utilisationAt(index: PlaybackIndex, station: string, t: number): number {
  const s = index.stationById.get(station)
  if (!s || t <= 0) return 0
  let sum = 0
  for (const l of s.lanes) {
    const i = lastLE(l.stT, t)
    if (i < 0) continue
    sum += l.workCum[i] + (l.stS[i] === 'working' ? t - l.stT[i] : 0)
  }
  return sum / (t * s.lanes.length)
}

/** Time spent in each state over [0, t] for a station (summed over bays, divided by bay count). */
export function stateTotalsAt(index: PlaybackIndex, station: string, t: number): Record<StationState, number> {
  const out: Record<StationState, number> = { idle: 0, working: 0, blocked: 0, starved: 0, failed: 0 }
  const s = index.stationById.get(station)
  if (!s || t <= 0) return out
  for (const l of s.lanes) {
    let prev = 0
    let st: StationState = 'idle'
    for (let i = 0; i < l.stT.length && l.stT[i] <= t; i++) {
      out[st] += l.stT[i] - prev
      prev = l.stT[i]
      st = l.stS[i]
    }
    out[st] += t - prev
  }
  for (const k of Object.keys(out) as StationState[]) out[k] /= s.lanes.length
  return out
}

/** Event counts per bin over [0, duration]. */
export function eventDensity(index: PlaybackIndex, bins: number): Float32Array {
  const out = new Float32Array(bins)
  const d = index.duration || 1
  for (const ev of index.log.events) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((ev.time / d) * bins)))
    out[b]++
  }
  return out
}

export function stateAt(index: PlaybackIndex, t: number): SceneState {
  const stations: Record<string, StationState> = {}
  const bays: Record<string, StationState> = {}
  const workers: Record<string, WorkerActivity> = {}
  for (const s of index.stations) {
    let best: StationState = 'idle'
    let first: WorkerActivity | undefined
    for (const l of s.lanes) {
      const st = laneStateAt(l, t)
      if (PRIORITY[st] > PRIORITY[best]) best = st
      const w = laneWorker(index, l, st, t)
      if (s.multiBay) {
        bays[l.key] = st
        workers[l.key] = w
      }
      first ??= w
    }
    stations[s.id] = best
    workers[s.id] = first!
  }
  const units: UnitPosition[] = []
  for (const u of index.units) {
    if (u.enter > t) break
    const p = unitPositionAt(index, u, t)
    if (p) units.push(p)
  }
  return { stations, workers, units, bays, completed: completedAt(index, t), t }
}

// ---------------------------------------------------------------------------
// Memoised entry points
// ---------------------------------------------------------------------------

const cache = new WeakMap<EventLog, WeakMap<Line, PlaybackIndex>>()

/** Index for (line, log), memoised by object identity. */
export function getIndex(line: Line, log: EventLog): PlaybackIndex {
  let m = cache.get(log)
  if (!m) cache.set(log, (m = new WeakMap()))
  let idx = m.get(line)
  if (!idx) m.set(line, (idx = buildIndex(line, log)))
  return idx
}

/** Pure: scene state at time t. Same signature as the original stub. */
export function selectStateAt(line: Line, log: EventLog, t: number): SceneState {
  return stateAt(getIndex(line, log), t)
}
