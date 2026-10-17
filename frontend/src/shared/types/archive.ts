/** One entry returned by GET /api/archives (an archive: `name` is its display name). */
export interface ArchiveEntry {
  /** "<archive>" for top-level folders, "<archive>/<relative path>" otherwise. */
  key: string;
  name: string;
  /** "image" is used for every file, including text files (panels.json, info.json). */
  type: 'image' | 'folder';
  /** Key of the parent folder; null for top-level archives. */
  folderId: string | null;
  timestamp: number;
}
