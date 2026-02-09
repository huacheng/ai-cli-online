import { useCallback, useRef, useState } from 'react';

export type StreamMode = 'lines' | 'content' | 'binary';

export interface FileStreamState {
  status: 'idle' | 'streaming' | 'complete' | 'error';
  mode: StreamMode;
  lines: string[];
  content: string;
  buffer: Uint8Array | null;
  totalSize: number;
  receivedBytes: number;
  mtime: number;
  error: string | null;
}

const INITIAL_STATE: FileStreamState = {
  status: 'idle',
  mode: 'lines',
  lines: [],
  content: '',
  buffer: null,
  totalSize: 0,
  receivedBytes: 0,
  mtime: 0,
  error: null,
};

const THROTTLE_MS = 200; // 5fps state update throttle

export function useFileStream() {
  const [state, setState] = useState<FileStreamState>(INITIAL_STATE);

  // Mutable refs for accumulation (avoid setState on every chunk)
  const modeRef = useRef<StreamMode>('lines');
  const linesRef = useRef<string[]>([]);
  const partialLineRef = useRef(''); // incomplete trailing line for 'lines' mode
  const contentRef = useRef('');
  const chunksRef = useRef<Uint8Array[]>([]);
  const receivedRef = useRef(0);
  const totalSizeRef = useRef(0);
  const throttleTimerRef = useRef<number | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  const flushState = useCallback(() => {
    const mode = modeRef.current;
    setState((prev) => ({
      ...prev,
      receivedBytes: receivedRef.current,
      ...(mode === 'lines' ? { lines: [...linesRef.current] } : {}),
      ...(mode === 'content' ? { content: contentRef.current } : {}),
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (throttleTimerRef.current !== null) return;
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = null;
      flushState();
    }, THROTTLE_MS);
  }, [flushState]);

  const startStream = useCallback((mode: StreamMode) => {
    // Reset all accumulators
    modeRef.current = mode;
    linesRef.current = [];
    partialLineRef.current = '';
    contentRef.current = '';
    chunksRef.current = [];
    receivedRef.current = 0;
    totalSizeRef.current = 0;
    decoderRef.current = new TextDecoder();
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    setState({
      ...INITIAL_STATE,
      mode,
      status: 'streaming',
    });
  }, []);

  const handleChunk = useCallback((chunk: Uint8Array) => {
    receivedRef.current += chunk.length;
    const mode = modeRef.current;

    if (mode === 'lines') {
      const text = decoderRef.current!.decode(chunk, { stream: true });
      const parts = text.split('\n');
      // First part appends to partial line
      parts[0] = partialLineRef.current + parts[0];
      // Last part becomes new partial (may be empty string if chunk ends with \n)
      partialLineRef.current = parts.pop()!;
      // All other parts are complete lines
      if (parts.length > 0) {
        linesRef.current.push(...parts);
      }
    } else if (mode === 'content') {
      const text = decoderRef.current!.decode(chunk, { stream: true });
      contentRef.current += text;
    } else {
      // binary — store raw chunks, merge on end
      chunksRef.current.push(new Uint8Array(chunk));
    }

    scheduleFlush();
  }, [scheduleFlush]);

  const handleControl = useCallback((msg: { type: string; [key: string]: unknown }) => {
    switch (msg.type) {
      case 'file-stream-start':
        totalSizeRef.current = msg.size as number;
        setState((prev) => ({
          ...prev,
          totalSize: msg.size as number,
          mtime: msg.mtime as number,
        }));
        break;

      case 'file-stream-end': {
        // Cancel any pending throttle flush
        if (throttleTimerRef.current !== null) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }

        const mode = modeRef.current;
        let finalLines = linesRef.current;
        let finalContent = contentRef.current;
        let finalBuffer: Uint8Array | null = null;

        if (mode === 'lines') {
          // Flush remaining partial line
          const remaining = decoderRef.current!.decode(); // flush decoder
          const lastPartial = partialLineRef.current + remaining;
          if (lastPartial) {
            finalLines = [...finalLines, lastPartial];
            linesRef.current = finalLines;
          }
          partialLineRef.current = '';
        } else if (mode === 'content') {
          const remaining = decoderRef.current!.decode();
          finalContent = contentRef.current + remaining;
          contentRef.current = finalContent;
        } else {
          // Merge all binary chunks into single Uint8Array
          const totalLen = chunksRef.current.reduce((sum, c) => sum + c.length, 0);
          finalBuffer = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunksRef.current) {
            finalBuffer.set(c, offset);
            offset += c.length;
          }
          chunksRef.current = [];
        }

        setState({
          status: 'complete',
          mode,
          lines: mode === 'lines' ? [...finalLines] : [],
          content: mode === 'content' ? finalContent : '',
          buffer: mode === 'binary' ? finalBuffer : null,
          totalSize: totalSizeRef.current,
          receivedBytes: receivedRef.current,
          mtime: 0,
          error: null,
        });
        break;
      }

      case 'file-stream-error':
        if (throttleTimerRef.current !== null) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: msg.error as string,
        }));
        break;
    }
  }, []);

  const reset = useCallback(() => {
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    linesRef.current = [];
    partialLineRef.current = '';
    contentRef.current = '';
    chunksRef.current = [];
    receivedRef.current = 0;
    totalSizeRef.current = 0;
    decoderRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { state, startStream, handleChunk, handleControl, reset };
}
