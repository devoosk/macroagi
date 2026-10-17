import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { getT } from './clock'
import { T, ease, hash, lerp, seg } from './theme'

const N = 420
const DOTS = 3
const CENTER = new Vector3(25.5, -1.5, -1.5)
const R = 21
/** The globe sits up and to the right so the closing words have room. */
const GLOBE = new Vector3(41, 5, -8)
const W0 = T.world[0]
/** Phases: the line becomes a department, a factory, many factories; then they wrap into a globe. */
const P = { tile: [W0 + 0.4, W0 + 3.4], wrap: [W0 + 3.2, W0 + 6.4] } as const
const o3 = new Object3D()
const up = new Vector3(0, 1, 0)
const q = new Quaternion()
const v = new Vector3()
const n = new Vector3()
const col = new Color()

interface Tile {
  grid: Vector3
  sphere: Vector3
  normal: Vector3
  ring: number
}

function tiles(): Tile[] {
  // Grid cells ordered by ring distance from the real line (ring 0 is the line itself).
  const cells: { gx: number; gz: number; ring: number }[] = []
  for (let gx = -7; gx <= 7; gx++) for (let gz = -9; gz <= 9; gz++) cells.push({ gx, gz, ring: Math.max(Math.abs(gx), Math.abs(gz) * 0.8) })
  cells.sort((a, b) => a.ring - b.ring || hash(a.gx * 31 + a.gz) - hash(b.gx * 31 + b.gz))
  // Fibonacci sphere, the points facing the camera first so the grid lands on the visible side.
  const view = new Vector3(0.62, 0.95, 1.45).normalize()
  const pts: Vector3[] = []
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N
    const r = Math.sqrt(1 - y * y)
    const a = i * Math.PI * (3 - Math.sqrt(5))
    pts.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r))
  }
  pts.sort((a, b) => b.dot(view) - a.dot(view))
  return pts.map((p, i) => {
    const c = cells[i]
    const grid = c ? new Vector3(CENTER.x + c.gx * 62, CENTER.y, CENTER.z + c.gz * 19) : new Vector3().copy(p).multiplyScalar(R * 3).add(CENTER)
    return { grid, sphere: p.clone().multiplyScalar(R).add(GLOBE), normal: p.clone(), ring: c ? c.ring : 99 }
  })
}

/** Beat 4: a world of Atlases. One redesigned line tiles out into factories that wrap into a glowing globe. */
export function World() {
  const fill = useRef<InstancedMesh>(null)
  const rim = useRef<InstancedMesh>(null)
  const dots = useRef<InstancedMesh>(null)
  const list = useMemo(tiles, [])
  const geo = useMemo(() => new BoxGeometry(58, 0.3, 15), [])
  const rimGeo = useMemo(() => new BoxGeometry(58.5, 0.2, 15.5), [])
  const dotGeo = useMemo(() => new BoxGeometry(1.3, 1.3, 1.3), [])
  const fillMat = useMemo(() => new MeshBasicMaterial({ color: '#0c0c0c' }), [])
  const rimMat = useMemo(() => new MeshBasicMaterial({ color: '#d0d0d0' }), [])
  const dotMat = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  useFrame(() => {
    const t = getT()
    const on = t > W0
    for (const m of [fill.current, rim.current, dots.current]) if (m) m.visible = on
    if (!on || !fill.current || !rim.current || !dots.current) return
    const wrap = ease(seg(t, P.wrap[0], P.wrap[1]))
    const spin = Math.max(0, t - P.wrap[0]) * 0.12
    q.setFromAxisAngle(up, spin)
    list.forEach((tile, i) => {
      const appear = tile.ring < 99 ? ease(seg(t, P.tile[0] + tile.ring * 0.38, P.tile[0] + tile.ring * 0.38 + 0.5)) : ease(seg(t, P.wrap[0] + 0.6, P.wrap[1]))
      n.copy(tile.normal).applyQuaternion(q)
      v.copy(tile.sphere).sub(GLOBE).applyQuaternion(q).add(GLOBE)
      o3.position.copy(tile.grid).lerp(v, wrap)
      o3.quaternion.setFromUnitVectors(up, n).slerp(new Quaternion(), 1 - wrap)
      const s = lerp(1, 0.058, wrap) * appear
      o3.scale.setScalar(Math.max(1e-4, s))
      o3.updateMatrix()
      fill.current!.setMatrixAt(i, o3.matrix)
      o3.position.addScaledVector(n.clone().lerp(up, 1 - wrap), -0.06 * s)
      o3.updateMatrix()
      rim.current!.setMatrixAt(i, o3.matrix)
      // Units glowing as they flow down each line.
      for (let d = 0; d < DOTS; d++) {
        const u = ((t * 0.35 + d / DOTS + hash(i)) % 1) - 0.5
        const local = new Vector3(u * 52, 1.5, (hash(i * 3 + d) - 0.5) * 6).multiplyScalar(s)
        local.applyQuaternion(o3.quaternion)
        o3.position.copy(tile.grid).lerp(v, wrap).add(local)
        o3.updateMatrix()
        dots.current!.setMatrixAt(i * DOTS + d, o3.matrix)
        dots.current!.setColorAt(i * DOTS + d, col.setScalar(appear * (1.2 + 0.8 * Math.sin(t * 4 + i + d))))
      }
    })
    for (const m of [fill.current, rim.current, dots.current]) m.instanceMatrix.needsUpdate = true
    if (dots.current.instanceColor) dots.current.instanceColor.needsUpdate = true
  })
  return (
    <>
      <instancedMesh ref={rim} args={[rimGeo, rimMat, N]} frustumCulled={false} />
      <instancedMesh ref={fill} args={[geo, fillMat, N]} frustumCulled={false} />
      <instancedMesh ref={dots} args={[dotGeo, dotMat, N * DOTS]} frustumCulled={false} />
    </>
  )
}
