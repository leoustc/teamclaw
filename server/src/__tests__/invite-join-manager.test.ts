import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("returns null when no Manager exists in the company agent list", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "architect", reportsTo: null },
      { id: "a2", role: "engineer", reportsTo: "a1" },
    ]);

    expect(managerId).toBeNull();
  });

  it("selects the root Manager when available", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "manager-child", role: "manager", reportsTo: "manager-1" },
      { id: "manager-1", role: "architect", reportsTo: null },
      { id: "manager-root", role: "manager", reportsTo: null },
    ]);

    expect(managerId).toBe("manager-root");
  });

  it("falls back to the first Manager when no root Manager is present", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "manager-1", role: "manager", reportsTo: "mgr" },
      { id: "manager-2", role: "manager", reportsTo: "mgr" },
      { id: "mgr", role: "architect", reportsTo: null },
    ]);

    expect(managerId).toBe("manager-1");
  });
});
