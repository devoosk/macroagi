import { describe, expect, it } from 'vitest'
import type { ToolKind } from '../../contracts/types'
import { EYE_MIN_Z, poseWorker, type Pose, type WorkerVerb } from './pose'
import { workerLook } from './look'
import { BONES, RIG } from './rig'

const VERBS: WorkerVerb[] = ['pick', 'place', 'insert', 'screw', 'connect', 'braze', 'inspect', 'walk', 'search', 'idle', 'blocked']
const PHASES = [0, 0.25, 0.5, 0.75, 1]
const TOOLS: ToolKind[] = ['none', 'screwdriver', 'torque_driver', 'torch', 'crimper', 'scanner', 'hose', 'strapper']

function allNumbers(pose: Pose): number[] {
  const out: number[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(pose)
  return out
}

function checkPose(pose: Pose) {
  for (const n of allNumbers(pose)) expect(Number.isFinite(n)).toBe(true)
  for (const b of BONES) {
    const q = pose.joints[b]
    expect(q).toHaveLength(4)
    expect(Math.hypot(...q)).toBeCloseTo(1, 4)
  }
  // IK: either the target is within the chain length, or the solver reports clamping.
  const armReach = RIG.upperArmLen + RIG.lowerArmLen
  const legReach = RIG.upperLegLen + RIG.lowerLegLen
  for (const [k, reach] of [['L', armReach], ['R', armReach], ['legL', legReach], ['legR', legReach]] as const) {
    const info = pose.ik[k]
    expect(info.reach).toBeCloseTo(reach, 6)
    if (!info.clamped) expect(info.dist).toBeLessThanOrEqual(reach)
  }
  for (const f of [...pose.fingers.L, ...pose.fingers.R]) {
    expect(f).toBeGreaterThanOrEqual(0)
    expect(f).toBeLessThanOrEqual(1)
  }
}

describe('poseWorker', () => {
  for (const verb of VERBS) {
    describe(verb, () => {
      for (const phase of PHASES) {
        it(`phase ${phase}: finite, normalised, IK reachable or clamped`, () => {
          for (const seed of ['a', 'S05', 'worker-7']) {
            for (const cycle of [0, 3]) {
              checkPose(poseWorker(verb, phase, { seed, cycle, simTime: 12.34 + phase * 5 }))
            }
          }
        })
      }
      it('is deterministic for the same input', () => {
        for (const phase of PHASES) {
          const a = poseWorker(verb, phase, { seed: 'det', cycle: 2, simTime: 7.5 })
          const b = poseWorker(verb, phase, { seed: 'det', cycle: 2, simTime: 7.5 })
          expect(JSON.stringify(a)).toBe(JSON.stringify(b))
        }
      })
      it('starts and ends near the neutral stance (no pop at op boundaries)', () => {
        if (verb === 'idle' || verb === 'blocked') return
        const a = poseWorker(verb, 0, { seed: 's', cycle: 1, simTime: 0 })
        const b = poseWorker(verb, 1, { seed: 's', cycle: 1, simTime: 0 })
        expect(Math.hypot(a.root.x, a.root.z + 0.15)).toBeLessThan(0.05)
        expect(Math.hypot(b.root.x, b.root.z + 0.15)).toBeLessThan(0.05)
        expect(Math.abs(Math.sin(b.root.yaw))).toBeLessThan(0.05)
      })
    })
  }

  it('handles every tool and bad inputs without NaN', () => {
    for (const verb of VERBS) {
      for (const tool of TOOLS) {
        for (const phase of [-1, 0.33, 2, NaN]) {
          checkPose(poseWorker(verb, phase, { seed: 'x', cycle: 1, simTime: NaN, tool, duration: tool === 'hose' ? 3 : undefined }))
        }
      }
    }
  })

  it('is continuous in phase (no large jumps between nearby phases)', () => {
    for (const verb of VERBS) {
      let prev = poseWorker(verb, 0, { seed: 'c', cycle: 0, simTime: 0 })
      for (let i = 1; i <= 200; i++) {
        const p = i / 200
        const cur = poseWorker(verb, p, { seed: 'c', cycle: 0, simTime: p * 10 })
        expect(Math.hypot(cur.root.x - prev.root.x, cur.root.z - prev.root.z)).toBeLessThan(0.25)
        prev = cur
      }
    }
  })

  it('walk and search leave the station and come back', () => {
    for (const verb of ['walk', 'search'] as const) {
      const mid = poseWorker(verb, 0.5, { seed: 'w', cycle: 0, simTime: 0 })
      expect(Math.hypot(mid.root.x, mid.root.z)).toBeGreaterThan(2)
      expect(Math.hypot(mid.root.x, mid.root.z)).toBeLessThan(4.5)
    }
  })

  it('is cheap enough to run every frame for a full line', () => {
    const t0 = performance.now()
    const frames = 120
    for (let f = 0; f < frames; f++) for (const v of VERBS) poseWorker(v, (f % 100) / 100, { seed: 's' + v, cycle: 1, simTime: f / 60 })
    const perFrame = (performance.now() - t0) / frames
    console.log(`poseWorker: ${perFrame.toFixed(3)} ms per frame for ${VERBS.length} workers`)
    expect(perFrame).toBeLessThan(20)
  })

  it('workerLook is deterministic and in range', () => {
    for (let i = 0; i < 200; i++) {
      const l = workerLook('seed-' + i)
      expect(l.height).toBeGreaterThanOrEqual(1.62)
      expect(l.height).toBeLessThanOrEqual(1.92)
      expect(workerLook('seed-' + i)).toEqual(l)
    }
  })
})

describe('eye standoff from the work', () => {
  // The first-person camera rides the eye; leaning it into the open unit made the braze view unreadable.
  it('keeps the eye at least EYE_STANDOFF from the unit face in every verb', () => {
    for (const verb of VERBS) {
      for (const tool of ['none', 'torch', 'scanner', 'hose', 'torque_driver'] as ToolKind[]) {
        for (let i = 0; i <= 50; i++) {
          for (const seed of ['line_current:S04', 'line_current:S07', 'line_redesign_1:S05']) {
            const pose = poseWorker(verb, i / 50, { seed, cycle: i % 7, simTime: 2400 + i * 1.3, tool })
            expect(pose.eye[2]).toBeGreaterThanOrEqual(EYE_MIN_Z - 2e-3)
          }
        }
      }
    }
  })
})
