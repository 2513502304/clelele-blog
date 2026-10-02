/** A cursor is a same-origin URL; null means the upstream collection is complete. */
export interface CollectionPage<T, M = Record<string, never>> {
  items: T[];
  next: string | null;
  total?: number;
  meta?: M;
}
