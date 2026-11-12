window.__ModuleLoader__.load({
  id: 'dsh-sub-limits',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'subLimits'
    const STATUS_ROUTE = '/api/sub-limits/status'
    const CONFIG_ROUTE = '/api/sub-limits/config'
    const CALIBRATE_ROUTE = '/api/sub-limits/calibrate'
    const PROVIDERS_ROUTE = '/api/sub-limits/providers'
    const POLL_MS = 5000
    const PROVIDER_POLL_MS = 60000
    const TICK_MS = 1000
    const REQUEST_TIMEOUT_MS = 10000

    const CSS = `
.sub-limits-root{display:block;min-width:0;flex:1 1 100%;width:100%;container-type:inline-size;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);line-height:18px}
.sub-limits-hud{display:flex;align-items:center;gap:12px;min-width:0;padding:2px 4px;flex-wrap:wrap}
.sub-limits-route{display:flex;align-items:baseline;gap:6px;min-width:0;max-width:32%;flex:none}
.sub-limits-route-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-strong-12)}
.sub-limits-route-dot{width:5px;height:5px;border-radius:999px;background:var(--dsw-alias-state-idle-primary);flex:none;align-self:center}
.sub-limits-route-dot[data-live="true"]{background:var(--dsw-alias-brand-primary)}
.sub-limits-meters{display:flex;align-items:center;gap:16px;flex:1 1 220px;min-width:0}
.sub-limits-meter{display:flex;align-items:center;gap:6px;flex:1 1 0;min-width:0}
.sub-limits-meter-label{flex:none;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);letter-spacing:.02em}
.sub-limits-bar{position:relative;flex:1 1 40px;min-width:32px;height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}
.sub-limits-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-state-idle-primary);transition:width .25s ease,background-color .25s ease}
.sub-limits-bar-fill[data-tone="ok"]{background:var(--dsw-alias-state-success-primary)}
.sub-limits-bar-fill[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}
.sub-limits-bar-fill[data-tone="danger"]{background:var(--dsw-alias-state-error-primary)}
.sub-limits-bar[data-unknown="true"]{background:var(--dsw-alias-border-l1);opacity:.6}
.sub-limits-value{flex:none;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.sub-limits-value[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-value[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-eta{flex:none;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;white-space:nowrap}
.sub-limits-toggle{flex:none;display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer}
.sub-limits-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-toggle[aria-expanded="true"]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.sub-limits-empty{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);padding:2px 4px}
.sub-limits-panel{display:grid;gap:12px;margin:6px 0 2px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.sub-limits-group{display:grid;gap:6px;min-width:0}
.sub-limits-group-title{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);text-transform:uppercase;letter-spacing:.04em}
.sub-limits-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sub-limits-seg{display:inline-flex;padding:2px;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.sub-limits-seg button{height:22px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer}
.sub-limits-seg button:hover{color:var(--dsw-alias-label-primary)}
.sub-limits-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.sub-limits-seg button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-btn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11);cursor:pointer}
.sub-limits-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.sub-limits-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-btn:disabled{opacity:.55;cursor:default}
.sub-limits-btn[data-variant="primary"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.sub-limits-btn[data-variant="primary"]:hover{background:var(--dsw-alias-brand-primary);opacity:.9}
.sub-limits-input{height:24px;width:96px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);font-variant-numeric:tabular-nums}
.sub-limits-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-range{flex:1 1 140px;min-width:120px;height:18px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.sub-limits-range:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sub-limits-routes{display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow-y:auto}
.sub-limits-route-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);cursor:pointer;min-width:0}
.sub-limits-route-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub-limits-route-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-route-chip[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sub-limits-route-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sub-limits-note{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11)}
.sub-limits-note[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:2px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:2px}
.sub-limits-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11)}
.sub-limits-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.sub-limits-pct{min-width:38px;text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
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
.sub-limits-pu-meter-bar .sub-limits-pu-bar-fill[data-tone="ok"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-meter-bar .sub-limits-pu-bar-fill[data-tone="warn"]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-meter-bar .sub-limits-pu-bar-fill[data-tone="danger"]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, var(--dsw-alias-bg-layer-1))}
.sub-limits-pu-meter-val{flex:none;font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.sub-limits-pu-meter-val[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-pu-meter-val[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
.sub-limits-pu-meter-eta{flex:none;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sub-limits-pu-balance{display:flex;align-items:baseline;gap:6px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sub-limits-pu-balance-key{flex:none;min-width:22px;text-transform:uppercase;letter-spacing:.04em}
.sub-limits-pu-balance-val{color:var(--dsw-alias-label-primary)}
.sub-limits-pu-rail{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;padding:0 6px;border-radius:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums}
.sub-limits-pu-rail[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.sub-limits-pu-rail[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}
@container (max-width:560px){.sub-limits-route{max-width:100%;flex:1 1 100%}.sub-limits-meters{flex:1 1 100%}}
@container (max-width:480px){.sub-limits-meter{flex:1 1 100%}.sub-limits-eta{flex:0 1 auto;white-space:nowrap}.sub-limits-hud{row-gap:4px}}
`

    const EN = {
      fiveHour: '5h',
      weekly: '7d',
      left: 'left',
      idle: 'idle',
      noCap: 'no cap',
      noRoutes: 'No model route recorded yet',
      details: 'Details',
      hide: 'Hide',
      active: 'active',
      allRoutes: 'All routes',
      route: 'Route',
      routes: 'Routes',
      tracking: 'Tracking',
      requests: 'Requests',
      requestsShort: 'req',
      tokensShort: 'tok',
      tokens: 'Tokens',
      windowMode: '5-hour window',
      rolling: 'Rolling',
      block: 'Fixed block',
      caps: 'Caps',
      fiveHourCap: '5h cap',
      weeklyCap: '7d cap',
      saveCaps: 'Save caps',
      saveNoChange: 'Nothing to save',
      saved: 'Saved',
      calibrate: 'Adjust remaining',
      calibrateHint: 'Use this when quota was spent outside DSH.',
      remaining: 'remaining',
      resetFive: 'Reset 5h',
      resetWeekly: 'Reset 7d',
      resetAll: 'Reset all',
      ledger: 'Ledger',
      refresh: 'Refresh',
      failed: 'Request failed',
      setCap: 'Set cap',
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
      providersNoLimits: 'no limits reported',
      providersBalance: 'balance',
      providersHighest: '{provider} · {percent}% used · {window}',
      providersHighestAndBalance: '{provider} · {percent}% used · {window} · {amount}',
      providersRefresh: 'Refresh provider usage',
      providersResets: 'resets {value}',
      providersAccount: 'Account {number}',
      providersBalanceShort: 'bal',
      providersPeriod: 'Quota period',
      providersAllPeriods: 'All'
    }

    const RU = {
      fiveHour: '5ч',
      weekly: '7д',
      left: 'осталось',
      idle: 'простой',
      noCap: 'без лимита',
      noRoutes: 'Маршруты модели пока не записаны',
      details: 'Детали',
      hide: 'Скрыть',
      active: 'активен',
      allRoutes: 'Все маршруты',
      route: 'Маршрут',
      routes: 'Маршруты',
      tracking: 'Учёт',
      requests: 'Запросы',
      requestsShort: 'запр',
      tokensShort: 'ток',
      tokens: 'Токены',
      windowMode: 'Окно 5 часов',
      rolling: 'Скользящее',
      block: 'Фикс. блок',
      caps: 'Лимиты',
      fiveHourCap: 'Лимит 5ч',
      weeklyCap: 'Лимит 7д',
      saveCaps: 'Сохранить',
      saveNoChange: 'Нечего сохранять',
      saved: 'Сохранено',
      calibrate: 'Коррекция остатка',
      calibrateHint: 'Если квота израсходована вне DSH.',
      remaining: 'остаток',
      resetFive: 'Сброс 5ч',
      resetWeekly: 'Сброс 7д',
      resetAll: 'Сбросить всё',
      ledger: 'Журнал',
      refresh: 'Обновить',
      failed: 'Запрос не выполнен',
      setCap: 'Задать лимит',
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
      providersNoLimits: 'лимиты не сообщаются',
      providersBalance: 'баланс',
      providersHighest: '{provider} · израсходовано {percent}% · {window}',
      providersHighestAndBalance: '{provider} · израсходовано {percent}% · {window} · {amount}',
      providersRefresh: 'Обновить расход провайдеров',
      providersResets: 'сброс {value}',
      providersAccount: 'Аккаунт {number}',
      providersBalanceShort: 'бал',
      providersPeriod: 'Период квоты',
      providersAllPeriods: 'Все'
    }

    function requestJson(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const guard = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
      const settle = () => {
        if (guard !== null) clearTimeout(guard)
      }
      return fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...(controller === null ? {} : { signal: controller.signal }),
        ...init,
        headers: {
          accept: 'application/json',
          ...(init && init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(init && init.headers ? init.headers : {})
        }
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
      }).finally(settle)
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0m'
      const totalMinutes = Math.floor(ms / 60000)
      const days = Math.floor(totalMinutes / 1440)
      const hours = Math.floor((totalMinutes % 1440) / 60)
      const minutes = totalMinutes % 60
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      return `${minutes}m`
    }

    function formatNumber(value) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return '0'
      if (parsed >= 1000000) return `${(parsed / 1000000).toFixed(1)}M`
      if (parsed >= 10000) return `${Math.round(parsed / 1000)}k`
      return String(Math.round(parsed))
    }

    function toneOf(pct) {
      if (!Number.isFinite(pct)) return 'idle'
      if (pct < 10) return 'danger'
      if (pct < 30) return 'warn'
      return 'ok'
    }

    function routeLabel(route, t) {
      if (!route) return ''
      const provider = route.provider && route.provider.length > 0 ? route.provider : '*'
      const model = route.model && route.model.length > 0 ? route.model : '*'
      return `${provider} / ${model}`
    }

    function useNow(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), active ? TICK_MS : POLL_MS)
        return () => clearInterval(id)
      }, [active])
      return now
    }

    function Bar(props) {
      const known = Number.isFinite(props.pct)
      const pct = known ? Math.max(Math.min(props.pct, 100), 0) : 0
      const tone = props.tone
      const fill = h('div', {
        className: 'sub-limits-bar-fill',
        'data-tone': tone,
        style: { width: `${pct}%` }
      })
      if (!known) return null
      return h(
        'div',
        {
          className: 'sub-limits-bar',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(pct),
          'aria-valuetext': props.value,
          'aria-label': props.label
        },
        fill
      )
    }

    function announce(report, mode, t) {
      const pct = report && Number.isFinite(report.remainingPct) ? report.remainingPct : null
      if (pct !== null) return `${Math.round(pct)}% ${t('remaining').toLowerCase()}`
      const used = report && Number.isFinite(report.used) ? report.used : 0
      const unit = mode === 'tokens' ? t('tokensShort') : t('requestsShort')
      return `${formatNumber(used)} ${unit} ${t('noCap')}`
    }

    function Meter(props) {
      const { t, label, report, now } = props
      const pct = report && Number.isFinite(report.remainingPct) ? report.remainingPct : null
      const tone = toneOf(pct)
      const resetIn = report && report.resetAt > 0 ? report.resetAt - now : 0
      const used = report && Number.isFinite(report.used) ? report.used : 0
      const unit = props.mode === 'tokens' ? t('tokensShort') : t('requestsShort')
      const value = pct === null ? `${formatNumber(used)} ${unit}` : `${Math.round(pct)}%`
      const eta = resetIn > 0 ? `${formatDuration(resetIn)} ${t('left')}` : pct === null ? t('noCap') : t('idle')
      return h(
        'div',
        { className: 'sub-limits-meter' },
        h('span', { className: 'sub-limits-meter-label' }, label),
        pct === null ? null : h(Bar, { pct, tone, label, value }),
        h('span', { className: 'sub-limits-value', 'data-tone': tone }, value),
        h('span', { className: 'sub-limits-eta' }, eta)
      )
    }

    function Hud(props) {
      const ctx = props.ctx
      const t = ctx.locale.bind(NS)
      const [data, setData] = useState(null)
      const [loaded, setLoaded] = useState(false)
      const [error, setError] = useState('')
      const [expanded, setExpanded] = useState(false)
      const [showAll, setShowAll] = useState(false)
      const [selectedKey, setSelectedKey] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNoticeKey] = useState('')
      const [lastOk, setLastOk] = useState(0)
      const [fivePct, setFivePct] = useState(50)
      const [weeklyPct, setWeeklyPct] = useState(50)
      const [, setDraftTick] = useState(0)
      const mounted = useRef(true)
      const sliderTimers = useRef({})
      const draftText = useRef({ five: { requests: '', tokens: '' }, weekly: { requests: '', tokens: '' } })
      const draftTouched = useRef({ five: { requests: false, tokens: false }, weekly: { requests: false, tokens: false } })
      const now = useNow(expanded || busy)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
          for (const key of Object.keys(sliderTimers.current)) {
            const timer = sliderTimers.current[key]
            if (timer !== null && timer !== undefined) clearTimeout(timer)
          }
          sliderTimers.current = {}
        }
      }, [])

      const load = useCallback(() => {
        return requestJson(STATUS_ROUTE)
          .then((payload) => {
            if (!mounted.current) return
            setData(payload)
            setError('')
            setLastOk(Date.now())
            setLoaded(true)
          })
          .catch((cause) => {
            if (!mounted.current) return
            setError(cause && cause.message ? cause.message : String(cause))
          })
      }, [])

      const pollMs = data && Number.isFinite(data.pollMs) ? Math.max(Math.min(data.pollMs, 60000), 1000) : POLL_MS

      useEffect(() => {
        load()
        const id = setInterval(load, pollMs)
        return () => clearInterval(id)
      }, [load, pollMs])

      const routes = data && Array.isArray(data.routes) ? data.routes : []
      const activeRoute = routes.find((route) => route.active) ?? null
      const selected = routes.find((route) => route.key === selectedKey) ?? activeRoute ?? routes[0] ?? null
      const busyRoutes = routes.filter((route) => route.active || (route.fiveHour && route.fiveHour.used > 0) || (route.weekly && route.weekly.used > 0) || (route.fiveHour && route.fiveHour.cap > 0) || (route.weekly && route.weekly.cap > 0))
      const visibleRoutes = showAll || busyRoutes.length === 0
        ? routes
        : (selected && busyRoutes.every((route) => route.key !== selected.key) ? [...busyRoutes, selected] : busyRoutes)
      const mode = data && data.mode === 'tokens' ? 'tokens' : 'requests'
      const blockMode = data && data.blockMode === 'block' ? 'block' : 'rolling'
      const fiveDraft = draftText.current.five[mode]
      const weeklyDraft = draftText.current.weekly[mode]

      const routeKey = selected ? selected.key : ''
      const limitKey = selected && selected.limits
        ? `${selected.limits.fiveHourRequests}|${selected.limits.weeklyRequests}|${selected.limits.fiveHourTokens}|${selected.limits.weeklyTokens}`
        : ''
      const routeRef = useRef('')

      useEffect(() => {
        const switched = routeRef.current !== routeKey
        routeRef.current = routeKey
        if (switched) {
          for (const windowName of Object.keys(sliderTimers.current)) {
            const pending = sliderTimers.current[windowName]
            if (pending !== null && pending !== undefined) clearTimeout(pending)
            sliderTimers.current[windowName] = null
          }
          draftText.current = { five: { requests: '', tokens: '' }, weekly: { requests: '', tokens: '' } }
          draftTouched.current = { five: { requests: false, tokens: false }, weekly: { requests: false, tokens: false } }
        }
        if (!selected) {
          let cleared = false
          for (const windowName of ['five', 'weekly']) {
            for (const windowMode of ['requests', 'tokens']) {
              if (draftText.current[windowName][windowMode] !== '') {
                draftText.current[windowName][windowMode] = ''
                cleared = true
              }
            }
          }
          if (cleared || switched) setDraftTick((tick) => tick + 1)
          return
        }
        const limits = selected.limits ?? {}
        const stored = {
          five: mode === 'tokens' ? limits.fiveHourTokens : limits.fiveHourRequests,
          weekly: mode === 'tokens' ? limits.weeklyTokens : limits.weeklyRequests
        }
        let changed = switched
        for (const windowName of ['five', 'weekly']) {
          if (draftTouched.current[windowName][mode]) continue
          if ((sliderTimers.current[windowName] ?? null) !== null) continue
          const next = stored[windowName] > 0 ? String(stored[windowName]) : ''
          if (draftText.current[windowName][mode] !== next) {
            draftText.current[windowName][mode] = next
            changed = true
          }
        }
        if (changed) setDraftTick((tick) => tick + 1)
      }, [routeKey, limitKey, mode, selected])

      const fiveRemaining = selected && selected.fiveHour && Number.isFinite(selected.fiveHour.remainingPct) ? selected.fiveHour.remainingPct : null
      const weeklyRemaining = selected && selected.weekly && Number.isFinite(selected.weekly.remainingPct) ? selected.weekly.remainingPct : null
      const pctKey = `${routeKey}|${fiveRemaining}|${weeklyRemaining}`
      const pctRef = useRef('')

      useEffect(() => {
        if (!selected) {
          pctRef.current = ''
          return
        }
        if (pctRef.current === pctKey) return
        pctRef.current = pctKey
        if ((sliderTimers.current.five ?? null) === null) setFivePct(fiveRemaining === null ? 100 : fiveRemaining)
        if ((sliderTimers.current.weekly ?? null) === null) setWeeklyPct(weeklyRemaining === null ? 100 : weeklyRemaining)
      }, [pctKey, selected, fiveRemaining, weeklyRemaining])

      const applySnapshot = useCallback((payload) => {
        if (!mounted.current || payload === null || payload === undefined) return
        setData(payload)
        setError('')
      }, [])

      const postConfig = useCallback((body) => {
        setBusy(true)
        return requestJson(CONFIG_ROUTE, { method: 'POST', body: JSON.stringify(body) })
          .then((payload) => {
            applySnapshot(payload)
            setNoticeKey('saved')
            return true
          })
          .catch((cause) => {
            if (mounted.current) setError(cause && cause.message ? cause.message : String(cause))
            return false
          })
          .finally(() => {
            if (mounted.current) setBusy(false)
          })
      }, [applySnapshot, t])

      const postCalibrate = useCallback((body) => {
        setBusy(true)
        return requestJson(CALIBRATE_ROUTE, { method: 'POST', body: JSON.stringify(body) })
          .then((payload) => applySnapshot(payload))
          .catch((cause) => {
            if (mounted.current) setError(cause && cause.message ? cause.message : String(cause))
          })
          .finally(() => {
            if (mounted.current) setBusy(false)
          })
      }, [applySnapshot])

      const onMode = useCallback((nextMode) => {
        postConfig({ mode: nextMode })
      }, [postConfig])

      const onBlockMode = useCallback((nextMode) => {
        postConfig({ blockMode: nextMode })
      }, [postConfig])

      const onSaveCaps = useCallback(() => {
        if (!selected) return
        const fiveText = String(draftText.current.five[mode] ?? '').trim()
        const weeklyText = String(draftText.current.weekly[mode] ?? '').trim()
        const sendFive = draftTouched.current.five[mode]
        const sendWeekly = draftTouched.current.weekly[mode]
        if (!sendFive && !sendWeekly) {
          setNoticeKey('saveNoChange')
          return
        }
        const fiveValue = fiveText.length === 0 ? 0 : Number(fiveText)
        const weeklyValue = weeklyText.length === 0 ? 0 : Number(weeklyText)
        if ((sendFive && !Number.isFinite(fiveValue)) || (sendWeekly && !Number.isFinite(weeklyValue))) {
          setError(t('failed'))
          return
        }
        setError('')
        setNoticeKey('')
        const routeKeyAtSave = selected.key
        let chain = Promise.resolve(true)
        if (sendFive) {
          chain = chain.then((ok) => postConfig({ route: routeKeyAtSave, window: 'fiveHour', cap: Math.max(fiveValue, 0), capMode: mode, blockMode }).then((result) => ok && result))
        }
        if (sendWeekly) {
          chain = chain.then((ok) => postConfig({ route: routeKeyAtSave, window: 'weekly', cap: Math.max(weeklyValue, 0), capMode: mode }).then((result) => ok && result))
        }
        chain.then((ok) => {
          if (!ok || !mounted.current) return
          draftTouched.current.five[mode] = false
          draftTouched.current.weekly[mode] = false
          setDraftTick((tick) => tick + 1)
        })
      }, [blockMode, mode, postConfig, selected, t])

      const scheduleSlider = useCallback((window, pct) => {
        if (!selected) return
        const routeAtDrag = selected.key
        const previous = sliderTimers.current[window]
        if (previous !== null && previous !== undefined) clearTimeout(previous)
        sliderTimers.current[window] = setTimeout(() => {
          sliderTimers.current[window] = null
          if (routeRef.current !== routeAtDrag) return
          postCalibrate({ action: 'pct', route: routeAtDrag, window, pct })
        }, 320)
      }, [postCalibrate, selected])

      const clearSlider = useCallback((window) => {
        const timer = sliderTimers.current[window]
        if (timer !== null && timer !== undefined) clearTimeout(timer)
        sliderTimers.current[window] = null
      }, [])

      const onReset = useCallback((window) => {
        if (!selected) return
        for (const key of Object.keys(sliderTimers.current)) clearSlider(key)
        postCalibrate({ action: 'reset', route: selected.key, window })
      }, [clearSlider, postCalibrate, selected])

      const hudRoute = selected ?? activeRoute
      const meters = hudRoute
        ? [
            h(Meter, { key: 'five', t, mode, label: t('fiveHour'), report: hudRoute.fiveHour, now }),
            h(Meter, { key: 'weekly', t, mode, label: t('weekly'), report: hudRoute.weekly, now })
          ]
        : []

      if (!loaded && error.length === 0) {
        return h(
          'div',
          { className: 'sub-limits-root' },
          h('div', { className: 'sub-limits-hud' },
            h('span', { className: 'sub-limits-route-name', 'aria-hidden': 'true' }, ''),
            h('div', { className: 'sub-limits-meters' })
          )
        )
      }

      const header = h(
        'div',
        { className: 'sub-limits-hud' },
        hudRoute
          ? h(
              'div',
              { className: 'sub-limits-route' },
              h('span', { className: 'sub-limits-route-dot', 'data-live': hudRoute.active ? 'true' : 'false', 'aria-hidden': 'true' }),
              h('span', { className: 'sub-limits-route-name', title: routeLabel(hudRoute, t) }, routeLabel(hudRoute, t))
            )
          : h('span', { className: 'sub-limits-route-name' }, t('noRoutes')),
        h('div', { className: 'sub-limits-meters' }, ...meters),
        hudRoute && hudRoute.fiveHour && hudRoute.weekly && hudRoute.fiveHour.cap === 0 && hudRoute.weekly.cap === 0
          ? h('button', {
              type: 'button',
              className: 'sub-limits-toggle sub-limits-setcap',
              onClick: () => {
                setNoticeKey('')
                setExpanded(true)
              }
            }, t('setCap'))
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'sub-limits-toggle',
            'aria-expanded': expanded ? 'true' : 'false',
            onClick: () => {
              setNoticeKey('')
              setExpanded((value) => !value)
            }
          },
          expanded ? t('hide') : t('details')
        )
      )

      const announceLine = hudRoute
        ? `${t('fiveHour')}: ${announce(hudRoute.fiveHour, mode, t)}, ${t('weekly')}: ${announce(hudRoute.weekly, mode, t)}`
        : t('noRoutes')

      const statusLine = error.length > 0
        ? h('div', { className: 'sub-limits-note', 'data-tone': 'danger' }, `${t('failed')}: ${error}${lastOk > 0 ? ` · ${formatDuration(Math.max(now - lastOk, 0))}` : ''}`)
        : notice.length > 0
          ? h('div', { className: 'sub-limits-note' }, t(notice))
          : null

      const liveLine = h('div', { className: 'sub-limits-sr', role: 'status', 'aria-live': 'polite' }, announceLine)

      const shell = (panelNode) => h(
        'div',
        { className: 'sub-limits-root' },
        h('div', { key: 'header' }, header),
        statusLine,
        panelNode,
        h('div', { key: 'live' }, liveLine)
      )

      if (!expanded) {
        return shell(null)
      }

      const routeChips = routes.length > 0
        ? h(
            'div',
            { className: 'sub-limits-routes', role: 'group', 'aria-label': t('routes') },
            ...visibleRoutes.map((route) => h(
              'button',
              {
                key: route.key,
                type: 'button',
                className: 'sub-limits-route-chip',
                'aria-pressed': selected && selected.key === route.key ? 'true' : 'false',
                title: route.key,
                onClick: () => {
                  setSelectedKey(route.key)
                  setNoticeKey('')
                }
              },
              h('span', null, routeLabel(route, t)),
              route.active ? h('span', { className: 'sub-limits-note' }, `· ${t('active')}`) : null
            )),
            routes.length > visibleRoutes.length || showAll
              ? h('button', {
                  type: 'button',
                  className: 'sub-limits-route-chip',
                  'aria-pressed': showAll ? 'true' : 'false',
                  onClick: () => setShowAll((value) => !value)
                }, showAll ? t('hide') : `${t('allRoutes')} (${routes.length})`)
              : null
          )
        : h('div', { className: 'sub-limits-note' }, t('noRoutes'))

      const capsGroup = h(
        'div',
        { className: 'sub-limits-group' },
        h('div', { className: 'sub-limits-group-title' }, t('caps')),
        h(
          'div',
          { className: 'sub-limits-row' },
          h(
            'label',
            { className: 'sub-limits-row', style: { gap: '6px' } },
            h('span', { className: 'sub-limits-note' }, t('fiveHourCap')),
            h('input', {
              className: 'sub-limits-input',
              type: 'number',
              min: '0',
              step: '1',
              inputMode: 'numeric',
              disabled: busy || !selected,
              'aria-label': t('fiveHourCap'),
              value: fiveDraft,
              placeholder: t('noCap'),
              onChange: (event) => {
                draftTouched.current.five[mode] = true
                draftText.current.five[mode] = event.target.value
                setDraftTick((tick) => tick + 1)
              }
            })
          ),
          h(
            'label',
            { className: 'sub-limits-row', style: { gap: '6px' } },
            h('span', { className: 'sub-limits-note' }, t('weeklyCap')),
            h('input', {
              className: 'sub-limits-input',
              type: 'number',
              min: '0',
              step: '1',
              inputMode: 'numeric',
              disabled: busy || !selected,
              'aria-label': t('weeklyCap'),
              value: weeklyDraft,
              placeholder: t('noCap'),
              onChange: (event) => {
                draftTouched.current.weekly[mode] = true
                draftText.current.weekly[mode] = event.target.value
                setDraftTick((tick) => tick + 1)
              }
            })
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sub-limits-btn',
              'data-variant': 'primary',
              disabled: busy || !selected,
              onClick: onSaveCaps
            },
            t('saveCaps')
          )
        )
      )

      const calibrateGroup = h(
        'div',
        { className: 'sub-limits-group' },
        h('div', { className: 'sub-limits-group-title' }, t('calibrate')),
        h('div', { className: 'sub-limits-note' }, t('calibrateHint')),
        h(
          'div',
          { className: 'sub-limits-row' },
          h('span', { className: 'sub-limits-meter-label' }, t('fiveHour')),
          h('input', {
            className: 'sub-limits-range',
            type: 'range',
            min: '0',
            max: '100',
            step: '1',
            value: fivePct,
            'aria-label': `${t('fiveHour')} ${t('remaining')}`,
            onChange: (event) => {
              const next = Number(event.target.value)
              setFivePct(next)
              scheduleSlider('five', next)
            }
          }),
          h('span', { className: 'sub-limits-pct' }, `${Math.round(fivePct)}%`)
        ),
        h(
          'div',
          { className: 'sub-limits-row' },
          h('span', { className: 'sub-limits-meter-label' }, t('weekly')),
          h('input', {
            className: 'sub-limits-range',
            type: 'range',
            min: '0',
            max: '100',
            step: '1',
            value: weeklyPct,
            'aria-label': `${t('weekly')} ${t('remaining')}`,
            onChange: (event) => {
              const next = Number(event.target.value)
              setWeeklyPct(next)
              scheduleSlider('weekly', next)
            }
          }),
          h('span', { className: 'sub-limits-pct' }, `${Math.round(weeklyPct)}%`)
        ),
        h(
          'div',
          { className: 'sub-limits-row' },
          h('button', {
            type: 'button',
            className: 'sub-limits-btn',
            disabled: busy || !selected,
            onClick: () => onReset('fiveHour')
          }, t('resetFive')),
          h('button', {
            type: 'button',
            className: 'sub-limits-btn',
            disabled: busy || !selected,
            onClick: () => onReset('weekly')
          }, t('resetWeekly')),
          h('button', {
            type: 'button',
            className: 'sub-limits-btn',
            disabled: busy || !selected,
            onClick: () => onReset('history')
          }, t('resetAll'))
        )
      )

      const selectionLine = selected
        ? h(
            'div',
            { className: 'sub-limits-note' },
            `${t('route')}: ${routeLabel(selected, t)} · ${formatNumber(selected.week && selected.week.requests)} ${t('requests').toLowerCase()} / ${formatNumber(selected.week && selected.week.tokens)} ${t('tokens').toLowerCase()}`
          )
        : null

      const panel = h(
        'div',
        { className: 'sub-limits-panel', role: 'region', 'aria-label': t('details') },
        h(
          'div',
          { className: 'sub-limits-group' },
          h('div', { className: 'sub-limits-group-title' }, t('routes')),
          routeChips,
          selectionLine
        ),
        h(
          'div',
          { className: 'sub-limits-group' },
          h('div', { className: 'sub-limits-group-title' }, t('tracking')),
          h(
            'div',
            { className: 'sub-limits-row' },
            h(
              'div',
              { className: 'sub-limits-seg', role: 'group', 'aria-label': t('tracking') },
              h('button', {
                type: 'button',
                'aria-pressed': mode === 'requests' ? 'true' : 'false',
                onClick: () => onMode('requests')
              }, t('requests')),
              h('button', {
                type: 'button',
                'aria-pressed': mode === 'tokens' ? 'true' : 'false',
                onClick: () => onMode('tokens')
              }, t('tokens'))
            ),
            h(
              'div',
              { className: 'sub-limits-seg', role: 'group', 'aria-label': t('windowMode') },
              h('button', {
                type: 'button',
                'aria-pressed': blockMode === 'rolling' ? 'true' : 'false',
                onClick: () => onBlockMode('rolling')
              }, t('rolling')),
              h('button', {
                type: 'button',
                'aria-pressed': blockMode === 'block' ? 'true' : 'false',
                onClick: () => onBlockMode('block')
              }, t('block'))
            )
          )
        ),
        capsGroup,
        calibrateGroup,
        h(
          'div',
          { className: 'sub-limits-foot' },
          h('span', { className: 'sub-limits-path', title: data && data.ledgerPath ? data.ledgerPath : '' }, `${t('ledger')}: ${data && data.ledgerPath ? data.ledgerPath : '—'}`),
          h('button', {
            type: 'button',
            className: 'sub-limits-btn',
            disabled: busy,
            onClick: () => load()
          }, t('refresh'))
        )
      )

      return shell(panel)
    }

    const WINDOW_DEFS = [
      { short: '5H', pick: (report) => report.fiveHour },
      { short: '7D', pick: (report) => report.sevenDay },
      { short: '30D', pick: (report) => report.monthly },
      { short: '24H', pick: (report) => report.daily },
      { short: '?', pick: (report) => report.unscoped }
    ]

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

    function worstWindowOf(report) {
      let best = null
      for (const def of WINDOW_DEFS) {
        const window = def.pick(report)
        if (window && (best === null || window.percent > best.window.percent)) best = { short: def.short, window }
      }
      return best
    }

    function selectedWindowOf(report, period, freshOnly = false) {
      let best = null
      for (const def of WINDOW_DEFS) {
        if (period !== 'all' && def.short !== period) continue
        const window = def.pick(report)
        if (!window || !Number.isFinite(window.percent)) continue
        if (freshOnly && (window.stale === true || (report.stale === true && window.stale !== false))) continue
        if (best === null || window.percent > best.window.percent) best = { short: def.short, window }
      }
      return best
    }

    function windowResetText(window) {
      if (!window) return ''
      if (Number.isFinite(window.resetAt)) return formatUsageReset(Math.max(0, Math.ceil((window.resetAt - Date.now()) / 60000)), 'minutes')
      if (Number.isFinite(window.resetMinutes)) return formatUsageReset(window.resetMinutes, 'minutes')
      if (Number.isFinite(window.resetHours)) return formatUsageReset(window.resetHours, 'hours')
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
          return ['5H', '7D', 'all'].includes(saved) ? saved : '5H'
        } catch { return '5H' }
      })
      const [lastAttempt, setLastAttempt] = useState(null)
      const mounted = useRef(true)
      const inFlight = useRef(null)

      const load = useCallback((force) => {
        if (inFlight.current !== null) return inFlight.current
        setLoading(true)
        if (force) {
          setFailed('')
          setLastAttempt({ at: Date.now(), status: 'providersLoading' })
        }
        const url = force ? `${PROVIDERS_ROUTE}?refresh=1` : PROVIDERS_ROUTE
        const feedback = force ? new Promise((resolve) => setTimeout(resolve, 900)) : Promise.resolve()
        const promise = requestJson(url, undefined, 70000)
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
        ...['5H', '7D', 'all'].map((value) => h('button', {
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
        const key = `${report.provider}:${account}:${report.modelId ?? 'all'}:${index}`
        const best = selectedWindowOf(report, period)
        const readingStale = best && (best.window.stale === true || (report.stale === true && best.window.stale !== false))
        const balances = Array.isArray(report.balances) ? report.balances : []
        const primary = balances.length > 0 ? balances[0] : null
        const balanceText = primary ? formatUsageBalance(primary) : ''
        const pct = best ? Math.round(best.window.percent) : 0
        const tone = readingStale ? 'idle' : providerTone(pct)
        const expandable = report.noLimits !== true && (worstWindowOf(report) !== null || balances.length > 0)
        const open = openKey === key
        const balanceFraction = primary && Number.isFinite(primary.limit) && primary.limit > 0 && Number.isFinite(primary.used)
          ? Math.min(100, Math.max(0, (primary.used / primary.limit) * 100))
          : null
        const barPct = best ? pct : balanceFraction
        const barTone = providerTone(barPct)
        const meterLabel = typeof report.meterLabel === 'string' && report.meterLabel.length > 0
          ? report.meterLabel
          : (typeof report.tier === 'string' && report.tier.length > 0 ? report.tier : '')
        const sameProviderRows = reports.filter((candidate) => candidate.provider === report.provider && (candidate.accountLabel ?? candidate.accountIndex) === (report.accountLabel ?? report.accountIndex)).length

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
            title: `${report.provider} · ${account}${report.updatedAt ? ` · ${t('providersUpdated')}: ${new Date(report.updatedAt).toLocaleString()}` : ''}${report.stale ? ` · ${t('providersStale')}` : ''}`
          },
          expandable ? h('span', { className: 'sub-limits-pu-caret-in' }, caretIcon()) : h('span', { className: 'sub-limits-pu-caret-in', 'aria-hidden': 'true' }),
          h('span', { className: 'sub-limits-pu-tag' }, report.provider),
          h('span', { className: 'sub-limits-pu-account' }, meterLabel.length > 0 && sameProviderRows > 1 ? `${meterLabel} · ${account}` : account),
          valueNode
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
                  h('div', { className: 'sub-limits-pu-bar-fill', 'data-tone': barTone, 'data-stale': readingStale ? 'true' : 'false', style: { width: `${Math.min(100, Math.max(0, barPct))}%` } })
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
          for (const def of WINDOW_DEFS) {
            const window = def.pick(report)
            if (!window) continue
            const windowPct = Math.round(window.percent)
            const windowStale = window.stale === true || (report.stale === true && window.stale !== false)
            const windowTone = windowStale ? 'idle' : providerTone(windowPct)
            const resetText = windowResetText(window)
            if (window.unit === 'usd' && Number.isFinite(window.used) && Number.isFinite(window.limit)) {
              details.push(h('div', { className: 'sub-limits-note', key: `amount-${def.short}` }, `${formatUsageBalance({ remaining: window.used, unit: 'usd' })} / ${formatUsageBalance({ remaining: window.limit, unit: 'usd' })}`))
            }
            details.push(h(
              'div',
              { className: 'sub-limits-pu-meter', key: `meter-${def.short}` },
              h('span', { className: 'sub-limits-pu-meter-key' }, def.short),
              h('span', { className: 'sub-limits-pu-meter-bar' }, h('span', { className: 'sub-limits-pu-bar-fill', 'data-tone': providerTone(windowPct), 'data-stale': windowStale ? 'true' : 'false', style: { display: 'block', width: `${Math.min(100, Math.max(0, windowPct))}%` } })),
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
