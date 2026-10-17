// Runs tools/gen/simulate.ts for the parity test. Usage (from app/): tsx ../tests/simulate/ts_reference.ts <line.json> <seeds>
// Prints mean throughput and per-station utilisation / blocked as JSON.

import { readFileSync } from 'node:fs'
import type { Line } from '../../app/src/contracts/types'
import { simulate } from '../../tools/gen/simulate'

const line = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Line
const seeds = Number(process.argv[3] ?? 50)
const shift = 8 * 3600
let tp = 0
const util: Record<string, number> = {}
const blocked: Record<string, number> = {}
for (let k = 0; k < seeds; k++) {
  const r = simulate(line, { seed: 1000 + k, duration: 1800 + shift, warmup: 1800, record: false })
  tp += r.throughputPerHour / seeds
  for (const s of r.stats) {
    util[s.id] = (util[s.id] ?? 0) + s.utilisation / seeds
    blocked[s.id] = (blocked[s.id] ?? 0) + s.blocked / seeds
  }
}
console.log(JSON.stringify({ throughput: tp, util, blocked }))
