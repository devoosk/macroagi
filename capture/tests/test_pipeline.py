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
    return Vocab(verbs=load_vocab().verbs, parts=tuple((p["id"], p["name"], "") for p in parts))


def test_end_to_end_with_perfect_labeller(footage, gts):
    log = label_footage(footage, FakeLabeller(truth_answer(gts)), workers=4, gap_tol=0, min_dur=0)
    assert {s["cam"] for s in log["segments"]} == {f"cctv_{st}+fp_{st}" for st in log["coverage"]}
    r = score(log, gts)["overall"]
    assert r["slotVerbAccuracy"] == 1
    assert r["operationRecovery"] == 1
    # Per-camera streams score as well.
    assert score(log, gts, which="cameraSegments")["overall"]["slotVerbAccuracy"] == 1


def test_never_reads_hidden_contracts(footage, gts, monkeypatch):
    opened = []
    real_open, real_io_open = builtins.open, io.open

    def spy(real):
        def f(file, *a, **k):
            opened.append(str(file))
            return real(file, *a, **k)

        return f

    monkeypatch.setattr(builtins, "open", spy(real_open))
    monkeypatch.setattr(io, "open", spy(real_io_open))
    fake = truth_answer(gts)  # ground truth is captured before the spy sees anything
    label_footage(footage, FakeLabeller(fake), workers=1)
    assert opened, "spy saw no file access"
    leaks = [p for p in opened if p.endswith("line.json") or "events_" in p]
    assert leaks == []


def test_cache_makes_reruns_identical(footage, gts, tmp_path):
    inner = FakeLabeller(truth_answer(gts))
    cached = CachedLabeller(inner, tmp_path / "cache")
    a = label_footage(footage, cached, cams=["cctv_S01"])
    calls = inner.calls
    b = label_footage(footage, cached, cams=["cctv_S01"])
    assert inner.calls == calls and cached.hits == calls
    assert json.dumps(a) == json.dumps(b)


def test_sanitize_clamps_and_filters(tmp_path):
    from .conftest import write_camera

    write_camera(tmp_path, "c", "cctv", "S01", range(10, 18))
    w = make_windows(list_frames(discover(tmp_path)[0]))[0]
    vocab = fixture_vocab()
    out = sanitize(
        [
            {"start_t": 5, "end_t": 12, "verb": "screw", "parts": ["P_screw", "P_bogus"], "confidence": 1.4},
            {"start_t": 13, "end_t": 14, "verb": "dance", "parts": [], "confidence": 0.5},
            {"start_t": 30, "end_t": 40, "verb": "pick", "parts": [], "confidence": 0.5},
        ],
        w,
        vocab,
    )
    assert out == [{"start_t": 10, "end_t": 12, "verb": "screw", "parts": ["P_screw"], "confidence": 1.0}]


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
    body = {"segments": [{"start_t": 1, "end_t": 2, "verb": "braze", "parts": ["P_pipe"], "confidence": 0.8}]}
    client = FakeClient(SimpleNamespace(stop_reason="end_turn", stop_details=None, content=[SimpleNamespace(type="text", text=json.dumps(body))]))
    labeller = ClaudeLabeller(fixture_vocab(), client=client)
    assert labeller.label(w) == [{"start_t": 1, "end_t": 2, "verb": "braze", "parts": ["P_pipe"], "confidence": 0.8}]

    kw = client.kwargs
    content = kw["messages"][0]["content"]
    assert [c["type"] for c in content] == ["text", "image"] * 4 + ["text"]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert "tool_choice" not in kw
    # The prompt names cameras and timestamps, never stations' kinds or operations.
    text = kw["system"] + " ".join(c.get("text", "") for c in content)
    assert "O1" not in text and "brazing" not in text


def test_claude_refusal_raises(tmp_path):
    client = FakeClient(SimpleNamespace(stop_reason="refusal", stop_details={"category": None}, content=[]))
    with pytest.raises(LabelError):
        ClaudeLabeller(fixture_vocab(), client=client).label(window(tmp_path))
