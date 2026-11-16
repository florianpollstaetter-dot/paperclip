/**
 * Keep the row a reader is looking at in place while a message list changes
 * underneath it.
 *
 * The issue page auto-loads older comment pages and prepends them above the
 * viewport. Chrome's scroll anchoring usually hides the resulting shift, but
 * WebKit (iOS Safari) has no scroll anchoring and Chrome loses its anchor when
 * the list re-renders differently — the page visibly "jumps" to older content
 * every time a page arrives. These helpers snapshot the first visible anchored
 * row before the DOM changes and scroll by its displacement afterwards.
 * Browsers that already anchored report a delta of ~0, so nothing is applied
 * twice.
 */

export interface ThreadScrollAnchorSnapshot {
  id: string;
  top: number;
}

export const THREAD_SCROLL_ANCHOR_ATTR = "data-scroll-anchor-id";

/** Nearest ancestor that actually scrolls vertically; null means the window. */
export function findThreadScrollContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element || typeof window === "undefined") return null;
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      && current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function anchoredRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[${THREAD_SCROLL_ANCHOR_ATTR}]`));
}

/** Call before the DOM changes (e.g. from `getSnapshotBeforeUpdate`). */
export function captureThreadScrollAnchor(container: HTMLElement | null): ThreadScrollAnchorSnapshot | null {
  if (!container || typeof window === "undefined") return null;
  const scroller = findThreadScrollContainer(container);
  const viewportTop = scroller ? scroller.getBoundingClientRect().top : 0;
  for (const row of anchoredRows(container)) {
    const rect = row.getBoundingClientRect();
    if (rect.height <= 0) continue;
    if (rect.bottom >= viewportTop) {
      const id = row.getAttribute(THREAD_SCROLL_ANCHOR_ATTR);
      if (!id) continue;
      return { id, top: rect.top };
    }
  }
  return null;
}

/**
 * Call after the DOM changed. Returns false when the anchored row is gone, so
 * the caller can fall back to its own positioning.
 */
export function restoreThreadScrollAnchor(
  snapshot: ThreadScrollAnchorSnapshot | null,
  container: HTMLElement | null,
): boolean {
  if (!snapshot || !container || typeof window === "undefined") return false;
  const row = anchoredRows(container).find((el) => el.getAttribute(THREAD_SCROLL_ANCHOR_ATTR) === snapshot.id);
  if (!row) return false;
  const delta = row.getBoundingClientRect().top - snapshot.top;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) return true;
  const scroller = findThreadScrollContainer(container);
  if (scroller) {
    scroller.scrollTop += delta;
    return true;
  }
  const docStyle = window.getComputedStyle(document.documentElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const clipped = (v: string) => v === "hidden" || v === "clip";
  if (clipped(docStyle.overflowY) || clipped(bodyStyle.overflowY) || clipped(bodyStyle.overflow)) return true;
  window.scrollBy({ top: delta, left: 0, behavior: "auto" });
  return true;
}
