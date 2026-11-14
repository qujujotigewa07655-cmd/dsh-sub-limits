import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { execFile } from 'node:child_process'

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
const sanitizeText = (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
const finiteNumber = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Number(value) : undefined
const accountKey = (row) => `${row.provider}\0${row.accountId}`
const hasData = (row) => FIELDS.some((field) => row[field]) || row.balances?.length > 0
const staleReport = (row) => ({ ...row, stale: true, ...Object.fromEntries(FIELDS.filter((field) => row[field]).map((field) => [field, { ...row[field], stale: true }])) })
const clampPercent = (value) => Math.min(100, Math.max(0, value))

function windowField(row) {
  const minutes = finiteNumber(row.windowMinutes)
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
      if (!account || typeof account !== 'object' || !sanitizeText(account.id)) continue
      const quota = account.quota ?? {}
      const updatedAt = finiteNumber(quota.updatedAt)
      const base = {
        provider, accountId: sanitizeText(account.id), accountIndex: index + 1,
        accountLabel: sanitizeText(account.account) ?? sanitizeText(quota.account),
        plan: sanitizeText(quota.planLabel) ?? sanitizeText(quota.planType) ?? sanitizeText(account.planLabel) ?? sanitizeText(account.planType),
        updatedAt: ['ready', 'stale'].includes(quota.status) && updatedAt && updatedAt > 0 ? updatedAt : null,
        status: quota.status === 'ready' ? 'ready' : quota.status === 'stale' ? 'stale' : 'unknown',
        stale: quota.status !== 'ready' || !updatedAt || now - updatedAt > STALE_MS
      }
      const groups = new Map()
      const balances = []
      for (const row of Array.isArray(quota.rows) ? quota.rows : []) {
        if (!row || row.kind === 'heading') continue
        const remaining = finiteNumber(row.remaining)
        if (row.kind === 'prepaid' && remaining !== undefined) {
          balances.push({ label: sanitizeText(row.product) ?? sanitizeText(row.key) ?? 'credits', remaining, unit: sanitizeText(row.unit) ?? 'credits' })
          continue
        }
        const field = windowField(row)
        const used = finiteNumber(row.usedPercent) ?? (finiteNumber(row.remainingPercent) !== undefined ? 100 - finiteNumber(row.remainingPercent) : undefined)
        if (!field || used === undefined) continue
        const product = row.kind === 'product' || provider === 'antigravity' ? sanitizeText(row.product) ?? '' : ''
        const group = groups.get(product) ?? { ...base, ...(product ? { meterLabel: product } : {}) }
        const resetAt = finiteNumber(row.resetAt)
        const expired = resetAt !== undefined && resetAt > 0 && resetAt <= now
        const window = {
          percent: clampPercent(used), stale: base.stale || expired,
          ...(resetAt !== undefined && resetAt > 0 ? { resetAt } : {}),
          ...(sanitizeText(row.unit) ? { unit: sanitizeText(row.unit) } : {}),
          ...(finiteNumber(row.used) !== undefined ? { used: finiteNumber(row.used) } : {}),
          ...(finiteNumber(row.total) !== undefined ? { limit: finiteNumber(row.total) } : {})
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
      (Array.isArray(family?.accounts) ? family.accounts : []).filter((account) => sanitizeText(account?.id) && (refresh || account.quota?.status !== 'ready' || !finiteNumber(account.quota?.updatedAt) || now - finiteNumber(account.quota.updatedAt) >= TTL_MS)).map(async (account) => {
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
  return finiteNumber(value)
}

function opencodeWindow(meter, now) {
  if (meter === null || typeof meter !== 'object') return undefined
  const usedMicroCents = finiteNumber(meter.usedMicroCents)
  const limitMicroCents = finiteNumber(meter.limitMicroCents)
  let percent = finiteNumber(meter.usagePercent) ?? finiteNumber(meter.usedPercent) ?? finiteNumber(meter.percent)
  if (percent === undefined && usedMicroCents !== undefined && limitMicroCents !== undefined && limitMicroCents > 0) percent = (usedMicroCents / limitMicroCents) * 100
  if (percent === undefined) return undefined
  const resetAt = instantOf(meter.resetsAt ?? meter.resetAt)
  const expired = resetAt !== undefined && resetAt > 0 && resetAt <= now
  return {
    percent: clampPercent(percent),
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
  const plan = sanitizeText(payload.renewalProduct) ?? sanitizeText(payload.product)
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

const OPENROUTER_PROVIDER = 'openrouter'
const OPENROUTER_ORIGIN = 'https://openrouter.ai'
const OPENROUTER_TIMEOUT_MS = 15_000

function openrouterBase(now) {
  return { provider: OPENROUTER_PROVIDER, accountId: 'api-key', accountIndex: 1, accountLabel: 'DSH', updatedAt: now, status: 'ready', stale: false }
}

export function normalizeOpenrouterUsage(creditsPayload, keyPayload, now = Date.now()) {
  const credits = creditsPayload !== null && typeof creditsPayload === 'object' ? creditsPayload.data : undefined
  const keyInfo = keyPayload !== null && typeof keyPayload === 'object' ? keyPayload.data : undefined
  const balances = []
  const purchased = finiteNumber(credits?.total_credits)
  const spent = finiteNumber(credits?.total_usage)
  if (purchased !== undefined && spent !== undefined) {
    balances.push({ label: 'account', remaining: purchased - spent, used: spent, limit: purchased, unit: 'usd' })
  }
  const keyRemaining = finiteNumber(keyInfo?.limit_remaining)
  if (keyRemaining !== undefined) {
    const keyUsed = finiteNumber(keyInfo?.usage)
    const keyLimit = finiteNumber(keyInfo?.limit)
    balances.push({
      label: 'key', remaining: keyRemaining, unit: 'usd',
      ...(keyUsed !== undefined ? { used: keyUsed } : {}),
      ...(keyLimit !== undefined ? { limit: keyLimit } : {})
    })
  }
  if (balances.length === 0) throw new Error('OPENROUTER_UNAVAILABLE')
  return { ...openrouterBase(now), balances }
}

export async function fetchOpenrouterUsage(apiKey, { fetchFn = fetch, now = Date.now } = {}) {
  const key = String(apiKey ?? '').trim()
  if (key.length === 0) throw new Error('OPENROUTER_UNAVAILABLE')
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  const request = async (path) => {
    try {
      const response = await fetchFn(`${OPENROUTER_ORIGIN}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS) })
      if (!response.ok) return undefined
      return await response.json()
    } catch { return undefined }
  }
  const [credits, keyInfo] = await Promise.all([request('/api/v1/credits'), request('/api/v1/key')])
  return normalizeOpenrouterUsage(credits, keyInfo, now())
}

const ALIBABA_PROVIDER = 'alibaba-token-plan'
const ALIBABA_CLI = 'bl'
const ALIBABA_CONSOLE_REGION = 'ap-southeast-1'
const ALIBABA_CONSOLE_SITE = 'international'
const ALIBABA_TIMEOUT_MS = 30_000
const ALIBABA_API_PREFIX = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/'

function alibabaBase(now) {
  return { provider: ALIBABA_PROVIDER, accountId: 'api-key', accountIndex: 1, accountLabel: 'Token Plan', updatedAt: now, status: 'ready', stale: false }
}

function alibabaConsolePayload(stdout) {
  const inner = JSON.parse(stdout)?.data?.DataV2?.data
  if (inner?.code !== 'SUCCESS' || inner?.data === null || typeof inner?.data !== 'object') throw new Error('ALIBABA_UNAVAILABLE')
  return inner.data
}

function runAlibabaConsole(api) {
  return new Promise((resolve, reject) => {
    execFile(ALIBABA_CLI, [
      'console', 'call', '--api', `${ALIBABA_API_PREFIX}${api}`, '--data', '{}',
      '--console-region', ALIBABA_CONSOLE_REGION, '--console-site', ALIBABA_CONSOLE_SITE, '--output', 'json'
    ], { timeout: ALIBABA_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(error); return }
      try { resolve(alibabaConsolePayload(stdout)) } catch (parseError) { reject(parseError) }
    })
  })
}

export function normalizeAlibabaTokenPlan(usagePayload, subscriptionPayload, quotaPayload, now = Date.now()) {
  const fraction = finiteNumber(usagePayload?.per1MonthPercentage)
  const tier = sanitizeText(subscriptionPayload?.specCode)
  const limit = finiteNumber(tier !== undefined ? quotaPayload?.[tier]?.monthly : undefined)
  if (fraction === undefined || limit === undefined || limit <= 0) throw new Error('ALIBABA_UNAVAILABLE')
  const resetAt = instantOf(usagePayload?.per1MonthResetTime)
  const window = {
    percent: clampPercent(fraction * 100),
    used: fraction * limit,
    limit,
    unit: 'credits',
    stale: resetAt !== undefined && resetAt > 0 && resetAt <= now
  }
  if (resetAt !== undefined && resetAt > 0) window.resetAt = resetAt
  return { ...alibabaBase(now), ...(tier !== undefined ? { meterLabel: tier } : {}), monthly: window }
}

export async function fetchAlibabaTokenPlanUsage({ runConsole = runAlibabaConsole, now = Date.now } = {}) {
  const [usagePayload, subscriptionPayload, quotaPayload] = await Promise.all([
    runConsole('usage'), runConsole('subscription'), runConsole('quota-config')
  ])
  return normalizeAlibabaTokenPlan(usagePayload, subscriptionPayload, quotaPayload, now())
}

const DEEPSEEK_PROVIDER = 'deepseek-official'
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const DEEPSEEK_TIMEOUT_MS = 15_000

function deepseekBase(now) {
  return { provider: DEEPSEEK_PROVIDER, accountId: 'api-key', accountIndex: 1, accountLabel: 'DSH', updatedAt: now, status: 'ready', stale: false }
}

function deepseekPeakAt(instant) {
  const date = new Date(instant)
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

function deepseekNextChange(instant) {
  const current = deepseekPeakAt(instant)
  let cursor = Math.floor(instant / 3_600_000) * 3_600_000 + 3_600_000
  for (let step = 0; step < 24 * 8; step += 1) {
    if (deepseekPeakAt(cursor) !== current) return cursor
    cursor += 3_600_000
  }
  return undefined
}

export function deepseekPricing(now = Date.now()) {
  const until = deepseekNextChange(now)
  return { pricing: deepseekPeakAt(now) ? 'peak' : 'off-peak', ...(until !== undefined ? { pricingUntil: until } : {}) }
}

export function normalizeDeepseekBalance(payload, now = Date.now()) {
  const info = Array.isArray(payload?.balance_infos) ? payload.balance_infos.find((entry) => entry !== null && typeof entry === 'object') : undefined
  const total = finiteNumber(info?.total_balance)
  const currency = sanitizeText(info?.currency)?.toLowerCase()
  if (total === undefined || currency === undefined) throw new Error('DEEPSEEK_UNAVAILABLE')
  const balances = [{ label: 'balance', remaining: total, unit: currency }]
  const granted = finiteNumber(info.granted_balance)
  if (granted !== undefined) balances.push({ label: 'granted', remaining: granted, unit: currency })
  const toppedUp = finiteNumber(info.topped_up_balance)
  if (toppedUp !== undefined) balances.push({ label: 'topped up', remaining: toppedUp, unit: currency })
  return { ...deepseekBase(now), ...deepseekPricing(now), balances }
}

export async function fetchDeepseekBalance(apiKey, { fetchFn = fetch, now = Date.now } = {}) {
  const key = String(apiKey ?? '').trim()
  if (key.length === 0) throw new Error('DEEPSEEK_UNAVAILABLE')
  const response = await fetchFn(DEEPSEEK_BALANCE_URL, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error('DEEPSEEK_UNAVAILABLE')
  return normalizeDeepseekBalance(await response.json(), now())
}

export function createProviderUsage({ snapshotPath, requestSnapshot = requestNativeSnapshot, now = Date.now, configuredProviders = () => [], opencodeKey = async () => undefined, fetchOpencode = fetchOpencodeGoUsage, openrouterKey = async () => undefined, fetchOpenrouter = fetchOpenrouterUsage, fetchAlibaba = fetchAlibabaTokenPlanUsage, deepseekKey = async () => undefined, fetchDeepseek = fetchDeepseekBalance } = {}) {
  let cached = { source: 'dsh-oauth-subs', generatedAt: null, reports: [] }
  let opencode = null
  let openrouter = null
  let alibaba = null
  let deepseek = null
  let expiresAt = 0
  let inFlight = null
  let forced = false
  const ready = snapshotPath ? readFile(snapshotPath, 'utf8').then((raw) => {
    const saved = JSON.parse(raw)
    if (saved.source === 'dsh-oauth-subs' && Array.isArray(saved.reports)) {
      cached = { ...saved, stale: true, reports: saved.reports.map(staleReport) }
      opencode = saved.reports.find((row) => row?.provider === OPENCODE_PROVIDER && hasData(row)) ?? null
      openrouter = saved.reports.find((row) => row?.provider === OPENROUTER_PROVIDER && hasData(row)) ?? null
      alibaba = saved.reports.find((row) => row?.provider === ALIBABA_PROVIDER && hasData(row)) ?? null
      deepseek = saved.reports.find((row) => row?.provider === DEEPSEEK_PROVIDER && hasData(row)) ?? null
    }
  }).catch(() => {}) : Promise.resolve()

  const collectOpencode = async () => {
    let apiKey
    try { apiKey = await opencodeKey() } catch { return { status: 'absent' } }
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (trimmed.length === 0) return { status: 'absent' }
    try { return { status: 'ready', report: await fetchOpencode(trimmed, { now }) } } catch { return { status: 'failed' } }
  }

  const collectOpenrouter = async () => {
    if (!configuredProviders().includes(OPENROUTER_PROVIDER)) return { status: 'absent' }
    let apiKey
    try { apiKey = await openrouterKey() } catch { return { status: 'absent' } }
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (trimmed.length === 0) return { status: 'absent' }
    try { return { status: 'ready', report: await fetchOpenrouter(trimmed, { now }) } } catch { return { status: 'failed' } }
  }

  const collectAlibaba = async () => {
    if (!configuredProviders().includes(ALIBABA_PROVIDER)) return { status: 'absent' }
    try { return { status: 'ready', report: await fetchAlibaba({ now }) } } catch (error) { return { status: error?.code === 'ENOENT' ? 'absent' : 'failed' } }
  }

  const collectDeepseek = async () => {
    if (!configuredProviders().includes(DEEPSEEK_PROVIDER)) return { status: 'absent' }
    let apiKey
    try { apiKey = await deepseekKey() } catch { return { status: 'absent' } }
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (trimmed.length === 0) return { status: 'absent' }
    try { return { status: 'ready', report: await fetchDeepseek(trimmed, { now }) } } catch { return { status: 'failed' } }
  }

  const collect = async (req, refresh) => {
    await ready
    const opencodePromise = collectOpencode()
    const openrouterPromise = collectOpenrouter()
    const alibabaPromise = collectAlibaba()
    const deepseekPromise = collectDeepseek()
    let next
    try {
      const incoming = normalizeNativeSnapshot(await requestSnapshot(req, refresh), now())
      const prior = new Map()
      for (const row of cached.reports) {
        if (hasData(row)) prior.set(accountKey(row), [...(prior.get(accountKey(row)) ?? []), row])
      }
      const accounts = new Map()
      for (const row of incoming.reports) accounts.set(accountKey(row), [...(accounts.get(accountKey(row)) ?? []), row])
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
        : { ...opencodeBase(null), status: 'unknown' })
    }
    const openrouterState = await openrouterPromise
    if (openrouterState.status === 'ready') openrouter = openrouterState.report
    else if (openrouterState.status === 'absent') openrouter = null
    next.reports = next.reports.filter((row) => row.provider !== OPENROUTER_PROVIDER)
    if (openrouterState.status === 'ready' && openrouter !== null) next.reports.push(openrouter)
    else if (openrouterState.status === 'failed') {
      next.reports.push(openrouter !== null
        ? { ...staleReport(openrouter), status: 'stale' }
        : { ...openrouterBase(null), status: 'unknown' })
    }
    const alibabaState = await alibabaPromise
    if (alibabaState.status === 'ready') alibaba = alibabaState.report
    else if (alibabaState.status === 'absent') alibaba = null
    next.reports = next.reports.filter((row) => row.provider !== ALIBABA_PROVIDER)
    if (alibabaState.status === 'ready' && alibaba !== null) next.reports.push(alibaba)
    else if (alibabaState.status === 'failed') {
      next.reports.push(alibaba !== null
        ? { ...staleReport(alibaba), status: 'stale' }
        : { ...alibabaBase(null), status: 'unknown' })
    }
    const deepseekState = await deepseekPromise
    if (deepseekState.status === 'ready') deepseek = deepseekState.report
    else if (deepseekState.status === 'absent') deepseek = null
    next.reports = next.reports.filter((row) => row.provider !== DEEPSEEK_PROVIDER)
    if (deepseekState.status === 'ready' && deepseek !== null) next.reports.push(deepseek)
    else if (deepseekState.status === 'failed') {
      next.reports.push(deepseek !== null
        ? { ...staleReport(deepseek), status: 'stale', ...deepseekPricing(now()) }
        : { ...deepseekBase(null), status: 'unknown', ...deepseekPricing(now()) })
    }
    next.stale = next.code !== undefined || next.reports.some((row) => row.stale)
    if (snapshotPath && !next.code) {
      const temp = `${snapshotPath}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(snapshotPath), { recursive: true })
        await writeFile(temp, JSON.stringify(next), { mode: 0o600 })
        await rename(temp, snapshotPath)
      } catch {
        next.persistenceError = true
        try { await rm(temp, { force: true }) } catch {}
      }
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
