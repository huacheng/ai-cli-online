import { sessionApi } from './apiClient';
import type { AnnotationRemote, TaskAnnotationResult } from './types';

export async function fetchAnnotation(
  token: string,
  sessionId: string,
  filePath: string,
): Promise<AnnotationRemote | null> {
  const data = await sessionApi.get<{ content: string; updatedAt: number }>(
    token, sessionId, 'annotations', { path: filePath },
  );
  return data.content ? { content: data.content, updatedAt: data.updatedAt } : null;
}

export async function saveAnnotationRemote(
  token: string,
  sessionId: string,
  filePath: string,
  content: string,
  updatedAt: number,
): Promise<void> {
  await sessionApi.put(token, sessionId, 'annotations', { path: filePath, content, updatedAt });
}

export async function writeTaskAnnotations(
  token: string,
  sessionId: string,
  modulePath: string,
  content: object,
): Promise<TaskAnnotationResult> {
  return sessionApi.post<TaskAnnotationResult>(token, sessionId, 'task-annotations', { modulePath, content });
}
