# MacroAGI — Technical Implementation Plan

Oct 17, 2026 · @Tatu

## Goal and scope

MacroAGI v0 turns one existing assembly line into a ranked set of robot-ready redesigns and a staged migration plan, from about two weeks of captured line data. We build what goes into the simulation and what comes out of it; we do not build the simulator.

**In scope for v0:** existing factories. We go into running plants and redesign their mixed-model manual or semi-manual assembly lines with 10–30 stations and cycle times of 30 seconds to 5 minutes.

**Out of scope for v0:** a physics digital twin, training robot policies, and the live line runtime (layer 3). We export to Plant Simulation or Omniverse where customers have them, and partner with integrators or robot companies for the cells themselves.

## Architecture

&#91;embedded content: MacroAGI v0 architecture · in, middle, out\]

Line capture reuses MicroAGI’s capture devices and the factory’s existing surveillance cameras, so we install no new camera network. We build line capture, the process-graph builder, the capability model, the redesign generator and both outputs; the optimiser (CP-SAT) and simulator (SimPy) are open-source. The generator, CP-SAT and SimPy run in a loop until the best redesigns stop improving, and pilot results flow back into the capability model.

## Core data model: the process graph

Everything reads and writes one process graph per line, stored as JSON (networkx in code, Postgres JSONB at rest). The key idea is splitting precedence into **hard** edges (physically required) and **soft** edges (just how the line happens to run today); the soft edges are where redesign freedom lives.

| Entity | Key fields | Why it matters |
| --- | --- | --- |
| Operation | id, verb class (pick, place, insert, screw, connect, inspect, walk, search), parts, tool, time mean and variance per variant, current station | The unit everything is assigned, eliminated or re-cut |
| Precedence edge | from, to, type (hard or soft), confidence, evidence (BOM, video order variance, engineer) | Defines the real degrees of freedom |
| Part | id, size, mass, rigidity, tolerance, presentation (loose bin, tray, fixtured, kitted) | Drives robot difficulty and which levers apply |
| Station | id, operations, staff or robot, takt, buffer before and after | Current and generated line layouts |
| Variant | id, mix share, which operations it uses | Mixed-model load and balancing |
| Design lever | type (eliminate, fixture, kit, goods-to-robot, regroup, decouple), cost, affected operations, feature changes | What the generator can change |

Operations tagged walk or search are flagged as human-constraint waste: candidates to eliminate rather than automate.

## Robot-capability model

The model predicts, for every operation, how often a robot will succeed and how long it will take, both as the task stands today and after each design lever. It always outputs a range (a Beta distribution), never a single number, so the optimiser and simulation carry the uncertainty honestly.

1. **v0 (hackathon): rules and priors.** Score each operation on verb class, part rigidity, tolerance, presentation, force, visual ambiguity and variant count, with prior ranges set by engineer judgement. Levers change features, not numbers: a fixture makes orientation known, kitting removes search.
2. **v1 (MVP): bench calibration.** Run 50–200 trials per common operation class (insert, screw, place) on one test cell and update the ranges.
3. **v2 (pilot onward): field learning.** Every robot attempt on a pilot line is logged with its outcome and updates the model.

### How we measure success

An attempt counts as a success only if the robot finishes the operation within its time budget, the result passes the station’s quality check, and no person touched the robot or the part. Everything else is a failure, logged with its cause: grasp, alignment, timeout, quality reject or safety stop.

| Level | What we measure | Target |
| --- | --- | --- |
| Operation | Success rate with a 95% interval, from logged attempts | ±5 points or tighter (200 attempts at 90% success gives about ±4) |
| Model | Calibration: predicted vs observed success across all operations | Average gap of 5 points or less |
| Lever | Predicted vs measured gain from each design change | Right direction every time; size within ±5 points |
| Line | Predicted vs actual throughput, and human interventions per shift | Throughput within ±10% |

### The moat

The solver, the simulator and generic video of people working are not a moat: CP-SAT and SimPy are free, and MicroAGI and others already record how people work. Our moat is the data nobody else records, and the right to reuse it.

1. **Lever-outcome data.** For every operation we log how a robot performed before and after a specific design change. Integrators change stations but don’t record the effect; MicroAGI records how humans do the work, not how redesign changes robot success. This dataset tells you what to change, not just what to automate.
2. **Pooled priors, private raw data.** Customers own their video and line data. Contracts give us the right to anonymised outcome statistics per operation class, which sharpen the priors for every next line. This avoids the contradiction in MicroAGI’s pitch, where plant data stays with the customer yet is supposed to compound.
3. **One operation taxonomy.** Every line is described in the same verb classes and part features, so a screwing result from one heat pump plant transfers to the next.
4. **A calibration track record.** A logged history of predicted against actual results is what lets us sell guaranteed throughput. A competitor without that record cannot price the risk.
5. **Industry focus.** Starting with heat pump lines concentrates the data: ten similar lines teach the model more than ten unrelated ones.

Honest limit: the moat is thin until the first few lines are logged. Until then, our edge is speed and focus, not data.

## Hackathon build plan

Everything here serves one 24-hour deliverable: a heat pump line captured, redesigned and proven in simulation, ending on the chart of robot reliability needed before and after. The plan assumes four people, A to D.

&#91;embedded content: hackathon plan · 11 workstreams over 24 hours\]

Capture, simulation and the 3D render start in the first two hours because they take longest; everything feeds the freeze at hour 20.

### Capture on a synthetic line

The 3D line doubles as a test bench: the simulation drives the render, two virtual capture cameras film it, and the VLM labels the footage without ever seeing `line.json` or the event log. Because the renderer knows exactly what happened, every label can be scored against ground truth for free.

- **Pixels only.** The capture pipeline gets rendered frames and nothing else, and has to rebuild operations, cycle times and the process graph on its own.
- **Two camera types.** A fixed high view per station stands in for factory CCTV; a first-person view on each worker stands in for MicroAGI’s capture devices.
- **Recognisable actions.** Each verb class gets its own avatar animation, tool and part, and capture views carry no text labels that would give the answer away.
- **Visible variation.** The simulation shuffles the order of reorderable steps between cycles, so the VLM can discover soft precedence from what it sees.
- **Scored on stage.** Show operation-labelling accuracy and the share of process-graph edges recovered, against the hidden ground truth.

Honest limit: rendered footage is cleaner than a real factory, so accuracy here is an upper bound. Say so in the pitch; real lines use MicroAGI’s devices and existing CCTV.

### Shared contracts (hour 0–1, everyone)

Agree three files before anyone codes; everyone builds against dummy versions first.

| File | Contents |
| --- | --- |
| `line.json` | Process graph per the data model, plus station x/y for 3D and a `source` on every number |
| `events_<line>.json` | One row per event: unit, variant, station, event (start, end, blocked, starved, failed, rework), time |
| `results.json` | Per design: throughput, capex, required robot reliability, sweep curve, migration stages |

Repo: `capture/`, `graph/`, `capability/`, `optimize/` and `simulate/` in Python, writing JSON; `app/` is the React front end that reads it.

### Build steps

1. **Reference line (A, hours 1–4).** About 20 operations over 11 stations for an R290 monobloc outdoor unit with three variants (6, 9, 12 kW). Times as mean and spread per variant, failure and rework rates for leak test and run test, and a source or “estimate” tag on each number. Output: `line.json` v1.
2. **Capability model v0 (B, hours 1–5).** A prior table of verb class × part presentation giving a success range and robot time factor; lever rules (fixture, kit, eliminate, regroup, decouple) that change features; one function returning the success range for an operation with a given lever set. Output: `capability.py` and a table the app can show.
3. **Capture and VLM labelling (D, hours 1–12).** Build and test the labelling pipeline on early renders (hours 1–8), then label the full footage from both capture cameras once it lands (hours 8–12). Send short batches of frames to a vision-capable model with the fixed verb vocabulary and parts list, asking for JSON segments (start, end, station, verb, parts). The pipeline never reads line.json or the event log. Merge neighbouring segments with the same label, then score against the event log as ground truth. Output: `segments.json` and an accuracy figure.
4. **Simulation (A, hours 4–12).** SimPy with stations as resources and buffers as stores (capacity 0 means a coupled line). A robot failure stops the station for a recovery time in the current line; in a redesign, the unit goes to a human fallback station. A failed leak test loops back to brazing. Between cycles, shuffle the order of operations joined only by soft edges so the cameras can see which steps are reorderable. The first current-line event log must be ready by hour 6 for rendering. Write the event log, then sweep robot reliability from 0.80 to 0.999 with about 200 shifts per point, run in parallel. Sanity check: the test stations must be the bottleneck, with blocked time upstream. Output: `simulate.py`, `events_current.json` and the current-line curve.
5. **Process-graph builder (D, hours 10–14).** From the segments: operation times as mean and spread across cycles, and for each pair of operations how often A came before B. Always the same order gives a proposed hard edge; varying order gives a soft one. A review screen lists edges so a person can flip them. Output: `line.json` v2, rebuilt from pixels alone, plus its score against the hidden ground truth (share of operations and edges recovered).
6. **Redesign generator and CP-SAT (B, hours 5–14).** Generator rules: split long test stations into parallel bays with buffers; kit or eliminate walk and search operations; mark operations whose success range clears the floor after a lever as robot candidates. CP-SAT model: a station and a mode (human, robot, robot plus lever, eliminated) per operation; hard precedence holds; station load stays under takt for every variant; each station is all-robot or all-human; robot modes only above the floor; minimise human stations plus lever cost. Solve per lever set and keep the best three. Output: `line_redesign_1..3.json`.
7. **Compare and migration plan (A and B, hours 12–16).** Simulate each redesign with identical parameters and sweep. Rank by throughput, capex and required reliability. Build three stages by re-solving with one segment changed at a time, each with a gate such as “robot cell holds 95% for a week”. Output: `results.json`.
8. **3D render and capture cameras (C, hours 2–18).** React with react-three-fiber. Stations as boxes placed from `line.json`; units as small boxes with a fan disc that move per the event log. People are rigged avatars with a distinct animation per verb class (pick, place, screw, braze with a visible flame, wire, walk, search) and visible tools and parts, so the VLM has something to recognise. Each station has two capture cameras: a fixed high CCTV view and a first-person view on the worker. Capture views carry no text overlays, and lighting, camera position and avatar look vary slightly between cycles. Export frames at 1 per second of simulated time with headless Puppeteer; first footage by hour 8. The demo view adds state colours (working, blocked, starved, failed), a time scrubber, speed control (×10, ×60) and current line versus redesign side by side. Start on a dummy event log at hour 2.
9. **App integration (C and D, hours 14–20).** One React app with four tabs: Capture (video plus labelled timeline), Process graph (React Flow, hard edges solid, soft dashed), Redesign (3D side by side with lever badges) and Proof (reliability chart in Recharts, plus migration stages). Stretch goal: a small FastAPI endpoint reruns a short sweep when a judge moves a slider.
10. **Freeze and rehearse (everyone, hours 20–24).** Precompute every JSON file, record a backup video of the full demo, rehearse the 3-minute script and prepare answers on the assumptions.

**Done means:** the 3D render, the VLM’s labels and the reliability chart all come from the same event logs, and every number on screen carries a source tag.

**Stack:** Python, ffmpeg, a vision-capable model API, networkx, OR-Tools CP-SAT, SimPy; React, react-three-fiber with rigged avatars (for example from Mixamo), Puppeteer for frame export, React Flow, Recharts; optional FastAPI.

## Risks, open questions and success metrics

| Risk | Mitigation |
| --- | --- |
| Robot-capability numbers are guesses | Ranges, not points; bench trials in v1; field data from the pilot |
| Precedence inference marks a hard edge as soft | Engineer review screen; low-confidence edges default to hard |
| Optimisation does not scale with many variants and levers | Decompose: choose levers first, then assign and balance; cap levers per stage |
| Reusing surveillance cameras blocked by privacy rules or the works council | Agree purpose and retention with the works council first; anonymise on device; analyse stations and flow, never individuals; MES data as fallback |
| Plant engineers distrust a black box | Every recommendation shows the lever, the evidence and the range |

**Success metrics:** under 10 working days from capture to plan; simulation within ±10% of observed cycle times; required robot reliability cut by at least 5 percentage points on the pilot line; pilot customer signs stage two.

**Open questions:** which industry for the first line; which integrator or robot partner builds the pilot cell; whether MicroAGI partners with us on capture devices; which export formats the first customer’s simulation tools accept.
