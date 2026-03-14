import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@teamclawai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  buildTeamClawEnv,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  redactEnvForLogs,
  renderTemplate,
  runChildProcess,
} from "@teamclawai/adapter-utils/server-utils";

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function resolveHomeAwarePath(value: string): string {
  if (value === "$HOME") return os.homedir();
  if (value.startsWith("$HOME/")) return path.resolve(os.homedir(), value.slice("$HOME/".length));
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return path.resolve(value);
}

async function readInstructionsPrefix(cwd: string, config: Record<string, unknown>, onLog?: AdapterExecutionContext["onLog"]) {
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  if (!instructionsFilePath) return "";

  const resolved = path.isAbsolute(instructionsFilePath)
    ? instructionsFilePath
    : path.resolve(cwd, instructionsFilePath);

  try {
    const contents = await fs.readFile(resolved, "utf8");
    if (onLog) {
      await onLog("stdout", `[teamclaw] Loaded agent instructions file: ${resolved}\n`);
    }
    return `${contents}\n\n`;
  } catch (err) {
    if (onLog) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog("stderr", `[teamclaw] Warning: could not read agent instructions file "${resolved}": ${reason}\n`);
    }
    return "";
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, authToken } = ctx;
  const command = asString(config.command, "oca-local");
  const cwd = resolveHomeAwarePath(asString(config.cwd, process.cwd()));
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildTeamClawEnv(agent) };
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  if (authToken && !env.TEAMCLAW_API_KEY) {
    env.TEAMCLAW_API_KEY = authToken;
  }
  const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...env }));
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your TeamClaw work.",
  );
  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });
  const instructionsPrefix = await readInstructionsPrefix(cwd, config, onLog);
  const prompt = `${instructionsPrefix}${renderedPrompt}`.trim();

  const args = ["prompt", "--cwd", cwd];
  const model = asString(config.model, "").trim();
  const reasoningEffort = asString(config.thinking, "").trim();
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("--reasoning-effort", reasoningEffort);

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();
  if (extraArgs.length > 0) {
    for (const arg of extraArgs) args.push("--extra-arg", arg);
  }
  args.push("--", prompt);

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);

  if (onMeta) {
    await onMeta({
      adapterType: "oca_local",
      command,
      cwd,
      commandArgs: args,
      env: redactEnvForLogs(runtimeEnv),
      prompt,
    });
  }

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
      resultJson: { stdout: proc.stdout, stderr: proc.stderr },
    };
  }

  if ((proc.exitCode ?? 0) !== 0) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: firstNonEmptyLine(proc.stderr) || `OCA local exited with code ${proc.exitCode ?? -1}`,
      resultJson: { stdout: proc.stdout, stderr: proc.stderr },
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    resultJson: { stdout: proc.stdout, stderr: proc.stderr },
  };
}
