import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@teamclawai/db";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { instanceUserRoles, invites } from "@teamclawai/db";
import type { DeploymentExposure, DeploymentMode } from "@teamclawai/shared";

type BootstrapInviteCache = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

let bootstrapInviteCache: BootstrapInviteCache | null = null;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken() {
  return `pcp_bootstrap_${randomBytes(24).toString("hex")}`;
}

function resolveBaseUrl(req: { header(name: string): string | undefined; protocol: string; get(name: string): string | undefined }) {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const host = req.get("host") || "localhost:3100";
  return `${proto}://${host}`;
}

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    companyDeletionEnabled: boolean;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    companyDeletionEnabled: true,
  },
) {
  const router = Router();

  router.get("/", async (_req, res) => {
    if (!db) {
      res.json({ status: "ok" });
      return;
    }

    let bootstrapStatus: "ready" | "bootstrap_pending" = "ready";
    let bootstrapInviteActive = false;
    if (opts.deploymentMode === "authenticated") {
      const roleCount = await db
        .select({ count: count() })
        .from(instanceUserRoles)
        .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
        .then((rows) => Number(rows[0]?.count ?? 0));
      bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

      if (bootstrapStatus === "bootstrap_pending") {
        const now = new Date();
        const inviteCount = await db
          .select({ count: count() })
          .from(invites)
          .where(
            and(
              eq(invites.inviteType, "bootstrap_ceo"),
              isNull(invites.revokedAt),
              isNull(invites.acceptedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .then((rows) => Number(rows[0]?.count ?? 0));
        bootstrapInviteActive = inviteCount > 0;
      }
    }

    res.json({
      status: "ok",
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      bootstrapStatus,
      bootstrapInviteActive,
      features: {
        companyDeletionEnabled: opts.companyDeletionEnabled,
      },
    });
  });

  router.post("/bootstrap-invite", async (req, res) => {
    if (!db) {
      res.status(500).json({ error: "Database unavailable" });
      return;
    }
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (opts.deploymentMode !== "authenticated") {
      res.status(400).json({ error: "Bootstrap invite is only used in authenticated mode" });
      return;
    }

    const roleCount = await db
      .select({ count: count() })
      .from(instanceUserRoles)
      .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
      .then((rows) => Number(rows[0]?.count ?? 0));
    if (roleCount > 0) {
      res.status(409).json({ error: "Instance already has an admin user" });
      return;
    }

    const now = new Date();
    if (bootstrapInviteCache && bootstrapInviteCache.expiresAt > now) {
      const stillActive = await db
        .select({ count: count() })
        .from(invites)
        .where(
          and(
            eq(invites.inviteType, "bootstrap_ceo"),
            eq(invites.tokenHash, bootstrapInviteCache.tokenHash),
            isNull(invites.revokedAt),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, now),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0) > 0);

      if (stillActive) {
        const baseUrl = resolveBaseUrl(req);
        res.json({
          inviteUrl: `${baseUrl}/invite/${bootstrapInviteCache.token}`,
          expiresAt: bootstrapInviteCache.expiresAt.toISOString(),
          rotated: false,
        });
        return;
      }
      bootstrapInviteCache = null;
    }

    await db
      .update(invites)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(invites.inviteType, "bootstrap_ceo"),
          isNull(invites.revokedAt),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now),
        ),
      );

    const token = createInviteToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.insert(invites).values({
      inviteType: "bootstrap_ceo",
      tokenHash,
      allowedJoinTypes: "human",
      expiresAt,
      invitedByUserId: "system",
    });
    bootstrapInviteCache = { token, tokenHash, expiresAt };

    const baseUrl = resolveBaseUrl(req);
    res.json({
      inviteUrl: `${baseUrl}/invite/${token}`,
      expiresAt: expiresAt.toISOString(),
      rotated: true,
    });
  });

  return router;
}
