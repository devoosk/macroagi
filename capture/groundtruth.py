"""Ground truth from the hidden contracts. Only score.py and oracle.py may import this."""
from __future__ import annotations

import json
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Deque, Dict, List, Tuple

from .segments import Label, make_label


@dataclass(frozen=True)
class GtInterval:
    station: str
    start: float
    end: float
    operation: str
    unit: str
    label: Label

    @property
    def verb(self) -> str:
        return self.label[0]


def load_ground_truth(events_path: Path, line_path: Path) -> List[GtInterval]:
    line = json.loads(Path(line_path).read_text())
    log = json.loads(Path(events_path).read_text())
    ops = {o["id"]: o for o in line["operations"]}

    open_ops: Dict[Tuple, Deque[float]] = defaultdict(deque)
    out: List[GtInterval] = []
    for e in sorted(log["events"], key=lambda e: e["time"]):
        if e["event"] not in ("op_start", "op_end"):
            continue
        key = (e["unit"], e["station"], e["operation"], e.get("bay"))
        if e["event"] == "op_start":
            open_ops[key].append(e["time"])
        elif open_ops[key]:
            start = open_ops[key].popleft()
            op = ops[e["operation"]]
            out.append(
                GtInterval(e["station"], float(start), float(e["time"]), op["id"], e["unit"], make_label(op["verb"], op["parts"]))
            )
    return sorted(out, key=lambda g: (g.station, g.start, g.operation))
