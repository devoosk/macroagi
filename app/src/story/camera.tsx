import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { getT } from './clock'
import { ease } from './theme'

/** Isometric view direction, like MicroAGI's line drawings. */
const DIR = new Vector3(0.62, 0.95, 1.45).normalize()

/** [time, target x, y, z, visible world width]. Eased between keys. */
const KEYS: [number, number, number, number, number][] = [
  [0, 16, 3, 0, 44],
  [6.5, 18, 3, 0, 48],
  [7.6, 25.5, 1, -0.5, 56],
  [11.5, 25.5, 1, -0.5, 54],
  [13.5, 25.5, 3.5, 0, 74],
  [18.5, 25.5, 4, 0, 72],
  [24.5, 25.5, 3, 0, 68],
  [26.5, 25.5, 1, 0, 62],
  [30.5, 25.5, 3.5, 0, 70],
  [38.5, 25.5, 1, 0, 60],
  [44.5, 25.5, 1, 0, 58],
  [46, 25.5, -2.5, 3, 66],
  [50.5, 25.5, -2.5, 3, 66],
  [53.5, 25.5, 0, 0, 170],
  [57, 30, 2, -3, 104],
  [60, 30, 2, -3, 98],
]

const target = new Vector3()

export function camAt(t: number): [number, number, number, number] {
  let i = 0
  while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const k = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))))
  return [1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * k) as [number, number, number, number]
}

export function CameraRig() {
  const { camera, size } = useThree()
  useFrame(() => {
    const [x, y, z, w] = camAt(getT())
    target.set(x, y, z)
    camera.position.copy(target).addScaledVector(DIR, 200)
    camera.lookAt(target)
    camera.zoom = size.width / w
    camera.updateProjectionMatrix()
  })
  return null
}
