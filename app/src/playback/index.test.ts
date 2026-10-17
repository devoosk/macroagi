import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EventLog, Line, SimEvent } from '../contracts/types'
import { rng } from '../lib/rng'
import { buildIndex, completedAt, eventDensity, getIndex, selectStateAt, stateAt, utilisationAt } from './index'
import { selectStateAtNaive } from './naive'
import { makeSyntheticLine, makeSyntheticLog } from './synthetic'
import { usePlayback } from './store'

const dataDir = fileURLToPath(new URL('./__fixtures__/', import.meta.url))
const fixtureLine: Line = JSON.parse(readFileSync(dataDir + 'line.json', 'utf8'))
const fixtureLog: EventLog = JSON.parse(readFileSync(dataDir + 'events_current.json', 'utf8'))

/** Tiny 3-station line for hand-written logs. */
const tinyLine: Line = {
  ...fixtureLine,
  stations: fixtureLine.stations.map((s) => ({ ...s })),
}
const ev = (unit: string, station: string, event: SimEvent['event'], time: number, extra: Partial<SimEvent> = {}): SimEvent => ({
  unit,
  variant: 'V9',
  station,
  event,
  time,
  ...extra,
})

describe('stateAt vs naive stub', () => {
  it('matches the stub on the fixture at 200 seeded random times', () => {
    const index = buildIndex(fixtureLine, fixtureLog)
    const r = rng('test-times', 42)
    const times = Array.from({ length: 200 }, () => r() * (fixtureLog.duration + 20) - 5)
    // Also every event time exactly (boundary semantics).
    for (const e of fixtureLog.events) times.push(e.time)
    let skippedPhase = 0
    for (const t of times) {
      const a = stateAt(index, t)
      const b = selectStateAtNaive(fixtureLine, fixtureLog, t)
      expect(a.stations).toEqual(b.stations)
      for (const sid of Object.keys(b.workers)) {
        expect(a.workers[sid].operation).toBe(b.workers[sid].operation)
        const w = a.workers[sid]
        // The stub takes the first op_end of the same op at the station, even another unit's
        // (the fixture overlaps two units at S03). We match by unit; skip only that stub bug.
        const stubEnd = fixtureLog.events.find((e) => e.event === 'op_end' && e.station === sid && e.operation === w.operation && e.time >= (w.opStart ?? 0))
        if (w.operation && stubEnd && stubEnd.unit !== w.unit) {
          skippedPhase++
          continue
        }
        expect(w.phase).toBeCloseTo(b.workers[sid].phase, 9)
      }
      expect(a.units.map((u) => u.unit).sort()).toEqual(b.units.map((u) => u.unit).sort())
      for (const u of a.units) {
        const n = b.units.find((x) => x.unit === u.unit)!
        // Stub keeps a unit at its last start until the next start; we show transit toward the next.
        if (u.travel === 0) expect(u.station).toBe(n.station)
        else expect(u.fromStation).toBe(n.station)
      }
    }
    expect(skippedPhase).toBeLessThan(times.length / 4)
  })

  it('selectStateAt keeps the stub signature and memoises the index by log identity', () => {
    const s = selectStateAt(fixtureLine, fixtureLog, 30)
    expect(s.stations.S01).toBe('working')
    expect(getIndex(fixtureLine, fixtureLog)).toBe(getIndex(fixtureLine, fixtureLog))
  })

  it('extended worker fields carry verb, tool and cycle', () => {
    const s = selectStateAt(fixtureLine, fixtureLog, 30)
    expect(s.workers.S01).toMatchObject({ operation: 'O2', verb: 'screw', tool: 'torque_driver', cycle: 1, unit: 'U001' })
    const s2 = selectStateAt(fixtureLine, fixtureLog, 90)
    expect(s2.workers.S01).toMatchObject({ operation: 'O2', cycle: 3, unit: 'U002' })
    expect(s2.workers.S03).toMatchObject({ verb: 'idle', tool: 'none', phase: 0 })
  })
})

describe('units', () => {
  // U1: S01 0..10, S02 starts at 20 (gap 10 > transfer 4 → waits 10..16, travels 16..20).
  // U1: S02 20..30, S03 starts at 32 (gap 2 < 4 → travels the whole gap).
  const log: EventLog = {
    line: 'tiny',
    seed: 1,
    duration: 100,
    events: [
      ev('U1', 'S01', 'start', 0),
      ev('U1', 'S01', 'end', 10),
      ev('U1', 'S01', 'blocked', 10),
      ev('U1', 'S02', 'start', 20),
      ev('U1', 'S02', 'end', 30),
      ev('U1', 'S03', 'start', 32),
      ev('U1', 'S03', 'end', 50),
    ],
  }
  const index = buildIndex(tinyLine, log)
  const at = (t: number) => stateAt(index, t).units.find((u) => u.unit === 'U1')

  it('interpolates travel with a minimum transfer window', () => {
    expect(at(5)).toMatchObject({ station: 'S01', travel: 0, motion: 'processing' })
    expect(at(12)).toMatchObject({ station: 'S01', travel: 0, motion: 'waiting' })
    expect(at(16)).toMatchObject({ station: 'S02', fromStation: 'S01', travel: 0, motion: 'transit' })
    expect(at(18)!.travel).toBeCloseTo(0.5)
    expect(at(19)!.travel).toBeCloseTo(0.75)
    expect(at(20)).toMatchObject({ station: 'S02', travel: 0, motion: 'processing' })
    // Short gap: (t - endA) / (startB - endA)
    expect(at(31)!.travel).toBeCloseTo(0.5)
    expect(at(31)).toMatchObject({ station: 'S03', fromStation: 'S02', motion: 'transit' })
    expect(at(50)).toBeUndefined() // left the line at end of last station
    expect(at(-1)).toBeUndefined()
  })

  it('stage increments as stations complete', () => {
    expect(at(5)!.stage).toBe(0)
    expect(at(10)!.stage).toBe(1)
    expect(at(25)!.stage).toBe(1)
    expect(at(30)!.stage).toBe(2)
    expect(at(40)!.stage).toBe(2)
    expect(completedAt(index, 49)).toBe(0)
    expect(completedAt(index, 50)).toBe(1)
  })

  it('handles rework loops (leak test fail → back to brazing)', () => {
    const rlog: EventLog = {
      line: 'tiny',
      seed: 1,
      duration: 200,
      events: [
        ev('U1', 'S01', 'start', 0),
        ev('U1', 'S01', 'end', 10),
        ev('U1', 'S02', 'start', 15),
        ev('U1', 'S02', 'end', 30),
        ev('U1', 'S03', 'start', 35),
        ev('U1', 'S03', 'end', 60),
        ev('U1', 'S03', 'failed', 60),
        ev('U1', 'S03', 'rework', 60),
        ev('U1', 'S02', 'start', 66),
        ev('U1', 'S02', 'end', 90),
        ev('U1', 'S03', 'start', 95),
        ev('U1', 'S03', 'end', 120),
      ],
    }
    const ri = buildIndex(tinyLine, rlog)
    const u = (t: number) => stateAt(ri, t).units.find((x) => x.unit === 'U1')
    expect(u(61)).toMatchObject({ station: 'S03', motion: 'waiting', stage: 3, reworks: 1 })
    expect(stateAt(ri, 61).stations.S03).toBe('failed')
    expect(u(64)).toMatchObject({ station: 'S02', fromStation: 'S03', motion: 'transit' })
    expect(u(70)).toMatchObject({ station: 'S02', motion: 'processing', stage: 3 })
    expect(u(100)).toMatchObject({ station: 'S03', motion: 'processing', stage: 3, reworks: 1 })
    expect(u(120)).toBeUndefined()
    expect(stateAt(ri, 70).stations.S03).toBe('failed')
    expect(stateAt(ri, 95).stations.S03).toBe('working')
    expect(ri.failureBands).toEqual([[60, 95]])
    expect(Array.from(ri.reworkTimes)).toEqual([60])
  })

  it('rework without an end event closes the visit at the rework time', () => {
    const rlog: EventLog = {
      line: 'tiny',
      seed: 1,
      duration: 100,
      events: [ev('U1', 'S03', 'start', 0), ev('U1', 'S03', 'failed', 20), ev('U1', 'S03', 'rework', 20), ev('U1', 'S02', 'start', 30)],
    }
    const ri = buildIndex(tinyLine, rlog)
    const p = stateAt(ri, 25).units[0]
    expect(p).toMatchObject({ station: 'S03', motion: 'waiting', reworks: 1 })
    expect(stateAt(ri, 28).units[0]).toMatchObject({ station: 'S02', fromStation: 'S03', motion: 'transit' })
  })
})

describe('multi-bay and synthetic logs', () => {
  const line = makeSyntheticLine()
  const log = makeSyntheticLog(line, { seed: 7, duration: 7200 })
  const index = buildIndex(line, log)

  it('generator is deterministic and sorted', () => {
    const again = makeSyntheticLog(line, { seed: 7, duration: 7200 })
    expect(again.events).toEqual(log.events)
    for (let i = 1; i < log.events.length; i++) expect(log.events[i].time).toBeGreaterThanOrEqual(log.events[i - 1].time)
    expect(log.events.some((e) => e.event === 'rework')).toBe(true)
    expect(log.events.some((e) => e.event === 'blocked')).toBe(true)
  })

  it('exposes per-bay workers and bay states', () => {
    let sawBoth = false
    for (let t = 600; t < 7200; t += 37) {
      const s = stateAt(index, t)
      expect(s.workers['S09#0']).toBeDefined()
      expect(s.workers['S09#1']).toBeDefined()
      expect(s.workers.S09.bay).toBe(0)
      if (s.bays['S09#0'] === 'working' && s.bays['S09#1'] === 'working') sawBoth = true
      if (s.workers['S09#1'].operation) expect(s.workers['S09#1'].bay).toBe(1)
    }
    expect(sawBoth).toBe(true)
  })

  it('stage never decreases and units move forward through the line', () => {
    const last = new Map<string, number>()
    for (let t = 0; t < 7200; t += 3) {
      for (const u of stateAt(index, t).units) {
        expect(u.stage).toBeGreaterThanOrEqual(last.get(u.unit) ?? 0)
        expect(u.travel).toBeGreaterThanOrEqual(0)
        expect(u.travel).toBeLessThanOrEqual(1)
        last.set(u.unit, u.stage)
      }
    }
    // Units leave the line on completing the last station, so the highest visible stage is n - 1.
    expect(Math.max(...last.values())).toBe(line.stations.length - 1)
  })

  it('utilisation, throughput and density are consistent', () => {
    const t = 7200
    const done = completedAt(index, t)
    expect(done).toBeGreaterThan(40)
    expect(stateAt(index, t).completed).toBe(done)
    for (const s of line.stations) {
      const u = utilisationAt(index, s.id, t)
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThanOrEqual(1)
    }
    const d = eventDensity(index, 100)
    expect(d.reduce((a, b) => a + b, 0)).toBe(log.events.length)
  })
})

describe('performance', () => {
  const line = makeSyntheticLine()
  const log = makeSyntheticLog(line, { seed: 3, units: 720 })

  it('buildIndex on a 50k-event log < 300 ms, stateAt < 0.5 ms average', () => {
    expect(log.events.length).toBeGreaterThanOrEqual(50_000)
    buildIndex(line, makeSyntheticLog(line, { seed: 4, units: 50 })) // warm-up JIT
    const t0 = performance.now()
    const index = buildIndex(line, log)
    const buildMs = performance.now() - t0
    const r = rng('perf', 1)
    const N = 2000
    const times = Array.from({ length: N }, () => r() * index.duration)
    const t1 = performance.now()
    let units = 0
    for (const t of times) units += stateAt(index, t).units.length
    const perCall = (performance.now() - t1) / N
    console.log(`[perf] events=${log.events.length} units=${index.units.length} buildIndex=${buildMs.toFixed(1)}ms stateAt=${(perCall * 1000).toFixed(1)}µs avgUnits=${(units / N).toFixed(1)}`)
    expect(buildMs).toBeLessThan(300)
    expect(perCall).toBeLessThan(0.5)
  })
})

describe('store', () => {
  it('advance loops or stops at the duration', () => {
    const s = usePlayback.getState()
    s.load('current', fixtureLine, fixtureLog)
    expect(usePlayback.getState().duration).toBe(fixtureLog.duration)
    s.setTime(180)
    s.setLoop(true)
    usePlayback.getState().advance(10)
    expect(usePlayback.getState().simTime).toBeCloseTo(6)
    s.setLoop(false)
    s.setPlaying(true)
    s.setTime(180)
    usePlayback.getState().advance(10)
    expect(usePlayback.getState()).toMatchObject({ simTime: 184, playing: false })
    usePlayback.getState().togglePlaying()
    expect(usePlayback.getState()).toMatchObject({ simTime: 0, playing: true })
  })
})
