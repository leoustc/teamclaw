(function () {
  class TerminalJS {
    constructor(opts) {
      this.container = opts.container;
      this.wsUrl = opts.wsUrl;
      this.cwd = opts.cwd || "~";
      this.socket = null;
      this.outputEl = null;
      this.inputEl = null;
      this.statusEl = null;
    }

    mount() {
      this.container.innerHTML = "";
      this.container.className = "terminaljs-root";

      const status = document.createElement("div");
      status.className = "terminaljs-status";
      status.textContent = "Connecting...";

      const output = document.createElement("pre");
      output.className = "terminaljs-output";
      output.textContent = `TeamClaw Web Terminal\\nStarting in ${this.cwd}\\n\\n`;

      const promptRow = document.createElement("div");
      promptRow.className = "terminaljs-prompt-row";

      const prompt = document.createElement("span");
      prompt.className = "terminaljs-prompt";
      prompt.textContent = "$";

      const input = document.createElement("input");
      input.className = "terminaljs-input";
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;

      promptRow.appendChild(prompt);
      promptRow.appendChild(input);

      this.container.appendChild(status);
      this.container.appendChild(output);
      this.container.appendChild(promptRow);

      this.outputEl = output;
      this.inputEl = input;
      this.statusEl = status;

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const cmd = input.value;
          input.value = "";
          this.write(`$ ${cmd}\\n`);
          this.sendInput(cmd + "\\n");
          return;
        }

        if (e.ctrlKey && e.key.toLowerCase() === "c") {
          this.sendInput("\\u0003");
          this.write("^C\\n");
          e.preventDefault();
        }
      });

      this.connect();
      input.focus();
    }

    connect() {
      this.socket = new WebSocket(this.wsUrl);

      this.socket.addEventListener("open", () => {
        this.setStatus("Connected");
      });

      this.socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          this.write(String(event.data));
          return;
        }

        if (message.type === "ready") {
          this.setStatus(`Connected (${message.cwd || this.cwd})`);
          return;
        }

        if (message.type === "output") {
          this.write(String(message.data || ""));
          return;
        }

        if (message.type === "exit") {
          this.setStatus(`Exited (${message.code ?? "?"})`);
        }
      });

      this.socket.addEventListener("close", () => {
        this.setStatus("Disconnected");
      });

      this.socket.addEventListener("error", () => {
        this.setStatus("Connection error");
      });
    }

    sendInput(data) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: "input", data }));
    }

    write(text) {
      if (!this.outputEl) return;
      this.outputEl.textContent += text;
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }

    setStatus(text) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
    }

    destroy() {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.container.innerHTML = "";
    }
  }

  window.TerminalJS = TerminalJS;
})();
