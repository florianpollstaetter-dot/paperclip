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

/** The anchored row with this id, or null once it left the DOM. */
export function findThreadAnchorRow(container: HTMLElement | null, id: string): HTMLElement | null {
  if (!container) return null;
  return anchoredRows(container).find((el) => el.getAttribute(THREAD_SCROLL_ANCHOR_ATTR) === id) ?? null;
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

function scrollThreadBy(scroller: HTMLElement | null, delta: number): void {
  if (scroller) {
    scroller.scrollTop += delta;
    return;
  }
  const docStyle = window.getComputedStyle(document.documentElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const clipped = (v: string) => v === "hidden" || v === "clip";
  if (clipped(docStyle.overflowY) || clipped(bodyStyle.overflowY) || clipped(bodyStyle.overflow)) return;
  window.scrollBy({ top: delta, left: 0, behavior: "auto" });
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
  const row = findThreadAnchorRow(container, snapshot.id);
  if (!row) return false;
  const delta = row.getBoundingClientRect().top - snapshot.top;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) return true;
  scrollThreadBy(findThreadScrollContainer(container), delta);
  return true;
}

const ANCHOR_GUARD_IDLE_RECORD_MS = 250;

/**
 * JavaScript stand-in for CSS scroll anchoring, for browsers without it
 * (WebKit / iOS Safari). Content above the reader keeps changing height after
 * the list commit: the issue header and description arrive later than the
 * comments, markdown and tool cards measure after mount, images load, older
 * pages get prepended. Each time the thread or anything above it resizes, the
 * row the reader last had at the top of the viewport is scrolled back to the
 * same position.
 *
 * The anchor is re-recorded on every scroll, so a reader (or an auto-follow,
 * or the page keeper's own restore) scrolling simply moves the anchor instead
 * of fighting it. Before re-recording, a displacement of the anchored row that
 * cannot be explained by foreign scrolling is treated as a layout shift and
 * compensated first; otherwise a shift that lands between a resize callback
 * and the next scroll event would be absorbed into the new anchor (observed
 * as a residual jump of ~150 px while rows re-measure).
 *
 * Browsers with native anchoring report a delta of ~0, so this is inert there.
 * Returns a function that stops guarding.
 */
export function keepThreadScrollAnchored(container: HTMLElement | null): () => void {
  if (!container || typeof window === "undefined" || typeof ResizeObserver === "undefined") return () => {};
  let anchor: ThreadScrollAnchorSnapshot | null = null;
  let lastOffset = 0;
  let selfScrolled = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const offset = (scroller: HTMLElement | null) => (scroller ? scroller.scrollTop : window.scrollY);
  const record = (scroller: HTMLElement | null) => {
    anchor = captureThreadScrollAnchor(container);
    lastOffset = offset(scroller);
    selfScrolled = 0;
  };
  const sync = () => {
    const scroller = findThreadScrollContainer(container);
    if (anchor) {
      // Scrolling we did not cause (reader, auto-follow, keeper restore) moves
      // the anchor on purpose; only then is the old anchor dropped unchecked.
      const foreign = offset(scroller) - lastOffset - selfScrolled;
      if (Math.abs(foreign) < 1) {
        const row = findThreadAnchorRow(container, anchor.id);
        if (row) {
          const delta = row.getBoundingClientRect().top - anchor.top;
          if (Number.isFinite(delta) && Math.abs(delta) >= 1) {
            const before = offset(scroller);
            scrollThreadBy(scroller, delta);
            selfScrolled += offset(scroller) - before;
          }
        }
      }
    }
    record(scroller);
  };
  // A scroll event means the reader moved (or we did): the row now at the top
  // is the one to keep. Syncs right away and once more when scrolling is
  // quiet, so a momentum scroll ends with a fresh anchor.
  const onScroll = () => {
    sync();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(sync, ANCHOR_GUARD_IDLE_RECORD_MS);
  };
  const observer = new ResizeObserver(sync);
  // Observe the thread and everything up to the document: a header above the
  // rows growing late shifts the reader just as much as a prepended page.
  for (let el: HTMLElement | null = container; el; el = el.parentElement) {
    observer.observe(el);
    if (el === document.body) break;
  }
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  record(findThreadScrollContainer(container));
  return () => {
    observer.disconnect();
    clearTimeout(idleTimer);
    window.removeEventListener("scroll", onScroll, { capture: true });
    anchor = null;
  };
}
