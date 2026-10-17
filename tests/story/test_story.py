import json
from pathlib import Path

import pytest

from story.__main__ import build_story

DATA = Path(__file__).parents[2] / "app" / "public" / "data"


@pytest.fixture(scope="module")
def story():
    return build_story(DATA)[0]


def test_schema_keys(story):
    assert {"sources", "takt", "stations", "sparks", "graph", "swarm"} <= set(story)
    st = story["stations"][0]
    assert {"id", "kind", "x", "order", "load", "loadRatio", "blockedShare", "starvedShare", "bottleneck"} <= set(st)
    assert {"st", "t", "node", "verb"} <= set(story["sparks"][0])
    assert all(0 <= s["t"] <= 1 for s in story["sparks"])
    nodes = {n["id"] for n in story["graph"]["nodes"]}
    assert {s["node"] for s in story["sparks"]} <= nodes
    n = story["graph"]["nodes"][0]
    assert {"id", "station", "verb", "meanTime", "cv", "n", "gx", "gy"} <= set(n)
    assert all(0 <= n["gx"] <= 1 and 0 <= n["gy"] <= 1 for n in story["graph"]["nodes"])
    e = story["graph"]["edges"][0]
    assert {"from", "to", "type", "nab", "nba", "redundant"} <= set(e)
    sw = story["swarm"]
    assert {"evaluated", "points", "current", "winners"} <= set(sw)
    assert 2500 <= len(sw["points"]) <= 4000
    assert {"cost", "rate", "people", "ok", "why", "near"} <= set(sw["points"][0])
    assert {p["why"] for p in sw["points"]} <= {None, "takt", "order", "mixed_station", "robot_type"}
    assert any(s["bottleneck"] for s in story["stations"])


def test_solver_designs_ok_and_cheapest(story):
    sw = story["swarm"]
    assert len(sw["winners"]) == 4
    assert sw["winners"][0]["file"] == "line_rebuild_1.json"
    assert [w["file"] for w in sw["winners"][1:]] == [f"line_solver_{i}.json" for i in (1, 2, 3)]
    for w in sw["winners"]:
        assert w["cost"] == w["solverObjective"]  # same objective as optimize/model.py and rebuild.py
    assert sorted(p["winner"] for p in sw["points"] if "winner" in p) == [0, 1, 2, 3]
    assert sum(p["near"] == 4 for p in sw["points"]) > 100
    best = min(w["cost"] for w in sw["winners"])
    ok = [p for p in sw["points"] if p["ok"] and "winner" not in p]
    assert ok and sum(p["cost"] < best for p in ok) <= 0.01 * len(ok)
    assert not sw["current"]["ok"]  # the current line misses takt at the test stations


def test_deterministic(story):
    again = build_story(DATA)[0]
    assert json.dumps(story, sort_keys=True) == json.dumps(again, sort_keys=True)
