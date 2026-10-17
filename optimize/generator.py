"""Deterministic generator rules: lever catalogue, test-station bay splits and the
allowed (mode, levers) options per operation for each lever bundle."""

import math
from dataclasses import dataclass, field
from itertools import combinations

from capability import LEVER_COSTS, applicable_levers, clears, estimate, lever_feature_changes

from .costs import CANDIDATE_QUANTILE, PEAK_TOLERANCE

TEST_KINDS = ("evacuation_leak_test", "run_test")
# Ops on fixed equipment (torch, test rig) stay at their station.
PINNED_TOOLS = ("torch", "hose")

# Nested bundles: lever types the solver may use on waste (walk/search) ops and on
# the rest. It pays only for the levers it uses. Station levers (decouple) apply to all.
WASTE_LEVERS = ("eliminate", "kit", "goods_to_robot")
BUNDLES: dict[str, tuple[str, ...]] = {
    "B0": (),
    "B1": ("decouple",),
    "B2": ("decouple", "waste"),
    "B3": ("decouple", "waste", "fixture", "kit", "regroup"),
    "B4": ("decouple", "waste", "fixture", "kit", "regroup", "goods_to_robot"),
}


def allowed_types(bundle: str, waste: bool) -> tuple[str, ...]:
    b = BUNDLES[bundle]
    return tuple(t for t in b if t != "waste") + (WASTE_LEVERS if waste and "waste" in b else ())


@dataclass(frozen=True)
class LeverInst:
    id: str
    type: str
    cost: float
    operations: tuple[str, ...]
    lever: dict  # the Lever object as written to line.json


@dataclass(frozen=True)
class Option:
    mode: str  # human | robot | eliminated
    levers: tuple[str, ...]  # lever instance ids
    time: dict[str, float]  # seconds per variant


@dataclass
class Candidates:
    bundle: str
    stations: list[str]  # ordered along the line
    bays: dict[str, int]
    decouple: dict[str, str]  # split station -> decouple lever id
    allowed: dict[str, list[str]]  # op -> stations it may go to
    levers: dict[str, LeverInst]
    options: dict[str, list[Option]] = field(default_factory=dict)
    moves: dict[str, str] = field(default_factory=dict)  # op -> regroup lever id paid when it moves


def ordered_stations(line: dict) -> list[dict]:
    return sorted(line["stations"], key=lambda s: (s["x"], s["y"], s["id"]))


def lever_catalogue(line: dict) -> dict[tuple[str, str], LeverInst]:
    """(type, op) -> lever instance. The line's own levers win (item 1 knows the
    plant); without any, one generic instance per applicable (type, op)."""
    out = {}
    for lv in line.get("levers", []):
        inst = LeverInst(lv["id"], lv["type"], lv["cost"]["value"], tuple(lv["operations"]), lv)
        for o in lv["operations"]:
            out.setdefault((lv["type"], o), inst)
    if line.get("levers"):
        return out
    ops = {o["id"]: o for o in line["operations"]}
    for o, op in ops.items():
        for t in applicable_levers(op, line):
            lid = f"L_{t}_{o}"
            out[t, o] = LeverInst(lid, t, LEVER_COSTS[t]["value"], (o,), {
                "id": lid, "type": t, "cost": dict(LEVER_COSTS[t]), "operations": [o],
                "featureChanges": lever_feature_changes(op, line, t)})
    return out


def loads(line: dict, station_ops: list[str], time=None) -> dict[str, float]:
    ops = {o["id"]: o for o in line["operations"]}
    time = time or (lambda o, v: ops[o]["time"][v]["mean"]["value"])
    return {v["id"]: sum(time(o, v["id"]) for o in station_ops if o in v["operations"]) for v in line["variants"]}


def bays_needed(line: dict, load: dict[str, float]) -> int:
    """Mixed-model rule: the mix-weighted load fits takt, and any single variant
    fits takt x PEAK_TOLERANCE (buffers absorb one long unit)."""
    takt = line["takt"]["value"]
    mix = {v["id"]: v["mix"]["value"] for v in line["variants"]}
    avg = sum(mix[v] * t for v, t in load.items())
    return max(1, math.ceil(avg / takt), math.ceil(max(load.values()) / (takt * PEAK_TOLERANCE["value"])))


def _cost(insts) -> float:
    return sum(i.cost for i in {i.id: i for i in insts}.values())


def op_options(op: dict, line: dict, catalogue, bundle: str, floor: float) -> list[Option]:
    human = {v: t["mean"]["value"] for v, t in op["time"].items()}
    options = [Option("human", (), human)]
    waste = estimate(op, line).waste
    types = allowed_types(bundle, waste)
    usable = [catalogue[t, op["id"]] for t in applicable_levers(op, line)
              if (t, op["id"]) in catalogue and t in types]
    sets = [()] + [c for k in (1, 2) for c in combinations(usable, k)]
    clearing = [s for s in sets if clears(estimate(op, line, [i.type for i in s]), floor, CANDIDATE_QUANTILE["value"])]
    removing = [s for s in clearing if estimate(op, line, [i.type for i in s]).eliminated]
    if removing:
        s = min(removing, key=lambda s: (_cost(s), [i.id for i in s]))
        # Waste is always removed once a lever for it is available, never kept or automated.
        return [Option("eliminated", tuple(i.id for i in s), {v: 0.0 for v in human})]
    robot = [s for s in clearing if s not in removing]
    if robot and not waste:
        s = min(robot, key=lambda s: (_cost(s), [i.id for i in s]))
        options.append(Option("robot", tuple(i.id for i in s), estimate(op, line, [i.type for i in s]).robot_time))
    return options


def candidates(line: dict, bundle: str, floor: float) -> Candidates:
    types = BUNDLES[bundle]
    stations = ordered_stations(line)
    index = {s["id"]: i for i, s in enumerate(stations)}
    catalogue = lever_catalogue(line)

    bays, decouple = {}, {}
    for s in stations:
        bays[s["id"]] = s.get("bays", 1)
        if "decouple" in types and s["kind"] in TEST_KINDS:
            need = bays_needed(line, loads(line, s["operations"]))
            if need > bays[s["id"]]:
                inst = next((catalogue["decouple", o] for o in s["operations"] if ("decouple", o) in catalogue), None)
                if inst is None:
                    lid = f"L_decouple_{s['id']}"
                    inst = LeverInst(lid, "decouple", LEVER_COSTS["decouple"]["value"], tuple(s["operations"]), {
                        "id": lid, "type": "decouple", "cost": dict(LEVER_COSTS["decouple"]),
                        "operations": list(s["operations"]), "featureChanges": {"bays": str(need)}})
                catalogue["decouple", s["id"]] = inst
                bays[s["id"]], decouple[s["id"]] = need, inst.id

    kind = {s["id"]: s["kind"] for s in stations}
    allowed = {}
    for op in line["operations"]:
        i = index[op["station"]]
        # With the line's own levers, an op moves only under a regroup lever that names it.
        # A bare line (no levers) may move ops one station either way for free.
        movable = (("regroup", op["id"]) in catalogue and "regroup" in types) if line.get("levers") else True
        if kind[op["station"]] in TEST_KINDS or op["tool"] in PINNED_TOOLS or not movable:
            allowed[op["id"]] = [op["station"]]
        else:
            near = [stations[j]["id"] for j in (i - 1, i, i + 1) if 0 <= j < len(stations)]
            allowed[op["id"]] = [s for s in near if kind[s] not in TEST_KINDS]

    levers = {i.id: i for i in catalogue.values()}
    c = Candidates(bundle, [s["id"] for s in stations], bays, decouple, allowed, levers)
    c.moves = {o: catalogue["regroup", o].id for o in allowed if ("regroup", o) in catalogue and len(allowed[o]) > 1}
    c.options = {op["id"]: op_options(op, line, catalogue, bundle, floor) for op in line["operations"]}
    return c


def used_levers(c: Candidates, choice: dict[str, Option], moved: list[str] = ()) -> list[dict]:
    """Lever objects (types.ts Lever) a solution uses, in a stable order."""
    ids = list(dict.fromkeys([*c.decouple.values(), *(lid for o in choice.values() for lid in o.levers), *moved]))
    return [dict(c.levers[i].lever) for i in ids]
