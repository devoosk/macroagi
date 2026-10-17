import { create } from 'zustand'

/**
 * Camera director state (demo UI only, never scene state). StationStatusBar chips,
 * 3D tags and CameraBar write here; every <CameraDirector /> reads it.
 */
export type DirectorMode = 'overview' | 'station' | 'follow'

export interface DirectorStore {
  mode: DirectorMode
  station?: string
  /** Followed unit; undefined in follow mode = pick the newest unit on the line. */
  unit?: string
  /** Bumped on every request so repeated clicks re-trigger a fly. */
  seq: number
  flyTo: (station: string) => void
  follow: (unit?: string) => void
  overview: () => void
  /** Internal: director resolved/replaced the followed unit. */
  setFollowed: (unit: string | undefined) => void
}

export const useDirector = create<DirectorStore>((set) => ({
  mode: 'overview',
  seq: 0,
  flyTo: (station) => set((s) => ({ mode: 'station', station, unit: undefined, seq: s.seq + 1 })),
  follow: (unit) => set((s) => ({ mode: 'follow', unit, station: undefined, seq: s.seq + 1 })),
  overview: () => set((s) => ({ mode: 'overview', station: undefined, unit: undefined, seq: s.seq + 1 })),
  setFollowed: (unit) => set({ unit }),
}))
