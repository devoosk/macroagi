import json
from contextlib import contextmanager
from pathlib import Path

PRIORS: dict = json.loads((Path(__file__).with_name("priors.json")).read_text())
ROBOTS: dict[str, dict] = {r["id"]: r for r in json.loads(Path(__file__).with_name("robots.json").read_text())["robots"]}
PRESENTATION_ORDER: list[str] = PRIORS["presentationOrder"]
WASTE_VERBS = {"walk", "search"}


def rank(presentation: str) -> int:
    return PRESENTATION_ORDER.index(presentation)


@contextmanager
def robot_overrides(changes: dict[str, dict]):
    """What-if runs: temporarily change robot specs, e.g. {"humanoid": {"rentPerMonth": 3000}}."""
    saved = {rid: dict(ROBOTS[rid]) for rid in changes}
    try:
        for rid, fields in changes.items():
            ROBOTS[rid].update(fields)
        yield
    finally:
        for rid, spec in saved.items():
            ROBOTS[rid].clear()
            ROBOTS[rid].update(spec)
