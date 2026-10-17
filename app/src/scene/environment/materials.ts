import { createContext, useContext } from 'react'
import * as THREE from 'three'
import type { HallLayout } from './layout'
import type { QualityPreset } from './quality'
import {
  cardboardTexture,
  concreteTexture,
  fenceMeshTexture,
  floorTextures,
  galvanisedTexture,
  hatchTexture,
  paintWearTexture,
  polycarbonateTexture,
  uprightTexture,
  wallGrimeTexture,
  woodTexture,
} from './textures'

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)

/** Floor paint sits a hair above the floor; polygon offset avoids z-fighting at grazing angles. */
const paint = (p: THREE.MeshStandardMaterialParameters) =>
  std({ roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...p })

export function createMaterials(L: HallLayout, q: QualityPreset) {
  const floorTex = floorTextures(L, q.floorTexSize, q.anisotropy)
  const wear = paintWearTexture()
  const tex = {
    concrete: concreteTexture(),
    cardboard: cardboardTexture(),
    hatch: hatchTexture(),
    fence: fenceMeshTexture(),
    galv: galvanisedTexture(),
    wood: woodTexture(),
    upright: uprightTexture(),
    grime: wallGrimeTexture(),
    poly: polycarbonateTexture(),
    wear,
    ...floorTex,
  }
  const m = {
    floor: std({ map: floorTex.map, roughnessMap: floorTex.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 0.9 }),
    // Floor markings.
    paintYellow: paint({ color: '#e7b416', map: wear }),
    paintWhite: paint({ color: '#e9e9e4', map: wear }),
    paintGreen: paint({ color: '#5d8a68', roughness: 0.6, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    paintBlack: paint({ color: '#141414', polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    paintBlue: paint({ color: '#2c63b5', map: wear }),
    paintRed: paint({ color: '#c0352b', map: wear }),
    hatch: paint({ map: tex.hatch, roughness: 0.6 }),
    // Structure.
    steelFrame: std({ color: '#3c4a57', roughness: 0.55, metalness: 0.35 }),
    steelGrey: std({ color: '#7c8288', roughness: 0.5, metalness: 0.5 }),
    hanger: std({ color: '#9da3a8', roughness: 0.4, metalness: 0.7 }),
    steelDark: std({ color: '#2d3034', roughness: 0.6, metalness: 0.4 }),
    purlin: std({ color: '#a9adb0', map: tex.galv, roughness: 0.45, metalness: 0.6 }),
    claddingInner: std({ color: '#e9eae6', map: tex.grime, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }),
    roofInner: std({ color: '#d9dcdc', map: tex.grime, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide }),
    concrete: std({ map: tex.concrete, roughness: 0.92, metalness: 0 }),
    skylight: std({
      color: '#dfe7ee',
      emissive: '#e7f0ff',
      emissiveMap: tex.poly,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      side: THREE.DoubleSide,
    }),
    windowBand: std({ color: '#cfd8df', emissive: '#d8e6f5', emissiveIntensity: 1.25, roughness: 0.2, side: THREE.DoubleSide }),
    doorPanel: std({ color: '#b9bec2', roughness: 0.45, metalness: 0.4 }),
    doorLeaf: std({ color: '#8d969c', roughness: 0.5, metalness: 0.3 }),
    glass: std({ color: '#9fb4c2', roughness: 0.05, metalness: 0.2, emissive: '#aebfcc', emissiveIntensity: 0.6 }),
    rubber: std({ color: '#1b1c1d', roughness: 0.9, metalness: 0 }),
    // Services.
    galv: std({ color: '#c3c7ca', map: tex.galv, roughness: 0.38, metalness: 0.75 }),
    sprinkler: std({ color: '#b3231c', roughness: 0.45, metalness: 0.3 }),
    brass: std({ color: '#b08d3c', roughness: 0.35, metalness: 0.85 }),
    airPipe: std({ color: '#1f6fb8', roughness: 0.3, metalness: 0.55 }),
    trayRail: std({ color: '#b8bcbf', map: tex.galv, roughness: 0.4, metalness: 0.7 }),
    cable: std({ color: '#202224', roughness: 0.7, metalness: 0 }),
    ledHousing: std({ color: '#c9ccce', roughness: 0.4, metalness: 0.6 }),
    ledFace: std({ color: '#ffffff', emissive: '#fff6ea', emissiveIntensity: 6, roughness: 0.4, toneMapped: true }),
    lightStrip: std({ color: '#ffffff', emissive: '#f4f8ff', emissiveIntensity: 3, roughness: 0.4 }),
    // Peripheral.
    rackUpright: std({ map: tex.upright, roughness: 0.45, metalness: 0.35 }),
    rackBeam: std({ color: '#e0621c', roughness: 0.45, metalness: 0.3 }),
    rackDeck: std({ color: '#8c9196', roughness: 0.55, metalness: 0.5 }),
    wood: std({ map: tex.wood, roughness: 0.85, metalness: 0 }),
    cardboard: std({ map: tex.cardboard, roughness: 0.9, metalness: 0 }),
    wrap: std({ color: '#eef2f4', roughness: 0.18, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false }),
    aluProfile: std({ color: '#c4c8cb', roughness: 0.35, metalness: 0.8 }),
    roller: std({ color: '#9aa0a5', roughness: 0.35, metalness: 0.7 }),
    bin: std({ color: '#ffffff', roughness: 0.55, metalness: 0 }),
    partGrey: std({ color: '#8f9498', roughness: 0.4, metalness: 0.6 }),
    fenceMesh: std({ color: '#26282a', alphaMap: tex.fence, alphaTest: 0.5, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
    fenceFrame: std({ color: '#1e2022', roughness: 0.55, metalness: 0.4 }),
    safetyYellow: std({ color: '#e8b30e', roughness: 0.45, metalness: 0.2 }),
    safetyBlack: std({ color: '#151515', roughness: 0.5, metalness: 0.2 }),
    fireRed: std({ color: '#c41e1a', roughness: 0.35, metalness: 0.25 }),
    signRed: std({ color: '#c0201b', roughness: 0.5, metalness: 0 }),
    signGreen: std({ color: '#0b8a4a', roughness: 0.5, metalness: 0 }),
    signWhite: std({ color: '#f4f4f0', roughness: 0.5, metalness: 0 }),
    exitGlow: std({ color: '#0a9a50', emissive: '#16c060', emissiveIntensity: 2.2, roughness: 0.4 }),
    cabinet: std({ color: '#c9cbc4', roughness: 0.42, metalness: 0.25 }),
    cabinetPlinth: std({ color: '#2b2d2f', roughness: 0.6, metalness: 0.3 }),
    lampGreen: std({ color: '#1f8f3a', emissive: '#2bff5c', emissiveIntensity: 3, roughness: 0.3 }),
    lampAmber: std({ color: '#b07a10', emissive: '#ffb020', emissiveIntensity: 3, roughness: 0.3 }),
    lampWhite: std({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2.5, roughness: 0.3 }),
    forklift: std({ color: '#e0a21a', roughness: 0.4, metalness: 0.25 }),
    forkliftDark: std({ color: '#26282b', roughness: 0.5, metalness: 0.5 }),
    tyre: std({ color: '#151515', roughness: 0.85, metalness: 0 }),
    gasCylinder: std({ color: '#c8cbc9', roughness: 0.35, metalness: 0.45 }),
    gasCap: std({ color: '#c42b20', roughness: 0.4, metalness: 0.3 }),
    chrome: std({ color: '#d6d9dc', roughness: 0.15, metalness: 1 }),
  }
  const binColors = ['#2c5fb3', '#d0412c', '#e2b41b', '#2c8a4b', '#5a6068']
  const dispose = () => {
    Object.values(m).forEach((x) => x.dispose())
    Object.values(tex).forEach((t) => t.dispose())
  }
  return { m, tex, binColors, dispose }
}

export type EnvMaterials = ReturnType<typeof createMaterials>

export const MaterialsContext = createContext<EnvMaterials | null>(null)

export function useMats(): EnvMaterials {
  const v = useContext(MaterialsContext)
  if (!v) throw new Error('useMats outside FactoryEnvironment')
  return v
}
