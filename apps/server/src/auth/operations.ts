import { createHash } from "node:crypto";
import type { OperationReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { recordEvent, type AuditEvent } from "./audit.ts";
import type { Sql } from "./session-store.ts";

/**
 * Eine Handlung höchstens einmal (ADR-0019, M10 b): Die Kennung `operationId`, ein Hash des Inhalts und die Quittung stehen im
 * selben Eintrag wie die Handlung, in derselben Transaktion. Dieselbe Kennung mit demselben Inhalt liefert die gespeicherte Quittung
 * (`replayed`), mit anderem Inhalt 409 `idempotency_key_reused`.
 *
 * WO Kennung, Hash und Quittung stehen, sagt die Speicherstelle (`OperationStore`). Die Vorgabe ist das Protokoll der Anmeldung und
 * Verwaltung (`avesmaps_auth.security_event`); eine Fachdomäne bringt mit ihrem ersten Schreibpfad ihre eigene mit (ADR-0019 Nr. 3),
 * die Medien `media_operation` und `media_audit_event` (WI-0068 P4a, `media-editor/operation-store.ts`). Die Regeln bleiben dieselben.
 */
export function requestHash(body: unknown): Buffer {
    return createHash("sha256").update(stableJson(body), "utf8").digest();
}

/** JSON mit sortierten Schlüsseln, damit derselbe Inhalt denselben Hash hat; Geheimnisse vorher entfernen. */
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

/** Was eine Speicherstelle über eine schon ausgeführte Kennung weiß; `request_hash` ist nach dem Schwärzen `null`. */
export interface StoredOperation {
    request_hash: Buffer | null;
    receipt: OperationReceipt | null;
}

/**
 * Die Speicherstelle einer Operation: wo die Kennung gesucht und wo die ausgeführte Handlung samt Hash und Quittung festgehalten
 * wird. `record` läuft in DERSELBEN Transaktion wie die Handlung. Eine zweite Zeile mit derselben Kennung muss an einem eindeutigen
 * Schlüssel scheitern (23505): Daran erkennt `runOperation` zwei gleichzeitige Anfragen mit derselben Kennung.
 */
export interface OperationStore<E> {
    find(sql: Sql, operationId: string): Promise<StoredOperation | undefined>;
    record(
        tx: Sql,
        entry: { operationId: string; requestHash: Buffer; receipt: OperationReceipt; event: E },
    ): Promise<void>;
}

/** Die Vorgabe: das Protokoll der Anmeldung und Verwaltung, ein Eintrag je Handlung mit Kennung, Hash und Quittung. */
export const SECURITY_EVENT_STORE: OperationStore<AuditEvent> = {
    async find(sql, operationId) {
        const [row] = await sql<StoredOperation[]>`
            SELECT request_hash, receipt FROM avesmaps_auth.security_event WHERE operation_id = ${operationId}
        `;
        return row;
    },
    async record(tx, { operationId, requestHash: hash, receipt, event }) {
        await recordEvent(tx, { ...event, operationId, requestHash: hash, receipt });
    },
};

function replay(previous: StoredOperation, hash: Buffer): OperationReceipt {
    if (previous.request_hash === null || !previous.request_hash.equals(hash) || previous.receipt === null) {
        throw new ApiError(409, "idempotency_key_reused", "Diese Kennung gehört schon zu einer anderen Handlung.");
    }
    return { ...previous.receipt, status: "replayed" };
}

export type OperationWork<E> = (
    tx: Sql,
) => Promise<{ receipt: Omit<OperationReceipt, "operationId" | "status">; event: E }>;

export interface OperationOptions {
    /**
     * Nimmt zu Beginn der Transaktion eine Sperre (etwa eine je Umgebung für alle Handlungen an Personen); danach wird die Kennung
     * noch einmal gesucht. So bekommt ein gleichzeitiger Doppelklick die Quittung der ersten Anfrage und keinen
     * Bearbeitungskonflikt mit sich selbst.
     */
    serialize?: (tx: Sql) => Promise<void>;
}

/**
 * Führt `work` in einer Transaktion aus, hält Kennung, Hash und Quittung an der Speicherstelle fest und gibt die Quittung zurück.
 * `body` ist der Inhalt ohne Geheimnisse (etwa ohne Passwort, ohne die Bytes einer Datei, wohl aber ihr Hash), über den die
 * Wiederholung erkannt wird. Ohne `store` gilt die Speicherstelle der Verwaltung (`security_event`), wie vor WI-0068 P4a.
 *
 * 🪤 Die Überladung der Verwaltung steht ZULETZT: `Parameters<typeof runOperation>` liest die letzte, und die Verbraucher der
 * Verwaltung (etwa `routes/account.ts`) leiten ihre Typen so davon ab; sie bleiben unverändert.
 */
export function runOperation<E>(
    database: Database,
    input: { operationId: string; body: unknown },
    work: OperationWork<E>,
    options: OperationOptions & { store: OperationStore<E> },
): Promise<OperationReceipt>;
export function runOperation(
    database: Database,
    input: { operationId: string; body: unknown },
    work: OperationWork<AuditEvent>,
    options?: OperationOptions,
): Promise<OperationReceipt>;
export async function runOperation<E>(
    database: Database,
    input: { operationId: string; body: unknown },
    work: OperationWork<E>,
    options: OperationOptions & { store?: OperationStore<E> } = {},
): Promise<OperationReceipt> {
    // Ohne eigene Speicherstelle ist `E` das Protokoll der Verwaltung (erste Überladung).
    const store = options.store ?? (SECURITY_EVENT_STORE as unknown as OperationStore<E>);
    const hash = requestHash(input.body);
    const previous = await store.find(database, input.operationId);
    if (previous !== undefined) return replay(previous, hash);
    try {
        return await database.begin(async (tx) => {
            if (options.serialize !== undefined) {
                await options.serialize(tx);
                const meanwhile = await store.find(tx, input.operationId);
                if (meanwhile !== undefined) return replay(meanwhile, hash);
            }
            const { receipt, event } = await work(tx);
            const full: OperationReceipt = { ...receipt, operationId: input.operationId, status: "applied" };
            await store.record(tx, { operationId: input.operationId, requestHash: hash, receipt: full, event });
            return full;
        });
    } catch (error) {
        // Zwei gleiche Kennungen gleichzeitig: Die zweite scheitert am eindeutigen Schlüssel und bekommt die erste Quittung.
        if ((error as { code?: string }).code === "23505") {
            const winner = await store.find(database, input.operationId);
            if (winner !== undefined) return replay(winner, hash);
        }
        throw error;
    }
}
