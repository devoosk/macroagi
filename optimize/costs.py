"""Objective weights in euros over a 3-year horizon. All engineer estimates."""

HORIZON_YEARS = 3
# One operator per shift, two shifts, ~45 kEUR/year loaded cost.
HUMAN_STATION_COST = {"value": 45_000 * 2 * HORIZON_YEARS, "source": "estimate"}
# Robot cell capex, the same figure tools/gen uses for results.json.
ROBOT_CELL_COST = {"value": 85_000, "source": "estimate"}
# Mixed-model line: one variant may exceed takt by this factor; buffers absorb it.
PEAK_TOLERANCE = {"value": 1.10, "source": "estimate"}
# Robot candidates: this quantile of the success range must clear FLOOR. The median,
# not p05: v0 priors are wide, and at p05 almost nothing on the R290 line qualifies.
# The uncertainty is carried into the reliability sweep instead.
FLOOR = {"value": 0.90, "source": "estimate"}
CANDIDATE_QUANTILE = {"value": 0.5, "source": "estimate"}
