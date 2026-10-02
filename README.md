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

## Customer-owned domains

```powershell
Invoke-RestMethod -Method Post "$base/domains" -Headers $k -ContentType "application/json" -Body '{"hostname":"www.joesplumbing.com"}' | ConvertTo-Json -Depth 5
# add the TXT and CNAME records it returns at the domain's DNS provider, then:
Invoke-RestMethod -Method Post "$base/domains/verify" -Headers $k
```
Until verified, the hostname serves nothing. A verified domain serves the tenant's site; HTTPS for it needs a certificate for that hostname on the load balancer (not automated yet).

## Run the production image locally

```powershell
docker compose --profile app up --build     # http://<subdomain>.lvh.me:3000, Ollama on your machine
```

## Deploy to AWS (ECS Fargate, ALB, ACM, Route 53)

Roughly $1–1.50 a day while running (load balancer, one small Fargate task, public IPv4 addresses; approximate). `npm run infra:destroy` removes everything except the domain and its hosted zone ($0.50/month).

**One-time setup**

1. **Domain.** Register one in Route 53 (this creates its hosted zone), then get the zone id:
   ```powershell
   aws route53 list-hosted-zones-by-name --dns-name yourdomain.com --query "HostedZones[0].Id" --output text   # /hostedzone/Z0123… → use Z0123…
   ```
   Put both in `infra/cdk.json` → `context.domainName` and `context.hostedZoneId`, and commit.
2. **Database.** Create a free MongoDB Atlas M0 cluster (AWS, us-east-1), a database user, and allow access from `0.0.0.0/0` (Fargate tasks have changing public IPs; production would use PrivateLink or a fixed NAT address). Store the connection string, with `/mainstreet` as the database:
   ```powershell
   aws ssm put-parameter --region us-east-1 --name /mainstreet/MONGO_URL --type SecureString --value "mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/mainstreet?retryWrites=true&w=majority"
   ```
3. **CDK bootstrap** (once per account and region), with Docker Desktop running:
   ```powershell
   cd infra; npm ci
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

**First deploy, from your laptop** (about 10 minutes; most of it is the certificate being issued)
```powershell
npx cdk deploy      # review the IAM and security-group changes it lists, then confirm
```
It prints `Url`, `TenantUrlPattern` and `GitHubDeployRoleArn`. If the account already has a GitHub OIDC provider, the deploy fails on it. Add `"githubOidcProviderArn": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"` to the context and deploy again.

**Check it**
```powershell
$prod = "https://yourdomain.com"
$t = Invoke-RestMethod -Method Post "$prod/api/tenants" -ContentType "application/json" -Body '{"name":"Joe''s Plumbing","taxRateBps":875}'
start "https://$($t.tenant.subdomain).yourdomain.com/app"; $t.apiKey
```

**Deploys on push.** In GitHub → Settings → Secrets and variables → Actions, add the secret `AWS_DEPLOY_ROLE_ARN` (the `GitHubDeployRoleArn` output) and the variable `DEPLOY` = `true`. After that, every push to `main` that passes tests, e2e, the image check and the infra tests deploys itself and smoke-tests `https://yourdomain.com/health`.

**Logs:** CloudWatch → Log groups → `Mainstreet-Logs…`, or `aws logs tail <group> --follow`.

**Tear down:** `npm run infra:destroy`.
