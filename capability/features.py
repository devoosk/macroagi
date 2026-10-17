from dataclasses import dataclass, field

from .priors import PRIORS, WASTE_VERBS, rank

RIGIDITY_ORDER = ["rigid", "semi", "flexible"]
TOLERANCE_ORDER = ["loose", "medium", "tight"]


@dataclass(frozen=True)
class Features:
    verb: str
    presentation: str
    rigidity: str
    tolerance: str
    mass_kg: float
    tool: str
    variants: int
    has_parts: bool = True
    eliminated: bool = False
    levers: tuple[str, ...] = field(default=())

    @property
    def waste(self) -> bool:
        """Walk and search are human-constraint waste: eliminate, don't automate."""
        return self.verb in WASTE_VERBS

    @property
    def orientation_known(self) -> bool:
        return self.presentation in ("kitted", "fixtured")


def features_for(op: dict, line: dict) -> Features:
    """Features from existing line.json fields; the worst part decides each one."""
    parts = {p["id"]: p for p in line["parts"]}
    used = [parts[pid] for pid in op["parts"] if pid in parts]
    if used:
        presentation = min((p["presentation"] for p in used), key=rank)
        rigidity = max((p["rigidity"] for p in used), key=RIGIDITY_ORDER.index)
        tolerance = max((p["tolerance"] for p in used), key=TOLERANCE_ORDER.index)
        mass = max(p["mass"]["value"] for p in used)
    else:
        # No parts (e.g. a test on the unit itself): the unit sits roughly located on the conveyor.
        presentation, rigidity, tolerance, mass = PRIORS["defaultPresentation"], "rigid", "medium", 0.0
    variants = sum(1 for v in line["variants"] if op["id"] in v["operations"])
    return Features(
        verb=op["verb"],
        presentation=presentation,
        rigidity=rigidity,
        tolerance=tolerance,
        mass_kg=mass,
        tool=op["tool"],
        variants=max(variants, 1),
        has_parts=bool(used),
    )
