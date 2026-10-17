import type { Object3D } from 'three'

/**
 * Shared registry of scene anchors so modules can find each other's objects
 * without importing each other. Keys: `head:<stationId>` (worker head bone, used by
 * the first-person capture camera), `station:<stationId>` (station root group).
 */
const anchors = new Map<string, Object3D>()

export function registerAnchor(key: string, obj: Object3D | null) {
  if (obj) anchors.set(key, obj)
  else anchors.delete(key)
}

export function getAnchor(key: string): Object3D | undefined {
  return anchors.get(key)
}
