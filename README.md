# dsh-sub-limits

Tracks the 5-hour and 7-day subscription usage limits of every active model route, with a compact HUD under the composer and a calibration panel for quota spent outside DSH.

## What it does

- **Auto-discovers routes.** The Host half reads the LLM provider directory (`llm.listConfigurableProviders()`) and refreshes it whenever `llm/adapters-updated` fires, so no provider has to be added by hand.
- **Records every turn.** `llm/stream` is observed as a waterfall listener: the wrapper passes chunks through untouched, keeps the `usage` chunk, and appends one ledger entry per call with timestamp, provider, model, input/output/cached tokens, and the request count.
- **Reads rate-limit headers when they exist.** A chunk carrying `headers`/`rateLimit`/`rate_limits` with `x-ratelimit-remaining-*` or `x-ratelimit-reset-*` is stored on the route and calibrates its remaining percentage; `x-ratelimit-reset` is understood as seconds, milliseconds, a duration (`6m0s`, `1h30m`, `500ms`) or an RFC 3339 timestamp. A `429` recorded on `agent/request-error` stores the upstream retry-after. Captured headers never overwrite a configured cap.
- **Computes two windows per route.**
  - 5-hour window, in `rolling` mode (trailing five hours) or `block` mode (a fixed block anchored at the first request after idle).
  - Weekly window anchored on the first request of the cycle.
  - Each window reports used/cap, remaining, remaining percentage, the reset instant, a live countdown, and whether the cap is exhausted.
- **Persists to `$DSH_HOME/sub-limits-ledger.json`** through `node:fs/promises` with an atomic temp-file rename: one in-flight writer, exponential retry on a failed write, a full flush awaited on teardown, and an unreadable ledger moved aside to `sub-limits-ledger.json.corrupt-<timestamp>.bak` instead of being overwritten. The file keeps `defaults` (the resolved caps and modes) and `userFields` (the ones set from the panel) beside `routes` and `overrides`; each route holds at most the newest 20 000 events, bounded by `historyDays`.

## HTTP endpoints

All four are registered on `ctx.webServer` and gated by `ctx.connection.requestRejection(req)`; a missing `connection` service fails closed with `503`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/sub-limits/status` | none |
| `GET` | `/api/sub-limits/providers` | none; `?refresh=1` refreshes quotas for each native DSH account |
| `POST` | `/api/sub-limits/config` | `{ mode?, blockMode?, fiveHourCap?, weeklyCap?, historyDays?, route?, window?, cap?, capMode? }` |
| `POST` | `/api/sub-limits/calibrate` | `{ action: 'pct', route?, window?, pct }` or `{ action: 'reset', route?, window?: 'fiveHour'\|'weekly'\|'history'\|'all' }` |

`mode` is `requests` or `tokens`; `blockMode` is `rolling` or `block`. A per-route `cap` in the request overrides the plugin-wide cap for the selected window; a cap set on `provider\0*` applies to every model of that provider, and a per-route cap wins over it.

Settings changed here are written to the ledger and marked in its `userFields` list, so a value set in the panel survives a restart even when the profile's patch still carries the original default. Values that were never set from the panel keep following the patch.

Validation is fail-closed: `route` must be a string naming a known route (`400`/`404` otherwise), `__proto__`/`prototype`/`constructor` are rejected, and `pct` must be a number inside `0..100`.

## Configuration

```yaml
- insert:
    - id: dsh-sub-limits
      name: dsh-sub-limits
      config:
        mode: requests
        blockMode: rolling
        fiveHourCap: 0
        weeklyCap: 0
        historyDays: 8
        pollMs: 5000
```

A cap of `0` means "no cap configured": the HUD then shows the live used count with its unit (`142 req` or `22.5M tok`) instead of a percentage, and the countdown is replaced by `no cap`.

`historyDays` is clamped to `8..90`. `pollMs` is the panel's refresh interval, clamped to `1000..60000`; the HUD follows the value returned by the host.

## UI

The browser half registers into `conversation.composer.dock`. The collapsed row shows the active route, two remaining-percentage bars with countdowns, and a `Details` toggle. Colours come from the host tokens: success above 30% remaining, warning between 10% and 30%, error below 10%. The expanded panel selects a route, switches the tracking mode and the 5-hour window mode, edits both caps, and drags sliders to calibrate the remaining percentage against quota spent outside DSH.

Cap fields keep their draft per route and per tracking mode: typing `250` in requests mode, switching to tokens and back still shows `250`, and a field the user has not touched keeps following the server value. `Save caps` writes only the fields that were edited and their current mode; with nothing edited it answers `Nothing to save` instead of writing zeroes, and a rejected write keeps the draft and the edited state so the value can be retried. Resetting a window cancels the pending slider calibration first, and the debounced slider write of one window is never cancelled by a drag on the other. A slider released just before a route switch is discarded rather than written to the route the user left.

The HUD sizes itself with a container query on its own root, so it reflows inside a narrowed side panel or a phone browser rather than only at a narrow viewport; below 480 px each window becomes its own line and the bar is omitted, because a bar with no scale says less than the number beside it. A route with no cap in either window shows the used count with its reset countdown and a `Set cap` action instead of two empty tracks, and once a window is exhausted the remaining percentage is forced to 0 regardless of a stale calibration. Percentages are announced through a single polite live region.

The browser half also registers into `sidebar.footer.action`, directly above Settings. It reads provider-metered quotas from the running DSH `dsh-plugin-oauth-subs` controller through its authenticated local API, without invoking OMP, reading OMP accounts, or creating a second authentication controller. The browser polls once a minute; concurrent reads share a request. Automatic polling explicitly refreshes supported native account quotas once their successful reading is at least a minute old, or when it is missing or not ready; it does not rely on the status RPC forwarding its revalidation option. `?refresh=1` refreshes every supported native account regardless of age. The loopback destination is pinned to the actual server port, forwards only the current authenticated request's cookie, and refuses redirects.

The collector normalizes native quota windows into separate account and product-pool rows, including independent Antigravity Gemini and Claude/GPT pools. Daily windows are labeled 24H rather than 5H. Reset countdowns use absolute timestamps. Sanitized snapshots, without credentials or raw provider errors, are atomically stored in `$DSH_HOME/sub-limits-provider-usage.json` with private file permissions. Account failures retain the last good values and their successful-update time, marked stale; a bridge failure retains the whole previous snapshot. A successful account enumeration removes logged-out accounts. Quotas older than five minutes are also marked stale.

The sidebar defaults to 5H and remembers the selected 5H, 7D, or All filter in the browser. Both the summary and each account row use the selected period; a missing 5H reading stays unknown rather than silently substituting a weekly percentage. All explicitly selects the highest consumed percentage across reported periods. Stale readings remain available in details but do not outrank current readings in the summary. The composer HUD separately shows the remaining percentage of the active route. Percentages accept only finite numbers or nonblank numeric strings: booleans, arrays, and objects cannot fabricate usage.

The OMP reference was traced through the deployed OMPWeb 0.6.0 server: its provider endpoint invokes `omp usage --json`, and a manual refresh first runs `omp usage invalidate`. This is the agent's quota command, not a chat RPC. DSH does not invoke that command or borrow OMP credentials; its existing native DSH account controller already reads the corresponding provider quota APIs. OMP's selected period, account pool, and cache can differ, so values from different applications are not assumed equal.

A reset timestamp in the past marks that window stale; the adapter never invents a new zero-usage window. A failed explicit native refresh retains the preceding ready reading and its timestamp only as stale. Native USD allowances with no declared duration remain period-unknown rather than being fabricated into a 5H or monthly limit; their used/limit amounts and purchased USD currency are preserved in the details.

Unavailable or unreported quota is shown as a dash, never as unlimited or zero usage. OpenRouter currently has no account-quota family in the native controller, so a configured OpenRouter provider is explicitly shown as unsupported/unknown instead of importing a balance from OMP. Ollama accounts whose native usage endpoint supplies no usable quota windows are similarly unknown. The expanded widget shows the check time, account-update time in details, stale warnings, per-window percentages, balances where supplied natively, and refresh controls. The compact sidebar rail retains its gauge button and accessible summary. The original composer HUD continues to track local DSH usage separately.

The OpenCode Go subscription is read directly from its own gateway with the host `OPENCODE_API_KEY` credential, resolved through the credentials service (with the process environment as a fallback), so no second authentication controller or browser session is involved. `GET https://opencode.ai/console/api/go/status` supplies the rolling five-hour, weekly and monthly spend meters in micro-cents; `GET https://opencode.ai/zen/go/v1/usage` is the percent-and-reset fallback for keys the console route rejects. The row reports 5H, 7D and 30D windows with their reset instants and, when the console route answered, the spent and allowed USD amounts. A rejected key and no stored key are different: the first stays visible as unknown, the second shows no row at all. A failed read keeps the preceding percentages marked stale, and the key itself is never written to the snapshot.

## Install

```sh
dsh plugin --profile web add link:/root/DSH/dsh-sub-limits
dsh --profile web --dump-config
```
