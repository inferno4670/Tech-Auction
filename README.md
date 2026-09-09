# TECH AUCTION

A real-time technical auction quiz platform for national-level college quiz competitions.

## Overview

8 teams compete with a fixed virtual budget to bid on technology auction items. Winning an auction gives a team the right to answer a technical question. Correct answers earn reward points; wrong answers incur penalties. The top 4 teams qualify for the next round.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS v4
- **Database**: Supabase (PostgreSQL + Auth + Realtime + RLS)
- **Deployment**: Vercel

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd tech-auction
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 4. Run database migrations

In the Supabase SQL Editor, run:

1. `database/migrations/001_initial_schema.sql` — creates all tables, RLS policies, indexes, and triggers
2. `database/seed.sql` — seeds 10 sample auction items and default event settings

### 5. Create admin account

1. Go to Supabase Authentication → Users
2. Create a new user with email/password
3. In SQL Editor, assign admin role:

```sql
INSERT INTO profiles (id, email, role, display_name)
VALUES ('<user-id>', 'admin@example.com', 'admin', 'Quizmaster');
```

### 6. Create team accounts

For each team, create a Supabase auth user and link to a team:

```sql
-- After creating the auth user, link it
INSERT INTO team_members (user_id, team_id)
VALUES ('<user-id>', '<team-id>');
```

Or use the admin UI to auto-generate 8 teams.

### 7. Run locally

```bash
npm run dev
```

Open http://localhost:5173

## Project Structure

```
src/
├── components/
│   ├── layout/       # AdminLayout, TeamLayout
│   ├── ui/           # Shared UI components
│   ├── admin/        # Admin-specific components
│   ├── team/         # Team-specific components
│   └── display/      # Display mode components
├── pages/
│   ├── admin/        # Admin pages (Dashboard, Teams, Auctions, Live Control, Leaderboard, Logs, Settings)
│   ├── team/         # Team dashboard
│   └── display/      # Projector display mode
├── hooks/
│   ├── useAuth.tsx   # Authentication context and hook
│   └── useRealtime.ts # Supabase Realtime subscriptions
├── lib/
│   ├── supabase.ts   # Supabase client
│   ├── auth.ts       # Auth helper functions
│   ├── queries.ts    # Database queries
│   └── utils.ts      # Utility functions
├── types/
│   └── index.ts      # TypeScript types
└── index.css         # Tailwind + custom theme
database/
├── migrations/       # SQL migration files
└── seed.sql          # Seed data
```

## Routes

| Route | Access | Description |
|-------|--------|-------------|
| `/` | Public | Landing page |
| `/login` | Public | Role-based login |
| `/admin` | Admin | Dashboard |
| `/admin/teams` | Admin | Team management |
| `/admin/auctions` | Admin | Auction item management |
| `/admin/live` | Admin | Live auction control |
| `/admin/leaderboard` | Admin | Full leaderboard |
| `/admin/logs` | Admin | Audit log |
| `/admin/settings` | Admin | Event configuration |
| `/team` | Team | Team dashboard |
| `/display` | Public | Projector display |

## Deployment

### Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

## Security

- Row Level Security (RLS) enabled on all tables
- Team users can only read their own data
- Admin users have full access
- Answer keys never sent to team browsers
- Supabase anon key only (no service role in frontend)
- All state transitions validated server-side

## Competition Flow

1. **Setup**: Admin creates teams and auction items
2. **Lobby**: Teams log in and wait
3. **Live**: Admin starts auctions, teams bid in real-time
4. **Questions**: Winning team answers a technical question
5. **Results**: Scores and rankings update live
6. **Finalize**: Top 4 teams qualify

## License

MIT
