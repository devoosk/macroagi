// Entry point for `npm run gen` (run from app/). Writes line + event logs + results to app/public/data/.

import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DesignResult, EventLog, Line, Results, SweepPoint } from '../../app/src/contracts/types'
import { buildLine, round1, S } from './line'
import { buildRedesign } from './redesign'
import { simulate, type SimOptions, type SimResult } from './simulate'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../../app/public/data')

const SEED = 42
const WARMUP = 1800
const DURATION = WARMUP + 7200

/** Robot settings: the redesign has fixtures/kits and a human fallback; naive automation of the current line has neither. */
const REDESIGN_ROBOT = { robotFailMultiplier: 1, robotRecovery: 30 }
const NAIVE_ROBOT = { robotFailMultiplier: 3, robotRecovery: 120, robotStations: ['S03', 'S08'] }
const LOG_RELIABILITY = 0.98

function writeJson(name: string, data: unknown, eventLog = false) {
  const path = join(OUT, name)
  let text: string
  if (eventLog) {
    // One event per line: diff-friendly and compact.
    const log = data as EventLog
    const { events, ...head } = log
    const headJson = JSON.stringify(head)
    text =
      headJson.slice(0, -1) +
      ',"events":[\n' +
      events.map((e) => JSON.stringify(e)).join(',\n') +
      '\n]}\n'
  } else {
    text = JSON.stringify(data, null, 2) + '\n'
  }
  writeFileSync(path, text)
  return path
}

const pct = (x: number) => (x * 100).toFixed(1).padStart(6) + '%'

function sanityTable(title: string, r: SimResult) {
  console.log(`\n== ${title} ==`)
  console.log('station  name                      bays   util  blocked  starved  cycles')
  for (const s of r.stats) {
    console.log(
      `${s.id.padEnd(8)} ${s.name.padEnd(25)} ${String(s.bays).padStart(4)} ${pct(s.utilisation)} ${pct(s.blocked)} ${pct(
        s.starved,
      )} ${String(s.cycles).padStart(7)}`,
    )
  }
  console.log(`throughput: ${r.throughputPerHour.toFixed(2)} units/h  (completed ${r.completed}, test failures ${r.failures})`)
}

const RELIABILITIES = [0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 0.999]
const SWEEP_SEEDS = 6
const SWEEP_DURATION = 1800 + 4 * 3600

function sweep(line: Line, robot: Partial<SimOptions>): SweepPoint[] {
  return RELIABILITIES.map((reliability) => {
    let tp = 0
    for (let k = 0; k < SWEEP_SEEDS; k++) {
      tp += simulate(line, {
        seed: 1000 + k,
        duration: SWEEP_DURATION,
        warmup: 1800,
        record: false,
        robotReliability: reliability,
        ...robot,
      }).throughputPerHour
    }
    return {
      reliability,
      throughput: S(
        tp / SWEEP_SEEDS,
        `tools/gen sim: mean of ${SWEEP_SEEDS} x 4 h runs, seeds 1000-${999 + SWEEP_SEEDS}`,
      ),
    }
  })
}

/** Lowest swept reliability at which throughput reaches 97% of the plateau (r = 0.999). */
function requiredReliability(points: SweepPoint[]): number {
  const plateau = points[points.length - 1].throughput.value
  return points.find((p) => p.throughput.value >= 0.97 * plateau)?.reliability ?? 0.999
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const current = buildLine()
  const redesign = buildRedesign()

  const simCur = simulate(current, { seed: SEED, duration: DURATION, warmup: WARMUP, robotReliability: LOG_RELIABILITY })
  const simRed = simulate(redesign, {
    seed: SEED,
    duration: DURATION,
    warmup: WARMUP,
    robotReliability: LOG_RELIABILITY,
    ...REDESIGN_ROBOT,
  })

  const files = [
    writeJson('line.json', current),
    writeJson('line_redesign_1.json', redesign),
    writeJson('events_current.json', simCur.log, true),
    writeJson('events_redesign_1.json', simRed.log, true),
  ]

  sanityTable(`${current.id} (seed ${SEED}, ${WARMUP}s warm-up + 7200s)`, simCur)
  sanityTable(`${redesign.id} (seed ${SEED}, robot reliability ${LOG_RELIABILITY})`, simRed)

  console.log('\nreliability sweep...')
  const sweepCur = sweep(current, NAIVE_ROBOT)
  const sweepRed = sweep(redesign, REDESIGN_ROBOT)
  const reqCur = requiredReliability(sweepCur)
  const reqRed = requiredReliability(sweepRed)
  console.log('  r       current(naive robots)  redesign_1')
  RELIABILITIES.forEach((r, i) =>
    console.log(
      `  ${r.toFixed(3)}   ${sweepCur[i].throughput.value.toFixed(2).padStart(8)}               ${sweepRed[i].throughput.value
        .toFixed(2)
        .padStart(8)}`,
    ),
  )
  console.log(`  required reliability (97% of plateau): current ${reqCur}, redesign ${reqRed}`)

  const leverCost = redesign.levers
    .filter((l) => redesign.appliedLevers?.includes(l.id))
    .reduce((a, l) => a + l.cost.value, 0)
  const robotCells = redesign.stations.filter((s) => s.staff === 'robot').length
  const ROBOT_CELL_COST = 85000

  const designs: DesignResult[] = [
    {
      design: current.id,
      throughput: S(simCur.throughputPerHour, `tools/gen sim seed ${SEED}, 2 h after warm-up`),
      capex: S(0, 'estimate (existing line)'),
      requiredReliability: S(
        reqCur,
        'tools/gen sweep: naive robots dropped into S03/S08 without fixtures or fallback (3x failure rate, 120 s recovery); 97% of plateau',
      ),
      sweep: sweepCur,
      stages: [],
    },
    {
      design: redesign.id,
      throughput: S(simRed.throughputPerHour, `tools/gen sim seed ${SEED}, 2 h after warm-up, robot reliability ${LOG_RELIABILITY}`),
      capex: S(
        leverCost + robotCells * ROBOT_CELL_COST,
        `estimate (applied levers ${round1(leverCost)} + ${robotCells} robot cells x ${ROBOT_CELL_COST})`,
      ),
      requiredReliability: S(reqRed, 'tools/gen sweep: fixtured parts, human fallback (30 s recovery); 97% of plateau'),
      sweep: sweepRed,
      stages: [
        {
          id: 'M1',
          name: 'Kit and flow rack: remove walk and search',
          stations: ['S01', 'S10'],
          gate: 'Kit accuracy at least 99.5% for one week',
        },
        {
          id: 'M2',
          name: 'Parallel test bays with decoupling buffers',
          stations: ['S05', 'S09'],
          gate: 'Second leak bay and two extra run-test bays hold 30 units/h for one shift',
        },
        {
          id: 'M3',
          name: 'Robot cells at compressor mount and casing',
          stations: ['S03', 'S08'],
          gate: `Robot cell holds ${(reqRed * 100).toFixed(0)}% success for one week`,
        },
      ],
    },
  ]
  const results: Results = { designs }
  files.push(writeJson('results.json', results))

  console.log(`\nthroughput: current ${simCur.throughputPerHour.toFixed(2)}/h, redesign ${simRed.throughputPerHour.toFixed(2)}/h`)
  console.log(`events: current ${simCur.log!.events.length}, redesign ${simRed.log!.events.length}`)
  for (const f of files) console.log(`  ${(statSync(f).size / 1024).toFixed(0).padStart(6)} KB  ${f}`)
}

main()
