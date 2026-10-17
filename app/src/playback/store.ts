import { create } from 'zustand'
import type { EventLog, Line } from '../contracts/types'
import { getIndex } from './index'

// Types live in ./types; re-exported here because other modules import them from the store.
export type { SceneState, StationState, UnitMotion, UnitPosition, WorkerActivity, WorkerVerb } from './types'
/** Indexed implementation (binary search, memoised by log identity). Same signature as the original stub. */
export { selectStateAt } from './index'

export type DesignKey = 'current' | 'redesign'

export interface PlaybackStore {
  simTime: number
  speed: number
  playing: boolean
  lines: Partial<Record<DesignKey, Line>>
  logs: Partial<Record<DesignKey, EventLog>>
  setTime: (t: number) => void
  setSpeed: (s: number) => void
  setPlaying: (p: boolean) => void
  load: (design: DesignKey, line: Line, log: EventLog) => void
  // --- additive extensions ---
  /** Longest loaded log duration (seconds). The clock wraps or stops here. */
  duration: number
  /** Loop back to 0 at the end (true) or stop (false). */
  loop: boolean
  setLoop: (loop: boolean) => void
  togglePlaying: () => void
  /** Advance by dt seconds of sim time, honouring loop/stop at `duration`. */
  advance: (dt: number) => void
}

export const usePlayback = create<PlaybackStore>((set, get) => ({
  simTime: 0,
  speed: 10,
  playing: false,
  lines: {},
  logs: {},
  duration: 0,
  loop: true,
  setTime: (t) => set({ simTime: Math.max(0, t) }),
  setSpeed: (speed) => set({ speed }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  togglePlaying: () => {
    const s = get()
    // Pressing play at the end restarts.
    if (!s.playing && s.duration > 0 && s.simTime >= s.duration) set({ simTime: 0, playing: true })
    else set({ playing: !s.playing })
  },
  advance: (dt) => {
    const s = get()
    const d = s.duration
    let t = s.simTime + dt
    if (d > 0 && t >= d) {
      if (s.loop) t = t % d
      else return set({ simTime: d, playing: false })
    }
    set({ simTime: Math.max(0, t) })
  },
  load: (design, line, log) =>
    set((s) => {
      const logs = { ...s.logs, [design]: log }
      const lines = { ...s.lines, [design]: line }
      let duration = 0
      for (const k of Object.keys(logs) as DesignKey[]) {
        const l = logs[k]
        const ln = lines[k]
        if (l && ln) duration = Math.max(duration, getIndex(ln, l).duration)
      }
      return { lines, logs, duration }
    }),
}))

/** Memoised index for a loaded design (undefined until loaded). */
export function indexFor(design: DesignKey) {
  const s = usePlayback.getState()
  const line = s.lines[design]
  const log = s.logs[design]
  return line && log ? getIndex(line, log) : undefined
}
