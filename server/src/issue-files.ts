import fs from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@teamclawai/db";
import { agents, companies, heartbeatRuns, issueComments, issues } from "@teamclawai/db";
import { resolveDefaultCompanyHomeDir } from "./home-paths.js";

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeIssueFileName(identifier: string | null | undefined, fallbackId: string): string {
  const base = (identifier ?? fallbackId).trim();
  return `${base.replace(/[^A-Za-z0-9._-]+/g, "_")}.md`;
}

function normalizeExcerpt(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function syncIssueHistoryFile(db: Db, issueId: string) {
  const issue = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      priority: issues.priority,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
      projectId: issues.projectId,
      parentId: issues.parentId,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .then((rows) => rows[0] ?? null);
  if (!issue) return;

  const company = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, issue.companyId))
    .then((rows) => rows[0] ?? null);

  const assigneeAgent = issue.assigneeAgentId
    ? await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, issue.assigneeAgentId))
        .then((rows) => rows[0] ?? null)
    : null;

  const comments = await db
    .select({
      id: issueComments.id,
      body: issueComments.body,
      authorAgentId: issueComments.authorAgentId,
      authorUserId: issueComments.authorUserId,
      createdAt: issueComments.createdAt,
    })
    .from(issueComments)
    .where(eq(issueComments.issueId, issueId))
    .orderBy(asc(issueComments.createdAt));

  const runs = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      createdAt: heartbeatRuns.createdAt,
      startedAt: heartbeatRuns.startedAt,
      finishedAt: heartbeatRuns.finishedAt,
      error: heartbeatRuns.error,
      stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
      stderrExcerpt: heartbeatRuns.stderrExcerpt,
      agentName: agents.name,
      agentId: heartbeatRuns.agentId,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .where(
      sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
    )
    .orderBy(desc(heartbeatRuns.createdAt));

  const rootDir = resolveDefaultCompanyHomeDir(issue.companyId, company?.name);
  const issuesDir = path.resolve(rootDir, "issues");
  await fs.mkdir(issuesDir, { recursive: true });

  const lines = [
    `# ${issue.identifier ?? issue.id} ${issue.title}`,
    "",
    "## Metadata",
    "",
    `- Status: ${issue.status}`,
    `- Priority: ${issue.priority}`,
    `- Assignee Agent: ${assigneeAgent?.name ?? issue.assigneeAgentId ?? ""}`,
    `- Assignee User: ${issue.assigneeUserId ?? ""}`,
    `- Project ID: ${issue.projectId ?? ""}`,
    `- Parent ID: ${issue.parentId ?? ""}`,
    `- Created At: ${formatDate(issue.createdAt)}`,
    `- Updated At: ${formatDate(issue.updatedAt)}`,
    "",
    "## Description",
    "",
    issue.description?.trim() ? issue.description : "_No description_",
    "",
    "## Comments",
    "",
  ];

  if (comments.length === 0) {
    lines.push("_No comments_");
  } else {
    for (const comment of comments) {
      const author = comment.authorAgentId ?? comment.authorUserId ?? "system";
      lines.push(`### ${formatDate(comment.createdAt)} ${author}`);
      lines.push("");
      lines.push(comment.body);
      lines.push("");
    }
  }

  lines.push("");
  lines.push("## Agent Output");
  lines.push("");

  if (runs.length === 0) {
    lines.push("_No agent runs recorded_");
  } else {
    for (const run of runs) {
      const stdoutExcerpt = normalizeExcerpt(run.stdoutExcerpt);
      const stderrExcerpt = normalizeExcerpt(run.stderrExcerpt);
      lines.push(`### ${formatDate(run.createdAt)} ${run.agentName ?? run.agentId} (${run.status})`);
      lines.push("");
      lines.push(`- Run ID: ${run.id}`);
      lines.push(`- Started At: ${formatDate(run.startedAt)}`);
      lines.push(`- Finished At: ${formatDate(run.finishedAt)}`);
      if (run.error) {
        lines.push(`- Error: ${run.error}`);
      }
      lines.push("");

      if (stdoutExcerpt) {
        lines.push("#### stdout");
        lines.push("");
        lines.push("```text");
        lines.push(stdoutExcerpt);
        lines.push("```");
        lines.push("");
      }

      if (stderrExcerpt) {
        lines.push("#### stderr");
        lines.push("");
        lines.push("```text");
        lines.push(stderrExcerpt);
        lines.push("```");
        lines.push("");
      }

      if (!stdoutExcerpt && !stderrExcerpt) {
        lines.push("_No captured output excerpt_");
        lines.push("");
      }
    }
  }

  await fs.writeFile(
    path.resolve(issuesDir, safeIssueFileName(issue.identifier, issue.id)),
    `${lines.join("\n").trimEnd()}\n`,
    "utf8",
  );
}
