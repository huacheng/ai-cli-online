import { memo, useCallback, useRef } from 'react';
import { useStore } from '../store';
import { TerminalPane } from './TerminalPane';
import { ErrorBoundary } from './ErrorBoundary';
import type { LayoutNode, SplitNode } from '../types';

const DIVIDER_SIZE = 4;
const MIN_PANE_PERCENT = 10;

export function SplitPaneContainer() {
  const layout = useStore((s) => s.layout);
  const terminalCount = useStore((s) => s.terminalIds.length);
  const addTerminal = useStore((s) => s.addTerminal);

  if (!layout) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
      }}>
        <button
          onClick={() => addTerminal()}
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            color: 'var(--text-secondary)',
            padding: '16px 32px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          + Add Terminal
        </button>
      </div>
    );
  }

  const canClose = terminalCount > 1;

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <LayoutRenderer node={layout} canClose={canClose} />
    </div>
  );
}

const LayoutRenderer = memo(function LayoutRenderer({ node, canClose }: { node: LayoutNode; canClose: boolean }) {
  if (node.type === 'leaf') {
    return <LeafRenderer terminalId={node.terminalId} canClose={canClose} />;
  }
  return <SplitRenderer node={node} canClose={canClose} />;
});

const LeafRenderer = memo(function LeafRenderer({ terminalId, canClose }: { terminalId: string; canClose: boolean }) {
  // O(1) lookup; only re-renders when THIS terminal's state changes
  const terminal = useStore((s) => s.terminalsMap[terminalId]);
  if (!terminal) return null;
  return (
    <ErrorBoundary inline>
      <TerminalPane terminal={terminal} canClose={canClose} />
    </ErrorBoundary>
  );
});

const SplitRenderer = memo(function SplitRenderer({ node, canClose }: { node: SplitNode; canClose: boolean }) {
  const setSplitSizes = useStore((s) => s.setSplitSizes);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHorizontal = node.direction === 'horizontal';

  // Use ref for sizes to avoid useCallback invalidation during active dragging
  const sizesRef = useRef(node.sizes);
  sizesRef.current = node.sizes;

  const onDividerMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const bodyClass = isHorizontal ? 'resizing-panes' : 'resizing-panes-v';
    document.body.classList.add(bodyClass);

    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSizes = [...sizesRef.current];
    const container = containerRef.current;
    const containerSize = isHorizontal
      ? (container?.clientWidth || 1)
      : (container?.clientHeight || 1);

    let dragRafId: number | null = null;
    const onMouseMove = (ev: MouseEvent) => {
      if (dragRafId) return;
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null;
        const currentPos = isHorizontal ? ev.clientX : ev.clientY;
        const delta = currentPos - startPos;
        const deltaPercent = (delta / containerSize) * 100;

        const newLeft = startSizes[index] + deltaPercent;
        const newRight = startSizes[index + 1] - deltaPercent;

        if (newLeft >= MIN_PANE_PERCENT && newRight >= MIN_PANE_PERCENT) {
          const newSizes = [...startSizes];
          newSizes[index] = newLeft;
          newSizes[index + 1] = newRight;
          setSplitSizes(node.id, newSizes);
        }
      });
    };

    const onMouseUp = () => {
      if (dragRafId) cancelAnimationFrame(dragRafId);
      document.body.classList.remove(bodyClass);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isHorizontal, node.id, setSplitSizes]);

  const elements: React.ReactNode[] = [];

  node.children.forEach((child, i) => {
    const key = child.type === 'leaf' ? child.terminalId : child.id;

    elements.push(
      <div
        key={key}
        style={{
          flex: `${node.sizes[i]} 0 0`,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <LayoutRenderer node={child} canClose={canClose} />
      </div>,
    );

    if (i < node.children.length - 1) {
      elements.push(
        <div
          key={`divider-${node.id}-${i}`}
          onMouseDown={(e) => onDividerMouseDown(i, e)}
          style={{
            flex: `0 0 ${DIVIDER_SIZE}px`,
            cursor: isHorizontal ? 'col-resize' : 'row-resize',
            backgroundColor: 'var(--border)',
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--accent-blue)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--border)';
          }}
        />,
      );
    }
  });

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {elements}
    </div>
  );
});
