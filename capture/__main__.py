"""CLI. Run from the repo root: `python -m capture <command> --help`."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "app" / "public" / "data"
OUT = REPO / "capture" / "out"


def load_dotenv() -> None:
    """Load KEY=VALUE lines from the repo's .env (or the main checkout's, from a git worktree).

    Variables already set in the environment win. Values are never printed.
    """
    import os
    import subprocess

    candidates = [REPO / ".env"]
    try:
        common = subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        candidates.append(Path(common).parent / ".env")
    except (OSError, subprocess.CalledProcessError):
        pass
    for path in candidates:
        if path.is_file():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.removeprefix("export ").split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip("'\""))
            return


def cmd_make_vocab(a) -> None:
    from .vocab import make_vocab

    v = make_vocab(a.line, a.out)
    print(f"wrote {a.out}: {len(v.verbs)} verbs, {len(v.parts)} parts")


def cmd_label(a) -> None:
    from .label import label_footage, summary
    from .segments import write_segment_log
    from .vlm import build_labeller
    from .vocab import load_vocab

    load_dotenv()
    labeller = build_labeller(load_vocab(a.vocab), a.model, a.effort, a.max_width, None if a.no_cache else a.cache_dir)
    log = label_footage(
        a.frames_dir,
        labeller,
        cams=a.cams.split(",") if a.cams else None,
        t_from=a.t_from,
        t_to=a.t_to,
        window=a.window,
        overlap=a.overlap,
        workers=a.workers,
        gap_tol=a.gap_tol,
        min_dur=a.min_dur,
        min_conf=a.min_conf,
    )
    write_segment_log(a.out, log)
    print("\n".join(summary(log)))
    if hasattr(labeller, "hits"):
        print(f"cache: {labeller.hits} hits, {labeller.misses} misses")
    print(f"wrote {a.out}")


def cmd_score(a) -> None:
    from .groundtruth import load_ground_truth
    from .score import format_table, score
    from .segments import read_segment_log

    result = score(read_segment_log(a.segments), load_ground_truth(a.events, a.line), a.which, a.iou)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2) + "\n")
    print(format_table(result))
    print(f"wrote {a.out}")


def cmd_oracle(a) -> None:
    from .oracle import oracle_log
    from .segments import write_segment_log

    write_segment_log(a.out, oracle_log(a.events, a.line))
    print(f"wrote {a.out}")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="python -m capture")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("make-vocab", help="refresh the parts list in vocab.json from line.json (part ids/names only)")
    s.add_argument("--line", type=Path, default=DATA / "line.json")
    s.add_argument("--out", type=Path, default=Path(__file__).parent / "vocab.json")
    s.set_defaults(fn=cmd_make_vocab)

    s = sub.add_parser("label", help="label rendered frames with the VLM (pixels only)")
    s.add_argument("--frames-dir", type=Path, default=REPO / "capture" / "frames")
    s.add_argument("--cams", help="comma-separated camera ids, e.g. cctv_S01,fpv_S01 (default: all)")
    s.add_argument("--from", dest="t_from", type=float)
    s.add_argument("--to", dest="t_to", type=float)
    s.add_argument("--out", type=Path, default=OUT / "segments.json")
    s.add_argument("--vocab", type=Path, default=Path(__file__).parent / "vocab.json")
    s.add_argument("--model", default="claude-opus-5-5")
    s.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"])
    s.add_argument("--max-width", type=int, default=768)
    s.add_argument("--window", type=int, default=8)
    s.add_argument("--overlap", type=int, default=2)
    s.add_argument("--workers", type=int, default=4)
    s.add_argument("--gap-tol", type=float, default=2.0, help="fill idle gaps up to this many seconds inside one action")
    s.add_argument("--min-dur", type=float, default=2.0, help="drop segments shorter than this")
    s.add_argument("--min-conf", type=float, default=0.4, help="treat VLM answers below this confidence as idle")
    s.add_argument("--cache-dir", type=Path, default=REPO / "capture" / ".cache")
    s.add_argument("--no-cache", action="store_true")
    s.set_defaults(fn=cmd_label)

    s = sub.add_parser("score", help="score segments.json against the hidden ground truth")
    s.add_argument("--segments", type=Path, default=OUT / "segments.json")
    s.add_argument("--events", type=Path, default=DATA / "events_current.json")
    s.add_argument("--line", type=Path, default=DATA / "line.json")
    s.add_argument("--which", default="segments", choices=["segments", "cameraSegments"])
    s.add_argument("--iou", type=float, default=0.5)
    s.add_argument("--out", type=Path, default=OUT / "score.json")
    s.set_defaults(fn=cmd_score)

    s = sub.add_parser("oracle", help="write perfect segments from the ground truth (scorer check only)")
    s.add_argument("--events", type=Path, default=DATA / "events_current.json")
    s.add_argument("--line", type=Path, default=DATA / "line.json")
    s.add_argument("--out", type=Path, default=OUT / "segments_oracle.json")
    s.set_defaults(fn=cmd_oracle)

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
