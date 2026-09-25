---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2537@v1:sha256:a982a1c4a40cb0160457914dd8a54cc34d6d570f2cb5f8ced90449550a9d0067
---
ts
// REQUIRED: on a timeout, the aborted stream's own eventual settlement still triggers a restore pass (see the `void sessionPromise.then(...)` line in the block above) — a write that lands after the race resolves is not left unrestored.
async function raceWallClock(
  sessionPromise: Promise<OneShotSessionResult>,
  timeoutMs: number | undefined,
  abortController: AbortController,
): Promise<OneShotSessionResult> {
  if (timeoutMs === undefined) return sessionPromise;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<OneShotSessionResult>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve({
        outcome: 'timeout',
        sessionId: null,
        finalText: `session exceeded the ${timeoutMs}ms wall-clock timeout`,
        usage: null,
        totalCostUsd: null,
        permissionDenials: null,
      });
    }, timeoutMs);
  });
  try {
    return await Promise.race([sessionPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
