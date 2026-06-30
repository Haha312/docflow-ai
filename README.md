# DocuFlow AI

DocuFlow AI is an AI-assisted document restructuring product. It turns pasted text or uploaded documents into structured, styled HTML previews and exportable Word documents, with account, quota, payment, and admin workflows around the generation service.

## Project Layout

- `frontend/` - React + Vite application for upload, preview, style editing, payment, account, and admin pages.
- `backend/` - Express + TypeScript API for auth, quotas, AI generation, payments, usage records, and background jobs.
- `backend/prisma/` - Prisma schema and database migrations.
- `docs/` - engineering notes, including the long-document robustness plan.
- `scripts/` - local system test helpers.

## Core Capabilities

- AI document generation through backend-proxied model providers.
- Long-document chunking, skeleton-based heading recovery, deterministic post-processing, image placeholder recovery, and integrity reporting.
- DOCX parsing and DOCX export.
- JWT authentication, usage limits, tiers, and admin management.
- Alipay / WeChat oriented payment flows, refund handling, and reconciliation jobs.
- Chinese and English UI strings.

## Prerequisites

- Node.js 18 or newer
- npm
- PostgreSQL database configured through Prisma
- Redis for readiness checks, rate-related state, and production jobs
- AI provider keys configured in the backend environment

## Local Setup

Install dependencies separately:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Create environment files from the examples:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.local
```

Then fill in the required backend values such as `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, model provider keys, CORS/frontend URLs, and payment settings.

Apply database migrations and generate the Prisma client:

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

Start the backend:

```bash
cd backend
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

The default local endpoints are:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Health: `http://localhost:3001/health`
- Readiness: `http://localhost:3001/ready`

## Verification

Run the backend checks:

```bash
cd backend
npm run typecheck
npm test
```

Run the frontend checks:

```bash
cd frontend
npm run typecheck
npm test
```

## Notes

- Do not commit real `.env` files, payment certificates, private keys, or production QR/payment artifacts.
- `backend/src/routes/generate.ts`, `frontend/Home.tsx`, and `frontend/utils/docxGenerator.ts` are currently the main complexity hotspots and should be refactored incrementally rather than rewritten in one pass.
- The long-document pipeline depends on deterministic validation after model output, so preserve integrity tests when changing chunking, skeleton, or post-processing behavior.
