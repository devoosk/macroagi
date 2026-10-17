import { useEffect, type CSSProperties } from 'react'
import { isCapture } from '../lib/mode'
import { useDirector } from './director'
import './ui.css'

/** Small camera mode switcher: Overview / Follow unit (+ Esc = overview, F = follow). */
export function CameraBar({ style, keyboard = true }: { style?: CSSProperties; keyboard?: boolean }) {
  const mode = useDirector((s) => s.mode)
  const unit = useDirector((s) => s.unit)
  const station = useDirector((s) => s.station)
  useEffect(() => {
    if (!keyboard || isCapture) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') useDirector.getState().overview()
      else if (e.key === 'f' || e.key === 'F') useDirector.getState().follow()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard])
  if (isCapture) return null
  const d = useDirector.getState()
  return (
    <div className="mx-root mx-panel mx-cambar" style={{ top: 16, ...style }}>
      <span className="mx-eyebrow" style={{ padding: '0 6px' }}>Camera</span>
      <button className="mx-btn" data-active={mode === 'overview'} onClick={d.overview} title="Overview (Esc)">
        Overview
      </button>
      <button className="mx-btn" data-active={mode === 'station'} disabled={!station} title="Click a station chip to fly there">
        {mode === 'station' && station ? station : 'Station'}
      </button>
      <button className="mx-btn" data-active={mode === 'follow'} onClick={() => d.follow()} title="Follow the newest unit (F)">
        {mode === 'follow' && unit ? `Follow ${unit}` : 'Follow unit'}
      </button>
    </div>
  )
}
