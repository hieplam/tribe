// client/src/components/LiveDot.tsx — spec §8.1: renders ONLY when `live` is true (§5.4's
// liveness rule computes the boolean; this component just shows it). No literal colour anywhere
// (D18/§12.6.3): the dot's own token is `--live`.
export interface LiveDotProps {
  live: boolean;
}

export function LiveDot({ live }: LiveDotProps) {
  if (!live) return null;
  return <span className="live-dot" role="status" aria-label="live" style={{ background: 'var(--live)' }} />;
}
