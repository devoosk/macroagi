"""Consistency checks on an event log. Returns a list of problems; empty means the log is valid."""

from __future__ import annotations

from collections import defaultdict

from .line import Line

#: Legal next events per bay, given the bay's previous event.
_NEXT = {
    None: {'start', 'starved'},
    'start': {'op_start', 'end'},
    'op_start': {'op_end'},
    'op_end': {'op_start', 'end', 'failed'},
    'end': {'start', 'starved', 'blocked', 'failed'},
    # Test failure: end -> failed -> rework (re-test in place) or the unit left for brazing.
    # Robot failure with fallback: op_end -> failed -> end.
    'failed': {'rework', 'end', 'start', 'starved'},
    'rework': {'start'},
    'blocked': {'start', 'starved'},
    'starved': {'start'},
}


def validate(log: dict, line: Line) -> list[str]:
    problems: list[str] = []
    events = log['events']
    if [e['time'] for e in events] != sorted(e['time'] for e in events):
        problems.append('events are not sorted by time')

    variant_ops = {v.id: v.operations for v in line.variants}
    station_ops = {s.id: set(s.operations) for s in line.stations}
    offline = {s.id for s in line.stations if s.offline}

    last: dict[tuple, str | None] = defaultdict(lambda: None)
    occupant: dict[tuple, str] = {}
    #: unit -> bay, between `start` and `end`.
    working: dict[str, tuple] = {}
    pass_ops: dict[str, list[str]] = {}

    for i, e in enumerate(events):
        ev, st, u = e['event'], e['station'], e['unit']
        key = (st, e.get('bay', 0))
        prev = last[key]
        if ev == 'rework' and prev != 'failed':
            # Leak-test rework announced at brazing; not a bay event.
            continue
        if ev not in _NEXT[prev]:
            problems.append(f'#{i} {key}: {ev} after {prev}')
        last[key] = ev

        if ev == 'start':
            if u in working:
                problems.append(f'#{i} {u} starts at {key} while working at {working[u]}')
            if key in occupant and working.get(occupant[key]) == key:
                problems.append(f'#{i} {u} starts at {key} while {occupant[key]} is still working there')
            occupant[key] = u
            working[u] = key
            pass_ops[u] = []
        elif ev in ('op_start', 'op_end'):
            if working.get(u) != key:
                problems.append(f'#{i} {u} {ev} at {key} but is working at {working.get(u)}')
            op = e.get('operation')
            if ev == 'op_start':
                if st not in offline and op not in station_ops[st]:
                    problems.append(f'#{i} {op} is not an op of {st}')
                if op not in variant_ops.get(e['variant'], set()):
                    problems.append(f'#{i} {op} is not used by variant {e["variant"]}')
                if op in pass_ops.get(u, []):
                    problems.append(f'#{i} {u} repeats {op} in one pass at {st}')
                pass_ops.setdefault(u, []).append(op)
        elif ev == 'end':
            working.pop(u, None)
            ops = set(pass_ops.pop(u, []))
            if st in offline:
                continue
            expected = station_ops[st] & variant_ops.get(e['variant'], set())
            if prev == 'failed':
                if not ops <= expected:
                    problems.append(f'#{i} {u} diverted from {st} with ops {sorted(ops)}')
            elif ops != expected:
                problems.append(f'#{i} {u} ends {st} with ops {sorted(ops)}, expected {sorted(expected)}')
    return problems
