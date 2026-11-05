/**
 * Position a trade information card inside the visible viewport.
 * Flips beside/above the pointer rather than allowing the card to overflow
 * right/bottom; cramped viewports use the nearest safe margin.
 *
 * Viewport coordinates use the same layout-viewport coordinate system as a
 * position:fixed portal, including visualViewport offsets during pinch zoom.
 */
export function placeTradeTooltip(anchor, size, viewport, gap = 14, margin = 8) {
  const finite = (v, fallback) => Number.isFinite(v) ? Number(v) : fallback;
  const left = finite(viewport.left, 0);
  const top = finite(viewport.top, 0);
  const width = Math.max(0, finite(viewport.width, 0));
  const height = Math.max(0, finite(viewport.height, 0));
  const cardWidth = Math.max(0, finite(size.width, 0));
  const cardHeight = Math.max(0, finite(size.height, 0));
  const anchorX = finite(anchor.x, left + margin);
  const anchorY = finite(anchor.y, top + margin);
  const minX = left + margin;
  const minY = top + margin;
  const maxX = Math.max(minX, left + width - margin - cardWidth);
  const maxY = Math.max(minY, top + height - margin - cardHeight);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const rightX = anchorX + gap;
  const leftX = anchorX - gap - cardWidth;
  const belowY = anchorY + gap;
  const aboveY = anchorY - gap - cardHeight;

  const x = rightX <= maxX ? rightX : leftX >= minX ? leftX : clamp(rightX, minX, maxX);
  const y = belowY <= maxY ? belowY : aboveY >= minY ? aboveY : clamp(belowY, minY, maxY);
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
}
