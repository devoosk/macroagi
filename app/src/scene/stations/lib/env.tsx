import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Procedural image-based lighting (no downloads): a PMREM of three's RoomEnvironment.
 * Metals (steel, copper, aluminium fins) need an environment map to read as metal.
 */
export function ProceduralEnvironment({ intensity = 0.55 }: { intensity?: number }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    const prev = scene.environment
    scene.environment = env
    scene.environmentIntensity = intensity
    return () => {
      scene.environment = prev
      env.dispose()
      pm.dispose()
    }
  }, [gl, scene, intensity])
  return null
}
