import type { UIAdapterModule } from "../types";
import {
  buildOcaLocalConfig,
  parseOcaLocalStdoutLine,
} from "@teamclawai/adapter-oca-local/ui";
import { ClineLocalConfigFields } from "../cline-local/config-fields";

export const ocaLocalUIAdapter: UIAdapterModule = {
  type: "oca_local",
  label: "OCA Local",
  parseStdoutLine: parseOcaLocalStdoutLine,
  ConfigFields: ClineLocalConfigFields,
  buildAdapterConfig: buildOcaLocalConfig,
};
