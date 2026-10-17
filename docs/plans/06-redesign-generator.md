# Item 6: Redesign generator + CP-SAT — implementation plan

Status: built (v0). Oskari approved the defaults below on 2026-10-17. Changes while building: torch and hose ops are pinned like test ops (fixed equipment); waste ops are always eliminated once a lever allows it; the tie-breaker minimises moved operations; designs identical to the current line are skipped. After testing on the real R290 line (25 ops): the line's own levers are used when it has any (each paid once, however many ops it covers), and ops then move station only under a regroup lever; takt is mixed-model (mix-weighted load ≤ takt, any single variant ≤ takt × 1.10); robot candidates use the median of the success range, not p05 (v0 ranges are too wide for p05); robot cell cost is 85 kEUR, as in tools/gen; robot ops carry the robot time in `time` because the simulator reads it. Builds on `capability/` (item 2): `estimate`, `applicable_levers`, `clears`, `lever_feature_changes`, `LEVER_COSTS`.

## What it does

Reads `line.json`, writes up to three redesigns `line_redesign_1..3.json` in the same `Line` schema: operations reassigned to stations, station `staff`/`bays`/buffers updated, `levers` filled with lever instances and `appliedLevers` listing the used ones. Item 7 simulates and ranks them.

## Layout

```
optimize/
  costs.py       # HUMAN_STATION_COST, ROBOT_CELL_COST, FLOOR; each {value, source: "estimate"}
  generator.py   # line -> candidates: bay splits, lever instances, allowed modes per op, lever bundles
  model.py       # CP-SAT: solve(line, candidates, bundle) -> Solution | None
  export.py      # Solution -> Line dict
  __main__.py    # python -m optimize app/public/data/line.json -o app/public/data/ [--floor 0.90]
tests/optimize/
```

New dependency: `ortools`.

## Generator rules (deterministic, no solver)

1. **Split test stations into bays.** For `evacuation_leak_test` and `run_test` stations whose worst-variant load exceeds takt: `bays = ceil(load / takt)`, buffers before/after at least 2, recorded as a `decouple` lever instance on the station.
2. **Kit or eliminate walk and search.** For waste ops: an `eliminate` instance, else `kit` (search) or `goods_to_robot` (walk).
3. **Robot candidates.** If `clears(estimate(op, line), floor)`: mode `robot`. Otherwise try single applicable levers, then pairs; the cheapest set that clears becomes the op's `robot_lever` option. Store `robot_time` per variant from that estimate.
4. **Lever instances:** id `L_<type>_<opId>` (or `L_decouple_<stationId>`), `cost` from `LEVER_COSTS`, `operations: [opId]`, `featureChanges` from `lever_feature_changes`.
5. **Allowed stations:** current station or a neighbour (±1, the regroup freedom). Test ops are pinned. Only hard edges are enforced.
6. **Nested lever bundles:** B0 none (re-balance only), B1 decouple, B2 + waste levers, B3 + fixture/kit on robot candidates, B4 + goods_to_robot on the rest. The solver may use any lever in the bundle and pays only for those it uses.

## CP-SAT model (one solve per bundle)

Times integerised to 0.1 s, costs to whole euros.

- Variables: `z[o,s,m]` for allowed station s and mode m in {human, robot, robot_lever}; `e[o]` eliminated (only if its eliminate instance is in the bundle); `r[s]` robot station; `u[s]` station used; `h[s] >= u[s] - r[s]`; `use[l]` lever used.
- Each op placed once: `sum z[o,·,·] + e[o] = 1`.
- Hard precedence: `pos[o] = sum s_idx * z[o,s,m]`; `pos[a] <= pos[b]` for each hard edge, enforced only when neither is eliminated.
- Takt per variant: `sum t[o,v,m] * z[o,s,m] <= takt * bays[s]`, with human mean time for human mode and `robot_time[v]` for robot modes.
- All-robot or all-human: `z[o,s,human] => not r[s]`, `z[o,s,robot*] => r[s]`, `z => u[s]`.
- Robot modes only above the floor: the generator decides; forbidden modes are fixed to 0.
- Lever use: `z[o,s,robot_lever] => use[l]` for its lever set; `e[o] => use[L_eliminate_o]`; decouple instances in the bundle fixed to used.
- Objective: `HUMAN_STATION_COST * sum h + ROBOT_CELL_COST * sum r + sum cost[l] * use[l]`, small tie-breaker on `sum pos`.
- `num_workers=1`, fixed `random_seed`: deterministic, optimal in milliseconds at this size.

## Best three

Solve B0..B4, drop duplicates (same robot-station set and applied levers), sort by objective, keep the top three. If fewer than three are distinct, re-solve the best bundle with a no-good cut on the previous `r[s]` assignment. Item 7's migration stages reuse `solve()` with stations outside the stage fixed.

## Output

Deep copy of `line` with: `operations[].station` reassigned and a new optional `mode: 'human' | 'robot' | 'eliminated'` (time stays the human time; simulate calls `capability.estimate` with the op's applied levers for robot times); stations' `operations` in topological order, `staff`, `bays`, buffers; `levers` and `appliedLevers`; eliminated ops kept with `mode: 'eliminated'` so the app can badge them, and dropped from `variants[].operations`. Every number keeps a `source`.

## Tests

Bay split on a dummy line with low takt; hard precedence holds; no mixed stations; every robot op clears the floor with its levers; eliminate only on waste; load ≤ takt × bays per variant; byte-identical output on two runs; infeasible takt returns None with a message; nested bundles never get worse.

## Defaults chosen (change if wrong)

1. Add `ROBOT_CELL_COST` so robots aren't free in the objective.
2. Costs in euros over a 3-year horizon: `HUMAN_STATION_COST` = operator cost × shifts × 3 years.
3. Single floor 0.90 for all designs, tested on p05.
4. Stations can move ops ±1 station; no new stations except test bays.
5. Takt check uses mean times; variance is left to SimPy.
