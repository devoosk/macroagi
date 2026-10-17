// Pure, deterministic worker pose. `poseWorker` maps (verb, phase, seed, cycle, simTime)
// to joint rotations for the rig in rig.ts. No clocks, no Math.random: jitter is a
// smooth function of simTime and the seeded RNG.

import { Matrix4, Quaternion, Vector3, Euler } from 'three'
import type { ToolKind, VerbClass } from '../../contracts/types'
import { rng } from '../../lib/rng'
import { workerLook } from './look'
import { BONES, RIG, palmSide, type BoneName, type Quat, type Side, type V3 } from './rig'

export type WorkerVerb = VerbClass | 'idle' | 'blocked'
export type PartKind = 'box' | 'pipe' | 'harness' | 'plug' | 'screw'
export type HeldItem = 'tool' | PartKind | null

export interface PoseParams {
  /** Look seed: also drives per-person style (handedness of bins, height). */
  seed: string
  /** Cycle (unit) counter: drives per-cycle variation. */
  cycle: number
  /** Simulation time in seconds; drives jitter, flicker and idle motion only. */
  simTime: number
  /** Tool of the operation; changes the pose for screw/connect/inspect. */
  tool?: ToolKind
  /** Operation duration in seconds (walk/search pacing). Defaults per verb. */
  duration?: number
  /**
   * Station-frame floor position [x, z] of the parts rack the worker walks to for walk/search
   * (centre of the rack's front face). Defaults to `defaultRack(seed)`.
   */
  rack?: [number, number]
  /** Override height in metres (else from workerLook(seed)). */
  height?: number
}

export interface IKInfo {
  /** Requested wrist/ankle target in rig space. */
  target: V3
  /** Distance from the chain root to the target and the chain length. */
  dist: number
  reach: number
  /** True if the target was out of reach and clamped. */
  clamped: boolean
}

export interface PlacedPart {
  kind: PartKind
  side: Side
  /** Station-frame matrix of the grip frame the part was released from (column-major 16). */
  matrix: number[]
}

export interface Pose {
  verb: WorkerVerb
  /** Station-frame root on the floor: position and yaw (rad about +y; 0 faces -z). */
  root: { x: number; z: number; yaw: number }
  /** Uniform rig scale (height / 1.75). */
  scale: number
  /** Hips bone position in rig space. */
  hips: V3
  /** Local bone rotations [x, y, z, w]. */
  joints: Record<BoneName, Quat>
  /** Finger curls 0..1: [thumb, index, middle, ring, pinky]. */
  fingers: { L: number[]; R: number[] }
  held: { L: HeldItem; R: HeldItem }
  /** Tool model to show for the 'tool' held item. */
  tool: ToolKind
  part: PartKind
  placed: PlacedPart[]
  fx: {
    /** Driver chuck angle (rad). */
    spin: number
    /** Torch flame 0..1. */
    flame: number
    /** Scanner beam 0..1. */
    scan: number
    /** Crimper/strapper handle closure 0..1. */
    squeeze: number
  }
  ik: { L: IKInfo; R: IKInfo; legL: IKInfo; legR: IKInfo }
  /** Station-frame matrices of each hand's grip frame (where tools attach). */
  grip: { L: number[]; R: number[] }
  /** Station-frame eye (first-person camera) position. */
  eye: V3
}

// ---------------------------------------------------------------- tool geometry
/** Tool-frame offsets shared by the pose and the tool models. Tool frame: grip at origin, +y = thumb side, -z = forward. */
export const TOOL_GEOM = {
  /** Pistol driver: bit tip. */
  driverTip: [0, 0.075, -0.215] as V3,
  /** Inline screwdriver: tip along +y (out of the thumb side of the fist). */
  screwdriverTip: [0, 0.2, 0] as V3,
  /** Brazing torch nozzle tip. */
  torchTip: [0, 0.03, -0.34] as V3,
  /** Point on the torch tube where the second hand holds it. */
  torchSupport: [0, 0.03, -0.16] as V3,
  /** Barcode scanner window. */
  scannerNose: [0, 0.07, -0.11] as V3,
  /** Sniffer probe tip. */
  snifferTip: [0, 0.03, -0.36] as V3,
  /** Hose coupler mouth. */
  couplerTip: [0, 0, -0.1] as V3,
  /** Crimper jaws. */
  crimperJaw: [0, 0.11, -0.02] as V3,
  /** Where a hose leaves the tool (butt of the grip). */
  hoseOut: [0, -0.1, 0.01] as V3,
}

// ---------------------------------------------------------------- small math
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
const clamp01 = (x: number) => clamp(x, 0, 1)
const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d)
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * t * (t * (t * 6 - 15) + 10)
}
const ss = (a: number, b: number, x: number) => smooth((x - a) / (b - a))
/** 1 inside [a, b], easing in/out over `e`. */
const win = (a: number, b: number, e: number, x: number) => ss(a - e, a + e, x) * (1 - ss(b - e, b + e, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3, fb: V3 = [0, 0, -1]): V3 => {
  const l = len(a)
  return l > 1e-9 ? mul(a, 1 / l) : fb
}
/** Component of a perpendicular to unit n, normalised. */
const orth = (a: V3, n: V3, fb: V3 = [0, 1, 0]): V3 => norm(sub(a, mul(n, dot(a, n))), fb)
/** Rodrigues rotation of v about unit axis k. */
const rot = (v: V3, k: V3, th: number): V3 => {
  const c = Math.cos(th)
  const s = Math.sin(th)
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)))
}
const rotY = (v: V3, th: number): V3 => [v[0] * Math.cos(th) + v[2] * Math.sin(th), v[1], -v[0] * Math.sin(th) + v[2] * Math.cos(th)]
/** Smooth deterministic wobble in about [-1, 1]. */
const wob = (t: number, k: number) => Math.sin(t * 1.0 + k * 12.9898) * 0.5 + Math.sin(t * 2.17 + k * 78.233) * 0.3 + Math.sin(t * 4.31 + k * 37.719) * 0.2
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz)

// ---------------------------------------------------------------- spec
interface HandSpec {
  /** Grip point, station frame (metres). */
  pos: V3
  /** Finger (metacarpal) direction, station frame. */
  fwd: V3
  /** Thumb direction, station frame. */
  up: V3
  grip: number
  /** Elbow pole direction, body frame. */
  pole: V3
}

interface Spec {
  rootX: number
  rootZ: number
  yaw: number
  drop: number
  hipX: number
  hipZ: number
  pelvisYaw: number
  pelvisRoll: number
  lean: number
  twist: number
  bend: number
  shrug: number
  R: HandSpec
  L: HandSpec
  look: V3
  headRoll: number
  /** Body frame (x, lift, z), metres. */
  footL: V3
  footR: V3
  footPitchL: number
  footPitchR: number
}

type HandIn = Partial<HandSpec> & { body?: boolean }
type SpecIn = Partial<Omit<Spec, 'R' | 'L'>> & { R?: HandIn; L?: HandIn; lookBody?: boolean }

const mirV = (v: V3): V3 => [-v[0], v[1], v[2]]

// Hand orientation presets for the right hand [fwd, thumb]; left = mirrored.
const O = {
  relax: [[0.05, -0.55, -0.83], [-0.3, 0.8, -0.5]] as [V3, V3],
  shake: [[0, 0, -1], [0, 1, 0]] as [V3, V3],
  hang: [[0, -1, -0.12], [0, 0, -1]] as [V3, V3],
  palmFwd: [[0, 1, -0.15], [-1, 0, 0]] as [V3, V3],
  palmDown: [[0, -0.15, -1], [-1, 0, 0]] as [V3, V3],
}

const POLE_R: V3 = [0.5, -0.6, 0.6]

const NEUTRAL: Spec = {
  rootX: 0,
  rootZ: -0.15,
  yaw: 0,
  drop: 0.01,
  hipX: 0,
  hipZ: 0,
  pelvisYaw: 0,
  pelvisRoll: 0,
  lean: 0.06,
  twist: 0,
  bend: 0,
  shrug: 0,
  R: { pos: [0.2, 0.96, -0.5], fwd: O.relax[0], up: O.relax[1], grip: 0.3, pole: POLE_R },
  L: { pos: [-0.2, 0.96, -0.5], fwd: mirV(O.relax[0]), up: mirV(O.relax[1]), grip: 0.3, pole: mirV(POLE_R) },
  look: [0, 0.95, -0.95],
  headRoll: 0,
  footL: [-0.11, 0, 0.02],
  footR: [0.11, 0, 0.02],
  footPitchL: 0,
  footPitchR: 0,
}

function cloneSpec(s: Spec): Spec {
  return { ...s, R: { ...s.R }, L: { ...s.L }, look: [...s.look] as V3, footL: [...s.footL] as V3, footR: [...s.footR] as V3 }
}

function bodyToStation(s: Spec, v: V3): V3 {
  const r = rotY(v, s.yaw)
  return [r[0] + s.rootX, r[1], r[2] + s.rootZ]
}

/** Build a spec from a base plus overrides; hands/look flagged `body` are converted from body frame. */
function mk(base: Spec, patch: SpecIn): Spec {
  const out = cloneSpec(base)
  const { R, L, lookBody, ...rest } = patch
  Object.assign(out, rest)
  for (const side of ['R', 'L'] as const) {
    const h = side === 'R' ? R : L
    if (!h) continue
    const { body, ...hv } = h
    const hs: HandSpec = { ...out[side], ...hv }
    if (body) {
      if (hv.pos) hs.pos = bodyToStation(out, hv.pos)
      if (hv.fwd) hs.fwd = rotY(hv.fwd, out.yaw)
      if (hv.up) hs.up = rotY(hv.up, out.yaw)
    }
    out[side] = hs
  }
  if (lookBody && patch.look) out.look = bodyToStation(out, patch.look)
  return out
}

/** Right-hand spec helper with an orientation preset. Pass `true` for the mirrored left. */
function hand(pos: V3, o: [V3, V3], grip: number, left = false, extra: HandIn = {}): HandIn {
  return left
    ? { pos: mirV(pos), fwd: mirV(o[0]), up: mirV(o[1]), grip, pole: mirV(POLE_R), ...extra }
    : { pos, fwd: o[0], up: o[1], grip, pole: POLE_R, ...extra }
}
const both = (pos: V3, o: [V3, V3], grip: number, body = false): { R: HandIn; L: HandIn } => ({
  R: hand(pos, o, grip, false, { body }),
  L: hand(pos, o, grip, true, { body }),
})

function lerpV(a: V3, b: V3, t: number): V3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}
function lerpHand(a: HandSpec, b: HandSpec, t: number): HandSpec {
  return {
    pos: lerpV(a.pos, b.pos, t),
    fwd: norm(lerpV(a.fwd, b.fwd, t), b.fwd),
    up: norm(lerpV(a.up, b.up, t), b.up),
    grip: lerp(a.grip, b.grip, t),
    pole: norm(lerpV(a.pole, b.pole, t), b.pole),
  }
}
function lerpSpec(a: Spec, b: Spec, t: number): Spec {
  const o = cloneSpec(a)
  for (const k of Object.keys(a) as (keyof Spec)[]) {
    const av = a[k]
    const bv = b[k]
    if (typeof av === 'number') (o as unknown as Record<string, number>)[k] = lerp(av, bv as number, t)
  }
  o.R = lerpHand(a.R, b.R, t)
  o.L = lerpHand(a.L, b.L, t)
  o.look = lerpV(a.look, b.look, t)
  o.footL = lerpV(a.footL, b.footL, t)
  o.footR = lerpV(a.footR, b.footR, t)
  return o
}

function mirrorHand(h: HandSpec): HandSpec {
  return { pos: mirV(h.pos), fwd: mirV(h.fwd), up: mirV(h.up), grip: h.grip, pole: mirV(h.pole) }
}
function mirrorSpec(s: Spec): Spec {
  return {
    ...s,
    rootX: -s.rootX,
    yaw: -s.yaw,
    hipX: -s.hipX,
    pelvisYaw: -s.pelvisYaw,
    pelvisRoll: -s.pelvisRoll,
    twist: -s.twist,
    bend: -s.bend,
    headRoll: -s.headRoll,
    R: mirrorHand(s.L),
    L: mirrorHand(s.R),
    look: mirV(s.look),
    footL: mirV(s.footR),
    footR: mirV(s.footL),
    footPitchL: s.footPitchR,
    footPitchR: s.footPitchL,
  }
}

type Key = [number, Spec]
/** Keyframe track with smootherstep easing between keys (motion settles on each key). */
function track(keys: Key[], p: number): Spec {
  if (p <= keys[0][0]) return cloneSpec(keys[0][1])
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i]
    const [t1, b] = keys[i + 1]
    if (p <= t1) return lerpSpec(a, b, smooth((p - t0) / Math.max(1e-6, t1 - t0)))
  }
  return cloneSpec(keys[keys.length - 1][1])
}

/** Grip-point hand spec so that a tool-frame point `tip` lands on world target T, pointing along d. */
function aim(T: V3, d: V3, upHint: V3, tip: V3, standoff = 0, grip = 0.95): HandIn {
  const f = norm(d)
  const t = orth(upHint, f)
  const x = cross(t, mul(f, -1)) // tool x
  // tool frame: +y = t, -z = f, +x = x  =>  world(tip) = G + x*tip.x + t*tip.y - f*tip.z
  const off = add(add(mul(x, tip[0]), mul(t, tip[1])), mul(f, -tip[2]))
  const G = sub(sub(T, off), mul(f, standoff))
  return { pos: G, fwd: f, up: t, grip }
}

/** World point of a tool-frame offset given a hand spec (station frame). */
function toolPoint(h: HandSpec, off: V3): V3 {
  const f = norm(h.fwd)
  const t = orth(h.up, f)
  const x = cross(t, mul(f, -1))
  return add(h.pos, add(add(mul(x, off[0]), mul(t, off[1])), mul(f, -off[2])))
}

/** Roll the hand about its finger axis and tilt the fingers toward the thumb. */
function twistHand(h: HandSpec, roll: number, tilt = 0, axis?: V3): HandSpec {
  const f = norm(h.fwd)
  const k = axis ? norm(axis) : f
  let fwd = rot(f, k, roll)
  let up = rot(norm(h.up), k, roll)
  if (tilt) {
    const side = norm(cross(fwd, up))
    fwd = rot(fwd, side, tilt)
    up = rot(up, side, tilt)
  }
  return { ...h, fwd, up }
}

// ---------------------------------------------------------------- verbs
interface Ctx {
  p: number
  t: number
  seed: string
  cycle: number
  tool: ToolKind
  duration: number
  r: () => number
  k: number // per-cycle noise key
  rack?: [number, number]
}

interface VerbOut {
  spec: Spec
  held: { L: HeldItem; R: HeldItem }
  tool: ToolKind
  part: PartKind
  fingers?: { L?: number[]; R?: number[] }
  fx?: Partial<Pose['fx']>
  /** Release events: phase at which a held item leaves a hand and stays put. */
  release?: { at: number; hand: 'L' | 'R'; kind: PartKind }[]
  /** Spec function to re-evaluate the pose at the release phase. */
  at?: (p: number) => Spec
  mirrored?: boolean
}

const CARRY: Spec = mk(NEUTRAL, {
  lean: 0.08,
  look: [0, 0.95, -0.7],
  R: hand([0.1, 1.05, -0.42], [[-0.12, -0.1, -1], [0, 1, 0]], 0.85),
  L: hand([0.1, 1.05, -0.42], [[-0.12, -0.1, -1], [0, 1, 0]], 0.85, true),
})

function partFor(ctx: Ctx, verb: WorkerVerb): PartKind {
  if (verb === 'insert') return 'box'
  if (verb === 'connect') return 'harness'
  const r = rng('part', ctx.seed, ctx.cycle)()
  return r < 0.6 ? 'box' : r < 0.8 ? 'pipe' : 'harness'
}

function verbPick(ctx: Ctx): VerbOut {
  const sd = rng('bin-side', ctx.seed, ctx.cycle)() < 0.62 ? 1 : -1
  const behind = rng('bin-rear', ctx.seed, ctx.cycle)() < 0.3
  // Built for a bin on the right; mirrored for the left.
  const bin: V3 = behind ? [0.55, 0.74, 0.74] : [0.84, 0.74, 0.2]
  const yawReach = behind ? -2.2 : -1.05
  const reachOri: [V3, V3] = [norm([0.25, -1, 0.15]), rotY([0, 0, -1], yawReach)]
  const keysAt = (): Key[] => [
    [0, NEUTRAL],
    [0.15, mk(NEUTRAL, { rootX: 0.1, rootZ: -0.06, yaw: yawReach * 0.7, twist: -0.25, lean: 0.12, look: bin, R: { pos: add(lerpV(NEUTRAL.R.pos, bin, 0.3), [0, 0.12, 0]), fwd: [0.6, -0.6, 0.1], up: [0.3, 0.3, -1], grip: 0.1 }, L: hand([0.17, 0.95, -0.22], O.relax, 0.3, true, { body: true }) })],
    [0.34, mk(NEUTRAL, { rootX: behind ? 0.28 : 0.3, rootZ: behind ? 0.3 : 0.02, yaw: yawReach, twist: -0.4, lean: 0.62, drop: 0.12, look: [bin[0], bin[1] - 0.05, bin[2]], R: { pos: add(bin, [0, 0.03, 0]), fwd: reachOri[0], up: reachOri[1], grip: 0.05 }, L: hand([0.2, 0.78, -0.25], O.hang, 0.3, true, { body: true }) })],
    [0.44, mk(NEUTRAL, { rootX: behind ? 0.28 : 0.3, rootZ: behind ? 0.3 : 0.02, yaw: yawReach, twist: -0.4, lean: 0.66, drop: 0.14, look: bin, R: { pos: add(bin, [0, -0.02, 0]), fwd: reachOri[0], up: reachOri[1], grip: 1 }, L: hand([0.2, 0.78, -0.25], O.hang, 0.3, true, { body: true }) })],
    [0.6, mk(NEUTRAL, { rootX: 0.12, rootZ: behind ? 0.05 : -0.05, yaw: yawReach * 0.75, twist: -0.2, lean: 0.2, drop: 0.03, lookBody: true, look: [0.1, 1.1, -0.5], R: hand([0.16, 1.14, -0.36], [[-0.15, -0.1, -1], [0, 1, 0]], 1, false, { body: true }), L: hand([0.18, 0.93, -0.3], O.relax, 0.3, true, { body: true }) })],
    [0.78, mk(NEUTRAL, { rootX: 0.03, rootZ: -0.12, yaw: -0.1, lean: 0.1, look: [0, 1.12, -0.5], R: hand([0.1, 1.2, -0.42], [[-0.15, -0.05, -1], [0, 1, 0]], 1), L: hand([0.1, 1.2, -0.42], [[-0.15, -0.05, -1], [0, 1, 0]], 0.85, true) })],
    [0.88, mk(NEUTRAL, { rootX: 0.02, rootZ: -0.14, yaw: -0.05, lean: 0.12, headRoll: 0.12, look: [0, 1.12, -0.5], R: hand([0.1, 1.17, -0.43], [[-0.15, -0.25, -1], [0, 1, -0.2]], 1), L: hand([0.1, 1.17, -0.43], [[-0.15, -0.25, -1], [0, 1, -0.2]], 0.85, true) })],
    [1, CARRY],
  ]
  const keys = keysAt()
  const at = (p: number) => (sd === 1 ? track(keys, p) : mirrorSpec(track(keys, p)))
  const part = partFor(ctx, 'pick')
  const has = ctx.p >= 0.43
  const held = sd === 1 ? { L: null, R: has ? part : null } : { L: has ? part : null, R: null }
  return { spec: at(ctx.p), held, tool: 'none', part, at, mirrored: sd === -1 }
}

function verbPlace(ctx: Ctx): VerbOut {
  const lower: [V3, V3] = [[-0.1, -0.5, -0.86], [0, 0.86, -0.5]]
  const ex = (rng('place-x', ctx.seed, ctx.cycle)() - 0.5) * 0.16
  const X = (v: V3): V3 => [v[0] + ex, v[1], v[2]]
  const keys: Key[] = [
    [0, CARRY],
    [0.22, mk(CARRY, { rootX: ex, rootZ: -0.24, lean: 0.25, look: X([0, 0.88, -0.75]), R: hand(X([0.1, 1.05, -0.64]), O.shake, 0.85), L: { ...hand([0.1, 1.05, -0.64], O.shake, 0.85, true), pos: X([-0.1, 1.05, -0.64]) } })],
    [0.42, mk(CARRY, { rootX: ex, rootZ: -0.25, lean: 0.58, drop: 0.07, look: X([0, 0.86, -0.76]), R: hand(X([0.1, 0.93, -0.72]), lower, 0.85), L: { ...hand([0.1, 0.93, -0.72], lower, 0.85, true), pos: X([-0.1, 0.93, -0.72]) } })],
    [0.54, mk(CARRY, { rootX: ex, rootZ: -0.25, lean: 0.6, drop: 0.08, look: X([0, 0.86, -0.76]), R: hand(X([0.105, 0.928, -0.73]), lower, 0.85), L: { ...hand([0.1, 0.928, -0.73], lower, 0.85, true), pos: X([-0.095, 0.928, -0.73]) } })],
    [0.64, mk(NEUTRAL, { rootX: ex, rootZ: -0.25, lean: 0.42, drop: 0.05, look: X([0, 0.86, -0.76]), R: hand(X([0.25, 1.0, -0.64]), O.relax, 0), L: { ...hand([0.25, 1.0, -0.64], O.relax, 0, true), pos: X([-0.25, 1.0, -0.64]) } })],
    [0.74, mk(NEUTRAL, { rootX: ex, rootZ: -0.25, lean: 0.5, drop: 0.05, look: X([0, 0.86, -0.76]), R: hand(X([0.06, 1.035, -0.74]), O.palmDown, 0.1), L: { ...hand([0.06, 1.035, -0.74], O.palmDown, 0.1, true), pos: X([-0.06, 1.035, -0.74]) } })],
    [0.8, mk(NEUTRAL, { rootX: ex, rootZ: -0.25, lean: 0.45, drop: 0.04, look: X([0, 0.86, -0.76]), R: hand(X([0.06, 1.08, -0.72]), O.palmDown, 0.1), L: { ...hand([0.06, 1.08, -0.72], O.palmDown, 0.1, true), pos: X([-0.06, 1.08, -0.72]) } })],
    [0.86, mk(NEUTRAL, { rootX: ex, rootZ: -0.25, lean: 0.5, drop: 0.05, look: X([0, 0.86, -0.76]), R: hand(X([0.06, 1.035, -0.74]), O.palmDown, 0.1), L: { ...hand([0.06, 1.035, -0.74], O.palmDown, 0.1, true), pos: X([-0.06, 1.035, -0.74]) } })],
    [0.93, mk(NEUTRAL, { rootX: ex * 0.5, rootZ: -0.2, lean: 0.15 })],
    [1, NEUTRAL],
  ]
  const part = partFor(ctx, 'place')
  const has = ctx.p < 0.55
  return {
    spec: track(keys, ctx.p),
    held: { L: null, R: has ? part : null },
    tool: 'none',
    part,
    release: [{ at: 0.55, hand: 'R', kind: part }],
    at: (p) => track(keys, p),
  }
}

function verbInsert(ctx: Ctx): VerbOut {
  const S: [V3, V3] = [[-0.12, -0.05, -1], [0, 1, 0]]
  const H = (z: number, y = 1.1, o = S, g = 0.9) => both([0.09, y, z], o, g)
  const keys: Key[] = [
    [0, CARRY],
    [0.18, mk(CARRY, { rootZ: -0.22, lean: 0.25, look: [0, 1.1, -0.95], ...H(-0.58, 1.12) })],
    [0.3, mk(CARRY, { rootZ: -0.26, lean: 0.36, drop: 0.05, shrug: 0.4, look: [0, 1.1, -0.95], ...H(-0.8) })],
    [0.38, mk(CARRY, { rootZ: -0.26, lean: 0.3, drop: 0.04, shrug: 0.2, look: [0, 1.1, -0.95], ...H(-0.72) })],
    [0.48, mk(CARRY, { rootZ: -0.26, lean: 0.42, drop: 0.07, shrug: 0.6, hipZ: -0.03, look: [0, 1.1, -0.95], ...H(-0.86) })],
    [0.58, mk(NEUTRAL, { rootZ: -0.26, lean: 0.36, drop: 0.05, look: [0, 1.1, -0.95], ...both([0.1, 1.1, -0.8], O.palmFwd, 0.05) })],
    [0.68, mk(NEUTRAL, { rootZ: -0.26, lean: 0.42, drop: 0.07, shrug: 0.5, look: [0, 1.1, -0.95], ...both([0.1, 1.1, -0.86], O.palmFwd, 0.05) })],
    [0.76, mk(NEUTRAL, { rootZ: -0.26, lean: 0.36, drop: 0.05, look: [0, 1.1, -0.95], ...both([0.1, 1.1, -0.79], O.palmFwd, 0.05) })],
    [0.84, mk(NEUTRAL, { rootZ: -0.26, lean: 0.42, drop: 0.07, shrug: 0.5, look: [0, 1.1, -0.95], ...both([0.1, 1.1, -0.86], O.palmFwd, 0.05) })],
    [0.92, mk(NEUTRAL, { rootZ: -0.22, lean: 0.2 })],
    [1, NEUTRAL],
  ]
  const has = ctx.p < 0.5
  return {
    spec: track(keys, ctx.p),
    held: { L: null, R: has ? 'box' : null },
    tool: 'none',
    part: 'box',
    release: [{ at: 0.5, hand: 'R', kind: 'box' }],
    at: (p) => track(keys, p),
  }
}

function verbScrew(ctx: Ctx): VerbOut {
  const tool: ToolKind = ctx.tool === 'screwdriver' || ctx.tool === 'strapper' ? ctx.tool : 'torque_driver'
  const manual = tool === 'screwdriver'
  const r = rng('screw-pts', ctx.seed, ctx.cycle)
  const A: V3 = [0.12 + r() * 0.12, 1.08 + r() * 0.12, -0.75]
  const B: V3 = [-0.1 + r() * 0.1, 0.98 + r() * 0.1, -0.75]
  const D: V3 = [0, -0.05, -1]
  const up: V3 = manual ? [0, -1, 0] : [0, 1, 0]
  const tip = manual ? TOOL_GEOM.screwdriverTip : TOOL_GEOM.driverTip
  const at = (T: V3, so: number) => (manual ? aimManual(T, so) : aim(T, D, up, tip, so))
  function aimManual(T: V3, so: number): HandIn {
    // Inline screwdriver: shaft leaves the thumb side of the fist, so thumb axis = screw axis.
    const t = norm(D)
    const f = orth([0.15, -1, 0], t)
    const G = sub(sub(T, mul(t, tip[1])), mul(t, so))
    return { pos: G, fwd: f, up: t, grip: 0.95 }
  }
  const steady = hand([-0.27, 1.16, -0.735], O.palmFwd, 0.15, false, { pole: mirV(POLE_R), fwd: [0.1, 1, -0.1], up: [1, 0, 0] })
  const work = (T: V3, so: number, extra: SpecIn = {}) =>
    mk(NEUTRAL, { rootX: 0.03, rootZ: -0.22, lean: 0.28, drop: 0.02, look: T, R: { ...at(T, so), pole: POLE_R }, L: steady, ...extra })
  const holdLow = mk(NEUTRAL, { R: { pos: [0.21, 0.95, -0.42], fwd: [0, -0.65, -0.76], up: [0, 0.76, -0.65], grip: 0.95 } })
  const keys: Key[] = [
    [0, holdLow],
    [0.12, work(A, 0.06)],
    [0.18, work(A, 0)],
    [0.42, work(A, -0.012)],
    [0.5, work(A, 0.07, { lean: 0.22 })],
    [0.56, work(B, 0.05, { twist: 0.08 })],
    [0.6, work(B, 0, { twist: 0.08, lean: 0.33, drop: 0.04 })],
    [0.84, work(B, -0.012, { twist: 0.08, lean: 0.33, drop: 0.04 })],
    [0.92, work(B, 0.09, { lean: 0.2 })],
    [1, holdLow],
  ]
  const spec = track(keys, ctx.p)
  const p = ctx.p
  const driving = win(0.18, 0.42, 0.01, p) + win(0.6, 0.84, 0.01, p)
  const kickU = (a: number) => clamp01((p - a) / 0.06)
  const kickEnv = (a: number) => {
    const u = kickU(a)
    return u <= 0 || u >= 1 ? 0 : u < 0.2 ? smooth(u / 0.2) : Math.exp(-(u - 0.2) * 5) * (1 - smooth((u - 0.8) / 0.2))
  }
  const kick = manual ? 0 : kickEnv(0.42) + kickEnv(0.84)
  let R = spec.R
  if (manual) {
    // Wrist twist strokes about the screw axis.
    const roll = driving * 0.85 * Math.sin(ctx.p * Math.PI * 2 * 9)
    R = twistHand(R, roll, 0, R.up)
  } else {
    const jit = driving * (0.05 * wob(ctx.t * 9, ctx.k) + 0.02 * wob(ctx.t * 23, ctx.k + 3))
    R = twistHand(R, jit + kick * 0.55, -kick * 0.18)
    R = { ...R, pos: add(R.pos, [kick * 0.02 + driving * 0.002 * wob(ctx.t * 31, ctx.k), kick * 0.03, kick * 0.02]) }
  }
  spec.R = R
  spec.lean += kick * 0.04
  spec.twist -= kick * 0.06
  const trig = driving > 0.5 ? 0.95 : 0.55
  return {
    spec,
    held: { L: null, R: 'tool' },
    tool,
    part: 'screw',
    fingers: manual ? undefined : { R: [0.9, trig, 1, 1, 1] },
    fx: { spin: driving > 0.01 && !manual ? ctx.t * 42 : 0, squeeze: tool === 'strapper' ? driving : 0 },
  }
}

function verbConnect(ctx: Ctx): VerbOut {
  const tool: ToolKind = ctx.tool === 'crimper' || ctx.tool === 'hose' ? ctx.tool : 'none'
  const p = ctx.p
  if (tool === 'hose') {
    // Push a charging-hose coupler onto a service port, then twist to lock.
    const P: V3 = [0.24, 0.98, -0.75]
    const D: V3 = [0, -0.1, -1]
    const w = (so: number, extra: SpecIn = {}) =>
      mk(NEUTRAL, { rootX: 0.08, rootZ: -0.24, lean: 0.4, drop: 0.06, look: P, headRoll: 0.1, R: aim(P, D, [0, 1, 0], TOOL_GEOM.couplerTip, so), L: hand([0.08, 0.98, -0.42], [[0.6, -0.3, -0.75], [0.3, 0.9, 0]], 0.9, true, { pos: [0.06, 0.98, -0.45] }), ...extra })
    const keys: Key[] = [
      [0, NEUTRAL],
      [0.15, w(0.08)],
      [0.3, w(0.02)],
      [0.42, w(-0.015, { shrug: 0.4, lean: 0.48 })],
      [0.5, w(-0.015)],
      [0.72, w(-0.015)],
      [0.8, w(-0.012, { lean: 0.35 })],
      [0.88, mk(NEUTRAL, { rootZ: -0.2, lean: 0.2, R: hand([0.22, 1.0, -0.5], O.relax, 0.2) })],
      [1, NEUTRAL],
    ]
    const spec = track(keys, p)
    const tw = win(0.5, 0.72, 0.02, p)
    spec.R = twistHand(spec.R, tw * 0.7 * Math.sin((p - 0.5) * Math.PI * 2 * 4.5))
    return { spec, held: { L: null, R: p < 0.82 ? 'tool' : null }, tool, part: 'plug', release: [], fingers: {} }
  }
  const C: V3 = [0.0, 1.12, -0.6]
  const inward: [V3, V3] = [[-0.5, -0.1, -0.86], [0, 1, 0]]
  const H = (dx: number, y: number, z: number, g = 0.8, o = inward) => ({
    R: hand([C[0] + dx, y, z], o, g),
    L: hand([C[0] + dx, y, z], o, g, true),
  })
  if (tool === 'crimper') {
    const keys: Key[] = [
      [0, NEUTRAL],
      [0.14, mk(NEUTRAL, { rootZ: -0.18, lean: 0.25, headRoll: 0.12, look: [0, 1.2, -0.55], R: hand([0.1, 1.08, -0.5], [[-0.35, 0, -0.94], [0, 1, 0]], 0.75), L: hand([0.12, 1.24, -0.55], [[0.9, 0, -0.4], [0, 1, 0]], 0.8, true) })],
      [0.8, mk(NEUTRAL, { rootZ: -0.18, lean: 0.28, headRoll: 0.14, look: [0, 1.2, -0.55], R: hand([0.1, 1.08, -0.5], [[-0.35, 0, -0.94], [0, 1, 0]], 0.75), L: hand([0.12, 1.24, -0.55], [[0.9, 0, -0.4], [0, 1, 0]], 0.8, true) })],
      [0.9, mk(NEUTRAL, { rootZ: -0.18, lean: 0.4, look: [0, 1.0, -0.8], R: hand([0.2, 1.0, -0.5], [[0, -0.65, -0.76], [0, 0.76, -0.65]], 0.8), L: hand([0.05, 1.02, -0.72], O.palmDown, 0.2, true) })],
      [1, NEUTRAL],
    ]
    const spec = track(keys, p)
    // Left hand feeds the wire into the jaws; computed from the crimper pose.
    const jaw = toolPoint(spec.R, TOOL_GEOM.crimperJaw)
    const lw = win(0.14, 0.8, 0.04, p)
    spec.L = lerpHand(spec.L, { ...spec.L, pos: add(jaw, [-0.075, 0.0, 0.01]) }, lw)
    let sq = 0
    for (const c of [0.3, 0.46, 0.62]) sq = Math.max(sq, Math.sin(Math.PI * clamp01((p - c) / 0.09)))
    spec.R.grip = 0.75 + 0.25 * sq
    spec.shrug += sq * 0.12
    spec.R = twistHand(spec.R, -sq * 0.08)
    return { spec, held: { L: p < 0.86 ? 'harness' : null, R: 'tool' }, tool, part: 'harness', fx: { squeeze: sq }, fingers: { L: [0.9, 0.85, 0.9, 0.9, 0.9] } }
  }
  const keys: Key[] = [
    [0, NEUTRAL],
    [0.12, mk(NEUTRAL, { rootZ: -0.2, lean: 0.3, drop: 0.03, headRoll: 0.14, look: [0, 1.1, -0.62], ...H(0.13, 1.12, -0.58) })],
    [0.22, mk(NEUTRAL, { rootZ: -0.2, lean: 0.34, drop: 0.03, headRoll: 0.16, look: [0, 1.1, -0.62], ...H(0.045, 1.12, -0.6) })],
    [0.62, mk(NEUTRAL, { rootZ: -0.2, lean: 0.36, drop: 0.03, headRoll: 0.18, look: [0, 1.1, -0.62], ...H(0.045, 1.12, -0.6) })],
    [0.68, mk(NEUTRAL, { rootZ: -0.2, lean: 0.36, drop: 0.03, shrug: 0.25, headRoll: 0.18, look: [0, 1.1, -0.62], ...H(0.028, 1.12, -0.6, 1) })],
    [0.73, mk(NEUTRAL, { rootZ: -0.2, lean: 0.34, drop: 0.03, headRoll: 0.1, look: [0, 1.1, -0.62], ...H(0.06, 1.13, -0.59, 1) })],
    [0.82, mk(NEUTRAL, { rootZ: -0.24, lean: 0.52, drop: 0.05, look: [0, 1.0, -0.8], ...H(0.05, 1.03, -0.76, 0.8, [[-0.3, -0.3, -0.9], [0, 1, 0]]) })],
    [0.9, mk(NEUTRAL, { rootZ: -0.22, lean: 0.35, drop: 0.03, look: [0, 1.0, -0.8], ...H(0.16, 1.06, -0.66, 0.1, O.relax) })],
    [1, NEUTRAL],
  ]
  const spec = track(keys, p)
  const fid = win(0.22, 0.64, 0.03, p)
  const t = ctx.t
  spec.R = { ...twistHand(spec.R, fid * 0.22 * wob(t * 5, ctx.k)), pos: add(spec.R.pos, mul([wob(t * 6, ctx.k + 1), wob(t * 7, ctx.k + 2), wob(t * 5.5, ctx.k + 3)], fid * 0.012)) }
  spec.L = { ...twistHand(spec.L, fid * 0.18 * wob(t * 4.3, ctx.k + 4)), pos: add(spec.L.pos, mul([wob(t * 5.2, ctx.k + 5), wob(t * 6.1, ctx.k + 6), wob(t * 4.8, ctx.k + 7)], fid * 0.01)) }
  spec.headRoll += fid * 0.05 * wob(t * 1.3, ctx.k)
  const fj = (i: number, base: number) => clamp01(base + fid * 0.35 * wob(t * (7 + i * 1.7), ctx.k + 10 + i))
  const has = p < 0.84
  return {
    spec,
    held: { L: has ? 'harness' : null, R: has ? 'plug' : null },
    tool: 'none',
    part: 'harness',
    fingers: { L: [0, 1, 2, 3, 4].map((i) => fj(i, 0.75)), R: [0, 1, 2, 3, 4].map((i) => fj(i + 5, i < 2 ? 0.55 : 0.8)) },
    release: [
      { at: 0.84, hand: 'L', kind: 'harness' },
      { at: 0.84, hand: 'R', kind: 'plug' },
    ],
    at: (q) => track(keys, q),
  }
}

function verbBraze(ctx: Ctx): VerbOut {
  const r = rng('braze', ctx.seed, ctx.cycle)
  const J: V3 = [0.02 + r() * 0.1, 1.08 + r() * 0.1, -0.8]
  const eyeish: V3 = [0.42, 1.24, -0.42]
  const d0 = norm(sub(J, eyeish))
  const p = ctx.p
  const u = clamp01((p - 0.16) / 0.7)
  const sweepW = win(0.16, 0.86, 0.04, p)
  const alpha = sweepW * (0.7 * Math.sin(u * Math.PI * 2 * 2.5) + 0.06 * wob(ctx.t * 3, ctx.k))
  const beta = sweepW * 0.16 * Math.sin(u * Math.PI * 2 * 5 + 1)
  const sideAx = norm(cross(d0, [0, 1, 0]))
  const d = rot(rot(d0, [0, 1, 0], alpha), sideAx, beta)
  const torchAt = (dist: number) => aim(sub(J, mul(d, dist)), d, [0, 1, 0], TOOL_GEOM.torchTip, 0, 0.95)
  const lean = (extra: SpecIn = {}) => mk(NEUTRAL, { rootX: 0.05, rootZ: -0.24, lean: 0.45, drop: 0.07, headRoll: 0.26, look: J, twist: 0.05, ...extra })
  const holdLow = mk(NEUTRAL, { R: { pos: [0.22, 0.95, -0.42], fwd: [0, -0.8, -0.6], up: [0, 0.6, -0.8], grip: 0.95 } })
  const keys: Key[] = [
    [0, holdLow],
    [0.12, lean({ R: torchAt(0.2), lean: 0.35 })],
    [0.16, lean({ R: torchAt(0.09) })],
    [0.86, lean({ R: torchAt(0.09) })],
    [0.92, lean({ R: torchAt(0.22), lean: 0.3, drop: 0.04 })],
    [1, holdLow],
  ]
  const spec = track(keys, p)
  // During the sweep the torch follows the arc (the keyed pose holds the body).
  spec.R = lerpHand(spec.R, { ...torchAt(0.09), pole: POLE_R } as HandSpec, sweepW)
  spec.twist += -alpha * 0.3
  spec.hipX += alpha * 0.02
  spec.look = add(J, mul(d, 0.02))
  // Second hand supports the torch tube.
  const sup = toolPoint(spec.R, TOOL_GEOM.torchSupport)
  const tube = norm(spec.R.fwd)
  const lHand: HandSpec = { pos: sup, up: tube, fwd: orth([0.55, -1, 0.1], tube), grip: 0.9, pole: [-0.35, -0.8, 0.45] }
  spec.L = lerpHand(spec.L, lHand, ss(0.04, 0.12, p) * (1 - ss(0.9, 0.97, p)))
  const flame = ss(0.13, 0.16, p) * (1 - ss(0.87, 0.9, p))
  return { spec, held: { L: null, R: 'tool' }, tool: 'torch', part: 'pipe', fx: { flame } }
}

function verbInspect(ctx: Ctx): VerbOut {
  const tool: ToolKind = ctx.tool === 'scanner' || ctx.tool === 'hose' ? ctx.tool : 'none'
  const p = ctx.p
  const sniff = tool === 'hose'
  const T: V3[] = sniff
    ? [[-0.22, 1.25, -0.77], [0.12, 1.18, -0.77], [0.28, 1.02, -0.77], [0.0, 0.93, -0.8], [-0.2, 0.92, -0.8], [0.0, 1.5, -0.85]]
    : [[-0.32, 1.45, -0.75], [0.32, 1.45, -0.75], [0.36, 1.05, -0.75], [0.0, 0.9, -0.82], [-0.3, 0.9, -0.82], [0.0, 1.62, -0.95]]
  const tip = sniff ? TOOL_GEOM.snifferTip : TOOL_GEOM.scannerNose
  const so = sniff ? 0.02 : 0.32
  const aimAt = (Tt: V3, from: V3) => aim(Tt, norm(sub(Tt, from)), [0, 1, 0], tip, so, 0.95)
  const behind: { R: HandIn; L: HandIn } = {
    R: { pos: [0.05, 1.0, 0.17], fwd: [-0.45, -0.85, 0.15], up: [-0.3, 0.2, -0.93], grip: 0.6, pole: [0.55, -0.55, 0.8], body: true },
    L: { pos: [-0.03, 1.01, 0.18], fwd: [0.45, -0.85, 0.15], up: [0.3, 0.2, -0.93], grip: 0.6, pole: [-0.55, -0.55, 0.8], body: true },
  }
  const hands = (Tt: V3, from: V3): { R: HandIn; L?: HandIn } =>
    tool === 'none' ? behind : { R: { ...aimAt(Tt, from), pole: POLE_R }, L: hand([0.2, 0.95, -0.2], O.relax, 0.3, true, { body: true }) }
  const standFrom: V3 = [0.15, 1.35, -0.3]
  const lowFrom: V3 = [0.1, 1.05, -0.35]
  const holdLow = tool === 'none' ? mk(NEUTRAL, { lean: 0.04, ...behind }) : mk(NEUTRAL, { R: { pos: [0.22, 0.97, -0.38], fwd: [0, -0.5, -0.86], up: [0, 0.86, -0.5], grip: 0.95 } })
  const base = (extra: SpecIn) => mk(NEUTRAL, { rootZ: -0.2, ...extra })
  const keys: Key[] = [
    [0, holdLow],
    [0.12, base({ lean: 0.15, twist: 0.22, look: T[0], ...hands(T[0], standFrom) })],
    [0.3, base({ lean: 0.15, twist: -0.22, look: T[1], ...hands(T[1], standFrom) })],
    [0.42, base({ lean: 0.32, twist: -0.25, drop: 0.04, look: T[2], ...hands(T[2], standFrom) })],
    [0.56, base({ lean: 0.5, drop: 0.32, twist: 0.0, hipZ: 0.05, look: [T[3][0], 0.84, -0.95], ...hands(T[3], lowFrom) })],
    [0.7, base({ lean: 0.5, drop: 0.33, twist: 0.2, hipZ: 0.05, look: [T[4][0], 0.84, -0.95], ...hands(T[4], lowFrom) })],
    [0.84, base({ lean: 0.02, twist: 0, look: T[5], ...hands(T[5], [0.1, 1.45, -0.3]) })],
    [1, holdLow],
  ]
  const spec = track(keys, p)
  if (tool !== 'none') spec.R = twistHand(spec.R, 0.03 * wob(ctx.t * 2, ctx.k))
  const scan = tool === 'scanner' ? win(0.1, 0.86, 0.02, p) : 0
  return { spec, held: { L: null, R: tool === 'none' ? null : 'tool' }, tool, part: 'box', fx: { scan } }
}

// ---------------------------------------------------------------- walking
interface PathTable {
  pts: V3[]
  cum: number[]
  length: number
  head: number[]
}
const pathCache = new Map<string, PathTable>()
function bezier(a: V3, b: V3, c: V3, d: V3, u: number): V3 {
  const v = 1 - u
  return add(add(mul(a, v * v * v), mul(b, 3 * v * v * u)), add(mul(c, 3 * v * u * u), mul(d, u * u * u)))
}
function pathTable(key: string, a: V3, b: V3, c: V3, d: V3, startHead: number): PathTable {
  const hit = pathCache.get(key)
  if (hit) return hit
  const N = 96
  const pts: V3[] = []
  for (let i = 0; i <= N; i++) pts.push(bezier(a, b, c, d, i / N))
  const cum = [0]
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])))
  const head: number[] = []
  let prev = startHead
  for (let i = 0; i <= N; i++) {
    const q = pts[Math.min(N, i + 1)]
    const pp = pts[Math.max(0, i - 1)]
    let h = yawToward(q[0] - pp[0], q[2] - pp[2])
    while (h - prev > Math.PI) h -= 2 * Math.PI
    while (h - prev < -Math.PI) h += 2 * Math.PI
    head.push(h)
    prev = h
  }
  const t: PathTable = { pts, cum, length: cum[N], head }
  pathCache.set(key, t)
  return t
}
function samplePath(tb: PathTable, s: number): { pos: V3; head: number } {
  const N = tb.pts.length - 1
  const sc = clamp(s, 0, tb.length)
  let lo = 0
  let hi = N
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tb.cum[mid] <= sc) lo = mid
    else hi = mid
  }
  const span = tb.cum[hi] - tb.cum[lo]
  const f = span > 1e-9 ? (sc - tb.cum[lo]) / span : 0
  return { pos: lerpV(tb.pts[lo], tb.pts[hi], f), head: lerp(tb.head[lo], tb.head[hi], f) }
}
/** Trapezoidal velocity profile: position fraction for time fraction x. */
function trap(x: number, acc = 0.18): number {
  const t = clamp01(x)
  const vmax = 1 / (1 - acc)
  if (t < acc) return (0.5 * vmax * t * t) / acc
  if (t > 1 - acc) return 1 - (0.5 * vmax * (1 - t) * (1 - t)) / acc
  return 0.5 * vmax * acc + vmax * (t - acc)
}

const STRIDE = 1.05 // metres per gait cycle (two steps)
/** Distance the worker stops in front of a rack's front face. */
const RACK_STANDOFF = 0.45

/** Default rack for walk/search: beside and behind the station, side chosen per worker. */
export function defaultRack(seed: string): [number, number] {
  const sd = rng('rack-side', seed)() < 0.5 ? 1 : -1
  return [sd * 2.5, 2.4]
}
const TURN_STEP = 0.32 // gait metres per radian of turning on the spot

interface Gait {
  phase: number
  amp: number
  carry: boolean
}

/** Overlay a walking gait on a spec whose root is already set. */
function applyGait(spec: Spec, g: Gait, scan: number, t: number, k: number) {
  const a = g.amp
  const Lh = (STRIDE * 0.6) / 2
  const foot = (ph: number, side: Side): [V3, number] => {
    const f = ((ph % 1) + 1) % 1
    let z: number
    let lift = 0
    let pitch = 0
    if (f < 0.6) {
      z = -Lh + 2 * Lh * (f / 0.6)
      pitch = f > 0.45 ? -0.35 * smooth((f - 0.45) / 0.15) : 0.15 * (1 - smooth(f / 0.12))
    } else {
      const q = (f - 0.6) / 0.4
      z = Lh - 2 * Lh * smooth(q)
      lift = Math.sin(Math.PI * q) * 0.09
      pitch = -0.35 * (1 - smooth(q / 0.4)) + 0.2 * smooth((q - 0.5) / 0.5)
    }
    return [[side * 0.1, lift * a, z * a], pitch * a]
  }
  const [fl, pl] = foot(g.phase, -1)
  const [fr, pr] = foot(g.phase + 0.5, 1)
  spec.footL = fl
  spec.footR = fr
  spec.footPitchL = pl
  spec.footPitchR = pr
  const c = Math.cos(2 * Math.PI * g.phase)
  spec.drop = 0.035 * a + 0.018 * a * (0.5 + 0.5 * Math.cos(4 * Math.PI * g.phase))
  spec.pelvisYaw = -0.12 * a * c
  spec.pelvisRoll = 0.04 * a * Math.sin(2 * Math.PI * g.phase)
  spec.twist = 0.1 * a * c
  spec.lean = 0.07 + 0.03 * a
  spec.hipX = 0.015 * a * Math.sin(2 * Math.PI * g.phase)
  if (!g.carry) {
    const sw = 0.2 * a
    const hR: HandIn = { pos: [0.215, 0.84 + 0.03 * Math.abs(c) * a, -sw * c], fwd: [0.05, -1, -0.15 - 0.5 * sw * c], up: [-0.15, 0, -1], grip: 0.4, pole: [0.3, -0.5, 0.8], body: true }
    const hL: HandIn = { pos: [-0.215, 0.84 + 0.03 * Math.abs(c) * a, sw * c], fwd: [-0.05, -1, -0.15 + 0.5 * sw * c], up: [0.15, 0, -1], grip: 0.4, pole: [-0.3, -0.5, 0.8], body: true }
    const m = mk(spec, { R: hR, L: hL })
    spec.R = m.R
    spec.L = m.L
  } else {
    const m = mk(spec, { R: { ...hand([0.1, 1.05, -0.36], [[-0.12, -0.1, -1], [0, 1, 0]], 0.85), body: true }, L: { ...hand([0.1, 1.05, -0.36], [[-0.12, -0.1, -1], [0, 1, 0]], 0.85, true), body: true } })
    spec.R = m.R
    spec.L = m.L
  }
  // Look ahead along the heading, scanning side to side when searching.
  const scanYaw = scan * (0.75 * Math.sin(t * 1.1 + k) + 0.25 * Math.sin(t * 2.3 + k * 2))
  spec.look = bodyToStation(spec, [Math.sin(-scanYaw) * 3, 1.3 - scan * 0.15, -Math.cos(scanYaw) * 3])
}

interface Segment {
  kind: 'turn' | 'walk' | 'rack'
  dur: number
  gait: number
}

function verbWalk(ctx: Ctx, search: boolean): VerbOut {
  const rack = ctx.rack ?? defaultRack(ctx.seed)
  const sd = rack[0] < 0 ? -1 : 1
  // Built for a rack on the +x side (or straight behind); mirrored for -x.
  const rx = Math.abs(rack[0])
  const rz = rack[1]
  const n: V3 = rx >= 1 ? [1, 0, 0] : [0, 0, 1]
  const A: V3 = [0, 0, -0.15]
  const C: V3 = [rx - n[0] * RACK_STANDOFF, 0, rz - n[2] * RACK_STANDOFF]
  const c1: V3 = [0, 0, A[2] + Math.max(0.6, Math.min(1.4, (C[2] - A[2]) * 0.55))]
  const c2: V3 = sub(C, mul(n, Math.min(1.0, len(sub(C, A)) * 0.35)))
  const pk = `${C[0].toFixed(3)}:${C[2].toFixed(3)}:${n[0]}`
  const out = pathTable(`out:${pk}`, A, c1, c2, C, -Math.PI)
  const back = pathTable(`back:${pk}`, C, c2, c1, A, out.head[out.head.length - 1] + Math.PI)
  const rackYaw = out.head[out.head.length - 1]
  const speed = search ? 0.95 : 1.25
  const D = ctx.duration
  const turnT = 1.1
  const walkT = out.length / speed
  let segs: Segment[] = [
    { kind: 'turn', dur: turnT, gait: Math.PI * TURN_STEP },
    { kind: 'walk', dur: walkT, gait: out.length },
    { kind: 'rack', dur: 0, gait: 0 },
    { kind: 'turn', dur: turnT, gait: Math.PI * TURN_STEP },
    { kind: 'walk', dur: walkT, gait: back.length },
  ]
  const moving = 2 * turnT + 2 * walkT
  const rackMin = search ? 6 : 2.2
  let total = moving + rackMin
  if (D >= total) {
    segs[2].dur = D - moving
    total = D
  } else {
    segs[2].dur = rackMin
  }
  segs = segs.map((s) => ({ ...s, dur: s.dur / total }))
  // Locate the current segment.
  let t0 = 0
  let g0 = 0
  let i = 0
  for (; i < segs.length - 1; i++) {
    if (ctx.p < t0 + segs[i].dur) break
    t0 += segs[i].dur
    g0 += segs[i].gait
  }
  const seg = segs[i]
  const x = clamp01((ctx.p - t0) / Math.max(1e-9, seg.dur))
  const part = partFor(ctx, 'walk')
  let spec = cloneSpec(NEUTRAL)
  let carry = false
  let gaitAmp = 0
  let gaitDist = g0
  let scan = search ? 1 : 0
  let heldPart = false
  if (i === 0) {
    spec.rootX = A[0]
    spec.rootZ = A[2]
    spec.yaw = lerp(0, out.head[0], smooth(x))
    gaitDist = g0 + seg.gait * smooth(x)
    gaitAmp = 0.45 * Math.sin(Math.PI * x)
    scan = 0
  } else if (i === 1 || i === 4) {
    const tb = i === 1 ? out : back
    const s = trap(x) * tb.length
    const sm = samplePath(tb, s)
    spec.rootX = sm.pos[0]
    spec.rootZ = sm.pos[2]
    spec.yaw = sm.head
    gaitDist = g0 + s
    gaitAmp = ss(0, 0.1, x) * (1 - ss(0.9, 1, x))
    carry = i === 4
    heldPart = carry
    if (i === 4) scan = 0
  } else if (i === 3) {
    spec.rootX = C[0]
    spec.rootZ = C[2]
    spec.yaw = lerp(rackYaw, back.head[0], smooth(x))
    gaitDist = g0 + seg.gait * smooth(x)
    gaitAmp = 0.45 * Math.sin(Math.PI * x)
    carry = true
    heldPart = carry
    scan = 0
  }
  const g: Gait = { phase: gaitDist / STRIDE, amp: gaitAmp, carry }
  if (i !== 2) {
    applyGait(spec, g, scan, ctx.t, ctx.k)
    // Keep the gait phase continuous for the next segment by holding stance at rest.
    const res = finishWalk(spec, sd, heldPart ? part : null)
    return { ...res, part }
  }
  // At the rack: face it, act, then hold the part.
  const at = { rootX: C[0], rootZ: C[2], yaw: rackYaw }
  const base = mk(NEUTRAL, { ...at, lean: 0.08, lookBody: true, look: [0, 1.2, -1.5] })
  const relaxHands = (s: Spec) => mk(s, { R: { ...hand([0.215, 0.84, 0], O.hang, 0.4), pole: [0.3, -0.5, 0.8], body: true }, L: { ...hand([0.215, 0.84, 0], O.hang, 0.4, true), pole: [-0.3, -0.5, 0.8], body: true } })
  const reach = (pos: V3, extra: SpecIn = {}, grip = 0.05, left = false): Spec => {
    const s = mk(base, { lookBody: true, look: [pos[0] * 0.8, pos[1] - 0.05, pos[2] - 0.2], ...extra })
    const h = { pos, fwd: [left ? 0.1 : -0.1, -0.15, -1] as V3, up: [left ? 0.6 : -0.6, 0.8, 0] as V3, grip, body: true }
    return left ? mk(relaxHands(s), { L: h }) : mk(relaxHands(s), { R: h })
  }
  const carryAt = mk(base, { ...both([0.1, 1.05, -0.36], [[-0.12, -0.1, -1], [0, 1, 0]], 0.85, true), lookBody: true, look: [0, 1.0, -0.8] })
  let keys: Key[]
  let grabAt: number
  if (!search) {
    keys = [
      [0, relaxHands(base)],
      [0.3, reach([0.1, 1.2, -0.56], { lean: 0.2 })],
      [0.42, reach([0.1, 1.18, -0.6], { lean: 0.24 }, 1)],
      [0.66, carryAt],
      [1, carryAt],
    ]
    grabAt = 0.42
  } else {
    const think = mk(relaxHands(base), { headRoll: 0.22, lookBody: true, look: [-0.5, 1.3, -1.2], R: { pos: [0.04, 1.45, -0.16], fwd: [-0.3, 0.6, -0.5], up: [-0.6, 0.3, 0.4], grip: 0.75, pole: [0.5, -0.8, 0.2], body: true } })
    keys = [
      [0, relaxHands(base)],
      [0.06, mk(relaxHands(base), { lookBody: true, look: [-0.6, 1.5, -0.6] })],
      [0.14, mk(relaxHands(base), { lookBody: true, look: [0.6, 1.5, -0.6], twist: -0.15 })],
      [0.2, mk(relaxHands(base), { lookBody: true, look: [-0.4, 1.0, -0.6], twist: 0.12 })],
      [0.27, reach([-0.24, 1.55, -0.55], { lean: 0.08, twist: 0.12 }, 0.05, true)],
      [0.32, reach([-0.24, 1.57, -0.6], { lean: 0.1, twist: 0.12 }, 0.6, true)],
      [0.38, mk(relaxHands(base), { lookBody: true, look: [-0.3, 1.4, -0.6] })],
      [0.45, think],
      [0.52, mk(think, { headRoll: -0.15, lookBody: true, look: [0.4, 0.7, -0.8] })],
      [0.6, reach([0.22, 0.62, -0.55], { lean: 0.55, drop: 0.33, hipZ: 0.05 }, 0.05)],
      [0.65, reach([0.22, 0.6, -0.6], { lean: 0.58, drop: 0.35, hipZ: 0.05 }, 0.6)],
      [0.72, mk(relaxHands(base), { lookBody: true, look: [0.3, 1.1, -0.6] })],
      [0.8, reach([0.26, 1.16, -0.56], { lean: 0.15 }, 0.05)],
      [0.86, reach([0.26, 1.14, -0.6], { lean: 0.18 }, 1)],
      [0.94, carryAt],
      [1, carryAt],
    ]
    grabAt = 0.86
  }
  spec = track(keys, x)
  // Small weight shifts while standing at the rack.
  spec.hipX += 0.02 * Math.sin(ctx.t * 0.9 + ctx.k)
  return { ...finishWalk(spec, sd, x >= grabAt ? part : null), part }
}

function finishWalk(spec: Spec, sd: number, part: PartKind | null): Omit<VerbOut, 'part'> {
  const s = sd === 1 ? spec : mirrorSpec(spec)
  const held = part ? (sd === 1 ? { L: null, R: part } : { L: part, R: null }) : { L: null, R: null }
  return { spec: s, held, tool: 'none', mirrored: sd === -1 }
}

// ---------------------------------------------------------------- idle / blocked
function verbIdle(ctx: Ctx): VerbOut {
  const t = ctx.t
  const k = ctx.k
  const shift = Math.sin(t * 0.55 + k)
  const variant = rng('idle-var', ctx.seed)() < 0.5
  const spec = mk(NEUTRAL, {
    rootZ: -0.12,
    lean: 0.03,
    hipX: 0.035 * shift,
    pelvisRoll: -0.05 * shift,
    bend: 0.03 * shift,
    footL: [-0.12, 0, 0.03],
    footR: [0.12, 0, 0.0],
    look: [1.2 * wob(t * 0.25, k), 1.2 + 0.2 * wob(t * 0.3, k + 1), -2.5],
    headRoll: 0.04 * wob(t * 0.2, k + 2),
    ...(variant
      ? {
          R: { ...hand([0.215, 0.845, -0.04], O.hang, 0.35), pole: [0.3, -0.5, 0.8], body: true },
          L: { ...hand([0.215, 0.845, -0.04], O.hang, 0.35, true), pole: [-0.3, -0.5, 0.8], body: true },
        }
      : {
          R: { pos: [0.03, 0.92, -0.2], fwd: [-0.75, -0.6, -0.1], up: [0, 0.2, -1], grip: 0.5, pole: [0.5, -0.7, 0.4], body: true },
          L: { pos: [-0.03, 0.92, -0.2], fwd: [0.8, -0.55, -0.1], up: [0, 0.2, -1], grip: 0.5, pole: [-0.5, -0.7, 0.4], body: true },
        }),
  })
  return { spec, held: { L: null, R: null }, tool: 'none', part: 'box' }
}

function verbBlocked(ctx: Ctx): VerbOut {
  const t = ctx.t
  const k = ctx.k
  const crossed = rng('blocked-var', ctx.seed)() < 0.6
  // Alternate between glaring downstream (+x) and back at the stalled unit.
  const lookDown = 0.5 + 0.5 * Math.tanh(3 * Math.sin(t * 0.45 + k))
  const look = lerpV([0.4, 0.95, -0.95], [3.5, 1.3, -1.0], lookDown)
  const shift = Math.sin(t * 0.35 + k)
  const base: SpecIn = {
    rootZ: -0.1,
    lean: -0.02,
    hipX: 0.04 * shift,
    pelvisRoll: -0.06 * shift,
    twist: -0.25 * lookDown,
    look,
    headRoll: 0.05 * shift,
    footL: [-0.14, 0, 0.02],
    footR: [0.14, 0, 0.0],
  }
  let spec: Spec
  if (crossed) {
    const br = 0.006 * Math.sin(t * 1.4)
    spec = mk(NEUTRAL, {
      ...base,
      R: { pos: [-0.13, 1.19 + br, -0.17], fwd: [-0.45, -0.25, 0.86], up: [0.2, 1, 0.1], grip: 0.55, pole: [0.4, -0.75, -0.5], body: true },
      L: { pos: [0.13, 1.15 + br, -0.13], fwd: [0.5, 0.0, 0.86], up: [0, 1, 0.1], grip: 0.55, pole: [-0.4, -0.8, -0.4], body: true },
    })
  } else {
    const tap = Math.max(0, Math.sin(t * 6)) * (Math.sin(t * 0.3 + k) > 0 ? 1 : 0)
    spec = mk(NEUTRAL, {
      ...base,
      R: { pos: [0.19, 1.0, 0.02], fwd: [0.1, -0.5, 0.86], up: [0, -0.86, -0.5], grip: 0.5, pole: [1, 0, 0.25], body: true },
      L: { pos: [-0.19, 1.0, 0.02], fwd: [-0.1, -0.5, 0.86], up: [0, -0.86, -0.5], grip: 0.5, pole: [-1, 0, 0.25], body: true },
      footPitchR: tap * 0.25,
    })
  }
  return { spec, held: { L: null, R: null }, tool: 'none', part: 'box' }
}

// ---------------------------------------------------------------- solver
const ONE = new Vector3(1, 1, 1)
const _m = new Matrix4()
const _e = new Euler()

function qEuler(x: number, y: number, z: number): Quaternion {
  return new Quaternion().setFromEuler(_e.set(x, y, z, 'YXZ'))
}
function basisQ(X: V3, Y: V3, Z: V3): Quaternion {
  _m.makeBasis(new Vector3(...X), new Vector3(...Y), new Vector3(...Z))
  return new Quaternion().setFromRotationMatrix(_m)
}
/** Hand world rotation from finger direction f and thumb direction t. */
function handQ(f: V3, t: V3): Quaternion {
  const fn = norm(f)
  const Y = mul(fn, -1)
  const Z = mul(orth(t, fn, Math.abs(fn[2]) < 0.9 ? [0, 0, -1] : [1, 0, 0]), -1)
  const X = cross(Y, Z)
  return basisQ(X, Y, Z)
}
const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]
const qa = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w]
const local = (parentWorld: Quaternion, world: Quaternion) => parentWorld.clone().invert().multiply(world)

interface Chain {
  E: V3
  W: V3
  X: V3
  info: IKInfo
}
function twoBone(S: V3, T: V3, L1: number, L2: number, polePt: V3, sign: 1 | -1): Chain {
  const ST = sub(T, S)
  const d = len(ST)
  const u = d > 1e-6 ? mul(ST, 1 / d) : ([0, -1, 0] as V3)
  const max = (L1 + L2) * 0.9995
  const min = Math.abs(L1 - L2) + 0.02
  const dc = clamp(d, min, max)
  const a = (L1 * L1 - L2 * L2 + dc * dc) / (2 * dc)
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
  let v = orth(sub(polePt, S), u, [2, 2, 2])
  if (v[0] === 2) v = orth([0, 0, sign], u, [1, 0, 0])
  const E = add(add(S, mul(u, a)), mul(v, h))
  const W = add(S, mul(u, dc))
  const X = mul(norm(cross(v, u), [1, 0, 0]), sign)
  return { E, W, X, info: { target: T, dist: d, reach: L1 + L2, clamped: d > max || d < min } }
}
function boneQ(from: V3, to: V3, X: V3): Quaternion {
  const Y = mul(norm(sub(to, from), [0, -1, 0]), -1)
  const Xo = orth(X, Y, [1, 0, 0])
  const Z = cross(Xo, Y)
  return basisQ(Xo, Y, Z)
}

interface Solved {
  joints: Record<BoneName, Quat>
  hips: V3
  ik: Pose['ik']
  grip: { L: number[]; R: number[] }
  eye: V3
}

function solve(spec: Spec, s: number, breath: number): Solved {
  const yaw = spec.yaw
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const toRig = (v: V3): V3 => {
    const dx = v[0] - spec.rootX
    const dz = v[2] - spec.rootZ
    return [(dx * cy - dz * sy) / s, v[1] / s, (dx * sy + dz * cy) / s]
  }
  const dirBody = (v: V3): V3 => [v[0] * cy - v[2] * sy, v[1], v[0] * sy + v[2] * cy]

  const lean = spec.lean
  const hips: V3 = [spec.hipX / s, RIG.hipsY - spec.drop / s, (spec.hipZ + lean * 0.09) / s]
  const qH = qEuler(-lean * 0.3, spec.pelvisYaw, spec.pelvisRoll)
  const qS = qEuler(-lean * 0.35 - breath * 0.4, spec.twist * 0.4, spec.bend * 0.5)
  const qC = qEuler(-lean * 0.35 + breath, spec.twist * 0.6, spec.bend * 0.5)
  const L = (off: V3, q: Quaternion) => new Matrix4().compose(new Vector3(...off), q, ONE)
  const Mh = L(hips, qH)
  const Ms = Mh.clone().multiply(L(RIG.spine, qS))
  const Mc = Ms.clone().multiply(L(RIG.chest, qC))
  const Wh = qH.clone()
  const Wc = qH.clone().multiply(qS).multiply(qC)

  const joints = {} as Record<BoneName, Quat>
  joints.hips = qa(qH)
  joints.spine = qa(qS)
  joints.chest = qa(qC)
  const ik = {} as Pose['ik']
  const grip = {} as Solved['grip']
  const sToStation = new Matrix4().compose(new Vector3(spec.rootX, 0, spec.rootZ), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(s, s, s))
  const gripFrame = (side: Side) => new Matrix4().compose(new Vector3(RIG.grip[0] * palmSide(side), RIG.grip[1], RIG.grip[2]), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), ONE)

  for (const side of [1, -1] as Side[]) {
    const nm = side === 1 ? 'R' : 'L'
    const hs = spec[nm]
    const qSh = qEuler(0, 0, side * spec.shrug * 0.22)
    const Msh = Mc.clone().multiply(L([side * RIG.shoulder[0], RIG.shoulder[1], RIG.shoulder[2]], qSh))
    const Wsh = Wc.clone().multiply(qSh)
    const S = v3(new Vector3(side * RIG.upperArm[0], RIG.upperArm[1], RIG.upperArm[2]).applyMatrix4(Msh))
    const Hq = handQ(dirBody(hs.fwd), dirBody(hs.up))
    const G = toRig(hs.pos)
    const gl = new Vector3(RIG.grip[0] * palmSide(side), RIG.grip[1], RIG.grip[2]).applyQuaternion(Hq)
    const Wt = sub(G, v3(gl))
    const pole = add(S, mul(norm(hs.pole, [side * 0.5, -0.6, 0.6]), 0.5))
    const ch = twoBone(S, Wt, RIG.upperArmLen, RIG.lowerArmLen, pole, 1)
    const q1 = boneQ(S, ch.E, ch.X)
    const q2 = boneQ(ch.E, ch.W, ch.X)
    joints[side === 1 ? 'shoulderR' : 'shoulderL'] = qa(qSh)
    joints[side === 1 ? 'upperArmR' : 'upperArmL'] = qa(local(Wsh, q1))
    joints[side === 1 ? 'lowerArmR' : 'lowerArmL'] = qa(local(q1, q2))
    joints[side === 1 ? 'handR' : 'handL'] = qa(local(q2, Hq))
    ik[nm] = ch.info
    const Mhand = new Matrix4().compose(new Vector3(...ch.W), Hq, ONE)
    grip[nm] = sToStation.clone().multiply(Mhand).multiply(gripFrame(side)).toArray()

    // Legs.
    const Hp = v3(new Vector3(side * RIG.upperLeg[0], RIG.upperLeg[1], RIG.upperLeg[2]).applyMatrix4(Mh))
    const ft = side === 1 ? spec.footR : spec.footL
    const A: V3 = [ft[0] / s, RIG.ankleH + ft[1] / s, ft[2] / s]
    const kp = add(Hp, mul(rotY([side * 0.12, 0, -1], spec.pelvisYaw * 0.5), 0.5))
    const lg = twoBone(Hp, A, RIG.upperLegLen, RIG.lowerLegLen, kp, -1)
    const l1 = boneQ(Hp, lg.E, lg.X)
    const l2 = boneQ(lg.E, lg.W, lg.X)
    const fq = qEuler(side === 1 ? spec.footPitchR : spec.footPitchL, -side * 0.1 + spec.pelvisYaw * 0.3, 0)
    joints[side === 1 ? 'upperLegR' : 'upperLegL'] = qa(local(Wh, l1))
    joints[side === 1 ? 'lowerLegR' : 'lowerLegL'] = qa(local(l1, l2))
    joints[side === 1 ? 'footR' : 'footL'] = qa(local(l2, fq))
    ik[side === 1 ? 'legR' : 'legL'] = lg.info
  }

  // Head look-at, split between neck and head.
  const Mn = Mc.clone().multiply(L(RIG.neck, new Quaternion()))
  const neckPos = new Vector3().setFromMatrixPosition(Mn)
  const lookRig = new Vector3(...toRig(spec.look))
  const dirC = lookRig.sub(neckPos).applyQuaternion(Wc.clone().invert())
  let ly = Math.atan2(-dirC.x, -dirC.z)
  let lp = Math.atan2(dirC.y, Math.hypot(dirC.x, dirC.z))
  if (!Number.isFinite(ly)) ly = 0
  if (!Number.isFinite(lp)) lp = 0
  ly = clamp(ly, -1.3, 1.3)
  lp = clamp(lp, -1.15, 0.7)
  // Rebuild the clamped gaze in body frame and keep the head's horizon level (plus roll),
  // so the first-person camera does not tilt when the torso leans and twists.
  const cp = Math.cos(lp)
  const gazeC = new Vector3(-Math.sin(ly) * cp, Math.sin(lp), -Math.cos(ly) * cp)
  const gaze = v3(gazeC.applyQuaternion(Wc))
  const Zh = mul(gaze, -1)
  const upW = rot([0, 1, 0], gaze, -spec.headRoll)
  const Xh = norm(cross(upW, Zh), [1, 0, 0])
  const Yh = cross(Zh, Xh)
  const qWant = basisQ(Xh, Yh, Zh)
  const total = local(Wc, qWant)
  const qN = new Quaternion().slerp(total, 0.4)
  const qHd = local(qN, total)
  joints.neck = qa(qN)
  joints.head = qa(qHd)
  const Mhd = Mc.clone().multiply(L(RIG.neck, qN)).multiply(L(RIG.head, qHd))
  const eye = v3(new Vector3(...RIG.eye).applyMatrix4(Mhd).applyMatrix4(sToStation))
  return { joints, hips, ik, grip, eye }
}

// ---------------------------------------------------------------- entry
const DEFAULT_DURATION: Partial<Record<WorkerVerb, number>> = { walk: 12, search: 22 }

function sanitizeSpec(s: Spec): Spec {
  const o = cloneSpec(s)
  for (const k of Object.keys(o) as (keyof Spec)[]) {
    const v = o[k]
    if (typeof v === 'number') (o as unknown as Record<string, number>)[k] = fin(v)
  }
  const fv = (v: V3, d: V3): V3 => [fin(v[0], d[0]), fin(v[1], d[1]), fin(v[2], d[2])]
  for (const h of ['R', 'L'] as const) {
    const n = NEUTRAL[h]
    o[h] = { pos: fv(o[h].pos, n.pos), fwd: fv(o[h].fwd, n.fwd), up: fv(o[h].up, n.up), grip: clamp01(fin(o[h].grip, 0.3)), pole: fv(o[h].pole, n.pole) }
  }
  o.look = fv(o.look, NEUTRAL.look)
  o.footL = fv(o.footL, NEUTRAL.footL)
  o.footR = fv(o.footR, NEUTRAL.footR)
  return o
}

function runVerb(verb: WorkerVerb, ctx: Ctx): VerbOut {
  switch (verb) {
    case 'pick':
      return verbPick(ctx)
    case 'place':
      return verbPlace(ctx)
    case 'insert':
      return verbInsert(ctx)
    case 'screw':
      return verbScrew(ctx)
    case 'connect':
      return verbConnect(ctx)
    case 'braze':
      return verbBraze(ctx)
    case 'inspect':
      return verbInspect(ctx)
    case 'walk':
      return verbWalk(ctx, false)
    case 'search':
      return verbWalk(ctx, true)
    case 'blocked':
      return verbBlocked(ctx)
    case 'idle':
    default:
      return verbIdle(ctx)
  }
}

function finiteArr(a: number[], d: number[]): number[] {
  return a.every(Number.isFinite) ? a : d
}

/**
 * Pure pose function. Same inputs always give the same pose.
 * - verb/phase drive the action; phase 0 and 1 ease to a neutral stance so op boundaries do not pop.
 * - simTime drives only jitter, flame flicker, breathing and idle/blocked motion.
 */
export function poseWorker(verb: WorkerVerb, phase: number, params: PoseParams): Pose {
  const p = clamp01(fin(phase))
  const look = workerLook(params.seed)
  const height = params.height && Number.isFinite(params.height) ? clamp(params.height, 1.4, 2.1) : look.height
  const s = height / RIG.height
  const simTime = fin(params.simTime)
  const cycle = fin(params.cycle)
  const k = rng('wk', params.seed, cycle)() * 100
  const duration = params.duration && params.duration > 0 && Number.isFinite(params.duration) ? params.duration : DEFAULT_DURATION[verb] ?? 10
  const ctx: Ctx = { p, t: simTime, seed: params.seed, cycle, tool: params.tool ?? 'none', duration, r: rng('ctx', params.seed, cycle, verb), k, rack: params.rack && params.rack.every(Number.isFinite) ? params.rack : undefined }
  const out = runVerb(verb, ctx)
  const breath = 0.018 * Math.sin((simTime * 2 * Math.PI) / (3.6 + (k % 1)) + k)
  const spec = sanitizeSpec(out.spec)
  const sol = solve(spec, s, breath)

  // Released parts stay where the hand let go of them.
  const placed: PlacedPart[] = []
  if (out.release && out.at) {
    for (const r of out.release) {
      if (p < r.at) continue
      const hs = sanitizeSpec(out.at(r.at))
      const so = solve(hs, s, 0)
      const handName = out.mirrored ? (r.hand === 'R' ? 'L' : 'R') : r.hand
      placed.push({ kind: r.kind, side: handName === 'R' ? 1 : -1, matrix: so.grip[handName] })
    }
  }

  // Finger curls: base from grip, overridden per verb.
  const fingersFor = (g: number, o?: number[]) => (o && o.length === 5 ? o : [g * 0.8, g, g, g, g]).map((c) => clamp01(fin(c)))
  let fL = out.fingers?.L
  let fR = out.fingers?.R
  if (out.mirrored) [fL, fR] = [fR, fL]
  const fingers = { L: fingersFor(spec.L.grip, fL), R: fingersFor(spec.R.grip, fR) }

  const fx = {
    spin: fin(out.fx?.spin ?? 0),
    flame: clamp01(fin(out.fx?.flame ?? 0)),
    scan: clamp01(fin(out.fx?.scan ?? 0)),
    squeeze: clamp01(fin(out.fx?.squeeze ?? 0)),
  }
  const joints = {} as Record<BoneName, Quat>
  for (const b of BONES) joints[b] = finiteArr(sol.joints[b] ?? [0, 0, 0, 1], [0, 0, 0, 1]) as Quat
  const ID = new Matrix4().toArray()
  return {
    verb,
    root: { x: spec.rootX, z: spec.rootZ, yaw: spec.yaw },
    scale: s,
    hips: finiteArr(sol.hips, [0, RIG.hipsY, 0]) as V3,
    joints,
    fingers,
    held: out.held,
    tool: out.tool,
    part: out.part,
    placed,
    fx,
    ik: sol.ik,
    grip: { L: finiteArr(sol.grip.L, ID), R: finiteArr(sol.grip.R, ID) },
    eye: finiteArr(sol.eye, [0, 1.65, 0]) as V3,
  }
}

/** Default tool for a verb when the operation says 'none'. */
export function defaultToolFor(verb: WorkerVerb): ToolKind {
  return verb === 'screw' ? 'torque_driver' : verb === 'braze' ? 'torch' : verb === 'inspect' ? 'scanner' : 'none'
}
