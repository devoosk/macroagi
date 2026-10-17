import { useEffect, useMemo } from 'react'
import { Building } from './Building'
import { Equipment } from './Equipment'
import { Floor, floorPlan } from './Floor'
import { DEFAULT_BOUNDS, hallLayout, type Bounds, type Rect } from './layout'
import { Lighting } from './Lighting'
import { createMaterials, MaterialsContext } from './materials'
import { QUALITY_PRESETS, defaultQuality, type Quality } from './quality'
import { Services } from './Services'
import { Storage } from './Storage'

export interface FactoryEnvironmentProps {
  quality?: Quality
  /** Line extent in world XZ (metres). The hall is sized around it. */
  bounds?: Bounds
  /** Hatched no-go zones on the floor (default: behind the reference line's test stations). */
  hazardZones?: Rect[]
  /** Deterministic slight lighting variation between capture cycles. */
  lightSeed?: number | string
  /** Include lights and the environment map (default true). */
  lights?: boolean
  /** Dollhouse view: hide the roof, roof structure, sprinklers and the near (+z) long wall for overview cameras. */
  cutaway?: boolean
}

/** Static factory hall: building, floor, services, storage, equipment, lights and environment lighting. */
export function FactoryEnvironment({
  quality = defaultQuality,
  bounds = DEFAULT_BOUNDS,
  hazardZones,
  lightSeed = 0,
  lights = true,
  cutaway = false,
}: FactoryEnvironmentProps) {
  const q = QUALITY_PRESETS[quality]
  const L = useMemo(
    () => hallLayout({ minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ }),
    [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ],
  )
  const hzKey = hazardZones ? JSON.stringify(hazardZones) : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => floorPlan(L, hazardZones), [L, hzKey])
  const mats = useMemo(() => createMaterials(L, q), [L, q])
  useEffect(() => () => mats.dispose(), [mats])
  const cabinetX = (plan.cabinets.minX + plan.cabinets.maxX) / 2
  return (
    <MaterialsContext.Provider value={mats}>
      <group name="factory-environment">
        {lights && <Lighting L={L} q={q} lightSeed={lightSeed} />}
        <Building L={L} cutaway={cutaway} />
        <Floor L={L} plan={plan} />
        <Services L={L} cabinetX={cabinetX} cutaway={cutaway} />
        <Storage L={L} plan={plan} />
        <Equipment L={L} plan={plan} />
      </group>
    </MaterialsContext.Provider>
  )
}
