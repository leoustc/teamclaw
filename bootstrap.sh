#!/usr/bin/env bash
set -euo pipefail

PNPM_VERSION="${PNPM_VERSION:-9.15.4}"
TEAMCLAW_INSTANCE_DIR="${TEAMCLAW_INSTANCE_DIR:-$HOME/.teamclaw/instances/default}"
TEAMCLAW_DB_PID_FILE="${TEAMCLAW_DB_PID_FILE:-$TEAMCLAW_INSTANCE_DIR/db/postmaster.pid}"

PNPM_CMD="pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "pnpm not found; enabling via corepack..."
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  else
    echo "pnpm not found; using npx pnpm@${PNPM_VERSION} fallback..."
    PNPM_CMD="npx -y pnpm@${PNPM_VERSION}"
  fi
fi

mkdir -p "${TEAMCLAW_INSTANCE_DIR}"
if [[ -f "${TEAMCLAW_DB_PID_FILE}" ]]; then
  DB_PID="$(head -n 1 "${TEAMCLAW_DB_PID_FILE}" | tr -d '[:space:]')"
  if [[ -n "${DB_PID}" ]] && ! kill -0 "${DB_PID}" >/dev/null 2>&1; then
    echo "Removing stale embedded PostgreSQL lock file at ${TEAMCLAW_DB_PID_FILE}"
    rm -f "${TEAMCLAW_DB_PID_FILE}"
  fi
fi

if [[ -z "${BETTER_AUTH_SECRET:-}" && -z "${TEAMCLAW_AGENT_JWT_SECRET:-}" ]]; then
  export TEAMCLAW_AGENT_JWT_SECRET="teamclaw-dev-secret"
  echo "No auth secret found; using TEAMCLAW_AGENT_JWT_SECRET=teamclaw-dev-secret for local dev."
fi

${PNPM_CMD} install

if ! node -e "require('authenticate-pam')" >/dev/null 2>&1 && ! command -v pamtester >/dev/null 2>&1; then
  echo "No PAM backend available."
  echo "Use either option:"
  echo "  1) Install build deps for authenticate-pam:"
  echo "     sudo apt-get install -y build-essential libpam0g-dev python3 make g++"
  echo "     ${PNPM_CMD} install"
  echo "  2) Install pamtester (no native module compile needed):"
  echo "     sudo apt-get install -y pamtester"
  exit 1
fi
