"""Stand-in for step 2's capability model until it merges.

Matches the planned interface `capability.model.estimate(op, line, levers=()) -> Estimate` (see
docs/plans/02-capability-model.md on origin/capability-model). The simulation only needs a success
rate per robot operation, which `op_reliability` turns into the dict SimOptions takes.
"""

from __future__ import annotations

from dataclasses import dataclass

from .line import Line, Operation

#: Pseudo-count of the Beta range; lower means less confident.
_STRENGTH = 50


@dataclass(frozen=True)
class Estimate:
    alpha: float
    beta: float
    source: str = 'estimate (capability stub: flat prior at the swept reliability)'

    @property
    def mean(self) -> float:
        return self.alpha / (self.alpha + self.beta)


def estimate(op: Operation, line: Line, levers=(), reliability: float = 0.98) -> Estimate:
    return Estimate(alpha=reliability * _STRENGTH, beta=(1 - reliability) * _STRENGTH)


def op_reliability(line: Line, robot_stations: list[str], reliability: float) -> dict[str, float]:
    """Success rate per op on the given robot stations, for SimOptions.op_reliability."""
    out = {}
    for sid in robot_stations:
        for oid in line.station(sid).operations:
            out[oid] = estimate(line.operations[oid], line, reliability=reliability).mean
    return out
