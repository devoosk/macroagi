from collections.abc import Iterable
from dataclasses import dataclass, field

from scipy.stats import beta as beta_dist

from .features import Features, features_for
from .levers import apply_levers, changing_levers, feature_changes
from .features import TOLERANCE_ORDER
from .priors import PRESENTATION_ORDER, PRIORS, ROBOTS, rank

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
    robot: str | None = None  # robot type from robots.json; None = generic robot
    feasible: bool = True  # False when the robot type can't do it at all (payload, tool, ...)

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


def _robot_limits(f: Features, robot: dict) -> list[str]:
    """Why this robot type cannot do the operation at all (empty if it can)."""
    why = []
    if f.mass_kg > robot["payloadKg"]:
        why.append(f"{f.mass_kg:g} kg over {robot['payloadKg']} kg payload")
    if TOLERANCE_ORDER.index(f.tolerance) > TOLERANCE_ORDER.index(robot["precision"]):
        why.append(f"{f.tolerance} tolerance beyond {robot['precision']} precision")
    if f.tool not in robot["tools"]:
        why.append(f"no {f.tool} tool")
    if f.has_parts and rank(f.presentation) < rank(robot["minPresentation"]):
        why.append(f"needs parts {robot['minPresentation']} or better, has {f.presentation}")
    return why


def estimate(op: dict, line: dict, levers: Iterable[str] = (), robot: str | None = None) -> Estimate:
    """Robot success range and time for one operation with a set of lever types,
    for a robot type from robots.json (or a generic robot when robot is None)."""
    f = apply_levers(features_for(op, line), levers)
    variants = [v["id"] for v in line["variants"] if op["id"] in v["operations"]]
    r = ROBOTS[robot] if robot else None

    if r and not f.eliminated and (why := _robot_limits(f, r)):
        return Estimate(
            operation=op["id"], levers=f.levers, mean=0.0, p05=0.0, p95=0.0, alpha=None, beta=None,
            time_factor={"low": 0.0, "mean": 0.0, "high": 0.0}, robot_time={}, features=f,
            reasons=[f"{r['name']} can't: {w}" for w in why], robot=robot, feasible=False,
        )

    if f.eliminated:
        return Estimate(
            operation=op["id"], levers=f.levers, mean=1.0, p05=1.0, p95=1.0, alpha=None, beta=None,
            time_factor={"low": 0.0, "mean": 0.0, "high": 0.0},
            robot_time={v: 0.0 for v in variants}, features=f, reasons=["eliminated by lever"], robot=robot,
        )

    pres = f.presentation
    if r and r["presentationLift"]:
        pres = PRESENTATION_ORDER[min(rank(pres) + r["presentationLift"], len(PRESENTATION_ORDER) - 1)]
    mean, n = PRIORS["success"][f.verb][pres]
    reasons = [f"prior {f.verb} from {pres}: {mean:.3f}"]
    fail = 1.0 - mean
    mults = _multipliers(f)
    if r:
        # Payload is judged against this robot instead of a generic one.
        mults = [m for m in mults if not m[0].endswith("kg payload")]
        mults.append((f"{r['name']} {f.verb} skill", r["failMult"].get(f.verb, 1.0)))
        if f.mass_kg > 0.8 * r["payloadKg"]:
            mults.append((f"{f.mass_kg:g} kg near {r['payloadKg']} kg payload", 1.5))
    for label, mult in mults:
        if mult != 1.0:
            fail *= mult
            n *= ADJ["concentrationPenalty"]
            reasons.append(f"{label}: failure x{mult:g}")
    if r:
        n *= r["concentration"]
    fail = min(fail, ADJ["maxFailure"])
    mean = 1.0 - fail
    a, b = mean * n, fail * n
    if f.waste:
        reasons.append(f"{f.verb} is waste: eliminate rather than automate")

    tf = PRIORS["timeFactor"]
    factor = tf["byVerb"][f.verb] * (r["timeScale"] if r else 1.0)
    lo, hi = tf["spread"]
    time_factor = {"low": factor * lo, "mean": factor, "high": factor * hi}
    robot_time = {v: op["time"][v]["mean"]["value"] * factor for v in variants if v in op["time"]}

    return Estimate(
        operation=op["id"], levers=f.levers, mean=mean,
        p05=float(beta_dist.ppf(0.05, a, b)), p95=float(beta_dist.ppf(0.95, a, b)),
        alpha=a, beta=b, time_factor=time_factor, robot_time=robot_time, features=f, reasons=reasons,
        robot=robot,
    )


def clears(est: Estimate, floor: float, quantile: float = 0.05) -> bool:
    """Robot candidate test: the pessimistic end of the range clears the floor."""
    if est.eliminated:
        return True
    if not est.feasible:
        return False
    a, b = est.alpha, est.beta
    return float(beta_dist.ppf(quantile, a, b)) >= floor


def applicable_levers(op: dict, line: dict) -> list[str]:
    """Lever types that change this operation's capability (regroup/decouple never do)."""
    return changing_levers(features_for(op, line))


def lever_feature_changes(op: dict, line: dict, lever: str) -> dict[str, str]:
    """What one lever type changes on this operation, for Lever.featureChanges."""
    f = features_for(op, line)
    return feature_changes(f, apply_levers(f, [lever]))
