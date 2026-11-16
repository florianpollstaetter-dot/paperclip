// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  THREAD_SCROLL_ANCHOR_ATTR,
  captureThreadScrollAnchor,
  restoreThreadScrollAnchor,
} from "./thread-scroll-anchor";

function mockRect(element: HTMLElement, top: number, height = 48) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}),
  } as DOMRect);
}

function buildRows(container: HTMLElement, rows: Array<{ id: string; top: number }>) {
  for (const row of rows) {
    const element = document.createElement("div");
    element.setAttribute(THREAD_SCROLL_ANCHOR_ATTR, row.id);
    mockRect(element, row.top);
    container.appendChild(element);
  }
}

describe("thread-scroll-anchor", () => {
  it("captures the first row still inside the viewport and restores via window scroll", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    buildRows(container, [{ id: "a", top: -400 }, { id: "b", top: -20 }, { id: "c", top: 120 }]);

    const snapshot = captureThreadScrollAnchor(container);
    expect(snapshot).toEqual({ id: "b", top: -20 });

    // Older rows were inserted above: row b moved 1200px down.
    const b = container.querySelector(`[${THREAD_SCROLL_ANCHOR_ATTR}="b"]`) as HTMLElement;
    mockRect(b, 1180);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(restoreThreadScrollAnchor(snapshot, container)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 1200, left: 0, behavior: "auto" });
    scrollBy.mockRestore();
    container.remove();
  });

  it("does nothing when the browser already anchored (delta ~0) and reports missing rows", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    buildRows(container, [{ id: "b", top: 10 }]);
    const snapshot = captureThreadScrollAnchor(container);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(restoreThreadScrollAnchor(snapshot, container)).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    container.innerHTML = "";
    expect(restoreThreadScrollAnchor(snapshot, container)).toBe(false);
    expect(restoreThreadScrollAnchor(null, container)).toBe(false);
    scrollBy.mockRestore();
    container.remove();
  });

  it("scrolls the nearest scrolling ancestor instead of the window (desktop scroller)", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    mockRect(scroller, 100, 600);
    scroller.scrollTop = 0;
    document.body.appendChild(scroller);
    const container = document.createElement("div");
    scroller.appendChild(container);
    // Row a ends above the scroller's top edge (100), row b is the first visible one.
    buildRows(container, [{ id: "a", top: 0 }, { id: "b", top: 140 }]);

    const snapshot = captureThreadScrollAnchor(container);
    expect(snapshot).toEqual({ id: "b", top: 140 });
    mockRect(container.querySelector(`[${THREAD_SCROLL_ANCHOR_ATTR}="b"]`) as HTMLElement, 440);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(restoreThreadScrollAnchor(snapshot, container)).toBe(true);
    expect(scroller.scrollTop).toBe(300);
    expect(scrollBy).not.toHaveBeenCalled();
    scrollBy.mockRestore();
    scroller.remove();
  });
});

describe("keepThreadScrollAnchored", () => {
  function setScrollY(value: number) {
    Object.defineProperty(window, "scrollY", { value, configurable: true, writable: true });
  }
  function installResizeObserver() {
    const callbacks: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(cb: () => void) { callbacks.push(cb); }
      observe() {}
      disconnect() { callbacks.length = 0; }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    return { fire: () => callbacks.slice().forEach((cb) => cb()), uninstall: () => { delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver; } };
  }

  it("scrolls the row at the top of the viewport back into place when content above grows", async () => {
    const { keepThreadScrollAnchored } = await import("./thread-scroll-anchor");
    const ro = installResizeObserver();
    const container = document.createElement("div");
    document.body.appendChild(container);
    buildRows(container, [{ id: "a", top: -900 }, { id: "b", top: 40 }, { id: "c", top: 400 }]);
    const b = container.querySelector(`[${THREAD_SCROLL_ANCHOR_ATTR}="b"]`) as HTMLElement;
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    const release = keepThreadScrollAnchored(container);
    mockRect(b, 540); // the header above the rows rendered late, 500px tall
    ro.fire();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 500, left: 0, behavior: "auto" });
    ro.fire(); // nothing moved since the last record
    expect(scrollBy).toHaveBeenCalledTimes(1);

    // The reader scrolls on by 640px: the row now at the top becomes the anchor.
    setScrollY(640);
    mockRect(b, -600);
    const c = container.querySelector(`[${THREAD_SCROLL_ANCHOR_ATTR}="c"]`) as HTMLElement;
    mockRect(c, 20);
    window.dispatchEvent(new Event("scroll"));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    mockRect(c, 320);
    ro.fire();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 300, left: 0, behavior: "auto" });

    release();
    mockRect(c, 900);
    ro.fire();
    expect(scrollBy).toHaveBeenCalledTimes(2);
    scrollBy.mockRestore();
    setScrollY(0);
    ro.uninstall();
    container.remove();
  });

  it("compensates a shift that lands before the next scroll event instead of absorbing it", async () => {
    const { keepThreadScrollAnchored } = await import("./thread-scroll-anchor");
    const ro = installResizeObserver();
    const container = document.createElement("div");
    document.body.appendChild(container);
    buildRows(container, [{ id: "a", top: -900 }, { id: "b", top: 40 }]);
    const b = container.querySelector(`[${THREAD_SCROLL_ANCHOR_ATTR}="b"]`) as HTMLElement;
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const release = keepThreadScrollAnchored(container);

    // Rows above re-measure while no scrolling happened: the scroll event
    // (or the idle timer) runs before the resize callback and must not take
    // the displaced position as the new anchor.
    mockRect(b, 136);
    window.dispatchEvent(new Event("scroll"));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 96, left: 0, behavior: "auto" });
    ro.fire();
    expect(scrollBy).toHaveBeenCalledTimes(1);

    release();
    scrollBy.mockRestore();
    ro.uninstall();
    container.remove();
  });

  it("is a no-op without ResizeObserver support", async () => {
    const { keepThreadScrollAnchored } = await import("./thread-scroll-anchor");
    const container = document.createElement("div");
    document.body.appendChild(container);
    buildRows(container, [{ id: "b", top: 40 }]);
    const release = keepThreadScrollAnchored(container);
    expect(typeof release).toBe("function");
    release();
    container.remove();
  });
});
