import type { Track, SeriesPoint } from './types'

export const TRACKS: Track[] = [
  {
    id: 'h100',
    gpuName: 'H100 SXM',
    label: 'H100 SXM — The Marathon',
    endpoint: '/api/h100-history',
    blurb: 'Full 2-year history. Buckle up.',
  },
  {
    id: 'a100',
    gpuName: 'A100 SXM4',
    label: 'A100 SXM4 — The Long Ride',
    endpoint: `/api/gpu/${encodeURIComponent('A100 SXM4')}/index-history`,
    blurb: 'Last 90 days. Classic compute.',
  },
  {
    id: 'b200',
    gpuName: 'B200',
    label: 'B200 — Blackwell Surge',
    endpoint: `/api/gpu/${encodeURIComponent('B200')}/index-history`,
    blurb: 'Last 90 days. Latest hotness.',
  },
  {
    id: 'h200',
    gpuName: 'H200',
    label: 'H200 — Grace & Speed',
    endpoint: `/api/gpu/${encodeURIComponent('H200')}/index-history`,
    blurb: 'Last 90 days. Hopper flagship.',
  },
  {
    id: 'rtx5090',
    gpuName: 'RTX 5090',
    label: 'RTX 5090 — Consumer Peak',
    endpoint: `/api/gpu/${encodeURIComponent('RTX 5090')}/index-history`,
    blurb: 'Last 90 days. Gaming beast.',
  },
  {
    id: 'rtxpro6000',
    gpuName: 'RTX PRO 6000 WS',
    label: 'RTX PRO 6000 WS — Workstation War',
    endpoint: `/api/gpu/${encodeURIComponent('RTX PRO 6000 WS')}/index-history`,
    blurb: 'Last 90 days. Professional tier.',
  },
]

// One fixed key per track (no date suffix): the entry is overwritten on every
// successful fetch, so storage stays bounded and yesterday's data remains
// findable as a stale fallback when the API is unreachable.
function getCacheKey(trackId: string): string {
  return `ornn-rider:${trackId}`
}

// Remove entries written by an earlier version that stamped the key with the
// date (`ornn-rider:<id>:YYYY-MM-DD`), which leaked one key per track per day.
function cleanupLegacyCacheKeys(): void {
  try {
    const legacy = /^ornn-rider:.+:\d{4}-\d{2}-\d{2}$/
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && legacy.test(key)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // localStorage disabled
  }
}
cleanupLegacyCacheKeys()

function getCacheValue(trackId: string, allowStale: boolean): SeriesPoint[] | null {
  try {
    const item = localStorage.getItem(getCacheKey(trackId))
    if (!item) return null
    const parsed = JSON.parse(item)
    if (!parsed.data || !Array.isArray(parsed.data) || parsed.data.length < 2) return null
    // Fresh = written today (UTC); otherwise only usable as a stale fallback.
    if (!allowStale) {
      const writtenDay = new Date(parsed.timestamp ?? 0).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      if (writtenDay !== today) return null
    }
    // Reject caches written before timestamps were normalized to unix ms
    for (const p of parsed.data) {
      if (typeof p?.t !== 'number' || typeof p?.v !== 'number' || !Number.isFinite(p.t) || !Number.isFinite(p.v)) return null
    }
    return parsed.data
  } catch {
    return null
  }
}

function setCacheValue(trackId: string, data: SeriesPoint[]): void {
  try {
    localStorage.setItem(getCacheKey(trackId), JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // localStorage full or disabled, silently fail
  }
}

export async function fetchSeries(track: Track): Promise<SeriesPoint[]> {
  // Try today's cache first
  const cached = getCacheValue(track.id, false)
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(track.endpoint)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const json = (await response.json()) as { success?: boolean; data?: Array<{ timestamp: number | string; index_value: number | string }> }
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error('Invalid response format')
    }

    // Map raw API response to SeriesPoint and sort defensively (should already be oldest-first).
    // The API serves timestamps as ISO strings (e.g. "2024-06-23T20:00:00.000Z").
    const series: SeriesPoint[] = json.data
      .map(point => ({
        t: typeof point.timestamp === 'number' ? point.timestamp : new Date(point.timestamp).getTime(),
        v: Number(point.index_value),
      }))
      .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t)

    if (series.length < 2) throw new Error('Series too short')

    // Cache the result
    setCacheValue(track.id, series)
    return series
  } catch (error) {
    // Fetch failed, fall back to stale cache from a previous day if present
    const staleCache = getCacheValue(track.id, true)
    if (staleCache) {
      return staleCache
    }
    // No cache and fetch failed
    throw new Error(`Failed to fetch series for ${track.id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
