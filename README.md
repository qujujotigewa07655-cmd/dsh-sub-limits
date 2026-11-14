# dsh-sub-limits

Shows subscription quota usage in the sidebar footer, directly above Settings: native DSH accounts read through the running `dsh-plugin-oauth-subs` controller and, when a key is available, the OpenCode Go plan, the OpenRouter balance, the Alibaba Token Plan monthly credits and the DeepSeek key balance with the current off-peak pricing window.

## What it shows

- **Native DSH accounts.** The host reads provider-metered quotas from the running `dsh-plugin-oauth-subs` controller through its authenticated local API, without invoking OMP, reading OMP accounts, or creating a second authentication controller.
- **OpenCode Go.** The host reads the subscription directly from its own gateway with the `OPENCODE_API_KEY` credential, resolved through the credentials service with the process environment as a fallback.
- **Independent pools.** Antigravity Gemini and Claude/GPT pools stay separate, and each account is its own row. Daily windows are labeled `24H`, not `5H`.
- **OpenRouter.** The host reads the remaining money straight from OpenRouter with the `OPENROUTER_API_KEY` credential, resolved through the credentials service with the process environment as a fallback. The account balance is the headline number; a per-key spending limit is shown next to it, never instead of it.
- **Alibaba Token Plan.** The host reads the monthly credit quota through the Bailian console gateway with the `bl` CLI over a console login. The tier's monthly total is the headline limit; used and remaining credits are shown in the expanded row.
- **DeepSeek.** The host reads the remaining key balance, with the granted and topped-up parts, straight from `https://api.deepseek.com/user/balance` with the `DEEPSEEK_API_KEY` credential, and labels the current pricing window as `peak` or `off-peak`.
- **Known gaps stay visible.** Unavailable or unreported quota is shown as a dash, never as unlimited or zero usage. Ollama accounts whose native usage endpoint supplies no usable quota windows are unknown.

## HTTP endpoint

`GET /api/sub-limits/providers` serves the normalized snapshot; `?refresh=1` forces a native refresh for every supported account. `GET` and `HEAD` only (`405` otherwise).

The route is registered on `ctx.webServer` and gated by `ctx.connection.requestRejection(req)`; a missing `connection` service fails closed with `503`. A failed native read answers `200` with `ok: false` and `code: "NATIVE_UNAVAILABLE"`, keeping the previous snapshot marked stale, so the browser keeps its previous data. `502` with a null timestamp and an empty report list is returned only on an unexpected handler error.

Sanitized snapshots, without credentials or raw provider errors, are atomically stored in `$DSH_HOME/sub-limits-provider-usage.json` with private file permissions.

## Refresh, stale data and last-good values

The browser polls once a minute and concurrent reads share a request. Automatic polling refreshes supported native account quotas once their successful reading is at least a minute old, or when it is missing or not ready. `?refresh=1` refreshes every supported account regardless of age. The loopback destination is pinned to the actual server port, forwards only the current authenticated request's cookie, and refuses redirects.

Account failures retain the last good values and their successful-update time, marked stale; a bridge failure retains the whole previous snapshot. A successful account enumeration removes logged-out accounts. Quotas older than five minutes are also marked stale. A reset timestamp in the past marks that window stale — the adapter never invents a new zero-usage window. Native USD allowances with no declared duration remain period-unknown rather than being fabricated into a 5H or monthly limit; their used/limit amounts and purchased USD currency are preserved in the details.

## UI

The browser half registers into `sidebar.footer.action`. The compact rail shows the highest consumed percentage for the selected period and expands into account rows with per-window percentages, reset countdowns, balances where supplied natively, stale warnings, check times, and refresh controls. It defaults to `5H` and remembers the selected `5H`, `7D`, `30D`, or `All` filter in the browser. `All` selects the highest consumed percentage across reported periods; stale readings remain available in details but do not outrank current readings in the summary. A missing 5H reading stays unknown rather than silently substituting a weekly percentage. Percentages accept only finite numbers or nonblank numeric strings. Colours come from the host tokens, and percentages are announced through a polite live region.

OpenCode Go supplies rolling five-hour, weekly and monthly spend meters in micro-cents from `GET https://opencode.ai/console/api/go/status`, with `GET https://opencode.ai/zen/go/v1/usage` as the percent-and-reset fallback for keys the console route rejects. A rejected key and no stored key are different: the first stays visible as unknown, the second shows no row at all. A failed read keeps the preceding percentages marked stale, and the key itself is never written to the snapshot.

OpenRouter supplies two dollar balances from `GET https://openrouter.ai/api/v1/credits` and `GET https://openrouter.ai/api/v1/key`. The account balance is `total_credits - total_usage`, the money actually left on the account; the key balance is `limit_remaining` against the key's own `limit`, a narrower cap that only some keys carry. Both are listed in the expanded row with their used/limit amounts, the account balance first. Either route may fail on its own and the other still reports; a key without a limit reports the account balance alone. OpenRouter is read only when the provider is configured, and the same absent/unknown/stale rules as OpenCode Go apply.

Alibaba Token Plan supplies a monthly credit quota through the Bailian console gateway, read with the `bl` CLI over an authenticated console session: `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage`, `…/subscription` and `…/quota-config` on the `ap-southeast-1` international site. The reported `per1MonthPercentage` is a fraction of the month rather than a percent, so it is multiplied by 100; the tier's `monthly` total from `quota-config`, matched by the subscription `specCode`, turns it into used and remaining credits against the `30D` window with its reset countdown. The model API key alone cannot read this quota — the inference gateway answers `404` and the console host redirects — so a console login is required, and an expired session keeps the last reading marked stale. A missing CLI leaves the row absent, and the provider is read only when it is configured.

DeepSeek supplies the key balance from `GET https://api.deepseek.com/user/balance`. `total_balance` is the headline number; `granted_balance` and `topped_up_balance` are listed beside it when reported. Peak hours are `01:00–04:00` and `06:00–10:00` UTC, Monday through Friday; every other hour, weekends included, is off-peak at half the peak price. The row carries a `peak` or `off-peak` chip with a countdown to the next change. Chinese public holidays are off-peak in full but are not in the panel's calendar, so on a holiday the chip can say `peak` while the provider bills off-peak. DeepSeek is read only when the provider is configured, and the same absent/unknown/stale rules as OpenCode Go apply.

## Install

```sh
dsh plugin --profile web add link:/root/DSH/dsh-sub-limits
dsh --profile web --dump-config
```

Native account quotas require `dsh-plugin-oauth-subs` in the same profile; without a stored `OPENCODE_API_KEY`, the OpenCode Go row is simply absent, and without a stored `OPENROUTER_API_KEY`, the OpenRouter row is simply absent; without a stored `DEEPSEEK_API_KEY`, the DeepSeek row is simply absent. The Alibaba Token Plan row additionally needs `bailian-cli` (`npm install -g bailian-cli`) and a console login performed in a browser on the host (`bl auth login --console --no-browser --console-site international`); the model API key alone cannot read the plan quota.
