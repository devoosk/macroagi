import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Line } from '../contracts/types'
import { isCapture } from '../lib/mode'
import { getIndex, unitPositionAt } from '../playback/index'
import { lineBounds, stationAnchor, unitAnchor, type Vec3 } from '../playback/layout'
import { usePlayback, type DesignKey } from '../playback/store'
import type { UnitPosition } from '../playback/types'
import { useDirector } from './director'

export interface CameraDirectorProps {
  /** Design whose line/log drives fly-to and follow (from the playback store). Default 'current'. */
  design?: DesignKey
  /** Override for the world position of a unit (defaults to the station-anchor lerp at y = `unitHeight`). */
  unitPosition?: (line: Line, u: UnitPosition) => Vec3
  unitHeight?: number
  /** Camera offset from a station when flying to it. */
  stationOffset?: Vec3
  /** Cameras with the same key mirror each other's orbit (split view). */
  syncKey?: string
  /** Tween stiffness (1/s). */
  stiffness?: number
}

interface SyncSlot {
  pos: THREE.Vector3
  target: THREE.Vector3
  owner: symbol | null
}
const syncSlots = new Map<string, SyncSlot>()

/**
 * Demo camera: orbit view, fly-to-station (from status chips / 3D tags) and follow-unit.
 * Camera motion is UI, not scene state, so it tweens on real time; disabled in capture mode.
 */
export function CameraDirector(props: CameraDirectorProps) {
  if (isCapture) return null
  return <Director {...props} />
}

function Director({ design = 'current', unitPosition, unitHeight = 1.0, stationOffset = [3.5, 5.5, 10], syncKey, stiffness = 3.5 }: CameraDirectorProps) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const line = usePlayback((s) => s.lines[design])
  const me = useRef(Symbol('director'))
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const userActive = useRef(false)

  const size = useThree((s) => s.size)
  const overviewPose = useMemo(() => {
    if (!line) return { pos: new THREE.Vector3(4, 8, 14), target: new THREE.Vector3(4, 0, 0) }
    return fitOverview(line, camera, size.width / Math.max(1, size.height))
  }, [line, camera, size.width, size.height])
  const poseRef = useRef(overviewPose)
  poseRef.current = overviewPose

  // Initial pose (per line); resizes only change where "Overview" flies to.
  useEffect(() => {
    camera.position.copy(poseRef.current.pos)
    controls.current?.target.copy(poseRef.current.target)
    controls.current?.update()
  }, [camera, line])

  // React to director requests.
  const seq = useDirector((s) => s.seq)
  useEffect(() => {
    const d = useDirector.getState()
    if (!line) return
    if (d.mode === 'overview') goal.current = { pos: overviewPose.pos.clone(), target: overviewPose.target.clone() }
    else if (d.mode === 'station' && d.station) {
      const s = line.stations.find((x) => x.id === d.station)
      if (!s) return
      const t = new THREE.Vector3(s.x, 0.8, s.y)
      goal.current = { pos: t.clone().add(new THREE.Vector3(...stationOffset)), target: t }
    } else goal.current = null
    const slot = syncKey ? syncSlots.get(syncKey) : undefined
    if (slot) slot.owner = null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offset compared by value
  }, [seq, line, overviewPose, stationOffset.join(','), syncKey])

  const tmp = useMemo(() => ({ target: new THREE.Vector3(), offset: new THREE.Vector3() }), [])

  useFrame((_, rdt) => {
    const c = controls.current
    if (!c || !line) return
    const dt = Math.min(rdt, 0.1)
    const k = 1 - Math.exp(-stiffness * dt)
    const d = useDirector.getState()

    if (d.mode === 'follow') {
      const s = usePlayback.getState()
      const log = s.logs[design]
      if (log) {
        const index = getIndex(line, log)
        let u = d.unit ? index.unitById.get(d.unit) : undefined
        let p = u ? unitPositionAt(index, u, s.simTime) : null
        if (!p) {
          // Lost (not yet entered / left the line): pick the newest unit on the line.
          for (let i = index.units.length - 1; i >= 0 && !p; i--) {
            const cand = index.units[i]
            if (cand.enter > s.simTime) continue
            p = unitPositionAt(index, cand, s.simTime)
            if (p) u = cand
          }
          if (u && u.unit !== d.unit) d.setFollowed(u.unit)
        }
        if (p) {
          const w = unitPosition ? unitPosition(line, p) : unitAnchor(line, p)
          tmp.target.set(w[0], unitPosition ? w[1] : unitHeight, w[2])
          tmp.offset.copy(camera.position).sub(c.target)
          if (tmp.offset.length() > 14 || tmp.offset.length() < 3) tmp.offset.setLength(8)
          c.target.lerp(tmp.target, k)
          camera.position.copy(c.target).add(tmp.offset)
        }
      }
    } else if (goal.current && !userActive.current) {
      camera.position.lerp(goal.current.pos, k)
      c.target.lerp(goal.current.target, k)
      if (camera.position.distanceTo(goal.current.pos) < 0.01 && c.target.distanceTo(goal.current.target) < 0.01) goal.current = null
    }

    // Split-view sync: whoever the user last touched leads; the others mirror.
    if (syncKey && d.mode !== 'follow') {
      let slot = syncSlots.get(syncKey)
      if (!slot) syncSlots.set(syncKey, (slot = { pos: new THREE.Vector3(), target: new THREE.Vector3(), owner: null }))
      if (slot.owner === me.current) {
        slot.pos.copy(camera.position)
        slot.target.copy(c.target)
      } else if (slot.owner) {
        camera.position.copy(slot.pos)
        c.target.copy(slot.target)
      }
    }
    c.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI * 0.47}
      minDistance={2}
      maxDistance={120}
      onStart={() => {
        userActive.current = true
        goal.current = null
        if (syncKey) {
          const slot = syncSlots.get(syncKey)
          if (slot) slot.owner = me.current
          else syncSlots.set(syncKey, { pos: camera.position.clone(), target: controls.current!.target.clone(), owner: me.current })
        }
      }}
      onEnd={() => {
        userActive.current = false
      }}
    />
  )
}

/** Overview pose that fits the whole line horizontally for the given aspect ratio. */
export function fitOverview(line: Line, camera: THREE.Camera, aspect: number) {
  const [x0, x1, z0, z1] = lineBounds(line)
  const target = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2)
  const vfov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
  const halfW = (x1 - x0) / 2 + 2.5
  const halfD = (z1 - z0) / 2 + 3
  const dist = Math.max(halfW / Math.tan(hfov / 2), halfD / Math.tan(vfov / 2), 9) * 1.02
  const dir = new THREE.Vector3(-0.06, 0.58, 0.81).normalize()
  return { pos: target.clone().addScaledVector(dir, dist), target }
}

/** Fly-to target for a station (world space), exported for reuse. */
export function stationFocus(line: Line, station: string): Vec3 {
  const a = stationAnchor(line, station)
  return [a[0], 0.8, a[2]]
}
