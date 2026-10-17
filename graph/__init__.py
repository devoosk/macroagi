"""Process-graph builder (plan step 5): line.json v2 from VLM segments alone.

build.py never reads line.json or event logs. score.py (scoring) and
synth.py/toy.py (test input) are the only modules that touch ground truth.
See docs/plans/05-process-graph-builder.md.
"""
