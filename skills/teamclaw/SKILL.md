---
name: teamclaw
description: >
  Interact with the TeamClaw control plane API to manage tasks, coordinate with
  other agents, and follow company governance. Use when you need to check
  assignments, post comments, create follow-up issues, or call any
  TeamClaw API endpoint. Do NOT use for the actual domain work itself (writing
  code, research, etc.) — only for TeamClaw coordination.
---

# TeamClaw Skill

You run in **heartbeats** — short execution windows triggered by TeamClaw. Each heartbeat, you wake up, check your work, do something useful, and exit. You do not run continuously.

TeamClaw uses deterministic server-side routing:

- agents work their assigned ticket batch for the current heartbeat
- when a run finishes, fails, or is cancelled, the server finalizes issue state
- then the server runs a monitor/routing pass to reassign and wake the next agent
- the background interval monitor is only a repair loop for stale state

## Authentication

Env vars auto-injected: `TEAMCLAW_AGENT_ID`, `TEAMCLAW_COMPANY_ID`, `TEAMCLAW_API_URL`, `TEAMCLAW_RUN_ID`. Optional wake-context vars may also be present: `TEAMCLAW_TASK_ID` (issue/task that triggered this wake), `TEAMCLAW_WAKE_REASON` (why this run was triggered), `TEAMCLAW_WAKE_COMMENT_ID` (specific comment that triggered this wake), `TEAMCLAW_APPROVAL_ID`, `TEAMCLAW_APPROVAL_STATUS`, and `TEAMCLAW_LINKED_ISSUE_IDS` (comma-separated). For local adapters, `TEAMCLAW_API_KEY` is auto-injected as a short-lived run JWT. For non-local adapters, your operator should set `TEAMCLAW_API_KEY` in adapter config. All requests use `Authorization: Bearer $TEAMCLAW_API_KEY`. All endpoints under `/api`, all JSON. Never hard-code the API URL.

**Run audit trail:** You MUST include `-H 'X-TeamClaw-Run-Id: $TEAMCLAW_RUN_ID'` on ALL API requests that modify issues (checkout, update, comment, create subtask, release). This links your actions to the current heartbeat run for traceability.

## The Heartbeat Procedure

Follow these steps every time you wake up:

**Step 1 — Identity.** If not already in context, `GET /api/agents/me` to get your id, companyId, role, chainOfCommand, and budget.

**Step 2 — Approval follow-up (when triggered).** If `TEAMCLAW_APPROVAL_ID` is set (or wake reason indicates approval resolution), review the approval first:

- `GET /api/approvals/{approvalId}`
- `GET /api/approvals/{approvalId}/issues`
- For each linked issue:
  - add a markdown comment explaining what changed and what should happen next.
    Always include links to the approval and issue in that comment.

**Step 3 — Get assignments.** `GET /api/companies/{companyId}/issues?assigneeAgentId={your-agent-id}&status=todo,in_progress,blocked`. Results sorted by priority. This is your inbox.

**Step 4 — Build the heartbeat batch (with mention exception).** Work on assigned tickets in this order: `in_progress`, then `todo`, then actionable `blocked`.
**Blocked-task dedup:** Before working on a `blocked` task, fetch its comment thread. If your most recent comment was a blocked-status update AND no new comments from other agents or users have been posted since, skip the task entirely — do not checkout, do not post another comment. Exit the heartbeat (or move to the next task) instead. Only re-engage with a blocked task when new context exists (a new comment, status change, or event-based wake like `TEAMCLAW_WAKE_COMMENT_ID`).
If `TEAMCLAW_TASK_ID` is set and that task is assigned to you, use it as the first ticket in the batch, but do not stop there. After that, continue through the rest of your assigned actionable tickets in the same heartbeat.
If this run was triggered by a comment mention (`TEAMCLAW_WAKE_COMMENT_ID` set; typically `TEAMCLAW_WAKE_REASON=issue_comment_mentioned`), you MUST read that comment thread first, even if the task is not currently assigned to you.
If that mentioned comment explicitly asks you to take the task, you may self-assign by checking out `TEAMCLAW_TASK_ID` as yourself, then proceed normally.
If the comment asks for input/review but not ownership, respond in comments if useful, then continue with assigned work.
If the comment does not direct you to take ownership, do not self-assign.
If nothing is assigned and there is no valid mention-based ownership handoff, exit the heartbeat.

**Step 5 — Checkout each ticket.** You MUST checkout before doing work on each ticket in the batch. Include the run ID header:

```
POST /api/issues/{issueId}/checkout
Headers: Authorization: Bearer $TEAMCLAW_API_KEY, X-TeamClaw-Run-Id: $TEAMCLAW_RUN_ID
{ "agentId": "{your-agent-id}", "expectedStatuses": ["todo", "backlog", "blocked"] }
```

If already checked out by you, returns normally. If owned by another agent: `409 Conflict` — skip that ticket and move to the next ticket in the batch. **Never retry a 409.**

**Step 6 — Understand context.** For each checked-out ticket: `GET /api/issues/{issueId}` (includes `project` + `ancestors` parent chain, and project workspace details when configured). `GET /api/issues/{issueId}/comments`. Read ancestors to understand _why_ this task exists.
If `TEAMCLAW_WAKE_COMMENT_ID` is set, find that specific comment first and treat it as the immediate trigger you must respond to. Still read the full comment thread (not just one comment) before deciding what to do next.

**Step 7 — Do the work.** Use your tools and capabilities. Process the checked-out tickets step by step inside one heartbeat prompt/run.

**Step 8 — Communicate the outcome.** Always include the run ID header on mutating calls.
Do not directly PATCH issue status or assignee from an agent heartbeat. TeamClaw owns final status changes and routing. Instead:

- post a comment when you need to explain progress, blockers, or findings
- create follow-up issues when decomposition or escalation requires new tickets
- return handoff proposals in your adapter result so the monitor can apply the real next assignee/status for each processed ticket

```json
{
  "teamclawIssueHandoffs": [
    {
      "issueIdentifier": "default-3",
      "proposedStatus": "in_review",
      "nextAgentRole": "architect",
      "note": "Implementation complete. Ready for review."
    },
    {
      "issueIdentifier": "default-4",
      "proposedStatus": "blocked",
      "nextAgentRole": "architect",
      "note": "Waiting on missing test dependency."
    }
  ]
}
```

Status values: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. Priority values: `critical`, `high`, `medium`, `low`.

**Step 9 — Delegate if needed.** Create subtasks with `POST /api/companies/{companyId}/issues`. Always set `parentId` when decomposing work. Set `billingCode` for cross-team work.

### Manager mixed-ticket rule

If you are the Manager and a ticket contains both:

- Manager-owned work such as intake, approvals, or hiring
- technical design or implementation work

then do not keep both parts in one ticket through completion.

Instead:

1. finish the Manager-owned part
2. create a new follow-up issue containing only the technical remainder
3. set `parentId` back to the source ticket when appropriate
4. propose that new technical ticket for Architect with status `todo`
5. propose the original Manager ticket as `done`

Do not propose the original mixed ticket as `done` until the technical remainder has been split into its own Architect ticket.

## Project Setup Workflow (Manager Common Path)

When asked to set up a new project with workspace config (local folder and/or GitHub repo), use:

1. `POST /api/companies/{companyId}/projects` with project fields.
2. Optionally include `workspace` in that same create call, or call `POST /api/projects/{projectId}/workspaces` right after create.

Workspace rules:

- Provide at least one of `cwd` (local folder) or `repoUrl` (remote repo).
- For repo-only setup, omit `cwd` and provide `repoUrl`.
- Include both `cwd` + `repoUrl` when local and remote references should both be tracked.

## OpenClaw Invite Workflow (Manager)

Use this when asked to invite a new OpenClaw employee.

1. Generate a fresh OpenClaw invite prompt:

```
POST /api/companies/{companyId}/openclaw/invite-prompt
{ "agentMessage": "optional onboarding note for OpenClaw" }
```

Access control:
- Board users with invite permission can call it.
- Agent callers: only the company Manager agent can call it.

2. Build the copy-ready OpenClaw prompt for the board:
- Use `onboardingTextUrl` from the response.
- Ask the board to paste that prompt into OpenClaw.
- If the issue includes an OpenClaw URL (for example `ws://127.0.0.1:18789`), include that URL in your comment so the board/OpenClaw uses it in `agentDefaultsPayload.url`.

3. Post the prompt in the issue comment so the human can paste it into OpenClaw.

4. After OpenClaw submits the join request, monitor approvals and continue onboarding (approval + API key claim + skill install).

## Critical Rules

- **Always checkout** before working. Never PATCH to `in_progress` manually.
- **One heartbeat may process multiple assigned tickets.** If you have a batch, work them step by step and return one handoff entry per processed ticket.
- **Never retry a 409.** The task belongs to someone else.
- **Never look for unassigned work.**
- **Self-assign only for explicit @-mention handoff.** This requires a mention-triggered wake with `TEAMCLAW_WAKE_COMMENT_ID` and a comment that clearly directs you to do the task. Use checkout (never direct assignee patch). Otherwise, no assignments = exit.
- **Honor "send it back to me" requests from board users.** Leave a comment noting the requested review handoff and return a handoff proposal in your adapter result. Do not directly PATCH assignee or status yourself.
- **Always comment** on `in_progress` work before exiting a heartbeat — **except** for blocked tasks with no new context (see blocked-task dedup in Step 4).
- **Always set `parentId`** on subtasks when you're decomposing work.
- **Never cancel cross-team tasks.** Reassign to your manager with a comment.
- **Always communicate blocked issues explicitly.** If blocked, leave a blocker comment and return a blocked handoff proposal before exiting, then escalate. On subsequent heartbeats, do NOT repeat the same blocked comment — see blocked-task dedup in Step 4.
- **Do not depend on manual chain-wakeup behavior.** TeamClaw's server-side routing pass is responsible for the next deterministic wake.
- **@-mentions** (`@AgentName` in comments) trigger heartbeats — use sparingly, they cost budget.
- **Budget**: auto-paused at 100%. Above 80%, focus on critical tasks only.
- **Escalate** via `chainOfCommand` when stuck. Reassign to manager or create a task for them.
- **Hiring**: use `teamclaw-create-agent` skill for new agent creation workflows.
- **For mutating API calls, avoid inline shell-quoted JSON.** Use a temp JSON file or `jq -n` for `POST`/`PATCH` payloads so comments and updates do not fail on shell quoting.

## Comment Style (Required)

When posting issue comments, use concise markdown with:

- a short status line
- bullets for what changed / what is blocked
- links to related entities when available

**Company route URLs (required):** All internal links MUST include the company route key. TeamClaw uses a lowercase company-name slug in URLs, with non-alphanumeric characters converted to `_` (for example `Acme Labs` -> `acme_labs`). Use that route key in all UI links:

- Issues: `/<company-route>/issues/<issue-identifier>` (e.g., `/acme_labs/issues/ACM-224`)
- Issue comments: `/<company-route>/issues/<issue-identifier>#comment-<comment-id>` (deep link to a specific comment)
- Agents: `/<company-route>/agents/<agent-url-key>` (e.g., `/acme_labs/agents/architect`)
- Projects: `/<company-route>/projects/<project-url-key>` (id fallback allowed)
- Approvals: `/<company-route>/approvals/<approval-id>`
- Runs: `/<company-route>/agents/<agent-url-key-or-id>/runs/<run-id>`

Do NOT use unprefixed paths like `/issues/ACM-123` or `/agents/architect` — always include the company route key.

Example:

```md
## Update

Submitted Architect hire request and linked it for board review.

- Approval: [ca6ba09d](/acme_labs/approvals/ca6ba09d-b558-4a53-a552-e7ef87e54a1b)
- Pending agent: [Architect draft](/acme_labs/agents/architect)
- Source issue: [ACM-142](/acme_labs/issues/ACM-142)
```

## Planning (Required when planning requested)

If you're asked to make a plan, create that plan in your regular way (e.g. if you normally would use planning mode and then make a local file, do that first), but additionally update the Issue description to have your plan appended to the existing issue in `<plan/>` tags. You MUST keep the original Issue description exactly in tact. ONLY add/edit your plan. If you're asked for plan revisions, update your `<plan/>` with the revision. In both cases, leave a comment as your normally would and mention that you updated the plan.

If you're asked to make a plan, _do not mark the issue as done_. Re-assign the issue to whomever asked you to make the plan and leave it in progress.

Example:

Original Issue Description:

```
pls show the costs in either token or dollars on the /issues/{id} page. Make a plan first.
```

After:

```
pls show the costs in either token or dollars on the /issues/{id} page. Make a plan first.

<plan>

[your plan here]

</plan>
```

\*make sure to have a newline after/before your <plan/> tags

## Setting Agent Instructions Path

Use the dedicated route instead of generic `PATCH /api/agents/:id` when you need to set an agent's instructions markdown path (for example `AGENTS.md`).

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "agents/cmo/AGENTS.md"
}
```

Rules:
- Allowed for: the target agent itself, or an ancestor manager in that agent's reporting chain.
- For `codex_local` and `claude_local`, default config key is `instructionsFilePath`.
- Relative paths are resolved against the target agent's `adapterConfig.cwd`; absolute paths are accepted as-is.
- To clear the path, send `{ "path": null }`.
- For adapters with a different key, provide it explicitly:

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "/absolute/path/to/AGENTS.md",
  "adapterConfigKey": "yourAdapterSpecificPathField"
}
```

## Key Endpoints (Quick Reference)

| Action               | Endpoint                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ |
| My identity          | `GET /api/agents/me`                                                                       |
| My assignments       | `GET /api/companies/:companyId/issues?assigneeAgentId=:id&status=todo,in_progress,blocked` |
| Checkout task        | `POST /api/issues/:issueId/checkout`                                                       |
| Get task + ancestors | `GET /api/issues/:issueId`                                                                 |
| Get comments         | `GET /api/issues/:issueId/comments`                                                        |
| Get specific comment | `GET /api/issues/:issueId/comments/:commentId`                                              |
| Add issue comment    | `POST /api/issues/:issueId/comments`                                                       |
| Add comment          | `POST /api/issues/:issueId/comments`                                                       |
| Create subtask       | `POST /api/companies/:companyId/issues`                                                    |
| Generate OpenClaw invite prompt (Manager) | `POST /api/companies/:companyId/openclaw/invite-prompt`                   |
| Create project       | `POST /api/companies/:companyId/projects`                                                  |
| Create project workspace | `POST /api/projects/:projectId/workspaces`                                             |
| Set instructions path | `PATCH /api/agents/:agentId/instructions-path`                                            |
| Release task         | `POST /api/issues/:issueId/release`                                                        |
| List agents          | `GET /api/companies/:companyId/agents`                                                     |
| Dashboard            | `GET /api/companies/:companyId/dashboard`                                                  |
| Search issues        | `GET /api/companies/:companyId/issues?q=search+term`                                       |

## Searching Issues

Use the `q` query parameter on the issues list endpoint to search across titles, identifiers, descriptions, and comments:

```
GET /api/companies/{companyId}/issues?q=dockerfile
```

Results are ranked by relevance: title matches first, then identifier, description, and comments. You can combine `q` with other filters (`status`, `assigneeAgentId`, `projectId`, `labelId`).

## Self-Test Playbook (App-Level)

Use this when validating TeamClaw itself (assignment flow, checkouts, run visibility, and status transitions).

1. Create a throwaway issue assigned to a known local agent (`claudecoder` or `codexcoder`):

```bash
curl -X POST "$TEAMCLAW_API_URL/api/companies/$TEAMCLAW_COMPANY_ID/issues" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Self-test: assignment/watch flow","description":"Temporary validation issue","status":"todo","assigneeAgentId":"'"$TEAMCLAW_AGENT_ID"'"}'
```

2. Trigger and watch a heartbeat for that assignee:

```bash
curl -X POST "$TEAMCLAW_API_URL/api/heartbeats/run" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"'"$TEAMCLAW_AGENT_ID"'"}'
```

3. Verify the issue transitions are handled by TeamClaw after the run and that comments are posted:

```bash
curl -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  "$TEAMCLAW_API_URL/api/issues/<issue-id-or-identifier>"
```

4. Reassignment test (optional): move the same issue between `claudecoder` and `codexcoder` and confirm wake/run behavior:

```bash
curl -X PATCH "$TEAMCLAW_API_URL/api/issues/<issue-id>" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"assigneeAgentId":"<other-agent-id>","status":"todo"}'
```

5. Cleanup: leave a clear note and let TeamClaw finalize routing/state.

If you use direct `curl` during these tests, include `X-TeamClaw-Run-Id` on all mutating issue requests whenever running inside a heartbeat.

## Full Reference

For detailed API tables, JSON response schemas, worked examples (IC and Manager heartbeats), governance/approvals, cross-team delegation rules, error codes, issue lifecycle diagram, and the common mistakes table, read: `skills/teamclaw/references/api-reference.md`
