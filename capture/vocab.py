"""Fixed verb vocabulary and parts list given to the VLM.

The vocabulary is a hand-authored prior (verb classes plus a BOM-style parts list),
not the line's process graph. `make_vocab` copies only part ids and names from
line.json so ids line up with the ground truth; it never copies operations, edges,
stations or times.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

DEFAULT_VOCAB = Path(__file__).parent / "vocab.json"


@dataclass(frozen=True)
class Vocab:
    verbs: Tuple[Tuple[str, str], ...]  # (id, visual description)
    parts: Tuple[Tuple[str, str, str], ...]  # (id, name, visual hint)
    tools: Tuple[Tuple[str, str], ...] = ()  # (id, visual description)
    unit_sizes: Tuple[Tuple[str, str], ...] = ()  # (id, visual description), small to large

    @property
    def verb_ids(self) -> List[str]:
        return [v for v, _ in self.verbs]

    @property
    def part_ids(self) -> List[str]:
        return [p for p, _, _ in self.parts]

    @property
    def tool_ids(self) -> List[str]:
        return [t for t, _ in self.tools]

    @property
    def size_ids(self) -> List[str]:
        return [z for z, _ in self.unit_sizes]

    def to_json(self) -> dict:
        return {
            "verbs": [{"id": v, "description": d} for v, d in self.verbs],
            "parts": [{"id": p, "name": n, "hint": h} for p, n, h in self.parts],
            "tools": [{"id": t, "description": d} for t, d in self.tools],
            "unitSizes": [{"id": z, "description": d} for z, d in self.unit_sizes],
        }


def load_vocab(path: Path = DEFAULT_VOCAB) -> Vocab:
    d = json.loads(Path(path).read_text())
    return Vocab(
        verbs=tuple((v["id"], v["description"]) for v in d["verbs"]),
        parts=tuple((p["id"], p["name"], p.get("hint", "")) for p in d["parts"]),
        tools=tuple((t["id"], t["description"]) for t in d.get("tools", [])),
        unit_sizes=tuple((z["id"], z["description"]) for z in d.get("unitSizes", [])),
    )


def make_vocab(line_path: Path, out_path: Path = DEFAULT_VOCAB) -> Vocab:
    """Refresh the parts list from line.json, keeping verbs and any hand-written hints."""
    line = json.loads(Path(line_path).read_text())
    old = load_vocab(out_path) if Path(out_path).exists() else Vocab((), ())
    hints: Dict[str, str] = {p: h for p, _, h in old.parts}
    vocab = Vocab(
        verbs=old.verbs,
        parts=tuple((p["id"], p["name"], hints.get(p["id"], "")) for p in line["parts"]),
        tools=old.tools,
        unit_sizes=old.unit_sizes,
    )
    Path(out_path).write_text(json.dumps(vocab.to_json(), indent=2) + "\n")
    return vocab
