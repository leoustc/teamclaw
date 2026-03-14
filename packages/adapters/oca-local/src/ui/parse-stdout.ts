import type { TranscriptEntry } from "@teamclawai/adapter-utils";

export function parseOcaLocalStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}
