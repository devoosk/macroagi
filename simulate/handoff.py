"""A FIFO buffer for SimPy that also works at capacity 0 (a coupled line).

simpy.Store rejects capacity 0. Here a put succeeds at once when there is room or a getter is
already waiting (direct hand-over); otherwise the putter waits, which is the `blocked` state.
A get takes, in order: a priority item (rework), a buffered item, or a waiting putter's item.
All events succeed synchronously when they can, so `event.triggered` right after the call says
whether the caller has to wait.
"""

from __future__ import annotations

from collections import deque
from typing import Any

import simpy


class Handoff:
    def __init__(self, env: simpy.Environment, capacity: float):
        self.env = env
        self.capacity = capacity
        self.items: deque[Any] = deque()
        self.priority: deque[Any] = deque()
        self.getters: deque[simpy.Event] = deque()
        self.putters: deque[tuple[simpy.Event, Any]] = deque()

    def __len__(self) -> int:
        return len(self.items) + len(self.priority)

    def put(self, item: Any) -> simpy.Event:
        ev = self.env.event()
        if self.getters:
            self.getters.popleft().succeed(item)
            ev.succeed()
        elif len(self.items) < self.capacity:
            self.items.append(item)
            ev.succeed()
        else:
            self.putters.append((ev, item))
        return ev

    def put_priority(self, item: Any) -> None:
        """Unbounded queue that getters serve first (rework units)."""
        if self.getters:
            self.getters.popleft().succeed(item)
        else:
            self.priority.append(item)

    def get(self) -> simpy.Event:
        ev = self.env.event()
        if self.priority:
            ev.succeed(self.priority.popleft())
        elif self.items:
            ev.succeed(self.items.popleft())
            self._admit()
        elif self.putters:
            pev, item = self.putters.popleft()
            pev.succeed()
            ev.succeed(item)
        else:
            self.getters.append(ev)
        return ev

    def _admit(self) -> None:
        while self.putters and len(self.items) < self.capacity:
            pev, item = self.putters.popleft()
            self.items.append(item)
            pev.succeed()
