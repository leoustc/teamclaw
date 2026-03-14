import { createRequire } from "node:module";
import { spawn } from "node:child_process";

type PamAuthenticateOptions = {
  serviceName?: string;
};

type PamModule = {
  authenticate(
    username: string,
    password: string,
    cb: (err: Error | null) => void,
    options?: PamAuthenticateOptions,
  ): void;
};

const require = createRequire(import.meta.url);

function getPamModule(): PamModule | null {
  try {
    return require("authenticate-pam") as PamModule;
  } catch {
    return null;
  }
}

async function authenticateWithPamtester(input: {
  username: string;
  password: string;
  serviceName: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pamtester", [input.serviceName, input.username, "authenticate"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "PAM backend unavailable. Install authenticate-pam build deps or install pamtester.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || "Invalid PAM credentials"));
    });

    child.stdin.write(`${input.password}\n`);
    child.stdin.end();
  });
}

export async function authenticateWithPam(input: {
  username: string;
  password: string;
  serviceName: string;
}): Promise<void> {
  const pam = getPamModule();
  if (pam) {
    await new Promise<void>((resolve, reject) => {
      pam.authenticate(
        input.username,
        input.password,
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        },
        { serviceName: input.serviceName },
      );
    });
    return;
  }

  await authenticateWithPamtester(input);
}

export function normalizePamUsername(raw: string) {
  return raw.trim().toLowerCase();
}

export function assertPamUsername(raw: string) {
  const username = normalizePamUsername(raw);
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/.test(username)) {
    throw new Error("Invalid username format");
  }
  return username;
}
