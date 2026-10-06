# Vendor Street

A multi-tenant platform for micro-businesses: a website per business, lead capture over web and SMS, estimates, invoices and receipts, and a funding application with an explainable risk assessment.

Stack: Node 22, Express 5, TypeScript, zod, MongoDB, React (step 9), AWS (step 10).

## Run it

```powershell
npm install
docker compose up -d                      # MongoDB on localhost:27017
$env:MONGO_URL = "mongodb://localhost:27017/vendorstreet"
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
$pl = '[{"sku":"WH-FLUSH","name":"Water heater flush","unitPriceCents":12900},{"sku":"WH-ANODE","name":"Anode rod replacement","unitPriceCents":18500},{"sku":"TPR-VALVE","name":"Pressure relief valve","unitPriceCents":4500},{"sku":"LABOR","name":"Labor","unitPriceCents":9500,"unit":"hour","fractional":true},{"sku":"TRIP","name":"Service call","unitPriceCents":7900}]'
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

## Deploy to AWS

Two profiles, same app:

| | **economy** (default) | **full** (`-c profile=full`) |
|---|---|---|
| Path | CloudFront → one EC2 instance (Docker image from ECR) | ALB → ECS Fargate |
| TLS | CloudFront, `*.domain` cert | ALB, `*.domain` cert |
| Deploys | GitHub Actions: build → ECR → SSM runs `/opt/vendorstreet/run.sh <sha>` | GitHub Actions: `cdk deploy`, rolling with automatic rollback |
| Cost | about $12/month (t3.micro ~$7.60, Elastic IP ~$3.65, Route 53 $0.50; CloudFront and SES stay in the free tier at demo traffic) | about $35–45/month (ALB alone ~$16 + LCUs) |
| Trade-off | a deploy restarts the container (a few seconds down); CloudFront → instance is HTTP, limited to CloudFront's address ranges plus a secret header | no single machine; more to pay for |

Both use Route 53, ACM, SES (DKIM set up automatically), SSM Parameter Store for secrets, CloudWatch Logs and MongoDB Atlas. Prices are approximate, us-east-1.

### One-time setup (economy)

Everything below is PowerShell, from the repo root, with the AWS CLI signed in to the **new** account (`aws configure`, region `us-east-1`).

1. **Domain.** Route 53 → Registered domains → Register (about $14/year for a `.com`). The hosted zone is created for you. Get its id:
   ```powershell
   aws route53 list-hosted-zones-by-name --dns-name yourdomain.com --query "HostedZones[0].Id" --output text   # /hostedzone/Z0123… → use Z0123…
   ```
   Put both in `infra/cdk.json` → `context.domainName` and `context.hostedZoneId`, and commit.
2. **Database.** MongoDB Atlas → free **M0** cluster on AWS us-east-1 → a database user → Network Access: `0.0.0.0/0` (the instance has a fixed Elastic IP after the first deploy; you can narrow it to that IP then).
3. **Anthropic.** console.anthropic.com → create an API key → Billing → set a **monthly spend limit** (e.g. $10). The app also caps itself at 300 AI calls a day (25 per business).
4. **Settings in SSM** (SecureString for secrets; plain String for the origin header CloudFront must read). Don't put quotes inside the values.
   ```powershell
   $p = "/vendorstreet"
   aws ssm put-parameter --name $p/MONGO_URL --type SecureString --value "mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/vendorstreet?retryWrites=true&w=majority"
   aws ssm put-parameter --name $p/ANTHROPIC_API_KEY --type SecureString --value "sk-ant-..."
   aws ssm put-parameter --name $p/ADMIN_TOKEN --type SecureString --value ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
   aws ssm put-parameter --name $p/UNDERWRITERS --type SecureString --value ("Prateek Ghosh=uw_" + [guid]::NewGuid().ToString("N"))
   aws ssm put-parameter --name $p/ORIGIN_SECRET --type String --value ([guid]::NewGuid().ToString("N"))
   # optional: aws ssm put-parameter --name $p/TWILIO_AUTH_TOKEN --type SecureString --value "..."
   ```
   Read one back with `aws ssm get-parameter --name /vendorstreet/ADMIN_TOKEN --with-decryption --query Parameter.Value --output text`.
5. **CDK bootstrap**, once per account and region:
   ```powershell
   cd infra; npm ci
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

### First deploy (about 10–15 minutes: the certificate and CloudFront take most of it)
```powershell
npx cdk deploy      # profile=economy; review the IAM and security-group changes, then confirm
```
It prints `Url`, `InstanceId`, `RepositoryUri`, `GitHubDeployRoleArn`, `TailLogs` and `Shell`. The instance is up but empty: there's no image yet.

### Deploys on push
GitHub → Settings → Secrets and variables → Actions:
- secret `AWS_DEPLOY_ROLE_ARN` = the `GitHubDeployRoleArn` output
- variable `DEPLOY` = `economy`
- variable `INSTANCE_ID` = the `InstanceId` output

Push to `main`. After tests, e2e, the image check and the infra tests pass, `deploy-economy` builds the image, pushes it to ECR tagged with the commit, runs `/opt/vendorstreet/run.sh <sha>` on the instance through SSM, and smoke-tests `https://yourdomain.com/health`, `/api/platform`, and that `http://origin.yourdomain.com` refuses direct visitors.

### Check it
Open `https://yourdomain.com` → **Try it**. To create a real business (sign-up is closed to visitors):
```powershell
$admin = aws ssm get-parameter --name /vendorstreet/ADMIN_TOKEN --with-decryption --query Parameter.Value --output text
Invoke-RestMethod -Method Post https://yourdomain.com/api/tenants -Headers @{ Authorization = "Bearer $admin" } -ContentType application/json -Body '{"name":"Joe''s Plumbing","taxRateBps":875}'
```

### Run, look, fix
- Logs: `aws logs tail /vendorstreet/web --follow`
- Shell on the machine (no SSH, no open port 22): `aws ssm start-session --target <InstanceId>` (needs the Session Manager plugin), then `sudo docker ps`, `sudo /opt/vendorstreet/run.sh` to restart, `sudo /opt/vendorstreet/run.sh <older-sha>` to roll back.
- Changed a setting in SSM? Restart with `run.sh` so the container reads it again.
- **Email:** new SES accounts are in the *sandbox*: mail only reaches verified addresses. Demo businesses never send mail anyway. For real mail, SES → Account dashboard → Request production access.

### Tear down
`npx cdk destroy` (in `infra`) removes everything except the domain, its hosted zone and the SSM parameters.

### Full profile instead
`npx cdk deploy -c profile=full -c llmProvider=anthropic -c underwriters=true`, and set the GitHub variable `DEPLOY` = `full`. CI then runs `cdk deploy` itself on every push.

## Step 11: review round

**Who it's for.** Estimates carry the customer (from the lead, or typed in), and invoices freeze it as **Bill to** on the PDF, the email and the receipt. Repeat requests from the same email or phone link to one customer.

**Emails at each stage.** Quote request (customer + owner), estimate sent, invoice issued (PDF attached), payment receipt, and funding decisions (owner). Locally they go to **Mailpit**, a fake inbox at http://localhost:8025 (`docker compose up -d` starts it). In AWS they go through **SES** using the task's IAM role. Every attempt is logged (`GET /api/messages`, and Insights → Emails); a failing mail server never breaks the action.

```powershell
# owner's notification address (or set it in Insights)
Invoke-RestMethod -Method Patch "$base/settings" -Headers $k -ContentType "application/json" -Body '{"ownerEmail":"you@example.com"}'
```

**Funding decisions say who decided.** Clear cases are decided by the scorecard; "review" cases wait for a named underwriter in the console:

- http://localhost:3000/underwriting, demo key `uw_dev_priya_0001` (Priya Shah). Set `UNDERWRITERS="Name=key;Name2=key2"` for your own.
- Queue across every business, oldest first. Full risk breakdown, AI memo (fact-checked), invoices paid through Vendor Street vs bank revenue, and a decision form that previews the daily payment, total repayment load and APR.
- Approve with an amount, or decline. A note is required, and the business sees it. Every decision is kept in a log.

**Plain words for the applicant.** The owner sees the decision first: amount, total repayment, daily payment, months, **estimated APR**, and for every reason, what would help. Written by code from the same numbers as the decision. The scoring sits under "How we decided"; the memo stays internal.

**After payment.** Insights shows lead → estimate → accepted → paid conversion, revenue by month, average job, days to get paid, unpaid invoices and returning customers.

## Step 12: public demo ("Try it")

Strangers can't be expected to bring their own data, and shouldn't hand bank statements to a demo. So the homepage at `yourdomain.com` gives each visitor their **own throwaway business**:

- **One click** (`POST /api/demo`) creates *Maple Street Plumbing* at `demo-xxxxxx.yourdomain.com` with six months of history: leads (some repeat customers, two fresh ones to try AI drafting on), estimates in every state, paid and unpaid invoices, and three funding applications scored by the real risk engine from synthetic statements (one approved, one declined, one waiting for a person). The owner key travels in the URL fragment (`/app#key=…`), which browsers never send to servers; the dashboard stores it for the tab and removes it from the address bar.
- **Emails are never sent** for demo businesses. Each one is kept with its HTML, and Insights → Emails → **View** shows it in a sandboxed frame.
- **The other side:** a public demo underwriter key (on the homepage) opens the console, but sees and decides **demo businesses only**. The visitor's own case is marked *Yours*.
- **Expiry:** demos stop working after 3 days and are deleted (with everything they own) by a cleanup that runs every 6 hours.

Guard rails for a public site, all on by default in production (`NODE_ENV=production`):
- **Sign-up closed** (`OPEN_SIGNUP=false`): creating a real business needs `ADMIN_TOKEN`. Otherwise anyone could claim `yourbank.yourdomain.com`.
- **AI budget:** every model call is counted in the database: 25 per business and 300 overall per UTC day (`AI_DAILY_LIMIT_PER_BUSINESS`, `AI_DAILY_LIMIT`); over that the API answers 429 without calling the model. The cloud uses Claude Haiku (`ANTHROPIC_MODEL=claude-haiku-4-5-20251001`).
- **Rate limits per visitor:** 5 demos an hour, 30 website requests an hour (`DEMOS_PER_HOUR`, `LEADS_PER_HOUR`). The visitor is `req.ip`, which is only trustworthy because `trust proxy` is the *number* of proxies in front (`TRUST_PROXY_HOPS=1` for CloudFront), never `true`: with `true`, anyone can type their own `X-Forwarded-For`.
- **No way around CloudFront:** the instance accepts port 80 only from CloudFront's address ranges, and the app refuses requests without CloudFront's secret `X-Origin-Verify` header (`ORIGIN_SECRET`).

Locally, everything works the same with sign-up open: `npm run dev`, open `http://localhost:3000`, press **Try it** (demo underwriter key `uw_demo_public_0001`). `RATE_LIMITS=on` turns the limits on locally.

## Accounts: sign in by email

Real businesses are created by people with verified emails; demos stay one click away.

- **Sign in** (`/signin`): enter an email and get a one-time link, valid for 15 minutes. There's no password and no separate sign-up: the first link creates the account. The response is the same for every address, so it can't be used to find out who has an account. Links per address (5 an hour) and per visitor (10 an hour) are limited.
- **The link** (`/auth/verify#token=…`): the token sits after `#`, so browsers never send it to a server or into logs. The page posts it once. Only a SHA-256 of each token and session id is stored, and expired ones are deleted automatically (MongoDB TTL indexes).
- **The session:** a 30-day `HttpOnly; Secure; SameSite=Lax` cookie on `.vendorstreet.dev`, so one sign-in covers the platform and every business subdomain. Because subdomains count as the same site, every cookie-authenticated change must also carry an `Origin` that matches its own address. A page on another business's subdomain can't act with your cookie.
- **Your businesses** (`/account`): create up to 3, each with a reserved-name check (platform words, banks and big brands) so nobody can open `chase.vendorstreet.dev`. Notifications go to your email by default.
- **API keys still work** for integrations and demos, and a wrong key is refused even if you're signed in.

Locally, sign-in emails land in Mailpit (http://localhost:8025). With `MAIL_TRANSPORT=none`, the link is printed in the server window instead (never in production). Open the app at `http://lvh.me:3000`, not `localhost`, so the cookie covers the business subdomains.

**On the live site, SES starts in sandbox mode:** it only delivers to addresses you've verified in SES. Request production access (SES → Account dashboard) before inviting anyone else to sign in.
