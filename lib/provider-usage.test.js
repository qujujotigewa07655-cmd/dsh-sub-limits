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

test('configured OpenRouter is explicitly unknown without reading OMP accounts', async () => {
  const collect = usage.createProviderUsage({ requestSnapshot: async () => ({ accounts: {} }), configuredProviders: () => ['openrouter'] })
  const result = await collect({}, true)
  assert.equal(result.reports.length, 1)
  assert.equal(result.reports[0].provider, 'openrouter')
  assert.equal(result.reports[0].status, 'unsupported')
  assert.equal(result.reports[0].noLimits, true)
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

test('unsupported provider remains unsupported during native failures', async () => {
  let fail = false
  const collect = usage.createProviderUsage({ now: () => now, configuredProviders: () => ['openrouter'], requestSnapshot: async () => {
    if (fail) throw new Error('offline')
    return account(good)
  } })
  await collect({}, true)
  fail = true
  const failed = await collect({}, true)
  const unsupported = failed.reports.find((row) => row.provider === 'openrouter')
  assert.equal(unsupported.status, 'unsupported')
  assert.equal(unsupported.stale, false)
  assert.equal(failed.reports.find((row) => row.provider === 'codex').status, 'stale')
})

test('configured unsupported provider is visible even on a cold native failure', async () => {
  const collect = usage.createProviderUsage({ configuredProviders: () => ['openrouter'], requestSnapshot: async () => { throw new Error('offline') } })
  const result = await collect({})
  assert.equal(result.reports.length, 1)
  assert.equal(result.reports[0].status, 'unsupported')
  assert.equal(result.reports[0].stale, false)
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
