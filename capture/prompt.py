"""VLM prompt. Bump PROMPT_VERSION on any change: it is part of the cache key."""
from __future__ import annotations

from typing import List

from .frames import Window
from .vocab import Vocab

PROMPT_VERSION = "v1"

CAMERA_DESCRIPTIONS = {
    "cctv": "a fixed, high-mounted surveillance camera looking down at one assembly station",
    "fpv": "a head-mounted first-person camera worn by the worker at one assembly station",
}


def system_prompt(vocab: Vocab) -> str:
    verbs = "\n".join(f"- {v}: {d}" for v, d in vocab.verbs)
    parts = "\n".join(f"- {p}: {n}" + (f" ({h})" if h else "") for p, n, h in vocab.parts)
    return f"""You label factory assembly footage. You get a short sequence of frames from one camera, \
one frame per timestamp, and report what the worker is doing as time segments.

Action vocabulary (use these ids only):
{verbs}

Parts list (use these ids only):
{parts}

Rules:
- A segment is a span of consecutive frames in which the worker performs one action from the vocabulary.
- start_t and end_t are timestamps of the first and last frame of the segment, copied exactly from the frame labels.
- Leave out frames where the worker does none of the listed actions (waiting, standing still, no unit present).
- parts lists only the parts the worker is handling or working on in that segment; use an empty list if none is identifiable.
- Start a new segment whenever the action or the parts change, even if the worker does not move away.
- confidence is your probability, between 0 and 1, that the action and parts are right.
- Judge from what is visible. Do not guess an action you cannot see."""


def user_text(window: Window) -> str:
    cam = window.cam
    return (
        f"Camera: {CAMERA_DESCRIPTIONS.get(cam.kind, cam.kind)}. "
        f"Frames run from t={window.t0:g}s to t={window.frames[-1].t:g}s, every {cam.step:g}s. "
        "Return the segments for this sequence."
    )


def frame_caption(t: float) -> str:
    return f"Frame t={t:g}s"


def output_schema(vocab: Vocab) -> dict:
    return {
        "type": "object",
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start_t": {"type": "number"},
                        "end_t": {"type": "number"},
                        "verb": {"type": "string", "enum": vocab.verb_ids},
                        "parts": {"type": "array", "items": {"type": "string", "enum": vocab.part_ids}},
                        "confidence": {"type": "number"},
                    },
                    "required": ["start_t", "end_t", "verb", "parts", "confidence"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["segments"],
        "additionalProperties": False,
    }


def cache_material(vocab: Vocab, window: Window) -> List[str]:
    """Everything prompt-side that should invalidate the cache when it changes."""
    return [PROMPT_VERSION, system_prompt(vocab), user_text(window), repr(output_schema(vocab))]
