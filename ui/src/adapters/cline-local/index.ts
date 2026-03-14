import type { UIAdapterModule } from "../types";
import { buildPiLocalConfig } from "@teamclawai/adapter-pi-local/ui";
import { ClineLocalConfigFields } from "./config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

function buildClineLocalConfig(values: Parameters<typeof buildPiLocalConfig>[0]): Record<string, unknown> {
  const next = buildPiLocalConfig(values);
  const configured = typeof next.command === "string" ? next.command.trim() : "";
  if (!configured) next.command = "cline";
  return next;
}

export const clineLocalUIAdapter: UIAdapterModule = {
  type: "cline_local",
  label: "Cline Local",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: ClineLocalConfigFields,
  buildAdapterConfig: buildClineLocalConfig,
};
