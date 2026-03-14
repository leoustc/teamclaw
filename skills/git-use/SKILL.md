---
name: git-use
description: >
  Use a file-only git working branch for agent changes. Start from the current
  main branch contents without carrying prior branch history, create a fresh
  branch named from the agent or a uuid, then make the code update there.
---

# Git Use Skill

Use this skill when an agent needs an isolated git branch for implementation work.

## Core Rule

Create a fresh development branch from the current `main` branch files only.

The branch should contain the current `main` snapshot, but it should not carry prior feature-branch history into the new work branch.

## Branch Naming

Use one of:

- the agent name
- a uuid

Examples:

- `architect_architect`
- `engineer_alpha`
- `019d9d8e-branch`

## Workflow

1. Confirm the repository is on `main` or sync the local files to the current `main` snapshot you intend to branch from.
2. Create a fresh branch for the agent's work.
3. Keep only the current file state from `main` as the starting point for the new work.
4. Make the code changes on that branch.
5. Verify the result before handing the branch back for review or integration.

## Practical Intent

This skill is for a clean agent work branch built from the current `main` files, not for preserving old feature-branch commit history.

If you need a history-light branch, prefer a fresh branch/orphan-style workflow that starts from the current project files and then records the new work cleanly.

## Quality Bar

- branch name clearly identifies the agent or run
- branch starts from the intended current `main` file state
- unrelated branch history is not dragged into the work
- implementation stays isolated and reviewable
