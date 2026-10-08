# AWS staging — preparation

Status: files prepared; no AWS resources created and no release deployed.

## Foundation

`staging.cloudformation.json` defines an isolated VPC, public subnet, t3.large Ubuntu server (2 vCPU / 8 GB), encrypted 100 GB gp3 root disk, Elastic IP and an SSM instance role. Only HTTP/HTTPS are exposed. SSH, Postgres and Studio must remain private. Docker and Supabase are installed separately. There is no automatic app deployment in this template.

The stack creates billable EC2, EBS and public IPv4 resources. A region, account and budget must be confirmed before launch. The disk is retained on instance termination: this helps recovery but continues incurring charges until explicitly removed. This single-server topology is for isolated staging, not a high-availability production deployment.

## Backend

Use the official Supabase self-hosted Docker distribution pinned to a release and commit; do not use the development `docker-compose.yml` in this repository as a backend stack. It contains only Postgres and does not provide Auth, REST, Realtime or Storage.

Before installation, check the release against the repository migrations and custom JWT realtime authorization. Generate independent staging credentials, configure HTTPS API and app domains, auth redirect URLs and email delivery. Run migrations against the staging database only. Never run local `db reset` against an existing environment. Use synthetic fixtures; do not import production customer data.

Keep gateway bound to loopback behind a reverse proxy, and block public Studio routes. Validate the actual gateway ports and upstream paths against the pinned distribution before publishing. Keep storage and database volumes persistent. Backup both the database and storage, then test restoration separately.

Official reference: https://supabase.com/docs/guides/self-hosting/docker

## Application

Copy `web.env.example` to `runtime/web.env` and replace every placeholder. Runtime is ignored by Git and excluded from the Docker build context. Values prefixed NEXT_PUBLIC are embedded at build time, so build one image per environment. Actual server secrets are runtime-only; the builder uses placeholders to satisfy schema checks. Build cache still includes public keys, as expected.

From the repository root:

```sh
docker compose --env-file infra/aws/runtime/web.env -f infra/aws/compose.web.yml build
docker compose --env-file infra/aws/runtime/web.env -f infra/aws/compose.web.yml up -d --wait
```

The application listens only on host loopback port 3000. Configure the HTTPS reverse proxy before access from the internet. Set a unique image tag for every release. The image currently retains workspace development dependencies to avoid breaking pnpm workspace links; image slimming is deferred until staging is validated.

## Release gate

1. Validate CloudFormation through AWS before resource creation.
2. Validate container build and runtime health with staging public config.
3. Run migration/database tests and the full E2E suite in Linux/CI.
4. Repeat the relevant E2E three times without retries or database reset.
5. Test auth, real messages, realtime reconnect, assignment and attachments over HTTPS.
6. Validate backup restoration and previous-image rollback before production promotion.
7. Add the exact Millcorn domains to the widget allowlist; validate widget embedding and site CSP on a test page first.

The existing E2E configuration is local-only (ports 3000/3001 and synthetic users); running it against a remote staging URL requires deliberate configuration and separate test credentials. Do not substitute production endpoints in `.env.local`.
