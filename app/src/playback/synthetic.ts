/**
 * Deterministic synthetic line + event log for tests, perf checks and the UI preview.
 * A small serial-line model with zero buffers (blocking after service), parallel bays,
 * equipment failures and leak-test failures that loop back to brazing.
 * Not the real simulation: that comes from simulate/.
 */
import type { EventLog, Line, Operation, SimEvent, Station, StationKind, ToolKind, VerbClass } from '../contracts/types'
import { rng } from '../lib/rng'

const est = (value: number) => ({ value, source: 'estimate' })

type OpSpec = [id: string, name: string, verb: VerbClass, tool: ToolKind, mean: number]
const STATIONS: [StationKind, string, OpSpec[]][] = [
  ['kitting', 'Kitting', [['O01', 'Search parts', 'search', 'none', 14], ['O02', 'Pick kit', 'pick', 'scanner', 22]]],
  ['base_frame', 'Base frame', [['O03', 'Place base', 'place', 'none', 18], ['O04', 'Screw frame', 'screw', 'torque_driver', 30]]],
  ['compressor_mount', 'Compressor', [['O05', 'Place compressor', 'place', 'none', 24], ['O06', 'Torque mounts', 'screw', 'torque_driver', 28]]],
  ['brazing', 'Brazing', [['O07', 'Braze joints', 'braze', 'torch', 44], ['O08', 'Inspect joints', 'inspect', 'none', 12]]],
  ['evacuation_leak_test', 'Leak test', [['O09', 'Connect hoses', 'connect', 'hose', 16], ['O10', 'Leak test', 'inspect', 'hose', 50]]],
  ['refrigerant_charge', 'R290 charge', [['O11', 'Connect charger', 'connect', 'hose', 14], ['O12', 'Charge + scan', 'inspect', 'scanner', 36]]],
  ['electrical_wiring', 'Wiring', [['O13', 'Crimp harness', 'insert', 'crimper', 30], ['O14', 'Connect terminals', 'connect', 'screwdriver', 26]]],
  ['casing', 'Casing', [['O15', 'Place panels', 'place', 'none', 22], ['O16', 'Screw panels', 'screw', 'screwdriver', 32]]],
  ['run_test', 'Run test', [['O17', 'Connect test rig', 'connect', 'hose', 20], ['O18', 'Run test', 'inspect', 'none', 100]]],
  ['eol_inspection', 'EOL check', [['O19', 'Final inspection', 'inspect', 'scanner', 40]]],
  ['packing', 'Packing', [['O20', 'Strap + label', 'place', 'strapper', 38]]],
]

const VARIANTS = [
  { id: 'V6', name: '6 kW', kw: 6, mix: 0.4, k: 0.9 },
  { id: 'V9', name: '9 kW', kw: 9, mix: 0.35, k: 1 },
  { id: 'V12', name: '12 kW', kw: 12, mix: 0.25, k: 1.15 },
]

export interface SyntheticLineOptions {
  /** Redesign variant: leak test split into 2 bays, kitting eliminated-ish, levers applied. */
  redesign?: boolean
}

export function makeSyntheticLine(opts: SyntheticLineOptions = {}): Line {
  const operations: Operation[] = []
  const stations: Station[] = STATIONS.map(([kind, name, ops], i) => {
    const sid = `S${String(i + 1).padStart(2, '0')}`
    for (const [id, opName, verb, tool, mean] of ops) {
      const speedup = opts.redesign && (kind === 'kitting' || kind === 'base_frame') ? 0.7 : 1
      operations.push({
        id,
        name: opName,
        verb,
        parts: [],
        tool,
        station: sid,
        time: Object.fromEntries(VARIANTS.map((v) => [v.id, { mean: est(mean * v.k * speedup), sd: est(mean * 0.08) }])),
        ...(kind === 'evacuation_leak_test' && verb === 'inspect' ? { failRate: est(0.08) } : {}),
      })
    }
    const bays = kind === 'run_test' ? 2 : opts.redesign && kind === 'evacuation_leak_test' ? 2 : 1
    return {
      id: sid,
      name,
      kind,
      operations: ops.map((o) => o[0]),
      staff: opts.redesign && (kind === 'brazing' || kind === 'casing') ? 'robot' : 'human',
      x: i * 4.5,
      y: 0,
      rot: 0,
      bufferBefore: 0,
      bufferAfter: 0,
      ...(bays > 1 ? { bays } : {}),
    }
  })
  return {
    id: opts.redesign ? 'synthetic_redesign' : 'synthetic_current',
    name: opts.redesign ? 'Synthetic redesign' : 'Synthetic current line',
    takt: est(75),
    operations,
    edges: [],
    parts: [],
    stations,
    variants: VARIANTS.map((v) => ({ id: v.id, name: v.name, kw: v.kw, mix: est(v.mix), operations: operations.map((o) => o.id) })),
    levers: [
      { id: 'L1', type: 'kit', cost: est(12000), operations: ['O01', 'O02'], featureChanges: { presentation: 'kitted' } },
      { id: 'L2', type: 'fixture', cost: est(30000), operations: ['O07'], featureChanges: { presentation: 'fixtured' } },
      { id: 'L3', type: 'decouple', cost: est(45000), operations: ['O10'], featureChanges: { bays: '2' } },
      { id: 'L4', type: 'goods_to_robot', cost: est(25000), operations: ['O15', 'O16'], featureChanges: {} },
    ],
    ...(opts.redesign ? { appliedLevers: ['L1', 'L2', 'L3', 'L4'] } : {}),
  }
}

export interface SyntheticLogOptions {
  seed?: number
  /** Stop releasing units after this time and drop later events (log ends mid-flow). */
  duration?: number
  /** Number of units to release (default: until `duration`). */
  units?: number
  /** Mean release interval (s). */
  interArrival?: number
  /** Transfer time between stations (s). */
  transfer?: number
  /** Probability of an equipment failure per station visit. */
  failureRate?: number
}

const RANK: Record<SimEvent['event'], number> = { end: 0, op_end: 0, blocked: 1, failed: 1, rework: 2, starved: 3, start: 4, op_start: 5 }

export function makeSyntheticLog(line: Line, opts: SyntheticLogOptions = {}): EventLog {
  const seed = opts.seed ?? 1
  const rand = rng('synthetic', line.id, seed)
  const gauss = () => {
    const u = Math.max(1e-9, rand())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const transfer = opts.transfer ?? 5
  const interArrival = opts.interArrival ?? 62
  const failureRate = opts.failureRate ?? 0.015
  const maxUnits = opts.units ?? Infinity
  const horizon = opts.duration ?? Infinity
  if (!Number.isFinite(maxUnits) && !Number.isFinite(horizon)) throw new Error('units or duration required')

  const st = line.stations
  const ops = new Map(line.operations.map((o) => [o.id, o]))
  const brazeIdx = st.findIndex((s) => s.kind === 'brazing')
  const leakIdx = st.findIndex((s) => s.kind === 'evacuation_leak_test')
  const bayFree = st.map((s) => new Array(s.bays ?? 1).fill(0) as number[])
  const multi = st.map((s) => (s.bays ?? 1) > 1)

  const raw: (SimEvent & { seq: number })[] = []
  let seq = 0
  const push = (e: SimEvent) => raw.push({ ...e, seq: seq++ })
  const visitsByBay = new Map<string, { start: number; depart: number }[]>()

  let release = 0
  for (let k = 0; k < maxUnits; k++) {
    release += interArrival * (0.85 + 0.3 * rand())
    if (release > horizon) break
    const unit = `U${String(k + 1).padStart(4, '0')}`
    let r = rand()
    const variant = VARIANTS.find((v) => (r -= v.mix) < 0) ?? VARIANTS[0]
    let arrival = release
    let j = 0
    let reworks = 0
    while (j < st.length) {
      const s = st[j]
      const bays = bayFree[j]
      let b = 0
      for (let i = 1; i < bays.length; i++) if (bays[i] < bays[b]) b = i
      const start = Math.max(arrival, bays[b])
      const bay = multi[j] ? b : undefined
      const base = { unit, variant: variant.id, station: s.id, ...(bay !== undefined ? { bay } : {}) }
      push({ ...base, event: 'start', time: start })
      let t = start
      // Shuffle reorderable ops occasionally (visible variation for capture).
      const order = [...s.operations]
      if (order.length > 1 && rand() < 0.25) order.reverse()
      const failAfter = rand() < failureRate ? Math.floor(rand() * order.length) : -1
      order.forEach((opId, oi) => {
        const op = ops.get(opId)!
        const tm = op.time[variant.id] ?? Object.values(op.time)[0]
        const d = Math.max(2, tm.mean.value + gauss() * tm.sd.value)
        push({ ...base, event: 'op_start', operation: opId, time: t })
        t += d
        push({ ...base, event: 'op_end', operation: opId, time: t })
        if (oi === failAfter && oi < order.length - 1) {
          push({ ...base, event: 'failed', time: t })
          t += 60 + rand() * 120
        }
      })
      const E = t
      push({ ...base, event: 'end', time: E })
      const testFail = j === leakIdx && reworks < 2 && rand() < (ops.get(s.operations[s.operations.length - 1])?.failRate?.value ?? 0)
      let next = j + 1
      if (testFail) {
        push({ ...base, event: 'failed', time: E })
        push({ ...base, event: 'rework', time: E })
        next = brazeIdx
        reworks++
      }
      let depart = E
      if (next < st.length) {
        const nb = Math.min(...bayFree[next])
        depart = Math.max(E, nb - transfer)
        if (depart > E && !testFail) push({ ...base, event: 'blocked', time: E })
      }
      bays[b] = depart
      const key = `${j}#${b}`
      if (!visitsByBay.has(key)) visitsByBay.set(key, [])
      visitsByBay.get(key)!.push({ start, depart })
      arrival = depart + transfer
      j = next
    }
  }
  // Starved: a bay waits for its next unit.
  for (const [key, vs] of visitsByBay) {
    const [j, b] = key.split('#').map(Number)
    vs.sort((a, c) => a.start - c.start)
    for (let i = 0; i + 1 < vs.length; i++) {
      if (vs[i + 1].start - vs[i].depart > 0.5) {
        push({ unit: '', variant: '', station: st[j].id, event: 'starved', time: vs[i].depart, ...(multi[j] ? { bay: b } : {}) })
      }
    }
  }
  raw.sort((a, c) => a.time - c.time || RANK[a.event] - RANK[c.event] || a.seq - c.seq)
  const events: SimEvent[] = []
  for (const { seq: _s, ...e } of raw) if (e.time <= horizon) events.push(e)
  const duration = Number.isFinite(horizon) ? horizon : Math.ceil(events[events.length - 1]?.time ?? 0)
  return { line: line.id, seed, duration, events }
}
