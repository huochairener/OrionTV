export const SWIPE_SEEK_WINDOW_MS = 180_000;
export const SCRUB_RELEASE_THRESHOLD_MS = 1500;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

/** Map a touch on the progress bar to 0..1 of the video duration. */
export function ratioFromBarTouch(pageX: number, barX: number, barWidth: number): number {
  if (barWidth <= 0) return 0;
  return clampRatio((pageX - barX) / barWidth);
}

/**
 * Relative swipe seek. A full-screen swipe maps to min(duration, 180s)
 * so the preview follows the finger instead of jumping in fixed steps.
 */
export function ratioFromSwipe(
  startRatio: number,
  translationX: number,
  screenWidth: number,
  durationMillis: number,
  windowMs: number = SWIPE_SEEK_WINDOW_MS
): number {
  if (screenWidth <= 0 || durationMillis <= 0) return clampRatio(startRatio);
  const seekWindow = Math.min(durationMillis, windowMs);
  const deltaRatio = (translationX / screenWidth) * (seekWindow / durationMillis);
  return clampRatio(startRatio + deltaRatio);
}

export function shouldReleaseScrub(positionMillis: number, targetMillis: number): boolean {
  return Math.abs(positionMillis - targetMillis) <= SCRUB_RELEASE_THRESHOLD_MS;
}
