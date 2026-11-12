import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'

function fetchLoopback(url, options) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: options.method, headers: options.headers, signal: options.signal }, async (response) => {
      try {
        const chunks = []
        let size = 0
        for await (const chunk of response) {
          size += chunk.length
          if (size > 8 * 1024 * 1024) {
            response.destroy()
            throw new Error('NATIVE_UNAVAILABLE')
          }
          chunks.push(chunk)
        }
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, json: async () => JSON.parse(raw) })
      } catch (error) { reject(error) }
    })
    request.once('error', reject)
    request.end(options.body)
  })
}

const TTL_MS = 60_000
const STALE_MS = 5 * 60_000
const FAMILIES = new Set(['codex', 'chatgpt', 'grok', 'glm', 'kiro', 'antigravity', 'cursor', 'ollama', 'kimi', 'copilot', 'devin', 'cline', 'command-code'])
const FIELDS = ['fiveHour', 'sevenDay', 'monthly', 'daily', 'unscoped']
const text = (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
const number = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : undefined
const key = (row) => `${row.provider}\0${row.accountId}`
const hasData = (row) => FIELDS.some((field) => row[field]) || row.balances?.length > 0
const staleReport = (row) => ({ ...row, stale: true, ...Object.fromEntries(FIELDS.filter((field) => row[field]).map((field) => [field, { ...row[field], stale: true }])) })

function windowField(row) {
  const minutes = number(row.windowMinutes)
  if (minutes !== undefined) {
    if (minutes === 300) return 'fiveHour'
    if (minutes === 10080) return 'sevenDay'
    if (minutes === 1440) return 'daily'
    if (minutes >= 40320 && minutes <= 44640) return 'monthly'
    return undefined
  }
  if (row.kind === 'weekly') return 'sevenDay'
  if (row.kind === 'monthly') return 'monthly'
  if (row.kind === 'daily') return 'daily'
  if (row.kind === 'product' || (row.kind === 'primary' && row.unit === 'usd')) return 'unscoped'
  return undefined
}

export function normalizeNativeSnapshot(snapshot, now = Date.now()) {
  if (!snapshot?.accounts || typeof snapshot.accounts !== 'object' || Array.isArray(snapshot.accounts)) throw new Error('NATIVE_UNAVAILABLE')
  const reports = []
  for (const [provider, family] of Object.entries(snapshot.accounts)) {
    if (!FAMILIES.has(provider) || !Array.isArray(family?.accounts)) continue
    for (const [index, account] of family.accounts.entries()) {
      if (!account || typeof account !== 'object' || !text(account.id)) continue
      const quota = account.quota ?? {}
      const updatedAt = number(quota.updatedAt)
      const base = {
        provider, accountId: text(account.id), accountIndex: index + 1,
        accountLabel: text(account.account) ?? text(quota.account),
        plan: text(quota.planLabel) ?? text(quota.planType) ?? text(account.planLabel) ?? text(account.planType),
        updatedAt: ['ready', 'stale'].includes(quota.status) && updatedAt && updatedAt > 0 ? updatedAt : null,
        status: quota.status === 'ready' ? 'ready' : quota.status === 'stale' ? 'stale' : 'unknown',
        stale: quota.status !== 'ready' || !updatedAt || now - updatedAt > STALE_MS
      }
      const groups = new Map()
      const balances = []
      for (const row of Array.isArray(quota.rows) ? quota.rows : []) {
        if (!row || row.kind === 'heading') continue
        const remaining = number(row.remaining)
        if (row.kind === 'prepaid' && remaining !== undefined) {
          balances.push({ label: text(row.product) ?? text(row.key) ?? 'credits', remaining, unit: text(row.unit) ?? 'credits' })
          continue
        }
        const field = windowField(row)
        const used = number(row.usedPercent) ?? (number(row.remainingPercent) !== undefined ? 100 - number(row.remainingPercent) : undefined)
        if (!field || used === undefined) continue
        const product = row.kind === 'product' || provider === 'antigravity' ? text(row.product) ?? '' : ''
        const group = groups.get(product) ?? { ...base, ...(product ? { meterLabel: product } : {}) }
        const resetAt = number(row.resetAt)
        const expired = resetAt !== undefined && resetAt > 0 && resetAt <= now
        const window = {
          percent: Math.min(100, Math.max(0, used)), stale: base.stale || expired,
          ...(resetAt !== undefined && resetAt > 0 ? { resetAt } : {}),
          ...(text(row.unit) ? { unit: text(row.unit) } : {}),
          ...(number(row.used) !== undefined ? { used: number(row.used) } : {}),
          ...(number(row.total) !== undefined ? { limit: number(row.total) } : {})
        }
        if (expired) group.stale = true
        if (!group[field] || group[field].percent < window.percent) group[field] = window
        groups.set(product, group)
      }
      const rows = groups.size ? [...groups.values()] : [{ ...base }]
      if (balances.length) rows[0].balances = balances
      for (const row of rows) {
        if (!hasData(row)) { row.noLimits = true; row.status = 'unknown' }
        reports.push(row)
      }
    }
  }
  return { generatedAt: now, reports }
}

export async function requestNativeSnapshot(req, refresh = false, fetchFn = fetchLoopback) {
  const port = Number(req?.socket?.localPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NATIVE_UNAVAILABLE')
  const origin = `http://127.0.0.1:${port}`
  const authority = typeof req.headers?.host === 'string' ? req.headers.host : `127.0.0.1:${port}`
  const call = async (method, payload) => {
    const response = await fetchFn(`${origin}/api/oauth-subs-auth/${method}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55_000),
      headers: { 'content-type': 'application/json', host: authority, origin: `http://${authority}`, ...(typeof req.headers?.cookie === 'string' ? { cookie: req.headers.cookie } : {}) },
      body: JSON.stringify({ payload })
    })
    if (!response.ok) throw new Error('NATIVE_UNAVAILABLE')
    const body = await response.json()
    if (body?.result?.ok !== true) throw new Error('NATIVE_UNAVAILABLE')
    return body.result.value
  }
  let snapshot
  try {
    snapshot = await call('status', { fresh: refresh, revalidateQuota: !refresh })
  } catch {
    if (refresh || req === undefined) throw new Error('NATIVE_UNAVAILABLE')
    snapshot = await call('status', { fresh: false, revalidateQuota: false })
  }
  if (!snapshot?.accounts) throw new Error('NATIVE_UNAVAILABLE')
  {
    const now = Date.now()
    await Promise.all(Object.entries(snapshot.accounts).filter(([provider]) => FAMILIES.has(provider)).flatMap(([provider, family]) =>
      (Array.isArray(family?.accounts) ? family.accounts : []).filter((account) => text(account?.id) && (refresh || account.quota?.status !== 'ready' || !number(account.quota?.updatedAt) || now - number(account.quota.updatedAt) >= TTL_MS)).map(async (account) => {
        const previous = account.quota
        let quota
        try { quota = await call('quota', { provider, id: account.id }) }
        catch { quota = { status: 'error' } }
        account.quota = (quota?.status !== 'ready' || !quota.rows?.length) && ['ready', 'stale'].includes(previous?.status) && previous.rows?.length
          ? { ...previous, status: 'stale' }
          : quota
      })
    ))
  }
  return snapshot
}

const OPENCODE_PROVIDER = 'opencode-go'
const OPENCODE_ORIGIN = 'https://opencode.ai'
const OPENCODE_TIMEOUT_MS = 15_000
const MICRO_CENTS = 100_000_000

function instantOf(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return number(value)
}

function opencodeWindow(meter, now) {
  if (meter === null || typeof meter !== 'object') return undefined
  const usedMicroCents = number(meter.usedMicroCents)
  const limitMicroCents = number(meter.limitMicroCents)
  let percent = number(meter.usagePercent) ?? number(meter.usedPercent) ?? number(meter.percent)
  if (percent === undefined && usedMicroCents !== undefined && limitMicroCents !== undefined && limitMicroCents > 0) percent = (usedMicroCents / limitMicroCents) * 100
  if (percent === undefined) return undefined
  const resetAt = instantOf(meter.resetsAt ?? meter.resetAt)
  const expired = resetAt !== undefined && resetAt > 0 && resetAt <= now
  return {
    percent: Math.min(100, Math.max(0, percent)),
    stale: expired,
    ...(resetAt !== undefined && resetAt > 0 ? { resetAt } : {}),
    ...(usedMicroCents !== undefined && limitMicroCents !== undefined
      ? { used: usedMicroCents / MICRO_CENTS, limit: limitMicroCents / MICRO_CENTS, unit: 'usd' }
      : {})
  }
}

function opencodeBase(now) {
  return { provider: OPENCODE_PROVIDER, accountId: 'api-key', accountIndex: 1, updatedAt: now, status: 'ready', stale: false }
}

export function normalizeOpencodeGoConsole(payload, now = Date.now()) {
  const access = payload !== null && typeof payload === 'object' ? payload.access : undefined
  const meters = access !== null && typeof access === 'object' ? access.meters : undefined
  if (meters === null || typeof meters !== 'object' || Array.isArray(meters)) throw new Error('OPENCODE_UNAVAILABLE')
  const report = opencodeBase(now)
  const plan = text(payload.renewalProduct) ?? text(payload.product)
  if (plan !== undefined) report.plan = plan
  const windows = [
    ['fiveHour', meters.fiveHour ?? meters.fiveHours ?? meters.rolling],
    ['sevenDay', meters.week ?? meters.weekly],
    ['monthly', meters.month ?? meters.monthly]
  ]
  for (const [field, meter] of windows) {
    const window = opencodeWindow(meter, now)
    if (window !== undefined) report[field] = window
  }
  if (!hasData(report)) throw new Error('OPENCODE_UNAVAILABLE')
  return report
}

export function normalizeOpencodeGoPercent(payload, now = Date.now()) {
  const usage = payload !== null && typeof payload === 'object' ? payload.usage ?? payload : undefined
  if (usage === null || typeof usage !== 'object') throw new Error('OPENCODE_UNAVAILABLE')
  const report = opencodeBase(now)
  for (const [field, name] of [['fiveHour', 'rolling'], ['sevenDay', 'weekly'], ['monthly', 'monthly']]) {
    const window = opencodeWindow(usage[name], now)
    if (window !== undefined) report[field] = window
  }
  if (!hasData(report)) throw new Error('OPENCODE_UNAVAILABLE')
  return report
}

export async function fetchOpencodeGoUsage(apiKey, { fetchFn = fetch, now = Date.now } = {}) {
  const key = String(apiKey ?? '').trim()
  if (key.length === 0) throw new Error('OPENCODE_UNAVAILABLE')
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  const request = async (url) => fetchFn(url, { headers, redirect: 'error', signal: AbortSignal.timeout(OPENCODE_TIMEOUT_MS) })
  try {
    const consoleResponse = await request(`${OPENCODE_ORIGIN}/console/api/go/status`)
    if (consoleResponse.ok) {
      try { return normalizeOpencodeGoConsole(await consoleResponse.json(), now()) } catch {}
    }
  } catch {}
  const percentResponse = await request(`${OPENCODE_ORIGIN}/zen/go/v1/usage`)
  if (!percentResponse.ok) throw new Error('OPENCODE_UNAVAILABLE')
  return normalizeOpencodeGoPercent(await percentResponse.json(), now())
}

export function createProviderUsage({ snapshotPath, requestSnapshot = requestNativeSnapshot, now = Date.now, configuredProviders = () => [], opencodeKey = async () => undefined, fetchOpencode = fetchOpencodeGoUsage } = {}) {
  let cached = { source: 'dsh-oauth-subs', generatedAt: null, reports: [] }
  let opencode = null
  let expiresAt = 0
  let inFlight = null
  let forced = false
  const ready = snapshotPath ? readFile(snapshotPath, 'utf8').then((raw) => {
    const saved = JSON.parse(raw)
    if (saved.source === 'dsh-oauth-subs' && Array.isArray(saved.reports)) {
      cached = { ...saved, stale: true, reports: saved.reports.map(staleReport) }
      opencode = saved.reports.find((row) => row?.provider === OPENCODE_PROVIDER && hasData(row)) ?? null
    }
  }).catch(() => {}) : Promise.resolve()

  const collectOpencode = async () => {
    let apiKey
    try { apiKey = await opencodeKey() } catch { return { status: 'absent' } }
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (trimmed.length === 0) return { status: 'absent' }
    try { return { status: 'ready', report: await fetchOpencode(trimmed, { now }) } } catch { return { status: 'failed' } }
  }

  const collect = async (req, refresh) => {
    await ready
    const opencodePromise = collectOpencode()
    let next
    try {
      const incoming = normalizeNativeSnapshot(await requestSnapshot(req, refresh), now())
      const prior = new Map()
      for (const row of cached.reports) {
        if (hasData(row)) prior.set(key(row), [...(prior.get(key(row)) ?? []), row])
      }
      const accounts = new Map()
      for (const row of incoming.reports) accounts.set(key(row), [...(accounts.get(key(row)) ?? []), row])
      const reports = []
      for (const [id, rows] of accounts) {
        const previous = prior.get(id)
        if (rows.every((row) => row.status !== 'ready' || !hasData(row)) && previous?.length) {
          reports.push(...previous.map((row) => ({ ...staleReport(row), status: 'stale' })))
        } else reports.push(...rows)
      }
      next = { source: 'dsh-oauth-subs', generatedAt: incoming.generatedAt, reports, stale: reports.some((row) => row.stale) }
    } catch {
      next = { ...cached, stale: true, code: 'NATIVE_UNAVAILABLE', reports: cached.reports.filter((row) => row.status !== 'unsupported').map((row) => ({ ...staleReport(row), status: hasData(row) ? 'stale' : 'unknown' })) }
    }
    const opencodeState = await opencodePromise
    if (opencodeState.status === 'ready') opencode = opencodeState.report
    else if (opencodeState.status === 'absent') opencode = null
    next.reports = next.reports.filter((row) => row.provider !== OPENCODE_PROVIDER)
    if (opencodeState.status === 'ready' && opencode !== null) next.reports.push(opencode)
    else if (opencodeState.status === 'failed') {
      next.reports.push(opencode !== null
        ? { ...staleReport(opencode), status: 'stale' }
        : { provider: OPENCODE_PROVIDER, accountId: 'api-key', accountIndex: 1, status: 'unknown', stale: false, updatedAt: null })
    }
    if (configuredProviders().includes('openrouter')) next.reports.push({ provider: 'openrouter', accountId: 'dsh', accountLabel: 'DSH', status: 'unsupported', noLimits: true, stale: false, updatedAt: null })
    next.stale = next.code !== undefined || next.reports.some((row) => row.stale)
    if (snapshotPath && !next.code) {
      try {
        await mkdir(dirname(snapshotPath), { recursive: true })
        const temp = `${snapshotPath}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify(next), { mode: 0o600 })
        await rename(temp, snapshotPath)
      } catch { next.persistenceError = true }
    }
    cached = next
    expiresAt = now() + TTL_MS
    return next
  }

  const get = async (req, refresh = false) => {
    await ready
    if (!refresh && expiresAt > now()) return cached
    if (inFlight) {
      if (refresh && !forced) { await inFlight; return get(req, true) }
      return inFlight
    }
    forced = refresh
    inFlight = collect(req, refresh).finally(() => { inFlight = null; forced = false })
    return inFlight
  }
  return get
}
