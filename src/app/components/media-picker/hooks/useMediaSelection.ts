import { useCallback, useEffect, useMemo, useState } from "react";
import type { MediaPickerItem } from "../MediaPicker";

export interface MediaSelectionState {
  selectedIds: ReadonlySet<string>;
  selectedItems: readonly MediaPickerItem[];
  allSelected: boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
}

export function useMediaSelection(
  items: readonly MediaPickerItem[],
  onSelectionChange?: (selectedItems: readonly MediaPickerItem[]) => void,
): MediaSelectionState {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const validIds = useMemo(
    () => new Set(items.map((item) => item.id)),
    [items],
  );

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [validIds]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.id));

  useEffect(() => {
    onSelectionChange?.(selectedItems);
  }, [onSelectionChange, selectedItems]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      if (items.length > 0 && items.every((item) => current.has(item.id)))
        return new Set();
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, selectedItems, allSelected, toggle, toggleAll, clear };
}
