# Site Chat

Customer messaging platform for websites.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- [Docker](https://www.docker.com/) (optional, for containerized development)

## Getting Started

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Start Supabase (requires Docker)
supabase start

# Rebuild shared packages and clear stale Next.js cache
pnpm local:refresh

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local development refresh

After pulling changes, run `pnpm local:refresh` when local runtime errors look misleading or when shared/AI package output may be stale. It is **required after pulling changes that affect `packages/shared` or `packages/ai`**. Without a refresh, the widget bundle and Next.js app can keep using stale compiled output, which leads to confusing validation or type mismatches at runtime.

The refresh script:

1. rebuilds `@site-chat/shared`
2. rebuilds `@site-chat/ai`
3. rebuilds `@site-chat/widget` (so committed/public widget bundles pick up updated schemas/types)
4. removes `apps/web/.next` (clears cached Next.js build output)

Normal local startup sequence:

1. Ensure Docker is running (for Supabase)
2. `supabase start`
3. `pnpm local:refresh`
4. `pnpm dev`

Use `pnpm local:restart` to run the refresh steps and then start the dev server in one command.

## Docker Development

```bash
cp .env.example .env.local
docker compose up
```

## Project Structure

```
site-chat/
├── apps/
│   └── web/              # Next.js application (App Router)
├── packages/
│   ├── shared/           # Shared types, constants, validators
│   ├── ai/               # AI provider abstraction + Suggested Replies foundation
│   └── widget/           # Widget bundle (Phase 1+)
├── supabase/             # Supabase local config
├── tooling/              # Shared ESLint, Prettier, TSConfig
├── docs/                 # Product documentation
└── docker/               # Development Dockerfiles
```

## Scripts

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | Start Next.js dev server                       |
| `pnpm build`         | Build all packages                             |
| `pnpm lint`          | Run ESLint across workspace                    |
| `pnpm typecheck`     | Run TypeScript checks                          |
| `pnpm format`        | Format with Prettier                           |
| `pnpm format:check`  | Check formatting                               |
| `pnpm local:refresh` | Rebuild shared/widget and clear Next.js cache  |
| `pnpm local:restart` | Refresh local artifacts, then start dev server |

## Documentation

See the [docs/](./docs/) directory for architecture, database design, security model, and roadmap.
