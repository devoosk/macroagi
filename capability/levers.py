"""Lever rules: each lever type changes features. Lever instances (with ids and
affected operations) are created by the redesign generator, not here."""

from collections.abc import Iterable
from dataclasses import replace

from .features import Features
from .priors import PRIORS, rank

LEVER_TYPES = ("eliminate", "fixture", "kit", "goods_to_robot", "regroup", "decouple")
LEVER_COSTS: dict[str, dict] = {
    t: {"value": PRIORS["leverCosts"][t], "source": PRIORS["source"]} for t in LEVER_TYPES
}


def _at_least(f: Features, presentation: str) -> Features:
    if rank(f.presentation) >= rank(presentation):
        return f
    return replace(f, presentation=presentation)


def _apply_one(f: Features, lever: str) -> Features:
    if lever == "eliminate":
        return replace(f, eliminated=True) if f.waste else f
    if lever == "fixture":
        return _at_least(f, "fixtured")
    if lever in ("kit", "goods_to_robot") and not f.has_parts and not f.waste:
        return f  # nothing to present: the op works on the unit itself
    if lever == "kit":
        # A kit presents the part, so there is nothing left to search for.
        return replace(f, eliminated=True) if f.verb == "search" else _at_least(f, "kitted")
    if lever == "goods_to_robot":
        # Parts come to the cell, so nobody walks to fetch them.
        return replace(f, eliminated=True) if f.verb == "walk" else _at_least(f, "tray")
    if lever in ("regroup", "decouple"):
        return f  # station and buffer changes; no effect on per-operation capability
    raise ValueError(f"unknown lever type: {lever}")


def apply_levers(f: Features, levers: Iterable[str]) -> Features:
    levers = tuple(sorted(set(levers), key=LEVER_TYPES.index))
    for lever in levers:
        f = _apply_one(f, lever)
    return replace(f, levers=levers)


def feature_changes(before: Features, after: Features) -> dict[str, str]:
    """Changed features as strings, for Lever.featureChanges in line.json."""
    keys = ("presentation", "eliminated")
    return {k: str(getattr(after, k)).lower() for k in keys if getattr(before, k) != getattr(after, k)}


def changing_levers(f: Features) -> list[str]:
    """Lever types that change these capability features."""
    return [t for t in LEVER_TYPES if feature_changes(f, apply_levers(f, [t]))]
