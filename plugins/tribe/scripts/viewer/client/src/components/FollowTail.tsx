// client/src/components/FollowTail.tsx — the "⇣ follow live" pill (spec §8.1, §8.3). Shown when the
// user has scrolled out of the 32-pixel bottom band; clicking it resumes following the tail.
export function FollowTail({ onResume }: { onResume: () => void }) {
  return (
    <button
      type="button"
      data-testid="follow-pill"
      className="pill"
      onClick={onResume}
      style={{ background: 'var(--accent)', color: 'var(--paper)', borderRadius: 'var(--radius-8)' }}
    >
      ⇣ follow live
    </button>
  );
}
