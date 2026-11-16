import { Component, createRef, type ReactNode } from "react";
import {
  captureThreadScrollAnchor,
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
 * pinned to the bottom.
 */
export class TaskChatScrollAnchorKeeper extends Component<TaskChatScrollAnchorKeeperProps> {
  private containerRef = createRef<HTMLDivElement>();

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

  render() {
    return (
      <div ref={this.containerRef} className={this.props.className} data-testid="task-chat-scroll-anchor-keeper">
        {this.props.children}
      </div>
    );
  }
}
