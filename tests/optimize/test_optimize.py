import copy
import json
from pathlib import Path

from capability import clears, estimate
from optimize import best_designs, candidates, export, solve

LINE = json.loads((Path(__file__).parents[2] / "app/public/data/line.json").read_text())
FLOOR = 0.90
PEAK = 1.10


def with_takt(takt):
    line = copy.deepcopy(LINE)
    line["takt"]["value"] = takt
    return line


def designs(line):
    return [export(line, c, s, i) for i, (c, s) in enumerate(best_designs(line, FLOOR), start=1)]


def check_design(line, d):
    ops = {o["id"]: o for o in d["operations"]}
    verbs = {o["id"]: o["verb"] for o in line["operations"]}
    order = [s["id"] for s in sorted(d["stations"], key=lambda s: s["x"])]
    for e in line["edges"]:
        a, b = ops[e["from"]], ops[e["to"]]
        if e["type"] == "hard" and "eliminated" not in (a["mode"], b["mode"]):
            assert order.index(a["station"]) <= order.index(b["station"])
    for st in d["stations"]:
        modes = {ops[o]["mode"] for o in st["operations"]}
        assert len(modes) <= 1, f"mixed station {st['id']}"
        for v in d["variants"]:
            load = 0.0
            for o in st["operations"]:
                if o not in v["operations"]:
                    continue
                if ops[o]["mode"] == "robot":
                    levers = [lv["type"] for lv in d["levers"] if o in lv["operations"]
                              and lv["id"] in d["appliedLevers"] and lv["type"] != "decouple"]
                    assert clears(estimate(ops[o], line, levers), FLOOR, 0.5)
                    assert st["staff"] == "robot"
                load += ops[o]["time"][v["id"]]["mean"]["value"]
            assert load <= line["takt"]["value"] * PEAK * st["bays"] + 0.1
    for lv in d["levers"]:
        if lv["type"] == "eliminate" and lv["id"] in d["appliedLevers"]:
            assert all(verbs[o] in ("walk", "search") for o in lv["operations"])
        assert lv["cost"]["source"]
    assert d["design"]["capex"]["source"]


def test_designs_hold_all_constraints():
    ds = designs(LINE)
    assert ds
    for d in ds:
        check_design(LINE, d)


def test_loose_screwing_goes_to_robot_with_a_lever():
    d = designs(LINE)[0]
    o2 = next(o for o in d["operations"] if o["id"] == "O2")
    assert o2["mode"] == "robot"
    assert any(lv.endswith("_O2") for lv in d["appliedLevers"])  # loose-bin screws need a lever first


def test_over_takt_test_station_is_split_into_bays():
    line = with_takt(70)
    c = candidates(line, "B1", FLOOR)
    assert c.bays["S03"] == 2 and list(c.decouple) == ["S03"]
    assert candidates(line, "B0", FLOOR).bays["S03"] == 1
    for d in designs(line):
        check_design(line, d)
    c = candidates(line, "B1", FLOOR)
    d = export(line, c, solve(line, c), 1)
    s03 = next(s for s in d["stations"] if s["id"] == "S03")
    assert s03["bays"] == 2 and s03["bufferBefore"] >= 2


def test_walk_op_is_eliminated_not_automated():
    line = copy.deepcopy(LINE)
    walk = {**line["operations"][0], "id": "O9", "name": "Walk to rack", "verb": "walk", "parts": [], "tool": "none"}
    line["operations"].append(walk)
    line["stations"][0]["operations"].append("O9")
    for v in line["variants"]:
        v["operations"].append("O9")
    d = designs(line)[0]
    o9 = next(o for o in d["operations"] if o["id"] == "O9")
    assert o9["mode"] == "eliminated"
    assert all("O9" not in v["operations"] for v in d["variants"])
    check_design(line, d)


def test_infeasible_takt_gives_no_design():
    assert best_designs(with_takt(10), FLOOR) == []


def test_deterministic():
    assert json.dumps(designs(LINE)) == json.dumps(designs(LINE))
