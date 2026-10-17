"""Regression on the real R290 line (25 ops, 11 stations) and its simulated log,
snapshotted from Tatu's feat/3d-render branch (tools/gen, seed 42)."""

import json
from pathlib import Path

from capability.__main__ import build as capability_table
from graph.build import build, catalogue_from_line
from graph.score import score
from graph.synth import synth_segments
from optimize import best_designs, export
from tests.optimize.test_optimize import check_design

FIX = Path(__file__).parent / "fixtures"
LINE = json.loads((FIX / "r290_line.json").read_text())
EVENTS = json.loads((FIX / "r290_events_current.json").read_text())


def test_capability_covers_every_operation():
    table = capability_table(LINE)
    assert {r["operation"] for r in table["operations"]} == {o["id"] for o in LINE["operations"]}


def test_three_feasible_redesigns():
    designs = best_designs(LINE, 0.90)
    assert len(designs) == 3
    for rank, (c, sol) in enumerate(designs, start=1):
        d = export(LINE, c, sol, rank)
        check_design(LINE, d)
        assert set(d["appliedLevers"]) <= {lv["id"] for lv in d["levers"]}
    best = export(LINE, *designs[0], 1)
    assert "L_test_bays" in best["appliedLevers"]  # both test stations are over takt
    assert {s["id"] for s in best["stations"] if s["staff"] == "robot"}


def test_graph_rebuilt_from_noisy_video():
    line, _ = build(synth_segments(EVENTS, LINE, 1, True), catalogue_from_line(LINE))
    s = {k: v["value"] for k, v in score(line, LINE).items() if k != "matching"}
    assert s["operationRecall"] == 1.0
    assert s["trueHardPredictedSoft"] == 0
    assert s["edgeRecall"] >= 0.9


def test_migration_stages_lowest_risk_first():
    c, sol = best_designs(LINE, 0.90)[0]
    st = export(LINE, c, sol, 1)["design"]["stages"]
    assert [s["name"] for s in st][-1] == "Robot cells"
    assert set(st[-1]["stations"]) == set(sol.robot_stations)
    assert all(s["stations"] and s["gate"] for s in st)


def test_humanoid_whatif_finds_a_crossover():
    from capability import ROBOTS
    from optimize.whatif import sweep

    before = dict(ROBOTS["humanoid"])
    res = sweep(LINE)
    assert ROBOTS["humanoid"] == before  # overrides are undone
    today = next(p for p in res["points"] if p["rentFactor"] == 1.0 and p["speedFactor"] == 1.0
                 and p["humanoidPrecision"] == "medium")
    assert today["humanoids"] == 0
    assert res["breakEven"] is not None
