/** Timestamp formats used in archive folder/file names and log lines (local time). */

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYYMMDD_HHMMSS" — prefix of archive folders and generated files. */
export function fileStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** "YYYY-MM-DD HH:mm:ss" — used inside log.txt / error.txt lines. */
export function logStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
