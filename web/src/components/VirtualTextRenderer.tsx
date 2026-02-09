import { useEffect, useRef, useState } from 'react';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { useStore } from '../store';

const FONT_FAMILY = '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace';
const OVERSCAN = 20;

interface VirtualTextRendererProps {
  lines: string[];
  totalSize: number;
  receivedBytes: number;
  streaming: boolean;
}

interface RowCustomProps {
  lines: string[];
}

function Row({
  index,
  style,
  lines,
}: RowComponentProps<RowCustomProps>) {
  return (
    <div style={{
      ...style,
      padding: '0 12px',
      color: '#a9b1d6',
      whiteSpace: 'pre',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {lines[index]}
    </div>
  );
}

export function VirtualTextRenderer({
  lines,
  totalSize,
  receivedBytes,
  streaming,
}: VirtualTextRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const fontSize = useStore((s) => s.fontSize);
  const rowHeight = Math.round(fontSize * 1.5);

  // Track container size via ResizeObserver — trigger re-render on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => setTick((t) => t + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pct = totalSize > 0 ? Math.round((receivedBytes / totalSize) * 100) : 0;

  // Format line count
  const lineCount = lines.length.toLocaleString();

  // Get container dimensions directly from ref (avoids stale state)
  const el = containerRef.current;
  const width = el?.clientWidth || 0;
  const height = el?.clientHeight || 0;

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        fontFamily: FONT_FAMILY,
        fontSize,
        lineHeight: `${rowHeight}px`,
      }}
    >
      {height > 0 && (
        <List
          rowComponent={Row}
          rowCount={lines.length}
          rowHeight={rowHeight}
          rowProps={{ lines }}
          overscanCount={OVERSCAN}
          style={{ height, width }}
        />
      )}

      {/* Bottom-right info badge */}
      <div style={{
        position: 'absolute',
        bottom: 6,
        right: 14,
        fontSize: 10,
        color: '#565f89',
        background: 'rgba(22, 22, 30, 0.85)',
        padding: '2px 8px',
        borderRadius: 4,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        {lineCount} lines
        {streaming && ` (${pct}%)`}
      </div>
    </div>
  );
}
