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
                    assert clears(estimate(ops[o], line, levers, st["robot"]), FLOOR, 0.5)
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


def test_mobile_robot_serves_two_stations():
    line = with_takt(200)
    for o in line["operations"]:
        if o["id"] in ("O1", "O2", "O3"):
            o.update(verb="place", parts=["P_base"], tool="none")
    c, sol = best_designs(line, FLOOR, n=1, fleet=["humanoid"])[0]
    d = export(line, c, sol, 1)
    check_design(line, d)
    assert sol.shared
    shared = [s for s in d["stations"] if s.get("sharedWith")]
    assert len(shared) == 2 and all(s["robot"] == "humanoid" for s in shared)
    assert d["design"]["fleet"][0]["count"] == len(sol.robot_stations) - len(sol.shared)


def test_robot_limits_rule_out_types():
    o = next(o for o in LINE["operations"] if o["id"] == "O3")  # torch brazing
    assert not estimate(o, LINE, robot="cobot_arm").feasible
    assert any("no torch tool" in r for r in estimate(o, LINE, robot="cobot_arm").reasons)
    heavy = {**LINE, "parts": [{**p, "mass": {"value": 30, "source": "estimate"}} for p in LINE["parts"]]}
    o1 = next(o for o in heavy["operations"] if o["id"] == "O1")
    assert not estimate(o1, heavy, robot="humanoid").feasible
    assert estimate(o1, heavy, robot="industrial_arm").feasible


def test_humanoid_copes_with_loose_bins_arms_need_a_lever():
    o2 = next(o for o in LINE["operations"] if o["id"] == "O2")  # screws from a loose bin
    assert not estimate(o2, LINE, robot="cobot_arm").feasible
    assert estimate(o2, LINE, robot="humanoid").feasible
    assert estimate(o2, LINE, ["fixture"], robot="cobot_arm").feasible


def test_precedence_holds_through_an_eliminated_op():
    # O1 -> O9 (walk, eliminated) -> O3. S02 is full, S01 is full, only S03 has room,
    # but O1 must not move after O3 (brazing, pinned at S02).
    line = copy.deepcopy(LINE)

    def set_time(op_id, t):
        for v in next(o for o in line["operations"] if o["id"] == op_id)["time"].values():
            v["mean"]["value"] = t

    walk = {**copy.deepcopy(line["operations"][0]), "id": "O9", "name": "Walk", "verb": "walk", "parts": [],
            "tool": "none", "station": "S02"}
    line["operations"].append(walk)
    line["stations"][1]["operations"].append("O9")
    for v in line["variants"]:
        v["operations"].append("O9")
    o1 = next(o for o in line["operations"] if o["id"] == "O1")
    o1["station"] = "S02"
    line["stations"][0]["operations"].remove("O1")
    line["stations"][1]["operations"].insert(0, "O1")
    set_time("O1", 50), set_time("O2", 70), set_time("O4", 20)
    line["stations"][2]["kind"] = "casing"  # let ops move into S03
    next(o for o in line["operations"] if o["id"] == "O4")["tool"] = "scanner"
    hard = lambda a, b: {"from": a, "to": b, "type": "hard", "confidence": 1, "evidence": "bom"}
    line["edges"] = [hard("O1", "O9"), hard("O9", "O3")]

    def o1_after_o3(designs):
        return [s for c, s in designs if c.stations.index(s.station["O1"]) > c.stations.index(s.station["O3"])]

    designs = best_designs(line, FLOOR, fleet=["cobot_arm"])
    assert all(s.choice["O9"].mode == "eliminated" for _, s in designs)
    assert not o1_after_o3(designs)
    line["edges"] = []  # without the chain, moving O1 after O3 is the only way to fit takt
    assert o1_after_o3(best_designs(line, FLOOR, fleet=["cobot_arm"]))
