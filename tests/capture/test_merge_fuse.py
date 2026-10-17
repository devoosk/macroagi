import pytest

from capture.frames import discover, list_frames, make_windows
from capture.fuse import fuse_station
from capture.merge import merge_camera
from capture.segments import IDLE_LABEL, Segment, segments_to_slotmap, slotmap_to_segments

from .conftest import write_camera


def seg(a, b, verb="screw", parts=("P_screw",), conf=0.9):
    return {"start_t": a, "end_t": b, "verb": verb, "parts": list(parts), "confidence": conf}


def windows(tmp_path, n=14, size=8, overlap=2, kind="cctv", cam="c"):
    write_camera(tmp_path, cam, kind, "S01", range(n))
    c = [x for x in discover(tmp_path) if x.id == cam][0]
    return c, make_windows(list_frames(c), size, overlap)


def test_single_window_round_trip(tmp_path):
    cam, ws = windows(tmp_path, n=8)
    slots = merge_camera([(ws[0], [seg(2, 4)])])
    segs = slotmap_to_segments(slots, cam.id, "S01", cam.step)
    assert [(s.start, s.end, s.verb) for s in segs] == [(2, 5, "screw")]


def test_overlap_prefers_confidence(tmp_path):
    cam, ws = windows(tmp_path)  # windows 0..7 and 6..13
    assert [w.t0 for w in ws] == [0, 6]
    slots = merge_camera([(ws[0], [seg(5, 7, conf=0.4)]), (ws[1], [seg(6, 9, verb="place", parts=("P_base",), conf=0.95)])])
    assert slots[5][0] == ("screw", ("P_screw",))
    assert slots[6][0] == ("place", ("P_base",))
    assert slots[7][0] == ("place", ("P_base",))


def test_overlap_tie_prefers_central_window(tmp_path):
    cam, ws = windows(tmp_path)
    # Slot 7 is at the edge of window 0 and near the start of window 1; equal confidence.
    slots = merge_camera([(ws[0], [seg(7, 7, verb="pick", conf=0.5)]), (ws[1], [])], idle_conf=0.5)
    assert slots[7][0] == IDLE_LABEL


def test_gap_fill_and_min_dur():
    slots = {float(t): (("screw", ()), 1.0) for t in [0, 1, 2, 4, 5]}
    slots[3.0] = (IDLE_LABEL, 1.0)
    slots[9.0] = (("pick", ()), 1.0)
    slots.update({float(t): (IDLE_LABEL, 1.0) for t in [6, 7, 8]})
    assert [(s.start, s.end) for s in slotmap_to_segments(slots, "c", "S01", 1.0)] == [(0, 3), (4, 6), (9, 10)]
    filled = slotmap_to_segments(slots, "c", "S01", 1.0, gap_tol=1.0, min_dur=2.0)
    assert [(s.start, s.end, s.verb) for s in filled] == [(0, 6, "screw")]


def test_slotmap_inverse():
    segs = [Segment("c", "S01", 2, 5, "screw", ("P_screw",), 0.8)]
    m = segments_to_slotmap(segs, [float(t) for t in range(8)])
    [out] = slotmap_to_segments(m, "c", "S01", 1.0)
    assert (out.start, out.end, out.label) == (2, 5, segs[0].label)
    assert out.confidence == pytest.approx(0.8)


def test_fuse_weights(tmp_path):
    write_camera(tmp_path, "cctv_S01", "cctv", "S01", range(3))
    write_camera(tmp_path, "fp_S01", "fpv", "S01", range(3))
    cctv, fpv = discover(tmp_path)
    screw, place = ("screw", ("P_screw",)), ("place", ("P_base",))
    fused = fuse_station(
        [
            (cctv, {0.0: (place, 0.8), 1.0: (IDLE_LABEL, 0.8), 2.0: (screw, 0.8)}),
            (fpv, {0.0: (screw, 0.8), 1.0: (screw, 0.8), 2.0: (screw, 0.8)}),
        ]
    )
    assert fused[0.0][0] == screw  # FPV wins on what
    assert fused[1.0][0] == IDLE_LABEL  # CCTV wins on whether
    assert fused[2.0] == (screw, 1.0)  # agreement
