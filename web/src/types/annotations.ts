export interface AddAnnotation {
  id: string;
  afterTokenIndex: number;
  sourceLine: number;
  content: string;
}

export interface DeleteAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
}

export interface ReplaceAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
  content: string;
}

export interface CommentAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
  content: string;
}

export interface PlanAnnotations {
  additions: AddAnnotation[];
  deletions: DeleteAnnotation[];
  replacements: ReplaceAnnotation[];
  comments: CommentAnnotation[];
}

export const EMPTY_ANNOTATIONS: PlanAnnotations = {
  additions: [],
  deletions: [],
  replacements: [],
  comments: [],
};
