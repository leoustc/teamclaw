export const type = "oca_local";
export const label = "OCA Local";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# oca_local agent configuration

Adapter: oca_local

Use when:
- You want TeamClaw to run Oracle Code Assist locally via the oca-local CLI wrapper
- You want a simple local CLI adapter with a TeamClaw-managed working directory
- You want TeamClaw to list configured OCA models through the same local command used for execution

Core fields:
- cwd (string, optional): absolute working directory for the agent process
- instructionsFilePath (string, optional): markdown instructions file prepended to the prompt
- promptTemplate (string, optional): task prompt template
- model (string, optional): explicit model override passed through to \`cline -m\`
- thinking (string, optional): reasoning effort passed through to \`cline --reasoning-effort\`
- command (string, optional): defaults to "oca-local"
- env (object, optional): environment variables injected into the process

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- TeamClaw uses \`oca-local prompt\` underneath.
- Model discovery uses \`oca-local list-models\`.
- If \`model\` is blank, Cline's local default model is used.
`;
