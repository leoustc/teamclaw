import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  collapsed?: boolean;
  children: ReactNode;
}

export function SidebarSection({ label, collapsed = false, children }: SidebarSectionProps) {
  return (
    <div>
      {!collapsed ? (
        <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
          {label}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
    </div>
  );
}
