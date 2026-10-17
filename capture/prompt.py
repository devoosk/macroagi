"""VLM prompt. Bump PROMPT_VERSION on any change: it is part of the cache key."""
from __future__ import annotations

from typing import List

from .frames import Window
from .vocab import Vocab

PROMPT_VERSION = "v6"

CAMERA_DESCRIPTIONS = {
    "cctv": "a fixed, high-mounted surveillance camera looking down at one assembly station",
    "fpv": "a head-mounted first-person camera worn by the worker at one assembly station",
}


def system_prompt(vocab: Vocab) -> str:
    verbs = "\n".join(f"- {v}: {d}" for v, d in vocab.verbs)
    parts = "\n".join(f"- {p}: {n}" + (f" ({h})" if h else "") for p, n, h in vocab.parts)
    tools = "\n".join(f"- {t}: {d}" for t, d in vocab.tools)
    sizes = "\n".join(f"- {z}: {d}" for z, d in vocab.unit_sizes)
    return f"""You label factory assembly footage. You get a short sequence of frames from one camera, \
one frame per timestamp, and report what the worker is doing as time segments.

Action vocabulary (use these ids only):
{verbs}

Parts list (use these ids only):
{parts}

Tools (use these ids only):
{tools}

Unit sizes (the product being assembled comes in these sizes; use these ids, or "none" if no unit is at the station):
{sizes}

Rules:
- A segment is a span of consecutive frames in which the worker performs one action from the vocabulary.
- start_t and end_t are timestamps of the first and last frame of the segment, copied exactly from the frame labels.
- Leave out frames where the worker is idle: standing at the station with empty hands, waiting, or just looking \
around or down the line. In the first-person view, idle looks like a steady view of the line or the floor with no \
hands working; walking needs the view to travel across the floor. Idle stretches are common; do not invent an action.
- If the worker has walked out of a station camera's view, label those frames walk.
- Actions are often long (10 to 60 seconds): keep one segment across frames as long as the same action continues.
- parts lists only the parts the worker is handling or working on in that segment; use an empty list if none is identifiable.
- Start a new segment whenever the action or the parts change, even if the worker does not move away.
- tool is the tool in the worker's hand during the segment ("none" for bare hands).
- unit_size is the size of the unit at the station during the segment; judge it against the conveyor and the worker.
- confidence is your probability, between 0 and 1, that the action and parts are right.
- unit_arrivals lists the timestamps of frames where a new unit has just arrived at the work position \
(it was not there, or a different unit was there, in the previous frame). Leave it empty if no unit arrives.
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
                        "tool": {"type": "string", "enum": vocab.tool_ids or ["none"]},
                        "unit_size": {"type": "string", "enum": [*vocab.size_ids, "none"]},
                        "confidence": {"type": "number"},
                    },
                    "required": ["start_t", "end_t", "verb", "parts", "tool", "unit_size", "confidence"],
                    "additionalProperties": False,
                },
            },
            "unit_arrivals": {"type": "array", "items": {"type": "number"}},
        },
        "required": ["segments", "unit_arrivals"],
        "additionalProperties": False,
    }


def cache_material(vocab: Vocab, window: Window) -> List[str]:
    """Everything prompt-side that should invalidate the cache when it changes."""
    return [PROMPT_VERSION, system_prompt(vocab), user_text(window), repr(output_schema(vocab))]
