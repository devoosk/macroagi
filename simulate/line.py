"""Load line.json (see app/src/contracts/types.ts) into the small structures the simulation needs."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class OpTime:
    mean: float
    sd: float


@dataclass
class Operation:
    id: str
    name: str
    verb: str
    station: str
    #: Per variant id, seconds.
    time: dict[str, OpTime]
    fail_rate: float = 0.0

    def time_for(self, variant: str) -> OpTime:
        return self.time.get(variant) or next(iter(self.time.values()))


@dataclass
class Station:
    id: str
    name: str
    kind: str
    operations: list[str]
    staff: str
    buffer_before: int
    buffer_after: int
    bays: int = 1
    #: Redesigns: id of the human station that takes units after a robot failure.
    fallback: str | None = None
    #: Off-line fallback station, not part of the serial flow.
    offline: bool = False


@dataclass
class Variant:
    id: str
    mix: float
    operations: set[str]


@dataclass
class Line:
    id: str
    operations: dict[str, Operation]
    stations: list[Station]
    variants: list[Variant]
    #: (from, to) pairs of hard precedence edges.
    hard_edges: list[tuple[str, str]]
    soft_edges: list[tuple[str, str]]
    raw: dict = field(repr=False, default_factory=dict)

    @property
    def chain(self) -> list[Station]:
        """Stations on the serial flow, in line order."""
        return [s for s in self.stations if not s.offline]

    def station(self, sid: str) -> Station:
        return next(s for s in self.stations if s.id == sid)


def from_dict(d: dict) -> Line:
    ops = {
        o['id']: Operation(
            id=o['id'],
            name=o['name'],
            verb=o['verb'],
            station=o['station'],
            time={v: OpTime(t['mean']['value'], t['sd']['value']) for v, t in o['time'].items()},
            fail_rate=(o.get('failRate') or {}).get('value', 0.0),
        )
        for o in d['operations']
    }
    stations = [
        Station(
            id=s['id'],
            name=s['name'],
            kind=s['kind'],
            operations=list(s['operations']),
            staff=s['staff'],
            buffer_before=s['bufferBefore'],
            buffer_after=s['bufferAfter'],
            bays=max(1, s.get('bays') or 1),
            fallback=s.get('fallback'),
            offline=bool(s.get('offline', False)),
        )
        for s in d['stations']
    ]
    variants = [Variant(v['id'], v['mix']['value'], set(v['operations'])) for v in d['variants']]
    hard = [(e['from'], e['to']) for e in d['edges'] if e['type'] == 'hard']
    soft = [(e['from'], e['to']) for e in d['edges'] if e['type'] == 'soft']
    return Line(d['id'], ops, stations, variants, hard, soft, raw=d)


def load(path: str | Path) -> Line:
    return from_dict(json.loads(Path(path).read_text()))
