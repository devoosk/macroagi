"""Objective weights in euros over a 3-year horizon. All engineer estimates."""

HORIZON_YEARS = 3
# One operator per shift, two shifts, ~45 kEUR/year loaded cost.
HUMAN_STATION_COST = {"value": 45_000 * 2 * HORIZON_YEARS, "source": "estimate"}
# Robot cell capex plus 3 years of maintenance.
ROBOT_CELL_COST = {"value": 150_000, "source": "estimate"}
# Robot candidates: the 5th percentile of the success range must clear this.
FLOOR = {"value": 0.90, "source": "estimate"}
