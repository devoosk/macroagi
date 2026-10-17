"""python -m graph <segments.json> --catalogue <catalogue.json|line.json> -o line_v2.json [--overrides edge_overrides.json]

Passing line.json as --catalogue is allowed: only parts, variants and the
station registry are taken from it.
"""

import argparse
import json
from pathlib import Path

from .build import build, catalogue_from_line


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m graph")
    p.add_argument("segments", type=Path)
    p.add_argument("--catalogue", type=Path, required=True)
    p.add_argument("--overrides", type=Path)
    p.add_argument("-o", "--out", type=Path, required=True)
    a = p.parse_args()
    cat = json.loads(a.catalogue.read_text())
    if "operations" in cat:
        cat = catalogue_from_line(cat)
    overrides = json.loads(a.overrides.read_text()) if a.overrides else []
    line, evidence = build(json.loads(a.segments.read_text()), cat, overrides)
    a.out.write_text(json.dumps(line, indent=2) + "\n")
    ev = a.out.with_name("graph_evidence.json")
    ev.write_text(json.dumps(evidence, indent=2) + "\n")
    print(f"wrote {a.out} ({len(line['operations'])} ops, {len(line['edges'])} edges, "
          f"{evidence['lowDataEdges']} low-data edges for review) and {ev}")


if __name__ == "__main__":
    main()
