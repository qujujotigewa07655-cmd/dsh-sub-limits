import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8')
const content = (node) => node == null || node === false ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(content).join(' ') : content(node.props?.children)
const walk = (node) => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const snapshot = { ok: true, stale: false, generatedAt: Date.now(), reports: [
  { provider: 'codex', accountId: 'a', fiveHour: { percent: 45 }, sevenDay: { percent: 12 } },
  { provider: 'antigravity', accountId: 'b', fiveHour: { percent: 0 }, sevenDay: { percent: 95 } }
] }

function providerView(locale, data = snapshot, fetchFn, clock = Date) {
  const state = []
  let cursor = 0
  const React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } },
    useState: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = index === 0 ? data : typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useEffect: () => {},
    useCallback: (fn) => fn
  }
  let plugin
  const context = { window: { __ModuleLoader__: { load: (entry) => { plugin = entry.factory(() => React) } } }, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } } }
  Object.assign(context, { fetch: fetchFn, AbortController, setTimeout, clearTimeout, Date: clock })
  vm.runInNewContext(source, context)
  const dictionaries = {}
  let component
  plugin.apply({
    effect: (fn) => fn(),
    locale: {
      register: (_, language, values) => { dictionaries[language] = values; return () => {} },
      bind: () => (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionaries[locale][key] ?? key)
    },
    slots: { inject: (_, fn) => fn(), register: (options, render) => { if (options.name === 'sidebar.footer.action') component = render; return () => {} } }
  })
  return { render: () => { cursor = 0; return component({ wide: true }) } }
}

for (const outcome of ['success', 'failure']) {
  test(`refresh indicates an active request until ${outcome}`, async () => {
    let resolveRequest
    let rejectRequest
    const pending = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject })
    const view = providerView('en', snapshot, (url) => {
      assert.equal(url, '/api/sub-limits/providers?refresh=1')
      return pending
    })
    const button = () => walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-icon')
    assert.notEqual(button().props['data-loading'], 'true')
    button().props.onClick()
    try {
      assert.equal(button().props['data-loading'], 'true')
      assert.equal(button().props['aria-busy'], 'true')
      assert.equal(button().props.disabled, true)
    } finally {
      if (outcome === 'success') resolveRequest({ ok: true, text: async () => JSON.stringify(snapshot) })
      else rejectRequest(new Error('Network unavailable'))
      await new Promise((resolve) => setTimeout(resolve, 950))
    }
    assert.equal(button().props['data-loading'], 'false')
    assert.equal(button().props['aria-busy'], 'false')
    assert.equal(button().props.disabled, false)
    assert.equal(button().props['data-done'], outcome === 'success' ? 'true' : 'false')
  })
}

for (const outcome of ['success', 'failure']) {
  test(`fast ${outcome} leaves time for visible rotation`, async () => {
    const view = providerView('en', snapshot, async () => {
      if (outcome === 'failure') throw new Error('Network unavailable')
      return { ok: true, text: async () => JSON.stringify(snapshot) }
    })
    const button = () => walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-icon')
    button().props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(button().props['data-loading'], 'true')
    assert.equal(button().props.disabled, true)
    await new Promise((resolve) => setTimeout(resolve, 950))
    assert.equal(button().props['data-loading'], 'false')
    assert.equal(button().props.disabled, false)
    assert.equal(button().props['data-done'], outcome === 'success' ? 'true' : 'false')
  })
}

for (const [outcome, status] of [['success', 'Updated'], ['stale', 'Some data are stale'], ['unavailable', 'Refresh failed'], ['failure', 'Refresh failed']]) {
  test(`manual ${outcome} updates the attempt time without replacing the snapshot time`, async () => {
    const saved = { ...snapshot, generatedAt: 1600000000000 }
    let at = Date.parse('2030-01-02T03:04:05Z')
    const clock = class extends Date { static now() { return at } }
    const view = providerView('en', saved, async () => {
      if (outcome === 'failure') throw new Error('Network unavailable')
      return { ok: true, text: async () => JSON.stringify({ ...saved, stale: outcome !== 'success', ...(outcome === 'unavailable' ? { ok: false, code: 'NATIVE_UNAVAILABLE' } : {}) }) }
    }, clock)
    walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
    const button = () => walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-icon')
    button().props.onClick()
    try {
      assert.ok(content(view.render()).includes(new Date(at).toLocaleString()), `show this attempt immediately: ${content(view.render())}`)
      assert.match(content(view.render()), /Refresh attempt:.*loading/)
      at += 2000
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 950))
    }
    const footer = walk(view.render()).find((node) => node.props?.className === 'sub-limits-note' && content(node).startsWith('Refresh attempt:'))
    assert.ok(content(footer).includes(new Date(at).toLocaleString()), 'show the completion time even when data did not change')
    assert.ok(content(footer).includes(status))
    assert.ok(footer.props.title.includes(new Date(saved.generatedAt).toLocaleString()), 'keep the original snapshot time in the tooltip')
    assert.equal(footer.props['aria-live'], 'polite')
  })
}

test('default sidebar compares five-hour quotas rather than the largest unrelated weekly quota', () => {
  const summary = content(providerView('en').render())
  assert.match(summary, /codex/)
  assert.match(summary, /45% used/)
  assert.doesNotMatch(summary, /95%/)
})

test('Russian provider summary distinguishes consumed quota from remaining quota', () => {
  const summary = content(providerView('ru').render())
  assert.match(summary, /codex/)
  assert.match(summary, /израсходовано 45%/)
})

test('weekly selection switches both the summary and account row to the same period', () => {
  const view = providerView('en')
  let tree = view.render()
  walk(tree).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
  tree = view.render()
  const weekly = walk(tree).find((node) => node.type === 'button' && content(node).trim() === '7D')
  assert.ok(weekly, 'weekly period control')
  weekly.props.onClick()
  tree = view.render()
  assert.match(content(tree), /antigravity.*95% used/)
  const codex = walk(tree).find((node) => node.props?.className === 'sub-limits-pu-row' && content(node).includes('codex'))
  assert.match(content(codex), /12%/)
  assert.doesNotMatch(content(codex), /45%/)
})

test('a missing five-hour quota does not silently substitute the weekly value', () => {
  const view = providerView('en', { ...snapshot, reports: [{ provider: 'weekly-only', accountId: 'a', sevenDay: { percent: 95 } }] })
  let tree = view.render()
  assert.doesNotMatch(content(tree), /95%/)
  walk(tree).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
  tree = view.render()
  assert.match(content(tree), /—/)
})

test('stale readings never outrank fresh accounts in the current quota summary', () => {
  const view = providerView('en', { ...snapshot, stale: true, reports: [
    { provider: 'old', accountId: 'a', stale: true, fiveHour: { percent: 100 } },
    { provider: 'current', accountId: 'b', fiveHour: { percent: 4 } }
  ] })
  const summary = content(view.render())
  assert.match(summary, /current.*4% used/)
  assert.doesNotMatch(summary, /100%/)
})

test('stale compact bars retain muted consumption tones independently of freshness', () => {
  const view = providerView('en', { ...snapshot, stale: true, reports: [
    { provider: 'codex', accountId: 'a', stale: true, fiveHour: { percent: 33 } },
    { provider: 'ollama', accountId: 'b', fiveHour: { percent: 51, stale: true } },
    { provider: 'high', accountId: 'c', stale: true, fiveHour: { percent: 95 } }
  ] })
  walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
  const fills = walk(view.render()).filter((node) => node.props?.className === 'sub-limits-pu-bar-fill')
  assert.deepEqual(fills.map((node) => node.props['data-tone']), ['ok', 'warn', 'danger'])
  assert.deepEqual(fills.map((node) => node.props['data-stale']), ['true', 'true', 'true'])
  assert.deepEqual(fills.map((node) => node.props.style.width), ['33%', '51%', '95%'])
})

test('expanded stale windows keep consumption hues and freshness markers', () => {
  const view = providerView('en', { ...snapshot, reports: [
    { provider: 'codex', accountId: 'a', stale: true, fiveHour: { percent: 33 }, sevenDay: { percent: 95 }, monthly: { percent: 51, stale: false } }
  ] })
  walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
  walk(view.render()).find((node) => node.props?.className === 'sub-limits-pu-line').props.onClick()
  const meters = walk(view.render()).filter((node) => node.props?.className === 'sub-limits-pu-meter')
  const fills = meters.map((meter) => walk(meter).find((node) => node.props?.className === 'sub-limits-pu-bar-fill'))
  assert.deepEqual(fills.map((node) => node.props['data-tone']), ['ok', 'danger', 'warn'])
  assert.deepEqual(fills.map((node) => node.props['data-stale']), ['true', 'true', 'false'])
})

test('all-window mode keeps a periodless dollar allowance visible', () => {
  const view = providerView('en', { ...snapshot, reports: [{ provider: 'ollama', accountId: 'a', unscoped: { percent: 20, unit: 'usd', used: 2, limit: 10 } }] })
  let tree = view.render()
  walk(tree).find((node) => node.props?.className === 'sub-limits-pu-toggle').props.onClick()
  tree = view.render()
  const all = walk(tree).find((node) => node.type === 'button' && content(node).trim() === 'All')
  assert.ok(all, 'all periods control')
  all.props.onClick()
  tree = view.render()
  const row = walk(tree).find((node) => node.props?.className === 'sub-limits-pu-row')
  row.props.children[0].props.onClick()
  assert.match(content(view.render()), /\$2\.00.*\$10\.00/)
})

test('manual refresh during a pending poll still sends ?refresh=1', async () => {
  const state = []
  let cursor = 0
  let effectRan = false
  const React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : { type, props: { ...props, children } },
    useState: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = index === 0 ? snapshot : typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useEffect: (fn) => { if (!effectRan) { effectRan = true; fn() } },
    useCallback: (fn) => fn
  }
  let plugin
  const context = { window: { __ModuleLoader__: { load: (entry) => { plugin = entry.factory(() => React) } } }, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } } }
  const urls = []
  let resolvePoll
  const poll = new Promise((resolve) => { resolvePoll = resolve })
  Object.assign(context, {
    fetch: (url) => {
      urls.push(url)
      return urls.length === 1 ? poll : Promise.resolve({ ok: true, text: async () => JSON.stringify(snapshot) })
    },
    AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, Date
  })
  vm.runInNewContext(source, context)
  const dictionaries = {}
  let component
  plugin.apply({
    effect: (fn) => fn(),
    locale: {
      register: (_, language, values) => { dictionaries[language] = values; return () => {} },
      bind: () => (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionaries.en[key] ?? key)
    },
    slots: { inject: (_, fn) => fn(), register: (options, render) => { if (options.name === 'sidebar.footer.action') component = render; return () => {} } }
  })
  const render = () => { cursor = 0; return component({ wide: true }) }
  render()
  assert.deepEqual(urls, ['/api/sub-limits/providers'])
  walk(render()).find((node) => node.props?.className === 'sub-limits-pu-icon').props.onClick()
  resolvePoll({ ok: true, text: async () => JSON.stringify(snapshot) })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  assert.deepEqual(urls, ['/api/sub-limits/providers', '/api/sub-limits/providers?refresh=1'])
})
