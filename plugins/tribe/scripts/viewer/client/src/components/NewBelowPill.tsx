// client/src/components/NewBelowPill.tsx — the "N new below" pill (spec §6.3, §8.1). Shown while
// the store is at its 2,000-node cap with follow-live off: incoming rows are counted rather than
// appended (a hole in the window would otherwise open mid-list), and this is the visible account of
// that count. Clicking it reloads the tail window (the same `reloadTail` the store already owns;
// wiring this pill into `RowList`'s live state is a later task, purely presentational here).
export interface NewBelowPillProps {
  count: number;
  onClick: () => void;
}

export function NewBelowPill({ count, onClick }: NewBelowPillProps) {
  return (
    <button
      type="button"
      data-testid="new-below-pill"
      className="pill pill--new-below"
      onClick={onClick}
    >
      {count} new below
    </button>
  );
}
