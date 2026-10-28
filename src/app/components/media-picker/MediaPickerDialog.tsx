import type { ReactNode } from "react";

export interface MediaPickerDialogProps {
  open: boolean;
  title?: string;
  titleId?: string;
  onClose?: () => void;
  children: ReactNode;
}

export function MediaPickerDialog({
  open,
  children,
}: MediaPickerDialogProps) {
  if (!open) return null;

  return (
    <div className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-[#141626]/95 to-[#0d0e19]/95 shadow-xl">
      {children}
    </div>
  );
}
