import { describe, expect, it, vi } from "vitest";
import { waitForPostgresConnection } from "./client.js";

describe("waitForPostgresConnection", () => {
  it("retries transient postgres startup connection failures", async () => {
    const probe = vi.fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }))
      .mockRejectedValueOnce(Object.assign(new Error("database system is starting up"), { code: "57P03" }))
      .mockResolvedValue(undefined);

    await waitForPostgresConnection("postgres://teamclaw:teamclaw@127.0.0.1:54329/postgres", {
      attempts: 3,
      delayMs: 0,
      probe,
    });

    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transient postgres errors", async () => {
    const probe = vi.fn<(_: string) => Promise<void>>()
      .mockRejectedValue(Object.assign(new Error("password authentication failed"), { code: "28P01" }));

    await expect(
      waitForPostgresConnection("postgres://teamclaw:teamclaw@127.0.0.1:54329/postgres", {
        attempts: 3,
        delayMs: 0,
        probe,
      }),
    ).rejects.toThrow("password authentication failed");

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
