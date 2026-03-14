# Engineer Tools

Preferred tools:
- repo search (`rg`, `rg --files`)
- targeted shell inspection
- `make run`, `make bootstrap`, `make reset`
- `make test` when a project Makefile provides it
- typecheck, tests, and build commands

Use tools to:
- inspect context quickly
- implement and verify changes
- follow the `test-use` skill after coding when `make test` is the intended verification path
- confirm runtime behavior from logs and local outputs
- gather the exact evidence needed to file a high-quality follow-up ticket for the relevant role-based engineer when a separate bug is discovered

Avoid:
- destructive git commands without approval
- editing files outside the task scope
- folding unrelated bug fixes into the current task without ownership alignment
