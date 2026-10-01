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
