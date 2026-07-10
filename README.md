# GrowEasy AI CSV Lead Importer

A production-grade tool that takes a CSV file of any shape or column structure and converts it into clean, deduplicated leads inside the GrowEasy CRM. An AI model reads the raw column headers and cell values, figures out what each column actually means, and maps everything to the CRM's target schema — no manual field mapping required.

Built as a full-stack TypeScript application with Next.js on the frontend, Express on the backend, Prisma + PostgreSQL for persistence, and Google Gemini as the primary AI mapping engine.

---

## Demo

| Service | URL |
|---|---|
| Frontend | _Add your Vercel URL here_ |
| Backend API | _Add your Render URL here_ |

> The backend runs on Render's free tier and spins down after 15 minutes of inactivity. The first request after a period of inactivity can take up to 2 minutes to respond while the instance wakes up. The frontend on Vercel is always instant. If the app appears to hang on first load, wait a moment and try again.

---

## How it works

You drop a CSV file into the upload area. The backend parses it immediately, returns a row count and a preview of the first 50 records. You review that preview, optionally remove individual rows you do not want, then click Import. That triggers the backend to send the confirmed rows through an AI pipeline in batches of 50. The AI maps each batch to the CRM schema, and the results are saved to the database in real time. Progress streams back to the browser over a Server-Sent Events connection so you see a live percentage counter.

If a lead already exists in the database (matched by email or mobile number), it gets updated rather than duplicated. Existing fields are preserved when the incoming row has no value for them. New records are created for everything else.

---

## Architecture

```mermaid
graph TB
    subgraph Browser["Browser"]
        FE["Next.js Frontend\n(React 19 + Tailwind v4)"]
    end

    subgraph Server["Backend — Express + TypeScript"]
        API["API Layer\n(Rate Limited)"]
        CTRL["Import Controller"]
        CSV["CSV Service\n(Parse + Sanitize + Normalize)"]
        AI["AI Service\n(Gemini 2.5 Flash)"]
        OR["OpenRouter Fallback\nllama-3 / mistral-7b / auto"]
        QUEUE["Queue Service\n(Redis Pub/Sub or In-Memory)"]
        WORKER["Worker\n(Batch Processor)"]
        LEAD["Lead Service\n(Intelligent Upsert)"]
        SSE["SSE Progress Stream"]
    end

    subgraph Data["Data Layer"]
        PG["Neon PostgreSQL\n(Prisma ORM)"]
        REDIS["Redis\n(Pub/Sub, optional)"]
    end

    FE -->|"POST /api/imports/upload"| API
    FE -->|"POST /api/imports/:id/confirm"| API
    FE -->|"GET /api/imports/:id/progress (SSE)"| SSE
    FE -->|"GET /api/imports/history"| API
    FE -->|"DELETE /api/leads/:id"| API

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

### Upload + Confirm Flow

The upload step and the processing step are deliberately separated. When you upload a file, the backend parses it, saves a PENDING record to the database, holds the valid rows in memory, and sends back a preview. Nothing touches the AI yet. Only after you confirm does the backend publish the rows to the queue, and the worker picks them up for AI processing. This means you can inspect what is about to be imported and remove bad rows before any credits are spent.

### Queue and Worker

In local development, the queue falls back to Node.js `EventEmitter` when no Redis URL is provided, so nothing external is required. When `REDIS_URL` is set, the queue uses Redis Pub/Sub. The worker subscribes to the `csv_imports` channel and processes each import run in configurable batches (default 50 rows per batch). Progress events are published to a per-run channel (`import_progress:<runId>`) and the SSE endpoint forwards them to the browser.

### AI Mapping and Fallback Chain

The AI Service tries Google Gemini 2.5 Flash first. If Gemini fails for any reason (quota, network error, or missing key), it falls through a cascade of OpenRouter-hosted models: Gemini 2.5 Flash free tier, Llama 3 8B Instruct, Mistral 7B Instruct, and finally OpenRouter's automatic routing. If everything is exhausted, the run is marked FAILED immediately rather than silently skipping rows.

### Intelligent Upsert

Before saving any batch of leads, the Lead Service queries the database for all emails and mobile numbers in that batch in a single round trip. It then decides for each record whether to create or update. Updates are additive — if the incoming row has a value for a field, it wins; if it is blank, the existing value is kept. The import run counter of the old run is decremented when a lead is reassociated to a new import.

---

## Features

**Import pipeline**
- Drag-and-drop or click-to-upload CSV files up to 100 MB
- Supports any column naming convention — camelCase, snake_case, Title Case, mixed separators
- BOM stripping and CRLF normalization on ingest so Excel exports work cleanly
- Header normalization to lowercase snake_case before AI sees the data
- Early row filter: rows with neither an email nor a phone number are skipped before calling the AI, saving tokens
- Configurable row cap (100,000 rows per import) with clear error messaging if exceeded
- Preview of the first 50 rows before confirmation
- Row-level removal from the preview before triggering the actual import
- Concurrency lock on the confirm endpoint prevents double-submitting the same run

**AI processing**
- Per-batch AI mapping with a structured prompt that specifies the exact CRM schema
- AI is instructed to skip records with no valid email or phone, map CRM status and data source to allowed enum values, and roll extra phone numbers and emails into the notes field
- Batch size adapts dynamically for small files so progress animations are visible and not instantaneous
- Rate limit detection: if the AI returns a 429 or exhaustion error, the entire run is marked FAILED immediately and the reason is surfaced in the frontend

**Deduplication**
- Leads are matched by email (case-insensitive) and by mobile number
- Existing data is preserved when the new row has empty fields
- The processed count of the old import run is decremented when a lead moves to a new run

**Real-time progress**
- Server-Sent Events stream live progress percentage, processed count, and skipped count
- Automatic fallback to HTTP polling every 2 seconds if SSE drops (proxy timeout, network interruption)
- FAILED status surfaces the error message directly in the UI

**Import history and database view**
- Two views: active database leads and import history log
- History shows each import run with status, file name, record counts, and a View Details panel
- Lead table supports real-time search across name, email, company, and mobile number
- Status filter dropdown to narrow leads by CRM status
- Leads sorted by most recently created or updated, so fresh upserts float to the top

**Deletion**
- Individual lead deletion from the database with a confirmation dialog
- Bulk lead deletion with checkbox selection and a single confirmation
- When the last lead in an import run is deleted, the run record is also cleaned up automatically
- Preview row removal before import with the same confirmation dialog pattern

**Self-healing on startup**
- Any import run stuck in PROCESSING status (from a crash or restart) is immediately marked FAILED on boot
- Historical completed runs have their processed and skipped counts resynced against actual database counts so the history log is always accurate

**Stale run cleanup**
- PENDING runs that were never confirmed are automatically deleted after 30 minutes
- Cleanup runs every 10 minutes in the background

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
| AI — Fallback 1 | `google/gemini-2.5-flash:free` via OpenRouter |
| AI — Fallback 2 | `meta-llama/llama-3-8b-instruct:free` via OpenRouter |
| AI — Fallback 3 | `mistralai/mistral-7b-instruct:free` via OpenRouter |
| AI — Fallback 4 | `openrouter/auto` (OpenRouter picks best available) |
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
| POST | `/api/imports/upload` | Upload CSV. Returns runId + preview. |
| POST | `/api/imports/:runId/confirm` | Confirm and queue rows for processing. |
| GET | `/api/imports/:runId/progress` | SSE stream of live progress events. |
| GET | `/api/imports/history` | List all import runs. |
| GET | `/api/imports/:id` | Get run details including all associated leads. |
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
git clone https://github.com/geeked-anshuk666/AI-based-CSV-lead-importer.git
cd AI-based-CSV-lead-importer
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

`REDIS_URL` is optional. If omitted, the queue falls back to in-memory mode and everything still works — you just lose the ability to run the worker as a separate process.

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

If you want to spin up all four services (database, Redis, backend, worker, frontend) together:

```bash
# Copy your keys into a .env file at the root or export them as shell variables first
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

Redis is not available on Render's free tier. The queue service detects the absence of `REDIS_URL` and falls back to in-memory mode automatically, so nothing breaks.

**Free tier cold start:** Render free instances spin down after 15 minutes of inactivity. The first request after a dormant period can take 50–120 seconds while the container starts. The frontend will appear unresponsive during this time. This is a Render limitation — not a bug in the application. Upgrading to a paid instance eliminates it.

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

To regenerate it:

```bash
python generate_load_test_data.py
```

The script creates 80,000 unique leads and 20,000 duplicates (drawn randomly from the unique set) to test the upsert and deduplication logic at scale. The file lands in the project root.

To split it into four chunks that fit within the 100 MB upload limit individually:

```bash
python split_test_data.py
```

---

## Edge Cases Handled

These are not theoretical — each one was triggered during development and addressed:

- **BOM prefix on Excel exports**: Stripped before parsing so the first header is not corrupted.
- **CRLF line endings**: Normalized to LF before the CSV parser sees the file.
- **Empty rows with no contact info**: Filtered out before AI is called, saving tokens on garbage data.
- **Double-confirm race condition**: A per-runId in-memory lock rejects concurrent confirm requests for the same run with a 409.
- **Server crash mid-import**: On startup, any run stuck in PROCESSING is set to FAILED automatically.
- **Stale PENDING runs**: Runs that were uploaded but never confirmed are deleted after 30 minutes.
- **AI quota exhaustion**: Detected by error message pattern matching. The run is immediately marked FAILED and remaining rows are counted as skipped rather than silently lost.
- **SSE drops on long imports**: Automatic fallback to HTTP polling every 2 seconds keeps the frontend tracking progress even through proxy timeouts or flaky connections.
- **Self-healing import stats**: On startup, processed and skipped counts for all completed runs are recomputed from actual lead counts in the database, so historical data is always consistent even after deletions or crashes.
