# tools/infra

`tools/infra/` is the deterministic infrastructure layer for TeamClaw.

Its purpose is to support the ticketing-based human and multi-agent engineering workflow with predictable local and server-side runtime helpers.

Use this folder for:

- repeatable environment setup
- server-local orchestration helpers
- infrastructure scripts that support project and agent execution
- deterministic conventions that should be visible in the repo instead of hidden in personal machine state

Do not use this folder for:

- product logic
- ad-hoc one-off experiments
- agent prompts or role behavior

Those belong in:

- `server/`, `ui/`, `packages/` for product behavior
- `roles/` for role packs
- `skills/` for reusable agent capability instructions
