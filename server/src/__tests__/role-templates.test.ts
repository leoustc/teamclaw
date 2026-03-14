import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedRoleTemplateFiles } from "../role-templates.js";

const tempRoots: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("seedRoleTemplateFiles", () => {
  it("copies bundled role files into the agent workspace and sets instructionsFilePath", async () => {
    const templateRoot = await makeTempDir("role-templates-");
    const cwd = await makeTempDir("role-workspace-");
    const roleDir = path.join(templateRoot, "manager");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "AGENTS.md"), "manager agents", "utf8");
    await fs.writeFile(path.join(roleDir, "HEARTBEAT.md"), "manager heartbeat", "utf8");

    const result = await seedRoleTemplateFiles({
      role: "manager",
      cwd,
      adapterConfig: {},
      instructionsFilePathKey: "instructionsFilePath",
      templateRoot,
    });

    expect(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8")).toBe("manager agents");
    expect(await fs.readFile(path.join(cwd, "HEARTBEAT.md"), "utf8")).toBe("manager heartbeat");
    expect(result).toMatchObject({
      instructionsFilePath: path.join(cwd, "AGENTS.md"),
    });
  });

  it("does not overwrite existing workspace files or existing instructions path", async () => {
    const templateRoot = await makeTempDir("role-templates-");
    const cwd = await makeTempDir("role-workspace-");
    const roleDir = path.join(templateRoot, "engineer");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "AGENTS.md"), "template", "utf8");
    await fs.writeFile(path.join(cwd, "AGENTS.md"), "existing", "utf8");

    const result = await seedRoleTemplateFiles({
      role: "engineer",
      cwd,
      adapterConfig: { instructionsFilePath: "/tmp/custom.md" },
      instructionsFilePathKey: "instructionsFilePath",
      templateRoot,
    });

    expect(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8")).toBe("existing");
    expect(result).toMatchObject({
      instructionsFilePath: "/tmp/custom.md",
    });
  });
});
