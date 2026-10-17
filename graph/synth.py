"""python -m graph.synth <events.json> --line <line.json> [--seed 1] [--clean] -o segments.json

Stand-in for item 3: turns op_start/op_end events into VLM-like segments with
noise (boundary jitter, 1 fps quantisation, drops, mislabels, splits). Unit and
variant ids are dropped; only a visible unit size is kept.
"""

import argparse
import json
import random
from pathlib import Path

VERBS = ["pick", "place", "insert", "screw", "connect", "braze", "inspect", "walk", "search"]
SIZES = ["small", "medium", "large"]


def synth_segments(events: dict, line: dict, seed: int = 1, noise: bool = True) -> dict:
    rng = random.Random(seed)
    ops = {o["id"]: o for o in line["operations"]}
    by_kw = sorted(line["variants"], key=lambda v: v["kw"])
    size = {v["id"]: SIZES[round(i * (len(SIZES) - 1) / max(len(by_kw) - 1, 1))] for i, v in enumerate(by_kw)}
    visits, opened, segs = {}, {}, []
    for e in sorted(events["events"], key=lambda e: e["time"]):
        key = (e["unit"], e["station"])
        if e["event"] == "start":
            visits[e["station"]] = visits.get(e["station"], 0) + 1
            opened[key] = f"{e['station']}#{visits[e['station']]}"
        elif e["event"] == "op_start":
            segs.append({"cam": f"cctv:{e['station']}", "station": e["station"], "start": e["time"],
                         "verb": ops[e["operation"]]["verb"], "parts": list(ops[e["operation"]]["parts"]),
                         "visit": opened[key], "unit_size": size[e["variant"]], "_op": e["operation"]})
        elif e["event"] == "op_end":
            s = next(s for s in reversed(segs) if s["_op"] == e["operation"] and s["visit"] == opened[key] and "end" not in s)
            s["end"] = e["time"]

    out = []
    for s in segs:
        s.pop("_op")
        if "end" not in s:
            continue  # still running when the log ends
        if noise:
            if rng.random() < 0.05:
                continue
            if rng.random() < 0.05:
                s["verb"] = rng.choice([v for v in VERBS if v != s["verb"]])
            s["start"] += rng.uniform(-1, 1)
            s["end"] += rng.uniform(-1, 1)
        s["start"], s["end"] = float(round(s["start"])), float(round(max(s["end"], s["start"] + 1)))
        if noise and rng.random() < 0.03 and s["end"] - s["start"] >= 4:
            mid = float(round((s["start"] + s["end"]) / 2))
            out += [{**s, "end": mid}, {**s, "start": mid}]
        else:
            out.append(s)
    return {"line": events["line"], "source": f"synthetic from event log, seed {seed}", "fps": 1, "segments": out}


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m graph.synth")
    p.add_argument("events", type=Path)
    p.add_argument("--line", type=Path, required=True)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--clean", action="store_true", help="no noise")
    p.add_argument("-o", "--out", type=Path, required=True)
    a = p.parse_args()
    seg = synth_segments(json.loads(a.events.read_text()), json.loads(a.line.read_text()), a.seed, not a.clean)
    a.out.write_text(json.dumps(seg, indent=2) + "\n")
    print(f"wrote {a.out}: {len(seg['segments'])} segments")


if __name__ == "__main__":
    main()
