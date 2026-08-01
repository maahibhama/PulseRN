import { useEffect, useRef, useState, type ReactNode } from 'react';

const OVERSCAN_ROWS = 8;

export function VirtualizedList<T>({
  className,
  empty,
  getKey,
  items,
  renderItem,
  rowHeight,
}: {
  className: string;
  empty: ReactNode;
  getKey(item: T): string;
  items: readonly T[];
  renderItem(item: T): ReactNode;
  rowHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => setViewportHeight(container.clientHeight);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
  );

  return (
    <div
      className={`${className} bounded-virtual-list`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={containerRef}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <div className="bounded-virtual-space" style={{ height: items.length * rowHeight }}>
          {items.slice(start, end).map((item, offset) => (
            <div
              className="bounded-virtual-row"
              data-virtual-index={start + offset}
              key={getKey(item)}
              style={{
                height: rowHeight,
                transform: `translateY(${(start + offset) * rowHeight}px)`,
              }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
