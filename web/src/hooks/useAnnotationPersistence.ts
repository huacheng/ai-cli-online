import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { fetchAnnotation, saveAnnotationRemote } from '../api/annotations';
import type { PlanAnnotations } from '../types/annotations';
import { EMPTY_ANNOTATIONS } from '../types/annotations';
import { storageKey, collectIds, migrateAnnotations } from '../components/annotationHelpers';

interface UseAnnotationPersistenceArgs {
  sessionId: string;
  filePath: string;
  token: string;
  annotations: PlanAnnotations;
  annLoadedRef: React.MutableRefObject<boolean>;
  setAnnotations: React.Dispatch<React.SetStateAction<PlanAnnotations>>;
  baselineIdsRef: React.MutableRefObject<Set<string>>;
}

/**
 * Dual-layer annotation persistence:
 * - L1: localStorage with 50ms debounce
 * - L2: server sync with adaptive interval based on latency
 * - Load: L1 instant + L2 async merge (use newer)
 */
export function useAnnotationPersistence({
  sessionId, filePath, token, annotations, annLoadedRef,
  setAnnotations, baselineIdsRef,
}: UseAnnotationPersistenceArgs) {
  const latency = useStore((s) => s.latency);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncInFlightRef = useRef(false);

  // L1+L2 save on annotation change
  useEffect(() => {
    if (!annLoadedRef.current) return;
    const lsKey = storageKey(sessionId, filePath);
    const serialized = JSON.stringify(annotations);
    // L1: 50ms debounce → localStorage
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem(lsKey, serialized); } catch { /* full */ }
    }, 50);
    // L2: adaptive interval → server
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    const syncInterval = Math.max(200, (latency ?? 30) * 3);
    syncTimerRef.current = setTimeout(() => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      saveAnnotationRemote(token, sessionId, filePath, serialized, Date.now())
        .catch(() => {})
        .finally(() => { syncInFlightRef.current = false; });
    }, syncInterval);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [annotations, sessionId, filePath, token, latency, annLoadedRef]);

  // Reload on filePath change: L1 instant + L2 async merge
  useEffect(() => {
    annLoadedRef.current = false;
    // L1: instant from localStorage
    let localAnns = EMPTY_ANNOTATIONS;
    let localUpdatedAt = 0;
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      if (saved) {
        localAnns = migrateAnnotations(JSON.parse(saved));
        localUpdatedAt = Date.now();
      }
    } catch { /* ignore */ }
    setAnnotations(localAnns);
    baselineIdsRef.current = collectIds(localAnns);

    // L2: async from server
    let cancelled = false;
    fetchAnnotation(token, sessionId, filePath).then((remote) => {
      if (cancelled) return;
      if (remote && remote.updatedAt > localUpdatedAt) {
        try {
          const parsed: PlanAnnotations = migrateAnnotations(JSON.parse(remote.content));
          setAnnotations(parsed);
          try { localStorage.setItem(storageKey(sessionId, filePath), remote.content); } catch { /* full */ }
          baselineIdsRef.current = collectIds(parsed);
        } catch { /* corrupt server data */ }
      }
    }).catch(() => { /* offline, use local */ }).finally(() => { annLoadedRef.current = true; });
    annLoadedRef.current = true; // allow saving even if fetch is slow
    return () => { cancelled = true; };
  }, [sessionId, filePath, token, annLoadedRef, setAnnotations, baselineIdsRef]);
}
