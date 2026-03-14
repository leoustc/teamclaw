import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@teamclawai/db";
import { authUsers, instanceUserRoles } from "@teamclawai/db";
import { and, eq } from "drizzle-orm";
import type { DeploymentExposure, DeploymentMode } from "@teamclawai/shared";
import type { StorageService } from "./storage/types.js";
import { httpLogger, errorHandler } from "./middleware/index.js";
import { actorMiddleware } from "./middleware/auth.js";
import { boardMutationGuard } from "./middleware/board-mutation-guard.js";
import { privateHostnameGuard } from "./middleware/private-hostname-guard.js";
import { healthRoutes } from "./routes/health.js";
import { companyRoutes } from "./routes/companies.js";
import { agentRoutes } from "./routes/agents.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { goalRoutes } from "./routes/goals.js";
import { approvalRoutes } from "./routes/approvals.js";
import { secretRoutes } from "./routes/secrets.js";
import { costRoutes } from "./routes/costs.js";
import { activityRoutes } from "./routes/activity.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { sidebarBadgeRoutes } from "./routes/sidebar-badges.js";
import { llmRoutes } from "./routes/llms.js";
import { openAIChatRoutes } from "./routes/openai-chat.js";
import { assetRoutes } from "./routes/assets.js";
import { accessRoutes } from "./routes/access.js";
import { applyUiBranding } from "./ui-branding.js";
import type { BetterAuthSessionResult } from "./auth/better-auth.js";
import { authenticateWithPam, assertPamUsername } from "./auth/pam-auth.js";
import {
  createPamSessionToken,
  pamSessionClearCookie,
  pamSessionSetCookie,
} from "./auth/pam-session.js";

type UiMode = "none" | "static" | "vite-dev";

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    serverPort: number;
    storageService: StorageService;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
    pamSessionSecret?: string;
    pamServiceName?: string;
  },
) {
  const app = express();

  app.use(express.json());
  app.use(httpLogger);
  const privateHostnameGateEnabled = false;
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
      pamSessionSecret: opts.pamSessionSecret,
    }),
  );
  app.post("/api/auth/pam/sign-in", async (req, res) => {
    if (opts.deploymentMode !== "authenticated") {
      res.status(400).json({ error: "PAM login is only available in authenticated mode" });
      return;
    }
    if (!opts.pamSessionSecret) {
      res.status(500).json({ error: "PAM session secret is not configured" });
      return;
    }

    const usernameRaw = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!usernameRaw || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    let username: string;
    try {
      username = assertPamUsername(usernameRaw);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Invalid username format" });
      return;
    }

    try {
      await authenticateWithPam({
        username,
        password,
        serviceName: opts.pamServiceName ?? "login",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("PAM backend unavailable") ||
          error.message.includes("PAM module not installed"))
      ) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(401).json({ error: "Invalid PAM credentials" });
      return;
    }

    const userId = `pam:${username}`;
    const email = `${username}@pam.local`;
    const now = new Date();
    const existingUser = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);
    if (!existingUser) {
      await db.insert(authUsers).values({
        id: userId,
        name: username,
        email,
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const existingAdminRole = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);

    if (!existingAdminRole) {
      const instanceAdmins = await db
        .select({ userId: instanceUserRoles.userId })
        .from(instanceUserRoles)
        .where(eq(instanceUserRoles.role, "instance_admin"))
        .then((rows) => rows.map((row) => row.userId));

      const hasRealAdmin = instanceAdmins.some((id) => id !== "local-board");
      if (!hasRealAdmin) {
        await db.insert(instanceUserRoles).values({
          userId,
          role: "instance_admin",
        });
      }
    }

    const token = createPamSessionToken({ userId, username }, opts.pamSessionSecret);
    const forwardedProto = req.header("x-forwarded-proto");
    const secure = req.secure || forwardedProto === "https";
    res.setHeader("Set-Cookie", pamSessionSetCookie(token, secure));
    res.status(200).json({
      session: {
        id: `teamclaw:pam_session:${userId}`,
        userId,
      },
      user: {
        id: userId,
        email,
        name: username,
      },
    });
  });
  app.post("/api/auth/pam/sign-out", (req, res) => {
    const forwardedProto = req.header("x-forwarded-proto");
    const secure = req.secure || forwardedProto === "https";
    res.setHeader("Set-Cookie", pamSessionClearCookie(secure));
    res.status(200).json({ ok: true });
  });
  app.get("/api/auth/get-session", (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    void db
      .select({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
      })
      .from(authUsers)
      .where(eq(authUsers.id, req.actor.userId))
      .then((rows) => rows[0] ?? null)
      .then((user) => {
        res.json({
          session: {
            id: `teamclaw:${req.actor.source}:${req.actor.userId}`,
            userId: req.actor.userId,
          },
          user: {
            id: req.actor.userId,
            email: user?.email ?? null,
            name:
              user?.name ??
              (req.actor.source === "local_implicit"
                ? "Local Board"
                : req.actor.source === "pam_session"
                  ? "PAM User"
                  : null),
          },
        });
      })
      .catch(() => {
        res.json({
          session: {
            id: `teamclaw:${req.actor.source}:${req.actor.userId}`,
            userId: req.actor.userId,
          },
          user: {
            id: req.actor.userId,
            email: null,
            name: req.actor.source === "local_implicit" ? "Local Board" : null,
          },
        });
      });
  });
  void opts.betterAuthHandler;
  app.use(openAIChatRoutes());
  app.use(llmRoutes(db));

  // Mount API routes
  const api = Router();
  api.use(boardMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      companyDeletionEnabled: opts.companyDeletionEnabled,
    }),
  );
  api.use("/companies", companyRoutes(db));
  api.use(agentRoutes(db));
  api.use(assetRoutes(db, opts.storageService));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService));
  api.use(goalRoutes(db));
  api.use(approvalRoutes(db));
  api.use(secretRoutes(db));
  api.use(costRoutes(db));
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      const indexHtml = applyUiBranding(fs.readFileSync(path.join(uiDist, "index.html"), "utf-8"));
      app.use(express.static(uiDist));
      app.get(/.*/, (_req, res) => {
        res.status(200).set("Content-Type", "text/html").end(indexHtml);
      });
    } else {
      console.warn("[teamclaw] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const hmrPort = opts.serverPort + 10000;
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "spa",
      server: {
        middlewareMode: true,
        hmr: {
          host: opts.bindHost,
          port: hmrPort,
          clientPort: hmrPort,
        },
        allowedHosts: undefined,
      },
    });

    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const templatePath = path.resolve(uiRoot, "index.html");
        const template = fs.readFileSync(templatePath, "utf-8");
        const html = applyUiBranding(await vite.transformIndexHtml(req.originalUrl, template));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(errorHandler);

  return app;
}
