// client/src/components/LoadEarlier.tsx — the back-fill button (spec §8.1, §6.3). Rendered at the
// head of the window when more history precedes it (`truncatedBefore`); clicking it asks the store
// to load the previous range. Disabled while a fetch is in flight so a double-click cannot issue
// two overlapping back-fills.
export function LoadEarlier({ onLoad, busy }: { onLoad: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      data-testid="load-earlier"
      className="load-earlier"
      onClick={onLoad}
      disabled={busy}
      style={{ color: 'var(--accent)' }}
    >
      {busy ? 'loading…' : 'load earlier'}
    </button>
  );
}
