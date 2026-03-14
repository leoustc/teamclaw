import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "@teamclawai/db";
import { companies, issues } from "@teamclawai/db";
import { logger } from "./middleware/logger.js";
import { issueService, heartbeatService, logActivity } from "./services/index.js";
import { runIssueMonitor } from "./monitor.js";

const DEFAULT_TASK_TIME = "9:00am";
const TASKS_FILE = path.resolve(process.cwd(), "scheduler/tasks.md");

type ScheduledTask = {
  raw: string;
  time: string;
  hour: number;
  minute: number;
  title: string;
  leadRole: "manager" | "architect" | "engineer";
};

function parseTime(input: string) {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toLowerCase();
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  let hour = hour12 % 12;
  if (meridiem === "pm") hour += 12;
  return { hour, minute };
}

function parseTasksMarkdown(markdown: string): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const content = trimmed.slice(2).trim();
    if (!content) continue;

    const leadMatch = content.match(/,\s*(manager|architect|engineer)\s+lead\s*$/i);
    const leadRole = (leadMatch?.[1]?.toLowerCase() as ScheduledTask["leadRole"] | undefined) ?? "manager";
    const withoutLead = leadMatch ? content.slice(0, leadMatch.index).trim() : content;
    const timeMatch = withoutLead.match(/^(\d{1,2}:\d{2}\s*(?:am|pm))\s+(.*)$/i);
    const rawTime = (timeMatch?.[1] ?? DEFAULT_TASK_TIME).replace(/\s+/g, "").toLowerCase();
    const parsedTime = parseTime(rawTime);
    if (!parsedTime) continue;
    const body = (timeMatch?.[2] ?? withoutLead).replace(/^for\s+/i, "").trim();
    if (!body) continue;

    tasks.push({
      raw: trimmed,
      time: rawTime,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      title: body,
      leadRole,
    });
  }
  return tasks;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function sameOrPastScheduledTime(now: Date, task: ScheduledTask) {
  const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
  const taskMinutes = task.hour * 60 + task.minute;
  return minutesNow >= taskMinutes;
}

export function startScheduler(db: Db, intervalMs = 60_000) {
  const issuesSvc = issueService(db);
  const heartbeat = heartbeatService(db);
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const markdown = await fs.readFile(TASKS_FILE, "utf8").catch(() => "");
      if (!markdown.trim()) return;
      const tasks = parseTasksMarkdown(markdown);
      if (tasks.length === 0) return;

      const now = new Date();
      const dayStart = startOfUtcDay(now);
      const companyRows = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .orderBy(asc(companies.createdAt), asc(companies.id));

      for (const company of companyRows) {
        for (const task of tasks) {
          if (!sameOrPastScheduledTime(now, task)) continue;

          const dailyTitle = `[Scheduled ${dayStart.toISOString().slice(0, 10)} ${task.time}] ${task.title}`;
          const existing = await db
            .select({ id: issues.id })
            .from(issues)
            .where(
              and(
                eq(issues.companyId, company.id),
                eq(issues.title, dailyTitle),
                gte(issues.createdAt, dayStart),
              ),
            )
            .then((rows) => rows[0] ?? null);
          if (existing) continue;

          const issue = await issuesSvc.create(company.id, {
            title: dailyTitle,
            description:
              `Scheduled task created by TeamClaw scheduler.\n\n` +
              `- Source: scheduler/tasks.md\n` +
              `- Schedule: ${task.time} UTC daily\n` +
              `- Lead role: ${task.leadRole}\n` +
              `- Raw task: ${task.raw}\n`,
            status: "backlog",
            priority: "medium",
          });

          await logActivity(db, {
            companyId: company.id,
            actorType: "system",
            actorId: "scheduler",
            action: "issue.created",
            entityType: "issue",
            entityId: issue.id,
            details: {
              identifier: issue.identifier,
              title: issue.title,
              source: "scheduler",
              scheduledTime: task.time,
              leadRole: task.leadRole,
            },
          });

          await runIssueMonitor(db, {
            companyId: company.id,
            wakeup: heartbeat.wakeup,
            source: "scheduler",
            instruction: {
              issueId: issue.id,
              issueIdentifier: issue.identifier,
              proposedStatus: "todo",
              nextAgentRole: task.leadRole ?? "manager",
              fallbackAgentRole: "manager",
              note: `Scheduled task routed by scheduler from scheduler/tasks.md`,
            },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    } finally {
      inFlight = false;
    }
  };

  void tick();
  return setInterval(() => {
    void tick();
  }, intervalMs);
}
