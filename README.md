# FlowLead AI — CSV Lead Importer

A production-grade tool that takes a CSV file of any shape or column structure and converts it into clean, deduplicated leads inside the GrowEasy CRM. An AI model reads the raw column headers and cell values, figures out what each column actually means, and maps everything to the CRM's target schema — no manual field mapping required.

Built as a full-stack TypeScript application with Next.js on the frontend, Express on the backend, Prisma + PostgreSQL for persistence, and Google Gemini as the primary AI mapping engine.

---

## Table of Contents

- [Demo](#demo)
- [How it works](#how-it-works)
- [Architecture](#architecture)
  - [Cold Start Handling](#cold-start-handling)
  - [Upload + Confirm Flow](#upload--confirm-flow)
  - [Queue and Worker](#queue-and-worker)
  - [AI Mapping and Fallback Chain](#ai-mapping-and-fallback-chain)
  - [Intelligent Upsert](#intelligent-upsert)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Local Setup](#local-setup)
- [Deployment](#deployment)
- [Sample Data](#sample-data)
- [Edge Cases Handled](#edge-cases-handled)

---

## Demo

| Service | URL |
|---|---|
| Frontend | https://flow-lead-ai.vercel.app/ |
| Backend API | https://ai-based-csv-lead-importer-backend.onrender.com/api/health |

The backend runs on Render's free tier and spins down after 15 minutes of inactivity. The application handles this gracefully — see the cold start section below.

---

## How it works

You drop a CSV file into the upload area. The backend parses it immediately, returns a row count and a preview of the first 10 records. You review that preview, optionally remove individual rows you do not want, then click Import. That triggers the backend to send the confirmed rows through an AI pipeline in batches of 50. The AI maps each batch to the CRM schema, and the results are saved to the database in real time. Progress streams back to the browser over a Server-Sent Events connection so you see a live percentage counter.

If a lead already exists in the database (matched by email or mobile number), it gets updated rather than duplicated. Existing fields are preserved when the incoming row has no value for them. New records are created for everything else.

---

## Architecture

```mermaid
graph TB
    subgraph Browser["Browser"]
        FE["Next.js Frontend\n(React 19 + Tailwind v4)"]
        WAKE["Server Wake-Up Modal\n(Cold Start Handler)"]
    end

    subgraph Server["Backend - Express + TypeScript"]
        HEALTH["GET /api/health\n(DB connectivity check)"]
        API["API Layer\n(Rate Limited)"]
        CTRL["Import Controller"]
        CSV["CSV Service\n(Parse + Sanitize + Normalize)"]
        AI["AI Service\n(Gemini 2.5 Flash)"]
        OR["OpenRouter Fallback\nLlama 3 / Gemma 2 / auto"]
        QUEUE["Queue Service\n(Redis Pub/Sub or In-Memory)"]
        WORKER["Worker\n(Batch Processor)"]
        LEAD["Lead Service\n(Intelligent Upsert)"]
        SSE["SSE Progress Stream"]
    end

    subgraph Data["Data Layer"]
        PG["Neon PostgreSQL\n(Prisma ORM)"]
        REDIS["Redis\n(Pub/Sub, optional)"]
    end

    FE -->|"GET /api/health (2.5s timeout)"| HEALTH
    HEALTH -->|"DB ping via Prisma"| PG
    HEALTH -->|"ok / sleeping"| WAKE
    WAKE -->|"Polls every 3s until ok"| HEALTH
    WAKE -->|"User clicks Let's Start"| FE

    FE -->|"POST /api/imports/upload"| API
    FE -->|"POST /api/imports/:id/confirm"| API
    FE -->|"GET /api/imports/:id/progress (SSE)"| SSE
    FE -->|"GET /api/imports/history"| API
    FE -->|"DELETE /api/leads/:id"| API
    FE -->|"GET /api/leads"| API

    API --> CTRL
    CTRL --> CSV
    CTRL -->|"Publish confirmed rows"| QUEUE
    QUEUE -->|"Subscribe"| WORKER
    WORKER --> AI
    AI -->|"Primary"| GeminiAPI["Google Gemini API"]
    AI -->|"Fallback"| OR
    WORKER --> LEAD
    LEAD --> PG
    WORKER -->|"Publish progress events"| QUEUE
    QUEUE -->|"Subscribe"| SSE
    SSE --> FE

    CTRL --> PG
    LEAD --> PG
```

### Cold Start Handling

When the Render free-tier backend is asleep, the first request can take 50–120 seconds. The frontend detects this before loading anything else. On page load, it pings `/api/health` with a 2.5-second timeout. If the server responds within that window, the dashboard loads immediately. If not, a full-screen modal appears with a live progress bar and pings `/api/health` every 3 seconds. Once the health check returns 200, the modal switches to a success state and the user clicks "Let's Start" to load the dashboard.

### Upload + Confirm Flow

The upload step and the processing step are deliberately separated. When you upload a file, the backend parses it, saves a PENDING record to the database, holds the valid rows in memory, and sends back a preview. Nothing touches the AI yet. Only after you confirm does the backend publish the rows to the queue.

### Queue and Worker

In local development, the queue falls back to Node.js `EventEmitter` when no Redis URL is provided. When `REDIS_URL` is set, the queue uses Redis Pub/Sub. The worker subscribes to the `csv_imports` channel and processes each import run in configurable batches (default 50 rows per batch). Progress events are published to a per-run channel (`import_progress:<runId>`) and the SSE endpoint forwards them to the browser.

### AI Mapping and Fallback Chain

The AI Service tries Google Gemini 2.5 Flash first. If Gemini fails, it falls through a cascade of OpenRouter-hosted models: Llama 3.3 70B, Llama 3.2 3B, Hermes 3 405B, Gemma 2 9B, and finally OpenRouter's automatic routing. If all models are exhausted, a local rule-based mapper takes over and the run still completes successfully.

### Intelligent Upsert

Before saving any batch of leads, the Lead Service queries the database for all emails and mobile numbers in that batch in a single round trip. It then decides for each record whether to create or update. Updates are additive — if the incoming row has a value for a field, it wins; if it is blank, the existing value is kept.

---

## Features

**Import pipeline**
- Drag-and-drop or click-to-upload CSV files up to 100 MB
- Supports any column naming convention — camelCase, snake_case, Title Case, mixed separators
- BOM stripping and CRLF normalization on ingest so Excel exports work cleanly
- Header normalization to lowercase snake_case before AI sees the data
- Early row filter: rows with neither an email nor a phone number are skipped before calling the AI
- Configurable row cap (100,000 rows per import) with clear error messaging if exceeded
- Preview of the first 10 rows before confirmation, with horizontal and vertical scrolling and sticky headers
- Row-level removal from the preview before triggering the actual import
- Concurrency lock on the confirm endpoint prevents double-submitting the same run

**AI processing**
- Per-batch AI mapping with a structured prompt that specifies the exact CRM schema
- AI is instructed to skip records with no valid email or phone, map CRM status and data source to allowed enum values
- Batch size adapts dynamically for small files so progress animations are visible
- Rate limit detection: if the AI returns a 429, the run falls back to the next model in the chain

**Deduplication**
- Leads are matched by email (case-insensitive) and by mobile number
- Existing data is preserved when the new row has empty fields
- The processed count of the old import run is decremented when a lead moves to a new run

**Real-time progress**
- Server-Sent Events stream live progress percentage, processed count, and skipped count
- Automatic fallback to HTTP polling every 2 seconds if SSE drops
- FAILED status surfaces the error message directly in the UI

**Cold start detection and graceful wake-up**
- Detects Render free-tier spin-down with a 2.5-second timeout on the initial health ping
- Full-screen modal with animated progress bar while the server wakes up
- Dashboard loads automatically once the backend is ready

**Lead Dashboard**
- Paginated leads table with server-side search and status filtering
- Displays total unique leads count prominently in the header
- Shows how many leads are on the current page
- Smooth vertical and horizontal scrolling with sticky headers
- Hover tooltips on every cell to preview full content
- Click any row to open a full Lead Details modal card with all 15+ CRM fields
- Leads sorted by most recently created or updated, so fresh upserts float to the top

**Deletion**
- Individual lead deletion with a confirmation dialog
- Bulk lead deletion with checkbox selection and a single confirmation
- When the last lead in an import run is deleted, the run record is also cleaned up automatically

**Import history**
- History log of every import run with status, file name, and record counts
- Click any history entry to open a View Details panel with a table preview of up to 10 imported leads

**Self-healing on startup**
- Any import run stuck in PROCESSING status (from a crash or restart) is immediately marked FAILED
- Historical completed runs have their processed and skipped counts resynced against actual database counts

**Stale run cleanup**
- PENDING runs that were never confirmed are automatically deleted after 30 minutes

**Rate limiting**
- General API: 100 requests per IP per 15 minutes
- Upload and confirm endpoints: 10 requests per IP per 15 minutes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript |
| Frontend Hosting | Vercel |
| Backend | Node.js 20, Express 4, TypeScript, Multer |
| Backend Hosting | Render (free tier, `render.yaml`) |
| AI — Primary | Google Gemini 2.5 Flash (direct API via `@google/generative-ai`) |
| AI — Fallback 1 | `meta-llama/llama-3.3-70b-instruct:free` via OpenRouter |
| AI — Fallback 2 | `meta-llama/llama-3.2-3b-instruct:free` via OpenRouter |
| AI — Fallback 3 | `nousresearch/hermes-3-405b:free` via OpenRouter |
| AI — Fallback 4 | `google/gemma-2-9b-it:free` via OpenRouter |
| AI — Fallback 5 | `openrouter/auto` (OpenRouter picks best available) |
| AI — Final Fallback | Local rule-based deterministic mapper |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 hosted on Neon (serverless Postgres) |
| Queue | Redis 7 Pub/Sub with in-memory EventEmitter fallback |
| Icons | Lucide React |
| Container | Docker + Docker Compose (local development) |

---

## Database Schema

### ImportRun

Tracks each CSV file upload from start to finish.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| file_name | String | Original uploaded file name |
| status | String | PENDING, PROCESSING, COMPLETED, FAILED |
| total_records | Int | Total rows in the uploaded file |
| processed_records | Int | Rows successfully saved |
| skipped_records | Int | Rows skipped (invalid, AI-rejected, or user-removed) |
| created_at | DateTime | Upload timestamp |

### Lead

One record per unique lead in the CRM.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| import_id | UUID | Foreign key to ImportRun |
| name | String | Full name |
| email | String | Primary email |
| country_code | String | Phone country code |
| mobile_without_country_code | String | Phone number without country code |
| company | String | Company name |
| city | String | City |
| state | String | State |
| country | String | Country |
| lead_owner | String | Email of the assigned owner |
| crm_status | String | GOOD_LEAD_FOLLOW_UP, DID_NOT_CONNECT, BAD_LEAD, SALE_DONE |
| crm_note | String | Remarks, extra contacts, overflow fields |
| data_source | String | leads_on_demand, meridian_tower, eden_park, varah_swamy, sarjapur_plots |
| possession_time | String | Property possession timeline |
| description | String | Additional details |
| created_at | DateTime | Record creation time |
| updated_at | DateTime | Last upsert time |

Indexed on: `email`, `mobile_without_country_code`, and the compound `(import_id, crm_status)`.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server and database health check. Returns `{ status: "ok" }` when both Express and Neon are reachable. |
| POST | `/api/imports/upload` | Upload CSV. Returns runId + preview rows. |
| POST | `/api/imports/:runId/confirm` | Confirm and queue rows for AI processing. |
| GET | `/api/imports/:runId/progress` | SSE stream of live progress events. |
| GET | `/api/imports/history` | List all import runs. |
| GET | `/api/imports/:id` | Get run details including all associated leads. |
| GET | `/api/leads` | Get paginated leads with optional search, status filter, and pagination. |
| DELETE | `/api/leads/:id` | Delete a single lead. |

---

## Local Setup

### Prerequisites

- Node.js 20 or later
- Docker and Docker Compose (for PostgreSQL and Redis)
- A Google AI Studio API key — get one free at [aistudio.google.com](https://aistudio.google.com)
- Optionally, an OpenRouter API key for the fallback chain

### 1. Clone the repository

```bash
git clone https://github.com/geeked-anshuk666/FlowLead-AI.git
cd FlowLead-AI
```

### 2. Configure the backend environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in your values:

```env
PORT=5000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/groweasy_crm?schema=public"
REDIS_URL="redis://localhost:6379"
GEMINI_API_KEY="your_google_ai_studio_key_here"
OPENROUTER_API_KEY="your_openrouter_key_here"
```

`REDIS_URL` is optional. If omitted, the queue falls back to in-memory mode.

### 3. Start the database and Redis

```bash
docker-compose up -d db redis
```

### 4. Install dependencies and run migrations

```bash
cd backend
npm install
npx prisma migrate dev
cd ..
```

### 5. Build and start the backend

```bash
cd backend
npm run build
npm run start
```

The API server starts on `http://localhost:5000`.

### 6. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend is available at `http://localhost:3000`.

### Running everything with Docker Compose

```bash
GEMINI_API_KEY=your_key OPENROUTER_API_KEY=your_key docker-compose up --build
```

The frontend will be on port 3000, the backend on port 5000.

---

## Deployment

### Backend — Render

The `render.yaml` file defines the `groweasy-backend` web service. Connect the repository on [render.com](https://render.com) and set these environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon connection string |
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `OPENROUTER_API_KEY` | Your OpenRouter key (optional but recommended) |

Redis is not available on Render's free tier. The queue service detects the absence of `REDIS_URL` and falls back to in-memory mode automatically.

### Frontend — Vercel

Deploy the `frontend/` directory to [vercel.com](https://vercel.com). Set one environment variable:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE` | Your Render backend URL + `/api` (e.g. `https://groweasy-backend.onrender.com/api`) |

### Database — Neon

Create a free project on [neon.tech](https://neon.tech). Copy the connection string (pooled mode recommended) and set it as `DATABASE_URL` in your Render backend config. Run migrations once after deploying:

```bash
npx prisma migrate deploy
```

---

## Sample Data

The `Sample Data/` directory contains files you can use for testing:

| File | Description |
|---|---|
| `sample_leads.csv` | Small 10-row file, good for a quick smoke test |
| `SampleData.csv` | Real-world shaped file with mixed column names, ~5 MB |

A 100,000-record synthetic dataset (`synthetic_leads_100k.csv`, ~70 MB) can be generated locally for load testing. It is excluded from the repository due to size.

To generate it:

```bash
python generate_load_test_data.py
```

The script creates 80,000 unique leads and 20,000 duplicates to test the upsert and deduplication logic at scale.

To split it into smaller chunks:

```bash
python split_test_data.py
```

---

## Edge Cases Handled

- **BOM prefix on Excel exports** — Stripped before parsing so the first header is not corrupted.
- **CRLF line endings** — Normalized to LF before the CSV parser sees the file.
- **Mixed header formats** — camelCase, PascalCase, spaces, and hyphens are all normalized to snake_case.
- **Invalid email/phone values** — Fields containing non-email text (e.g., `"Yes"`, `"No"`) in email columns are detected via regex and set to null; rows with neither a valid email nor phone are skipped entirely.
- **Empty rows with no contact info** — Filtered out before AI is called, saving tokens.
- **Double-confirm race condition** — A per-runId in-memory lock rejects concurrent confirm requests with a 409.
- **Server crash mid-import** — On startup, any run stuck in PROCESSING is set to FAILED automatically.
- **Stale PENDING runs** — Runs uploaded but never confirmed are deleted after 30 minutes.
- **AI quota exhaustion** — Detected by error pattern matching; the system cascades through all fallback models before falling back to the local rule-based mapper.
- **SSE drops on long imports** — Automatic fallback to HTTP polling every 2 seconds.
- **Self-healing import stats** — On startup, processed and skipped counts for all completed runs are recomputed from actual lead counts so historical data stays accurate.
- **Render free-tier cold start** — Detected by a 2.5-second timeout on the initial health ping; users see a graceful loading modal instead of a broken dashboard.
