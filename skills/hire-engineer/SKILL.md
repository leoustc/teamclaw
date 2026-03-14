---
name: hire-engineer
description: >
  Hire an Engineer in TeamClaw. Use this when an Architect or Manager needs to
  add implementation capacity, choose the right engineer role fit, check
  headcount, and then execute the hire through the standard TeamClaw agent
  creation flow.
---

# Hire Engineer Skill

Use this skill when the task is specifically about hiring an Engineer.

This skill sits above `teamclaw-create-agent`:

- use this skill to decide whether an Engineer should be hired
- use this skill to choose the right engineer role, reporting line, and workspace intent
- then use `teamclaw-create-agent` to perform the actual hire request

## Core Rule

Do not hire a generic Engineer without checking whether the work actually needs a new engineer and whether an existing engineer already fits the role.

Architect-driven hiring should follow the company workflow:

1. analyze the ticket
2. decide whether an existing Engineer fits
3. if not, request Engineer hiring from the Manager
4. let the Manager execute the actual create-agent flow
5. assign the resulting execution ticket once the engineer path is clear

## When to Use

Use this skill for requests like:

- "hire an engineer"
- "we need another engineer"
- "no engineer fits this ticket"
- "add frontend/backend/devops engineer"
- "architect should hire implementation help"

## Workflow

1. Read the triggering ticket and identify the actual implementation gap.
2. Check current engineers in the company and see whether one already fits the work.
3. Decide the intended engineer role shape:
   - general engineer
   - frontend engineer
   - backend engineer
   - infra/devops engineer
   - other concrete implementation specialization
4. Check whether the company headcount policy allows the hire.
5. Define:
   - engineer name
   - role
   - title
   - reportsTo
   - capabilities
   - adapter choice
   - local workspace path expectation
   - role scope and expectations for this specific engineer
   - for Engineers, `reportsTo` should normally be the Architect
6. If you are the Manager, use `teamclaw-create-agent` to submit the hire.
7. If you are the Architect, prepare the recommendation and hand the actual hire to the Manager.
8. After create or approval, verify the local workspace is initialized correctly.
9. The new Engineer should start with a short workspace initialization task before normal implementation work.

## Headcount Rule

Engineer headcount applies only to Engineers.

It does not include:

- Manager
- Architect

Architect-requested Engineer hires may auto-approve when the company is still under its configured engineer headcount.

## Workspace Rule

The Engineer workspace should live under:

- `$HOME/<company-name>/agents/<agent-folder>`

Expected initialized contents:

- `AGENTS.md`
- `HEARTBEAT.md`
- `SOUL.md`
- `TOOLS.md`
- `memory/`
- `notes/`

Role-pack rule:

- start from the bundled system role markdown files for the relevant engineer role
- then update the per-agent local markdown files in that engineer workspace with:
  - the exact scope
  - specialty
  - boundaries
  - expectations
  - project or domain focus

Do not leave a specialized engineer with only a generic template if the hire request already defines a concrete specialization.

Folder naming:

- always use `role_name`
- examples: `engineer_alpha`, `manager_manager`, `architect_architect`

## Quality Bar

- the hire is tied to a real ticket or execution need
- the engineer role matches the actual implementation gap
- an existing engineer is reused when appropriate
- reporting line is clear
- engineer hires report to the Architect unless there is an explicit exception
- the local workspace path is correct
- the workspace is initialized after create/approval
- the new Engineer has a clear initial workspace setup task
- the per-agent markdown files are updated to reflect the hired engineer's real scope and specialty
- the resulting implementation ticket can be assigned immediately

## Required Companion Skill

After the hiring decision is clear, use:

- [teamclaw-create-agent](/home/ubuntu/teamclaw/skills/teamclaw-create-agent/SKILL.md)

This skill does not replace the generic TeamClaw hire flow. It narrows and structures it for Engineer hiring.
