/**
 * Runs once when a Next.js server instance starts.
 * We use it to drive the automatic-backup schedule.
 */
export async function register() {
  // fs/timers only exist on the Node runtime, and the scheduler must not run
  // in the Edge runtime (or twice, once per runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runAutoBackup } = await import("./lib/backup-server");

  // Check every 5 minutes; runAutoBackup() no-ops until the configured
  // interval has actually elapsed, so this is cheap. Checking on a short
  // tick (rather than sleeping for the full interval) means a backup still
  // happens soon after a restart that spanned its due time.
  const TICK_MS = 5 * 60_000;

  const tick = () => {
    try {
      const file = runAutoBackup();
      if (file) console.log(`[backup] automatic snapshot written: ${file.name}`);
    } catch (e) {
      console.error("[backup] scheduler error", e);
    }
  };

  tick();                                      // catch up on anything overdue
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();                             // never hold the process open
}
