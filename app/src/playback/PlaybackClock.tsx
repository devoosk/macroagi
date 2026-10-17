import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { isCapture } from '../lib/mode'
import { usePlayback } from './store'

/**
 * The only thing that advances simTime in demo mode. Real-time dt is used here
 * (and only here) to move the store clock; render paths read simTime.
 *
 * Safe to mount in several canvases (split view): only the first mounted
 * instance ticks. Disabled in capture mode, where simTime is set explicitly.
 */
let owner: symbol | null = null

/** Largest real-time step accepted (s); avoids jumps after a hidden tab resumes. */
const MAX_DT = 0.1

export function PlaybackClock({ enabled = true }: { enabled?: boolean }) {
  const id = useRef(Symbol('clock'))
  useEffect(() => {
    if (!enabled || isCapture) return
    const me = id.current
    if (owner === null) owner = me
    return () => {
      if (owner === me) owner = null
    }
  }, [enabled])
  useFrame((_, dt) => {
    if (!enabled || isCapture) return
    if (owner === null) owner = id.current // take over if the previous owner unmounted
    if (owner !== id.current) return
    const s = usePlayback.getState()
    if (s.playing) s.advance(Math.min(dt, MAX_DT) * s.speed)
  })
  return null
}

/** DOM equivalent (no Canvas required), e.g. for pages without a 3D view. Same ownership rule. */
export function useDomPlaybackClock(enabled = true) {
  useEffect(() => {
    if (!enabled || isCapture) return
    const me = Symbol('dom-clock')
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (owner === null) owner = me
      if (owner === me) {
        const s = usePlayback.getState()
        if (s.playing) s.advance(Math.min(dt, MAX_DT) * s.speed)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (owner === me) owner = null
    }
  }, [enabled])
}
