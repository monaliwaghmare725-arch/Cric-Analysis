# TriageIQ

AI-assisted urgent care intake and nurse triage queue. Patients complete a conversational check-in on a tablet; the server recommends priority and flags red flags (ESI-inspired); nurses review a priority-sorted dashboard and record disposition. **The AI never diagnoses or finalizes triage.**

**Live demo (Cloudflare Tunnel):** https://brunswick-inherited-complications-northeast.trycloudflare.com  
- Patient: https://brunswick-inherited-complications-northeast.trycloudflare.com/patient  
- Nurse: https://brunswick-inherited-complications-northeast.trycloudflare.com/nurse  

## Stack

| Layer | Tech |
|-------|------|
| Client | React + TypeScript (Vite) |
| Server | Node.js + Express |
| Database | PostgreSQL 16 |
| AI | OpenAI API (`TRIAGE_MODE=openai`) or explicit local demo rules (`TRIAGE_MODE=demo`) |

## Project layout

```
client/          Patient intake + nurse dashboard
server/          Express API, triage, Postgres
docker-compose.yml
.env.example
README.md
```

## Prerequisites

- Node.js 20+
- Docker (for Postgres) **or** a local PostgreSQL matching `DATABASE_URL`
- OpenAI API key **only** if you set `TRIAGE_MODE=openai`

## Local run

```bash
cp .env.example .env
# Default TRIAGE_MODE=demo needs no paid API key.
# For real OpenAI: set TRIAGE_MODE=openai and OPENAI_API_KEY=sk-...

docker compose up -d
npm run install:all
cp .env server/.env   # optional; server also loads repo-root .env
npm run db:migrate

# terminal A
npm run dev:server

# terminal B
npm run dev:client
```

Or after root `npm install`: `npm run dev`

| Surface | URL |
|---------|-----|
| Patient intake | http://localhost:5173/patient |
| Nurse dashboard | http://localhost:5173/nurse |
| API health | http://localhost:3001/api/health |

### Ports

| Service | Default | Notes |
|---------|---------|-------|
| Vite client | `5173` | Proxies `/api` → API |
| Express API | `3001` (`PORT`) | Use `3011` if another app already owns `3001` |
| Postgres | `5432` | From `docker-compose.yml` |

### Demo queue seed (optional)

```bash
npm run seed --prefix server
```

Seed inserts fixture queue rows. Live triage still uses `TRIAGE_MODE` (`demo` rules or `openai`).

## Environment variables

Copy `.env.example` → `.env`. **Never commit `.env` or API keys** (`.gitignore` excludes them).

| Variable | Purpose |
|----------|---------|
| `TRIAGE_MODE` | `demo` (default) = local rules engine; `openai` = real OpenAI (fails clearly if unpaid/missing) |
| `OPENAI_API_KEY` | Required only for `TRIAGE_MODE=openai` |
| `DATABASE_URL` | Postgres connection string |
| `CORS_ORIGIN` | Comma-separated allowed origins (no `*`) |
| `PORT` | API port (default `3001`) |
| `VITE_API_BASE_URL` | Leave empty for Vite `/api` proxy; or absolute API URL |

## Non-AWS public hosting (Cloudflare Tunnel)

This workshop live URL uses **Cloudflare Tunnel** (`cloudflared`), not AWS App Runner / ECR.

Why Cloudflare instead of AWS for this showcase:

- No AWS account spend, ECR push, or App Runner service setup
- Fast path: run the stack locally (or on a laptop), expose the Vite/API origin with a temporary public HTTPS URL
- Fits a student demo where the app already runs on localhost

### Typical tunnel steps (no secrets in git)

1. Run TriageIQ locally (`TRIAGE_MODE=demo`, Postgres up, client + server).
2. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).
3. Expose the **client** origin (so `/patient`, `/nurse`, and proxied `/api` work together), e.g.:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:5173
   ```

4. Cloudflare prints a `https://….trycloudflare.com` URL. Open `/patient` and `/nurse` on that host.
5. Add the tunnel origin to `CORS_ORIGIN` if the client calls the API on a different host (same-origin proxy usually avoids this).
6. Restart the tunnel → the trycloudflare hostname **changes**. Update docs/showcase when that happens.

**Not production HA** — fine for workshop / peer review. AWS was intentionally skipped per project choice.

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | DB + `triageMode` + OpenAI config status |
| `POST` | `/api/sessions` | Start patient intake |
| `POST` | `/api/sessions/:id/messages` | Conversational answer |
| `POST` | `/api/sessions/:id/triage` | Triage (demo rules or OpenAI) |
| `GET` | `/api/queue` | Nurse queue by red flags then priority |
| `PATCH` | `/api/sessions/:id/disposition` | Nurse disposition |

## Safety / design notes

- Triage is **recommend/flag only**; a licensed nurse confirms disposition.
- `TRIAGE_MODE=openai` never silently falls back to mock data.
- CORS allowlist is enforced; React error boundaries wrap patient and nurse trees.
- Secrets stay in local `.env` only.

## Smoke test

1. `/patient` — mild complaint → Submit.  
2. `/nurse` — patient appears by priority with rationale + structured summary.  
3. Repeat with chest pain / shortness of breath — expect red-flag escalation.  
4. With `TRIAGE_MODE=openai` and empty key — triage returns a clear configuration error (not a silent mock).
