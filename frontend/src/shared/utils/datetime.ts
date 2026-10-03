/** Timestamp format used in archive folder/file names (local time). */

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYYMMDD_HHMMSS" — prefix of archive folders and generated files. */
export function fileStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
