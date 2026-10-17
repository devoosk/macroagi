import type { EventLog, Line } from '../contracts/types'

export async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export const loadLine = (name = 'line') => loadJson<Line>(`/data/${name}.json`)
export const loadEvents = (name = 'events_current') => loadJson<EventLog>(`/data/${name}.json`)
