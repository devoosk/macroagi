// Redesign 1: kit/eliminate the walk and search waste, robot cells at compressor mount and casing,
// and parallel test bays (leak test x2, run test x3) with decoupling buffers.

import type { Line, Operation, Station } from '../../app/src/contracts/types'
import { S, buildLine, layoutX, round1 } from './line'

/** Ops removed by the kit and flow-rack levers. */
const ELIMINATED = ['O01', 'O02', 'O24']
const ROBOT_STATIONS = ['S03', 'S08']
const BAYS: Record<string, number> = { S05: 2, S09: 3 }
/** Robot time vs human time once the part is fixtured/presented (mean factor, sd factor). */
const ROBOT_TIME = { mean: 0.9, sd: 0.4 }

export function buildRedesign(): Line {
  const base = buildLine()

  const operations: Operation[] = base.operations
    .filter((o) => !ELIMINATED.includes(o.id))
    .map((o) => {
      if (o.id === 'O03') {
        // Sequenced kit arrives pre-picked per unit: only a scan-and-pick from the kit cart remains.
        return {
          ...o,
          name: 'Pick sequenced kit from kit cart',
          time: Object.fromEntries(
            Object.entries(o.time).map(([v, t]) => [v, { mean: S(t.mean.value * 0.7), sd: S(t.sd.value * 0.6) }]),
          ),
        }
      }
      if (!ROBOT_STATIONS.includes(o.station)) return o
      return {
        ...o,
        time: Object.fromEntries(
          Object.entries(o.time).map(([v, t]) => [
            v,
            {
              mean: S(t.mean.value * ROBOT_TIME.mean, 'estimate (robot, fixtured part)'),
              sd: S(t.sd.value * ROBOT_TIME.sd, 'estimate (robot, fixtured part)'),
            },
          ]),
        ),
      }
    })

  const keep = new Set(operations.map((o) => o.id))
  const edges = base.edges.filter((e) => keep.has(e.from) && keep.has(e.to))

  const extraWidth: Record<string, number> = { S05: 3, S09: 6 }
  const xs = layoutX(base.stations, extraWidth)
  const stations: Station[] = base.stations.map((st, i) => {
    const s: Station = {
      ...st,
      operations: st.operations.filter((id) => keep.has(id)),
      staff: ROBOT_STATIONS.includes(st.id) ? 'robot' : 'human',
      x: round1(xs[i]),
      bays: BAYS[st.id] ?? 1,
    }
    // Decoupling buffers in front of and behind the test bays.
    if (st.id === 'S05' || st.id === 'S09') {
      s.bufferBefore = 2
      s.bufferAfter = 2
    }
    return s
  })

  return {
    ...base,
    id: 'r290_redesign_1',
    name: 'R290 monobloc outdoor unit — redesign 1 (kitted, robot cells, parallel test bays)',
    operations,
    edges,
    stations,
    variants: base.variants.map((v) => ({ ...v, operations: v.operations.filter((id) => keep.has(id)) })),
    appliedLevers: ['L_kit', 'L_flowrack', 'L_comp_fixture', 'L_panel_g2r', 'L_test_bays'],
  }
}
