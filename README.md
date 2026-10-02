# Mainstreet

A multi-tenant platform for micro-businesses: a website per business, lead capture over web and SMS, estimates, invoices and receipts, and a funding application with an explainable risk assessment.

Stack: Node 22, Express 5, TypeScript, zod, MongoDB, React (step 9), AWS (step 10).

## Run it

```powershell
npm install
docker compose up -d                      # MongoDB on localhost:27017
$env:MONGO_URL = "mongodb://localhost:27017/mainstreet"
npm test                                  # all tests, including the MongoDB contract suite
npm run dev                               # API on http://localhost:3000
```

Without `MONGO_URL`, the MongoDB tests are skipped and `npm run dev` uses an in-memory store.

Tenant sites resolve from the Host header. `*.lvh.me` points at 127.0.0.1, so after creating a tenant with subdomain `joes-plumbing`, its site is `http://joes-plumbing.lvh.me:3000`.

```powershell
# create a tenant (save the apiKey; it is shown once)
curl.exe -s -X POST localhost:3000/api/tenants -H "content-type: application/json" -d '{\"name\":\"Joe''s Plumbing\",\"taxRateBps\":875}'

# a customer submits a lead on the tenant's site
curl.exe -s -X POST joes-plumbing.lvh.me:3000/api/leads -H "content-type: application/json" -d '{\"name\":\"Ann\",\"phone\":\"716-555-0123\",\"message\":\"Leaky water heater\"}'

# the owner lists leads
curl.exe -s joes-plumbing.lvh.me:3000/api/leads -H "authorization: Bearer <apiKey>"
```

## Layout

| Path | What |
| --- | --- |
| `src/domain.ts` | Domain types. Money is integer cents; tax is basis points |
| `src/lib` | Pure logic: subdomains, money math, API keys |
| `src/schemas.ts` | zod validation at every boundary |
| `src/repos` | Storage contract with in-memory and MongoDB implementations |
| `src/middleware/tenant.ts` | Host header to tenant; owner API key check |
| `src/routes` | HTTP routes |
| `src/webhooks` | Twilio signature verification and TwiML |
| `src/services`, `src/workflow` | Estimate, invoice and receipt workflow |
| `tests` | Vitest suites; `tests/repos/contract.ts` runs against every storage backend |

## Simulate an inbound SMS

Sends the server exactly what Twilio would, signed with your token, so the full webhook path runs without a phone.

```powershell
$env:TWILIO_AUTH_TOKEN = "dev-token"   # same value in the server's window
npm run sms:simulate -- <tenantId> "Need a quote for a leaky water heater" 716-555-0123
```

## Estimate → invoice → receipt

```powershell
$k = @{ Authorization = "Bearer $($t.apiKey)" }; $base = "http://$($t.tenant.subdomain).lvh.me:3000/api"
$items = '{"lineItems":[{"description":"Water heater flush","quantity":1,"unitPriceCents":12900},{"description":"Labor","quantity":2,"unitPriceCents":9500}]}'
$e = (Invoke-RestMethod -Method Post "$base/estimates" -Headers $k -ContentType "application/json" -Body $items).estimate
"sent","accepted" | % { Invoke-RestMethod -Method Post "$base/estimates/$($e.id)/transition" -Headers $k -ContentType "application/json" -Body "{`"to`":`"$_`"}" | Out-Null }
$inv = (Invoke-RestMethod -Method Post "$base/estimates/$($e.id)/invoice" -Headers $k).invoice
Invoke-WebRequest "$base/invoices/$($inv.id)/pdf" -Headers $k -OutFile invoice.pdf; start invoice.pdf
(Invoke-RestMethod -Method Post "$base/invoices/$($inv.id)/pay" -Headers $k).receipt
```

## Funding application + bank statement

`npm run fixtures` writes six synthetic businesses to `fixtures/statements/` (a statement CSV and an application body for each).

```powershell
$k = @{ Authorization = "Bearer $($t.apiKey)" }; $base = "http://$($t.tenant.subdomain).lvh.me:3000/api"
$a = (Invoke-RestMethod -Method Post "$base/applications" -Headers $k -ContentType "application/json" -Body (Get-Content -Raw fixtures\statements\stacked-auto.application.json)).application
Invoke-RestMethod -Method Post "$base/applications/$($a.id)/statements" -Headers $k -ContentType "text/csv" -Body (Get-Content -Raw fixtures\statements\stacked-auto.csv)
(Invoke-RestMethod "$base/applications/$($a.id)/transactions" -Headers $k).totals | ConvertTo-Json
```

## Risk assessment

```powershell
$r = (Invoke-RestMethod -Method Post "$base/applications/$($a.id)/assess" -Headers $k).application.assessment
$r | Select-Object decision, band, score, bandNote
$r.offer
$r.reasons | % { "- $($_.text) [$($_.metricIds -join ',')]" }
$r.metrics | Format-Table id, label, display
```

Scorecard weights, curves, knockouts and offer terms live in `src/risk/config.ts`; every assessment records the scorecard version that produced it.

| Fixture | Decision | Band | Why |
| --- | --- | --- | --- |
| steady-bakery | approve | A | Steady growth, cushion, no debt |
| seasonal-landscaper | approve | B | Score qualifies for A; capped at B by revenue volatility |
| stacked-auto | review | B | Two lenders already take more than 15% of daily revenue |
| struggling-salon | decline | D | NSF fees, negative balances, revenue down 23% |
| new-food-truck | decline | B | Under 6 months in business |
| inflated-contractor | review | A | States 2.8× the revenue the bank shows |

## AI layer (Ollama by default)

The model proposes; code verifies. Memo claims must cite metric ids and use the cited numbers; drafted estimates use only price-list SKUs at list prices and wait for human review.

```powershell
# server window: llama3.1:8b via Ollama is the default (LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY for Claude)
npm run dev                                  # prints "language model: ollama/llama3.1:8b"

# underwriting memo for an assessed application
$m = (Invoke-RestMethod -Method Post "$base/applications/$($a.id)/memo" -Headers $k).memo
$m.summary.text; $m.risks | % { "- $($_.text) [$($_.cites -join ',')]" }
$m | Select-Object engineDecision, modelRecommendation, disagreement
$m.dropped | Format-Table why, text -Wrap

# estimate drafted from a lead
$pl = '[{"sku":"WH-FLUSH","name":"Water heater flush","unitPriceCents":12900},{"sku":"WH-ANODE","name":"Anode rod replacement","unitPriceCents":18500},{"sku":"TPR-VALVE","name":"Pressure relief valve","unitPriceCents":4500},{"sku":"LABOR","name":"Labor","unitPriceCents":9500,"unit":"hour"},{"sku":"TRIP","name":"Service call","unitPriceCents":7900}]'
Invoke-RestMethod -Method Put "$base/price-list" -Headers $k -ContentType "application/json" -Body $pl | Out-Null
$lead = (Invoke-RestMethod -Method Post "$base/leads" -ContentType "application/json" -Body '{"name":"Ann","phone":"716-555-0123","message":"Water heater is 8 years old, makes popping noises and the relief valve drips. Can you flush it and fix the leak?"}').lead
$d = (Invoke-RestMethod -Method Post "$base/leads/$($lead.id)/draft-estimate" -Headers $k).estimate
$d.lineItems | Format-Table sku, description, quantity, unitPriceCents; $d.totals; $d.notes; $d.aiDraft.rejected
```

## Dashboard (React)

```powershell
npm run web:build          # builds into dist/web; the API server then serves it
npm run dev
```
- `http://<subdomain>.lvh.me:3000/` is the business's public website, with a quote request form that creates a lead.
- `http://<subdomain>.lvh.me:3000/app` is the owner dashboard (sign in with the tenant's API key): leads, AI-drafted estimates through invoice and payment, and funding applications with the risk breakdown and memo.

For live editing, run `npm run web:dev` alongside `npm run dev` and open `http://<subdomain>.lvh.me:5173/app`.

### Browser tests (Playwright)

```powershell
npx playwright install chromium   # once
npm run e2e                       # builds the app, starts a seeded server with a scripted model, runs e2e/

# download blocked or timing out? use the Chrome (or Edge) you already have:
$env:PW_CHANNEL = "chrome"; npm run e2e
```
