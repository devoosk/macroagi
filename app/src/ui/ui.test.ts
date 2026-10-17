import { describe, expect, it } from 'vitest'
import { makeSyntheticLine } from '../playback/synthetic'
import { formatHMS, stationLevers } from './theme'
import { tickLabel, tickMarks } from './Transport'
import { useDirector } from './director'

describe('ui helpers', () => {
  it('formats sim time as hh:mm:ss', () => {
    expect(formatHMS(0)).toBe('00:00:00')
    expect(formatHMS(59.9)).toBe('00:00:59')
    expect(formatHMS(3725)).toBe('01:02:05')
    expect(formatHMS(-5)).toBe('00:00:00')
  })

  it('tick marks are evenly spaced and inside the log', () => {
    const t = tickMarks(7200, 1000)
    expect(t.length).toBeGreaterThan(3)
    expect(t.length).toBeLessThanOrEqual(11)
    expect(t.every((x) => x > 0 && x < 7200)).toBe(true)
    expect(tickLabel(4500, 7200)).toBe('1:15')
    expect(tickLabel(90, 184)).toBe('1:30')
    expect(tickMarks(0, 1000)).toEqual([])
  })

  it('maps applied levers to stations by operation', () => {
    const cur = makeSyntheticLine()
    expect(stationLevers(cur, 'S01')).toEqual([])
    const red = makeSyntheticLine({ redesign: true })
    expect(stationLevers(red, 'S01').map((l) => l.type)).toEqual(['kit'])
    expect(stationLevers(red, 'S05').map((l) => l.type)).toEqual(['decouple'])
    expect(stationLevers(red, 'S06')).toEqual([])
  })

  it('director store transitions', () => {
    const d = useDirector.getState()
    d.flyTo('S05')
    expect(useDirector.getState()).toMatchObject({ mode: 'station', station: 'S05' })
    const seq = useDirector.getState().seq
    useDirector.getState().follow()
    expect(useDirector.getState()).toMatchObject({ mode: 'follow', station: undefined, seq: seq + 1 })
    useDirector.getState().overview()
    expect(useDirector.getState().mode).toBe('overview')
  })
})
