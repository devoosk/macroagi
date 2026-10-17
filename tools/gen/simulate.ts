// Seeded, deterministic discrete-event simulation of a serial line with finite buffers.
//
// Semantics (shared with the renderer):
// - Station bays are servers. Each bay's state is the last of start / end / blocked / starved at that bay.
//   `start` puts the unit at the bay; between `end` and the bay's next event the unit is still at the bay
//   (`blocked` makes that explicit). After that the unit is in the buffer until its `start` downstream.
// - Buffer between station i and i+1 holds stations[i].bufferAfter + stations[i+1].bufferBefore units
//   (0 = coupled line: a finished unit waits in its bay until the next bay is free).
// - The first station has unlimited raw material (never starved); variants are drawn from the mix.
// - Ops inside a station run sequentially; their order is re-drawn every cycle as a random topological
//   order over the hard edges between that station's ops (soft edges are ignored on purpose).
// - A test op with failRate: at the leak test the unit emits `failed` (leak station) then `rework`
//   (brazing station, no bay) and joins a priority rework queue at brazing; at any other test station
//   it emits `failed` + `rework` at that bay and is re-tested in place.
// - Robot stations (staff 'robot'): each op fails with p = (1 - reliability) * failMultiplier and then
//   takes `recovery` extra seconds (no extra event; the op just runs longer).

import type { EventLog, Line, Operation, SimEvent, SimEventType, Station } from '../../app/src/contracts/types'
import { rng } from '../../app/src/lib/rng'

export interface SimOptions {
  seed: number
  /** Total simulated time, seconds (includes warm-up). */
  duration: number
  /** Stats ignore [0, warmup). The log starts from an empty line at t = 0. */
  warmup: number
  record?: boolean
  robotReliability?: number
  robotFailMultiplier?: number
  robotRecovery?: number
  /** Override which stations are robot-staffed (used for "naive automation" sweeps of the current line). */
  robotStations?: string[]
}

export interface StationStats {
  id: string
  name: string
  bays: number
  utilisation: number
  blocked: number
  starved: number
  cycles: number
}

export interface SimResult {
  log?: EventLog
  stats: StationStats[]
  completed: number
  throughputPerHour: number
  failures: number
}

interface Unit {
  id: string
  variant: string
}

type BayState = 'idle' | 'busy' | 'blocked' | 'starved'

interface Bay {
  index: number
  state: BayState
  since: number
  unit: Unit | null
  busyT: number
  blockedT: number
  starvedT: number
}

interface SimStation {
  def: Station
  idx: number
  bays: Bay[]
  ops: Operation[]
  /** Hard predecessors within the station. */
  preds: Map<string, string[]>
  failOp?: Operation
  robot: boolean
  cycles: number
}

interface Pending {
  time: number
  seq: number
  station: number
  bay: number
}

class Heap {
  private a: Pending[] = []
  get size() {
    return this.a.length
  }
  private less(i: number, j: number) {
    const x = this.a[i]
    const y = this.a[j]
    return x.time < y.time || (x.time === y.time && x.seq < y.seq)
  }
  push(p: Pending) {
    const a = this.a
    a.push(p)
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(i, parent)) break
      ;[a[i], a[parent]] = [a[parent], a[i]]
      i = parent
    }
  }
  pop(): Pending | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && this.less(l, m)) m = l
        if (r < a.length && this.less(r, m)) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }
}

const r3 = (t: number) => Math.round(t * 1000) / 1000

export function simulate(line: Line, opts: SimOptions): SimResult {
  const { seed, duration, warmup } = opts
  const record = opts.record ?? true
  const reliability = opts.robotReliability ?? 0.98
  const failMult = opts.robotFailMultiplier ?? 1
  const recovery = opts.robotRecovery ?? 30

  const rand = rng('sim', line.id, seed)
  const normal = () => {
    let u = 0
    while (u === 0) u = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  /** Lognormal with the given mean and sd. */
  const sample = (mean: number, sd: number) => {
    if (mean <= 0) return 0
    if (sd <= 0) return mean
    const s2 = Math.log(1 + (sd * sd) / (mean * mean))
    const mu = Math.log(mean) - s2 / 2
    return Math.exp(mu + Math.sqrt(s2) * normal())
  }

  const opById = new Map(line.operations.map((o) => [o.id, o]))
  const variantOps = new Map(line.variants.map((v) => [v.id, new Set(v.operations)]))
  const mix = line.variants.map((v) => ({ id: v.id, w: v.mix.value }))
  const mixTotal = mix.reduce((a, b) => a + b.w, 0)

  const stations: SimStation[] = line.stations.map((def, idx) => {
    const ops = def.operations.map((id) => opById.get(id)!).filter(Boolean)
    const ids = new Set(ops.map((o) => o.id))
    const preds = new Map<string, string[]>()
    for (const o of ops) preds.set(o.id, [])
    for (const e of line.edges) {
      if (e.type === 'hard' && ids.has(e.from) && ids.has(e.to)) preds.get(e.to)!.push(e.from)
    }
    const robot = opts.robotStations ? opts.robotStations.includes(def.id) : def.staff === 'robot'
    return {
      def,
      idx,
      ops,
      preds,
      robot,
      failOp: ops.find((o) => o.failRate && o.failRate.value > 0),
      cycles: 0,
      bays: Array.from({ length: Math.max(1, def.bays ?? 1) }, (_, i) => ({
        index: i,
        state: 'idle' as BayState,
        since: 0,
        unit: null,
        busyT: 0,
        blockedT: 0,
        starvedT: 0,
      })),
    }
  })
  const N = stations.length
  const reworkIdx = stations.findIndex((s) => s.def.kind === 'brazing')
  const leakIdx = stations.findIndex((s) => s.def.kind === 'evacuation_leak_test')

  const bufCap = stations.map((s, i) => (i < N - 1 ? s.def.bufferAfter + stations[i + 1].def.bufferBefore : 0))
  const buffers: Unit[][] = stations.map(() => [])
  const blockedQ: number[][] = stations.map(() => []) // bay indices blocked at station i, FIFO
  const reworkQ: Unit[] = []

  const events: (SimEvent & { seq: number })[] = []
  let seq = 0
  const emit = (u: Unit | null, st: SimStation, event: SimEventType, time: number, extra: Partial<SimEvent> = {}) => {
    if (!record || time > duration) return
    const e: SimEvent & { seq: number } = {
      unit: u ? u.id : '',
      variant: u ? u.variant : '',
      station: st.def.id,
      event,
      time: r3(time),
      seq: seq++,
      ...extra,
    }
    if (st.bays.length > 1 && extra.bay === undefined && event !== 'rework') e.bay = 0
    events.push(e)
  }
  const bayExtra = (st: SimStation, b: Bay): Partial<SimEvent> => (st.bays.length > 1 ? { bay: b.index } : {})

  const setState = (b: Bay, state: BayState, t: number) => {
    const lo = Math.max(b.since, warmup)
    const hi = Math.min(t, duration)
    if (hi > lo) {
      if (b.state === 'busy') b.busyT += hi - lo
      else if (b.state === 'blocked') b.blockedT += hi - lo
      else if (b.state === 'starved') b.starvedT += hi - lo
    }
    b.state = state
    b.since = t
  }

  const heap = new Heap()
  let pseq = 0
  let unitCounter = 0
  let completed = 0
  let failures = 0

  const newUnit = (): Unit => {
    let r = rand() * mixTotal
    let variant = mix[mix.length - 1].id
    for (const m of mix) {
      if (r < m.w) {
        variant = m.id
        break
      }
      r -= m.w
    }
    unitCounter++
    return { id: `U${String(unitCounter).padStart(4, '0')}`, variant }
  }

  /** Random topological order over the hard edges of this station's ops for this variant. */
  const drawOrder = (st: SimStation, variant: string): Operation[] => {
    const allowed = variantOps.get(variant)
    const ops = st.ops.filter((o) => !allowed || allowed.has(o.id))
    const ids = new Set(ops.map((o) => o.id))
    const done = new Set<string>()
    const out: Operation[] = []
    while (out.length < ops.length) {
      const ready = ops.filter((o) => !done.has(o.id) && st.preds.get(o.id)!.every((p) => done.has(p) || !ids.has(p)))
      const pick = ready[Math.floor(rand() * ready.length)]
      done.add(pick.id)
      out.push(pick)
    }
    return out
  }

  const startUnit = (st: SimStation, b: Bay, u: Unit, t: number) => {
    setState(b, 'busy', t)
    b.unit = u
    emit(u, st, 'start', t, bayExtra(st, b))
    let clock = t
    for (const o of drawOrder(st, u.variant)) {
      const tm = o.time[u.variant] ?? Object.values(o.time)[0]
      let d = sample(tm.mean.value, tm.sd.value)
      if (st.robot && rand() < (1 - reliability) * failMult) d += recovery
      emit(u, st, 'op_start', clock, { ...bayExtra(st, b), operation: o.id })
      clock += d
      emit(u, st, 'op_end', clock, { ...bayExtra(st, b), operation: o.id })
    }
    heap.push({ time: clock, seq: pseq++, station: st.idx, bay: b.index })
  }

  const freeBay = (b: Bay, t: number) => {
    b.unit = null
    setState(b, 'idle', t)
  }

  /** Move the oldest blocked unit of station i into its (now non-full) output buffer. */
  const releaseBlocked = (i: number, t: number) => {
    if (!blockedQ[i].length || buffers[i].length >= bufCap[i]) return
    const bi = blockedQ[i].shift()!
    const b = stations[i].bays[bi]
    buffers[i].push(b.unit!)
    freeBay(b, t)
    feed(i, t)
  }

  const takeInput = (s: number, t: number): Unit | null => {
    if (s === 0) return newUnit()
    if (s === reworkIdx && reworkQ.length) return reworkQ.shift()!
    const up = s - 1
    if (buffers[up].length) {
      const u = buffers[up].shift()!
      releaseBlocked(up, t)
      return u
    }
    if (blockedQ[up].length) {
      // Coupled hand-over straight from a blocked upstream bay.
      const bi = blockedQ[up].shift()!
      const b = stations[up].bays[bi]
      const u = b.unit!
      freeBay(b, t)
      feed(up, t)
      return u
    }
    return null
  }

  function feed(s: number, t: number) {
    const st = stations[s]
    for (const b of st.bays) {
      if (b.state !== 'idle' && b.state !== 'starved') continue
      if (b.unit) continue
      const u = takeInput(s, t)
      if (u) {
        startUnit(st, b, u, t)
      } else if (b.state !== 'starved') {
        setState(b, 'starved', t)
        emit(null, st, 'starved', t, bayExtra(st, b))
      }
    }
  }

  const finish = (s: number, bi: number, t: number) => {
    const st = stations[s]
    const b = st.bays[bi]
    const u = b.unit!
    emit(u, st, 'end', t, bayExtra(st, b))
    if (t >= warmup) st.cycles++

    if (st.failOp && rand() < st.failOp.failRate!.value) {
      failures++
      emit(u, st, 'failed', t, bayExtra(st, b))
      if (s === leakIdx && reworkIdx >= 0) {
        emit(u, stations[reworkIdx], 'rework', t)
        reworkQ.push(u)
        freeBay(b, t)
        feed(reworkIdx, t)
        feed(s, t)
      } else {
        emit(u, st, 'rework', t, bayExtra(st, b))
        startUnit(st, b, u, t)
      }
      return
    }

    if (s === N - 1) {
      if (t >= warmup) completed++
      freeBay(b, t)
      feed(s, t)
      return
    }
    if (buffers[s].length < bufCap[s]) {
      buffers[s].push(u)
      freeBay(b, t)
      feed(s + 1, t)
      feed(s, t)
      return
    }
    setState(b, 'blocked', t)
    emit(u, st, 'blocked', t, bayExtra(st, b))
    blockedQ[s].push(bi)
    feed(s + 1, t) // coupled hand-over if a downstream bay is idle
  }

  // Empty line at t = 0.
  for (let s = 0; s < N; s++) feed(s, 0)

  for (;;) {
    const p = heap.pop()
    if (!p || p.time > duration) break
    finish(p.station, p.bay, p.time)
  }
  for (const st of stations) for (const b of st.bays) setState(b, b.state, duration)

  const T = duration - warmup
  const stats: StationStats[] = stations.map((st) => {
    const n = st.bays.length
    const sum = (k: 'busyT' | 'blockedT' | 'starvedT') => st.bays.reduce((a, b) => a + b[k], 0) / (n * T)
    return {
      id: st.def.id,
      name: st.def.name,
      bays: n,
      utilisation: sum('busyT'),
      blocked: sum('blockedT'),
      starved: sum('starvedT'),
      cycles: st.cycles,
    }
  })

  let log: EventLog | undefined
  if (record) {
    events.sort((a, b) => a.time - b.time || a.seq - b.seq)
    log = {
      line: line.id,
      seed,
      duration,
      events: events.map(({ seq: _seq, ...e }) => e),
    }
  }
  return { log, stats, completed, failures, throughputPerHour: (completed / T) * 3600 }
}
