import { Component, createRef, type ReactNode } from "react";
import {
  captureThreadScrollAnchor,
  keepThreadScrollAnchored,
  restoreThreadScrollAnchor,
  type ThreadScrollAnchorSnapshot,
} from "@/lib/thread-scroll-anchor";

interface TaskChatScrollAnchorKeeperProps {
  /** Changes whenever the rendered item list changes (identity of `items`). */
  itemsKey: unknown;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps the thread rows and keeps the row the reader is looking at in place
 * when rows are inserted above it (older comment pages, late activity rows).
 * `getSnapshotBeforeUpdate` is the only React lifecycle that still sees the
 * pre-mutation layout, hence a class component. The scroll-to-latest rule of
 * TaskMessageScroller runs afterwards and still wins while the reader is
 * pinned to the bottom. Between commits, `keepThreadScrollAnchored` covers the
 * late layout shifts (header/description arriving, rows measuring, images
 * loading) that WebKit's missing scroll anchoring would otherwise expose.
 */
export class TaskChatScrollAnchorKeeper extends Component<TaskChatScrollAnchorKeeperProps> {
  private containerRef = createRef<HTMLDivElement>();
  private releaseGuard: (() => void) | null = null;

  componentDidMount() {
    this.releaseGuard = keepThreadScrollAnchored(this.containerRef.current);
  }

  getSnapshotBeforeUpdate(prevProps: TaskChatScrollAnchorKeeperProps): ThreadScrollAnchorSnapshot | null {
    if (prevProps.itemsKey === this.props.itemsKey) return null;
    return captureThreadScrollAnchor(this.containerRef.current);
  }

  componentDidUpdate(
    _prevProps: TaskChatScrollAnchorKeeperProps,
    _prevState: unknown,
    snapshot: ThreadScrollAnchorSnapshot | null,
  ) {
    if (!snapshot) return;
    restoreThreadScrollAnchor(snapshot, this.containerRef.current);
  }

  componentWillUnmount() {
    this.releaseGuard?.();
    this.releaseGuard = null;
  }

  render() {
    return (
      <div ref={this.containerRef} className={this.props.className} data-testid="task-chat-scroll-anchor-keeper">
        {this.props.children}
      </div>
    );
  }
}
