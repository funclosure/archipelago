// Export and import of the whole database file, in a form `~/.archipelago/archipelago.sqlite` accepts both ways.
// The checks here are pure; the worker does the file work (`worker.ts`).

const HEADER = "SQLite format 3\0";

/** The file name a download gets: archipelago-YYYY-MM-DD.sqlite, in the reader's local date. */
export function exportName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `archipelago-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.sqlite`;
}

/**
 * Checks that `bytes` are a SQLite database and returns them ready for the browser's storage: a file saved in WAL
 * mode (as the local tool keeps its database) is marked as a rollback-journal file, since the browser's VFS has no
 * WAL. Returns the sentence to show instead when they are not a database.
 */
export function prepareImport(bytes: Uint8Array): { bytes: Uint8Array } | { error: string } {
  if (bytes.byteLength < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== HEADER) {
    return { error: "That file is not an Archipelago database. Pick a .sqlite file that Archipelago exported." };
  }
  const out = bytes.slice();
  // Bytes 18 and 19 are the write and read format versions: 2 is WAL, 1 is the rollback journal.
  if (out[18] === 2 || out[19] === 2) out[18] = out[19] = 1;
  return { bytes: out };
}

/** The sentence for a database whose migrations this build does not know, or null when it can be opened. */
export function migrationsError(versions: string[], known: string[]): string | null {
  if (versions.length === 0) return "That file is a SQLite database, but not one of Archipelago's.";
  const unknown = versions.filter((v) => !known.includes(v));
  if (unknown.length) return "That database was saved by a newer Archipelago than this page. Reload the page to get the latest, then import it again.";
  return null;
}
