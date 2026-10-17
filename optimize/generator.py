"""Deterministic generator rules: test-station bay splits, lever instances and the
allowed (mode, levers) options per operation for each lever bundle."""

import math
from dataclasses import dataclass, field
from itertools import combinations

from capability import LEVER_COSTS, applicable_levers, clears, estimate, lever_feature_changes

TEST_KINDS = ("evacuation_leak_test", "run_test")
# Ops on fixed equipment (torch, test rig) stay at their station.
PINNED_TOOLS = ("torch", "hose")

# Nested bundles of lever types the solver may use (it pays only for the ones it uses).
BUNDLES: dict[str, tuple[str, ...]] = {
    "B0": (),
    "B1": ("decouple",),
    "B2": ("decouple", "eliminate"),
    "B3": ("decouple", "eliminate", "fixture", "kit"),
    "B4": ("decouple", "eliminate", "fixture", "kit", "goods_to_robot"),
}


@dataclass(frozen=True)
class Option:
    mode: str  # human | robot | eliminated
    levers: tuple[str, ...]  # lever types
    time: dict[str, float]  # seconds per variant
    cost: float  # lever cost of this option


@dataclass
class Candidates:
    bundle: str
    stations: list[str]  # ordered along the line
    bays: dict[str, int]
    decoupled: list[str]  # stations split into bays
    allowed: dict[str, list[str]]  # op -> stations it may go to
    options: dict[str, list[Option]] = field(default_factory=dict)


def ordered_stations(line: dict) -> list[dict]:
    return sorted(line["stations"], key=lambda s: (s["x"], s["y"], s["id"]))


def worst_load(line: dict, station: dict) -> float:
    ops = {o["id"]: o for o in line["operations"]}
    return max(
        sum(ops[o]["time"][v["id"]]["mean"]["value"] for o in station["operations"] if o in v["operations"])
        for v in line["variants"]
    )


def lever_cost(levers) -> float:
    return sum(LEVER_COSTS[t]["value"] for t in levers)


def op_options(op: dict, line: dict, allowed_types: tuple[str, ...], floor: float) -> list[Option]:
    human = {v: t["mean"]["value"] for v, t in op["time"].items()}
    options = [Option("human", (), human, 0.0)]
    types = [t for t in applicable_levers(op, line) if t in allowed_types]
    sets = [()] + [c for k in (1, 2) for c in combinations(types, k)]
    clearing = [s for s in sets if clears(estimate(op, line, s), floor)]
    removing = [s for s in clearing if estimate(op, line, s).eliminated]
    robot = [s for s in clearing if s not in removing]
    if removing:
        s = min(removing, key=lambda s: (lever_cost(s), s))
        # Waste is always removed once a lever for it is available, never kept or automated.
        return [Option("eliminated", s, {v: 0.0 for v in human}, lever_cost(s))]
    if robot and not estimate(op, line).waste:
        s = min(robot, key=lambda s: (lever_cost(s), s))
        options.append(Option("robot", s, estimate(op, line, s).robot_time, lever_cost(s)))
    return options


def candidates(line: dict, bundle: str, floor: float) -> Candidates:
    types = BUNDLES[bundle]
    stations = ordered_stations(line)
    index = {s["id"]: i for i, s in enumerate(stations)}
    takt = line["takt"]["value"]

    bays, decoupled = {}, []
    for s in stations:
        bays[s["id"]] = s.get("bays", 1)
        if "decouple" in types and s["kind"] in TEST_KINDS:
            need = math.ceil(worst_load(line, s) / takt)
            if need > bays[s["id"]]:
                bays[s["id"]] = need
                decoupled.append(s["id"])

    kind = {s["id"]: s["kind"] for s in stations}
    allowed = {}
    for op in line["operations"]:
        i = index[op["station"]]
        if kind[op["station"]] in TEST_KINDS or op["tool"] in PINNED_TOOLS:
            allowed[op["id"]] = [op["station"]]
        else:
            near = [stations[j]["id"] for j in (i - 1, i, i + 1) if 0 <= j < len(stations)]
            allowed[op["id"]] = [s for s in near if kind[s] not in TEST_KINDS]

    c = Candidates(bundle, [s["id"] for s in stations], bays, decoupled, allowed)
    c.options = {op["id"]: op_options(op, line, types, floor) for op in line["operations"]}
    return c


def lever_instances(line: dict, c: Candidates, choice: dict[str, "Option"]) -> list[dict]:
    """Lever objects (types.ts Lever) for the levers a solution uses."""
    ops = {o["id"]: o for o in line["operations"]}
    out = [
        {"id": f"L_decouple_{s}", "type": "decouple", "cost": dict(LEVER_COSTS["decouple"]),
         "operations": [o for o in ops if ops[o]["station"] == s], "featureChanges": {"bays": str(c.bays[s])}}
        for s in c.decoupled
    ]
    for op_id, opt in choice.items():
        for t in opt.levers:
            out.append({"id": f"L_{t}_{op_id}", "type": t, "cost": dict(LEVER_COSTS[t]),
                        "operations": [op_id], "featureChanges": lever_feature_changes(ops[op_id], line, t)})
    return out
