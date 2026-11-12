import { createFinding, type Finding } from "../findings.ts";
import { legacyLocalPath } from "./media-manifest.ts";

/**
 * Legacys Aufzählung von `uploads/` (WI-0086 §4, Teil L): Pfad, Größe und Änderungszeit je Datei, ein GET je Zug. Hier wird sie
 * gelesen und geprüft — und zwar NUR gelesen: Dieses Modul kennt kein Netz.
 *
 * 🔴 Die Antwortform ist eine Positivliste (WI-0086 §4). Was nicht darin steht, wird nicht gelesen:
 *
 *     { "ok": true, "uploads_revision": "uploads-<16 Hex>", "counts": { "files": 0, "bytes": 0 },
 *       "truncated": false,
 *       "items": [ { "path": "/uploads/wappen/x.png", "bytes": 12345, "mtime": 1760000000 } ] }
 *
 * 🔴 **Quellenprüfung, BLOCKING_SOURCE_CHECKS A24** (Betreiber 2026-10-03, „A auch für die Prüfungen“, Gruppe 5: Quelle
 * unvollständig — `ok=false`, abgeschnitten, leere Liste, falsche Anzahl). Dieselbe Klasse wie A12 bis A18 und A22, keine neue
 * Regel: Eine halb übertragene Aufzählung sieht für den Sync aus wie „Legacy hat die Hälfte seiner Bilder gelöscht", und mit
 * `--prune` wäre das ein Aufräumen, das niemand wollte. Deshalb hält sie an (`UploadsSourceIncomplete`), statt zu melden.
 *
 * Alles andere MELDET nur (`findings`): eine Zeile mit unbrauchbarem Pfad, eine doppelte Adresse, eine unlesbare Größe oder Zeit,
 * eine Bytesumme, die nicht zur Liste passt. Der Zug geht dann mit den brauchbaren Zeilen weiter.
 */

/** Eine Datei in Legacys `uploads/`, so wie die Aufzählung sie nennt. */
export interface UploadsItem {
    /** Die Adresse in Legacys Speicher, `/uploads/…` (durch `legacyLocalPath` gegangen, ohne `?v=`). */
    path: string;
    bytes: number;
    /** Änderungszeit als Unix-Sekunden, wie `stat` sie liefert. */
    mtime: number;
}

export interface UploadsList {
    /** `uploads-<16 Hex>` aus dem Fingerabdruck der ganzen Liste; nur für den Bericht, nie für eine Entscheidung. */
    revision: string;
    items: UploadsItem[];
    /** Was die Antwort über sich selbst sagt: Zahl der Dateien und Summe der Bytes. */
    declared: { files: number; bytes: number };
}

export interface UploadsListParse {
    list: UploadsList;
    findings: Finding[];
}

/**
 * Die Aufzählung ist unvollständig oder unbrauchbar: Der Sync hört auf, bevor er etwas holt oder aufräumt.
 * Die Felder sind ausgeschrieben, nicht als Parameter-Eigenschaft deklariert: Node entfernt Typen, es übersetzt sie nicht.
 */
export class UploadsSourceIncomplete extends Error {
    readonly detail: Record<string, number | string>;

    constructor(message: string, detail: Record<string, number | string>) {
        super(message);
        this.name = "UploadsSourceIncomplete";
        this.detail = detail;
    }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Eine ganze Zahl ab 0, sonst `null` (eine Größe oder Zeit, die Legacy nicht sauber nennt, ist keine). */
function wholeNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Liest und prüft die Aufzählung. Wirft `UploadsSourceIncomplete`, wenn die Quelle unvollständig ist (A24); sonst die brauchbaren
 * Zeilen, sortiert nach Adresse, dazu die Befunde der aussortierten.
 */
export function parseUploadsList(payload: unknown): UploadsListParse {
    const root = asRecord(payload);
    if (root === null) throw new UploadsSourceIncomplete("die Aufzählung von uploads/ ist kein JSON-Objekt", {});
    if (root["ok"] !== true) {
        throw new UploadsSourceIncomplete("die Aufzählung von uploads/ meldet ok nicht als wahr", {
            ok: String(root["ok"]),
        });
    }
    // 🔴 Abgeschnitten heißt: Legacy hat mehr Dateien als die Obergrenze zulässt. Eine solche Liste darf nie als Bestand gelten.
    if (root["truncated"] === true) {
        throw new UploadsSourceIncomplete("die Aufzählung von uploads/ ist abgeschnitten (truncated)", {
            geliefert: Array.isArray(root["items"]) ? root["items"].length : -1,
        });
    }
    const rawItems = root["items"];
    if (!Array.isArray(rawItems)) {
        throw new UploadsSourceIncomplete("die Aufzählung von uploads/ hat keine Liste `items`", {});
    }
    if (rawItems.length === 0) {
        throw new UploadsSourceIncomplete("die Aufzählung von uploads/ ist leer (ein Ausfall, kein leerer Ordner)", {
            geliefert: 0,
        });
    }
    const counts = asRecord(root["counts"]);
    const declaredFiles = wholeNumber(counts?.["files"]);
    if (declaredFiles === null || declaredFiles !== rawItems.length) {
        throw new UploadsSourceIncomplete("die Aufzählung von uploads/ nennt eine andere Anzahl, als sie liefert", {
            gemeldet: declaredFiles ?? -1,
            geliefert: rawItems.length,
        });
    }

    const items = new Map<string, UploadsItem>();
    const unusable: string[] = [];
    const duplicates: string[] = [];
    for (const raw of rawItems) {
        const record = asRecord(raw);
        const path = legacyLocalPath(record?.["path"]);
        const bytes = wholeNumber(record?.["bytes"]);
        const mtime = wholeNumber(record?.["mtime"]);
        if (path === null || bytes === null || mtime === null) {
            unusable.push(typeof record?.["path"] === "string" ? record["path"] : "(ohne Pfad)");
            continue;
        }
        if (items.has(path)) {
            duplicates.push(path);
            continue;
        }
        items.set(path, { path, bytes, mtime });
    }

    const findings: Finding[] = [];
    if (unusable.length > 0) {
        findings.push(
            createFinding(
                "uploads_item_unbrauchbar",
                `${String(unusable.length)} Zeile(n) der Aufzählung sind unbrauchbar (kein Pfad unter /uploads/, keine Größe oder keine Zeit); nicht berücksichtigt`,
                { zeilen: unusable.length },
                [],
                unusable.length,
                unusable.slice(0, 20),
            ),
        );
    }
    if (duplicates.length > 0) {
        findings.push(
            createFinding(
                "uploads_item_doppelt",
                `${String(duplicates.length)} Adresse(n) stehen mehrfach in der Aufzählung; die erste gilt`,
                { zeilen: duplicates.length },
                [],
                duplicates.length,
                duplicates.slice(0, 20),
            ),
        );
    }
    const declaredBytes = wholeNumber(counts?.["bytes"]);
    const sum = [...items.values()].reduce((total, item) => total + item.bytes, 0);
    // Die Bytesumme ist KEINE Quellenprüfung: sie sagt nichts über die Vollständigkeit der Liste, nur über ihre Zahlen.
    if (declaredBytes !== null && unusable.length === 0 && duplicates.length === 0 && declaredBytes !== sum) {
        findings.push(
            createFinding(
                "uploads_bytes_weichen_ab",
                `die Aufzählung nennt ${String(declaredBytes)} Bytes, die Zeilen ergeben ${String(sum)}`,
                { gemeldet: declaredBytes, gerechnet: sum },
            ),
        );
    }

    const revision = typeof root["uploads_revision"] === "string" ? root["uploads_revision"] : "";
    return {
        list: {
            revision,
            items: [...items.values()].sort((a, b) => a.path.localeCompare(b.path)),
            declared: { files: declaredFiles, bytes: declaredBytes ?? sum },
        },
        findings,
    };
}
