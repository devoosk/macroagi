import pytest

from capture.frames import discover, encode_frame, list_frames, make_windows

from .conftest import write_camera


def test_discover_and_list(tmp_path):
    write_camera(tmp_path, "cctv_S01", "cctv", "S01", range(10))
    write_camera(tmp_path, "fpv_S01", "fpv", "S01", range(10))
    cams = discover(tmp_path)
    assert [c.id for c in cams] == ["cctv_S01", "fpv_S01"]
    assert [c.id for c in discover(tmp_path, ["fpv_S01"])] == ["fpv_S01"]
    frames = list_frames(cams[0], t_from=2, t_to=5)
    assert [f.t for f in frames] == [2, 3, 4]


def test_discover_missing_camera(tmp_path):
    write_camera(tmp_path, "cctv_S01", "cctv", "S01", range(3))
    with pytest.raises(FileNotFoundError):
        discover(tmp_path, ["cctv_S99"])


def test_frame_time_uses_fps(tmp_path):
    write_camera(tmp_path, "cctv_S01", "cctv", "S01", [0, 1, 2], fps=2)
    cam = discover(tmp_path)[0]
    frames = list_frames(cam)
    assert [f.path.stem for f in frames] == ["000000", "000002", "000004"]
    assert [f.t for f in frames] == [0, 1, 2]


@pytest.mark.parametrize("n,size,overlap", [(20, 8, 2), (8, 8, 2), (5, 8, 2), (100, 8, 0), (31, 6, 3)])
def test_windows_cover_every_frame(tmp_path, n, size, overlap):
    write_camera(tmp_path, "c", "cctv", "S01", range(n))
    frames = list_frames(discover(tmp_path)[0])
    ws = make_windows(frames, size, overlap)
    covered = {f.t for w in ws for f in w.frames}
    assert covered == {f.t for f in frames}
    assert all(len(w.frames) == min(size, n) for w in ws)
    assert [w.index for w in ws] == list(range(len(ws)))
    for a, b in zip(ws, ws[1:]):
        assert len({f.t for f in a.frames} & {f.t for f in b.frames}) >= overlap


def test_windows_reject_bad_overlap():
    with pytest.raises(ValueError):
        make_windows([], 4, 4)


def test_encode_is_deterministic_and_downscales(tmp_path):
    from PIL import Image

    p = tmp_path / "big.png"
    Image.new("RGB", (2000, 1000), (10, 20, 30)).save(p)
    a, b = encode_frame(p, 500), encode_frame(p, 500)
    assert a == b
    import io

    assert Image.open(io.BytesIO(a)).size == (500, 250)
