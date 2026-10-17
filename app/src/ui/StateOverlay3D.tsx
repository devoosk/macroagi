import { useMemo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import type { Line } from '../contracts/types'
import { isCapture } from '../lib/mode'
import { stationAnchor } from '../playback/layout'
import type { SceneState, StationState } from '../playback/types'
import { useDirector } from './director'
import { LEVER_LABELS, STATE_COLORS, STATE_LABELS, stationLevers } from './theme'
import './ui.css'

export interface StateOverlay3DProps {
  line: Line
  state: SceneState
  /** Floating chip per station (id + state). Default true. */
  chips?: boolean
  /** Lever badges for stations touched by `line.appliedLevers`. Default true. */
  levers?: boolean
  /** Halo footprint (m), roughly the station box footprint. */
  size?: [number, number]
  /** Height of the floating chip (m). */
  chipHeight?: number
  onSelect?: (station: string) => void
}

const OPACITY: Record<StationState, number> = { working: 0.5, blocked: 0.75, starved: 0.4, failed: 0.95, idle: 0.18 }

let haloTex: THREE.Texture | undefined
function getHaloTexture() {
  if (haloTex) return haloTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.0)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)')
  grad.addColorStop(0.72, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.8, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  haloTex = new THREE.CanvasTexture(c)
  haloTex.colorSpace = THREE.SRGBColorSpace
  return haloTex
}

/**
 * Demo-only state overlay: coloured floor halo + ring per station (and per bay),
 * optional floating chip and lever badge. Renders nothing in capture mode (CLAUDE.md rule 2).
 * Pure function of (line, state); no clocks.
 */
export function StateOverlay3D(props: StateOverlay3DProps) {
  if (isCapture) return null
  return <StateOverlayInner {...props} />
}

function StateOverlayInner({ line, state, chips = true, levers = true, size = [3.4, 2.6], chipHeight = 2.4, onSelect }: StateOverlay3DProps) {
  const tex = useMemo(getHaloTexture, [])
  const selected = useDirector((s) => (s.mode === 'station' ? s.station : undefined))
  const select = (id: string) => {
    useDirector.getState().flyTo(id)
    onSelect?.(id)
  }
  return (
    <group name="state-overlay">
      {line.stations.map((s) => {
        const st = state.stations[s.id] ?? 'idle'
        const nBays = s.bays ?? 1
        const pads = nBays > 1 ? Array.from({ length: nBays }, (_, b) => ({ b, st: state.bays[`${s.id}#${b}`] ?? st })) : [{ b: undefined as number | undefined, st }]
        const lv = levers ? stationLevers(line, s.id) : []
        const isSel = selected === s.id
        return (
          <group key={s.id}>
            {pads.map(({ b, st: ps }) => {
              const [x, , z] = stationAnchor(line, s.id, b)
              const color = STATE_COLORS[ps]
              return (
                <group key={b ?? 'one'} position={[x, 0.015, z]} rotation-y={s.rot}>
                  <mesh rotation-x={-Math.PI / 2} renderOrder={1}>
                    <planeGeometry args={[size[0] * 1.25, size[1] * 1.25]} />
                    <meshBasicMaterial map={tex} color={color} transparent opacity={OPACITY[ps]} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                  </mesh>
                  <RectRing w={size[0]} h={size[1]} color={color} opacity={ps === 'idle' ? 0.35 : 0.95} width={ps === 'failed' || isSel ? 0.09 : 0.05} />
                  {ps === 'failed' && <RectRing w={size[0] + 0.5} h={size[1] + 0.5} color={color} opacity={0.45} width={0.04} />}
                </group>
              )
            })}
            {chips && (
              <Html position={[s.x, chipHeight, s.y]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
                <div className="mx-tag3d" onClick={() => select(s.id)} style={{ pointerEvents: 'auto' }}>
                  <div className="mx-tag3d-main" style={isSel ? { borderColor: 'var(--mx-accent)' } : undefined}>
                    <span className="mx-dot" style={{ background: STATE_COLORS[st], boxShadow: `0 0 8px ${STATE_COLORS[st]}` }} />
                    <b>{s.id}</b>
                    {(isSel || st === 'failed') && <span>{isSel ? `${s.name} · ${STATE_LABELS[st]}` : STATE_LABELS[st]}</span>}
                  </div>
                  {lv.length > 0 && <div className="mx-tag3d-lever">{lv.map((l) => LEVER_LABELS[l.type]).join(' · ')}</div>}
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Flat rectangular outline on the floor (four thin planes). */
function RectRing({ w, h, color, opacity, width }: { w: number; h: number; color: string; opacity: number; width: number }) {
  const mat = <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
  return (
    <group position-y={0.004} renderOrder={2}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, h / 2]}>
        <planeGeometry args={[w + width, width]} />
        {mat}
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -h / 2]}>
        <planeGeometry args={[w + width, width]} />
        {mat}
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[w / 2, 0, 0]}>
        <planeGeometry args={[width, h - width]} />
        {mat}
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-w / 2, 0, 0]}>
        <planeGeometry args={[width, h - width]} />
        {mat}
      </mesh>
    </group>
  )
}
