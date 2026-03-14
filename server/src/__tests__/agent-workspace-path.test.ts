import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses the company root and role_name agent folder convention", () => {
    expect(
      resolveDefaultAgentWorkspaceDir("company-1", {
        companyName: "Test Company",
        agentRole: "engineer",
        agentName: "Alpha Beta",
      }),
    ).toBe(path.resolve(os.homedir(), "test-company", "agents", "engineer_alpha-beta"));
  });

  it("keeps duplicate role and name segments in role_name form", () => {
    expect(
      resolveDefaultAgentWorkspaceDir("company-1", {
        companyName: "Test Company",
        agentRole: "architect",
        agentName: "Architect",
      }),
    ).toBe(path.resolve(os.homedir(), "test-company", "agents", "architect_architect"));
  });

  it("falls back safely when role or name are missing", () => {
    expect(
      resolveDefaultAgentWorkspaceDir("company_1", {
        companyName: "",
        agentRole: "",
        agentName: "",
        agentIdFallback: "agent_1",
      }),
    ).toBe(path.resolve(os.homedir(), "company_1", "agents", "agent_agent_1"));
  });
});
