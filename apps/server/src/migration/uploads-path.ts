import { lstat } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * Die Probe „bleibt dieser Pfad unterhalb dieses Ordners?" — EINE Stelle (WI-0086 §5, harte Zusicherung „nur unterhalb des Fachs").
 *
 * Vorbild ist die Probe in `importFromUploadsCopy` (`media-fetch.ts`, WI-0063 MEDIA-M9); sie wird hier geteilt und nicht abgeschrieben:
 * `importFromUploadsCopy` liest damit nur unterhalb der Kopie von Legacys `uploads/`, das Aufräumen des Download-Fachs
 * (`DownloadStore.remove`, WI-0086 `--prune`) löscht damit nur unterhalb des Fachs.
 *
 * 🔴 Zwei Fragen, zwei Funktionen, weil beide einzeln falsch sein können:
 *   - `pathUnderRoot` beantwortet die Frage am NAMEN (`..`, absoluter Pfad, Laufwerksbuchstabe, Kodierung): rein, ohne Platte.
 *   - `plainFileUnder` beantwortet sie an der PLATTE (`lstat`, nicht `stat`): eine Verknüpfung oder ein Verzeichnis ist keine Datei,
 *     die wir lesen oder löschen. `lstat` folgt der Verknüpfung nicht, `stat` würde es tun — und damit hinausführen.
 *
 * Die Adressseite (`/uploads/…`, ohne `?v=`, ohne `..`, ohne Rückwärtsstrich) prüft `legacyLocalPath` in `media-manifest.ts`; dieses
 * Modul kennt keine Adressen, nur Pfade, und hat deshalb keine Abhängigkeit im Projekt.
 */

/** Warum ein Pfad nicht unterhalb der Wurzel liegt, in der Sprache der Berichte. */
export const OUTSIDE_ROOT_REASON = "liegt außerhalb des Ordners";

/**
 * Der absolute Pfad von `relative` unterhalb von `root`, oder `null`, wenn er hinausführt. Die Wurzel selbst ist kein Treffer: Es
 * geht immer um eine Datei DARIN.
 */
export function pathUnderRoot(root: string, relative: string): string | null {
    const base = resolve(root);
    const file = resolve(base, relative);
    return file.startsWith(base + sep) ? file : null;
}

export type PlainFileProbe =
    | { kind: "file"; file: string; size: number; mtime: Date }
    | { kind: "missing" }
    | { kind: "refused"; reason: string };

/**
 * Eine einfache Datei unterhalb der Wurzel: nicht draußen, vorhanden, kein Verzeichnis und keine Verknüpfung (`lstat`). `maxBytes`
 * entscheidet VOR dem Lesen, ob die Datei überhaupt in Frage kommt.
 */
export async function plainFileUnder(root: string, relative: string, maxBytes?: number): Promise<PlainFileProbe> {
    const file = pathUnderRoot(root, relative);
    if (file === null) return { kind: "refused", reason: OUTSIDE_ROOT_REASON };
    let info;
    try {
        info = await lstat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
        throw error;
    }
    // Eine Verknüpfung oder ein Verzeichnis: nie folgen, nie löschen.
    if (!info.isFile()) return { kind: "refused", reason: "keine einfache Datei (Verknüpfung oder Verzeichnis)" };
    if (maxBytes !== undefined && info.size > maxBytes)
        return { kind: "refused", reason: `größer als ${String(maxBytes)} Bytes` };
    return { kind: "file", file, size: info.size, mtime: info.mtime };
}
