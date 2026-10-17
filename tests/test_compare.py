"""Item 7 on the real R290 line: staged lines stay consistent, and compare runs end to end."""

import json
from pathlib import Path

from optimize import best_designs, export
from optimize.compare import evaluate, rank, stage_line

FIX = Path(__file__).parent / "fixtures"
LINE = json.loads((FIX / "r290_line.json").read_text())


def design(n=1):
    c, sol = best_designs(LINE, 0.90)[n - 1]
    return export(LINE, c, sol, n)


def test_each_stage_is_a_valid_line():
    d = design()
    for k in range(1, len(d["design"]["stages"]) + 1):
        s = stage_line(LINE, d, k)
        changed = {x for st in d["design"]["stages"][:k] for x in st["stations"]}
        robots = {x["id"] for x in s["stations"] if x["staff"] == "robot"}
        assert robots <= changed
        assert all(x.get("fallback") == "FB" for x in s["stations"] if x["staff"] == "robot")
    last = stage_line(LINE, d, len(d["design"]["stages"]))
    assert {x["id"]: x["operations"] for x in last["stations"]} == {x["id"]: x["operations"] for x in d["stations"]}


def test_evaluate_and_rank(tmp_path):
    r = evaluate(LINE, design(), shifts=2, outdir=tmp_path, name="t")
    assert (tmp_path / "events_t.json").exists()
    assert r["throughput"]["value"] > 0 and r["sweep"] and r["cost3y"]["value"] > 0
    assert all("throughput" in s and "units/h" in s["gate"] for s in r["stages"])
    a, b = {**r, "design": "a"}, {**r, "design": "b", "cost3y": {"value": 1, "source": "x"}}
    assert [x["design"] for x in rank([a, b])] == ["b", "a"]
