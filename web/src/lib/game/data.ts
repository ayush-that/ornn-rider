import type { Track, SeriesPoint, GpuRange } from './types'

// The six GPU tabs from the Ornn chart. `gpuName` is the API name used to build
// history-simple / index-history paths; `tab` is the compact header label.
export const TRACKS: Track[] = [
  { id: 'h100', gpuName: 'H100 SXM', tab: 'H100', label: 'H100 SXM', hasAll: true },
  { id: 'h200', gpuName: 'H200', tab: 'H200', label: 'H200', hasAll: false },
  { id: 'b200', gpuName: 'B200', tab: 'B200', label: 'B200', hasAll: false },
  { id: 'a100', gpuName: 'A100 SXM4', tab: 'A100', label: 'A100 SXM4', hasAll: false },
  { id: 'rtx5090', gpuName: 'RTX 5090', tab: 'RTX 5090', label: 'RTX 5090', hasAll: false },
  { id: 'rtxpro6000', gpuName: 'RTX PRO 6000 WS', tab: 'PRO 6000', label: 'RTX PRO 6000 WS', hasAll: false },
]

export const RANGES: { id: GpuRange; label: string }[] = [
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: 'all', label: 'ALL' }, // H100 only
]

const DAY_MS = 86_400_000

// Build the proxied API path for a track+range. history-simple wants camelCase
// startDate/endDate ISO params; index-history and h100-history take none.
// Auth is injected server-side by the /api proxy — never here.
function endpointFor(track: Track, range: GpuRange): string {
  const enc = encodeURIComponent(track.gpuName)
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  if (range === '1w' || range === '1m') {
    const days = range === '1w' ? 7 : 30
    const limit = range === '1w' ? 300 : 800
    const start = iso(now - days * DAY_MS)
    const end = iso(now)
    return `/api/gpu/${enc}/history-simple?granularity=hourly&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&limit=${limit}`
  }
  if (range === 'all' && track.hasAll) {
    return `/api/h100-history`
  }
  // 3m (and the fallback for a non-H100 'all') = daily index history.
  return `/api/gpu/${enc}/index-history`
}

// One cache entry per track+range; overwritten on each successful fetch so
// storage stays bounded and yesterday's data survives as a stale fallback.
function getCacheKey(trackId: string, range: GpuRange): string {
  return `ornn-rider:${trackId}:${range}`
}

// Remove entries written by an earlier version that stamped the key with the
// date, or that predate the range suffix (`ornn-rider:<id>` with no range).
function cleanupLegacyCacheKeys(): void {
  try {
    const legacyDate = /^ornn-rider:.+:\d{4}-\d{2}-\d{2}$/
    const noRange = /^ornn-rider:[a-z0-9]+$/
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (legacyDate.test(key) || noRange.test(key))) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // localStorage disabled
  }
}
cleanupLegacyCacheKeys()

function getCacheValue(trackId: string, range: GpuRange, allowStale: boolean): SeriesPoint[] | null {
  try {
    const item = localStorage.getItem(getCacheKey(trackId, range))
    if (!item) return null
    const parsed = JSON.parse(item)
    if (!parsed.data || !Array.isArray(parsed.data) || parsed.data.length < 2) return null
    if (!allowStale) {
      const writtenDay = new Date(parsed.timestamp ?? 0).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]
      if (writtenDay !== today) return null
    }
    for (const p of parsed.data) {
      if (typeof p?.t !== 'number' || typeof p?.v !== 'number' || !Number.isFinite(p.t) || !Number.isFinite(p.v)) return null
    }
    return parsed.data
  } catch {
    return null
  }
}

function setCacheValue(trackId: string, range: GpuRange, data: SeriesPoint[]): void {
  try {
    localStorage.setItem(getCacheKey(trackId, range), JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // localStorage full or disabled, silently fail
  }
}

export async function fetchSeries(track: Track, range: GpuRange): Promise<SeriesPoint[]> {
  const cached = getCacheValue(track.id, range, false)
  if (cached) return cached

  try {
    const response = await fetch(endpointFor(track, range))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const json = (await response.json()) as { success?: boolean; data?: Array<{ timestamp: number | string; index_value: number | string }> }
    if (!json.data || !Array.isArray(json.data)) throw new Error('Invalid response format')

    // history-simple serves most-recent-first; index-history oldest-first.
    // Sort oldest-first defensively so terrain always builds left-to-right.
    const series: SeriesPoint[] = json.data
      .map(point => ({
        t: typeof point.timestamp === 'number' ? point.timestamp : new Date(point.timestamp).getTime(),
        v: Number(point.index_value),
      }))
      .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t)

    if (series.length < 2) throw new Error('Series too short')

    setCacheValue(track.id, range, series)
    return series
  } catch (error) {
    const staleCache = getCacheValue(track.id, range, true)
    if (staleCache) return staleCache
    throw new Error(`Failed to fetch series for ${track.id}/${range}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
