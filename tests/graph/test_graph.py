import json
from pathlib import Path

import pytest

from graph.build import build, catalogue_from_line
from graph.score import score
from graph.synth import synth_segments
from graph.toy import toy_events, toy_line

ROOT = Path(__file__).parents[2]
LINE = toy_line()
CAT = catalogue_from_line(LINE)


def rebuilt(noise, seed=1, units=40):
    return build(synth_segments(toy_events(LINE, units, seed), LINE, seed, noise), CAT)


def values(s):
    return {k: v["value"] for k, v in s.items() if k != "matching"}


def test_noiseless_recovers_everything():
    s = values(score(rebuilt(False)[0], LINE))
    assert s["operationRecall"] == s["operationPrecision"] == 1.0
    assert s["edgeRecall"] == 1.0 and s["edgeTypeAccuracy"] == 1.0
    assert s["timeMeanAbsPctError"] < 0.05


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_noisy_input_stays_safe(seed):
    line, ev = rebuilt(True, seed)
    s = values(score(line, LINE))
    assert s["operationRecall"] >= 0.9
    assert s["trueHardPredictedSoft"] == 0
    assert ev["droppedClusters"]  # mislabels are filtered as noise, not turned into ops


def test_soft_pairs_found_from_order_variance():
    line, _ = rebuilt(False)
    soft = [e for e in line["edges"] if e["type"] == "soft"]
    assert len(soft) == 2 and all(e["evidence"] == "video_order_variance" for e in soft)


def test_low_data_pairs_default_to_hard_and_are_flagged():
    line, ev = rebuilt(False, units=3)
    assert all(e["type"] == "hard" for e in line["edges"])
    assert ev["lowDataEdges"] > 0


def test_output_is_a_sourced_line():
    line, _ = rebuilt(True)
    assert set(line) >= {"id", "takt", "operations", "edges", "parts", "stations", "variants", "levers"}
    assert line["takt"]["source"].startswith("synthetic")
    for o in line["operations"]:
        for t in o["time"].values():
            assert t["mean"]["source"] and t["sd"]["source"]
    assert line == rebuilt(True)[0]  # deterministic


def test_builder_never_reads_ground_truth():
    src = (ROOT / "graph/build.py").read_text()
    for banned in ("open(", "read_text", "events", "line.json"):
        assert banned not in src.split('"""', 2)[2], banned


def test_runs_on_dummy_event_log():
    truth = json.loads((ROOT / "app/public/data/line.json").read_text())
    events = json.loads((ROOT / "app/public/data/events_current.json").read_text())
    line, _ = build(synth_segments(events, truth, 1, False), catalogue_from_line(truth))
    assert values(score(line, truth))["operationRecall"] == 1.0


def test_unknown_sizes_and_unseen_variants_are_flagged():
    seg = synth_segments(toy_events(LINE, 20, 1), LINE, 1, False)
    for s in seg["segments"]:
        if s["unit_size"] == "medium":
            s["unit_size"] = "XL"
    line, ev = build(seg, CAT)
    assert ev["unknownUnitSizes"] == ["XL"]
    assert ev["unobservedVariants"]
