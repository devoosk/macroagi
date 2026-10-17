import json
from pathlib import Path

PRIORS: dict = json.loads((Path(__file__).with_name("priors.json")).read_text())
ROBOTS: dict[str, dict] = {r["id"]: r for r in json.loads(Path(__file__).with_name("robots.json").read_text())["robots"]}
PRESENTATION_ORDER: list[str] = PRIORS["presentationOrder"]
WASTE_VERBS = {"walk", "search"}


def rank(presentation: str) -> int:
    return PRESENTATION_ORDER.index(presentation)
