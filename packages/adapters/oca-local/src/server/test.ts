import os from "node:os";
import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@teamclawai/adapter-utils";
import {
  asString,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  runChildProcess,
} from "@teamclawai/adapter-utils/server-utils";
import { listOcaModels } from "./models.js";

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

function resolveHomeAwarePath(value: string): string {
  if (value === "$HOME") return os.homedir();
  if (value.startsWith("$HOME/")) return path.resolve(os.homedir(), value.slice("$HOME/".length));
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return path.resolve(value);
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "oca-local");
  const cwd = resolveHomeAwarePath(asString(config.cwd, process.cwd()));

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "oca_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "oca_cwd_invalid",
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

  const cwdInvalid = checks.some((check) => check.code === "oca_cwd_invalid");
  if (!cwdInvalid) {
    try {
      await ensureCommandResolvable(command, cwd, runtimeEnv);
      checks.push({
        code: "oca_command_resolvable",
        level: "info",
        message: `Command is executable: ${command}`,
      });
    } catch (err) {
      checks.push({
        code: "oca_command_unresolvable",
        level: "error",
        message: err instanceof Error ? err.message : "Command is not executable",
        detail: command,
      });
    }
  }

  const canRunProbe =
    checks.every((check) => check.code !== "oca_cwd_invalid" && check.code !== "oca_command_unresolvable");

  if (canRunProbe) {
    const probe = await runChildProcess(
      `oca-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
        code: "oca_version_failed",
        level: "warn",
        message: err instanceof Error ? err.message : "Failed to run `oca-local --version`.",
      });
      return null;
    });

    if (probe) {
      const version = firstNonEmptyLine(probe.stdout) || firstNonEmptyLine(probe.stderr);
      checks.push({
        code: "oca_version_ok",
        level: probe.exitCode === 0 ? "info" : "warn",
        message: version ? `OCA Local version: ${version}` : "oca-local responded to --version.",
      });
    }
  }

  const configuredModel = asString(config.model, "").trim();
  if (configuredModel) {
    checks.push({
      code: "oca_model_configured",
      level: "info",
      message: `Configured model: ${configuredModel}`,
    });
  } else {
    const discoveredModels = await listOcaModels();
    const preview = discoveredModels
      .slice(0, 3)
      .map((entry) => entry.id)
      .join(", ");
    checks.push({
      code: discoveredModels.length > 0 ? "oca_model_discovered" : "oca_model_optional",
      level: "info",
      message: discoveredModels.length > 0
        ? `Discovered ${discoveredModels.length} OCA models${preview ? `: ${preview}${discoveredModels.length > 3 ? ", ..." : ""}` : ""}`
        : "No model discovered from `oca-local list-models`.",
    });
  }

  return {
    adapterType: "oca_local",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
