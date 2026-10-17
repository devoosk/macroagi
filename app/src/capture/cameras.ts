/**
 * Capture camera definitions and their deterministic per-window variation.
 *
 * Everything here is a pure function of (line, camId, simTime[, anchor]) so the
 * same simTime always reproduces the same frame (CLAUDE.md rule 1). No three.js
 * scene access except reading an anchor's world matrix passed in by the caller.
 *
 * World conventions: metres, Y up, line along +X. Station {x, y, rot} sits at
 * world (x, 0, y) rotated by rot about Y. Operator stands at station-local
 * (0, 0, +0.95) facing -z; work surface top at y = 0.85, z ~ 0.
 */
import { Euler, MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { Line, Station } from '../contracts/types'
import { bayLocalZ } from '../lib/layout'
import { hashSigned, hashString, smoothstep, valueNoise, hashInt01 } from './noise'

export type CaptureCamType = 'cctv' | 'fp'

export interface CaptureCamDef {
  /** `cctv:S02`, `fp:S02`, `cctv:S05#1` */
  id: string
  type: CaptureCamType
  stationId: string
  /** Bay index for multi-bay stations (cctv only). */
  bay?: number
  /** Horizontal field of view, degrees (CCTV specs are horizontal). */
  hfov: number
  /** CCTV: station-local eye position. FP: offset from the head anchor (head-local). */
  localPosition: [number, number, number]
  /** CCTV: station-local look-at target. FP: unused. */
  localTarget?: [number, number, number]
  /** FP: extra pitch on top of the head anchor, radians (negative = look down). */
  pitch?: number
  /** Anchor key the FP camera rides on. */
  anchor?: string
}

/** Sim-seconds per variation window. Deliberately NOT tied to unit cycles: a camera
 * jump on every unit start would leak cycle boundaries to the VLM. */
export const VARIATION_WINDOW = 120
/** Seconds over which jitter blends between windows (a slow "remount" drift, not a pop). */
const BLEND = 6
/** Parallel bays stack along station-local -z; see lib/layout.ts. */
export { BAY_DZ as BAY_SPACING } from '../lib/layout'

const POS_JITTER = 0.1 // ±10 cm
const ANG_JITTER = MathUtils.degToRad(1.5) // ±1.5°
const LIGHT_JITTER = 0.1 // ±10 %
const BASE_KELVIN = 4300

export const CCTV_HFOV = 76
export const FP_HFOV = 90
export const FP_PITCH = MathUtils.degToRad(-30)
/** FP fallback head position (station-local) if no head anchor is registered. */
export const FP_FALLBACK_HEAD: [number, number, number] = [0, 1.65, 0.95]

function cctvSide(stationId: string, bay?: number): 1 | -1 {
  return hashInt01(hashString(`cctv-side:${stationId}:${bay ?? ''}`), 0) < 0.5 ? -1 : 1
}


export function captureCameras(line: Line): CaptureCamDef[] {
  const out: CaptureCamDef[] = []
  for (const st of line.stations) {
    const side = cctvSide(st.id)
    const bays = st.bays ?? 1
    // Station overview: high, operator side, diagonal offset, looking down at the bench.
    const height = 3.6 + 0.8 * hashInt01(hashString(`cctv-h:${st.id}`), 0) // 3.6..4.4 m
    out.push({
      id: `cctv:${st.id}`,
      type: 'cctv',
      stationId: st.id,
      hfov: bays > 1 ? 80 : CCTV_HFOV,
      localPosition: [side * (1.7 + (bays > 1 ? bays * 0.6 : 0)), height, 2.6 + (bays > 1 ? 1 : 0)],
      localTarget: [0, 0.75, 0.15],
    })
    out.push({
      id: `fp:${st.id}`,
      type: 'fp',
      stationId: st.id,
      hfov: FP_HFOV,
      localPosition: [0, 0.02, -0.06],
      pitch: FP_PITCH,
      anchor: `head:${st.id}`,
    })
    if (bays > 1) {
      for (let b = 0; b < bays; b++) {
        const bz = bayLocalZ(b)
        const s = cctvSide(st.id, b)
        out.push({
          id: `cctv:${st.id}#${b}`,
          type: 'cctv',
          stationId: st.id,
          bay: b,
          hfov: CCTV_HFOV,
          localPosition: [s * 1.5, 3.7, bz + 2.5],
          localTarget: [0, 0.75, bz + 0.15],
        })
      }
    }
  }
  return out
}

export function CAMERA_IDS(line: Line): string[] {
  return captureCameras(line).map((c) => c.id)
}

export function findCamera(line: Line, id: string): CaptureCamDef | undefined {
  return captureCameras(line).find((c) => c.id === id)
}

/** Vertical FOV (what three.js PerspectiveCamera.fov wants) from horizontal FOV. */
export function vfovFromHfov(hfovDeg: number, aspect: number): number {
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(hfovDeg) / 2) / aspect))
}

/** Variation window index at t, phase-shifted per camera so cameras don't all change together. */
export function variationCycle(t: number, camId: string): number {
  const phase = hashInt01(hashString(`phase:${camId}`), 0) * VARIATION_WINDOW
  return Math.floor((t + phase) / VARIATION_WINDOW)
}

/** Per-window jitter value in [-1, 1] for channel k, blended smoothly across window edges. */
function windowJitter(camId: string, k: number, t: number): number {
  const seed = hashString(`jit:${camId}:${k}`)
  const phase = hashInt01(hashString(`phase:${camId}`), 0) * VARIATION_WINDOW
  const u = t + phase
  const c = Math.floor(u / VARIATION_WINDOW)
  const into = u - c * VARIATION_WINDOW
  const cur = hashSigned(seed, c)
  if (c > 0 && into < BLEND) return hashSigned(seed, c - 1) + (cur - hashSigned(seed, c - 1)) * smoothstep(0, BLEND, into)
  return cur
}

export interface CaptureLighting {
  /** Multiply light intensities by this (0.9..1.1). */
  intensity: number
  /** Colour temperature, Kelvin (BASE_KELVIN ±10 %). */
  kelvin: number
  /** Linear RGB multiplier derived from kelvin, normalised so max channel = 1. Multiply light colours by it. */
  color: [number, number, number]
}

/** Approximate blackbody colour (Tanner Helland fit), sRGB 0..1. */
function kelvinToRgb(k: number): [number, number, number] {
  const t = k / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
    b = 255
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return [c(r), c(g), c(b)]
}

/**
 * Lighting multipliers for camera camId at sim time t. Deterministic, varies per
 * variation window. The scene/environment applies these in capture mode.
 */
export function captureLighting(t: number, camId: string): CaptureLighting {
  const intensity = 1 + LIGHT_JITTER * windowJitter(camId, 10, t)
  const kelvin = BASE_KELVIN * (1 + LIGHT_JITTER * windowJitter(camId, 11, t))
  const rgb = kelvinToRgb(kelvin)
  const ref = kelvinToRgb(BASE_KELVIN)
  const rel: [number, number, number] = [rgb[0] / ref[0], rgb[1] / ref[1], rgb[2] / ref[2]]
  const m = Math.max(...rel)
  return { intensity, kelvin, color: [rel[0] / m, rel[1] / m, rel[2] / m] }
}

export interface CameraPose {
  position: Vector3
  quaternion: Quaternion
  /** Horizontal FOV, degrees. */
  hfov: number
}

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler(0, 0, 0, 'YXZ')
const _up = new Vector3(0, 1, 0)

function stationMatrix(st: Station): Matrix4 {
  return new Matrix4().compose(new Vector3(st.x, 0, st.y), new Quaternion().setFromAxisAngle(_up, st.rot), new Vector3(1, 1, 1))
}

/**
 * Camera pose at sim time t. For FP, pass the head anchor (its world matrix is
 * refreshed here); without it, a station-local fallback head is used.
 */
export function cameraPoseAt(line: Line, def: CaptureCamDef, t: number, anchor?: Object3D): CameraPose {
  const st = line.stations.find((s) => s.id === def.stationId)
  if (!st) throw new Error(`capture: unknown station ${def.stationId}`)
  const jp = (k: number) => POS_JITTER * windowJitter(def.id, k, t)
  const ja = (k: number) => ANG_JITTER * windowJitter(def.id, k, t)

  if (def.type === 'cctv') {
    const S = stationMatrix(st)
    const eye = new Vector3(...def.localPosition).add(new Vector3(jp(0), jp(1), jp(2))).applyMatrix4(S)
    const target = new Vector3(...(def.localTarget ?? [0, 0.85, 0])).applyMatrix4(S)
    _m.lookAt(eye, target, _up)
    const q = new Quaternion().setFromRotationMatrix(_m)
    _e.set(ja(3), ja(4), ja(5))
    q.multiply(_q.setFromEuler(_e))
    return { position: eye, quaternion: q, hfov: def.hfov }
  }

  // First person: ride the head anchor, then add pitch, deterministic bob/sway and per-window jitter.
  let headPos: Vector3
  let headQuat: Quaternion
  if (anchor) {
    anchor.updateWorldMatrix(true, false)
    headPos = new Vector3()
    headQuat = new Quaternion()
    anchor.matrixWorld.decompose(headPos, headQuat, new Vector3())
  } else {
    const S = stationMatrix(st)
    headPos = new Vector3(...FP_FALLBACK_HEAD).applyMatrix4(S)
    headQuat = new Quaternion().setFromAxisAngle(_up, st.rot)
  }
  const seed = hashString(`bob:${def.id}`)
  const stepHz = 1.7
  const bob = new Vector3(
    0.008 * Math.sin(Math.PI * stepHz * t) + 0.006 * valueNoise(seed, t * 0.7),
    0.012 * Math.abs(Math.sin(Math.PI * stepHz * t)) + 0.006 * valueNoise(seed + 1, t * 0.9),
    0.006 * valueNoise(seed + 2, t * 0.5),
  )
  const off = new Vector3(...def.localPosition).add(bob).add(new Vector3(jp(0), jp(1), jp(2)).multiplyScalar(0.25))
  const position = headPos.clone().add(off.applyQuaternion(headQuat))
  _e.set(
    (def.pitch ?? 0) + ja(3) + MathUtils.degToRad(1.6) * valueNoise(seed + 3, t * 0.6),
    ja(4) + MathUtils.degToRad(2.2) * valueNoise(seed + 4, t * 0.35),
    ja(5) + MathUtils.degToRad(1.2) * valueNoise(seed + 5, t * 0.5),
  )
  const quaternion = headQuat.clone().multiply(_q.setFromEuler(_e))
  return { position, quaternion, hfov: def.hfov }
}
