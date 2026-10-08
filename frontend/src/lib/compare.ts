/** Position (0–100 %) of the compare divider for a pointer at `clientX` over `rect`. */
export function comparePosition(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 50;
  const percent = ((clientX - rect.left) / rect.width) * 100;
  return Math.min(100, Math.max(0, percent));
}
