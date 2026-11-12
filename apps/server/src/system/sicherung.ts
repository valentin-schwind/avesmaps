import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SicherungAuftrag } from "@avesmaps3d/shared";

/**
 * Die Auftragsdatei für „Sicherung jetzt“ (WI-0127 SYS-9, SYS-0001 §9e, Vertrag mit Claudio). Die App schreibt
 * `<BACKUP_REQUEST_DIR>/backup.request` mit genau `{"operation_id": "<uuid>", "requested_at": "<iso>"}`, atomar: eine temporäre Datei im
 * selben Verzeichnis, dann `rename`. Das Verzeichnis legt sie bei Bedarf an. Claudios `.path`-Unit holt die Datei ab, liest nur die
 * `operation_id` und löscht sie; wer es war, steht im Protokoll unter derselben `operation_id`, nicht in der Datei.
 */
export const AUFTRAG_DATEI = "backup.request";
export const BACKUP_EVENT = "system.backup_triggered";

const pfad = (dir: string): string => join(dir, AUFTRAG_DATEI);

/** Liegt ein Auftrag, der noch nicht abgeholt ist? Eine unlesbare Datei zählt als Auftrag mit der Zeit der Datei. */
export async function leseAuftrag(dir: string): Promise<SicherungAuftrag | null> {
    let inhalt: string;
    try {
        inhalt = await readFile(pfad(dir), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    try {
        const raw = JSON.parse(inhalt) as { operation_id?: unknown; requested_at?: unknown };
        if (typeof raw.operation_id === "string" && typeof raw.requested_at === "string") {
            return { operationId: raw.operation_id, requestedAt: raw.requested_at };
        }
    } catch {
        // fällt auf die Zeit der Datei zurück
    }
    const info = await stat(pfad(dir));
    return { operationId: "", requestedAt: info.mtime.toISOString() };
}

/** Legt den Auftrag atomar ab. Scheitert etwas, bleibt keine halbe Datei liegen. */
export async function schreibeAuftrag(dir: string, operationId: string, now: Date): Promise<void> {
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${AUFTRAG_DATEI}.${randomUUID()}.tmp`);
    try {
        await writeFile(temp, JSON.stringify({ operation_id: operationId, requested_at: now.toISOString() }), {
            flag: "wx",
            mode: 0o644,
        });
        await rename(temp, pfad(dir));
    } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}

/** Nimmt den eigenen Auftrag zurück (das Protokoll ließ sich nicht schreiben): nur, wenn er noch dieselbe `operation_id` trägt. */
export async function entferneAuftrag(dir: string, operationId: string): Promise<void> {
    const liegt = await leseAuftrag(dir).catch(() => null);
    if (liegt?.operationId === operationId) await unlink(pfad(dir)).catch(() => undefined);
}
