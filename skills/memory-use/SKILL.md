---
name: memory-use
description: >
  Use the local agent workspace memory model. Store durable hot memory in the
  agent `memory/` folder, use `notes/` for daily records and task-local notes,
  and keep both folders updated as work progresses.
---

# Memory Use Skill

Use this skill when the task involves saving, updating, or organizing agent-local memory.

This skill is for the TeamClaw agent workspace layout:

- `$HOME/<company-name>/agents/<agent-folder>/memory`
- `$HOME/<company-name>/agents/<agent-folder>/notes`

## Core Rule

Use the two folders differently:

- `memory/` is for durable hot memory that should persist across tickets
- `notes/` is for daily records, working notes, temporary checklists, and task-level scratch files

Do not mix long-term memory and day-by-day notes into the same file.

## When to Use

Use this skill for requests like:

- "save this for later"
- "write down what happened today"
- "record implementation notes"
- "keep a local memory for this agent"
- "update the agent notes"

## Workflow

1. Identify the current agent workspace.
2. Write durable facts, stable context, recurring constraints, and important carry-forward knowledge into `memory/`.
3. Write daily progress, debugging logs, ticket-by-ticket notes, and temporary working context into `notes/`.
4. Update existing files instead of scattering duplicate fragments across many files.
5. Keep file names simple and inspectable.

## Content Guidance

Put these in `memory/`:

- stable project/domain knowledge
- recurring environment facts
- durable operator preferences
- important architectural constraints
- role-specific long-term working context

Put these in `notes/`:

- daily logs
- per-ticket working notes
- debugging timelines
- temporary checklists
- short-lived scratch context

## Folder Hygiene

- keep both folders present in every local agent workspace
- prefer updating the most relevant existing file instead of creating noise
- delete or consolidate obsolete temporary notes when they stop being useful
- keep durable memory concise and high-signal

## Quality Bar

- durable knowledge is easy to find in `memory/`
- daily/task records are easy to find in `notes/`
- the folder structure stays clean and predictable
- memory files help the next wake, not confuse it
