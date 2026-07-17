import type { Track, TrackCategory, SeriesPoint, GpuRange } from './types'

// --- Track catalog ---------------------------------------------------------
// Three families ride terrain built from real Ornn market data. compute = the
// six GPU rental indices; memory = curated DRAM/NAND spot prices; tokens = LLM
// output-token price indices per lab. `apiId` is the raw identifier used to
// build the proxied API path; auth is injected server-side by /api (never here).

// compute: the six GPU tabs from the Ornn chart. apiId = the API gpu name.
export const COMPUTE_TRACKS: Track[] = [
  { id: 'h100', category: 'compute', apiId: 'H100 SXM', tab: 'H100', label: 'H100 SXM' },
  { id: 'h200', category: 'compute', apiId: 'H200', tab: 'H200', label: 'H200' },
  { id: 'b200', category: 'compute', apiId: 'B200', tab: 'B200', label: 'B200' },
  { id: 'a100', category: 'compute', apiId: 'A100 SXM4', tab: 'A100', label: 'A100 SXM4' },
  { id: 'rtx5090', category: 'compute', apiId: 'RTX 5090', tab: 'RTX 5090', label: 'RTX 5090' },
  { id: 'rtxpro6000', category: 'compute', apiId: 'RTX PRO 6000 WS', tab: 'PRO 6000', label: 'RTX PRO 6000 WS' },
]

// memory: iconic tracks from the real /api/memory-types catalog. apiId = the
// exact memory_type string (encodeURIComponent handles the embedded '/').
export const MEMORY_TRACKS: Track[] = [
  { id: 'mem-ddr5', category: 'memory', apiId: 'DDR5 16Gb (2Gx8) 4800/5600', tab: 'DDR5', label: 'DDR5 16Gb 4800/5600' },
  { id: 'mem-ddr4', category: 'memory', apiId: 'DDR4 16Gb (2Gx8) 3200', tab: 'DDR4', label: 'DDR4 16Gb 3200' },
  { id: 'mem-rdimm', category: 'memory', apiId: 'DDR5 RDIMM 32GB 4800/5600', tab: 'RDIMM', label: 'DDR5 RDIMM 32GB' },
]

// tokens: all eleven labs from /api/otpi. apiId = the lab slug.
export const TOKEN_TRACKS: Track[] = [
  { id: 'tok-anthropic', category: 'tokens', apiId: 'anthropic', tab: 'ANTHROPIC', label: 'Anthropic' },
  { id: 'tok-openai', category: 'tokens', apiId: 'openai', tab: 'OPENAI', label: 'OpenAI' },
  { id: 'tok-google', category: 'tokens', apiId: 'google', tab: 'GOOGLE', label: 'Google' },
  { id: 'tok-deepseek', category: 'tokens', apiId: 'deepseek', tab: 'DEEPSEEK', label: 'DeepSeek' },
  { id: 'tok-minimax', category: 'tokens', apiId: 'minimax', tab: 'MINIMAX', label: 'MiniMax' },
  { id: 'tok-xiaomi', category: 'tokens', apiId: 'xiaomi', tab: 'XIAOMI', label: 'Xiaomi' },
  { id: 'tok-qwen', category: 'tokens', apiId: 'qwen', tab: 'QWEN', label: 'Qwen' },
  { id: 'tok-moonshot', category: 'tokens', apiId: 'moonshotai', tab: 'MOONSHOT', label: 'Moonshot AI' },
  { id: 'tok-zai', category: 'tokens', apiId: 'z-ai', tab: 'Z.AI', label: 'Z.ai' },
  { id: 'tok-mistral', category: 'tokens', apiId: 'mistralai', tab: 'MISTRAL', label: 'Mistral AI' },
  { id: 'tok-meta', category: 'tokens', apiId: 'meta-llama', tab: 'META', label: 'Meta Llama' },
]

export interface Category {
  id: TrackCategory
  label: string // selector label
  unit: string // price-line unit suffix
  tracks: Track[]
  ranges: GpuRange[] // applicable ranges (memory/tokens are daily-only)
}

// One race per track: the full daily history (the range picker collapsed away —
// hud hides the pill row whenever a category has a single range).
export const CATEGORIES: Category[] = [
  { id: 'compute', label: 'COMPUTE', unit: '/hr', tracks: COMPUTE_TRACKS, ranges: ['all'] },
  { id: 'memory', label: 'MEMORY', unit: '/unit', tracks: MEMORY_TRACKS, ranges: ['all'] },
  { id: 'tokens', label: 'TOKENS', unit: '/Mtok', tracks: TOKEN_TRACKS, ranges: ['all'] },
]

// Flat lookup across every category (id → Track), for restore / lookups.
export const TRACKS: Track[] = CATEGORIES.flatMap(c => c.tracks)

export const RANGE_LABELS: Record<GpuRange, string> = {
  '1w': '1W',
  '1m': '1M',
  '3m': '3M',
  all: 'ALL',
}

export function categoryOf(cat: TrackCategory): Category {
  return CATEGORIES.find(c => c.id === cat) ?? CATEGORIES[0]
}

export function defaultRange(cat: TrackCategory): GpuRange {
  const ranges = categoryOf(cat).ranges
  return ranges[ranges.length - 1]
}

// Clamp a range to what the track's category actually supports.
export function normalizeRange(track: Track, range: GpuRange): GpuRange {
  const ranges = categoryOf(track.category).ranges
  return ranges.includes(range) ? range : defaultRange(track.category)
}


// Build the proxied API path for a track+range. Auth is injected server-side by
// the /api proxy — never here. Each category has its own endpoint + response
// shape (parsed in extractSeries).
function endpointFor(track: Track, range: GpuRange): string {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()

  if (track.category === 'memory') {
    // Daily spot-price history; limit=3000 pulls the full backfill (NAND flash
    // reaches back to 2008, capped at 1000 without it).
    return `/api/memory/${encodeURIComponent(track.apiId)}/history?limit=3000`
  }

  if (track.category === 'tokens') {
    // Daily output-token price index per lab, oldest-first.
    const today = iso(now).slice(0, 10)
    return `/api/otpi?lab=${encodeURIComponent(track.apiId)}&startDate=2024-01-01&endDate=${today}`
  }

  // compute: full daily history for every GPU (H200 → ~540 points, H100 → ~750).
  const enc = encodeURIComponent(track.apiId)
  const start = '2023-01-01T00:00:00Z'
  const end = iso(now)
  return `/api/gpu/${enc}/history-simple?granularity=daily&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&limit=3000`
}

// Normalize a category's response rows to {t, v}. compute serves
// {timestamp, index_value}; memory {date, price}; tokens {date, indexPerMtok}.
function extractSeries(track: Track, json: unknown): SeriesPoint[] {
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) throw new Error('Invalid response format')

  const rows = data as Array<Record<string, unknown>>
  const toMs = (d: unknown): number =>
    typeof d === 'number' ? d : new Date(String(d)).getTime()

  let mapped: SeriesPoint[]
  if (track.category === 'memory') {
    mapped = rows.map(r => ({ t: toMs(r.date), v: Number(r.price) }))
  } else if (track.category === 'tokens') {
    mapped = rows.map(r => ({ t: toMs(r.date), v: Number(r.indexPerMtok) }))
  } else {
    mapped = rows.map(r => ({ t: toMs(r.timestamp), v: Number(r.index_value) }))
  }

  // Sort oldest-first defensively (history-simple / memory serve most-recent
  // first; index-history / otpi serve oldest-first) so terrain builds L→R.
  return mapped
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t)
}

// One cache entry per category+track+range; overwritten on each successful fetch
// so storage stays bounded and yesterday's data survives as a stale fallback.
function getCacheKey(track: Track, range: GpuRange): string {
  return `ornn-rider:${track.category}:${track.id}:${range}`
}

// Remove entries written by an earlier version that stamped the key with the
// date, or that predate the range/category suffix.
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

function getCacheValue(track: Track, range: GpuRange, allowStale: boolean): SeriesPoint[] | null {
  try {
    const item = localStorage.getItem(getCacheKey(track, range))
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

function setCacheValue(track: Track, range: GpuRange, data: SeriesPoint[]): void {
  try {
    localStorage.setItem(getCacheKey(track, range), JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // localStorage full or disabled, silently fail
  }
}

export async function fetchSeries(track: Track, range: GpuRange): Promise<SeriesPoint[]> {
  const cached = getCacheValue(track, range, false)
  if (cached) return cached

  try {
    const response = await fetch(endpointFor(track, range))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const series = extractSeries(track, await response.json())
    if (series.length < 2) throw new Error('Series too short')

    setCacheValue(track, range, series)
    return series
  } catch (error) {
    const staleCache = getCacheValue(track, range, true)
    if (staleCache) return staleCache
    throw new Error(`Failed to fetch series for ${track.id}/${range}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
