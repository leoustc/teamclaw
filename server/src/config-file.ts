import fs from "node:fs";
import { teamclawConfigSchema, type TeamClawConfig } from "@teamclawai/shared";
import { resolveTeamClawConfigPath } from "./paths.js";

export function readConfigFile(): TeamClawConfig | null {
  const configPath = resolveTeamClawConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return teamclawConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
