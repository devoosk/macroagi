# Item 2b: Robot fleet in the capability model — plan

Status: draft for review by Oskari. Nothing is built yet.

## Why

MicroAGI's Atlas is a hardware-agnostic control layer, and customers rent robots instead of buying them. So the right question is not "can *a robot* do this operation?" but "which robot type, from what is available to rent, does this best, and at what monthly cost?". Because renting makes changing the fleet cheap, every re-run of the optimiser can recommend a different mix, for example "swap two humanoids at S07 for one fixtured SCARA". That fleet-change recommendation becomes a product output in its own right.

## What changes

### 1. A robot catalogue: `robots.json` (new contract)

One row per rentable robot type, mirroring what Atlas would expose:

| Field | Example | Used for |
| --- | --- | --- |
| id, name, class | `cobot_6kg`, "6 kg cobot arm", arm / scara / dual_arm / humanoid / amr | display, grouping |
| payloadKg, reachM | 6, 0.9 | hard limit: part mass and size |
| precision | loose / medium / tight | hard limit: tightest tolerance it can hit |
| tools | screwdriver, torque_driver, gripper, … | hard limit: op tool must be supported |
| mobile | false / true | humanoids and AMRs can serve walk ops and two neighbouring stations |
| skill | per verb: success multiplier on the failure rate, and a time factor | replaces today's single robot profile |
| needsPresentation | e.g. arms need tray or better; humanoids can work from loose bins | why levers matter more for cheap arms |
| rent | EUR per month, with `source` | objective and results |
| available | how many MicroAGI can supply | fleet limit in the solver |

Every number has a `source`, which is `estimate` until Atlas or MicroAGI give real figures.

### 2. Capability: estimates per robot type

`estimate(op, line, levers, robot)`. The verb × presentation prior stays the base. The robot type then applies three things:
- **Hard limits:** payload, precision, tools, presentation. Breaking any of them makes the operation infeasible for that type, not merely unlikely.
- **Skill:** multiplies the failure rate and scales the time.
- **Uncertainty:** a newer robot class (humanoids) gets a lower concentration, so a wider range.

`capability.json` gains one row per (operation, lever set, robot type). Today's single generic robot becomes one catalogue entry, so nothing that already works breaks.

### 3. Optimiser: choose robot types, not just "robot"

- A mode becomes `human`, `robot:<type>` or `eliminated`. Each station gets one robot type, or human. A mobile type may cover two adjacent stations.
- **Objective:** human cost plus the rent of the chosen types plus lever cost, all over the same horizon. Rent replaces robot cell capex; levers stay capex.
- **Fleet limit:** the number of stations using a type must stay within what is available to rent.
- **The trade-off this exposes:** a humanoid needs no fixture but succeeds less often and costs more per month. A cheap arm needs a fixture or kit first. The solver weighs the two, which is exactly the "two humanoids vs. something else" story.

### 4. Outputs and the loop

- **Redesign files:** stations record `robot: <type>`. The `design` summary splits cost into `capex` (levers) and `rentPerMonth`.
- **Fleet diff:** when re-run with new data (pilot results, a new robot in the catalogue), the optimiser writes a fleet diff against the running design: which robots to add, return or swap, and the rent change.
- **Calibration:** field results update the priors per (verb, presentation, robot type). This is the moat from the plan, made robot-specific: we learn which robot class does which operation, after which lever.

## Steps (each a commit)

1. `robots.json` with about 5 generic types: small cobot, industrial arm, SCARA, dual-arm, humanoid. Plus loading and validation.
2. Capability: robot dimension, hard limits and skill, with tests (a humanoid beats an arm on loose-bin picking; an arm beats a humanoid once fixtured).
3. Optimiser: robot-type modes, rent in the objective, fleet limit; regression test on the R290 line.
4. Contracts: `Station.robot`, rent in `DesignSummary`, a `CapabilityEstimate.robot` field, and the fleet diff.

## Questions for Oskari

1. Does Atlas (or MicroAGI) have a real list of robot types, skills and rent prices we can mirror? If not, I'll invent five generic types tagged `estimate`.
2. Should rent replace robot capex in `results.json`, or be shown next to it?
3. Can one station mix robot types (e.g. an arm plus a humanoid), or is it one type per station? I'd suggest one type per station, with mobile types able to cover two adjacent stations.
4. Is rental availability a real limit for the demo, or unlimited?
