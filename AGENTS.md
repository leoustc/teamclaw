# AGENTS.md

Guidance for human and AI contributors working in this repository.

Bug tracking file:

- use `BUGS.md`
- do not create `bugs.md`

## 1. Purpose

TeamClaw is a ticketing-based collaboration system for human operators and multiple agents.
The product is a server-side engineering coordination surface where work moves through issues, projects, approvals, runs, and persistent workspaces.

Core workflow contract:

- Manager receives and triages new tickets.
- Technical or development tickets go to Architect first for analysis and decomposition.
- If a Manager ticket mixes Manager work and technical work, the Manager must split out a new tech-only follow-up ticket and route that follow-up ticket to Architect with status `todo`.
- A Manager-created technical follow-up must not be left unassigned and must not stay with Manager after triage.
- When Architect finishes decomposition, Architect must leave a note starting with `Task decomposition done`.
- If decomposition reveals a missing Engineer role, Architect requests hiring from Manager.
- Manager performs the hire, then resumes the decomposed task flow by assigning the execution ticket to the Engineer.
- Both Manager and Architect may assign implementation tickets to Engineers.
- Workflow routing is server-owned: after a run finishes, fails, or is cancelled, TeamClaw runs a deterministic monitor/routing pass inside the server process to reassign and wake the next agent.
- Agents should report successful completion through a proposed handoff (`proposedStatus`, `nextAgentId|nextAgentName|nextAgentRole`, optional `note`); TeamClaw and monitor own the real issue mutation.
- The interval monitor is a repair loop; immediate post-run routing is the primary path.
- Scheduled recurring work comes from `scheduler/tasks.md`; the scheduler creates the daily issue and routes it through monitor, with `manager` as the fallback lead when no requested agent can be resolved.

## 2. Read This First

Before making changes, read in this order:

1. `doc/GOAL.md`
2. `doc/PRODUCT.md`
3. `doc/SPEC-implementation.md`
4. `doc/DEVELOPING.md`
5. `doc/DATABASE.md`

`doc/SPEC.md` is long-horizon product context.
`doc/SPEC-implementation.md` is the concrete V1 build contract.

## 3. Repo Map

- `server/`: Express REST API and orchestration services
- `ui/`: React + Vite board UI
- `packages/db/`: Drizzle schema, migrations, DB clients
- `packages/shared/`: shared types, constants, validators, API path constants
- `doc/`: operational and product docs

## 3.1 Company Filesystem Layout

TeamClaw also maintains a company-scoped working tree on disk under:

- `$HOME/<company-name>/agents/`
- `$HOME/<company-name>/projects/`
- `$HOME/<company-name>/issues/`
- `$HOME/<company-name>/skills/`
- `$HOME/<company-name>/tools/`

Per-agent local workspaces should include:

- `notes/` for task-local notes and working scratch files
- `memory/` for durable local memory

The company `issues/` folder is the filesystem mirror of issue history. Issue create/update/comment activity should keep that on-disk view current.

Issue defaults:
- if an issue has no project, TeamClaw should attach the company project named `default`
- if an actionable issue has no assignee, TeamClaw should assign it to the company `manager`
- issue identifiers should use `<projectname_max16>-<id>`, derived from the linked project name rather than the company name

## 4. Dev Setup (Auto DB)

Use embedded PGlite in dev by leaving `DATABASE_URL` unset.
Prefer the server-style operator flow:
- `make bootstrap`
- `make build`
- `make install`
- `make deploy`
- `make run`

Do not invoke `pnpm dev` directly for normal operation.
`make install`, `make deploy`, and `make run` are expected to prompt for `sudo` because the service is managed through `systemd`.
If the fix is specifically about bootstrap/setup behavior, add or update the workflow in `make bootstrap`.

```sh
make build
make install
make deploy
make run
```

This serves:

- API: `http://localhost:3100`
- UI: `http://localhost:3100` (served by the built UI from the API server)

`make build` assembles the runtime bundle under `build/`.
`make deploy` copies that snapshot into `/opt/teamclaw/current`, and the systemd service runs from there rather than from the source repository.

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Reset local dev DB:

```sh
make fresh-start
```

### Debug Log Quick Checks

When debugging auth or startup behavior, inspect the systemd service logs first.

If you are using the provided `systemd` setup, use these as the primary log sources:

```sh
journalctl -u teamclaw.service -n 120 --no-pager
sed -n '1,120p' /var/log/teamclaw.log
```

`debug.log` is only for older non-systemd local setups. If your local setup still writes `debug.log`, check it only as a fallback:

```sh
sed -n '1,80p' debug.log
```

For remote install debugging, also check `debug.remote.log` when present:

```sh
sed -n '1,80p' debug.remote.log
```

Always verify these lines first:

- `service mode:` from the startup logs
- `Deploy` from the startup banner (`local_trusted` vs `authenticated`)

For PAM/login issues, also check:

```sh
rg -n "/api/auth/get-session|/api/auth/pam/sign-in|401|403" /var/log/teamclaw.log
```

If the startup logs show `local_trusted`, PAM login will not be enforced. Restart with `make run`.

## 5. Core Engineering Rules

1. Keep changes company-scoped.
Every domain entity should be scoped to a company and company boundaries must be enforced in routes/services.

2. Keep contracts synchronized.
If you change schema/API behavior, update all impacted layers:
- `packages/db` schema and exports
- `packages/shared` types/constants/validators
- `server` routes/services
- `ui` API clients and pages

3. Preserve control-plane invariants.
- Single-assignee task model
- Atomic issue checkout semantics
- Approval gates for governed actions
- Budget hard-stop auto-pause behavior
- Activity logging for mutating actions

4. Do not replace strategic docs wholesale unless asked.
Prefer additive updates. Keep `doc/SPEC.md` and `doc/SPEC-implementation.md` aligned.

## 6. Database Change Workflow

When changing data model:

1. Edit `packages/db/src/schema/*.ts`
2. Ensure new tables are exported from `packages/db/src/schema/index.ts`
3. Generate migration:

```sh
pnpm db:generate
```

4. Validate compile:

```sh
pnpm -r typecheck
```

Notes:
- `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`
- `pnpm db:generate` compiles `packages/db` first

## 7. Verification Before Hand-off

Run this full check before claiming done:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 8. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:

- apply company access checks
- enforce actor permissions (board vs agent)
- write activity log entries for mutations
- return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 9. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors

## 10. Definition of Done

A change is done when all are true:

1. Behavior matches `doc/SPEC-implementation.md`
2. Typecheck, tests, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
