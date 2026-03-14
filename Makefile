.PHONY: bootstrap build install deploy run remote remote-log status reset fresh-start save force-publish

SHELL := /bin/bash

PNPM_VERSION := 9.15.4
LOCAL_BIN ?= $(HOME)/.local/bin
BUILD_DIR := $(CURDIR)/build
DEPLOY_ROOT := /opt/teamclaw
DEPLOY_CURRENT := $(DEPLOY_ROOT)/current
CLINE_OCA_SRC := $(CURDIR)/packages/adapters/cline-local/bin/cline-local
CLINE_OCA_DST := $(LOCAL_BIN)/cline-local
OCA_LOCAL_SRC := $(CURDIR)/packages/adapters/oca-local/bin/oca-local
OCA_LOCAL_DST := $(LOCAL_BIN)/oca-local
TEAMCLAW_INSTANCE_DIR := $(HOME)/.teamclaw/instances/default
TEAMCLAW_DB_DIR := $(TEAMCLAW_INSTANCE_DIR)/db
TEAMCLAW_DB_PID_FILE := $(TEAMCLAW_DB_DIR)/postmaster.pid
TEAMCLAW_SYSTEMD_SERVICE ?= teamclaw.service
TEAMCLAW_SYSTEMD_UNIT_SRC := $(CURDIR)/deploy/systemd/teamclaw.service
TEAMCLAW_SYSTEMD_UNIT_DST := /etc/systemd/system/$(TEAMCLAW_SYSTEMD_SERVICE)
REMOTE_HOST ?= TeamClawBot
REMOTE_REPO_DIR ?= /home/ubuntu/teamclaw
REMOTE_LOG_LINES ?= 120
REMOTE_SYNC_EXCLUDES := \
	--exclude .git \
	--exclude node_modules \
	--exclude build \
	--exclude debug.log \
	--exclude .DS_Store \
	--exclude .pnpm-store

define resolve_pnpm
	PNPM_CMD="pnpm"; \
	if ! command -v pnpm >/dev/null 2>&1; then \
		if command -v corepack >/dev/null 2>&1; then \
			echo "pnpm not found; enabling via corepack..."; \
			corepack enable; \
			corepack prepare pnpm@$(PNPM_VERSION) --activate; \
		else \
			echo "pnpm not found; using npx pnpm@$(PNPM_VERSION) fallback..."; \
			PNPM_CMD="npx -y pnpm@$(PNPM_VERSION)"; \
		fi; \
	fi
endef

define stop_teamclaw_service
	set -e; \
	if command -v systemctl >/dev/null 2>&1; then \
		if ! command -v sudo >/dev/null 2>&1; then \
			echo "sudo is required to stop $(TEAMCLAW_SYSTEMD_SERVICE)."; \
			exit 1; \
		fi; \
		if sudo systemctl status "$(TEAMCLAW_SYSTEMD_SERVICE)" >/dev/null 2>&1; then \
			echo "Stopping systemd service $(TEAMCLAW_SYSTEMD_SERVICE)"; \
			sudo systemctl stop "$(TEAMCLAW_SYSTEMD_SERVICE)"; \
		else \
			echo "Systemd service $(TEAMCLAW_SYSTEMD_SERVICE) is not running."; \
		fi; \
	else \
		echo "systemctl is not available on this machine."; \
	fi
endef

define install_cline_oca
	@mkdir -p "$(LOCAL_BIN)"
	@ln -sf "$(CLINE_OCA_SRC)" "$(CLINE_OCA_DST)"
	@echo "Installed cline-local -> $(CLINE_OCA_DST)"
	@ln -sf "$(OCA_LOCAL_SRC)" "$(OCA_LOCAL_DST)"
	@echo "Installed oca-local -> $(OCA_LOCAL_DST)"
	@if ! printf '%s' "$$PATH" | tr ':' '\n' | grep -qx "$(LOCAL_BIN)"; then \
		echo "Warning: $(LOCAL_BIN) is not on PATH for this shell."; \
		echo "Add this to your shell profile:"; \
		echo "  export PATH=\"$(LOCAL_BIN):\$$PATH\""; \
	fi
endef

bootstrap:
	$(install_cline_oca)
	@set -e; \
	TEAMCLAW_INSTANCE_DIR="$(TEAMCLAW_INSTANCE_DIR)" \
	TEAMCLAW_DB_PID_FILE="$(TEAMCLAW_DB_PID_FILE)" \
	PNPM_VERSION="$(PNPM_VERSION)" \
	./bootstrap.sh

build: bootstrap
	@set -e; \
	$(resolve_pnpm); \
	if [ -z "$$BETTER_AUTH_SECRET" ] && [ -z "$$TEAMCLAW_AGENT_JWT_SECRET" ]; then \
		export TEAMCLAW_AGENT_JWT_SECRET="teamclaw-dev-secret"; \
	fi; \
	export TEAMCLAW_DEPLOYMENT_MODE="authenticated"; \
	export TEAMCLAW_DEPLOYMENT_EXPOSURE="private"; \
	export TEAMCLAW_AUTH_BASE_URL_MODE="auto"; \
	export TEAMCLAW_MIGRATION_PROMPT="never"; \
	echo "[teamclaw] building server package"; \
	$$PNPM_CMD -r build; \
	$$PNPM_CMD --filter @teamclawai/server prepare:ui-dist; \
	rm -rf "$(BUILD_DIR)"; \
	rm -rf "$(CURDIR)/server/build"; \
	$$PNPM_CMD --filter @teamclawai/server --prod deploy "$(BUILD_DIR)/server"; \
	cp -R "$(CURDIR)/skills" "$(BUILD_DIR)/skills"; \
	cp -R "$(CURDIR)/roles" "$(BUILD_DIR)/roles"; \
	if [ -d "$(CURDIR)/tools" ]; then cp -R "$(CURDIR)/tools" "$(BUILD_DIR)/tools"; fi; \
	echo "[teamclaw] build bundle prepared at $(BUILD_DIR)"

install:
	@set -e; \
	echo "[teamclaw] installing systemd service $(TEAMCLAW_SYSTEMD_SERVICE) with sudo"; \
	if ! command -v systemctl >/dev/null 2>&1; then \
		echo "systemctl is not available on this machine."; \
		exit 1; \
	fi; \
	if ! command -v sudo >/dev/null 2>&1; then \
		echo "sudo is required for make run."; \
		exit 1; \
	fi; \
	if [ ! -f "$(TEAMCLAW_SYSTEMD_UNIT_SRC)" ]; then \
		echo "Missing systemd unit template at $(TEAMCLAW_SYSTEMD_UNIT_SRC)"; \
		exit 1; \
	fi; \
	sudo touch /var/log/teamclaw.log; \
	sudo chown ubuntu:ubuntu /var/log/teamclaw.log; \
	sudo chmod 664 /var/log/teamclaw.log; \
	sudo cp "$(TEAMCLAW_SYSTEMD_UNIT_SRC)" "$(TEAMCLAW_SYSTEMD_UNIT_DST)"; \
	sudo systemctl daemon-reload; \
	sudo systemctl enable "$(TEAMCLAW_SYSTEMD_SERVICE)"

deploy:
	@set -e; \
	echo "[teamclaw] deploying build snapshot to $(DEPLOY_CURRENT) with sudo"; \
	if [ ! -d "$(BUILD_DIR)/server" ]; then \
		echo "Build snapshot missing at $(BUILD_DIR). Run 'make build' first."; \
		exit 1; \
	fi; \
	if ! command -v sudo >/dev/null 2>&1; then \
		echo "sudo is required for make deploy."; \
		exit 1; \
	fi; \
	sudo mkdir -p "$(DEPLOY_ROOT)"; \
	sudo rm -rf "$(DEPLOY_CURRENT)"; \
	sudo mkdir -p "$(DEPLOY_CURRENT)"; \
	sudo cp -R "$(BUILD_DIR)/." "$(DEPLOY_CURRENT)/"; \
	sudo chown -R ubuntu:ubuntu "$(DEPLOY_CURRENT)"; \
	echo "[teamclaw] deploy snapshot updated at $(DEPLOY_CURRENT)"

run:
	@set -e; \
	echo "[teamclaw] reloading and restarting systemd service $(TEAMCLAW_SYSTEMD_SERVICE) with sudo"; \
	if ! command -v systemctl >/dev/null 2>&1; then \
		echo "systemctl is not available on this machine."; \
		exit 1; \
	fi; \
	if ! command -v sudo >/dev/null 2>&1; then \
		echo "sudo is required for make run."; \
		exit 1; \
	fi; \
	if [ ! -f "$(TEAMCLAW_SYSTEMD_UNIT_DST)" ]; then \
		echo "Systemd unit $(TEAMCLAW_SYSTEMD_SERVICE) is not installed. Run 'make install' first."; \
		exit 1; \
	fi; \
	if [ ! -d "$(DEPLOY_CURRENT)/server" ]; then \
		echo "Deploy snapshot missing at $(DEPLOY_CURRENT). Run 'make deploy' first."; \
		exit 1; \
	fi; \
	sudo systemctl daemon-reload; \
	sudo systemctl restart "$(TEAMCLAW_SYSTEMD_SERVICE)"; \
	sudo systemctl --no-pager --full status "$(TEAMCLAW_SYSTEMD_SERVICE)" || true

remote:
	@set -e; \
	echo "[teamclaw] syncing repository to $(REMOTE_HOST):$(REMOTE_REPO_DIR)"; \
	if ! command -v rsync >/dev/null 2>&1; then \
		echo "rsync is required for make remote."; \
		exit 1; \
	fi; \
	if ! command -v ssh >/dev/null 2>&1; then \
		echo "ssh is required for make remote."; \
		exit 1; \
	fi; \
	RESOLVED_HOST="$$(ssh -G "$(REMOTE_HOST)" 2>/dev/null | awk '/^hostname / { print $$2; exit }')"; \
	if [ -z "$$RESOLVED_HOST" ]; then \
		echo "Could not resolve SSH target for $(REMOTE_HOST)."; \
		echo "Set REMOTE_HOST to an SSH alias or explicit host, for example:"; \
		echo "  make remote REMOTE_HOST=ubuntu@1.2.3.4"; \
		exit 1; \
	fi; \
	if [ "$$RESOLVED_HOST" = "$$(printf '%s' "$(REMOTE_HOST)" | tr '[:upper:]' '[:lower:]')" ]; then \
		echo "Warning: $(REMOTE_HOST) is not defined in ~/.ssh/config on this machine."; \
		echo "SSH is falling back to hostname '$$RESOLVED_HOST'."; \
		echo "If DNS does not resolve that host, run:"; \
		echo "  make remote REMOTE_HOST=ubuntu@<server-ip-or-dns>"; \
	fi; \
	ssh "$(REMOTE_HOST)" "mkdir -p '$(REMOTE_REPO_DIR)'"; \
	rsync -azc --delete $(REMOTE_SYNC_EXCLUDES) ./ "$(REMOTE_HOST):$(REMOTE_REPO_DIR)/"; \
	echo "[teamclaw] running remote bootstrap/build/install/deploy/run on $(REMOTE_HOST)"; \
	ssh -t "$(REMOTE_HOST)" "cd '$(REMOTE_REPO_DIR)' && make fresh-start"

remote-log:
	@set -e; \
	echo "[teamclaw] fetching remote logs from $(REMOTE_HOST)"; \
	if ! command -v ssh >/dev/null 2>&1; then \
		echo "ssh is required for make remote-log."; \
		exit 1; \
	fi; \
	ssh -t "$(REMOTE_HOST)" "\
		echo '=== journalctl ($(TEAMCLAW_SYSTEMD_SERVICE)) ==='; \
		sudo journalctl -u '$(TEAMCLAW_SYSTEMD_SERVICE)' -n '$(REMOTE_LOG_LINES)' --no-pager || true; \
		echo; \
		echo '=== /var/log/teamclaw.log ==='; \
		sudo tail -n '$(REMOTE_LOG_LINES)' /var/log/teamclaw.log || true \
	"

status:
	@set -e; \
	echo "[teamclaw] showing systemd service status for $(TEAMCLAW_SYSTEMD_SERVICE) with sudo"; \
	if ! command -v systemctl >/dev/null 2>&1; then \
		echo "systemctl is not available on this machine."; \
		exit 1; \
	fi; \
	if ! command -v sudo >/dev/null 2>&1; then \
		echo "sudo is required for make status."; \
		exit 1; \
	fi; \
	sudo systemctl --no-pager --full status "$(TEAMCLAW_SYSTEMD_SERVICE)"

reset:
	@set -e; \
	echo "Resetting local TeamClaw dev state..."; \
	$(stop_teamclaw_service); \
	rm -rf "$(HOME)/.teamclaw/instances/default/db"; \
	echo "Reset complete."; \
	echo "Fresh start flow: make build && make install && make deploy && make bootstrap && make run"

fresh-start:
	@set -e; \
	$(MAKE) bootstrap; \
	$(MAKE) build; \
	$(MAKE) install; \
	$(MAKE) deploy; \
	$(MAKE) reset; \
	$(MAKE) bootstrap; \
	$(MAKE) run


save:
	@set -e; \
	BRANCH="$$(git branch --show-current)"; \
	if [ "$$BRANCH" != "main" ]; then \
		echo "make save only pushes main. Current branch: $$BRANCH"; \
		echo "Checkout main first, then run make save."; \
		exit 1; \
	fi; \
	git add .; \
	git commit -m "saving point" || true; \
	git push -f origin main

force-publish:
	@set -e; \
	BRANCH="$$(git branch --show-current)"; \
	if [ -z "$$BRANCH" ]; then \
		echo "Could not determine current branch."; \
		exit 1; \
	fi; \
	echo "This will rewrite local and remote history for branch '$$BRANCH' to a single commit."; \
	read -r -p "Enter commit comment/message: " MSG; \
	if [ -z "$$MSG" ]; then \
		echo "Commit message is required. Aborting."; \
		exit 1; \
	fi; \
	read -r -p "Type 'yes' to continue: " CONFIRM; \
	if [ "$$CONFIRM" != "yes" ]; then \
		echo "Aborted."; \
		exit 1; \
	fi; \
	git add -A; \
	NEW_COMMIT="$$(git commit-tree "$$(git write-tree)" -m "$$MSG")"; \
	git reset --hard "$$NEW_COMMIT"; \
	git push -f origin "$$BRANCH"; \
	echo "Force-publish complete for branch '$$BRANCH'."
