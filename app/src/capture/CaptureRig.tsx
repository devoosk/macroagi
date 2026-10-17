/**
 * Capture mode camera rig. Renders NO overlays (CLAUDE.md rule 2): it only owns the
 * default camera, the lens/sensor look, and the window.__capture driver API used by
 * scripts/export-frames.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as PerspectiveCameraImpl } from 'three'
import type { Line } from '../contracts/types'
import { getAnchor } from '../lib/anchors'
import { captureCam, isCapture } from '../lib/mode'
import { usePlayback } from '../playback/store'
import { CAMERA_IDS, cameraPoseAt, findCamera, vfovFromHfov } from './cameras'
import { CaptureLook } from './CaptureLook'

export interface CaptureApi {
  ready: boolean
  /** All capture camera ids for the loaded line. */
  cameras: string[]
  /** Active camera id on this page. */
  camera: string
  /** Event log duration, sim seconds (0 if no log loaded). */
  duration: number
  /** Set simTime to t, render, and resolve once the frame (with updated anchors) is on the canvas. */
  renderAt(t: number): Promise<void>
}

declare global {
  interface Window {
    __capture?: CaptureApi
  }
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export const CAPTURE_WIDTH = 960
export const CAPTURE_HEIGHT = 540

export interface CaptureRigProps {
  line: Line
  /** Camera id; defaults to the URL `cam` param, then the first camera. */
  cam?: string
  /** Defaults to isCapture (URL mode=capture). */
  enabled?: boolean
  /** Apply the CCTV / body-cam postprocessing look (default true). */
  look?: boolean
}

export function CaptureRig({ line, cam, enabled = isCapture, look = true }: CaptureRigProps) {
  const ids = useMemo(() => CAMERA_IDS(line), [line])
  const camId = cam ?? captureCam ?? ids[0]
  const def = useMemo(() => findCamera(line, camId) ?? findCamera(line, ids[0])!, [line, camId, ids])
  if (!enabled) return null
  return <RigInner line={line} def={def} ids={ids} look={look} />
}

function RigInner({ line, def, ids, look }: { line: Line; def: NonNullable<ReturnType<typeof findCamera>>; ids: string[]; look: boolean }) {
  const camRef = useRef<PerspectiveCameraImpl>(null)
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  const aspect = size.width / Math.max(1, size.height)
  const fov = vfovFromHfov(def.hfov, aspect)

  const frames = useRef(0)
  const committed = useRef<number>(Number.NaN)
  const simTime = usePlayback((s) => s.simTime)
  useLayoutEffect(() => {
    committed.current = simTime
    invalidate()
  }, [simTime, invalidate])

  // Pose update, every rendered frame, from simTime only (no clock / delta).
  // Registered after the scene's own useFrame callbacks when CaptureRig is mounted after the
  // scene; renderAt also waits 2 frames so anchors driven a frame late still settle.
  useFrame(() => {
    const c = camRef.current
    if (!c) return
    const t = usePlayback.getState().simTime
    const anchor = def.anchor ? getAnchor(def.anchor) : undefined
    const hands = def.hands?.map((k) => getAnchor(k)) ?? []
    const pose = cameraPoseAt(line, def, t, anchor, hands)
    c.position.copy(pose.position)
    c.quaternion.copy(pose.quaternion)
    const f = vfovFromHfov(pose.hfov, c.aspect)
    if (c.fov !== f) {
      c.fov = f
      c.updateProjectionMatrix()
    }
    c.updateMatrixWorld()
    frames.current++
  })

  useEffect(() => {
    const waitFrames = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const f = frames.current
        invalidate()
        let guard = 0
        while (frames.current === f) {
          await raf()
          if (++guard % 30 === 0) invalidate()
        }
      }
    }
    const api: CaptureApi = {
      ready: false,
      cameras: ids,
      camera: def.id,
      duration: usePlayback.getState().logs.current?.duration ?? 0,
      async renderAt(t: number) {
        const st = usePlayback.getState()
        if (st.playing) st.setPlaying(false)
        st.setTime(t)
        const target = usePlayback.getState().simTime
        // Wait for React to commit the new simTime into the scene graph.
        for (let i = 0; i < 200 && committed.current !== target; i++) await tick()
        await waitFrames(2)
        await raf()
      },
    }
    window.__capture = api
    let alive = true
    ;(async () => {
      await waitFrames(2)
      if (alive) api.ready = true
    })()
    return () => {
      alive = false
      if (window.__capture === api) delete window.__capture
    }
  }, [def, ids, invalidate])

  return (
    <>
      <PerspectiveCamera makeDefault ref={camRef} fov={fov} near={0.05} far={250} />
      {look && <CaptureLook type={def.type} />}
    </>
  )
}

function urlInt(name: string): number | undefined {
  if (typeof window === 'undefined') return undefined
  const v = Number(new URLSearchParams(window.location.search).get(name))
  return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
}

export interface CaptureRootProps {
  line: Line
  cam?: string
  /** Pixel size of the capture frame; defaults to URL w/h params, then 960x540. */
  width?: number
  height?: number
  shadows?: boolean
  look?: boolean
  /** The scene. Mount everything that registers anchors here; the rig is mounted after it. */
  children?: ReactNode
}

/**
 * Canvas for capture mode: fixed pixel size, dpr 1, demand frameloop, and a
 * preserved drawing buffer so the exporter can read pixels with toDataURL.
 */
export function CaptureRoot({ line, cam, width, height, shadows = true, look = true, children }: CaptureRootProps) {
  const w = width ?? urlInt('w') ?? CAPTURE_WIDTH
  const h = height ?? urlInt('h') ?? CAPTURE_HEIGHT
  return (
    <div style={{ width: w, height: h, position: 'absolute', left: 0, top: 0, overflow: 'hidden' }}>
      <Canvas
        style={{ width: w, height: h }}
        dpr={1}
        frameloop="demand"
        shadows={shadows}
        gl={{ preserveDrawingBuffer: true, antialias: false, powerPreference: 'high-performance' }}
      >
        {children}
        <CaptureRig line={line} cam={cam} enabled look={look} />
      </Canvas>
    </div>
  )
}
