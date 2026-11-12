import { homedir } from 'node:os'
import { join } from 'node:path'
import { createProviderUsage } from './provider-usage.js'

const PROVIDERS_ROUTE = '/api/sub-limits/providers'
const OPENCODE_CREDENTIAL = 'OPENCODE_API_KEY'

function resolveHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv.length > 0 ? fromEnv : join(homedir(), '.dsh')
}

function cleanString(value, limit) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed
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

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function providersHandler(getProviderUsage, log) {
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
    } catch (error) {
      if (log) log(`providers request failed: ${error && error.message ? error.message : String(error)}`)
      sendJson(res, 502, { ok: false, code: 'NATIVE_UNAVAILABLE', error: 'Native DSH quotas unavailable', generatedAt: null, reports: [] })
    }
  }
}

export function apply(ctx, config) {
  const log = pickLogger(ctx)
  const providers = []
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
  const getProviderUsage = createProviderUsage({
    snapshotPath: join(resolveHome(), 'sub-limits-provider-usage.json'),
    configuredProviders: () => providers,
    opencodeKey
  })

  ctx.inject(['llm'], (llmCtx) => {
    const sync = () => {
      const llm = typeof llmCtx.get === 'function' ? llmCtx.get('llm') : llmCtx.llm
      let discovered
      try {
        discovered = llm !== undefined && llm !== null && typeof llm.listConfigurableProviders === 'function'
          ? llm.listConfigurableProviders()
          : []
      } catch {
        discovered = []
      }
      const next = []
      for (const entry of Array.isArray(discovered) ? discovered : []) {
        if (entry === null || typeof entry !== 'object') continue
        const id = cleanString(entry.provider, 120)
        if (id.length > 0) next.push(id)
      }
      providers.length = 0
      providers.push(...next)
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
        await inner(req, res)
      }
      return webCtx.webServer.register({ kind: 'exact', path: PROVIDERS_ROUTE, handler: guard(providersHandler(getProviderUsage, log)) })
    }, 'sub-limits: providers route')
  })
}
