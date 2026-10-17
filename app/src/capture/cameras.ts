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
import { bayLocalZ, UNIT_NEAR_FACE_Z, WORKER_LOCAL_Z } from '../lib/layout'
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
  /** CCTV: station-local eye position. FP: mount offset from the head anchor in the head's level (yaw-only) frame. */
  localPosition: [number, number, number]
  /** CCTV: station-local look-at target. FP: unused. */
  localTarget?: [number, number, number]
  /** FP: extra pitch on top of the head anchor, radians (negative = look down). */
  pitch?: number
  /** Anchor key the FP camera rides on. */
  anchor?: string
  /** FP: hand anchor keys (`hand:<station>:R|L`); the camera biases its aim toward hands in front of it. */
  hands?: string[]
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
/** Station CCTV mount (station-local, x mirrored per station): inside the gantry's cross beams (x = ±1.75)... */
export const CCTV_X = 1.4
/** ...below its beams (2.57 m) and luminaires (2.42 m bottom), incl. +0.15 m spread and ±0.1 m jitter... */
export const CCTV_Y = 2.25
/** ...and behind its front posts (z = 2.4), so they stay out of frame. */
export const CCTV_Z = 2.2
/** Station CCTV look-at: between the worker (z ≈ 0.7..0.95) and the unit (z = 0), at bench height. */
export const CCTV_TARGET: [number, number, number] = [0, 0.9, 0.3]
export const FP_HFOV = 90
/**
 * FP mount tilt below the aim, radians. The head anchor already looks at the work (pose.ts aims
 * the head at each verb's target) and the aim is pulled toward the hands (FP_HAND_BIAS), so this
 * is only a small mount tilt. It was -30° on top of the gaze, which put the camera at -70..-80°
 * at the bench and under the unit at the brazer.
 */
export const FP_PITCH = MathUtils.degToRad(-6)
/** FP aim: a point this far (m) along the head's gaze... */
export const FP_GAZE_DIST = 0.6
/** ...pulled this far (0..1) toward the hands that are in front of the camera, like a chest/head cam framing the work. */
export const FP_HAND_BIAS = 0.5
/** Final FP pitch window (world horizon), radians: never straight down at the floor, never up at the roof. */
export const FP_MIN_PITCH = MathUtils.degToRad(-60)
export const FP_MAX_PITCH = MathUtils.degToRad(6)
/** Final FP roll limit (head tilt), radians, so the horizon stays sane. */
export const FP_MAX_ROLL = MathUtils.degToRad(8)
/**
 * Minimum distance (m) of the FP camera from the unit's near face, station-local z. The worker
 * pose keeps the eye >= 0.25 m away (workers/pose.ts EYE_STANDOFF); the camera keeps a bit more
 * so the hands, tool and part are framed instead of a close-up of the unit. Estimate.
 */
export const FP_STANDOFF = 0.35
export const FP_MIN_Z = UNIT_NEAR_FACE_Z + FP_STANDOFF
/** FP fallback head position (station-local) if no head anchor is registered (robot stations). */
export const FP_FALLBACK_HEAD: [number, number, number] = [0, 1.65, WORKER_LOCAL_Z]
/** Where the fallback head looks (station-local): the work on the conveyor. */
export const FP_FALLBACK_TARGET: [number, number, number] = [0, 1.0, 0]

/**
 * Per-kind CCTV mount overrides (station-local z of the mount and look-at). Kitting's flow rack
 * stands behind the operator (z 1.52..2.38, 2 m tall) right under the standard mount, so its
 * camera sits in front of the rack and looks a little toward it to keep the picks in view.
 */
const CCTV_KIND: Partial<Record<Station['kind'], { z: number; target: [number, number, number] }>> = {
  kitting: { z: 1.1, target: [0, 0.95, 0.75] },
}

function cctvSide(stationId: string, bay?: number): 1 | -1 {
  return hashInt01(hashString(`cctv-side:${stationId}:${bay ?? ''}`), 0) < 0.5 ? -1 : 1
}


export function captureCameras(line: Line): CaptureCamDef[] {
  const out: CaptureCamDef[] = []
  for (const st of line.stations) {
    const side = cctvSide(st.id)
    const ko = CCTV_KIND[st.kind]
    const bays = st.bays ?? 1
    // Station view: operator side, diagonal offset, looking down at the worker and the unit.
    // Single-bay: mounted on the station gantry's front corner, INSIDE its frame and BELOW its
    // beams (2.57 m) and luminaires (2.42 m), so no beam, luminaire, post or ceiling service sits
    // in front of the lens. At 3.6..4.4 m, x = ±1.7 the cross beam, a luminaire and the air
    // ring main (4.0 m) crossed the view; beside the gantry its front post did.
    // Multi-bay overview: high, beyond the gantry in x (the view passes under its cross beam) and
    // inside the compressed-air ring main (z ≈ 2.65) so its drop pipes stay behind the lens.
    const height = bays > 1 ? 3.8 : CCTV_Y + 0.15 * hashInt01(hashString(`cctv-h:${st.id}`), 0)
    out.push({
      id: `cctv:${st.id}`,
      type: 'cctv',
      stationId: st.id,
      hfov: bays > 1 ? 80 : CCTV_HFOV,
      localPosition: bays > 1 ? [side * (2.3 + bays * 0.6), height, 2.3] : [side * CCTV_X, height, ko?.z ?? CCTV_Z],
      localTarget: bays > 1 ? [0, 0.75, 0.15] : ko?.target ?? CCTV_TARGET,
    })
    out.push({
      id: `fp:${st.id}`,
      type: 'fp',
      stationId: st.id,
      hfov: FP_HFOV,
      // Helmet mount: above and a little behind the eye anchor, in the head's level frame so a
      // steep head pitch cannot swing it back into the neck (the filmed worker's own head and
      // neck are hidden on its FP page).
      localPosition: [0, 0.06, 0.04],
      pitch: FP_PITCH,
      anchor: `head:${st.id}`,
      hands: [`hand:${st.id}:R`, `hand:${st.id}:L`],
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
          // Bay 0 has the station gantry: same low mount as a single-bay station. Bays behind it have
          // no gantry but stand right behind the previous bay's machine (run-test booth back wall
          // at bz + 1.35, 2.3 m tall), so their cameras hang high, between that wall and the worker.
          localPosition:
            b === 0
              ? [s * CCTV_X, CCTV_Y + 0.15 * hashInt01(hashString(`cctv-h:${st.id}#${b}`), 0), bz + CCTV_Z]
              : [s * 1.5, 3.2, bz + 1.2],
          localTarget: b === 0 ? [CCTV_TARGET[0], CCTV_TARGET[1], bz + CCTV_TARGET[2]] : [0, 0.85, bz + 0.05],
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
 * refreshed here); without it, a station-local fallback head is used. FP also takes the
 * worker's hand anchors (see CaptureCamDef.hands) to keep the hands in frame.
 */
export function cameraPoseAt(line: Line, def: CaptureCamDef, t: number, anchor?: Object3D, hands: (Object3D | undefined)[] = []): CameraPose {
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
    // No worker (robot station): a fixed eye point that looks at the work, like a head anchor would.
    const S = stationMatrix(st)
    headPos = new Vector3(...FP_FALLBACK_HEAD).applyMatrix4(S)
    const tgt = new Vector3(...FP_FALLBACK_TARGET).applyMatrix4(S)
    headQuat = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(headPos, tgt, _up))
  }
  const seed = hashString(`bob:${def.id}`)
  const stepHz = 1.7
  const bob = new Vector3(
    0.008 * Math.sin(Math.PI * stepHz * t) + 0.006 * valueNoise(seed, t * 0.7),
    0.012 * Math.abs(Math.sin(Math.PI * stepHz * t)) + 0.006 * valueNoise(seed + 1, t * 0.9),
    0.006 * valueNoise(seed + 2, t * 0.5),
  )
  const off = new Vector3(...def.localPosition).add(bob).add(new Vector3(jp(0), jp(1), jp(2)).multiplyScalar(0.25))
  const headYaw = new Euler().setFromQuaternion(headQuat, 'YXZ').y
  const position = headPos.clone().add(off.applyAxisAngle(_up, headYaw))

  // Standoff from the work: never closer than FP_MIN_Z to the unit's near face (station-local z).
  // Back off along station +z only, so the framing slides back rather than swinging.
  const S = stationMatrix(st)
  const local = position.clone().applyMatrix4(S.clone().invert())
  if (local.z < FP_MIN_Z) {
    local.z = FP_MIN_Z
    position.copy(local.applyMatrix4(S))
  }

  // Aim: the gaze point, pulled toward the hands that are in front of the camera (weight fades
  // to 0 for hands beside or behind it, e.g. swinging while walking). Keeps hands, tool and part
  // in frame when the head looks past them at the target.
  const fwd = new Vector3(0, 0, -1).applyQuaternion(headQuat)
  const target = headPos.clone().addScaledVector(fwd, FP_GAZE_DIST)
  const mid = new Vector3()
  let wSum = 0
  let wMax = 0
  for (const h of hands) {
    if (!h) continue
    h.updateWorldMatrix(true, false)
    const p = new Vector3().setFromMatrixPosition(h.matrixWorld)
    const c = p.clone().sub(position).normalize().dot(fwd)
    const w = smoothstep(-0.1, 0.45, c)
    mid.addScaledVector(p, w)
    wSum += w
    wMax = Math.max(wMax, w)
  }
  if (wSum > 1e-6) target.lerp(mid.multiplyScalar(1 / wSum), FP_HAND_BIAS * wMax)
  const quaternion = new Quaternion().setFromRotationMatrix(_m.lookAt(position, target, _up))
  // Keep the head's roll (clamped below), then the mount tilt, sway and per-window jitter.
  const headRoll = new Euler().setFromQuaternion(headQuat, 'YXZ').z
  _e.set(
    (def.pitch ?? 0) + ja(3) + MathUtils.degToRad(1.6) * valueNoise(seed + 3, t * 0.6),
    ja(4) + MathUtils.degToRad(2.2) * valueNoise(seed + 4, t * 0.35),
    headRoll + ja(5) + MathUtils.degToRad(1.2) * valueNoise(seed + 5, t * 0.5),
  )
  quaternion.multiply(_q.setFromEuler(_e))

  // Keep a horizon-sane, work-facing view: clamp world pitch and roll (yaw is free).
  _e.setFromQuaternion(quaternion, 'YXZ')
  _e.set(MathUtils.clamp(_e.x, FP_MIN_PITCH, FP_MAX_PITCH), _e.y, MathUtils.clamp(_e.z, -FP_MAX_ROLL, FP_MAX_ROLL), 'YXZ')
  quaternion.setFromEuler(_e)
  return { position, quaternion, hfov: def.hfov }
}
