from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from simulate.line import from_dict, load

ROOT = Path(__file__).resolve().parents[2]

DATA = ROOT / 'app' / 'public' / 'data'


@pytest.fixture(scope='session')
def line_dict() -> dict:
    return json.loads((DATA / 'line.json').read_text())


@pytest.fixture(scope='session')
def line(line_dict):
    return from_dict(line_dict)


@pytest.fixture(scope='session')
def redesign_dict() -> dict:
    """line_redesign_1 with a human fallback station for each robot cell (contract fields `fallback`, `offline`)."""
    d = copy.deepcopy(json.loads((DATA / 'line_redesign_1.json').read_text()))
    extra = []
    for st in d['stations']:
        if st['staff'] != 'robot':
            continue
        fid = st['id'] + 'F'
        st['fallback'] = fid
        extra.append(
            {
                'id': fid,
                'name': st['name'] + ' fallback',
                'kind': st['kind'],
                'operations': [],
                'staff': 'human',
                'x': st['x'],
                'y': st['y'] - 3,
                'rot': st['rot'],
                'bufferBefore': 0,
                'bufferAfter': 0,
                'bays': 1,
                'offline': True,
            }
        )
    d['stations'] += extra
    return d


@pytest.fixture(scope='session')
def redesign(redesign_dict):
    return from_dict(redesign_dict)


@pytest.fixture(scope='session')
def base_ops(line):
    return load(DATA / 'line.json').operations
