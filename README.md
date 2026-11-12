# dsh-sub-limits

Shows subscription quota usage in the sidebar footer, directly above Settings: native DSH accounts read through the running `dsh-plugin-oauth-subs` controller and, when a key is available, the OpenCode Go plan.

## What it shows

- **Native DSH accounts.** The host reads provider-metered quotas from the running `dsh-plugin-oauth-subs` controller through its authenticated local API, without invoking OMP, reading OMP accounts, or creating a second authentication controller.
- **OpenCode Go.** The host reads the subscription directly from its own gateway with the `OPENCODE_API_KEY` credential, resolved through the credentials service with the process environment as a fallback.
- **Independent pools.** Antigravity Gemini and Claude/GPT pools stay separate, and each account is its own row. Daily windows are labeled `24H`, not `5H`.
- **Known gaps stay visible.** Unavailable or unreported quota is shown as a dash, never as unlimited or zero usage. OpenRouter has no account-quota family in the native controller, so a configured OpenRouter provider is explicitly shown as unsupported/unknown instead of importing a balance from OMP. Ollama accounts whose native usage endpoint supplies no usable quota windows are similarly unknown.

## HTTP endpoint

`GET /api/sub-limits/providers` serves the normalized snapshot; `?refresh=1` forces a native refresh for every supported account. `GET` and `HEAD` only (`405` otherwise).

The route is registered on `ctx.webServer` and gated by `ctx.connection.requestRejection(req)`; a missing `connection` service fails closed with `503`. A native read that cannot produce a snapshot answers `502` with `code: "NATIVE_UNAVAILABLE"`, a null timestamp, and an empty report list, so the browser keeps its previous data.

Sanitized snapshots, without credentials or raw provider errors, are atomically stored in `$DSH_HOME/sub-limits-provider-usage.json` with private file permissions.

## Refresh, stale data and last-good values

The browser polls once a minute and concurrent reads share a request. Automatic polling refreshes supported native account quotas once their successful reading is at least a minute old, or when it is missing or not ready. `?refresh=1` refreshes every supported account regardless of age. The loopback destination is pinned to the actual server port, forwards only the current authenticated request's cookie, and refuses redirects.

Account failures retain the last good values and their successful-update time, marked stale; a bridge failure retains the whole previous snapshot. A successful account enumeration removes logged-out accounts. Quotas older than five minutes are also marked stale. A reset timestamp in the past marks that window stale — the adapter never invents a new zero-usage window. Native USD allowances with no declared duration remain period-unknown rather than being fabricated into a 5H or monthly limit; their used/limit amounts and purchased USD currency are preserved in the details.

## UI

The browser half registers into `sidebar.footer.action`. The compact rail shows the highest consumed percentage for the selected period and expands into account rows with per-window percentages, reset countdowns, balances where supplied natively, stale warnings, check times, and refresh controls. It defaults to `5H` and remembers the selected `5H`, `7D`, or `All` filter in the browser. `All` selects the highest consumed percentage across reported periods; stale readings remain available in details but do not outrank current readings in the summary. A missing 5H reading stays unknown rather than silently substituting a weekly percentage. Percentages accept only finite numbers or nonblank numeric strings. Colours come from the host tokens, and percentages are announced through a polite live region.

OpenCode Go supplies rolling five-hour, weekly and monthly spend meters in micro-cents from `GET https://opencode.ai/console/api/go/status`, with `GET https://opencode.ai/zen/go/v1/usage` as the percent-and-reset fallback for keys the console route rejects. A rejected key and no stored key are different: the first stays visible as unknown, the second shows no row at all. A failed read keeps the preceding percentages marked stale, and the key itself is never written to the snapshot.

## Install

```sh
dsh plugin --profile web add link:/root/DSH/dsh-sub-limits
dsh --profile web --dump-config
```

Native account quotas require `dsh-plugin-oauth-subs` in the same profile; without a stored `OPENCODE_API_KEY`, the OpenCode Go row is simply absent.
