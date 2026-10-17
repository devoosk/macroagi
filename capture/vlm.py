"""Labellers: turn one window of frames into raw segments.

`ClaudeLabeller` calls the Claude API with structured output. `CachedLabeller` wraps any
labeller with an on-disk cache so reruns are free and byte-identical. `FakeLabeller`
returns scripted answers for tests.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Callable, List, Optional, Protocol

from .frames import Window, encode_frame
from .merge import RawSegment
from .prompt import cache_material, frame_caption, output_schema, system_prompt, user_text
from .vocab import Vocab

DEFAULT_MODEL = "claude-opus-5-5"


class LabelError(RuntimeError):
    pass


class Labeller(Protocol):
    name: str

    def label(self, window: Window) -> List[RawSegment]: ...


def sanitize(raw: List[dict], window: Window, vocab: Vocab) -> List[RawSegment]:
    """Drop or clamp anything outside the vocabulary or the window."""
    verbs, parts = set(vocab.verb_ids), set(vocab.part_ids)
    t_first, t_last = window.frames[0].t, window.frames[-1].t
    out = []
    for s in raw:
        if s.get("verb") not in verbs:
            continue
        start, end = sorted((float(s["start_t"]), float(s["end_t"])))
        start, end = max(start, t_first), min(end, t_last)
        if start > end:
            continue
        out.append(
            {
                "start_t": start,
                "end_t": end,
                "verb": s["verb"],
                "parts": sorted({p for p in s.get("parts", []) if p in parts}),
                "confidence": min(max(float(s.get("confidence", 0.5)), 0.0), 1.0),
            }
        )
    return out


class ClaudeLabeller:
    def __init__(
        self,
        vocab: Vocab,
        model: str = DEFAULT_MODEL,
        effort: str = "medium",
        max_width: int = 768,
        client=None,
    ):
        import anthropic

        self.vocab = vocab
        self.model = model
        self.effort = effort
        self.max_width = max_width
        self.client = client or anthropic.Anthropic(max_retries=5)
        self.name = f"claude:{model}:{effort}"

    def cache_material(self, window: Window) -> List[str]:
        return [self.name, str(self.max_width), *cache_material(self.vocab, window)]

    def request(self, window: Window) -> dict:
        content: list = []
        for f in window.frames:
            data = base64.standard_b64encode(encode_frame(f.path, self.max_width)).decode("ascii")
            content.append({"type": "text", "text": frame_caption(f.t)})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}})
        content.append({"type": "text", "text": user_text(window)})
        return {
            "model": self.model,
            "max_tokens": 16000,
            "system": system_prompt(self.vocab),
            "messages": [{"role": "user", "content": content}],
            "output_config": {"effort": self.effort, "format": {"type": "json_schema", "schema": output_schema(self.vocab)}},
            # Server-side fallback on a refusal, routed by refusal category.
            "extra_headers": {"anthropic-beta": "server-side-fallback-2026-07-01"},
            "extra_body": {"fallbacks": "default"},
        }

    def label(self, window: Window) -> List[RawSegment]:
        response = self.client.messages.create(**self.request(window))
        if response.stop_reason == "refusal":
            raise LabelError(f"{window.cam.id} window {window.index}: refused ({response.stop_details})")
        if response.stop_reason == "max_tokens":
            raise LabelError(f"{window.cam.id} window {window.index}: hit max_tokens")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise LabelError(f"{window.cam.id} window {window.index}: no text block")
        return sanitize(json.loads(text)["segments"], window, self.vocab)


class CachedLabeller:
    def __init__(self, inner, cache_dir: Path):
        self.inner = inner
        self.cache_dir = Path(cache_dir)
        self.name = inner.name
        self.hits = 0
        self.misses = 0

    def key(self, window: Window) -> str:
        h = hashlib.sha256()
        for m in self.inner.cache_material(window):
            h.update(m.encode())
            h.update(b"\0")
        for f in window.frames:
            h.update(f"{f.t:g}".encode())
            h.update(hashlib.sha256(f.path.read_bytes()).digest())
        return h.hexdigest()

    def label(self, window: Window) -> List[RawSegment]:
        path = self.cache_dir / f"{self.key(window)}.json"
        if path.exists():
            self.hits += 1
            return json.loads(path.read_text())
        self.misses += 1
        result = self.inner.label(window)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(result))
        tmp.replace(path)
        return result


class FakeLabeller:
    """Scripted labeller for tests: `fn(window) -> raw segments`."""

    def __init__(self, fn: Callable[[Window], List[RawSegment]], name: str = "fake"):
        self.fn = fn
        self.name = name
        self.calls = 0

    def cache_material(self, window: Window) -> List[str]:
        return [self.name]

    def label(self, window: Window) -> List[RawSegment]:
        self.calls += 1
        return self.fn(window)


def build_labeller(vocab: Vocab, model: str, effort: str, max_width: int, cache_dir: Optional[Path]):
    labeller = ClaudeLabeller(vocab, model=model, effort=effort, max_width=max_width)
    return CachedLabeller(labeller, cache_dir) if cache_dir else labeller
