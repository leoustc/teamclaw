import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "@teamclawai/db";
import {
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createCompanySchema,
  updateCompanySchema,
} from "@teamclawai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { resolveDefaultCompanyHomeDir, resolveDefaultCompanyWorkspaceDir } from "../home-paths.js";
import { accessService, companyPortabilityService, companyService, logActivity, projectService } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function companyRoutes(db: Db) {
  const router = Router();
  const svc = companyService(db);
  const portability = companyPortabilityService(db);
  const access = accessService(db);
  const projects = projectService(db);

  function resolveSafeCompanyRelativePath(rootCwd: string, requestedPath: unknown) {
    const relativePath = typeof requestedPath === "string" ? requestedPath.trim() : "";
    const absolutePath = path.resolve(rootCwd, relativePath || ".");
    const relativeFromRoot = path.relative(rootCwd, absolutePath);
    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw forbidden("Path escapes company root");
    }
    return {
      absolutePath,
      relativePath: relativeFromRoot === "" ? "" : relativeFromRoot,
    };
  }

  function validateEntryName(value: unknown) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name) {
      throw new Error("Name is required");
    }
    if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      throw new Error("Name must be a single path segment");
    }
    return name;
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  // Common malformed path when companyId is empty in "/api/companies/{companyId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  router.get("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.get("/:companyId/files", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    await fs.mkdir(rootCwd, { recursive: true });
    const { absolutePath, relativePath } = resolveSafeCompanyRelativePath(rootCwd, req.query.path);
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      res.status(404).json({ error: "Path not found" });
      return;
    }
    if (!stats.isDirectory()) {
      res.status(422).json({ error: "Path is not a directory" });
      return;
    }

    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const payload = await Promise.all(
      entries
        .filter((entry) => entry.name !== "." && entry.name !== "..")
        .map(async (entry) => {
          const entryAbsolutePath = path.resolve(absolutePath, entry.name);
          const entryStats = await fs.stat(entryAbsolutePath).catch(() => null);
          return {
            name: entry.name,
            path: relativePath ? `${relativePath}/${entry.name}` : entry.name,
            kind: entry.isDirectory() ? "directory" : "file",
            size: entry.isDirectory() ? null : entryStats?.size ?? null,
          };
        }),
    );

    payload.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      rootCwd,
      path: relativePath,
      entries: payload,
    });
  });

  router.get("/:companyId/file-content", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    const { absolutePath, relativePath } = resolveSafeCompanyRelativePath(rootCwd, req.query.path);
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stats.isFile()) {
      res.status(422).json({ error: "Path is not a file" });
      return;
    }

    const maxBytes = 256 * 1024;
    const buffer = await fs.readFile(absolutePath);
    const truncated = buffer.byteLength > maxBytes;
    const content = buffer.subarray(0, maxBytes).toString("utf8");
    res.json({
      rootCwd,
      path: relativePath,
      content,
      truncated,
    });
  });

  router.post("/:companyId/files", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const kind = req.body && req.body.kind === "directory" ? "directory" : req.body?.kind === "file" ? "file" : null;
    if (!kind) {
      res.status(400).json({ error: "Kind must be 'file' or 'directory'" });
      return;
    }

    let name: string;
    try {
      name = validateEntryName(req.body?.name);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid name" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    await fs.mkdir(rootCwd, { recursive: true });
    const { absolutePath: parentAbsolutePath, relativePath: parentPath } = resolveSafeCompanyRelativePath(rootCwd, req.body?.parentPath);
    const parentStats = await fs.stat(parentAbsolutePath).catch(() => null);
    if (!parentStats) {
      res.status(404).json({ error: "Parent path not found" });
      return;
    }
    if (!parentStats.isDirectory()) {
      res.status(422).json({ error: "Parent path is not a directory" });
      return;
    }

    const targetAbsolutePath = path.resolve(parentAbsolutePath, name);
    const targetRelativePath = parentPath ? `${parentPath}/${name}` : name;
    const existing = await fs.stat(targetAbsolutePath).catch(() => null);
    if (existing) {
      res.status(409).json({ error: "Path already exists" });
      return;
    }

    if (kind === "directory") {
      await fs.mkdir(targetAbsolutePath, { recursive: false });
    } else {
      await fs.writeFile(targetAbsolutePath, "", "utf8");
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: companyId,
      action: kind === "directory" ? "company.directory.created" : "company.file.created",
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        path: targetRelativePath,
        kind,
      },
    });

    res.status(201).json({
      ok: true,
      rootCwd,
      path: targetRelativePath,
    });
  });

  router.patch("/:companyId/file-content", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const requestedPath = req.body && typeof req.body.path === "string" ? req.body.path : "";
    const content = req.body && typeof req.body.content === "string" ? req.body.content : null;
    if (!requestedPath) {
      res.status(400).json({ error: "File path is required" });
      return;
    }
    if (content === null) {
      res.status(400).json({ error: "File content must be a string" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    const { absolutePath, relativePath } = resolveSafeCompanyRelativePath(rootCwd, requestedPath);
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stats.isFile()) {
      res.status(422).json({ error: "Path is not a file" });
      return;
    }

    await fs.writeFile(absolutePath, content, "utf8");
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: companyId,
      action: "company.file.updated",
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        path: relativePath,
      },
    });
    res.json({
      ok: true,
      rootCwd,
      path: relativePath,
    });
  });

  router.patch("/:companyId/file-path", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const requestedPath = req.body && typeof req.body.path === "string" ? req.body.path : "";
    if (!requestedPath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    let newName: string;
    try {
      newName = validateEntryName(req.body?.newName);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid new name" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    const { absolutePath, relativePath } = resolveSafeCompanyRelativePath(rootCwd, requestedPath);
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      res.status(404).json({ error: "Path not found" });
      return;
    }

    const parentAbsolutePath = path.dirname(absolutePath);
    const parentRelativePath = path.dirname(relativePath);
    const targetAbsolutePath = path.resolve(parentAbsolutePath, newName);
    const targetRelativePath = parentRelativePath === "." ? newName : `${parentRelativePath}/${newName}`;
    if (targetAbsolutePath === absolutePath) {
      res.json({ ok: true, rootCwd, path: relativePath });
      return;
    }
    const existing = await fs.stat(targetAbsolutePath).catch(() => null);
    if (existing) {
      res.status(409).json({ error: "Target path already exists" });
      return;
    }

    await fs.rename(absolutePath, targetAbsolutePath);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: companyId,
      action: stats.isDirectory() ? "company.directory.renamed" : "company.file.renamed",
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        from: relativePath,
        to: targetRelativePath,
      },
    });

    res.json({
      ok: true,
      rootCwd,
      path: targetRelativePath,
    });
  });

  router.delete("/:companyId/file-content", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const requestedPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!requestedPath) {
      res.status(400).json({ error: "File path is required" });
      return;
    }

    const rootCwd = resolveDefaultCompanyHomeDir(company.id, company.name);
    const { absolutePath, relativePath } = resolveSafeCompanyRelativePath(rootCwd, requestedPath);
    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      res.status(404).json({ error: "Path not found" });
      return;
    }
    await fs.rm(absolutePath, { recursive: true, force: false });
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: companyId,
      action: stats.isDirectory() ? "company.directory.deleted" : "company.file.deleted",
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        path: relativePath,
        kind: stats.isDirectory() ? "directory" : "file",
      },
    });
    res.json({
      ok: true,
      rootCwd,
      path: relativePath,
    });
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null);
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create(req.body);
    const companyHomeDir = resolveDefaultCompanyHomeDir(company.id, company.name);
    const defaultProjectCwd = resolveDefaultCompanyWorkspaceDir(company.id, company.name);
    await Promise.all([
      fs.mkdir(path.resolve(companyHomeDir, "agents"), { recursive: true }),
      fs.mkdir(path.resolve(companyHomeDir, "projects"), { recursive: true }),
      fs.mkdir(path.resolve(companyHomeDir, "issues"), { recursive: true }),
      fs.mkdir(path.resolve(companyHomeDir, "tools"), { recursive: true }),
      fs.mkdir(path.resolve(companyHomeDir, "skills"), { recursive: true }),
      fs.mkdir(defaultProjectCwd, { recursive: true }),
    ]).catch(() => undefined);
    const defaultProject = await projects.create(company.id, {
      name: "default",
      description: "Default company project",
      status: "planned",
    });
    await projects.createWorkspace(defaultProject.id, {
      name: "default",
      cwd: defaultProjectCwd,
      isPrimary: true,
    });
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    res.status(201).json(company);
  });

  router.patch("/:companyId", validate(updateCompanySchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
