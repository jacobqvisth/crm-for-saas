# CRM for SaaS

A CRM application built for SaaS businesses. Manage customers, track deals, and monitor your pipeline.

## Stack

- **Framework:** Next.js 16 (App Router) with TypeScript
- **Auth & Database:** Supabase
- **Styling:** Tailwind CSS v4
- **UI:** Lucide icons, Recharts for analytics, react-hot-toast for notifications
- **Drag & drop:** @hello-pangea/dnd
- **CSV import:** PapaParse
- **Validation:** Zod

## Project Structure

```
src/
  app/
    (auth)/        # Login, signup pages
    (dashboard)/   # Main app pages (protected)
    api/           # API routes
  components/      # Reusable UI components
  lib/             # Supabase client, utilities
  middleware.ts    # Auth middleware (protects routes)
```

## Getting Started

```bash
npm install
npm run dev
```

App runs at http://localhost:3000

## Environment Variables

Create `.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```
