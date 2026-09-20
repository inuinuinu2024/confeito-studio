export interface CachedImage {
  key: string;
  name: string;
  timestamp: number;
  blob?: Blob;
  type?: 'image' | 'folder';
  folderId?: string | null;
  collapsed?: boolean;
}
