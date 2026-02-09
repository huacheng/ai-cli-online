/**
 * Cross-component event bus for file streaming.
 * Routes WS file-chunk (0x05) and control messages from useTerminalWebSocket
 * to useFileStream in PlanPanel, keyed by sessionId.
 */

type ChunkHandler = (chunk: Uint8Array) => void;
type ControlHandler = (msg: { type: string; [key: string]: unknown }) => void;

interface Handlers {
  onChunk: ChunkHandler;
  onControl: ControlHandler;
}

const handlers = new Map<string, Handlers>();

export function registerFileStreamHandler(
  sessionId: string,
  onChunk: ChunkHandler,
  onControl: ControlHandler,
): void {
  handlers.set(sessionId, { onChunk, onControl });
}

export function unregisterFileStreamHandler(sessionId: string): void {
  handlers.delete(sessionId);
}

export function dispatchFileChunk(sessionId: string, chunk: Uint8Array): void {
  handlers.get(sessionId)?.onChunk(chunk);
}

export function dispatchFileControl(
  sessionId: string,
  msg: { type: string; [key: string]: unknown },
): void {
  handlers.get(sessionId)?.onControl(msg);
}
