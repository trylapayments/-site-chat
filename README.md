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

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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
│   └── widget/           # Widget bundle (Phase 1+)
├── supabase/             # Supabase local config
├── tooling/              # Shared ESLint, Prettier, TSConfig
├── docs/                 # Product documentation
└── docker/               # Development Dockerfiles
```

## Scripts

| Command             | Description                 |
| ------------------- | --------------------------- |
| `pnpm dev`          | Start Next.js dev server    |
| `pnpm build`        | Build all packages          |
| `pnpm lint`         | Run ESLint across workspace |
| `pnpm typecheck`    | Run TypeScript checks       |
| `pnpm format`       | Format with Prettier        |
| `pnpm format:check` | Check formatting            |

## Documentation

See the [docs/](./docs/) directory for architecture, database design, security model, and roadmap.
