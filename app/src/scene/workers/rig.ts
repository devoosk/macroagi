// Reference rig for a 1.75 m worker (metres, Y up, facing -z, the worker's right is +x).
// Every bone's rest rotation is identity: arms hang down with the thumbs forward,
// legs hang down and feet point forward. The whole rig is scaled uniformly by
// `look.scale` for taller or shorter workers.

export type V3 = [number, number, number]
export type Quat = [number, number, number, number]

export const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'lowerArmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'lowerArmR',
  'handR',
  'upperLegL',
  'lowerLegL',
  'footL',
  'upperLegR',
  'lowerLegR',
  'footR',
] as const
export type BoneName = (typeof BONES)[number]

/** Side sign: right = +1 (+x), left = -1. */
export type Side = 1 | -1

export const RIG = {
  height: 1.75,
  hipsY: 0.97,
  spine: [0, 0.1, 0] as V3,
  chest: [0, 0.17, 0] as V3,
  neck: [0, 0.235, 0] as V3,
  head: [0, 0.1, 0] as V3,
  /** Shoulder (clavicle) offset from chest; x is multiplied by side. */
  shoulder: [0.035, 0.185, 0] as V3,
  /** Upper-arm joint offset from shoulder; x multiplied by side. */
  upperArm: [0.15, 0, 0] as V3,
  upperArmLen: 0.29,
  lowerArmLen: 0.255,
  /** Upper-leg joint offset from hips; x multiplied by side. */
  upperLeg: [0.09, -0.065, 0] as V3,
  upperLegLen: 0.43,
  lowerLegLen: 0.415,
  /** Ankle height above the sole when the foot is flat. */
  ankleH: 0.07,
  /** Grip point in hand-bone space. x is multiplied by palmSide (= -side). */
  grip: [0.026, -0.088, 0] as V3,
  /** First-person camera point in head-bone space (just in front of the safety glasses). */
  eye: [0, 0.078, -0.125] as V3,
}

/** Palm-normal sign along the hand's local x axis: right palm faces -x, left palm faces +x. */
export const palmSide = (side: Side): Side => (side === 1 ? -1 : 1)
