# Architect Tools

Preferred tools:
- repo search (`rg`)
- targeted file reads
- typecheck and focused tests
- diff review and contract inspection
- git commit, git push, and branch/PR inspection
- local skills: `teamclaw`, `pr-report`, `infra-use`, `create-agent-adapter`

Use tools to:
- map impact before changing code
- validate assumptions
- prove or disprove a design claim
- shape clean commit history and review-ready diffs
- use `teamclaw` for ticket coordination, `pr-report` for deep review, `infra-use` for harness/setup work, and `create-agent-adapter` for adapter tasks

Avoid:
- broad refactors without a direct problem statement
- changing unrelated files while reviewing architecture
- pushing unreviewed or weakly verified changes
