"""Write event logs and results in the same layout as tools/gen/generate.ts:writeJson."""

from __future__ import annotations

import json
from pathlib import Path


def _compact(x) -> str:
    return json.dumps(x, separators=(',', ':'), ensure_ascii=False)


def write_event_log(path: str | Path, log: dict) -> Path:
    """One event per line: diff-friendly and compact."""
    head = {k: v for k, v in log.items() if k != 'events'}
    text = _compact(head)[:-1] + ',"events":[\n' + ',\n'.join(_compact(e) for e in log['events']) + '\n]}\n'
    p = Path(path)
    p.write_text(text)
    return p


def upsert_design(path: str | Path, design: dict) -> Path:
    """Merge one design's fields into results.json, leaving other designs and fields (capex, stages) alone."""
    p = Path(path)
    results = json.loads(p.read_text()) if p.exists() else {'designs': []}
    for d in results['designs']:
        if d['design'] == design['design']:
            d.update(design)
            break
    else:
        results['designs'].append({'capex': {'value': 0, 'source': 'estimate (not set by simulate/)'}, 'stages': [], **design})
    p.write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')
    return p
