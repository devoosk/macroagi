import { create } from 'zustand'
import { DURATION } from './theme'

interface StoryClock {
  t: number
  playing: boolean
  setT: (t: number) => void
  setPlaying: (p: boolean) => void
  advance: (dt: number) => void
}

const params = new URLSearchParams(window.location.search)

/** The story's only clock. Every visual is a pure function of `t`, so scrubbing and frame export reproduce exactly. */
export const useClock = create<StoryClock>((set) => ({
  t: Number(params.get('t') ?? 0),
  playing: params.get('play') !== '0',
  setT: (t) => set({ t: Math.min(DURATION, Math.max(0, t)) }),
  setPlaying: (playing) => set({ playing }),
  advance: (dt) =>
    set((s) => {
      if (!s.playing) return s
      const t = Math.min(DURATION, s.t + dt)
      return { t, playing: t < DURATION }
    }),
}))

export const useT = () => useClock((s) => s.t)
export const getT = () => useClock.getState().t
