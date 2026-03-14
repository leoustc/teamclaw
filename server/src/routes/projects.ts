import { Router, type Request } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Db } from "@teamclawai/db";
import { companies } from "@teamclawai/db";
import { eq } from "drizzle-orm";
import {
  createProjectSchema,
  createProjectWorkspaceSchema,
  isUuidLike,
  updateProjectSchema,
  updateProjectWorkspaceSchema,
} from "@teamclawai/shared";
import { validate } from "../middleware/validate.js";
import { projectService, logActivity } from "../services/index.js";
import { conflict, unprocessable } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { resolveDefaultProjectWorkspaceDir } from "../home-paths.js";

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);

  function normalizeCwdInput(value: string): string {
    const trimmed = value.trim();
    if (trimmed === "~") return os.homedir();
    if (trimmed.startsWith("~/")) return path.resolve(os.homedir(), trimmed.slice(2));
    if (trimmed === "$HOME") return os.homedir();
    if (trimmed.startsWith("$HOME/")) return path.resolve(os.homedir(), trimmed.slice("$HOME/".length));
    return trimmed;
  }

  async function runGit(args: string[], cwd?: string): Promise<void> {
    const proc = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const env = { ...process.env };
      if (!env.GIT_SSH_COMMAND) {
        env.GIT_SSH_COMMAND = "ssh -o StrictHostKeyChecking=accept-new";
      }
      const child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
    if (proc.code !== 0) {
      throw new Error(proc.stderr.trim() || proc.stdout.trim() || `git ${args.join(" ")} failed`);
    }
  }

  async function ensureRepoCloned(input: { cwd: string; repoUrl: string }) {
    const gitDir = path.resolve(input.cwd, ".git");
    const hasGitDir = await fs
      .stat(gitDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
    if (hasGitDir) return;

    const entries = await fs.readdir(input.cwd).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      throw unprocessable(`Could not inspect project workspace directory: ${reason}`);
    });
    if (entries.length > 0) {
      throw conflict(`Project workspace directory "${input.cwd}" already exists and is not an empty git checkout.`);
    }

    try {
      await runGit(["clone", input.repoUrl, "."], input.cwd);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw unprocessable(`Could not clone project repository: ${reason}`);
    }
  }

  async function prepareProjectWorkspaceInput(
    workspaceInput: Record<string, unknown>,
    input: {
      companyId: string;
      companyName: string;
      projectId: string;
      projectName: string;
      defaultCwdWhenMissing?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const cwdValue = workspaceInput.cwd;
    const repoUrl =
      typeof workspaceInput.repoUrl === "string" && workspaceInput.repoUrl.trim().length > 0
        ? workspaceInput.repoUrl.trim()
        : null;
    const normalizedCwd =
      typeof cwdValue === "string" && cwdValue.trim().length > 0 && cwdValue !== "/__teamclaw_repo_only__"
        ? normalizeCwdInput(cwdValue)
        : (repoUrl || input.defaultCwdWhenMissing)
          ? resolveDefaultProjectWorkspaceDir(input.companyId, input.projectId, {
              companyName: input.companyName,
              projectName: input.projectName,
            })
          : null;

    if (!normalizedCwd) return workspaceInput;
    if (!path.isAbsolute(normalizedCwd)) return workspaceInput;
    try {
      await fs.mkdir(normalizedCwd, { recursive: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw unprocessable(`Could not create project workspace cwd directory: ${reason}`);
    }
    if (repoUrl) {
      await ensureRepoCloned({ cwd: normalizedCwd, repoUrl });
    }
    if (normalizedCwd === cwdValue) return workspaceInput;
    return { ...workspaceInput, cwd: normalizedCwd };
  }

  async function getCompanyName(companyId: string): Promise<string> {
    const row = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    return row?.name ?? companyId;
  }

  function resolveProjectWorkspaceRoot(project: Awaited<ReturnType<typeof svc.getById>>) {
    const rootCwd = project?.primaryWorkspace?.cwd;
    if (!rootCwd) {
      throw unprocessable("Project does not have a local workspace path configured.");
    }
    return path.resolve(rootCwd);
  }

  function resolveSafeProjectRelativePath(rootCwd: string, requestedPath: unknown) {
    const relativePath = typeof requestedPath === "string" ? requestedPath.trim() : "";
    const normalizedRelativePath = relativePath.replace(/^\/+/, "");
    const absolutePath = path.resolve(rootCwd, normalizedRelativePath || ".");
    const relativeFromRoot = path.relative(rootCwd, absolutePath);
    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw conflict("Path escapes the project workspace.");
    }
    return {
      absolutePath,
      relativePath: relativeFromRoot === "" ? "" : relativeFromRoot,
    };
  }

  async function resolveCompanyIdForProjectReference(req: Request) {
    const companyIdQuery = req.query.companyId;
    const requestedCompanyId =
      typeof companyIdQuery === "string" && companyIdQuery.trim().length > 0
        ? companyIdQuery.trim()
        : null;
    if (requestedCompanyId) {
      assertCompanyAccess(req, requestedCompanyId);
      return requestedCompanyId;
    }
    if (req.actor.type === "agent" && req.actor.companyId) {
      return req.actor.companyId;
    }
    return null;
  }

  async function normalizeProjectReference(req: Request, rawId: string) {
    if (isUuidLike(rawId)) return rawId;
    const companyId = await resolveCompanyIdForProjectReference(req);
    if (!companyId) return rawId;
    const resolved = await svc.resolveByReference(companyId, rawId);
    if (resolved.ambiguous) {
      throw conflict("Project shortname is ambiguous in this company. Use the project ID.");
    }
    return resolved.project?.id ?? rawId;
  }

  router.param("id", async (req, _res, next, rawId) => {
    try {
      req.params.id = await normalizeProjectReference(req, rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/companies/:companyId/projects", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  router.get("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    res.json(project);
  });

  router.post("/companies/:companyId/projects", validate(createProjectSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    type CreateProjectPayload = Parameters<typeof svc.create>[1] & {
      workspace?: Parameters<typeof svc.createWorkspace>[1];
    };

    const { workspace, ...projectData } = req.body as CreateProjectPayload;
    const project = await svc.create(companyId, projectData);
    const companyName = await getCompanyName(companyId);
    let createdWorkspaceId: string | null = null;
    const mkdirReadyWorkspace = await prepareProjectWorkspaceInput(
      ((workspace as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>,
      {
        companyId,
        companyName,
        projectId: project.id,
        projectName: project.name,
        defaultCwdWhenMissing: true,
      },
    );
    const createdWorkspace = await svc.createWorkspace(project.id, mkdirReadyWorkspace);
    if (!createdWorkspace) {
      await svc.remove(project.id);
      res.status(422).json({ error: "Invalid project workspace payload" });
      return;
    }
    createdWorkspaceId = createdWorkspace.id;
    const hydratedProject = await svc.getById(project.id);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      details: {
        name: project.name,
        workspaceId: createdWorkspaceId,
      },
    });
    res.status(201).json(hydratedProject ?? project);
  });

  router.patch("/projects/:id", validate(updateProjectSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const project = await svc.update(id, req.body);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      details: req.body,
    });

    res.json(project);
  });

  router.get("/projects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const workspaces = await svc.listWorkspaces(id);
    res.json(workspaces);
  });

  router.get("/projects/:id/files", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    const rootCwd = resolveProjectWorkspaceRoot(project);
    const { absolutePath, relativePath } = resolveSafeProjectRelativePath(rootCwd, req.query.path);
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

  router.get("/projects/:id/file-content", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    const rootCwd = resolveProjectWorkspaceRoot(project);
    const { absolutePath, relativePath } = resolveSafeProjectRelativePath(rootCwd, req.query.path);
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

  router.post("/projects/:id/workspaces", validate(createProjectWorkspaceSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const companyName = await getCompanyName(existing.companyId);
    const mkdirReadyWorkspace = await prepareProjectWorkspaceInput(
      req.body as Record<string, unknown>,
      {
        companyId: existing.companyId,
        companyName,
        projectId: existing.id,
        projectName: existing.name,
      },
    );
    const workspace = await svc.createWorkspace(id, mkdirReadyWorkspace);
    if (!workspace) {
      res.status(422).json({ error: "Invalid project workspace payload" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_created",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        isPrimary: workspace.isPrimary,
      },
    });

    res.status(201).json(workspace);
  });

  router.patch(
    "/projects/:id/workspaces/:workspaceId",
    validate(updateProjectWorkspaceSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const workspaceId = req.params.workspaceId as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const workspaceExists = (await svc.listWorkspaces(id)).some((workspace) => workspace.id === workspaceId);
      if (!workspaceExists) {
        res.status(404).json({ error: "Project workspace not found" });
        return;
      }
      const companyName = await getCompanyName(existing.companyId);
      const mkdirReadyWorkspace = await prepareProjectWorkspaceInput(
        req.body as Record<string, unknown>,
        {
          companyId: existing.companyId,
          companyName,
          projectId: existing.id,
          projectName: existing.name,
        },
      );
      const workspace = await svc.updateWorkspace(id, workspaceId, mkdirReadyWorkspace);
      if (!workspace) {
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "project.workspace_updated",
        entityType: "project",
        entityId: id,
        details: {
          workspaceId: workspace.id,
          changedKeys: Object.keys(req.body).sort(),
        },
      });

      res.json(workspace);
    },
  );

  router.delete("/projects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const workspace = await svc.removeWorkspace(id, workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_deleted",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
      },
    });

    res.json(workspace);
  });

  router.delete("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const project = await svc.remove(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.deleted",
      entityType: "project",
      entityId: project.id,
    });

    res.json(project);
  });

  return router;
}
