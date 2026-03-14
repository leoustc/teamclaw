# Bugs

Bug status values:

- `new`
- `pending`
- `fixed`

## Approval/Hire Issue Status Sync

- Status: `fixed`

- Symptom:
  - A hire ticket is moved to `blocked` while waiting for board approval.
  - The board approves the linked `hire_agent` approval.
  - The requesting Manager wakes up, finishes the hire flow, but the original issue can remain `blocked` instead of moving back into an actionable state and then closing normally.

- Expected:
  - When a linked approval is approved, linked blocked issues should be reopened to `todo` before the requester wakeup runs.
  - The requester can then resume the ticket under the normal checkout flow and complete it cleanly.

- Fix:
  - Approval approval flow should reopen linked blocked issues before queuing the requester wakeup.

## Deferred Reassignment Wake Not Promoted

- Status: `fixed`

- Symptom:
  - A Manager checks out a ticket, reassigns it to Architect, and sets it back to `todo`.
  - Architect does not start work even though the issue is assigned correctly.
  - The issue can remain assigned to Architect with no Architect run attached.

- Expected:
  - When the current run releases issue execution, a deferred wake for the new assignee should be promoted if the issue is still actionable.
  - Reassigned `todo` tickets should wake the Architect normally after the previous assignee run exits.

- Fix:
  - Deferred issue-execution promotion should allow actionable reassigned `todo` issues, not only `in_progress` issues.

## Company Creation Fails On Home Path Resolution

- Status: `fixed`

- Symptom:
  - Creating a company from onboarding returns `Internal server error` on the first step.
  - The company row may be created, but the server fails while creating the company home/project directories.

- Expected:
  - Company creation should use the normalized company name for `$HOME/<company-name>` paths.
  - UUID company ids should remain valid internal ids and should not break filesystem path resolution.

- Fix:
  - Company/project/agent home path helpers should normalize name-based path segments without rejecting UUID ids first.

## Deployed DB Snapshot Missing Latest Migrations

- Status: `fixed`

- Symptom:
  - The systemd service starts and the schema code expects `engineer_headcount`, but the database migration bundle only applies 28 migrations.
  - `GET /api/companies` and `POST /api/companies` fail with `column "engineer_headcount" does not exist`.

- Expected:
  - The deployed DB package should bundle the latest migration files every time `make build` runs.

- Fix:
  - The DB package build must replace `dist/migrations` cleanly before copying migrations, so new migration files are not lost behind a stale existing folder.

## Monitor Reassignment Did Not Wake Architect

- Status: `fixed`

- Symptom:
  - A ticket is reassigned to Architect by the background monitor.
  - The issue shows Architect as assignee, but Architect does not start work.
  - The issue can remain `todo` with the previous assignee's `executionRunId` still attached until that run exits.

- Expected:
  - When the monitor reassigns an actionable issue to Architect, it should also queue an Architect wake.
  - If another run still owns execution, that wake should defer and then promote once the current run releases the issue.

- Fix:
  - The monitor must call the normal heartbeat wakeup path after reassignment instead of only changing the assignee field.

## Manager And Architect Ticket Bounce Loop

- Status: `fixed`

- Symptom:
  - Manager-owned tickets like `default-2`, `default-3`, and `default-4` can bounce back and forth between Manager and Architect.
  - The timer monitor keeps reassigning Manager-owned work to Architect even when the Manager is the correct current owner.
  - This creates repeated wakeups and noisy activity without progressing the workflow cleanly.

- Expected:
  - Explicit handoff instructions should drive Manager -> Architect routing.
  - The timer monitor should only heal stale tickets that are truly unassigned or assigned to a missing agent.
  - Manager-owned tickets should remain with Manager until a real handoff moves them.

- Fix:
  - Remove the timer monitor rule that automatically steals Manager-owned tickets for Architect.
  - Timer monitor now only reassigns issues when there is no assignee or the recorded assignee no longer exists.

## Mixed Manager Plus Technical Ticket Closed Too Early

- Status: `fixed`

- Symptom:
  - A Manager completes the hiring or admin portion of a mixed ticket, leaves a comment that technical design still belongs to Architect, but the original ticket still closes as `done`.
  - The live issue mirror can show the correct Manager comment, while the final monitor action still marks the issue `done`.

- Expected:
  - If a ticket mixes Manager-owned work and technical work, the Manager should split out a new tech-only follow-up ticket for Architect.
  - The original Manager ticket should only close after that technical remainder has been split away.
  - Valid `teamclawIssueHandoffs` returned by the agent must survive gateway result parsing and reach heartbeat/monitor.

- Fix:
  - Strengthen the gateway adapter handoff extraction so embedded handoff JSON is recovered from the full payload as well as the summary text.
  - Update Manager and TeamClaw instructions so mixed tickets are split into a new Architect follow-up ticket before the Manager ticket is proposed `done`.
