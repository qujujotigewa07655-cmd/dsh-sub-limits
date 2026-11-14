window.__ModuleLoader__.load({
  id: 'dsh-sub-limits',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'subLimits'
    const PROVIDERS_ROUTE = '/api/sub-limits/providers'
    const PROVIDER_POLL_MS = 60000

    const CSS = `
.sub-limits-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sub-limits-route-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer;min-width:0}
.sub-limits-route-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub-limits-route-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-route-chip[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-route-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-note{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11)}
.sub-limits-note[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.sub-limits-pu{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0;padding:6px 0 4px;border-top:1px solid var(--dsw-alias-border-l1)}
.sub-limits-pu-head{display:flex;align-items:center;gap:2px;min-width:0}
.sub-limits-pu-toggle{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1 1 auto;min-width:0;padding:2px 4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer;text-align:left}
.sub-limits-pu-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-pu-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-pu-caret{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary);transition:transform .18s ease}
.sub-limits-pu-toggle[aria-expanded="true"] .sub-limits-pu-caret{transform:rotate(90deg)}
.sub-limits-pu-title{flex:0 1 auto;min-width:0;text-transform:uppercase;letter-spacing:.05em;font:var(--dsw-font-xxxs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub-limits-pu-summary{flex:1 1 100%;min-width:0;margin-left:36px;font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:normal;overflow-wrap:anywhere}
.sub-limits-pu-summary[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-pu-summary[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-pu-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sub-limits-pu-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-pu-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-pu-icon:disabled{opacity:.5;cursor:default}
.sub-limits-pu-icon[data-done="true"]{color:var(--dsw-alias-state-success-primary)}
.sub-limits-pu-icon[data-loading="true"]>svg{transform-origin:center;animation:sub-limits-refresh-spin .85s linear infinite}
@keyframes sub-limits-refresh-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.sub-limits-pu-icon[data-loading="true"]>svg{animation:none}}
.sub-limits-pu-rows{display:flex;flex-direction:column;gap:1px;min-width:0;max-height:34vh;overflow-y:auto}
.sub-limits-pu-row{display:flex;flex-direction:column;min-width:0;border-radius:6px}
.sub-limits-pu-row[data-open="true"]{background:var(--dsw-alias-bg-layer-1)}
.sub-limits-pu-line{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sub-limits-pu-line:hover{background:var(--dsw-alias-bg-layer-2)}
.sub-limits-pu-line:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-pu-line[data-static="true"]{cursor:default}
.sub-limits-pu-line[data-static="true"]:hover{background:transparent}
.sub-limits-pu-caret-in{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary);transition:transform .18s ease}
.sub-limits-pu-row[data-open="true"] .sub-limits-pu-caret-in{transform:rotate(90deg)}
.sub-limits-pu-tag{flex:none;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11);white-space:nowrap;line-height:15px}
.sub-limits-pu-tag[data-tone="ok"]{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l1));color:var(--dsw-alias-state-success-primary)}
.sub-limits-pu-tag[data-tone="idle"]{color:var(--dsw-alias-label-secondary)}
.sub-limits-pu-account{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11)}
.sub-limits-pu-value{flex:none;font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.sub-limits-pu-value[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-pu-value[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-pu-bar{height:3px;margin:0 6px 3px 21px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.sub-limits-pu-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-idle-primary);transition:width .25s ease,background-color .25s ease}
.sub-limits-pu-bar-fill[data-tone="ok"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-bar-fill[data-tone="warn"]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-bar-fill[data-tone="danger"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-bar-fill[data-stale="true"]{opacity:.55}
.sub-limits-pu-detail{display:flex;flex-direction:column;gap:4px;padding:4px 8px 6px 21px}
.sub-limits-pu-meter{display:flex;align-items:center;gap:6px;min-width:0}
.sub-limits-pu-meter-key{flex:none;width:22px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);letter-spacing:.04em;text-transform:uppercase}
.sub-limits-pu-meter-bar{flex:1 1 auto;min-width:16px;height:3px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.sub-limits-pu-meter-val{flex:none;font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.sub-limits-pu-meter-val[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-pu-meter-val[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-pu-meter-eta{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sub-limits-pu-balance{display:flex;align-items:baseline;gap:6px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sub-limits-pu-balance-key{flex:none;min-width:22px;text-transform:uppercase;letter-spacing:.04em}
.sub-limits-pu-balance-val{color:var(--dsw-alias-label-primary)}
`

    const EN = {
      providers: 'Provider usage',
      providersLoading: 'loading…',
      providersEmpty: 'no data',
      providersMissing: 'DSH quotas unavailable',
      providersStale: 'stale',
      providersStaleWarning: 'Some quotas are unavailable or outdated. Last successful values are shown where available.',
      providersUpdated: 'Updated',
      providersChecked: 'Snapshot received',
      providersAttempt: 'Refresh attempt',
      providersAttemptStale: 'Some data are stale',
      providersAttemptFailed: 'Refresh failed',
      providersUnsupported: 'No native quota source for this provider',
      providersUnknown: 'quota unknown',
      providersWindowUnknown: 'period unknown',
      providersNotSaved: 'Snapshot could not be saved',
      providersUnavailable: 'unavailable',
      providersHighest: '{provider} · {percent}% used · {window}',
      providersHighestAndBalance: '{provider} · {percent}% used · {window} · {amount}',
      providersRefresh: 'Refresh provider usage',
      providersResets: 'resets {value}',
      providersAccount: 'Account {number}',
      providersBalanceShort: 'bal',
      providersPeriod: 'Quota period',
      providersAllPeriods: 'All',
      providersPeak: 'peak',
      providersOffPeak: 'off-peak',
      providersPricingUntil: '{state} · changes in {value}'
    }

    const RU = {
      providers: 'Расход провайдеров',
      providersLoading: 'загрузка…',
      providersEmpty: 'нет данных',
      providersMissing: 'квоты DSH недоступны',
      providersStale: 'устарело',
      providersStaleWarning: 'Часть квот недоступна или устарела. Где возможно, показаны последние успешные значения.',
      providersUpdated: 'Обновлено',
      providersChecked: 'Снимок получен',
      providersAttempt: 'Проверка',
      providersAttemptStale: 'Есть устаревшие данные',
      providersAttemptFailed: 'Ошибка обновления',
      providersUnsupported: 'Для провайдера нет нативного источника квот',
      providersUnknown: 'квота неизвестна',
      providersWindowUnknown: 'период неизвестен',
      providersNotSaved: 'Не удалось сохранить снимок',
      providersUnavailable: 'недоступно',
      providersHighest: '{provider} · израсходовано {percent}% · {window}',
      providersHighestAndBalance: '{provider} · израсходовано {percent}% · {window} · {amount}',
      providersRefresh: 'Обновить расход провайдеров',
      providersResets: 'сброс {value}',
      providersAccount: 'Аккаунт {number}',
      providersBalanceShort: 'бал',
      providersPeriod: 'Период квоты',
      providersAllPeriods: 'Все',
      providersPeak: 'пик',
      providersOffPeak: 'вне пика',
      providersPricingUntil: '{state} · смена через {value}'
    }

    function requestJson(url, timeoutMs) {
      const signal = typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined
      return fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
        headers: { accept: 'application/json' }
      }).then(async (response) => {
        const text = await response.text()
        let payload = null
        try {
          payload = text.length > 0 ? JSON.parse(text) : null
        } catch {
          payload = null
        }
        if (!response.ok) {
          const message = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
          const error = new Error(message)
          error.status = response.status
          throw error
        }
        return payload
      })
    }

    const WINDOW_DEFS = [
      { short: '5H', pick: (report) => report.fiveHour },
      { short: '7D', pick: (report) => report.sevenDay },
      { short: '30D', pick: (report) => report.monthly },
      { short: '24H', pick: (report) => report.daily },
      { short: '?', pick: (report) => report.unscoped }
    ]

    function clampPercent(value) {
      return Math.min(100, Math.max(0, value))
    }

    function providerTone(pct) {
      if (!Number.isFinite(pct)) return 'idle'
      if (pct >= 80) return 'danger'
      if (pct >= 50) return 'warn'
      return 'ok'
    }

    function formatUsageReset(value, unit) {
      if (!Number.isFinite(value) || value < 0) return ''
      if (unit === 'minutes') {
        if (value < 60) return `${value}m`
        const hours = Math.floor(value / 60)
        const minutes = value % 60
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
      }
      if (value < 24) return `${value}h`
      const days = Math.floor(value / 24)
      const hours = value % 24
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`
    }

    function formatUsageBalance(balance) {
      if (!balance || !Number.isFinite(balance.remaining)) return ''
      const rounded = Math.round(balance.remaining * 100) / 100
      return balance.unit === 'usd' ? `$${rounded.toFixed(2)}` : `${rounded} ${balance.unit}`
    }

    function windowIsStale(report, window) {
      return window.stale === true || (report.stale === true && window.stale !== false)
    }

    function selectedWindowOf(report, period, freshOnly = false) {
      let best = null
      for (const def of WINDOW_DEFS) {
        if (period !== 'all' && def.short !== period) continue
        const window = def.pick(report)
        if (!window || !Number.isFinite(window.percent)) continue
        if (freshOnly && windowIsStale(report, window)) continue
        if (best === null || window.percent > best.window.percent) best = { short: def.short, window }
      }
      return best
    }

    function windowResetText(window) {
      if (!window) return ''
      if (Number.isFinite(window.resetAt)) return formatUsageReset(Math.max(0, Math.ceil((window.resetAt - Date.now()) / 60000)), 'minutes')
      return ''
    }

    function ProviderUsage(props) {
      const ctx = props.ctx
      const t = ctx.locale.bind(NS)
      const wide = props.wide !== false
      const [snapshot, setSnapshot] = useState(null)
      const [loading, setLoading] = useState(false)
      const [failed, setFailed] = useState('')
      const [openKey, setOpenKey] = useState('')
      const [expanded, setExpanded] = useState(false)
      const [refreshDone, setRefreshDone] = useState(false)
      const [period, setPeriod] = useState(() => {
        try {
          const saved = window.localStorage.getItem('dsh-sub-limits:provider-window')
          return ['5H', '7D', '30D', 'all'].includes(saved) ? saved : '5H'
        } catch { return '5H' }
      })
      const [lastAttempt, setLastAttempt] = useState(null)
      const mounted = useRef(true)
      const inFlight = useRef(null)

      const load = useCallback((force) => {
        if (inFlight.current !== null) {
          if (!force) return inFlight.current
          return inFlight.current.then(() => (mounted.current ? load(true) : false))
        }
        setLoading(true)
        if (force) {
          setFailed('')
          setLastAttempt({ at: Date.now(), status: 'providersLoading' })
        }
        const url = force ? `${PROVIDERS_ROUTE}?refresh=1` : PROVIDERS_ROUTE
        const feedback = force ? new Promise((resolve) => setTimeout(resolve, 900)) : Promise.resolve()
        const promise = requestJson(url, 70000)
          .then((payload) => {
            if (!mounted.current) return false
            setSnapshot(payload || null)
            setFailed('')
            const ok = payload?.ok === true && payload.stale !== true
            if (force) setLastAttempt({ at: Date.now(), status: ok ? 'providersUpdated' : payload?.code ? 'providersAttemptFailed' : 'providersAttemptStale' })
            return ok
          })
          .catch((cause) => {
            if (!mounted.current) return false
            setFailed(cause && cause.message ? cause.message : String(cause))
            if (force) setLastAttempt({ at: Date.now(), status: 'providersAttemptFailed' })
            return false
          })
          .finally(async () => {
            await feedback
            inFlight.current = null
            if (mounted.current) setLoading(false)
          })
        inFlight.current = promise
        return promise
      }, [])

      useEffect(() => {
        mounted.current = true
        load(false)
        const id = setInterval(() => load(false), PROVIDER_POLL_MS)
        return () => {
          mounted.current = false
          clearInterval(id)
        }
      }, [load])

      useEffect(() => {
        if (!refreshDone) return undefined
        const id = setTimeout(() => setRefreshDone(false), 2000)
        return () => clearTimeout(id)
      }, [refreshDone])

      const onRefresh = useCallback(() => {
        setRefreshDone(false)
        load(true).then((ok) => {
          if (ok && mounted.current) setRefreshDone(true)
        })
      }, [load])

      const reports = snapshot && Array.isArray(snapshot.reports) ? snapshot.reports : []
      const generatedAt = snapshot && Number.isFinite(snapshot.generatedAt) ? snapshot.generatedAt : 0
      const hasData = reports.length > 0
      const missing = snapshot && snapshot.code === 'NATIVE_UNAVAILABLE' && !hasData
      const stale = !!(snapshot && snapshot.stale) || failed.length > 0

      let worst = null
      let primaryBalance = null
      for (const report of reports) {
        const best = selectedWindowOf(report, period, true)
        if (best && (worst === null || best.window.percent > worst.percent)) {
          worst = { percent: best.window.percent, provider: report.meterLabel ? `${report.provider} / ${report.meterLabel}` : report.provider, window: best.short === '?' ? t('providersWindowUnknown') : best.short }
        }
        const balance = report.balances && report.balances.length > 0 ? report.balances[0] : null
        if (balance && (primaryBalance === null || balance.remaining < primaryBalance.remaining)) primaryBalance = balance
      }

      let summaryText
      if (!snapshot && loading) summaryText = t('providersLoading')
      else if (missing) summaryText = t('providersMissing')
      else if (failed.length > 0 && !hasData) summaryText = t('providersUnavailable')
      else if (worst && primaryBalance) summaryText = t('providersHighestAndBalance', { provider: worst.provider, percent: Math.round(worst.percent), window: worst.window, amount: formatUsageBalance(primaryBalance) })
      else if (worst) summaryText = t('providersHighest', { provider: worst.provider, percent: Math.round(worst.percent), window: worst.window })
      else if (primaryBalance) summaryText = formatUsageBalance(primaryBalance)
      else summaryText = t('providersEmpty')

      if (stale && hasData) summaryText = `${t('providersStale')} · ${summaryText}`

      const caretIcon = () => h(
        'svg',
        { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M6 3l5 5-5 5' })
      )

      const gaugeIcon = () => h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M2.6 12a6 6 0 1 1 10.8 0' }),
        h('path', { d: 'M8 12l3-3.4' })
      )

      const refreshIcon = () => h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M13 8a5 5 0 1 1-1.7-3.8' }),
        h('path', { d: 'M13 2.5V5h-2.5' })
      )

      const checkIcon = () => h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M3 8.5l3.2 3.2L13 5' })
      )

      if (!wide) {
        return h(
          'button',
          {
            type: 'button',
            className: 'sub-limits-pu-icon',
            'data-rail': 'true',
            'data-loading': loading ? 'true' : 'false',
            'aria-busy': loading ? 'true' : 'false',
            title: `${t('providers')}: ${summaryText}`,
            'aria-label': `${t('providers')}: ${summaryText}`,
            onClick: onRefresh,
            disabled: loading
          },
          loading ? refreshIcon() : gaugeIcon()
        )
      }

      const head = h(
        'div',
        { className: 'sub-limits-pu-head' },
        h(
          'button',
          {
            type: 'button',
            className: 'sub-limits-pu-toggle',
            'aria-expanded': expanded ? 'true' : 'false',
            title: t('providers'),
            onClick: () => setExpanded((value) => !value)
          },
          h('span', { className: 'sub-limits-pu-caret' }, caretIcon()),
          h('span', { className: 'sub-limits-pu-icon-wrap', style: { display: 'inline-flex', color: 'var(--dsw-alias-brand-primary)' }, 'aria-hidden': 'true' }, gaugeIcon()),
          h('span', { className: 'sub-limits-pu-title' }, t('providers')),
          h('span', { className: 'sub-limits-pu-summary' }, summaryText)
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'sub-limits-pu-icon',
            'data-done': refreshDone && !loading ? 'true' : 'false',
            'data-loading': loading ? 'true' : 'false',
            'aria-busy': loading ? 'true' : 'false',
            title: t('providersRefresh'),
            'aria-label': t('providersRefresh'),
            disabled: loading,
            onClick: onRefresh
          },
          refreshDone && !loading ? checkIcon() : refreshIcon()
        )
      )

      const periodControls = h('div', { className: 'sub-limits-row', role: 'group', 'aria-label': t('providersPeriod') },
        ...['5H', '7D', '30D', 'all'].map((value) => h('button', {
          key: value, type: 'button', className: 'sub-limits-route-chip', 'aria-pressed': period === value,
          onClick: () => {
            setPeriod(value)
            try { window.localStorage.setItem('dsh-sub-limits:provider-window', value) } catch {}
          }
        }, value === 'all' ? t('providersAllPeriods') : value)))

      if (!expanded) {
        return h('div', { className: 'sub-limits-pu' }, head, periodControls)
      }

      const rows = reports.map((report, index) => {
        const account = report.accountLabel !== undefined
          ? report.accountLabel
          : t('providersAccount', { number: report.accountIndex ?? index + 1 })
        const key = `${report.provider}:${account}:${index}`
        const best = selectedWindowOf(report, period)
        const readingStale = best && windowIsStale(report, best.window)
        const balances = Array.isArray(report.balances) ? report.balances : []
        const primary = balances.length > 0 ? balances[0] : null
        const balanceText = primary ? formatUsageBalance(primary) : ''
        const pct = best ? Math.round(best.window.percent) : 0
        const tone = readingStale ? 'idle' : providerTone(pct)
        const expandable = report.noLimits !== true && (selectedWindowOf(report, 'all') !== null || balances.length > 0)
        const open = openKey === key
        const balanceFraction = primary && Number.isFinite(primary.limit) && primary.limit > 0 && Number.isFinite(primary.used)
          ? clampPercent((primary.used / primary.limit) * 100)
          : null
        const barPct = best ? pct : balanceFraction
        const barTone = providerTone(barPct)
        const meterLabel = typeof report.meterLabel === 'string' && report.meterLabel.length > 0
          ? report.meterLabel
          : ''
        const sameProviderRows = reports.filter((candidate) => candidate.provider === report.provider && (candidate.accountLabel ?? candidate.accountIndex) === (report.accountLabel ?? report.accountIndex)).length
        const pricing = report.pricing === 'peak' || report.pricing === 'off-peak' ? report.pricing : undefined
        const pricingLabel = pricing === undefined ? '' : t(pricing === 'peak' ? 'providersPeak' : 'providersOffPeak')
        const pricingChip = pricing === undefined ? null : h('span', {
          className: 'sub-limits-pu-tag',
          'data-tone': pricing === 'off-peak' ? 'ok' : 'idle'
        }, pricingLabel)

        let valueNode
        if (!best && balanceText.length > 0) valueNode = h('span', { className: 'sub-limits-pu-value', 'data-tone': report.stale ? 'idle' : 'ok' }, balanceText)
        else if (report.noLimits === true || !best) valueNode = h('span', { className: 'sub-limits-pu-value', 'data-tone': 'idle', title: t(report.status === 'unsupported' ? 'providersUnsupported' : 'providersUnknown') }, '—')
        else valueNode = h('span', { className: 'sub-limits-pu-value', 'data-tone': tone }, `${pct}%`)

        const line = h(
          expandable ? 'button' : 'div',
          {
            ...(expandable ? { type: 'button', onClick: () => setOpenKey((current) => (current === key ? '' : key)), 'aria-expanded': open ? 'true' : 'false' } : {}),
            className: 'sub-limits-pu-line',
            'data-static': expandable ? 'false' : 'true',
            title: `${report.provider} · ${account}${pricingLabel.length > 0 ? ` · ${pricingLabel}` : ''}${report.updatedAt ? ` · ${t('providersUpdated')}: ${new Date(report.updatedAt).toLocaleString()}` : ''}${report.stale ? ` · ${t('providersStale')}` : ''}`
          },
          expandable ? h('span', { className: 'sub-limits-pu-caret-in' }, caretIcon()) : h('span', { className: 'sub-limits-pu-caret-in', 'aria-hidden': 'true' }),
          h('span', { className: 'sub-limits-pu-tag' }, report.provider),
          h('span', { className: 'sub-limits-pu-account' }, meterLabel.length > 0 && sameProviderRows > 1 ? `${meterLabel} · ${account}` : account),
          valueNode,
          ...(pricingChip === null ? [] : [pricingChip])
        )

        const children = [
          h(
            'div',
            { className: 'sub-limits-pu-row', key, 'data-open': open ? 'true' : 'false' },
            line,
            barPct !== null
              ? h(
                  'div',
                  { className: 'sub-limits-pu-bar' },
                  h('div', { className: 'sub-limits-pu-bar-fill', 'data-tone': barTone, 'data-stale': readingStale ? 'true' : 'false', style: { width: `${clampPercent(barPct)}%` } })
                )
              : null
          )
        ]

        if (open) {
          const details = [h('div', { className: 'sub-limits-note', key: 'freshness' }, `${report.stale ? `${t('providersStale')} · ` : ''}${report.updatedAt ? `${t('providersUpdated')}: ${new Date(report.updatedAt).toLocaleString()}` : t('providersUnknown')}`)]
          for (const balance of balances) {
            const label = balance.label !== undefined && balance.label.length > 0 ? balance.label : t('providersBalanceShort')
            const parts = [h('span', { className: 'sub-limits-pu-balance-key', key: `k-${label}` }, label), h('span', { className: 'sub-limits-pu-balance-val', key: `v-${label}` }, formatUsageBalance(balance))]
            if (Number.isFinite(balance.used) && Number.isFinite(balance.limit)) {
              parts.push(h('span', { key: `u-${label}` }, `${formatUsageBalance({ ...balance, remaining: balance.used })} / ${formatUsageBalance({ ...balance, remaining: balance.limit })}`))
            }
            details.push(h('div', { className: 'sub-limits-pu-balance', key: `bal-${label}` }, ...parts))
          }
          if (report.unscoped) details.push(h('div', { className: 'sub-limits-note', key: 'unknown-period' }, t('providersWindowUnknown')))
          if (pricing !== undefined) {
            const untilText = windowResetText({ resetAt: report.pricingUntil })
            details.push(h('div', { className: 'sub-limits-note', key: 'pricing' }, untilText.length > 0
              ? t('providersPricingUntil', { state: pricingLabel, value: untilText })
              : pricingLabel))
          }
          for (const def of WINDOW_DEFS) {
            const window = def.pick(report)
            if (!window) continue
            const windowPct = Math.round(window.percent)
            const windowStale = windowIsStale(report, window)
            const windowTone = windowStale ? 'idle' : providerTone(windowPct)
            const resetText = windowResetText(window)
            const amountUnit = window.unit === 'usd' || window.unit === 'credits' ? window.unit : undefined
            if (amountUnit !== undefined && Number.isFinite(window.used) && Number.isFinite(window.limit)) {
              details.push(h('div', { className: 'sub-limits-note', key: `amount-${def.short}` }, `${formatUsageBalance({ remaining: window.used, unit: amountUnit })} / ${formatUsageBalance({ remaining: window.limit, unit: amountUnit })}`))
            }
            details.push(h(
              'div',
              { className: 'sub-limits-pu-meter', key: `meter-${def.short}` },
              h('span', { className: 'sub-limits-pu-meter-key' }, def.short),
              h('span', { className: 'sub-limits-pu-meter-bar' }, h('span', { className: 'sub-limits-pu-bar-fill', 'data-tone': providerTone(windowPct), 'data-stale': windowStale ? 'true' : 'false', style: { display: 'block', width: `${clampPercent(windowPct)}%` } })),
              h('span', { className: 'sub-limits-pu-meter-val', 'data-tone': windowTone }, `${windowPct}%`),
              resetText.length > 0 ? h('span', { className: 'sub-limits-pu-meter-eta' }, t('providersResets', { value: resetText })) : null
            ))
          }
          children.push(h('div', { className: 'sub-limits-pu-detail', key: `${key}-detail` }, ...details))
        }

        return children.length === 1 ? children[0] : h('div', { key: `${key}-wrap` }, ...children)
      })

      let body
      if (failed.length > 0 && !hasData) body = h('div', { className: 'sub-limits-note', 'data-tone': 'danger' }, `${t('providersUnavailable')}: ${failed}`)
      else if (missing) body = h('div', { className: 'sub-limits-note' }, t('providersMissing'))
      else if (!hasData) body = h('div', { className: 'sub-limits-note' }, loading ? t('providersLoading') : t('providersEmpty'))
      else body = h('div', { className: 'sub-limits-pu-rows' },
        stale ? h('div', { className: 'sub-limits-sr', role: 'status' }, t('providersStaleWarning')) : null,
        snapshot && snapshot.persistenceError ? h('div', { className: 'sub-limits-note', role: 'status' }, t('providersNotSaved')) : null,
        ...rows)

      const announce = hasData ? `${t('providers')}: ${summaryText}` : summaryText

      return h(
        'div',
        { className: 'sub-limits-pu' },
        head,
        periodControls,
        body,
        h('div', { className: 'sub-limits-sr', role: 'status', 'aria-live': 'polite' }, announce),
        h('div', {
          className: 'sub-limits-note', role: 'status', 'aria-live': 'polite',
          title: generatedAt > 0 ? `${t('providersChecked')}: ${new Date(generatedAt).toLocaleString()}` : undefined
        }, lastAttempt
          ? `${t('providersAttempt')}: ${new Date(lastAttempt.at).toLocaleString()} · ${t(lastAttempt.status)}`
          : generatedAt > 0 ? `${t('providersChecked')}: ${new Date(generatedAt).toLocaleString()}` : '')
      )
    }

    function apply(ctx) {
      const slots = ctx.slots
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'sub-limits: copy en')
      ctx.effect(() => ctx.locale.register(NS, 'ru', RU), 'sub-limits: copy ru')
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-sub-limits'
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, 'sub-limits: styles')
      ctx.effect(() => slots.inject('sidebar.footer.action', () => slots.register({
        name: 'sidebar.footer.action',
        id: 'sub-limits-providers',
        order: 10,
        locale: NS
      }, (slotProps) => h(ProviderUsage, { ...slotProps, ctx }))), 'sub-limits: provider usage')
    }

    return {
      inject: ['slots', 'locale'],
      apply
    }
  }
})
