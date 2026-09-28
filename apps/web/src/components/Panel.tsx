import type { ReactNode } from 'react';

interface PanelProps {
  id: string;
  title: string;
  // Accessible name when it differs from the visible title.
  label?: string;
  as?: 'section' | 'aside';
  className?: string;
  children: ReactNode;
}

export function Panel({
  id,
  title,
  label,
  as: Tag = 'section',
  className = '',
  children,
}: PanelProps) {
  const titleId = `${id}-title`;
  return (
    <Tag
      aria-label={label}
      aria-labelledby={label ? undefined : titleId}
      className={`flex flex-col overflow-hidden rounded-panel border border-border bg-panel xl:min-h-0 ${className}`}
    >
      <h2 id={titleId} className="border-b border-divider px-4 py-3 text-[15px] font-extrabold">
        {title}
      </h2>
      <div className="flex flex-col gap-3 p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {children}
      </div>
    </Tag>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-button border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-3">
      {children}
    </p>
  );
}
