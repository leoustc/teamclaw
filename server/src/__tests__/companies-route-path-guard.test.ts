import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  create: vi.fn(),
  createWorkspace: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  ensureMembership: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  companyService: () => mockCompanyService,
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => mockAccessService,
  projectService: () => mockProjectService,
  logActivity: mockLogActivity,
}));

describe("company routes malformed issue path guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a clear error when companyId is missing for issues list path", async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      };
      next();
    });
    app.use("/api/companies", companyRoutes({} as any));

    const res = await request(app).get("/api/companies/issues");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  it("creates a default project and workspace when a company is created", async () => {
    mockCompanyService.create.mockResolvedValue({
      id: "company-1",
      name: "Acme Rocket",
      issuePrefix: "ACM",
    });
    mockProjectService.create.mockResolvedValue({
      id: "project-1",
      name: "default",
    });
    mockProjectService.createWorkspace.mockResolvedValue({
      id: "workspace-1",
    });
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "user-1",
        companyIds: [],
        source: "local_implicit",
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api/companies", companyRoutes({} as any));

    const res = await request(app).post("/api/companies").send({ name: "Acme Rocket" });

    expect(res.status).toBe(201);
    expect(mockProjectService.create).toHaveBeenCalledWith("company-1", {
      name: "default",
      description: "Default company project",
      status: "planned",
    });
    expect(mockProjectService.createWorkspace).toHaveBeenCalledWith("project-1", {
      name: "default",
      cwd: expect.stringContaining("/acme-rocket/projects/default"),
      isPrimary: true,
    });
  });
});
