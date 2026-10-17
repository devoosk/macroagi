import builtins
import io
import json
from types import SimpleNamespace

import pytest

from capture.frames import discover, list_frames, make_windows
from capture.label import label_footage
from capture.score import score
from capture.vlm import CachedLabeller, ClaudeLabeller, FakeLabeller, LabelError, sanitize
from capture.vocab import Vocab, load_vocab

from .conftest import LINE, truth_answer


def fixture_vocab() -> Vocab:
    """Real verbs, parts from the frozen fixture line (so tests don't follow vocab.json edits)."""
    parts = json.loads(LINE.read_text())["parts"]
    v = load_vocab()
    return Vocab(verbs=v.verbs, parts=tuple((p["id"], p["name"], "") for p in parts), tools=v.tools, unit_sizes=v.unit_sizes)


def test_end_to_end_with_perfect_labeller(footage, gts):
    log = label_footage(footage, FakeLabeller(truth_answer(gts)), workers=4, gap_tol=0, min_dur=0)
    assert {s["cam"] for s in log["segments"]} == {f"cctv:{st}+fp:{st}" for st in log["coverage"]}
    assert log["source"].startswith("VLM fake") and log["fps"] == 1
    assert all(s["visit"] and s["unit_size"] and s["tool"] for s in log["segments"])
    r = score(log, gts)["overall"]
    assert r["slotVerbAccuracy"] == 1
    assert r["operationRecovery"] == 1
    assert r["unitSizeAccuracy"] == 1 and r["toolAccuracy"] == 1
    # Per-camera streams score as well.
    assert score(log, gts, which="cameraSegments")["overall"]["slotVerbAccuracy"] == 1


def test_never_reads_hidden_contracts(footage, gts, monkeypatch):
    fake = truth_answer(gts)  # ground truth is loaded before the spy starts
    opened = []
    real_open, real_io_open = builtins.open, io.open

    def spy(real):
        def f(file, *a, **k):
            opened.append(str(file))
            return real(file, *a, **k)

        return f

    monkeypatch.setattr(builtins, "open", spy(real_open))
    monkeypatch.setattr(io, "open", spy(real_io_open))
    label_footage(footage, FakeLabeller(fake), workers=1)
    assert opened, "spy saw no file access"
    leaks = [p for p in opened if p.endswith("line.json") or "events_" in p]
    assert leaks == []


def test_cache_makes_reruns_identical(footage, gts, tmp_path):
    inner = FakeLabeller(truth_answer(gts))
    cached = CachedLabeller(inner, tmp_path / "cache")
    a = label_footage(footage, cached, cams=["cctv:S01"])
    calls = inner.calls
    b = label_footage(footage, cached, cams=["cctv:S01"])
    assert inner.calls == calls and cached.hits == calls
    assert json.dumps(a) == json.dumps(b)


def test_sanitize_clamps_and_filters(tmp_path):
    from .conftest import write_camera

    write_camera(tmp_path, "c", "cctv", "S01", range(10, 18))
    w = make_windows(list_frames(discover(tmp_path)[0]))[0]
    vocab = fixture_vocab()
    out = sanitize(
        [
            {"start_t": 5, "end_t": 12, "verb": "screw", "parts": ["P_screw", "P_bogus"], "tool": "torque_driver",
             "unit_size": "huge", "confidence": 1.4},
            {"start_t": 13, "end_t": 14, "verb": "dance", "parts": [], "confidence": 0.5},
            {"start_t": 30, "end_t": 40, "verb": "pick", "parts": [], "confidence": 0.5},
        ],
        w,
        vocab,
    )
    assert out == [{"start_t": 10, "end_t": 12, "verb": "screw", "parts": ["P_screw"], "tool": "torque_driver",
                    "unit_size": "", "confidence": 1.0}]


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.kwargs = None
        self.messages = self

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def window(tmp_path):
    from .conftest import write_camera

    write_camera(tmp_path, "fp_S02", "fpv", "S02", range(4))
    return make_windows(list_frames(discover(tmp_path)[0]), 4, 0)[0]


def test_claude_request_and_parse(tmp_path):
    w = window(tmp_path)
    body = {"segments": [{"start_t": 1, "end_t": 2, "verb": "braze", "parts": ["P_pipe"], "tool": "torch",
                          "unit_size": "large", "confidence": 0.8}], "unit_arrivals": [1, 99]}
    client = FakeClient(SimpleNamespace(stop_reason="end_turn", stop_details=None, content=[SimpleNamespace(type="text", text=json.dumps(body))]))
    labeller = ClaudeLabeller(fixture_vocab(), client=client)
    assert labeller.label(w) == {
        "segments": [{"start_t": 1, "end_t": 2, "verb": "braze", "parts": ["P_pipe"], "tool": "torch",
                      "unit_size": "large", "confidence": 0.8}],
        "arrivals": [1.0],  # 99 is outside the window
    }

    kw = client.kwargs
    content = kw["messages"][0]["content"]
    assert [c["type"] for c in content] == ["text", "image"] * 4 + ["text"]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert "tool_choice" not in kw
    # The prompt names cameras and timestamps, never operation or station ids. (Station kinds
    # like "brazing" overlap with the action vocabulary, so they can't be checked by word.)
    import re

    text = kw["system"] + " ".join(c.get("text", "") for c in content)
    line = json.loads(LINE.read_text())
    assert not re.search(r"\bO\d+\b", text)
    assert not any(re.search(rf"\b{s['id']}\b", text) for s in line["stations"])


def test_claude_refusal_raises(tmp_path):
    client = FakeClient(SimpleNamespace(stop_reason="refusal", stop_details={"category": None}, content=[]))
    with pytest.raises(LabelError):
        ClaudeLabeller(fixture_vocab(), client=client).label(window(tmp_path))


def test_bay_stations_use_per_bay_streams(tmp_path):
    from capture.frames import discover
    from capture.label import streams_for_station

    from .conftest import write_camera

    for cam, kind in [("cctv_S05", "cctv"), ("fp_S05", "fpv"), ("cctv_S05#0", "cctv"), ("cctv_S05#1", "cctv")]:
        write_camera(tmp_path, cam, kind, "S05", range(2))
    write_camera(tmp_path, "cctv_S01", "cctv", "S01", range(2))
    write_camera(tmp_path, "fp_S01", "fpv", "S01", range(2))
    cams = discover(tmp_path)
    s05 = streams_for_station([c for c in cams if c.station == "S05"])
    assert [([c.id for c in cs], bay) for cs, bay in s05] == [(["cctv:S05#0"], 0), (["cctv:S05#1"], 1)]
    s01 = streams_for_station([c for c in cams if c.station == "S01"])
    assert [([c.id for c in cs], bay) for cs, bay in s01] == [(["cctv:S01", "fp:S01"], None)]


def test_visits_split_on_gap_and_size():
    from capture.label import assign_visits
    from capture.segments import Segment

    def seg(a, b, size):
        return Segment("cctv:S01", "S01", a, b, "screw", (), 1.0, unit_size=size)

    out = assign_visits([seg(0, 5, "small"), seg(6, 9, "small"), seg(20, 25, "small"), seg(25, 30, "large")], gap=3)
    assert [s.visit for s in out] == ["cctv:S01#1", "cctv:S01#1", "cctv:S01#2", "cctv:S01#3"]


def test_annotate_majority_by_overlap(tmp_path):
    from capture.label import annotate
    from capture.segments import Segment

    from .conftest import write_camera

    write_camera(tmp_path, "c", "cctv", "S01", range(8))
    w = make_windows(list_frames(discover(tmp_path)[0]), 8, 0)[0]
    raw = [(w, [
        {"start_t": 0, "end_t": 5, "verb": "screw", "parts": [], "tool": "torque_driver", "unit_size": "large", "confidence": 0.9},
        {"start_t": 6, "end_t": 6, "verb": "screw", "parts": [], "tool": "screwdriver", "unit_size": "small", "confidence": 0.9},
        {"start_t": 0, "end_t": 7, "verb": "pick", "parts": [], "tool": "none", "unit_size": "small", "confidence": 1.0},
    ])]
    [s] = annotate([Segment("c", "S01", 0, 7, "screw", (), 0.9)], raw)
    assert (s.tool, s.unit_size) == ("torque_driver", "large")


def test_visits_split_at_arrivals_once_each():
    from capture.label import assign_visits
    from capture.segments import Segment

    segs = [Segment("c", "S01", a, b, "screw", (), 1.0) for a, b in [(0, 5), (12, 15), (30, 35), (36, 40), (41, 44)]]
    # Arrival at 31 is reported a second late; it still opens one visit, not three.
    out = assign_visits(segs, gap=3, arrivals=[0, 31])
    assert [s.visit for s in out] == ["c#1", "c#1", "c#2", "c#2", "c#2"]


def test_cluster_times():
    from capture.label import cluster_times

    assert cluster_times([10, 11, 10, 40, 41.5, 100]) == [10, 41.5, 100]


def test_label_output_feeds_graph(footage, gts):
    """capture -> graph: a perfect labeller must let graph rebuild every operation."""
    from graph.build import build, catalogue_from_line

    from .conftest import LINE

    log = label_footage(footage, FakeLabeller(truth_answer(gts)), workers=4)
    line = json.loads(LINE.read_text())
    inferred, _ = build(log, catalogue_from_line(line))
    assert sorted((o["station"], o["verb"], tuple(o["parts"])) for o in inferred["operations"]) == sorted(
        (o["station"], o["verb"], tuple(o["parts"])) for o in line["operations"]
    )
