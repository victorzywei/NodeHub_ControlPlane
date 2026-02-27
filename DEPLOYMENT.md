# NodeHub Production Deployment

## 1. Deployment Goal

- Runtime: Cloudflare Pages + Pages Functions
- Data store: Cloudflare KV
- Topology: Separate Preview and Production environments
- Principle: No shared secrets or KV namespaces across environments

## 2. Prerequisites

- Cloudflare account with Pages + Workers KV access
- Node.js 20+ and npm
- Repository connected to Cloudflare Pages (recommended)
- A strong admin key generated for production

Generate a strong key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Cloudflare Resource Setup

1. Create two KV namespaces:
1. `nodehub-kv-preview`
1. `nodehub-kv-prod`

2. In Cloudflare Pages project settings:
1. Build command: `npm ci && npm run build`
1. Build output directory: `dist`
1. Functions directory: `functions`

3. Add environment variables:
1. `ADMIN_KEY` (Preview): separate preview key
1. `ADMIN_KEY` (Production): strong production key

4. Add KV binding in both environments:
1. Binding name: `NODEHUB_KV`
1. Preview -> `nodehub-kv-preview`
1. Production -> `nodehub-kv-prod`

## 4. Release Gate (Mandatory)

Run before every release:

```bash
npm ci
npm run check:release
```

If this gate fails, do not deploy.

## 5. Deployment Flow

## Preview

1. Push feature branch
1. Let Pages create Preview deployment
1. Verify core flow:
1. `/login` works with preview key
1. create node
1. create release
1. get subscription content

## Production

1. Merge validated branch into production branch
1. Wait for Pages production deployment success
1. Run smoke checks immediately (section 6)

## 6. Smoke Checks After Production Deploy

Replace placeholders and execute:

```bash
curl -fsS "https://<your-domain>/api/system/status" -H "X-Admin-Key: <ADMIN_KEY>"
curl -fsS "https://<your-domain>/api/nodes" -H "X-Admin-Key: <ADMIN_KEY>"
curl -fsS "https://<your-domain>/api/templates" -H "X-Admin-Key: <ADMIN_KEY>"
```

Expected: all return JSON with `"success": true`.

## 7. Agent-Side Production Requirement

- Install agents only via the generated install command from `/api/nodes/:id/install`.
- Ensure systemd is enabled on each node.
- Verify both services are active:
  - `nodehub-heartbeat.service`
  - `nodehub-reconcile.service`

Example check:

```bash
systemctl status nodehub-heartbeat.service nodehub-reconcile.service --no-pager
```

## 8. Security Baseline

- Never use `VITE_SKIP_AUTH=1` in production builds.
- Use different `ADMIN_KEY` values for Preview and Production.
- Rotate `ADMIN_KEY` periodically and after any suspected leak.
- Restrict dashboard/project access by least privilege.

## 9. Rollback Strategy

1. Roll back Pages to previous successful production deployment.
1. Keep KV schema backward compatible when releasing API changes.
1. If a release causes agent apply failures:
1. publish a new fixed release version
1. verify nodes converge through reconcile loop

## 10. Operations Checklist

- Daily: verify online node ratio and release status anomalies
- Weekly: review Functions error logs
- Monthly: rotate admin key and verify login
