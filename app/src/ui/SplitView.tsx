import type { CSSProperties, ReactNode } from 'react'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import { isCapture } from '../lib/mode'
import { completedAt } from '../playback/index'
import { PlaybackClock } from '../playback/PlaybackClock'
import { usePlayback, type DesignKey } from '../playback/store'
import { useDesign } from './hooks'
import './ui.css'

export interface SplitSide {
  design: DesignKey
  title?: string
  subtitle?: string
}

export interface SplitViewProps {
  /** Scene content for one side (put <Factory>, lights, <StateOverlay3D>, <CameraDirector syncKey> here). */
  renderScene: (design: DesignKey) => ReactNode
  left?: SplitSide | DesignKey
  right?: SplitSide | DesignKey
  /** Extra props for both canvases (camera, shadows, dpr, gl...). */
  canvasProps?: Omit<CanvasProps, 'children'>
  /** Optional DOM overlay rendered inside each pane (above the canvas). */
  renderOverlay?: (design: DesignKey) => ReactNode
  /** Mount a <PlaybackClock/> in each canvas (only one ticks). Default true. */
  clock?: boolean
  /** Distance of the pane headers from the top (leave room for a status bar). */
  headerTop?: number
  style?: CSSProperties
}

const DEFAULT_TITLES: Record<DesignKey, [string, string]> = {
  current: ['Current line', 'As captured · human stations'],
  redesign: ['Redesign', 'Robot-ready · levers applied'],
}

const side = (s: SplitSide | DesignKey): SplitSide => (typeof s === 'string' ? { design: s } : s)

/** Two canvases side by side (current vs redesign), sharing the playback store's single clock. */
export function SplitView({ renderScene, left = 'current', right = 'redesign', canvasProps, renderOverlay, clock = true, headerTop = 16, style }: SplitViewProps) {
  const L = side(left)
  const R = side(right)
  return (
    <div className="mx-root mx-split" style={style}>
      <Pane s={L} renderScene={renderScene} canvasProps={canvasProps} renderOverlay={renderOverlay} clock={clock} headerTop={headerTop} />
      <div className="mx-split-divider" />
      <Pane s={R} compare={L.design} renderScene={renderScene} canvasProps={canvasProps} renderOverlay={renderOverlay} clock={clock} headerTop={headerTop} />
    </div>
  )
}

function Pane({
  s,
  compare,
  renderScene,
  canvasProps,
  renderOverlay,
  clock,
  headerTop,
}: {
  s: SplitSide
  compare?: DesignKey
  renderScene: SplitViewProps['renderScene']
  canvasProps?: SplitViewProps['canvasProps']
  renderOverlay?: SplitViewProps['renderOverlay']
  clock: boolean
  headerTop: number
}) {
  const [title, subtitle] = DEFAULT_TITLES[s.design]
  return (
    <div className="mx-split-pane">
      <Canvas shadows camera={{ position: [4, 8, 14], fov: 45 }} {...canvasProps}>
        {clock && <PlaybackClock />}
        {renderScene(s.design)}
      </Canvas>
      {!isCapture && <PaneHeader design={s.design} compare={compare} title={s.title ?? title} subtitle={s.subtitle ?? subtitle} top={headerTop} />}
      {renderOverlay?.(s.design)}
    </div>
  )
}

/** Title + live throughput counter (units completed so far in that design's log). */
export function PaneHeader({ design, compare, title, subtitle, top = 16 }: { design: DesignKey; compare?: DesignKey; title: string; subtitle?: string; top?: number }) {
  const t = usePlayback((st) => st.simTime)
  const d = useDesign(design)
  const c = useDesign(compare ?? design)
  const n = d ? completedAt(d.index, t) : 0
  const base = compare && c ? completedAt(c.index, t) : undefined
  const delta = base !== undefined && base > 0 && compare !== design ? (n - base) / base : undefined
  const rate = t > 60 ? (n / t) * 3600 : 0
  return (
    <div className="mx-root mx-panel mx-split-head" style={{ top }}>
      <div>
        <div className="mx-eyebrow" style={{ color: design === 'redesign' ? 'var(--mx-accent)' : undefined }}>
          {design === 'redesign' ? 'Proposed' : 'Baseline'}
        </div>
        <div className="mx-split-title" style={{ marginTop: 6 }}>{title}</div>
        {subtitle && <div className="mx-split-sub">{subtitle}</div>}
      </div>
      <div className="mx-split-count">
        <div className="mx-split-count-n">
          {n}
          {delta !== undefined && Math.abs(delta) >= 0.005 && (
            <span className="mx-delta" data-sign={delta >= 0 ? '+' : '-'}>
              {delta >= 0 ? '+' : '−'}
              {Math.abs(delta * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="mx-split-count-l">
          units done · <span className="mx-mono">{rate.toFixed(1)}</span>/h
        </div>
      </div>
    </div>
  )
}
