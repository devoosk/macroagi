import json
from pathlib import Path

import pytest

from capability import (
    LEVER_TYPES, PRIORS, applicable_levers, clears, estimate, features_for, lever_feature_changes,
)
from capability.__main__ import build

LINE = json.loads((Path(__file__).parents[2] / "app/public/data/line.json").read_text())


def op(op_id, **changes):
    o = next(o for o in LINE["operations"] if o["id"] == op_id)
    return {**o, **changes}


@pytest.mark.parametrize("o", LINE["operations"], ids=lambda o: o["id"])
def test_ranges_are_valid(o):
    e = estimate(o, LINE)
    assert 0.0 <= e.p05 <= e.mean <= e.p95 <= 1.0
    assert set(e.robot_time) == {v["id"] for v in LINE["variants"]}


@pytest.mark.parametrize("o", LINE["operations"], ids=lambda o: o["id"])
@pytest.mark.parametrize("lever", LEVER_TYPES)
def test_levers_never_lower_success(o, lever):
    assert estimate(o, LINE, [lever]).mean >= estimate(o, LINE).mean


def test_worst_part_drives_features():
    f = features_for(op("O3"), LINE)
    assert (f.presentation, f.rigidity, f.tolerance) == ("kitted", "semi", "tight")


def test_fixture_on_loose_screw_makes_robot_candidate():
    o = op("O2")
    assert not clears(estimate(o, LINE), 0.9)
    assert clears(estimate(o, LINE, ["fixture"]), 0.9)
    assert lever_feature_changes(o, LINE, "fixture") == {"presentation": "fixtured"}


def test_walk_and_search_are_waste_and_can_be_eliminated():
    for verb in ("walk", "search"):
        o = op("O1", verb=verb)
        assert estimate(o, LINE).waste
        assert "eliminate" in applicable_levers(o, LINE)
        e = estimate(o, LINE, ["eliminate"])
        assert e.eliminated and e.mean == 1.0 and all(t == 0 for t in e.robot_time.values())
    assert estimate(op("O1", verb="search"), LINE, ["kit"]).eliminated
    assert estimate(op("O1", verb="walk"), LINE, ["goods_to_robot"]).eliminated


def test_eliminate_only_applies_to_waste():
    assert not estimate(op("O2"), LINE, ["eliminate"]).eliminated
    assert "eliminate" not in applicable_levers(op("O2"), LINE)


def test_station_levers_do_not_change_capability():
    for lever in ("regroup", "decouple"):
        assert estimate(op("O2"), LINE, [lever]).mean == estimate(op("O2"), LINE).mean


def test_partless_ops_only_take_fixture():
    assert applicable_levers(op("O4"), LINE) == ["fixture"]


def test_robot_time_uses_verb_factor():
    e = estimate(op("O1"), LINE)
    factor = PRIORS["timeFactor"]["byVerb"]["place"]
    assert e.robot_time["V9"] == pytest.approx(op("O1")["time"]["V9"]["mean"]["value"] * factor)


def test_output_is_deterministic_and_sourced():
    a, b = build(LINE), build(LINE)
    assert json.dumps(a) == json.dumps(b)
    assert all(r["source"] for r in a["operations"] + a["priors"])
    assert all(c["source"] for c in a["leverCosts"].values())
