// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  captureComposerViewportSnapshot,
  captureThreadScrollAnchor,
  isWindowScrollable,
  restoreComposerViewportSnapshot,
  restoreThreadScrollAnchor,
  shouldPreserveComposerViewport,
} from "./issue-chat-scroll";

function mockTop(element: HTMLElement, top: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 48,
    left: 0,
    right: 0,
    width: 0,
    height: 48,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("issue-chat-scroll", () => {
  it("restores page scroll when the composer shifts in the viewport", () => {
    const composer = document.createElement("div");
    document.body.appendChild(composer);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    mockTop(composer, 420);
    const snapshot = captureComposerViewportSnapshot(composer);

    mockTop(composer, 560);
    restoreComposerViewportSnapshot(snapshot, composer);

    expect(scrollByMock).toHaveBeenCalledWith({ top: 140, left: 0, behavior: "auto" });

    scrollByMock.mockRestore();
    composer.remove();
  });

  it("does not scroll the window when the document body is overflow:hidden (desktop shell)", () => {
    // The desktop app shell pins the body to overflow:hidden inside a fixed
    // h-dvh flex column, so a window scroll would translate the whole shell
    // (sidebar included) off-screen — paperclipai/paperclip#7972.
    const composer = document.createElement("div");
    document.body.appendChild(composer);
    document.body.style.overflow = "hidden";
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    mockTop(composer, 420);
    const snapshot = captureComposerViewportSnapshot(composer);

    mockTop(composer, 560);
    restoreComposerViewportSnapshot(snapshot, composer);

    expect(scrollByMock).not.toHaveBeenCalled();

    scrollByMock.mockRestore();
    document.body.style.overflow = "";
    composer.remove();
  });

  it("reports the document as scrollable only when the body is not clipped", () => {
    document.body.style.overflow = "";
    expect(isWindowScrollable()).toBe(true);

    document.body.style.overflow = "hidden";
    expect(isWindowScrollable()).toBe(false);

    document.body.style.overflow = "";
  });

  it("restores main-content scroll when the layout uses an internal scroller", () => {
    const mainContent = document.createElement("main");
    mainContent.id = "main-content";
    mainContent.style.overflowY = "auto";
    Object.defineProperty(mainContent, "scrollHeight", {
      configurable: true,
      value: 1800,
    });
    Object.defineProperty(mainContent, "clientHeight", {
      configurable: true,
      value: 900,
    });
    mainContent.scrollTop = 240;
    document.body.appendChild(mainContent);

    const composer = document.createElement("div");
    document.body.appendChild(composer);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    mockTop(composer, 300);
    const snapshot = captureComposerViewportSnapshot(composer);

    mockTop(composer, 380);
    restoreComposerViewportSnapshot(snapshot, composer);

    expect(mainContent.scrollTop).toBe(320);
    expect(scrollByMock).not.toHaveBeenCalled();

    scrollByMock.mockRestore();
    composer.remove();
    mainContent.remove();
  });

  it("does not preserve the composer viewport just because the composer is visible", () => {
    const composer = document.createElement("div");
    document.body.appendChild(composer);
    mockTop(composer, 540);

    expect(shouldPreserveComposerViewport(composer)).toBe(false);

    composer.remove();
  });

  it("preserves the composer viewport when focus stays inside the composer", () => {
    const composer = document.createElement("div");
    const input = document.createElement("textarea");
    composer.appendChild(input);
    document.body.appendChild(composer);
    mockTop(composer, 1200);

    input.focus();

    expect(shouldPreserveComposerViewport(composer)).toBe(true);

    composer.remove();
  });
});

describe("thread scroll anchor", () => {
  function mockRect(element: HTMLElement, top: number, height = 48) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function buildThread(rows: Array<{ id: string; top: number }>) {
    const container = document.createElement("div");
    for (const row of rows) {
      const element = document.createElement("div");
      element.id = row.id;
      mockRect(element, row.top);
      container.appendChild(element);
    }
    document.body.appendChild(container);
    return container;
  }

  it("captures the first anchored row that is still inside the viewport", () => {
    const container = buildThread([
      { id: "comment-a", top: -400 },
      { id: "comment-b", top: -20 },
      { id: "comment-c", top: 120 },
    ]);
    const heading = document.createElement("h2");
    heading.id = "details";
    mockRect(heading, -10);
    container.prepend(heading);

    const snapshot = captureThreadScrollAnchor(container, new Set(["comment-a", "comment-b", "comment-c"]));

    // The markdown heading id is not a thread row; comment-b is the first row
    // whose bottom edge (-20 + 48) is still at or below the viewport top.
    expect(snapshot).toEqual({ anchorId: "comment-b", viewportTop: -20 });
    container.remove();
  });

  it("returns null without a container or without visible rows", () => {
    expect(captureThreadScrollAnchor(null, new Set(["comment-a"]))).toBeNull();
    const container = buildThread([{ id: "comment-a", top: -400 }]);
    expect(captureThreadScrollAnchor(container, new Set(["comment-a"]))).toBeNull();
    expect(captureThreadScrollAnchor(container, new Set())).toBeNull();
    container.remove();
  });

  it("scrolls the page by the distance a prepended page pushed the anchored row down", () => {
    const container = buildThread([{ id: "comment-b", top: -20 }]);
    const snapshot = captureThreadScrollAnchor(container, new Set(["comment-b"]));
    expect(snapshot).not.toBeNull();

    // Simulate older comments being inserted above: the row moved 1200px down.
    const row = document.getElementById("comment-b") as HTMLElement;
    mockRect(row, 1180);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    expect(restoreThreadScrollAnchor(snapshot)).toBe(true);
    expect(scrollByMock).toHaveBeenCalledWith({ top: 1200, left: 0, behavior: "auto" });

    scrollByMock.mockRestore();
    container.remove();
  });

  it("does nothing when the browser already anchored the row (delta ~0)", () => {
    const container = buildThread([{ id: "comment-b", top: -20 }]);
    const snapshot = captureThreadScrollAnchor(container, new Set(["comment-b"]));
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    expect(restoreThreadScrollAnchor(snapshot)).toBe(true);
    expect(scrollByMock).not.toHaveBeenCalled();

    scrollByMock.mockRestore();
    container.remove();
  });

  it("reports a missing row so the windowed renderer can take over the anchor", () => {
    const container = buildThread([{ id: "comment-b", top: -20 }]);
    const snapshot = captureThreadScrollAnchor(container, new Set(["comment-b"]));
    container.remove();

    expect(restoreThreadScrollAnchor(snapshot)).toBe(false);
    expect(restoreThreadScrollAnchor(null)).toBe(false);
  });

  it("adjusts the internal scroller when main-content scrolls instead of the page", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.style.overflowY = "auto";
    Object.defineProperty(main, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(main, "clientHeight", { configurable: true, value: 800 });
    main.scrollTop = 0;
    document.body.appendChild(main);
    const container = buildThread([{ id: "comment-b", top: 10 }]);
    main.appendChild(container);
    const snapshot = captureThreadScrollAnchor(container, new Set(["comment-b"]));
    mockRect(document.getElementById("comment-b") as HTMLElement, 310);
    const scrollByMock = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    expect(restoreThreadScrollAnchor(snapshot)).toBe(true);
    expect(main.scrollTop).toBe(300);
    expect(scrollByMock).not.toHaveBeenCalled();

    scrollByMock.mockRestore();
    main.remove();
  });
});
