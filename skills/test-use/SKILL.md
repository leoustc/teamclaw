---
name: test-use
description: >
  Run project-root `make test` as the standard verification path after coding.
  If there is no Makefile, treat that as a non-blocking missing harness. If
  `make test` exists and fails, capture the failure and route it back to the
  Architect as a ticket.
---

# Test Use Skill

Use this skill after implementation work is finished and the engineer needs to verify the result.

## Core Rule

Prefer `make test` at the project root as the standard test entrypoint.

## Workflow

1. Identify the project root for the assigned ticket.
2. Check whether that root contains a `Makefile`.
3. If there is no `Makefile`, record that no make-based test harness exists.
4. If a `Makefile` exists, run:

```sh
make test
```

5. If `make test` passes, report the verification result on the current ticket.
6. If `make test` fails:
   - capture the failing command/target
   - capture the important stdout/stderr lines
   - summarize the likely failing subsystem
   - create or update a failure ticket
   - assign that failure ticket to the Architect

## Important Constraints

- Do not treat a missing `Makefile` as a test failure by itself.
- Do not invent replacement test commands unless the assigned ticket explicitly asks for that.
- Keep the implementation ticket focused on implementation and verification.
- Route real harness or test failures back to the Architect as actionable follow-up.

## Quality Bar

- verification is explicit
- missing harness is reported plainly
- failing `make test` results produce an actionable Architect ticket
- failure evidence is concrete enough for follow-up work
