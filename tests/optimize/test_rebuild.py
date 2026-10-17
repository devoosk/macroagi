import json
from pathlib import Path

import pytest

from optimize import rebuild
from optimize.costs import PEAK_TOLERANCE

FIX = Path(__file__).parents[2] / "tests/fixtures"


@pytest.fixture(scope="module", params=["toy_line.json", "r290_line.json"])
def case(request):
    line = json.loads((FIX / request.param).read_text())
    rb = rebuild.solve(line, n_slots=len(line["stations"]) + 2)
    assert rb is not None
    return line, rb, rebuild.export(line, rb)


def test_hard_order_holds(case):
    line, _, d = case
    ops = {o["id"]: o for o in d["operations"]}
    chain = [s["id"] for s in d["stations"] if not s.get("offline")]
    for e in line["edges"]:
        a, b = ops[e["from"]], ops[e["to"]]
        if e["type"] == "hard" and "eliminated" not in (a["mode"], b["mode"]):
            assert chain.index(a["station"]) <= chain.index(b["station"])
            if a["station"] == b["station"]:
                seq = next(s["operations"] for s in d["stations"] if s["id"] == a["station"])
                assert seq.index(a["id"]) < seq.index(b["id"])


def test_fixed_equipment_stays_together_and_alone(case):
    line, _, d = case
    where = {o["id"]: o["station"] for o in d["operations"] if o["mode"] != "eliminated"}
    for g in rebuild.fixed_groups(line):
        (sid,) = {where[o] for o in g}
        st = next(s for s in d["stations"] if s["id"] == sid)
        assert sorted(st["operations"]) == sorted(g)


def test_every_station_fits_takt(case):
    line, _, d = case
    ops = {o["id"]: o for o in d["operations"]}
    takt = line["takt"]["value"]
    for st in d["stations"]:
        assert len({ops[o]["mode"] for o in st["operations"]}) <= 1
        for v in d["variants"]:
            load = sum(ops[o]["time"][v["id"]]["mean"]["value"] for o in st["operations"] if o in v["operations"])
            assert load <= takt * PEAK_TOLERANCE["value"] * st["bays"] + 0.5


def test_layout_and_traceability(case):
    line, _, d = case
    old = {s["id"] for s in line["stations"]}
    chain = [s for s in d["stations"] if not s.get("offline")]
    assert [s["id"] for s in chain] == [f"C{i:02d}" for i in range(1, len(chain) + 1)]
    assert [s["x"] for s in chain] == sorted(s["x"] for s in chain)
    for s in chain:
        assert s["replaces"] and set(s["replaces"]) <= old
        assert (s["staff"] == "robot") == ("robot" in s)
    staged = [c for st in d["design"]["stages"] for c in st["stations"]]
    assert staged == [s["id"] for s in chain]


def test_deterministic(case):
    line, _, d = case
    if line["id"] != json.loads((FIX / "toy_line.json").read_text())["id"]:
        pytest.skip("one re-solve of the real line is slow; the toy line covers it")
    again = rebuild.export(line, rebuild.solve(line, n_slots=len(line["stations"]) + 2))
    assert json.dumps(again) == json.dumps(d)
