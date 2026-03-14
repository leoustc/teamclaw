import { useEffect, useState } from "react";
import { TerminalSquare, X } from "lucide-react";
import { useDialog } from "../context/DialogContext";
import { TerminalPage } from "../pages/Terminal";
import { cn } from "../lib/utils";

export function TerminalOverlay() {
  const { terminalOpen, closeTerminal } = useDialog();
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (terminalOpen) setHasOpened(true);
  }, [terminalOpen]);

  useEffect(() => {
    if (!terminalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTerminal();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [terminalOpen, closeTerminal]);

  if (!hasOpened) return null;

  return (
    <div
      aria-hidden={!terminalOpen}
      className={cn(
        "fixed inset-0 z-[200] bg-black transition-opacity duration-150",
        terminalOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
    >
      <div className="flex h-full w-full flex-col">
        <div className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-3">
          <div className="flex min-w-0 items-center gap-2 text-zinc-200">
            <TerminalSquare className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">System Terminal</p>
              <p className="truncate text-xs text-zinc-400 leading-tight">/home/ubuntu</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeTerminal}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
              terminalOpen ? "pointer-events-auto" : "pointer-events-none",
            )}
            aria-label="Close terminal"
            tabIndex={terminalOpen ? 0 : -1}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <TerminalPage active={terminalOpen} />
        </div>
      </div>
    </div>
  );
}
