---
name: infra-use
description: >
  Use the local deterministic infra layer in `tools/infra/` when setting up or
  extending harness, testbed, or local server environment workflows. Read the
  infra README first, then wire the setup into `Makefile` where appropriate.
---

# Infra Use Skill

Use this skill when the task involves local infrastructure setup, harness environments, deterministic testbeds, or server-side runtime helpers.

This skill is specifically for the TeamClaw repo-local infra layer:

- `tools/infra/`

## Core Rule

Before making infra or harness changes:

1. inspect `tools/infra/`
2. read `tools/infra/README.md`
3. use that repo-local infra model as the source of truth

Do not invent a parallel setup path outside the repo if the infra layer should own it.

## When to Use

Use this skill for requests like:

- "set up a harness environment"
- "add a local testbed"
- "make bootstrap install the infra helpers"
- "wire local infra checks into Makefile"
- "make server-side setup deterministic"

## Preferred Workflow

1. Read `tools/infra/README.md`.
2. Inspect the relevant infra scripts, helpers, or conventions under `tools/infra/`.
3. Decide whether the change belongs in:
   - `tools/infra/`
   - `Makefile`
   - both
4. If the change affects local setup/bootstrap behavior, prefer surfacing it through:
   - `make bootstrap`
   - `make run`
   - `make reset`
5. Keep the setup deterministic and inspectable from the repo.

## Makefile Guidance

For harness or testbed setup:

- prefer adding the setup/check flow to `make bootstrap`
- if the harness is part of normal local server operation, make `make run` depend on the required bootstrap state
- do not create extra public operator commands unless there is a strong reason

The target shape should stay simple for operators:

```sh
make bootstrap
make run
make reset
```

## Quality Bar

- infra behavior is deterministic
- setup is visible in repo, not hidden in personal shell state
- `tools/infra/README.md` remains aligned with the actual setup path
- `Makefile` stays the main operator entrypoint for local environment setup

## Avoid

- one-off shell instructions that bypass `Makefile`
- hidden bootstrap logic scattered across unrelated scripts
- adding infra behavior without documenting it in `tools/infra/README.md`
- adding public commands when `bootstrap`, `run`, or `reset` are enough
