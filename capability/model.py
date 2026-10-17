from collections.abc import Iterable
from dataclasses import dataclass, field

from scipy.stats import beta as beta_dist

from .features import Features, features_for
from .levers import apply_levers, changing_levers, feature_changes
from .priors import PRIORS

ADJ = PRIORS["adjustments"]


@dataclass
class Estimate:
    operation: str
    levers: tuple[str, ...]
    mean: float
    p05: float
    p95: float
    alpha: float | None
    beta: float | None
    time_factor: dict[str, float]
    robot_time: dict[str, float]
    features: Features
    reasons: list[str] = field(default_factory=list)
    source: str = PRIORS["source"]

    @property
    def waste(self) -> bool:
        return self.features.waste

    @property
    def eliminated(self) -> bool:
        return self.features.eliminated


def _step(table: list[list[float]], x: float) -> float:
    m = 1.0
    for threshold, mult in table:
        if x >= threshold:
            m = mult
    return m


def _multipliers(f: Features) -> list[tuple[str, float]]:
    return [
        (f"{f.rigidity} part", ADJ["rigidity"][f.rigidity]),
        (f"{f.tolerance} tolerance", ADJ["tolerance"][f.tolerance]),
        (f"{f.mass_kg:g} kg payload", _step(ADJ["massKg"], f.mass_kg)),
        (f"tool {f.tool}", ADJ["tool"][f.tool]),
        (f"{f.variants} variants", _step(ADJ["variants"], f.variants)),
    ]


def estimate(op: dict, line: dict, levers: Iterable[str] = ()) -> Estimate:
    """Robot success range and time for one operation with a set of lever types."""
    f = apply_levers(features_for(op, line), levers)
    variants = [v["id"] for v in line["variants"] if op["id"] in v["operations"]]

    if f.eliminated:
        return Estimate(
            operation=op["id"], levers=f.levers, mean=1.0, p05=1.0, p95=1.0, alpha=None, beta=None,
            time_factor={"low": 0.0, "mean": 0.0, "high": 0.0},
            robot_time={v: 0.0 for v in variants}, features=f, reasons=["eliminated by lever"],
        )

    mean, n = PRIORS["success"][f.verb][f.presentation]
    reasons = [f"prior {f.verb} from {f.presentation}: {mean:.3f}"]
    fail = 1.0 - mean
    for label, mult in _multipliers(f):
        if mult != 1.0:
            fail *= mult
            n *= ADJ["concentrationPenalty"]
            reasons.append(f"{label}: failure x{mult:g}")
    fail = min(fail, ADJ["maxFailure"])
    mean = 1.0 - fail
    a, b = mean * n, fail * n
    if f.waste:
        reasons.append(f"{f.verb} is waste: eliminate rather than automate")

    tf = PRIORS["timeFactor"]
    factor = tf["byVerb"][f.verb]
    lo, hi = tf["spread"]
    time_factor = {"low": factor * lo, "mean": factor, "high": factor * hi}
    robot_time = {v: op["time"][v]["mean"]["value"] * factor for v in variants if v in op["time"]}

    return Estimate(
        operation=op["id"], levers=f.levers, mean=mean,
        p05=float(beta_dist.ppf(0.05, a, b)), p95=float(beta_dist.ppf(0.95, a, b)),
        alpha=a, beta=b, time_factor=time_factor, robot_time=robot_time, features=f, reasons=reasons,
    )


def clears(est: Estimate, floor: float, quantile: float = 0.05) -> bool:
    """Robot candidate test: the pessimistic end of the range clears the floor."""
    if est.eliminated:
        return True
    a, b = est.alpha, est.beta
    return float(beta_dist.ppf(quantile, a, b)) >= floor


def applicable_levers(op: dict, line: dict) -> list[str]:
    """Lever types that change this operation's capability (regroup/decouple never do)."""
    return changing_levers(features_for(op, line))


def lever_feature_changes(op: dict, line: dict, lever: str) -> dict[str, str]:
    """What one lever type changes on this operation, for Lever.featureChanges."""
    f = features_for(op, line)
    return feature_changes(f, apply_levers(f, [lever]))
