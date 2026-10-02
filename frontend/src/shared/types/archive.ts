/** One row returned by GET /api/archives and /api/archives/{name}/contents. */
export interface ArchiveEntry {
  /** "<archive>" for top-level folders, "<archive>/<relative path>" otherwise. */
  key: string;
  name: string;
  /** "image" is used for every file, including text files (log.txt, panels.json). */
  type: 'image' | 'folder';
  /** Key of the parent folder; null for top-level archives. */
  folderId: string | null;
  timestamp: number;
}
