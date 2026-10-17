# Item 6b: "Rebuild for robots" mode — plan

Status: steps 1-3 built (2026-10-17). Oskari's direction: rebuild legacy factories at the organisational level with Atlas robots, the middle ground between one-robot-per-worker retrofits and a new factory; move fast. Defaults taken: up to 1.5x today's station count, fixed equipment kept, 3D models handed to the visuals thread. Built differently from the proposal: a slot's bays and staffing are one choice (human or robot type x 1-3 bays), each extra bay costs one decouple lever; mobile robots do not share stations in this mode; migration stages swap line segments front to back and only the final line is simulated.

## Where the optimiser is today

It follows plan step 6: a station and a mode per operation, hard precedence, takt per variant, all-robot or all-human stations, robot modes only above the floor, minimise people plus lever cost, solve per lever bundle and keep the best three. It goes further in places (rented robot types, mobile robots, mixed-model takt, line-provided levers). But it is a **rebalance of today's layout**:
- The station list is fixed (today's 11). Only test stations can grow parallel bays.
- An operation moves at most one station, and only under a regroup lever.
- Soft edges are ignored rather than exploited across the line.

Oskari's four points ask for a **rebuild**: the station count, order and shape are open. Both modes are useful in the demo, and they map onto the pitch: the rebalance is "wave one" (MicroAGI puts robots where humans were), and the rebuild is MacroAGI (redesign the whole production for robots). The rebalance results are the baseline the rebuild is compared against, so the rebuild is the heart of the demo.

## Proposal

### 1. Optimiser: open slots (`optimize/rebuild.py`)
- **Slots:** the line becomes up to N slots in a row, by default today's count plus 50% (11 → 16). Each slot is empty, a human station, or a robot cell of one rented type.
- **Operations:** each one goes to any slot. Only the transitive closure of the hard edges constrains the order, so soft edges are freedom across the whole line, not just within a station.
- **Fixed equipment:** torch brazing and the test rigs stay as they are, because nothing in the catalogue can do them. They keep their relative order, but their slot positions are free.
- **Parallel cells:** any slot can take 1–3 bays. Each bay costs one more robot (or person), plus a buffer. This covers "parallel robot cells", not just test bays.
- **Objective and constraints:** the same as today (people, rent, integration and levers over 3 years; mixed-model takt; floor). This keeps one CP-SAT model of about 25 ops × 16 slots × ~6 options, which is still small.

### 2. Layout output
- **Ids and kinds:** slots that are used become stations `C01..Cn` in line order. A human station keeps the kind of the old station most of its ops came from. A robot cell gets a new kind, `robot_cell`, plus its `robot` type and bays.
- **Positions:** x from the slot index at today's pitch (4 m), bays stacked along −z as `app/src/lib/layout.ts` does, and the off-line fallback station behind the cells.
- **Traceability:** each new station lists `replaces: [old station ids]`. Migration stages then group by segments of the old line, and the app can show "these 3 stations became this cell".

### 3. 3D view (Tatu's area, overlaps the "Demo visuals plan" thread)
- **`robot_cell` model per robot class:** arm on a pedestal with guarding, SCARA, dual-arm and humanoid at a bench. Tatu already has a robot primitive in `app/src/scene/stations/lib/robot.tsx`.
- **Free placement:** the scene has to place stations from x/y instead of assuming today's 11 kinds in order.
- This is not mine to build. I'd supply the contract and sample files, and Tatu or the visuals thread would build the models.

### 4. Wiring: optimiser → simulator → app
- **Done today for rebalance designs:** `python -m optimize.compare` exports each solver design with a fallback station, simulates it with Tatu's SimPy simulator, sweeps reliability, plans the stages one at a time, and merges everything into `results.json` with event logs for the render.
- **Rebuild designs** go through the same pipeline. The simulator already reads x/y-free station lists, bays, robot types and the fallback.
- **Still open:** which files the app shows. That's the pending question on whether the solver owns `line_redesign_*`. The demo player itself belongs to the "Demo visuals plan" thread.

## Steps (each a commit)
1. `rebuild.py`: the slot model, with tests (hard order holds, fixed equipment kept, bays, deterministic).
2. Export the new stations with kinds, positions and `replaces`, plus contract changes (`StationKind` gains `robot_cell`; `Station.replaces`).
3. Run it through `optimize.compare` and add a `rebuild` design to `results.json` next to the rebalance designs.
4. Hand the contract and a sample `line_rebuild_1.json` to the 3D side.

## Questions
1. May the rebuilt line be longer than today's (by default up to 16 stations), or should it fit today's floor length?
2. Should the test rigs and brazing stay as fixed equipment? I'd say yes, since no catalogue robot can braze or run the rigs.
3. Should Tatu build the robot-cell 3D models, or should I ask the visuals thread to?
