export type HealthStatus = {
  status: "ok";
  deploymentMode?: "local_trusted" | "authenticated";
  deploymentExposure?: "private" | "public";
  authReady?: boolean;
  bootstrapStatus?: "ready" | "bootstrap_pending";
  bootstrapInviteActive?: boolean;
  features?: {
    companyDeletionEnabled?: boolean;
  };
};

export type BootstrapInviteStatus =
  | {
      state: "invite_ready";
      inviteUrl: string;
      expiresAt: string;
      rotated: boolean;
    }
  | {
      state: "instance_ready";
    };

export const healthApi = {
  get: async (): Promise<HealthStatus> => {
    const res = await fetch("/api/health", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Failed to load health (${res.status})`);
    }
    return res.json();
  },
  ensureBootstrapInvite: async (): Promise<BootstrapInviteStatus> => {
    const res = await fetch("/api/health/bootstrap-invite", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      if (res.status === 409 && payload?.error === "Instance already has an admin user") {
        return { state: "instance_ready" };
      }
      throw new Error(payload?.error ?? `Failed to load bootstrap invite (${res.status})`);
    }
    const payload = await res.json() as {
      inviteUrl: string;
      expiresAt: string;
      rotated: boolean;
    };
    return {
      state: "invite_ready",
      inviteUrl: payload.inviteUrl,
      expiresAt: payload.expiresAt,
      rotated: payload.rotated,
    };
  },
};
