# Item 2: Robot-capability model v0 — implementation plan

Status: built (v0). Decisions: direct pushes to main; uv at the repo root; capability/ owns lever-type rules and item 6 creates lever instances; robot candidate = p05 clears the floor.

## What it does

For every operation in `line.json`, predict how often a robot would succeed and how long it would take, today and after any set of design levers. The answer is always a range (a Beta distribution), never a point. Downstream users:

- **Item 6 (redesign generator + CP-SAT):** asks "does this operation clear the reliability floor with lever set L?" and "what is the robot time?" to decide robot modes.
- **Item 7 (simulation of redesigns):** samples or uses the success rate per robot operation.
- **App (Proof/Redesign tabs):** shows the prior table and per-operation ranges with lever badges.

## Approach: rules and priors

1. **Features per operation**, derived only from fields that already exist in `line.json` (no schema change needed):
   | Feature | Derived from |
   | --- | --- |
   | verb | `operation.verb` |
   | presentation | worst `part.presentation` among the op's parts (loose_bin < tray < kitted < fixtured) |
   | rigidity | least rigid part |
   | tolerance | tightest part |
   | mass | heaviest part (payload penalty above ~10 kg) |
   | force / tool | `operation.tool` (torque_driver, torch, crimper raise difficulty) |
   | orientation known | true if presentation is fixtured or kitted |
   | variant spread | how many variants use the op and how much time varies across them |
   | waste flag | verb is `walk` or `search` → candidate to eliminate, not automate |
2. **Prior table** `verb × presentation → Beta(α, β)` for success, plus a robot time factor range (robot time = human mean × factor). All values tagged `source: "estimate"` (engineer judgement), kept in one JSON file so they are easy to tweak and show in the app.
3. **Feature adjustments**: flexible parts, tight tolerance, heavy mass, high-force tools and many variants shift the Beta mean down and widen it (lower α+β = less confidence). Simple multiplicative rules, each one recorded as a human-readable reason string.
4. **Levers change features, not numbers.** Rules per lever type:
   | Lever | Feature change |
   | --- | --- |
   | fixture | presentation → fixtured, orientation known |
   | kit | presentation → kitted, removes search |
   | goods_to_robot | removes walk, presentation → tray at minimum |
   | eliminate | operation removed (success 1, time 0); only allowed on walk/search ops |
   | regroup, decouple | no capability change (they are station/buffer changes for item 6) |
   The estimate is then recomputed from the new features, so the improvement always comes from the same prior table.

## Code layout

```
capability/
  __init__.py
  priors.json        # verb × presentation table + adjustment rules, every number with a source
  features.py        # Operation + parts -> Features dataclass
  levers.py          # apply(features, lever_types) -> Features
  model.py           # estimate(op, line, levers=()) -> Estimate
  __main__.py        # CLI: python -m capability <line.json> -o <capability.json>
tests/capability/    # pytest
pyproject.toml       # Python deps (shared with other Python modules, see questions)
```

`Estimate` fields: `alpha`, `beta`, `mean`, `p05`, `p95`, `timeFactor {low, mean, high}`, `robotTime` per variant, `features`, `reasons[]`, `waste: bool`, and `source`. Helper `clears(estimate, floor, quantile=0.05)` for item 6, so "robot candidate" means the pessimistic end of the range clears the floor.

## New contract file: `capability.json`

Written by the CLI next to `line.json` (`app/public/data/capability.json`) so the app can show it. Shape:

```json
{
  "line": "r290_fixture",
  "priors": [{ "verb": "screw", "presentation": "tray", "alpha": 18, "beta": 4, "timeFactor": {...}, "source": "estimate" }],
  "operations": [
    { "operation": "O2", "levers": [], "estimate": { ... } },
    { "operation": "O2", "levers": ["fixture"], "estimate": { ... } }
  ]
}
```

One row per operation × each single applicable lever type (plus the no-lever baseline). Item 6 calls the Python function directly for combinations; the JSON is for display. A matching `CapabilityTable` type goes in `app/src/contracts/types.ts`.

## Steps (each ends in a commit + push)

1. Python project setup (`pyproject.toml`, pytest) and `priors.json` with the starting table.
2. `features.py` + tests against the dummy `line.json`.
3. `levers.py` + `model.py` + tests (ranges in [0, 1], levers never lower success, walk/search flagged, deterministic output).
4. CLI writing `capability.json`, plus the TS type in `contracts/types.ts`.
5. Run it on item 1's real `line.json` once it lands and sanity-check that the ranking looks plausible (e.g. fixtured screwing high, loose-bin flexible cable routing low).

Dependencies: Python stdlib + `scipy` (Beta quantiles). No other new libraries.

## Parallel work

Item 2 is small, so I build it in this thread. While it is being built, a subagent can draft the CP-SAT model design for item 6 against the `Estimate` interface above, so item 6 starts as soon as item 2 lands. Item 5 (process-graph builder) depends on item 3's `segments.json`, so it waits for the colleague's capture output format.
