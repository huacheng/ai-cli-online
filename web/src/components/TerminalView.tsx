import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useTerminalWebSocket } from '../hooks/useTerminalWebSocket';

const TERMINAL_THEME = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

const FONT_FAMILY = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace";

interface TerminalViewProps {
  sessionId: string;
  viewerMode: boolean;
}

export function TerminalView({ sessionId, viewerMode }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const viewerModeRef = useRef(viewerMode);
  viewerModeRef.current = viewerMode;

  // Scrollback overlay state (normal mode)
  const [scrollbackVisible, setScrollbackVisible] = useState(false);
  const [scrollbackData, setScrollbackData] = useState('');

  // Live viewer state (viewer mode)
  const [liveViewerData, setLiveViewerData] = useState('');
  const throttleTimerRef = useRef<number | null>(null);
  const throttleLastRef = useRef(0);

  const handleScrollbackContent = useCallback((data: string) => {
    setScrollbackData(data);
    setScrollbackVisible(true);
  }, []);

  const handleVisibleContent = useCallback((data: string) => {
    setLiveViewerData(data);
  }, []);

  // Throttle: fire immediately on first output, then at most every 300ms,
  // with a trailing call to catch the final state after output stops.
  const handleOutput = useCallback(() => {
    if (!viewerModeRef.current) return;
    const now = Date.now();
    const elapsed = now - throttleLastRef.current;

    if (elapsed >= 300) {
      // Leading edge: fire immediately
      throttleLastRef.current = now;
      requestVisibleRef.current?.();
    }

    // Always schedule a trailing edge to capture final state
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    throttleTimerRef.current = window.setTimeout(() => {
      throttleLastRef.current = Date.now();
      requestVisibleRef.current?.();
    }, 300);
  }, []);

  const { sendInput, sendResize, requestScrollback, requestVisible } = useTerminalWebSocket(
    terminalRef,
    sessionId,
    handleScrollbackContent,
    handleVisibleContent,
    handleOutput,
  );

  // Stable ref for requestVisible (avoid stale closure in handleOutput)
  const requestVisibleRef = useRef(requestVisible);
  requestVisibleRef.current = requestVisible;

  // Request initial capture when entering viewer mode
  useEffect(() => {
    if (viewerMode) {
      requestVisible();
    }
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, [viewerMode, requestVisible]);

  // Re-fit terminal when leaving viewer mode
  useEffect(() => {
    if (!viewerMode && fitAddonRef.current && terminalRef.current) {
      // Delay to let container resize settle
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminalRef.current) {
            sendResize(terminalRef.current.cols, terminalRef.current.rows);
          }
        } catch { /* ignore */ }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewerMode, sendResize]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 10000,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit terminal to container, retrying until container has valid dimensions
    const doFit = () => {
      if (viewerModeRef.current) return false; // Don't fit in viewer mode
      try {
        const el = containerRef.current;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          fitAddon.fit();
          sendResize(terminal.cols, terminal.rows);
          return true;
        }
      } catch {
        // Ignore fit errors during initialization
      }
      return false;
    };

    // Retry fit on an interval until successful or max attempts reached
    requestAnimationFrame(() => doFit());
    let retryCount = 0;
    const retryInterval = setInterval(() => {
      retryCount++;
      if (doFit() || retryCount >= 10) {
        clearInterval(retryInterval);
      }
    }, 100);

    // Forward user input to WebSocket
    terminal.onData((data) => {
      sendInput(data);
    });

    // ResizeObserver for auto-fit (skip in viewer mode to preserve tmux pane size)
    const resizeObserver = new ResizeObserver(() => {
      if (viewerModeRef.current) return;
      try {
        fitAddon.fit();
        sendResize(terminal.cols, terminal.rows);
      } catch {
        // Ignore fit errors during transitions
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      clearInterval(retryInterval);
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sendInput, sendResize]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Live viewer (viewer mode): fills top area */}
      {viewerMode && (
        <>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 81,
            overflow: 'hidden',
          }}>
            <LiveViewer data={liveViewerData} />
          </div>
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 80,
            height: 1,
            backgroundColor: '#414868',
            zIndex: 2,
          }} />
        </>
      )}

      {/* Main terminal: full size in normal mode, small input area in viewer mode */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: viewerMode ? '80px' : '100%',
          backgroundColor: '#1a1b26',
        }}
      />

      {/* Scrollback toggle button (normal mode only) */}
      {!viewerMode && (
        <button
          onClick={() => {
            if (scrollbackVisible) {
              setScrollbackVisible(false);
            } else {
              requestScrollback();
            }
          }}
          title="Toggle scrollback history"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 10,
            background: scrollbackVisible ? '#7aa2f7' : 'rgba(65, 72, 104, 0.7)',
            color: '#c0caf5',
            border: 'none',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            cursor: 'pointer',
            opacity: 0.8,
            lineHeight: '20px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
        >
          {scrollbackVisible ? '\u2715' : '\u2191'}
        </button>
      )}

      {/* Scrollback overlay (normal mode) */}
      {!viewerMode && scrollbackVisible && (
        <ScrollbackViewer
          data={scrollbackData}
          onClose={() => setScrollbackVisible(false)}
        />
      )}
    </div>
  );
}

/** Read-only xterm.js instance for viewing scrollback with full ANSI color */
function ScrollbackViewer({ data, onClose }: { data: string; onClose: () => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      scrollback: 50000,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      theme: TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(viewerRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      const normalized = data.replace(/\r?\n/g, '\r\n');
      terminal.write(normalized, () => {
        terminal.scrollToBottom();
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(viewerRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [data, onClose]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        backgroundColor: '#1a1b26',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        padding: '4px 12px',
        background: '#24283b',
        color: '#7aa2f7',
        fontSize: 12,
        borderBottom: '1px solid #414868',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Scrollback History (mouse wheel to scroll, ESC to close)</span>
      </div>
      <div
        ref={viewerRef}
        style={{ flex: 1, overflow: 'hidden' }}
      />
    </div>
  );
}

/** Persistent read-only xterm.js for live capture-pane viewing */
function LiveViewer({ data }: { data: string }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const prevDataRef = useRef('');

  // Create terminal once
  useEffect(() => {
    if (!viewerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      scrollback: 50000,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      theme: TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(viewerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(viewerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Update content when data changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !data) return;
    if (data === prevDataRef.current) return; // Skip if unchanged
    prevDataRef.current = data;

    terminal.reset();
    const normalized = data.replace(/\r?\n/g, '\r\n');
    terminal.write(normalized, () => {
      terminal.scrollToBottom();
    });
  }, [data]);

  return (
    <div
      ref={viewerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
