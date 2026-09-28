# TriageIQ

AI-assisted urgent care intake and nurse triage queue. Patients complete a conversational check-in on a tablet; the server calls OpenAI with an ESI-inspired rubric to recommend priority and flag red flags; nurses review a priority-sorted dashboard and record disposition. **The AI never diagnoses or finalizes triage.**

## Stack

| Layer | Tech |
|-------|------|
| Client | React + TypeScript (Vite) |
| Server | Node.js + Express |
| Database | PostgreSQL 16 |
| AI | OpenAI API (server-side only) |

## Project layout

```
triageiq/
  client/          Patient intake + nurse dashboard
  server/          Express API, OpenAI triage, Postgres
  docker-compose.yml
  .env.example
  README.md
```

## Prerequisites

- Node.js 20+
- Docker (for Postgres) **or** a local PostgreSQL matching `DATABASE_URL`
- An OpenAI API key

## Setup

```bash
cd triageiq
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Install dependencies & migrate

```bash
npm run install:all
# also: npm install   # root concurrently helper (optional)
cp .env server/.env   # server loads triageiq/server/.env or triageiq/.env
npm run db:migrate
```

### 3. Run API + UI

```bash
# terminal A
npm run dev:server

# terminal B
npm run dev:client
```

Or from root after `npm install`:

```bash
npm run dev
```

- Patient intake: http://localhost:5173/patient  
- Nurse dashboard: http://localhost:5173/nurse  
- API health: http://localhost:3001/api/health  


### Demo queue seed (optional)

If you want nurse-dashboard sample records without calling OpenAI:

```bash
npm run seed --prefix server
```

This inserts fixture queue rows only. It does **not** mock `/api/sessions/:id/triage` — that path still requires `OPENAI_API_KEY` and fails with `503 OPENAI_NOT_CONFIGURED` when unset.

### PostgreSQL without Docker

If Docker is unavailable, run Postgres 16 locally with user/db/password `triageiq` (same as `docker-compose.yml`) and point `DATABASE_URL` at it.

## Environment variables

See `.env.example`. Important:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | **Required** for `/api/sessions/:id/triage`. If unset, the endpoint returns **503** with code `OPENAI_NOT_CONFIGURED`. There is **no mock LLM fallback**. |
| `DATABASE_URL` | Postgres connection string (defaults match `docker-compose.yml`) |
| `CORS_ORIGIN` | Comma-separated allowed origins (locked down; no `*`) |
| `VITE_API_BASE_URL` | Client → API base URL |

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | DB + OpenAI config status |
| `POST` | `/api/sessions` | Start patient intake |
| `POST` | `/api/sessions/:id/messages` | Conversational answer |
| `POST` | `/api/sessions/:id/triage` | Real OpenAI triage (persists score, rationale, red flags, structured intake) |
| `GET` | `/api/queue` | Nurse queue sorted by red flags then priority (not arrival) |
| `PATCH` | `/api/sessions/:id/disposition` | Nurse disposition |

## Data model

`patient_sessions` → `intake_messages` / `structured_intakes` → `triage_assessments` (score, rationale, red flags) → `nurse_dispositions`

## Safety / design notes

- OpenAI is called **only** from the server with a system prompt that flags/recommends and forbids diagnosis.
- CORS allowlist is enforced from the first commit.
- React error boundaries wrap patient and nurse trees.
- Patient UI is tablet/mobile responsive.

## Smoke test

1. Open `/patient`, complete intake with a mild complaint → Submit.
2. Open `/nurse` — patient appears sorted by priority with rationale + structured summary.
3. Repeat with chest pain / shortness of breath — expect red-flag escalation banner on the nurse queue.
4. With `OPENAI_API_KEY` empty, submit triage and confirm a visible configuration error (not a silent mock).
