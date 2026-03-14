---
name: teamclaw-create-agent
description: >
  Create new agents in TeamClaw with governance-aware hiring. Use when you need
  to inspect adapter configuration options, compare existing agent configs,
  draft a new agent prompt/config, and submit a hire request.
---

# TeamClaw Create Agent Skill

Use this skill when you are asked to hire/create an agent.

## Preconditions

You need either:

- board access, or
- agent permission `can_create_agents=true` in your company

If you do not have this permission, escalate to your Manager or board.

TeamClaw hiring is for a practical ticketing workflow. New agents should fit the human-plus-agent delivery model: clear role, clear reporting line, clear workspace, and a concrete purpose in the active project/ticket system.

## Workflow

1. Confirm identity and company context.

```sh
curl -sS "$TEAMCLAW_API_URL/api/agents/me" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

2. Discover available adapter configuration docs for this TeamClaw instance.

```sh
curl -sS "$TEAMCLAW_API_URL/llms/agent-configuration.txt" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

3. Read adapter-specific docs (example: `claude_local`).

```sh
curl -sS "$TEAMCLAW_API_URL/llms/agent-configuration/claude_local.txt" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

4. Compare existing agent configurations in your company.

```sh
curl -sS "$TEAMCLAW_API_URL/api/companies/$TEAMCLAW_COMPANY_ID/agent-configurations" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

5. Discover allowed agent icons and pick one that matches the role.

```sh
curl -sS "$TEAMCLAW_API_URL/llms/agent-icons.txt" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

6. Draft the new hire config:
- role/title/name
- icon (required in practice; use one from `/llms/agent-icons.txt`)
- reporting line (`reportsTo`)
- adapter type
- adapter and runtime config aligned to this environment
- capabilities
- run prompt in adapter config (`promptTemplate` where applicable)
- source issue linkage (`sourceIssueId` or `sourceIssueIds`) when this hire came from an issue

For Engineer hires:
- the Manager should own the final create-agent action
- `reportsTo` should normally point to the Architect for that company

7. Submit hire request.

```sh
curl -sS -X POST "$TEAMCLAW_API_URL/api/companies/$TEAMCLAW_COMPANY_ID/agent-hires" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Architect",
    "role": "architect",
    "title": "Architect",
    "icon": "crown",
    "reportsTo": "<manager-agent-id>",
    "capabilities": "Owns technical roadmap, architecture, staffing, execution",
    "adapterType": "codex_local",
    "adapterConfig": {"cwd": "/abs/path/to/repo", "model": "o4-mini"},
    "runtimeConfig": {"heartbeat": {"enabled": true, "intervalSec": 300, "wakeOnDemand": true}},
    "sourceIssueId": "<issue-id>"
  }'
```

8. Handle governance state:
- if response has `approval`, hire is `pending_approval`
- monitor and discuss on approval thread
- when the board approves, you will be woken with `TEAMCLAW_APPROVAL_ID`; read linked issues and close/comment follow-up

```sh
curl -sS "$TEAMCLAW_API_URL/api/approvals/<approval-id>" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"

curl -sS -X POST "$TEAMCLAW_API_URL/api/approvals/<approval-id>/comments" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"## Architect hire request submitted\n\n- Approval: [<approval-id>](/<company-route>/approvals/<approval-id>)\n- Pending agent: [<agent-ref>](/<company-route>/agents/<agent-url-key-or-id>)\n- Source issue: [<issue-ref>](/<company-route>/issues/<issue-identifier-or-id>)\n\nUpdated prompt and adapter config per board feedback."}'
```

If the approval already exists and needs manual linking to the issue:

```sh
curl -sS -X POST "$TEAMCLAW_API_URL/api/issues/<issue-id>/approvals" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"approvalId":"<approval-id>"}'
```

After approval is granted, run this follow-up loop:

```sh
curl -sS "$TEAMCLAW_API_URL/api/approvals/$TEAMCLAW_APPROVAL_ID" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"

curl -sS "$TEAMCLAW_API_URL/api/approvals/$TEAMCLAW_APPROVAL_ID/issues" \
  -H "Authorization: Bearer $TEAMCLAW_API_KEY"
```

For each linked issue, either:
- close it if approval resolved the request, or
- comment in markdown with links to the approval and next actions.

9. Verify local workspace initialization.

Every local agent should have a company-scoped workspace under:

- `$HOME/<company-name>/agents/<agent-folder>`

After create or after approval, verify the workspace exists and is initialized with:

- `AGENTS.md`
- `HEARTBEAT.md`
- `SOUL.md`
- `TOOLS.md`
- `memory/`
- `notes/`

Use the standard `role_name` form, for example:

- `engineer_alpha`
- `manager_manager`
- `architect_architect`

Do not consider the hire complete until this local workspace is present and initialized correctly.

## Quality Bar

Before sending a hire request:

- Reuse proven config patterns from related agents where possible.
- Set a concrete `icon` from `/llms/agent-icons.txt` so the new hire is identifiable in org and task views.
- Avoid secrets in plain text unless required by adapter behavior.
- Ensure reporting line is correct and in-company.
- For Engineer hires, default the reporting line to the Architect unless the workflow explicitly requires something else.
- Ensure prompt is role-specific and operationally scoped.
- Ensure the target local workspace path is correct before hire creation.
- If board requests revision, update payload and resubmit through approval flow.
- After create/approval, verify the role files plus `memory/` and `notes/` exist in the local workspace.

For endpoint payload shapes and full examples, read:
`skills/teamclaw-create-agent/references/api-reference.md`
