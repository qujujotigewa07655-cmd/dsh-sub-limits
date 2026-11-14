import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as usage from './provider-usage.js'
import { createServer } from 'node:http'

for (const authority of ['catadogs.duckdns.org', '192.168.1.184:3080', 'localhost:3080', '127.0.0.1:3080']) {
  test(`native bridge preserves browser authentication for ${authority}`, async (t) => {
    const calls = []
    const server = createServer((req, res) => {
      calls.push({ path: req.url, host: req.headers.host, origin: req.headers.origin })
      if (req.headers.host !== authority || req.headers.cookie !== 'authority-bound-session=test') {
        res.writeHead(401).end()
        return
      }
      res.setHeader('content-type', 'application/json')
      const value = req.url.endsWith('/status') ? account(good) : { ...good, updatedAt: Date.now() }
      res.end(JSON.stringify({ result: { ok: true, value } }))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    })
    const result = await usage.requestNativeSnapshot({ socket: { localPort: server.address().port }, headers: { host: authority, cookie: 'authority-bound-session=test' } }, true)
    assert.equal(result.accounts.codex.accounts[0].quota.status, 'ready')
    assert.equal(result.accounts.codex.accounts[0].quota.rows[0].usedPercent, 23)
    assert.deepEqual(calls, [
      { path: '/api/oauth-subs-auth/status', host: authority, origin: `http://${authority}` },
      { path: '/api/oauth-subs-auth/quota', host: authority, origin: `http://${authority}` }
    ])
  })
}

test('native bridge refuses redirects without forwarding browser cookies', async (t) => {
  let redirected = false
  const server = createServer((req, res) => {
    if (req.url === '/redirect-target') {
      redirected = true
      res.end('{}')
    } else res.writeHead(302, { location: '/redirect-target' }).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  await assert.rejects(usage.requestNativeSnapshot({ socket: { localPort: server.address().port }, headers: { host: 'catadogs.duckdns.org', cookie: 'authority-bound-session=test' } }, true), /NATIVE_UNAVAILABLE/)
  assert.equal(redirected, false)
})

const now = 1793688000000
const account = (quota) => ({ accounts: { codex: { accounts: [{ id: 'one', account: 'test@example.com', quota }] } } })
const good = { status: 'ready', updatedAt: now, rows: [{ kind: 'primary', usedPercent: 23, windowMinutes: 300, resetAt: now + 3600000 }, { kind: 'weekly', usedPercent: 51, windowMinutes: 10080 }] }

test('Antigravity fallback percentages do not invent a five-hour duration', () => {
  const result = usage.normalizeNativeSnapshot({ accounts: { antigravity: { accounts: [{ id: 'a', quota: { status: 'ready', updatedAt: now, rows: [{ kind: 'product', product: 'Gemini', usedPercent: 33, resetAt: now + 3600000 }] } }] } } }, now)
  assert.equal(result.reports[0].fiveHour, undefined)
  assert.equal(result.reports[0].unscoped.percent, 33)
  assert.equal(result.reports[0].unscoped.resetAt, now + 3600000)
})

test('native quota adapter preserves windows and ignores missing percentages', () => {
  assert.equal(typeof usage.normalizeNativeSnapshot, 'function')
  const result = usage.normalizeNativeSnapshot(account(good), now)
  assert.equal(result.reports[0].fiveHour.percent, 23)
  assert.equal(result.reports[0].sevenDay.percent, 51)
  assert.equal(result.reports[0].fiveHour.resetAt, now + 3600000)
  const empty = usage.normalizeNativeSnapshot(account({ status: 'ready', rows: [{ kind: 'primary', usedPercent: null }] }), now)
  assert.equal(empty.reports[0].fiveHour, undefined)
  assert.equal(empty.reports[0].status, 'unknown')
})

test('Antigravity pools retain independent primary and weekly windows', () => {
  assert.equal(typeof usage.normalizeNativeSnapshot, 'function')
  const result = usage.normalizeNativeSnapshot({ accounts: { antigravity: { accounts: [{ id: 'a', quota: { status: 'ready', updatedAt: now, rows: [{ kind: 'heading', product: 'Gemini Models' }, { kind: 'primary', product: 'Gemini Models', usedPercent: 15, windowMinutes: 300 }, { kind: 'weekly', product: 'Gemini Models', usedPercent: 45 }, { kind: 'primary', product: 'Claude and GPT models', usedPercent: 70, windowMinutes: 300 }] } }] } } }, now)
  assert.equal(result.reports.length, 2)
  assert.equal(result.reports[0].sevenDay.percent, 45)
  assert.equal(result.reports[1].fiveHour.percent, 70)
})

test('native collector persists last-good quotas and marks failures stale without leaking errors', async (t) => {
  assert.equal(typeof usage.createProviderUsage, 'function')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-native-'))
  assert.ok(directory.startsWith(join(tmpdir(), 'dsh-native-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  let fail = false
  const collect = usage.createProviderUsage({ snapshotPath: path, now: () => now, requestSnapshot: async () => { if (fail) throw new Error('secret-token'); return account(good) } })
  assert.equal((await collect({}, true)).reports[0].fiveHour.percent, 23)
  fail = true
  const stale = await collect({}, true)
  assert.equal(stale.stale, true)
  assert.equal(stale.reports[0].fiveHour.percent, 23)
  assert.equal(stale.reports[0].stale, true)
  assert.equal(stale.reports[0].fiveHour.stale, true)
  assert.equal(JSON.stringify(stale).includes('secret-token'), false)
  assert.equal((await readFile(path, 'utf8')).includes('accessToken'), false)
  const restarted = usage.createProviderUsage({ snapshotPath: path, now: () => now, requestSnapshot: async () => { throw new Error('offline') } })
  assert.equal((await restarted({}, true)).reports[0].fiveHour.percent, 23)
})

test('partial account failure retains only that account last-good data', async () => {
  assert.equal(typeof usage.createProviderUsage, 'function')
  let value = account(good)
  const collect = usage.createProviderUsage({ now: () => now, requestSnapshot: async () => value })
  await collect({}, true)
  value = account({ status: 'error', error: 'secret-token', rows: [] })
  const stale = await collect({}, true)
  assert.equal(stale.reports[0].fiveHour.percent, 23)
  assert.equal(stale.reports[0].stale, true)
  value = { accounts: { codex: { accounts: [] } } }
  assert.equal((await collect({}, true)).reports.length, 0)
})

test('bridge pins the local origin and never forwards credentials on redirects', async () => {
  assert.equal(typeof usage.requestNativeSnapshot, 'function')
  let target, options
  await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: { cookie: 'session=test', host: 'attacker.invalid' } }, true, async (url, init) => {
    target = url; options = init
    return { ok: true, json: async () => ({ result: { ok: true, value: { accounts: {} } } }) }
  })
  assert.equal(target, 'http://127.0.0.1:3080/api/oauth-subs-auth/status')
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers.cookie, 'session=test')
  assert.equal(JSON.parse(options.body).payload.fresh, true)
})

test('configured OpenRouter without a stored key shows no row and reads no OMP accounts', async () => {
  const collect = usage.createProviderUsage({ requestSnapshot: async () => ({ accounts: {} }), configuredProviders: () => ['openrouter'] })
  const result = await collect({}, true)
  assert.equal(result.reports.length, 0)
})

test('manual refresh requests account quotas only for supported native families', async () => {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body).payload })
    const value = url.endsWith('/status') ? { accounts: { codex: { accounts: [{ id: 'one', quota: { status: 'idle' } }] }, openrouter: { accounts: [{ id: 'key' }] } } } : good
    return { ok: true, json: async () => ({ result: { ok: true, value } }) }
  }
  const result = await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, true, fetchFn)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].payload, { provider: 'codex', id: 'one' })
  assert.equal(result.accounts.codex.accounts[0].quota.status, 'ready')
})

test('failed revalidated status falls back to the cheap cached snapshot', async () => {
  const calls = []
  const fetchFn = async (url, options) => {
    const payload = JSON.parse(options.body).payload
    calls.push(payload)
    if (payload.revalidateQuota) throw Object.assign(new Error('timeout'), { code: 'ABORT_ERR' })
    return { ok: true, json: async () => ({ result: { ok: true, value: { accounts: { codex: { accounts: [{ id: 'one', quota: { ...good, updatedAt: Date.now() } }] } } } } }) }
  }
  const result = await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, false, fetchFn)
  assert.deepEqual(calls, [{ fresh: false, revalidateQuota: true }, { fresh: false, revalidateQuota: false }])
  assert.equal(result.accounts.codex.accounts[0].quota.status, 'ready')
})

test('invalid JSON numeric types never fabricate quota percentages', () => {
  for (const invalid of [false, true, [], [7], {}, '   ']) {
    for (const field of ['usedPercent', 'remainingPercent']) {
      const result = usage.normalizeNativeSnapshot(account({ status: 'ready', updatedAt: now, rows: [{ kind: 'primary', windowMinutes: 300, [field]: invalid }] }), now)
      assert.equal(result.reports[0].fiveHour, undefined, `${field}: ${JSON.stringify(invalid)}`)
    }
  }
  const valid = usage.normalizeNativeSnapshot(account({ ...good, rows: [{ kind: 'primary', windowMinutes: '300', usedPercent: '23.5' }] }), now)
  assert.equal(valid.reports[0].fiveHour.percent, 23.5)
})

test('a keyless OpenRouter stays absent during native failures', async () => {
  let fail = false
  const collect = usage.createProviderUsage({ now: () => now, configuredProviders: () => ['openrouter'], requestSnapshot: async () => {
    if (fail) throw new Error('offline')
    return account(good)
  } })
  await collect({}, true)
  fail = true
  const failed = await collect({}, true)
  assert.equal(failed.reports.some((row) => row.provider === 'openrouter'), false)
  assert.equal(failed.reports.find((row) => row.provider === 'codex').status, 'stale')
})

test('a keyless OpenRouter adds no row on a cold native failure', async () => {
  const collect = usage.createProviderUsage({ configuredProviders: () => ['openrouter'], requestSnapshot: async () => { throw new Error('offline') } })
  const result = await collect({})
  assert.equal(result.reports.length, 0)
})

test('automatic poll refreshes aged native quotas instead of trusting status revalidation', async () => {
  const aged = { ...good, updatedAt: Date.now() - 900_000 }
  const current = { ...good, updatedAt: Date.now(), rows: [{ kind: 'primary', windowMinutes: 300, usedPercent: 62 }] }
  const methods = []
  const result = await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, false, async (url) => {
    methods.push(url.split('/').at(-1))
    return { ok: true, json: async () => ({ result: { ok: true, value: url.endsWith('/status') ? account(aged) : current } }) }
  })
  assert.equal(result.accounts.codex.accounts[0].quota.updatedAt, current.updatedAt)
  assert.equal(usage.normalizeNativeSnapshot(result).reports[0].fiveHour.percent, 62)
  assert.deepEqual(methods, ['status', 'quota'])
})

test('automatic poll does not force a quota younger than the native cache interval', async () => {
  const current = { ...good, updatedAt: Date.now() }
  let calls = 0
  const result = await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, false, async () => {
    calls += 1
    return { ok: true, json: async () => ({ result: { ok: true, value: account(current) } }) }
  })
  assert.equal(result.accounts.codex.accounts[0].quota.updatedAt, current.updatedAt)
  assert.equal(calls, 1)
})

test('expired collector cache recovers automatically after a transient failure', async () => {
  let at = now
  let fail = false
  let snapshot = account(good)
  const collect = usage.createProviderUsage({ now: () => at, requestSnapshot: async () => { if (fail) throw new Error('offline'); return snapshot } })
  await collect({})
  at += 61_000
  fail = true
  assert.equal((await collect({})).code, 'NATIVE_UNAVAILABLE')
  at += 61_000
  fail = false
  snapshot = account({ ...good, updatedAt: at })
  const recovered = await collect({})
  assert.equal(recovered.code, undefined)
  assert.equal(recovered.stale, false)
  assert.equal(recovered.generatedAt, at)
})

test('failed account refresh marks every preserved window stale', async () => {
  let snapshot = account(good)
  const collect = usage.createProviderUsage({ now: () => now, requestSnapshot: async () => snapshot })
  await collect({}, true)
  snapshot = account({ status: 'error', rows: [] })
  const result = await collect({}, true)
  assert.equal(result.reports[0].fiveHour.stale, true)
  assert.equal(result.reports[0].sevenDay.stale, true)
  assert.equal(result.reports[0].updatedAt, now)
})

test('expired provider windows are retained as stale readings without inventing a reset', () => {
  const result = usage.normalizeNativeSnapshot(account({ ...good, rows: [{ kind: 'primary', windowMinutes: 300, usedPercent: 100, resetAt: now - 1000 }] }), now)
  assert.equal(result.reports[0].fiveHour.percent, 100)
  assert.equal(result.reports[0].fiveHour.stale, true)
  assert.equal(result.reports[0].stale, true)
})

test('native dollar allowances retain their period and purchased currency', () => {
  const result = usage.normalizeNativeSnapshot(account({ ...good, rows: [
    { kind: 'primary', usedPercent: 20, used: 2, total: 10, unit: 'usd', resetAt: now + 86400000 },
    { kind: 'prepaid', key: 'purchased', remaining: 3, unit: 'usd' }
  ] }), now)
  assert.equal(result.reports[0].fiveHour, undefined)
  assert.equal(result.reports[0].unscoped.percent, 20)
  assert.equal(result.reports[0].unscoped.unit, 'usd')
  assert.equal(result.reports[0].unscoped.used, 2)
  assert.equal(result.reports[0].unscoped.limit, 10)
  assert.equal(result.reports[0].balances[0].unit, 'usd')
  assert.equal(result.reports[0].balances[0].remaining, 3)
})

test('a failed quota refresh preserves the native successful time on a cold collector', async () => {
  const result = await usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, true, async (url) => ({
    ok: true, json: async () => ({ result: { ok: true, value: url.endsWith('/status') ? account(good) : { status: 'error', updatedAt: Date.now(), rows: good.rows } } })
  }))
  const normalized = usage.normalizeNativeSnapshot(result)
  assert.equal(normalized.reports[0].updatedAt, now)
  assert.equal(normalized.reports[0].status, 'stale')
  assert.equal(normalized.reports[0].fiveHour.percent, 23)
})

test('failed cheap status on manual refresh propagates the failure', async () => {
  let calls = 0
  const fetchFn = async () => { calls += 1; throw new Error('down') }
  await assert.rejects(usage.requestNativeSnapshot({ socket: { localPort: 3080 }, headers: {} }, true, fetchFn), /NATIVE_UNAVAILABLE/)
  assert.equal(calls, 1)
})

const opencodeConsole = {
  product: 'go',
  renewalProduct: 'go',
  access: {
    startsAt: '2026-11-06T16:17:42.000Z',
    endsAt: '2026-12-06T16:17:42.000Z',
    meters: {
      fiveHour: { resetsAt: '2026-11-07T17:04:00.000Z', limitMicroCents: '1200000000', usedMicroCents: '3049328' },
      week: { resetsAt: '2026-11-09T00:00:00.000Z', limitMicroCents: '3000000000', usedMicroCents: '242248638' },
      month: { resetsAt: '2026-12-06T16:17:42.000Z', limitMicroCents: '6000000000', usedMicroCents: '150000000' }
    }
  }
}
const opencodePercent = {
  usage: {
    rolling: { status: 'ok', percent: 11, resetsAt: '2026-11-07T17:04:00.000Z' },
    weekly: { status: 'ok', percent: 8, resetsAt: '2026-11-09T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 4, resetsAt: '2026-12-06T16:17:42.000Z' }
  }
}

test('opencode go console meters become 5h, 7d and 30d dollar windows', () => {
  const report = usage.normalizeOpencodeGoConsole(opencodeConsole, now)
  assert.equal(report.provider, 'opencode-go')
  assert.equal(report.plan, 'go')
  assert.equal(report.fiveHour.percent, 0.25411066666666666)
  assert.equal(Math.round(report.fiveHour.percent * 100) / 100, 0.25)
  assert.equal(report.fiveHour.used, 0.03049328)
  assert.equal(report.fiveHour.limit, 12)
  assert.equal(report.fiveHour.unit, 'usd')
  assert.equal(report.fiveHour.resetAt, Date.parse('2026-11-07T17:04:00.000Z'))
  assert.equal(Math.round(report.sevenDay.percent), 8)
  assert.equal(Math.round(report.monthly.percent), 3)
})

test('opencode go percent payload carries the three subscription windows', () => {
  const report = usage.normalizeOpencodeGoPercent(opencodePercent, now)
  assert.equal(report.fiveHour.percent, 11)
  assert.equal(report.sevenDay.percent, 8)
  assert.equal(report.monthly.percent, 4)
  assert.equal(report.fiveHour.resetAt, Date.parse('2026-11-07T17:04:00.000Z'))
  assert.throws(() => usage.normalizeOpencodeGoPercent({ usage: {} }, now), /OPENCODE_UNAVAILABLE/)
  assert.throws(() => usage.normalizeOpencodeGoConsole({ access: null }, now), /OPENCODE_UNAVAILABLE/)
})

test('opencode go keeps its percentages when the console route is unavailable', async () => {
  const targets = []
  const fetchFn = async (url) => {
    targets.push(url)
    if (url.includes('/console/api/go/status')) return { ok: false, status: 401, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => opencodePercent }
  }
  const report = await usage.fetchOpencodeGoUsage('sk-test-key', { fetchFn, now: () => now })
  assert.deepEqual(targets, ['https://opencode.ai/console/api/go/status', 'https://opencode.ai/zen/go/v1/usage'])
  assert.equal(report.fiveHour.percent, 11)
})

test('opencode go subscriptions join the provider usage panel', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-opencode-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  const collect = usage.createProviderUsage({
    snapshotPath: path, now: () => now, requestSnapshot: async () => account(good),
    opencodeKey: async () => 'sk-secret-key', fetchOpencode: async () => usage.normalizeOpencodeGoConsole(opencodeConsole, now)
  })
  const result = await collect({}, true)
  const report = result.reports.find((row) => row.provider === 'opencode-go')
  assert.equal(report.fiveHour.percent, 0.25411066666666666)
  assert.equal(result.reports.find((row) => row.provider === 'codex').fiveHour.percent, 23)
  assert.equal((await readFile(path, 'utf8')).includes('sk-secret-key'), false)
})

test('a failed opencode go read keeps the last percentages as stale', async () => {
  let fail = false
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), opencodeKey: async () => 'sk-secret-key',
    fetchOpencode: async () => { if (fail) throw new Error('offline'); return usage.normalizeOpencodeGoPercent(opencodePercent, now) }
  })
  await collect({}, true)
  fail = true
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'opencode-go')
  assert.equal(report.fiveHour.percent, 11)
  assert.equal(report.stale, true)
  assert.equal(report.fiveHour.stale, true)
})

test('opencode go without a stored key shows no row, and a rejected key stays unknown', async () => {
  const absent = usage.createProviderUsage({ now: () => now, requestSnapshot: async () => account(good) })
  assert.equal((await absent({}, true)).reports.some((row) => row.provider === 'opencode-go'), false)
  const rejected = usage.createProviderUsage({ now: () => now, requestSnapshot: async () => account(good), opencodeKey: async () => 'sk-bad', fetchOpencode: async () => { throw new Error('offline') } })
  const report = (await rejected({}, true)).reports.find((row) => row.provider === 'opencode-go')
  assert.equal(report.status, 'unknown')
  assert.equal(report.noLimits, undefined)
})

test('a failed snapshot rename removes the temporary file', async (t) => {
  const { mkdir, readdir } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sub-limits-tmp-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  await mkdir(path)
  const collect = usage.createProviderUsage({ snapshotPath: path, now: () => now, requestSnapshot: async () => account(good) })
  const result = await collect({}, true)
  assert.equal(result.persistenceError, true)
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith('.tmp')), [])
})

const openrouterCredits = { data: { total_credits: 41, total_usage: 35.287368955 } }
const openrouterKeyInfo = { data: { label: 'sk-or-v1-8d7...086', limit: 10, limit_reset: null, limit_remaining: 3.8852277539999998, usage: 6.114772246, is_free_tier: false } }

test('openrouter reports the account balance first and the key limit second', () => {
  const report = usage.normalizeOpenrouterUsage(openrouterCredits, openrouterKeyInfo, now)
  assert.equal(report.provider, 'openrouter')
  assert.equal(report.status, 'ready')
  assert.equal(report.stale, false)
  assert.equal(report.updatedAt, now)
  assert.equal(report.balances.length, 2)
  assert.equal(report.balances[0].label, 'account')
  assert.equal(Math.round(report.balances[0].remaining * 100) / 100, 5.71)
  assert.equal(report.balances[0].used, 35.287368955)
  assert.equal(report.balances[0].limit, 41)
  assert.equal(report.balances[0].unit, 'usd')
  assert.equal(report.balances[1].label, 'key')
  assert.equal(report.balances[1].remaining, 3.8852277539999998)
  assert.equal(report.balances[1].used, 6.114772246)
  assert.equal(report.balances[1].limit, 10)
  assert.equal(report.balances[1].unit, 'usd')
  assert.equal(JSON.stringify(report).includes('sk-or-v1'), false)
})

test('openrouter keeps the account balance when the key has no limit', () => {
  const report = usage.normalizeOpenrouterUsage(openrouterCredits, { data: { limit: null, limit_remaining: null, usage: 6 } }, now)
  assert.equal(report.balances.length, 1)
  assert.equal(report.balances[0].label, 'account')
  assert.throws(() => usage.normalizeOpenrouterUsage({}, {}, now), /OPENROUTER_UNAVAILABLE/)
  assert.throws(() => usage.normalizeOpenrouterUsage(null, null, now), /OPENROUTER_UNAVAILABLE/)
})

test('openrouter falls back to the key balance when credits are unavailable', () => {
  const report = usage.normalizeOpenrouterUsage(undefined, openrouterKeyInfo, now)
  assert.equal(report.balances.length, 1)
  assert.equal(report.balances[0].label, 'key')
  assert.equal(report.balances[0].remaining, 3.8852277539999998)
})

test('openrouter reads both real routes and tolerates one of them failing', async () => {
  const targets = []
  const fetchFn = async (url, options) => {
    targets.push(url)
    assert.equal(options.headers.authorization, 'Bearer sk-or-test')
    assert.equal(options.redirect, 'error')
    if (url.endsWith('/api/v1/credits')) return { ok: true, json: async () => openrouterCredits }
    return { ok: false, status: 401, json: async () => ({}) }
  }
  const report = await usage.fetchOpenrouterUsage('sk-or-test', { fetchFn, now: () => now })
  assert.deepEqual(targets, ['https://openrouter.ai/api/v1/credits', 'https://openrouter.ai/api/v1/key'])
  assert.equal(report.balances.length, 1)
  assert.equal(report.balances[0].label, 'account')
  await assert.rejects(usage.fetchOpenrouterUsage('   ', { fetchFn, now: () => now }), /OPENROUTER_UNAVAILABLE/)
})

test('openrouter balances join the provider usage panel without leaking the key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-openrouter-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  const collect = usage.createProviderUsage({
    snapshotPath: path, now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['openrouter'],
    openrouterKey: async () => 'sk-or-secret', fetchOpenrouter: async () => usage.normalizeOpenrouterUsage(openrouterCredits, openrouterKeyInfo, now)
  })
  const result = await collect({}, true)
  const report = result.reports.find((row) => row.provider === 'openrouter')
  assert.equal(report.balances[0].label, 'account')
  assert.equal(report.balances[1].label, 'key')
  assert.equal(result.reports.find((row) => row.provider === 'codex').fiveHour.percent, 23)
  assert.equal((await readFile(path, 'utf8')).includes('sk-or-secret'), false)
})

test('a failed openrouter read keeps the last balances as stale', async () => {
  let fail = false
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['openrouter'],
    openrouterKey: async () => 'sk-or-secret',
    fetchOpenrouter: async () => { if (fail) throw new Error('offline'); return usage.normalizeOpenrouterUsage(openrouterCredits, openrouterKeyInfo, now) }
  })
  await collect({}, true)
  fail = true
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'openrouter')
  assert.equal(report.balances[0].label, 'account')
  assert.equal(report.status, 'stale')
  assert.equal(report.stale, true)
})

test('a rejected openrouter key stays unknown on a cold collector', async () => {
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['openrouter'],
    openrouterKey: async () => 'sk-or-bad', fetchOpenrouter: async () => { throw new Error('offline') }
  })
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'openrouter')
  assert.equal(report.status, 'unknown')
  assert.equal(report.noLimits, undefined)
})

test('an unconfigured openrouter is never read even when a key is stored', async () => {
  let calls = 0
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => [],
    openrouterKey: async () => 'sk-or-secret',
    fetchOpenrouter: async () => { calls += 1; return usage.normalizeOpenrouterUsage(openrouterCredits, openrouterKeyInfo, now) }
  })
  const result = await collect({}, true)
  assert.equal(calls, 0)
  assert.equal(result.reports.some((row) => row.provider === 'openrouter'), false)
})

const alibabaUsage = { per1MonthPercentage: 0.004986094304157778, per1MonthResetTime: 1797177600000 }
const alibabaSubscription = { instanceCode: 'sfm_tokenplansolo_public_intl-sg-px751mst44v', specCode: 'essential', remainingDays: 30, startTime: 1794581475000, endTime: 1797177600000, autoRenewFlag: false, status: 'VALID' }
const alibabaQuota = { standard: { five_hour: 3000, monthly: 80000 }, addon_quota: { extrabundle: 20000 }, lite: { five_hour: 700, monthly: 20000 }, pro: { five_hour: 12000, monthly: 200000 }, essential: { five_hour: 1800, monthly: 45000 } }

test('alibaba token plan reads the monthly share as a fraction of the tier credits', () => {
  const report = usage.normalizeAlibabaTokenPlan(alibabaUsage, alibabaSubscription, alibabaQuota, now)
  assert.equal(report.provider, 'alibaba-token-plan')
  assert.equal(report.accountLabel, 'Token Plan')
  assert.equal(report.meterLabel, 'essential')
  assert.equal(report.monthly.percent, 0.004986094304157778 * 100)
  assert.equal(report.monthly.used, 0.004986094304157778 * 45000)
  assert.equal(report.monthly.limit, 45000)
  assert.equal(report.monthly.unit, 'credits')
  assert.equal(report.monthly.resetAt, 1797177600000)
  assert.equal(report.monthly.stale, false)
  assert.equal(report.balances, undefined)
})

test('alibaba token plan refuses a missing share or an unknown tier total', () => {
  assert.throws(() => usage.normalizeAlibabaTokenPlan({}, alibabaSubscription, alibabaQuota, now), /ALIBABA_UNAVAILABLE/)
  assert.throws(() => usage.normalizeAlibabaTokenPlan(alibabaUsage, { specCode: 'unreleased' }, alibabaQuota, now), /ALIBABA_UNAVAILABLE/)
  assert.throws(() => usage.normalizeAlibabaTokenPlan(alibabaUsage, alibabaSubscription, {}, now), /ALIBABA_UNAVAILABLE/)
  assert.throws(() => usage.normalizeAlibabaTokenPlan(alibabaUsage, undefined, alibabaQuota, now), /ALIBABA_UNAVAILABLE/)
})

test('alibaba token plan marks an elapsed monthly reset as stale', () => {
  const report = usage.normalizeAlibabaTokenPlan({ ...alibabaUsage, per1MonthResetTime: now - 1000 }, alibabaSubscription, alibabaQuota, now)
  assert.equal(report.monthly.stale, true)
  assert.equal(report.monthly.percent, 0.004986094304157778 * 100)
})

test('alibaba token plan reads the three console routes once each', async () => {
  const calls = []
  const report = await usage.fetchAlibabaTokenPlanUsage({
    now: () => now,
    runConsole: async (api) => {
      calls.push(api)
      if (api === 'usage') return alibabaUsage
      if (api === 'subscription') return alibabaSubscription
      return alibabaQuota
    }
  })
  assert.deepEqual(calls.sort(), ['quota-config', 'subscription', 'usage'])
  assert.equal(report.monthly.limit, 45000)
})

test('alibaba token plan quotas join the provider usage panel', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-alibaba-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  const collect = usage.createProviderUsage({
    snapshotPath: path, now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['alibaba-token-plan'],
    fetchAlibaba: async () => usage.normalizeAlibabaTokenPlan(alibabaUsage, alibabaSubscription, alibabaQuota, now)
  })
  const result = await collect({}, true)
  const report = result.reports.find((row) => row.provider === 'alibaba-token-plan')
  assert.equal(report.monthly.limit, 45000)
  assert.equal(report.status, 'ready')
  assert.equal(result.reports.find((row) => row.provider === 'codex').fiveHour.percent, 23)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).reports.some((row) => row.provider === 'alibaba-token-plan'), true)
})

test('a failed alibaba read keeps the last monthly window as stale', async () => {
  let fail = false
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['alibaba-token-plan'],
    fetchAlibaba: async () => { if (fail) throw new Error('console session expired'); return usage.normalizeAlibabaTokenPlan(alibabaUsage, alibabaSubscription, alibabaQuota, now) }
  })
  await collect({}, true)
  fail = true
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'alibaba-token-plan')
  assert.equal(report.monthly.limit, 45000)
  assert.equal(report.status, 'stale')
  assert.equal(report.stale, true)
})

test('an expired alibaba console session stays unknown on a cold collector', async () => {
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['alibaba-token-plan'],
    fetchAlibaba: async () => { throw new Error('console session expired') }
  })
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'alibaba-token-plan')
  assert.equal(report.status, 'unknown')
  assert.equal(report.monthly, undefined)
})

test('a missing bailian cli leaves alibaba absent instead of unknown', async () => {
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['alibaba-token-plan'],
    fetchAlibaba: async () => { throw Object.assign(new Error('spawn bl ENOENT'), { code: 'ENOENT' }) }
  })
  const result = await collect({}, true)
  assert.equal(result.reports.some((row) => row.provider === 'alibaba-token-plan'), false)
})

test('an unconfigured alibaba token plan is never read', async () => {
  let calls = 0
  const collect = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['openrouter'],
    fetchAlibaba: async () => { calls += 1; return usage.normalizeAlibabaTokenPlan(alibabaUsage, alibabaSubscription, alibabaQuota, now) }
  })
  const result = await collect({}, true)
  assert.equal(calls, 0)
  assert.equal(result.reports.some((row) => row.provider === 'alibaba-token-plan'), false)
})

const deepseekBalance = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '10.80', granted_balance: '0.92', topped_up_balance: '9.87' }] }

test('deepseek balance splits the total, granted and topped-up amounts', () => {
  const at = Date.parse('2026-11-14T07:30:00Z')
  const report = usage.normalizeDeepseekBalance(deepseekBalance, at)
  assert.equal(report.provider, 'deepseek-official')
  assert.equal(report.accountId, 'api-key')
  assert.equal(report.status, 'ready')
  assert.equal(report.stale, false)
  assert.equal(report.updatedAt, at)
  assert.equal(report.balances.length, 3)
  assert.equal(report.balances[0].label, 'balance')
  assert.equal(report.balances[0].remaining, 10.8)
  assert.equal(report.balances[0].unit, 'usd')
  assert.equal(report.balances[1].label, 'granted')
  assert.equal(report.balances[1].remaining, 0.92)
  assert.equal(report.balances[2].label, 'topped up')
  assert.equal(report.balances[2].remaining, 9.87)
})

test('deepseek pricing follows the documented peak windows', () => {
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-10T02:30:00Z')).pricing, 'peak')
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-10T05:00:00Z')).pricing, 'off-peak')
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-10T10:00:00Z')).pricing, 'off-peak')
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-13T23:30:00Z')).pricing, 'off-peak')
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-14T07:30:00Z')).pricing, 'off-peak')
})

test('deepseek pricing switches on the documented boundaries', () => {
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-10T02:30:00Z')).pricingUntil, Date.parse('2026-11-10T04:00:00Z'))
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-10T05:00:00Z')).pricingUntil, Date.parse('2026-11-10T06:00:00Z'))
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-13T23:30:00Z')).pricingUntil, Date.parse('2026-11-16T01:00:00Z'))
  assert.equal(usage.deepseekPricing(Date.parse('2026-11-14T07:30:00Z')).pricingUntil, Date.parse('2026-11-16T01:00:00Z'))
})

test('deepseek refuses a payload without a usable balance', () => {
  assert.throws(() => usage.normalizeDeepseekBalance({}, now), /DEEPSEEK_UNAVAILABLE/)
  assert.throws(() => usage.normalizeDeepseekBalance({ balance_infos: [] }, now), /DEEPSEEK_UNAVAILABLE/)
  assert.throws(() => usage.normalizeDeepseekBalance({ balance_infos: [{ total_balance: '1.00' }] }, now), /DEEPSEEK_UNAVAILABLE/)
})

test('deepseek reads the balance route once', async () => {
  const targets = []
  const fetchFn = async (url, options) => {
    targets.push(url)
    assert.equal(options.headers.authorization, 'Bearer sk-ds-test')
    assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => deepseekBalance }
  }
  const report = await usage.fetchDeepseekBalance('sk-ds-test', { fetchFn, now: () => Date.parse('2026-11-14T07:30:00Z') })
  assert.deepEqual(targets, ['https://api.deepseek.com/user/balance'])
  assert.equal(report.balances[0].remaining, 10.8)
  assert.equal(report.pricing, 'off-peak')
  await assert.rejects(usage.fetchDeepseekBalance('   ', { fetchFn }), /DEEPSEEK_UNAVAILABLE/)
  await assert.rejects(usage.fetchDeepseekBalance('sk-ds-bad', { fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), /DEEPSEEK_UNAVAILABLE/)
})

test('deepseek balance joins the provider usage panel without leaking the key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-deepseek-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'snapshot.json')
  const at = () => Date.parse('2026-11-14T07:30:00Z')
  const collect = usage.createProviderUsage({
    snapshotPath: path, now: at, requestSnapshot: async () => account(good), configuredProviders: () => ['deepseek-official'],
    deepseekKey: async () => 'sk-ds-secret',
    fetchDeepseek: async () => usage.normalizeDeepseekBalance(deepseekBalance, at())
  })
  const result = await collect({}, true)
  const report = result.reports.find((row) => row.provider === 'deepseek-official')
  assert.equal(report.balances[0].remaining, 10.8)
  assert.equal(report.pricing, 'off-peak')
  assert.equal(report.pricingUntil, Date.parse('2026-11-16T01:00:00Z'))
  assert.equal(result.reports.find((row) => row.provider === 'codex').fiveHour.percent, 23)
  assert.equal((await readFile(path, 'utf8')).includes('sk-ds-secret'), false)
})

test('a failed deepseek read keeps the last balance as stale with a fresh window', async () => {
  const at = () => Date.parse('2026-11-14T07:30:00Z')
  let fail = false
  const collect = usage.createProviderUsage({
    now: at, requestSnapshot: async () => account(good), configuredProviders: () => ['deepseek-official'],
    deepseekKey: async () => 'sk-ds-secret',
    fetchDeepseek: async () => { if (fail) throw new Error('offline'); return usage.normalizeDeepseekBalance(deepseekBalance, at()) }
  })
  await collect({}, true)
  fail = true
  const report = (await collect({}, true)).reports.find((row) => row.provider === 'deepseek-official')
  assert.equal(report.balances[0].remaining, 10.8)
  assert.equal(report.status, 'stale')
  assert.equal(report.stale, true)
  assert.equal(report.pricing, 'off-peak')
  assert.equal(report.pricingUntil, Date.parse('2026-11-16T01:00:00Z'))
})

test('a rejected deepseek key stays unknown and an unconfigured one is never read', async () => {
  let calls = 0
  const fetchDeepseek = async () => { calls += 1; throw new Error('unauthorized') }
  const cold = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['deepseek-official'],
    deepseekKey: async () => 'sk-ds-bad', fetchDeepseek
  })
  const unknown = (await cold({}, true)).reports.find((row) => row.provider === 'deepseek-official')
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.balances, undefined)
  assert.equal(calls, 1)
  const unconfigured = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => [],
    deepseekKey: async () => 'sk-ds-secret', fetchDeepseek
  })
  const result = await unconfigured({}, true)
  assert.equal(calls, 1)
  assert.equal(result.reports.some((row) => row.provider === 'deepseek-official'), false)
  const keyless = usage.createProviderUsage({
    now: () => now, requestSnapshot: async () => account(good), configuredProviders: () => ['deepseek-official'],
    deepseekKey: async () => '  ', fetchDeepseek
  })
  assert.equal((await keyless({}, true)).reports.some((row) => row.provider === 'deepseek-official'), false)
  assert.equal(calls, 1)
})
