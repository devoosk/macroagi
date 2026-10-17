# MacroAGI

MacroAGI v0 turns one existing assembly line into ranked, robot-ready redesigns and a staged migration plan. The full plan is in `docs/MacroAGI — Technical Implementation Plan (1).md`; read it before making large changes.

The hackathon reference line is an R290 monobloc heat-pump outdoor unit: 11 stations, about 20 operations, and three variants (6, 9 and 12 kW).

## Repo layout
- `capture/`, `graph/`, `capability/`, `optimize/`, `simulate/`: Python. Each reads and writes JSON contracts.
- `app/`: React + Vite + TypeScript front end. Contains the react-three-fiber 3D line render, the capture cameras and the demo UI.
  - `app/src/contracts/types.ts`: the TypeScript mirror of the JSON contracts. This is the source of truth for the front end.
  - `app/src/playback/`: event-log indexing and the time store, which is the only clock.
  - `app/src/scene/{environment,stations,units,workers}/`: the 3D scene.
  - `app/src/capture/`: CCTV and first-person cameras, plus capture mode.
  - `app/src/ui/`: demo UI (scrubber, speed, split view).
  - `app/scripts/export-frames.ts`: Puppeteer frame export.
  - `app/public/data/`: `line.json` and the `events_*.json` files the app loads.
- `tools/gen/`: generator for dummy line and event data. It stands in until the real SimPy output exists.

## Shared contracts
| File | Contents |
| --- | --- |
| `line.json` | Process graph (operations, hard/soft precedence edges, parts, stations with x/y/rot/kind, variants, levers). Every number has a `source`. |
| `events_<line>.json` | One row per event: unit, variant, station, event (`start`, `end`, `blocked`, `starved`, `failed`, `rework`, plus `op_start`/`op_end` with `operation`), time in seconds. |
| `capability.json` | Robot success range (Beta, p05/p95) and robot time per operation, baseline and per single lever, plus the prior table and lever costs. Written by `uv run python -m capability app/public/data/line.json`. |
| `line_redesign_<n>.json` | Up to three redesigns (1 = cheapest) in the `line.json` schema, plus `operations[].mode` and a `design` summary. Written by `uv run python -m optimize app/public/data/line.json` (`--scenarios` also writes `line_scenario_{arms_only,humanoids_only,mixed}.json`). Stations carry the rented `robot` type and `sharedWith` for a mobile robot serving two stations; `design` has `fleet`, `capex` and `rentPerMonth`. |
| `segments.json` → `line_v2.json` | Item 5 rebuilds the line from VLM segments alone (`uv run python -m graph segments.json --catalogue line.json -o line_v2.json`; only parts, variants and the station registry are read from the catalogue). Also writes `graph_evidence.json` for the edge review screen. `python -m graph.score` scores it against the hidden truth; `python -m graph.synth` fakes segments from an event log until item 3 lands. |
| `humanoid_sweep.json` | What-if grid over humanoid rent, speed and precision: robots in the best mixed-fleet design at each point, and the break-even. Written by `uv run python -m optimize.whatif line.json`. |
| `capability/robots.json` | Simulated MicroAGI rental catalogue (robot types, payload, precision, tools, skills, rent per month). Also copied into `capability.json` as `robots`. |
| `results.json` | Per design: throughput, capex, required robot reliability, sweep curve, migration stages. |

## Event log conventions (what the 3D render expects from `simulate/`)
`tools/gen/simulate.ts` is the reference implementation until the SimPy simulator replaces it. SimPy output must follow the same rules:
- **Order and time zero:** events are sorted by `time`. The log starts from an empty line at t=0, including warm-up, and `duration` covers the whole log.
- **Operation rows:** every operation emits `op_start` and `op_end` with an `operation` field. Within a station, the order of operations joined only by soft edges is reshuffled between cycles.
- **Station state:** a station (or bay) is in the state of its last `start`, `end`, `blocked` or `starved` row. `starved` rows have `unit` and `variant` set to `""`.
- **Bays:** `bay` is set on every event at a station with `bays > 1`, and left out otherwise.
- **Leak-test failure:** emits `failed` at the leak test, then `rework` at brazing with no bay, and the unit loops back to brazing.
- **Run-test failure:** emits `failed` and `rework` at the run test, and the unit is re-tested in the same bay.
- **Buffers:** the buffer between stations i and i+1 holds `bufferAfter(i) + bufferBefore(i+1)` units. 0 means a coupled line.
- **Robot failures:** these currently emit no event; the operation just takes longer by the recovery time.
- **Station placement:** stations need `x`, `y`, `rot`, `kind` and `staff`. Parallel bays stack along station-local -z, 3.1 m apart (`app/src/lib/layout.ts`).

## Hard rules
1. **Everything is deterministic.** Render state is a pure function of `(simTime, events, seed)`. Do not use `Math.random`, `Date.now`, or `useFrame` delta/clock in render paths. Use the seeded RNG (`app/src/lib/rng.ts`) and `simTime` from the playback store. Scrubbing and frame export must reproduce identical frames.
2. **Capture views leak no answers.** In capture mode, render no text, `<Html>`, `<Text>`, labels, state colours or HUD. The VLM sees pixels only.
3. **Every number carries a `source`.** Use a citation or the literal `"estimate"`.
4. **Detail budget.** Build geometry procedurally (no external model downloads) and use PBR materials. Instance anything repeated more than 20 times. Target 60 fps in demo mode; capture mode may run slower.

## Python (run at repo root)
- One `pyproject.toml` with uv: `uv sync`, `uv run pytest`, `uv run python -m <module>`.

## Commands (run in `app/`)
- `npm run dev`: start the dev server. `?mode=capture&cam=<id>` gives a single camera with no overlays.
- `npm run typecheck`, `npm run build`, `npm test` (vitest)
- `npm run gen`: regenerate dummy `line.json` and event logs
- `npm run export -- --cam cctv:S05 --from 0 --to 120`: export frames at 1 fps of sim time to `capture/frames/`
