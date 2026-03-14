import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@teamclawai/db";
import { issues } from "@teamclawai/db";
import type { AgentRole } from "@teamclawai/shared";
import { issueService } from "./services/issues.js";

const INITIAL_SETUP_TICKETS: Partial<Record<AgentRole, { title: string; description: string }>> = {
  architect: {
    title: "Initialize your Architect workspace",
    description:
      "Verify that AGENTS.md, HEARTBEAT.md, SOUL.md, TOOLS.md, notes/, and memory/ exist in your local Architect workspace. Make only the minimal role-specific adjustments needed, then finish this setup task before moving into backlog analysis and decomposition work.",
  },
};

export async function ensureInitialAgentSetupIssue(
  db: Db,
  input: {
    companyId: string;
    agentId: string;
    role: string | null | undefined;
  },
) {
  const role = (input.role ?? "").toLowerCase() as AgentRole;
  const template = INITIAL_SETUP_TICKETS[role];
  if (!template) return null;

  const existing = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, input.companyId),
        eq(issues.assigneeAgentId, input.agentId),
        eq(issues.title, template.title),
        inArray(issues.status, ["backlog", "todo", "in_progress", "in_review", "blocked"]),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (existing) return existing;

  const issuesSvc = issueService(db);
  return issuesSvc.create(input.companyId, {
    title: template.title,
    description: template.description,
    status: "todo",
    priority: "medium",
    assigneeAgentId: input.agentId,
    assigneeUserId: null,
    parentId: null,
    goalId: null,
    projectId: null,
    createdByAgentId: null,
    createdByUserId: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceSettings: null,
    hiddenAt: null,
    labelIds: [],
  });
}
