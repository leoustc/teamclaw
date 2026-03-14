import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "./types.js";
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
} from "./utils.js";
import { getPrimaryClineConfiguredModel } from "./cline-models.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

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

async function readInstructionsPrefix(cwd: string, config: Record<string, unknown>, onLog?: AdapterExecutionContext["onLog"]) {
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  if (!instructionsFilePath) return "";

  const resolvedInstructionsFilePath = path.isAbsolute(instructionsFilePath)
    ? instructionsFilePath
    : path.resolve(cwd, instructionsFilePath);

  try {
    const contents = await fs.readFile(resolvedInstructionsFilePath, "utf8");
    if (onLog) {
      await onLog("stdout", `[teamclaw] Loaded agent instructions file: ${resolvedInstructionsFilePath}\n`);
    }
    return `${contents}\n\n`;
  } catch (err) {
    if (onLog) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[teamclaw] Warning: could not read agent instructions file "${resolvedInstructionsFilePath}": ${reason}\n`,
      );
    }
    return "";
  }
}

export async function executeClineLocal(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, authToken } = ctx;
  const command = asString(config.command, "cline");
  const cwd = asString(config.cwd, process.cwd());
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

  const args = ["task", "--json", "-c", cwd];
  const model = asString(config.model, "").trim();
  const reasoningEffort = asString(config.thinking, "").trim();
  if (model) args.push("-m", model);
  if (reasoningEffort) args.push("--reasoning-effort", reasoningEffort);
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();
  if (extraArgs.length > 0) args.push(...extraArgs);
  args.push(prompt);

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);

  if (onMeta) {
    await onMeta({
      adapterType: "cline_local",
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
      errorMessage: firstNonEmptyLine(proc.stderr) || `Cline exited with code ${proc.exitCode ?? -1}`,
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

export async function testClineLocalEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "cline");
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: false });
    checks.push({
      code: "cline_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "cline_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...env }));

  const cwdInvalid = checks.some((check) => check.code === "cline_cwd_invalid");
  if (!cwdInvalid) {
    try {
      await ensureCommandResolvable(command, cwd, runtimeEnv);
      checks.push({
        code: "cline_command_resolvable",
        level: "info",
        message: `Command is executable: ${command}`,
      });
    } catch (err) {
      checks.push({
        code: "cline_command_unresolvable",
        level: "error",
        message: err instanceof Error ? err.message : "Command is not executable",
        detail: command,
      });
    }
  }

  const canRunProbe =
    checks.every((check) => check.code !== "cline_cwd_invalid" && check.code !== "cline_command_unresolvable");

  if (canRunProbe) {
    const probe = await runChildProcess(
      `cline-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command,
      ["--version"],
      {
        cwd,
        env: runtimeEnv,
        timeoutSec: 15,
        graceSec: 3,
        onLog: async () => {},
      },
    ).catch((err) => {
      checks.push({
        code: "cline_version_failed",
        level: "warn",
        message: err instanceof Error ? err.message : "Failed to run `cline --version`.",
      });
      return null;
    });

    if (probe) {
      const version = firstNonEmptyLine(probe.stdout) || firstNonEmptyLine(probe.stderr);
      checks.push({
        code: "cline_version_ok",
        level: probe.exitCode === 0 ? "info" : "warn",
        message: version ? `Cline version: ${version}` : "Cline responded to --version.",
      });
    }
  }

  const configuredModel = asString(config.model, "").trim();
  if (configuredModel) {
    checks.push({
      code: "cline_model_configured",
      level: "info",
      message: `Configured model: ${configuredModel}`,
    });
  } else {
    const discoveredModel = await getPrimaryClineConfiguredModel();
    checks.push({
      code: discoveredModel ? "cline_model_discovered" : "cline_model_optional",
      level: "info",
      message: discoveredModel
        ? `Cline default model: ${discoveredModel.id}`
        : "No model configured. Cline may use its default configured model.",
    });
  }

  return {
    adapterType: "cline_local",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
