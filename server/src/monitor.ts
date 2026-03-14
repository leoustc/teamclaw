import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@teamclawai/db";
import { agents, companies, issues } from "@teamclawai/db";
import { logger } from "./middleware/logger.js";
import { issueService } from "./services/issues.js";
import { logActivity } from "./services/activity-log.js";

const MONITORED_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

type WakeupFn = (
  agentId: string,
  opts: {
    source?: "timer" | "assignment" | "on_demand" | "automation";
    triggerDetail?: "manual" | "ping" | "callback" | "system";
    reason?: string | null;
    payload?: Record<string, unknown> | null;
    requestedByActorType?: "user" | "agent" | "system";
    requestedByActorId?: string | null;
    contextSnapshot?: Record<string, unknown>;
  },
) => Promise<unknown>;

type MonitorResult = {
  companiesChecked: number;
  issuesReassigned: number;
};

export type MonitorIssueInstruction = {
  issueId?: string | null;
  issueIdentifier?: string | null;
  nextAgentId?: string | null;
  nextAgentName?: string | null;
  nextAgentRole?: string | null;
  fallbackAgentRole?: string | null;
  proposedStatus?: "todo" | "in_progress" | "in_review" | "blocked" | "done" | null;
  note?: string | null;
};

async function findAvailableAgent(
  db: Db,
  input: { companyId: string; id?: string | null; name?: string | null; role?: string | null },
) {
  if (input.id) {
    const byId = await db
      .select({ id: agents.id, name: agents.name, role: agents.role })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, input.companyId),
          eq(agents.id, input.id),
          inArray(agents.status, ["active", "idle", "running", "error"]),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (byId) return byId;
  }

  if (input.name) {
    const byName = await db
      .select({ id: agents.id, name: agents.name, role: agents.role })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, input.companyId),
          eq(agents.name, input.name),
          inArray(agents.status, ["active", "idle", "running", "error"]),
        ),
      )
      .orderBy(desc(agents.createdAt))
      .then((rows) => rows[0] ?? null);
    if (byName) return byName;
  }

  if (input.role) {
    const byRole = await db
      .select({ id: agents.id, name: agents.name, role: agents.role })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, input.companyId),
          eq(agents.role, input.role),
          inArray(agents.status, ["active", "idle", "running", "error"]),
        ),
      )
      .orderBy(desc(agents.createdAt))
      .then((rows) => rows[0] ?? null);
    if (byRole) return byRole;
  }

  return null;
}

async function wakeAssignedIssue(
  issue: {
    id: string;
    identifier: string | null;
    companyId: string;
    status: string;
    assigneeAgentId: string | null;
    executionRunId: string | null;
  },
  assigneeName: string | null,
  wakeup?: WakeupFn,
) {
  if (
    !wakeup ||
    !issue.assigneeAgentId ||
    issue.executionRunId ||
    issue.status === "blocked" ||
    issue.status === "done" ||
    issue.status === "cancelled"
  ) return;
  await wakeup(issue.assigneeAgentId, {
    source: "assignment",
    triggerDetail: "system",
    reason: "issue_assigned",
    requestedByActorType: "system",
    requestedByActorId: "issue-monitor",
    contextSnapshot: {
      issueId: issue.id,
      taskId: issue.id,
      taskKey: issue.id,
      wakeReason: "issue_assigned",
      wakeSource: "assignment",
      wakeTriggerDetail: "system",
    },
    payload: {
      issueId: issue.id,
      taskId: issue.id,
      taskKey: issue.id,
    },
  });
  logger.info(
    {
      companyId: issue.companyId,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeName,
    },
    "issue monitor woke assigned agent",
  );
}

async function applyMonitorInstruction(
  db: Db,
  issuesSvc: ReturnType<typeof issueService>,
  companyId: string,
  instruction: MonitorIssueInstruction,
  wakeup?: WakeupFn,
) {
  const issue = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      companyId: issues.companyId,
      status: issues.status,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
      executionRunId: issues.executionRunId,
    })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        instruction.issueId
          ? eq(issues.id, instruction.issueId)
          : eq(issues.identifier, instruction.issueIdentifier ?? ""),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!issue || issue.assigneeUserId) return false;

  const proposedStatus = instruction.proposedStatus ?? "done";
  let targetAssignee =
    (await findAvailableAgent(db, {
      companyId,
      id: instruction.nextAgentId,
      name: instruction.nextAgentName,
      role: instruction.nextAgentRole,
    })) ??
    (proposedStatus !== "done"
      ? await findAvailableAgent(db, {
          companyId,
          role: instruction.fallbackAgentRole ?? "architect",
        })
      : null);
  if (!targetAssignee && proposedStatus !== "done" && issue.assigneeAgentId) {
    targetAssignee = await findAvailableAgent(db, { companyId, id: issue.assigneeAgentId });
  }

  const resolvedStatus =
    proposedStatus === "done" && !targetAssignee
      ? "done"
      : proposedStatus === "done" && targetAssignee
        ? targetAssignee.role === "architect"
          ? "in_review"
          : "todo"
        : proposedStatus;
  const preservedAssignee =
    resolvedStatus === "done" && issue.assigneeAgentId
      ? await findAvailableAgent(db, { companyId, id: issue.assigneeAgentId })
      : null;
  const finalAssigneeId =
    resolvedStatus === "done"
      ? preservedAssignee?.id ?? issue.assigneeAgentId ?? null
      : targetAssignee?.id ?? null;
  const finalAssigneeRole =
    resolvedStatus === "done"
      ? preservedAssignee?.role ?? null
      : targetAssignee?.role ?? null;
  const finalAssigneeName =
    resolvedStatus === "done"
      ? preservedAssignee?.name ?? null
      : targetAssignee?.name ?? null;

  const updated = await issuesSvc.update(issue.id, {
    status: resolvedStatus,
    assigneeAgentId: finalAssigneeId,
    assigneeUserId: null,
  });
  if (!updated) return false;

  await logActivity(db, {
    companyId,
    actorType: "system",
    actorId: "issue-monitor",
    action: "issue.monitor.handoff_applied",
    entityType: "issue",
    entityId: issue.id,
    details: {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      receivedIssueRef: instruction.issueIdentifier ?? instruction.issueId ?? issue.identifier ?? issue.id,
      receivedProposedStatus: proposedStatus,
      receivedNextAgentId: instruction.nextAgentId ?? null,
      receivedNextAgentName: instruction.nextAgentName ?? null,
      receivedNextAgentRole: instruction.nextAgentRole ?? null,
      previousStatus: issue.status,
      nextStatus: updated.status,
      nextAgentId: updated.assigneeAgentId,
      nextAgentRole: finalAssigneeRole,
      nextAgentName: finalAssigneeName,
      proposedStatus,
      appliedAction:
        updated.status === "done"
          ? `updated ticket ${updated.identifier ?? updated.id} status to done`
          : `updated ticket ${updated.identifier ?? updated.id} status to ${updated.status} and assigned to ${finalAssigneeName ?? finalAssigneeRole ?? finalAssigneeId ?? "none"}`,
      note: instruction.note ?? null,
    },
  });

  const statusTransition = `${issue.status} -> ${updated.status}`;
  const monitorComment =
    updated.status === "done"
      ? `TeamClaw monitor applied: status ${statusTransition}`
      : `TeamClaw monitor applied: status ${statusTransition}, assignee -> ${finalAssigneeName ?? finalAssigneeRole ?? finalAssigneeId ?? "none"}`;
  await issuesSvc.addComment(issue.id, monitorComment, {});

  await wakeAssignedIssue(
    {
      id: updated.id,
      identifier: updated.identifier,
      companyId: updated.companyId,
      status: updated.status,
      assigneeAgentId: updated.assigneeAgentId,
      executionRunId: updated.executionRunId,
    },
    finalAssigneeName,
    wakeup,
  );
  return true;
}

export async function runIssueMonitor(
  db: Db,
  opts?: {
    companyId?: string | null;
    wakeup?: WakeupFn;
    instruction?: MonitorIssueInstruction | null;
    source?: "heartbeat" | "scheduler" | "timer";
  },
): Promise<MonitorResult> {
  const issuesSvc = issueService(db);
  const allCompanies = opts?.companyId
    ? await db.select({ id: companies.id }).from(companies).where(eq(companies.id, opts.companyId))
    : await db.select({ id: companies.id }).from(companies);

  let issuesReassigned = 0;

  for (const company of allCompanies) {
    const companyIssuesReassignedBefore = issuesReassigned;
    if (opts?.instruction && opts.companyId === company.id) {
      await applyMonitorInstruction(db, issuesSvc, company.id, opts.instruction, opts.wakeup);
    }

    const manager = await db
      .select({
        id: agents.id,
        name: agents.name,
      })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, company.id),
          eq(agents.role, "manager"),
          inArray(agents.status, ["idle", "running"]),
        ),
      )
      .orderBy(asc(agents.createdAt), asc(agents.id))
      .then((rows) => rows[0] ?? null);

    const architect = await db
      .select({
        id: agents.id,
        name: agents.name,
      })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, company.id),
          eq(agents.role, "architect"),
          inArray(agents.status, ["idle", "running"]),
        ),
      )
      .orderBy(asc(agents.createdAt), asc(agents.id))
      .then((rows) => rows[0] ?? null);

    const candidateIssues = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, company.id),
          inArray(issues.status, [...MONITORED_STATUSES]),
          isNull(issues.hiddenAt),
        ),
      );

    for (const issue of candidateIssues) {
      if (issue.assigneeUserId) continue;

      let targetAssigneeId = issue.assigneeAgentId;
      let targetAssigneeName: string | null =
        issue.assigneeAgentId === manager?.id
          ? manager.name
          : issue.assigneeAgentId === architect?.id
            ? architect.name
            : null;
      let shouldReassign = false;
      if (!issue.assigneeAgentId) {
        const fallbackAssignee = manager ?? architect;
        if (fallbackAssignee) {
          shouldReassign = true;
          targetAssigneeId = fallbackAssignee.id;
          targetAssigneeName = fallbackAssignee.name;
        }
      } else {
        const assignee = await db
          .select({
            id: agents.id,
            name: agents.name,
            role: agents.role,
          })
          .from(agents)
          .where(eq(agents.id, issue.assigneeAgentId))
          .then((rows) => rows[0] ?? null);

        if (!assignee) {
          const fallbackAssignee = manager ?? architect;
          if (fallbackAssignee) {
            shouldReassign = true;
            targetAssigneeId = fallbackAssignee.id;
            targetAssigneeName = fallbackAssignee.name;
          }
        } else {
          targetAssigneeId = assignee.id;
          targetAssigneeName = assignee.name;
        }
      }

      let updatedIssue = issue;
      if (shouldReassign && targetAssigneeId) {
        const updated = await issuesSvc.update(issue.id, {
          assigneeAgentId: targetAssigneeId,
          assigneeUserId: null,
          status: issue.status === "backlog" ? "todo" : issue.status,
        });
        if (!updated) continue;
        updatedIssue = {
          ...updatedIssue,
          status: updated.status,
          assigneeAgentId: updated.assigneeAgentId,
        };
        issuesReassigned += 1;
        await logActivity(db, {
          companyId: company.id,
          actorType: "system",
          actorId: "issue-monitor",
          action: "issue.monitor.reassigned",
          entityType: "issue",
          entityId: issue.id,
          details: {
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            previousStatus: issue.status,
            nextStatus: updated.status,
            nextAgentId: targetAssigneeId,
            nextAgentName: targetAssigneeName,
          },
        });
      }

      await wakeAssignedIssue(
        {
          id: issue.id,
          identifier: issue.identifier,
          companyId: company.id,
          status: updatedIssue.status,
          assigneeAgentId: targetAssigneeId,
          executionRunId: updatedIssue.executionRunId,
        },
        targetAssigneeName,
        opts?.wakeup,
      );
    }

    const companyIssuesReassigned = issuesReassigned - companyIssuesReassignedBefore;
    void companyIssuesReassigned;
  }

  return {
    companiesChecked: allCompanies.length,
    issuesReassigned,
  };
}

export function startIssueMonitor(db: Db, intervalMs: number, wakeup?: WakeupFn) {
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await runIssueMonitor(db, { wakeup, source: "timer" });
      if (result.issuesReassigned > 0) {
        logger.info(result, "issue monitor reassigned unowned work");
      }
    } catch (err) {
      logger.error({ err }, "issue monitor tick failed");
    } finally {
      inFlight = false;
    }
  };

  void tick();
  return setInterval(() => {
    void tick();
  }, intervalMs);
}
