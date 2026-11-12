import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createProviderUsage } from './provider-usage.js'

const STATUS_ROUTE = '/api/sub-limits/status'
const CONFIG_ROUTE = '/api/sub-limits/config'
const CALIBRATE_ROUTE = '/api/sub-limits/calibrate'
const PROVIDERS_ROUTE = '/api/sub-limits/providers'
const OPENCODE_CREDENTIAL = 'OPENCODE_API_KEY'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const FIVE_HOUR_MS = 5 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MAX_BODY_BYTES = 64 * 1024
const MAX_DRAIN_BYTES = MAX_BODY_BYTES * 16
const MAX_EVENTS = 20_000
const MAX_KEY_LENGTH = 400
const MAX_CLOCK_SKEW_MS = 1_000
const READY_TIMEOUT_MS = 2_000
const MAX_WRITE_ATTEMPTS = 5
const LEDGER_VERSION = 1
const KEY_SEPARATOR = '\u0000'
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const LIMIT_FIELDS = ['fiveHourRequests', 'fiveHourTokens', 'weeklyRequests', 'weeklyTokens']
const DEFAULT_FIELDS = ['mode', 'blockMode', 'fiveHourCap', 'weeklyCap', 'historyDays', 'pollMs']
const USER_FIELDS = ['mode', 'blockMode', 'fiveHourCap', 'weeklyCap', 'historyDays']

function resolveHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv.length > 0 ? fromEnv : join(homedir(), '.dsh')
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  return {
    mode: raw.mode === 'tokens' ? 'tokens' : 'requests',
    blockMode: raw.blockMode === 'block' ? 'block' : 'rolling',
    fiveHourCap: clampNumber(raw.fiveHourCap, 0, 1e12, 0),
    weeklyCap: clampNumber(raw.weeklyCap, 0, 1e12, 0),
    historyDays: Math.round(clampNumber(raw.historyDays, 8, 90, 8)),
    pollMs: Math.round(clampNumber(raw.pollMs, 1_000, 60_000, 5_000))
  }
}

function hasOwn(map, key) {
  return map !== null && typeof map === 'object' && Object.hasOwn(map, key)
}

function own(map, key) {
  return hasOwn(map, key) ? map[key] : undefined
}

function safeKey(value, limit) {
  const key = typeof value === 'string' ? value.trim() : ''
  if (key.length === 0 || key.length > limit) return ''
  return RESERVED_KEYS.has(key) ? '' : key
}

function makeKey(provider, model) {
  return `${provider}${KEY_SEPARATOR}${model}`
}

function splitKey(key) {
  const index = key.indexOf(KEY_SEPARATOR)
  if (index < 0) return { provider: key, model: '' }
  return { provider: key.slice(0, index), model: key.slice(index + 1) }
}

function cleanString(value, limit) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed
}

function countOf(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

function emptyLimits() {
  return { fiveHourRequests: 0, fiveHourTokens: 0, weeklyRequests: 0, weeklyTokens: 0 }
}

function emptyLedger() {
  return {
    version: LEDGER_VERSION,
    updatedAt: 0,
    routes: Object.create(null),
    overrides: Object.create(null),
    defaults: null,
    userFields: []
  }
}

function ensureRoute(ledger, provider, model) {
  const key = makeKey(provider, model)
  let entry = own(ledger.routes, key)
  if (entry === null || entry === undefined || typeof entry !== 'object') {
    entry = {
      provider,
      model,
      events: [],
      blockStart: 0,
      rollingFrom: 0,
      weeklyAnchor: 0,
      limits: emptyLimits(),
      rateLimit: null
    }
    ledger.routes[key] = entry
  }
  if (!Array.isArray(entry.events)) entry.events = []
  if (!Number.isFinite(entry.blockStart)) entry.blockStart = 0
  if (!Number.isFinite(entry.rollingFrom)) entry.rollingFrom = 0
  if (!Number.isFinite(entry.weeklyAnchor)) entry.weeklyAnchor = 0
  if (entry.limits === null || typeof entry.limits !== 'object') entry.limits = emptyLimits()
  for (const field of LIMIT_FIELDS) {
    if (!Number.isFinite(entry.limits[field])) entry.limits[field] = 0
  }
  return entry
}

function eventParts(event) {
  const input = countOf(event && event.inputTokens)
  const output = countOf(event && event.outputTokens)
  const cacheRead = countOf(event && event.cacheReadTokens)
  const cacheWrite = countOf(event && event.cacheWriteTokens)
  const total = countOf(event && event.totalTokens) || input + output + cacheRead + cacheWrite
  return { input, output, cacheRead, cacheWrite, total }
}

function pruneEvents(entry, now, retentionDays) {
  const cutoff = now - Math.max(retentionDays, 8) * DAY_MS
  const kept = []
  for (const event of entry.events) {
    const at = Number(event && event.at)
    if (Number.isFinite(at) && at >= cutoff && at <= now + MAX_CLOCK_SKEW_MS) kept.push(event)
  }
  entry.events = kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept
}

function readLimit(entry, window, mode) {
  if (entry === null || entry === undefined || entry.limits === null || typeof entry.limits !== 'object') return 0
  const value = window === 'fiveHour'
    ? mode === 'tokens' ? entry.limits.fiveHourTokens : entry.limits.fiveHourRequests
    : mode === 'tokens' ? entry.limits.weeklyTokens : entry.limits.weeklyRequests
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function capFor(ledger, key, defaults, window, mode) {
  const perRoute = readLimit(own(ledger.routes, key), window, mode)
  if (perRoute > 0) return perRoute
  const split = splitKey(key)
  if (split.model !== '*') {
    const family = readLimit(own(ledger.routes, makeKey(split.provider, '*')), window, mode)
    if (family > 0) return family
  }
  const global = window === 'fiveHour' ? defaults.fiveHourCap : defaults.weeklyCap
  return global > 0 ? global : 0
}

function readOverride(ledger, key, window, windowStart, now) {
  const bucket = own(ledger.overrides, key)
  if (bucket === null || bucket === undefined || typeof bucket !== 'object') return null
  const record = bucket[window]
  if (record === null || record === undefined || typeof record !== 'object') return null
  const at = Number(record.at)
  const pct = Number(record.pct)
  if (!Number.isFinite(at) || !Number.isFinite(pct)) return null
  if (at < windowStart || at > now + MAX_CLOCK_SKEW_MS) return null
  return Math.min(Math.max(pct, 0), 100)
}

function windowReport({ used, cap, resetAt, now, override }) {
  const exhausted = cap > 0 && used >= cap
  const remaining = cap > 0 ? Math.max(cap - used, 0) : null
  const computed = cap > 0 ? Math.max(Math.min((remaining / cap) * 100, 100), 0) : null
  return {
    used,
    cap,
    remaining,
    remainingPct: exhausted ? 0 : override === null ? computed : override,
    calibrated: override !== null && !exhausted,
    resetAt,
    resetInMs: resetAt > 0 ? Math.max(resetAt - now, 0) : 0,
    exhausted
  }
}

function fiveHourStart(entry, defaults, now) {
  if (defaults.blockMode === 'block') {
    const blockStart = Number(entry.blockStart)
    if (!Number.isFinite(blockStart) || blockStart <= 0 || now - blockStart >= FIVE_HOUR_MS) return 0
    return blockStart
  }
  const rollingFrom = Number(entry.rollingFrom)
  const floor = Number.isFinite(rollingFrom) && rollingFrom > 0 && rollingFrom <= now ? rollingFrom : 0
  return Math.max(now - FIVE_HOUR_MS, floor)
}

function weeklyStart(entry, now) {
  const anchor = Number(entry.weeklyAnchor)
  if (!Number.isFinite(anchor) || anchor <= 0 || now - anchor >= WEEK_MS) return 0
  return anchor
}

function fiveHourReport(entry, ledger, key, defaults, now, totals, earliest) {
  const cap = capFor(ledger, key, defaults, 'fiveHour', defaults.mode)
  const start = fiveHourStart(entry, defaults, now)
  if (start <= 0) return windowReport({ used: 0, cap, resetAt: 0, now, override: null })
  const resetAt = defaults.blockMode === 'block'
    ? start + FIVE_HOUR_MS
    : earliest > 0 ? earliest + FIVE_HOUR_MS : 0
  return windowReport({
    used: defaults.mode === 'tokens' ? totals.tokens : totals.requests,
    cap,
    resetAt,
    now,
    override: readOverride(ledger, key, 'fiveHour', start, now)
  })
}

function weeklyReport(entry, ledger, key, defaults, now, totals) {
  const cap = capFor(ledger, key, defaults, 'weekly', defaults.mode)
  const start = weeklyStart(entry, now)
  if (start <= 0) return windowReport({ used: 0, cap, resetAt: 0, now, override: null })
  return windowReport({
    used: defaults.mode === 'tokens' ? totals.tokens : totals.requests,
    cap,
    resetAt: start + WEEK_MS,
    now,
    override: readOverride(ledger, key, 'weekly', start, now)
  })
}

function scanEntry(events, now, fiveStart, weeklyStart) {
  const day = { requests: 0, tokens: 0 }
  const week = { requests: 0, tokens: 0 }
  const fiveHour = { requests: 0, tokens: 0 }
  const weekly = { requests: 0, tokens: 0 }
  let earliestFiveHour = 0
  const dayStart = now - DAY_MS
  const weekStart = now - WEEK_MS
  const ceiling = now + MAX_CLOCK_SKEW_MS
  for (const event of events) {
    const at = Number(event && event.at)
    if (!Number.isFinite(at) || at > ceiling) continue
    const parts = eventParts(event)
    if (at < weekStart) continue
    week.requests += 1
    week.tokens += parts.total
    if (at >= dayStart) {
      day.requests += 1
      day.tokens += parts.total
    }
    if (at >= fiveStart) {
      fiveHour.requests += 1
      fiveHour.tokens += parts.total
      if (earliestFiveHour === 0 || at < earliestFiveHour) earliestFiveHour = at
    }
    if (at >= weeklyStart) {
      weekly.requests += 1
      weekly.tokens += parts.total
    }
  }
  return { day, week, fiveHour, weekly, earliestFiveHour }
}

function describeRoute(ledger, key, defaults, now, activeKey) {
  const entry = own(ledger.routes, key)
  if (entry === null || entry === undefined || typeof entry !== 'object') return null
  const fiveStart = fiveHourStart(entry, defaults, now)
  const weekStart = weeklyStart(entry, now)
  const scan = scanEntry(
    entry.events,
    now,
    fiveStart > 0 ? fiveStart : now - FIVE_HOUR_MS,
    weekStart > 0 ? weekStart : now - WEEK_MS
  )
  const day = scan.day
  const week = scan.week
  const fiveTotals = fiveStart > 0 ? scan.fiveHour : { requests: 0, tokens: 0 }
  const weeklyTotals = weekStart > 0 ? scan.weekly : { requests: 0, tokens: 0 }
  const earliest = scan.earliestFiveHour
  return {
    key,
    provider: entry.provider,
    model: entry.model,
    active: key === activeKey,
    limits: {
      fiveHourRequests: entry.limits.fiveHourRequests,
      fiveHourTokens: entry.limits.fiveHourTokens,
      weeklyRequests: entry.limits.weeklyRequests,
      weeklyTokens: entry.limits.weeklyTokens
    },
    fiveHour: fiveHourReport(entry, ledger, key, defaults, now, fiveTotals, earliest),
    weekly: weeklyReport(entry, ledger, key, defaults, now, weeklyTotals),
    today: { requests: day.requests, tokens: day.tokens },
    week: { requests: week.requests, tokens: week.tokens },
    rateLimit: entry.rateLimit ?? null
  }
}

function snapshot(state, extra) {
  const now = Date.now()
  const routes = []
  for (const key of Object.keys(state.ledger.routes)) {
    const described = describeRoute(state.ledger, key, state.defaults, now, state.activeKey)
    if (described !== null) routes.push(described)
  }
  routes.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  })
  return {
    ok: true,
    now,
    ledgerPath: state.path,
    mode: state.defaults.mode,
    blockMode: state.defaults.blockMode,
    fiveHourCap: state.defaults.fiveHourCap,
    weeklyCap: state.defaults.weeklyCap,
    historyDays: state.defaults.historyDays,
    pollMs: state.defaults.pollMs,
    activeKey: state.activeKey,
    providers: state.providers,
    routes,
    ...(extra ?? {})
  }
}

function readEvents(source) {
  const events = []
  for (const event of Array.isArray(source) ? source : []) {
    if (event === null || typeof event !== 'object') continue
    const at = Number(event.at)
    if (!Number.isFinite(at)) continue
    events.push({
      at,
      inputTokens: countOf(event.inputTokens),
      outputTokens: countOf(event.outputTokens),
      cacheReadTokens: countOf(event.cacheReadTokens),
      cacheWriteTokens: countOf(event.cacheWriteTokens),
      totalTokens: countOf(event.totalTokens),
      ...(typeof event.purpose === 'string' ? { purpose: event.purpose } : {})
    })
  }
  return events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events
}

function readOverrides(source) {
  const overrides = Object.create(null)
  if (source === null || typeof source !== 'object') return overrides
  for (const key of Object.keys(source)) {
    if (safeKey(key, MAX_KEY_LENGTH).length === 0) continue
    const bucket = source[key]
    if (bucket === null || typeof bucket !== 'object') continue
    const copy = {}
    for (const window of ['fiveHour', 'weekly']) {
      const record = bucket[window]
      if (record === null || record === undefined || typeof record !== 'object') continue
      const at = Number(record.at)
      const pct = Number(record.pct)
      if (!Number.isFinite(at) || !Number.isFinite(pct)) continue
      copy[window] = { at, pct: Math.min(Math.max(pct, 0), 100) }
    }
    if (Object.keys(copy).length > 0) overrides[key] = copy
  }
  return overrides
}

async function loadLedger(path, log) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyLedger()
    if (log) log(`read failed: ${error && error.message ? error.message : String(error)}`)
    return emptyLedger()
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const backup = `${path}.corrupt-${Date.now()}.bak`
    try {
      await rename(path, backup)
      if (log) log(`ledger unreadable, moved to ${backup}`)
    } catch (error) {
      if (log) log(`ledger unreadable and not backed up: ${error && error.message ? error.message : String(error)}`)
    }
    return emptyLedger()
  }
  if (parsed === null || typeof parsed !== 'object') return emptyLedger()
  const ledger = emptyLedger()
  ledger.updatedAt = Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : 0
  ledger.defaults = parsed.defaults !== null && typeof parsed.defaults === 'object' ? parsed.defaults : null
  ledger.userFields = Array.isArray(parsed.userFields)
    ? parsed.userFields.filter((field) => USER_FIELDS.includes(field))
    : []
  if (parsed.routes !== null && typeof parsed.routes === 'object') {
    for (const key of Object.keys(parsed.routes)) {
      if (safeKey(key, MAX_KEY_LENGTH).length === 0) continue
      const source = parsed.routes[key]
      if (source === null || typeof source !== 'object') continue
      const split = splitKey(key)
      const provider = cleanString(source.provider, 120) || split.provider
      const model = typeof source.model === 'string' ? cleanString(source.model, 200) : split.model
      if (provider.length === 0) continue
      const entry = ensureRoute(ledger, provider, model)
      entry.events = readEvents(source.events)
      entry.blockStart = Number.isFinite(Number(source.blockStart)) ? Number(source.blockStart) : 0
      entry.rollingFrom = Number.isFinite(Number(source.rollingFrom)) ? Number(source.rollingFrom) : 0
      entry.weeklyAnchor = Number.isFinite(Number(source.weeklyAnchor)) ? Number(source.weeklyAnchor) : 0
      if (source.limits !== null && typeof source.limits === 'object') {
        entry.limits = {
          fiveHourRequests: countOf(source.limits.fiveHourRequests),
          fiveHourTokens: countOf(source.limits.fiveHourTokens),
          weeklyRequests: countOf(source.limits.weeklyRequests),
          weeklyTokens: countOf(source.limits.weeklyTokens)
        }
      }
      if (source.rateLimit !== null && typeof source.rateLimit === 'object') entry.rateLimit = source.rateLimit
    }
  }
  ledger.overrides = readOverrides(parsed.overrides)
  return ledger
}

function resolveDefaults(rawConfig, persisted, userFields) {
  const raw = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const stored = persisted !== null && persisted !== undefined && typeof persisted === 'object' ? persisted : {}
  const chosen = new Set(Array.isArray(userFields) ? userFields : [])
  const merged = {}
  for (const field of DEFAULT_FIELDS) {
    if (chosen.has(field) && Object.hasOwn(stored, field)) merged[field] = stored[field]
    else if (Object.hasOwn(raw, field)) merged[field] = raw[field]
    else if (Object.hasOwn(stored, field)) merged[field] = stored[field]
  }
  return normalizeConfig(merged)
}

function createState(path, defaults, log) {
  return {
    path,
    defaults,
    log,
    ledger: emptyLedger(),
    activeKey: '',
    providers: [],
    dirty: false,
    saving: null,
    failures: 0,
    pending: new Set()
  }
}

function defer(state, promise) {
  const tracked = promise.catch((error) => {
    if (state.log) state.log(`deferred task failed: ${error && error.message ? error.message : String(error)}`)
  })
  state.pending.add(tracked)
  tracked.then(() => {
    state.pending.delete(tracked)
  })
  return tracked
}

async function writeLedger(state) {
  const now = Date.now()
  for (const key of Object.keys(state.ledger.routes)) {
    const entry = state.ledger.routes[key]
    if (entry !== null && typeof entry === 'object') pruneEvents(entry, now, state.defaults.historyDays)
  }
  const payload = {
    version: LEDGER_VERSION,
    updatedAt: now,
    defaults: {
      mode: state.defaults.mode,
      blockMode: state.defaults.blockMode,
      fiveHourCap: state.defaults.fiveHourCap,
      weeklyCap: state.defaults.weeklyCap,
      historyDays: state.defaults.historyDays,
      pollMs: state.defaults.pollMs
    },
    routes: state.ledger.routes,
    overrides: state.ledger.overrides,
    userFields: state.ledger.userFields
  }
  state.ledger.updatedAt = now
  await mkdir(dirname(state.path), { recursive: true })
  const temporary = `${state.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, 'utf8')
    await rename(temporary, state.path)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {}
    throw error
  }
}

function touch(state) {
  state.dirty = true
  if (state.saving !== null) return state.saving
  state.saving = (async () => {
    try {
      while (state.dirty) {
        state.dirty = false
        try {
          await writeLedger(state)
          state.failures = 0
        } catch (error) {
          state.failures += 1
          const message = error && error.message ? error.message : String(error)
          if (state.log) state.log(`ledger write failed (${state.failures}): ${message}`)
          if (state.failures >= MAX_WRITE_ATTEMPTS) {
            state.dirty = false
            break
          }
          state.dirty = true
          await delay(Math.min(50 * 2 ** state.failures, 2_000))
        }
      }
    } finally {
      state.saving = null
    }
  })()
  return state.saving
}

async function flush(state) {
  while (state.pending.size > 0) {
    await Promise.all([...state.pending]).catch(() => {})
  }
  if (state.dirty && state.saving === null) touch(state)
  const pending = state.saving
  if (pending !== null) await pending.catch(() => {})
}

function recordUsage(state, provider, model, usage, purpose) {
  const now = Date.now()
  const entry = ensureRoute(state.ledger, provider, model)
  const parts = eventParts(usage ?? {})
  entry.events.push({
    at: now,
    inputTokens: parts.input,
    outputTokens: parts.output,
    cacheReadTokens: parts.cacheRead,
    cacheWriteTokens: parts.cacheWrite,
    totalTokens: parts.total,
    ...(typeof purpose === 'string' ? { purpose } : {})
  })
  if (entry.blockStart <= 0 || now - entry.blockStart >= FIVE_HOUR_MS) entry.blockStart = now
  if (entry.weeklyAnchor <= 0 || now - entry.weeklyAnchor >= WEEK_MS) entry.weeklyAnchor = now
  if (entry.rollingFrom > 0 && (now - entry.rollingFrom >= FIVE_HOUR_MS || entry.rollingFrom > now)) entry.rollingFrom = 0
  pruneEvents(entry, now, state.defaults.historyDays)
  state.activeKey = makeKey(provider, model)
  touch(state)
}

function readHeader(headers, name) {
  if (headers === null || headers === undefined || typeof headers !== 'object') return undefined
  for (const candidate of Object.keys(headers)) {
    if (candidate.toLowerCase() === name) return headers[candidate]
  }
  return undefined
}

function parseResetAt(value, now) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (value > 1e12) return value
    if (value > 1e9) return value * 1000
    return now + Math.max(value, 0) * 1000
  }
  const text = String(value).trim()
  if (text.length === 0) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    if (numeric > 1e12) return numeric
    if (numeric > 1e9) return numeric * 1000
    return now + numeric * 1000
  }
  if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(text)) {
    let total = 0
    for (const part of text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
      const amount = Number(part[1])
      const unit = part[2]
      const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? HOUR_MS : DAY_MS
      total += amount * factor
    }
    return total > 0 ? now + total : null
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function recordRateLimit(state, provider, model, headers, source) {
  if (headers === null || headers === undefined || typeof headers !== 'object') return false
  const remainingRequests = Number(readHeader(headers, 'x-ratelimit-remaining-requests') ?? readHeader(headers, 'x-ratelimit-remaining'))
  const limitRequests = Number(readHeader(headers, 'x-ratelimit-limit-requests') ?? readHeader(headers, 'x-ratelimit-limit'))
  const remainingTokens = Number(readHeader(headers, 'x-ratelimit-remaining-tokens'))
  const limitTokens = Number(readHeader(headers, 'x-ratelimit-limit-tokens'))
  const resetAt = parseResetAt(
    readHeader(headers, 'x-ratelimit-reset-requests') ?? readHeader(headers, 'x-ratelimit-reset'),
    Date.now()
  )
  if (![remainingRequests, limitRequests, remainingTokens, limitTokens].some((value) => Number.isFinite(value)) && resetAt === null) {
    return false
  }
  const now = Date.now()
  const entry = ensureRoute(state.ledger, provider, model)
  entry.rateLimit = {
    at: now,
    source,
    remainingRequests: Number.isFinite(remainingRequests) ? remainingRequests : null,
    limitRequests: Number.isFinite(limitRequests) ? limitRequests : null,
    remainingTokens: Number.isFinite(remainingTokens) ? remainingTokens : null,
    limitTokens: Number.isFinite(limitTokens) ? limitTokens : null,
    resetAt
  }
  if (Number.isFinite(remainingRequests) && Number.isFinite(limitRequests) && limitRequests > 0) {
    const key = makeKey(provider, model)
    const bucket = own(state.ledger.overrides, key)
    state.ledger.overrides[key] = {
      ...(bucket !== null && typeof bucket === 'object' ? bucket : {}),
      fiveHour: { pct: Math.max(Math.min((remainingRequests / limitRequests) * 100, 100), 0), at: now }
    }
  }
  touch(state)
  return true
}

function headersFromChunk(chunk) {
  if (chunk === null || chunk === undefined || typeof chunk !== 'object') return undefined
  for (const field of ['headers', 'rateLimit', 'rate_limits']) {
    const candidate = chunk[field]
    if (candidate !== null && candidate !== undefined && typeof candidate === 'object') return candidate
  }
  return undefined
}

async function readBody(req) {
  const chunks = []
  let size = 0
  let oversized = false
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      oversized = true
      if (size > MAX_DRAIN_BYTES) {
        if (typeof req.destroy === 'function') req.destroy()
        return null
      }
      continue
    }
    chunks.push(chunk)
  }
  if (oversized) return null
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return null
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function fence(webCtx, req, res) {
  const connection = typeof webCtx.get === 'function' ? webCtx.get('connection') : undefined
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
    sendJson(res, 503, { ok: false, error: 'connection service unavailable' })
    return false
  }
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch (error) {
    const message = error && error.message ? error.message : error
    sendJson(res, 503, { ok: false, error: `connection fence failed: ${String(message)}` })
    return false
  }
  if (rejection !== undefined && rejection !== null) {
    res.statusCode = rejection
    res.setHeader('cache-control', 'no-store')
    res.end()
    return false
  }
  return true
}

function statusHandler(state) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('allow', 'GET, HEAD')
      res.end()
      return
    }
    sendJson(res, 200, snapshot(state))
  }
}

function providersHandler(getProviderUsage) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('allow', 'GET, HEAD')
      res.end()
      return
    }
    const url = typeof req.url === 'string' ? req.url : ''
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
    const refresh = query.split('&').some((pair) => pair === 'refresh=1' || pair === 'refresh=true')
    try {
      const usage = await getProviderUsage(req, refresh)
      sendJson(res, 200, { ok: !usage.code, ...usage })
    } catch {
      sendJson(res, 502, { ok: false, code: 'NATIVE_UNAVAILABLE', error: 'Native DSH quotas unavailable', generatedAt: null, reports: [] })
    }
  }
}

function applyConfig(state, body) {
  const patch = body !== null && typeof body === 'object' ? body : {}
  let keys
  if (patch.route === undefined || patch.route === null || patch.route === '*') {
    keys = Object.keys(state.ledger.routes)
  } else {
    if (typeof patch.route !== 'string') return { status: 400, error: 'route must be a string' }
    const scope = safeKey(patch.route, MAX_KEY_LENGTH)
    if (scope.length === 0) return { status: 400, error: 'invalid route key' }
    if (!hasOwn(state.ledger.routes, scope)) return { status: 404, error: `unknown route: ${scope}` }
    keys = [scope]
  }

  const remember = new Set(state.ledger.userFields)
  if (patch.mode === 'requests' || patch.mode === 'tokens') {
    state.defaults.mode = patch.mode
    remember.add('mode')
  }
  if (patch.blockMode === 'rolling' || patch.blockMode === 'block') {
    state.defaults.blockMode = patch.blockMode
    remember.add('blockMode')
  }
  if (patch.fiveHourCap !== undefined) {
    state.defaults.fiveHourCap = clampNumber(patch.fiveHourCap, 0, 1e12, state.defaults.fiveHourCap)
    remember.add('fiveHourCap')
  }
  if (patch.weeklyCap !== undefined) {
    state.defaults.weeklyCap = clampNumber(patch.weeklyCap, 0, 1e12, state.defaults.weeklyCap)
    remember.add('weeklyCap')
  }
  if (patch.historyDays !== undefined) {
    state.defaults.historyDays = Math.round(clampNumber(patch.historyDays, 8, 90, state.defaults.historyDays))
    remember.add('historyDays')
  }
  state.ledger.userFields = USER_FIELDS.filter((field) => remember.has(field))

  const window = patch.window === 'weekly' ? 'weekly' : 'fiveHour'
  const perRoute = patch.cap !== undefined ? clampNumber(patch.cap, 0, 1e12, NaN) : NaN
  const capMode = patch.capMode === 'tokens' ? 'tokens' : 'requests'

  for (const key of keys) {
    const entry = own(state.ledger.routes, key)
    if (entry === null || entry === undefined) continue
    const field = window === 'fiveHour'
      ? capMode === 'tokens' ? 'fiveHourTokens' : 'fiveHourRequests'
      : capMode === 'tokens' ? 'weeklyTokens' : 'weeklyRequests'
    if (Number.isFinite(perRoute)) entry.limits[field] = perRoute
  }
  return { keys }
}

function configHandler(state) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    const body = await readBody(req)
    if (body === null) {
      sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
      return
    }
    const outcome = applyConfig(state, body)
    if (outcome.error !== undefined) {
      sendJson(res, outcome.status, { ok: false, error: outcome.error })
      return
    }
    touch(state)
    await flush(state)
    sendJson(res, 200, snapshot(state, { updated: outcome.keys }))
  }
}

function resetWindow(entry, window, now) {
  if (window === 'all' || window === 'history') {
    entry.events = []
    entry.blockStart = 0
    entry.rollingFrom = now
    entry.weeklyAnchor = now
    entry.rateLimit = null
    return
  }
  if (window === 'weekly') {
    entry.weeklyAnchor = now
    return
  }
  entry.blockStart = 0
  entry.rollingFrom = now
}

function calibrateHandler(state) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('allow', 'POST')
      res.end()
      return
    }
    const body = await readBody(req)
    if (body === null) {
      sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
      return
    }
    let key
    if (body.route === undefined || body.route === null) {
      key = state.activeKey
    } else if (typeof body.route !== 'string') {
      sendJson(res, 400, { ok: false, error: 'route must be a string' })
      return
    } else {
      key = safeKey(body.route, MAX_KEY_LENGTH)
      if (key.length === 0) {
        sendJson(res, 400, { ok: false, error: 'invalid route key' })
        return
      }
    }
    if (key.length === 0) {
      sendJson(res, 400, { ok: false, error: 'no active route to calibrate' })
      return
    }
    const entry = own(state.ledger.routes, key)
    if (entry === null || entry === undefined) {
      sendJson(res, 404, { ok: false, error: `unknown route: ${key}` })
      return
    }
    const action = cleanString(body.action, 40)
    const now = Date.now()
    if (action === 'pct') {
      const window = body.window === 'weekly' ? 'weekly' : 'fiveHour'
      const pct = clampNumber(body.pct, 0, 100, NaN)
      if (!Number.isFinite(pct)) {
        sendJson(res, 400, { ok: false, error: 'pct must be a number between 0 and 100' })
        return
      }
      const bucket = own(state.ledger.overrides, key)
      state.ledger.overrides[key] = {
        ...(bucket !== null && typeof bucket === 'object' ? bucket : {}),
        [window]: { pct, at: now }
      }
    } else if (action === 'reset') {
      const window = body.window === 'weekly'
        ? 'weekly'
        : body.window === 'all' ? 'all' : body.window === 'history' ? 'history' : 'fiveHour'
      resetWindow(entry, window, now)
      const bucket = own(state.ledger.overrides, key)
      if (bucket !== null && typeof bucket === 'object') {
        if (window === 'all' || window === 'history') delete state.ledger.overrides[key]
        else {
          delete bucket[window]
          if (Object.keys(bucket).length === 0) delete state.ledger.overrides[key]
        }
      }
    } else {
      sendJson(res, 400, { ok: false, error: `unsupported action: ${action}` })
      return
    }
    touch(state)
    await flush(state)
    sendJson(res, 200, snapshot(state, { calibrated: key }))
  }
}

function syncProviders(state, llm) {
  if (llm === undefined || llm === null) return
  let discovered
  try {
    discovered = typeof llm.listConfigurableProviders === 'function' ? llm.listConfigurableProviders() : []
  } catch {
    discovered = []
  }
  const providers = []
  for (const entry of Array.isArray(discovered) ? discovered : []) {
    if (entry === null || typeof entry !== 'object') continue
    const id = cleanString(entry.provider, 120)
    if (id.length === 0) continue
    providers.push({
      provider: id,
      displayName: cleanString(entry.displayName, 160) || id,
      declared: entry.declared === true,
      ...(typeof entry.error === 'string' && entry.error.length > 0 ? { error: entry.error } : {})
    })
  }
  state.providers = providers
  let changed = false
  for (const info of providers) {
    let known = false
    for (const key of Object.keys(state.ledger.routes)) {
      if (splitKey(key).provider === info.provider) {
        known = true
        break
      }
    }
    if (known) continue
    ensureRoute(state.ledger, info.provider, '*')
    changed = true
  }
  if (changed) touch(state)
}

function pickLogger(ctx) {
  const logger = ctx && ctx.logger ? ctx.logger : null
  if (logger === null || typeof logger !== 'object') return null
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : null
  if (warn === null) return null
  return (message) => {
    try {
      warn(`[dsh-sub-limits] ${message}`)
    } catch {}
  }
}

function readyWithTimeout(ready) {
  return Promise.race([ready.catch(() => {}), delay(READY_TIMEOUT_MS)])
}

export function apply(ctx, config) {
  const log = pickLogger(ctx)
  const rawConfig = config !== null && typeof config === 'object' ? config : {}
  const state = createState(join(resolveHome(), 'sub-limits-ledger.json'), normalizeConfig(rawConfig), log)
  const credentialsHolder = { service: undefined }
  try {
    ctx.inject(['credentials'], (credentialsCtx) => {
      credentialsHolder.service = credentialsCtx.credentials
    })
  } catch {}
  const opencodeKey = async () => {
    let service = credentialsHolder.service
    if ((service === undefined || service === null) && typeof ctx.get === 'function') {
      try { service = ctx.get('credentials') } catch {}
    }
    if (service !== undefined && service !== null && typeof service.resolve === 'function') {
      try {
        const resolved = await service.resolve(OPENCODE_CREDENTIAL)
        if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value.trim().length > 0) return resolved.value.trim()
      } catch {}
    }
    const environment = process.env[OPENCODE_CREDENTIAL]
    return typeof environment === 'string' && environment.trim().length > 0 ? environment.trim() : undefined
  }
  const getProviderUsage = createProviderUsage({ snapshotPath: join(resolveHome(), 'sub-limits-provider-usage.json'), configuredProviders: () => state.providers.map((entry) => entry.provider), opencodeKey })

  const ready = loadLedger(state.path, log)
    .then((ledger) => {
      state.defaults = resolveDefaults(rawConfig, ledger.defaults, ledger.userFields)
      state.ledger = ledger
    })
    .catch((error) => {
      if (log) log(`ledger load failed: ${error && error.message ? error.message : String(error)}`)
      state.ledger = emptyLedger()
    })

  ctx.effect(() => () => flush(state), 'sub-limits: flush ledger')

  ctx.on('llm/stream', (options, next) => {
    const provider = cleanString(options && options.provider, 120)
    const model = cleanString(options && options.model, 200)
    if (provider.length === 0) return next()
    const purpose = typeof (options && options.purpose) === 'string' ? options.purpose : undefined
    return (async function* observe() {
      let usage = null
      let started = false
      try {
        for await (const chunk of next()) {
          if (!started) {
            started = true
            state.activeKey = makeKey(provider, model)
          }
          const headers = headersFromChunk(chunk)
          if (headers !== undefined) {
            defer(state, ready.then(() => recordRateLimit(state, provider, model, headers, 'stream')))
          }
          if (chunk && chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage
          yield chunk
        }
      } finally {
        if (started && usage !== null) {
          defer(state, ready.then(() => recordUsage(state, provider, model, usage, purpose)))
        }
      }
    })()
  })

  ctx.on('agent/request-error', (payload, next) => {
    const provider = cleanString(payload && payload.provider, 120)
    if (provider.length > 0) {
      const failure = payload && payload.failure ? payload.failure : null
      const code = failure && typeof failure.code === 'string' ? failure.code.toLowerCase() : ''
      const status = failure ? Number(failure.status) : NaN
      if (code.includes('rate') || status === 429) {
        const retryAfter = failure ? Number(failure.providerRetryAfterMs) : NaN
        const now = Date.now()
        defer(state, ready.then(() => {
          const entry = ensureRoute(state.ledger, provider, '*')
          entry.rateLimit = {
            at: now,
            source: 'agent/request-error',
            status: Number.isFinite(status) ? status : 429,
            resetAt: Number.isFinite(retryAfter) && retryAfter > 0 ? now + retryAfter : null
          }
          touch(state)
        }))
      }
    }
    return next()
  })

  ctx.inject(['llm'], (llmCtx) => {
    const sync = () => {
      const llm = typeof llmCtx.get === 'function' ? llmCtx.get('llm') : llmCtx.llm
      defer(state, ready.then(() => syncProviders(state, llm)))
    }
    sync()
    llmCtx.on('llm/adapters-updated', () => {
      sync()
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const guard = (inner) => async (req, res) => {
        if (!fence(webCtx, req, res)) return
        await readyWithTimeout(ready)
        await inner(req, res)
      }
      const specs = [
        [STATUS_ROUTE, statusHandler(state)],
        [CONFIG_ROUTE, configHandler(state)],
        [CALIBRATE_ROUTE, calibrateHandler(state)],
        [PROVIDERS_ROUTE, providersHandler(getProviderUsage)]
      ]
      const disposers = []
      try {
        for (const [path, handler] of specs) {
          disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler: guard(handler) }))
        }
      } catch (error) {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
        throw error
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
      }
    }, 'sub-limits: routes')
  })
}
