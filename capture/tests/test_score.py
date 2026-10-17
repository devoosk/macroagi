import copy

import pytest

from capture.oracle import oracle_log
from capture.score import iou, score

from .conftest import EVENTS, LINE


def run(log, gts):
    return score(log, gts)["overall"]


def test_iou():
    assert iou((0, 10), (0, 10)) == 1
    assert iou((0, 10), (5, 15)) == 5 / 15
    assert iou((0, 1), (2, 3)) == 0


def test_oracle_scores_perfect(gts):
    r = run(oracle_log(EVENTS, LINE), gts)
    assert r["slotVerbAccuracy"] == 1
    assert r["activeVerbAccuracy"] == 1
    assert r["parts"]["f1"] == 1
    assert r["segments"]["f1"] == 1
    assert r["operationRecovery"] == 1
    assert r["meanBoundaryError"] == pytest.approx(0, abs=1e-3)  # to_json rounds to ms


def test_shifted_boundaries_degrade(gts):
    log = oracle_log(EVENTS, LINE)
    for s in log["segments"]:
        s["start"] += 3
        s["end"] += 3
    r = run(log, gts)
    assert r["slotVerbAccuracy"] < 1
    assert r["meanBoundaryError"] == pytest.approx(3, abs=1e-3)
    assert r["segments"]["f1"] > 0  # small shift still matches at IoU 0.5


def test_swapped_verbs_degrade(gts):
    log = oracle_log(EVENTS, LINE)
    bad = copy.deepcopy(log)
    for s in bad["segments"]:
        s["verb"] = "walk"
    r = run(bad, gts)
    assert r["activeVerbAccuracy"] == 0
    assert r["segments"]["f1"] == 0
    assert r["operationRecovery"] == 0


def test_wrong_parts_only_hit_parts_and_ops(gts):
    log = oracle_log(EVENTS, LINE)
    for s in log["segments"]:
        s["parts"] = ["P_pipe"] if s["parts"] != ["P_pipe"] else ["P_base"]
    r = run(log, gts)
    assert r["activeVerbAccuracy"] == 1
    assert r["parts"]["f1"] < 1
    assert r["operationRecovery"] < 1


def test_no_predictions(gts):
    log = oracle_log(EVENTS, LINE)
    log["segments"] = []
    r = run(log, gts)
    assert r["activeVerbAccuracy"] == 0
    assert r["segments"]["recall"] == 0
    assert set(r["operationsSeen"]) == {g.operation for g in gts}


def test_confusion_counts_every_slot(gts, duration):
    res = score(oracle_log(EVENTS, LINE), gts)
    n = sum(sum(row.values()) for row in res["overall"]["confusion"].values())
    assert n == res["overall"]["slots"] == duration * len({g.station for g in gts})
