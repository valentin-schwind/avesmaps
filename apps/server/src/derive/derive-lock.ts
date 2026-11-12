import type { Database } from "../database.ts";

/**
 * Eine Ableitung des Geländes zur Zeit je Kartendomäne (Koordination 2026-09-29): Zwei `derive:terrain` liefen
 * gleichzeitig mit dem Live-Zug, räumten einander Raster weg, und dessen I11 brach mit `raster_je_gebirge` ab.
 *
 * - Eine Sperre für die ganze Kette: das Höhenmodell, das Relief (WI-0054) und die Anzeigehöhen (WI-0055)
 *   bauen aufeinander auf, keine Ableitung darf laufen, während eine andere rechnet oder räumt. Die
 *   Ableitungsfunktionen nehmen sie selbst, so gilt sie für jeden Aufrufer: die CLIs, `legacy:update` im selben
 *   Prozess und den Stage-Korridor. Diese Datei nennt die Ableitungen nicht beim Namen, damit die
 *   Isolationstests von Relief und Anzeigehöhen gelten.
 * - Ein Advisory Lock von PostgreSQL auf einer reservierten Verbindung des Pools. Stirbt der Prozess, schließt
 *   die Verbindung, und die Sperre ist frei. 🪤 `createDatabase` schließt ruhende Verbindungen nach 30 s;
 *   solange die Ableitung rechnet, hält ein kurzes `SELECT 1` alle 10 s die Verbindung und damit die Sperre.
 * - Belegt heißt: sofort und klar abbrechen, bevor etwas geschrieben ist. Kein Warten, kein stilles
 *   Gegeneinander. Advisory Locks gelten je Sitzung: Eine zweite Ableitung auf einer anderen Verbindung
 *   desselben Prozesses bricht ebenso ab.
 *
 * 🔴 ZWEI MODI (JOBS-0001 4.8, WI-0074). Die Sperre ist ein Lesen/Schreiben-Paar:
 *
 *   - **exklusiv** (`withDeriveLock`, wie bisher): `import`, jede CLI-Vollableitung (`derive:terrain`, `legacy:update`).
 *     Verträgt nichts anderes. Ist ein Job der Queue aktiv, bricht sie sofort ab, wie heute.
 *   - **geteilt** (`withSharedDeriveLock`): die Jobs der Queue (`probe` heute, `terrain_local`, `dem_publish`,
 *     `display_heights` ab Etappe 2). Verträgt einander, nicht die exklusiven; die Bereichssperre der Queue trennt die
 *     Kacheln. Der Worker nimmt dieselben Schlüssel auf EINER eigenen Sitzung (`jobs/lock-session.ts`): Advisory Locks
 *     zählen je Sitzung mit, so hält eine Verbindung die geteilte Sperre für alle seine laufenden Jobs.
 *
 *   Bestehende Aufrufer nehmen exklusiv, ihr Verhalten ändert sich nicht. Ein Job, der die geteilte Sperre nicht
 *   bekommt, bleibt `QUEUED` mit dem Grund `waits_domain_lock`.
 *
 * 🔴 DER ZUG WARTET (EDIT-0003 T17): Die Schritte des Legacy-Zugs, die Orte, Wege oder Landschaften schreiben, nehmen die Sperre
 * exklusiv über `withZugSperre` (unten). Halten ein Speichern im Editor oder ein leichter Auftrag sie gerade geteilt, wartet der
 * Schritt, statt abzubrechen, mit einer Obergrenze und einem Befund im Log.
 */

/** Die Klasse der Sperre; die Kartendomäne ist ihr zweiter Schlüssel. */
export const DERIVE_LOCK_CLASS = "avesmaps3d:derive-terrain";

/** So oft hält die reservierte Verbindung sich wach, in Millisekunden (unter den 30 s von `createDatabase`). */
const HEARTBEAT_MS = 10_000;

/** Eine andere Ableitung hält die Sperre; es wurde nichts geschrieben. */
export class DeriveBusyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DeriveBusyError";
    }
}

export type DeriveLockMode = "exclusive" | "shared";

/** Eine gehaltene Sperre; `release()` gibt sie frei und die Verbindung zurück. */
export interface DeriveLockHold {
    readonly mode: DeriveLockMode;
    release(): Promise<void>;
}

/** Macht aus einer reservierten Verbindung, die die Sperre schon hält, eine gehaltene Sperre (Wachhalten und Freigabe). */
function gehalten(
    lock: Awaited<ReturnType<Database["reserve"]>>,
    mapDomainId: string,
    mode: DeriveLockMode,
): DeriveLockHold {
    let released = false;
    const heartbeat = setInterval(() => {
        lock`SELECT 1`.catch(() => undefined);
    }, HEARTBEAT_MS);
    // Ein Timer darf den Prozess nicht am Beenden hindern, wenn niemand mehr freigibt.
    heartbeat.unref();
    return {
        mode,
        release: async () => {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            try {
                if (mode === "exclusive") {
                    await lock`SELECT pg_advisory_unlock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId}))`;
                } else {
                    await lock`SELECT pg_advisory_unlock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId}))`;
                }
            } finally {
                lock.release();
            }
        },
    };
}

/**
 * Versucht, die Sperre zu bekommen, ohne zu warten. `null`, wenn sie belegt ist (nichts ist dann geschrieben).
 * Die Verbindung bleibt reserviert, bis `release()` gerufen wird oder der Prozess endet.
 */
export async function acquireDeriveLock(
    database: Database,
    mapDomainId: string,
    mode: DeriveLockMode,
): Promise<DeriveLockHold | null> {
    const lock = await database.reserve();
    try {
        const [row] =
            mode === "exclusive"
                ? await lock<{ ok: boolean }[]>`
                      SELECT pg_try_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId})) AS ok
                  `
                : await lock<{ ok: boolean }[]>`
                      SELECT pg_try_advisory_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId})) AS ok
                  `;
        if (row?.ok !== true) {
            lock.release();
            return null;
        }
        return gehalten(lock, mapDomainId, mode);
    } catch (error) {
        lock.release();
        throw error;
    }
}

/**
 * Wie `acquireDeriveLock` exklusiv, aber wartend, höchstens `maxWartenMs`; `null`, wenn die Sperre so lange belegt blieb. Gewartet
 * wird in PostgreSQL (`pg_advisory_lock` unter `lock_timeout`), nicht in einer Schleife: Ein wartender exklusiver Halter steht in
 * der Warteschlange der Sperre, und ein neues Speichern (`pg_try_advisory_xact_lock_shared`) kommt nicht mehr an ihm vorbei. So
 * verhungert der Zug nicht neben vielen kurzen Speichervorgängen, und wer während des Wartens speichert, bekommt 503.
 */
async function acquireExclusiveWaiting(
    database: Database,
    mapDomainId: string,
    maxWartenMs: number,
): Promise<DeriveLockHold | null> {
    const lock = await database.reserve();
    try {
        await lock`SELECT set_config('lock_timeout', ${`${String(Math.max(1, Math.round(maxWartenMs)))}ms`}, false)`;
        try {
            await lock`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${mapDomainId}))`;
        } catch (error) {
            // 55P03 lock_not_available: Die Obergrenze ist erreicht, die Sperre blieb belegt.
            if ((error as { code?: string }).code === "55P03") {
                await lock`RESET lock_timeout`;
                lock.release();
                return null;
            }
            throw error;
        }
        await lock`RESET lock_timeout`;
        return gehalten(lock, mapDomainId, "exclusive");
    } catch (error) {
        lock.release();
        throw error;
    }
}

function busyMessage(what: string, mapDomainId: string): string {
    return (
        `${what}: Eine andere Ableitung des Geländes läuft gerade (Kartendomäne ${mapDomainId}). ` +
        "Abgebrochen, nichts geschrieben. Nach deren Ende erneut starten."
    );
}

async function withLock<T>(
    database: Database,
    mapDomainId: string,
    what: string,
    mode: DeriveLockMode,
    run: () => Promise<T>,
): Promise<T> {
    const hold = await acquireDeriveLock(database, mapDomainId, mode);
    if (!hold) {
        throw new DeriveBusyError(busyMessage(what, mapDomainId));
    }
    try {
        return await run();
    } finally {
        await hold.release();
    }
}

/** Führt `run` unter der exklusiven Sperre der Kartendomäne aus; ist sie belegt, wirft es `DeriveBusyError`. */
export function withDeriveLock<T>(
    database: Database,
    mapDomainId: string,
    what: string,
    run: () => Promise<T>,
): Promise<T> {
    return withLock(database, mapDomainId, what, "exclusive", run);
}

/** Wie `withDeriveLock`, aber geteilt: mehrere geteilte Halter laufen nebeneinander, kein exklusiver neben ihnen. */
export function withSharedDeriveLock<T>(
    database: Database,
    mapDomainId: string,
    what: string,
    run: () => Promise<T>,
): Promise<T> {
    return withLock(database, mapDomainId, what, "shared", run);
}

/**
 * So lange wartet ein Schritt des Zugs höchstens auf die Sperre der Kartendomäne, in Millisekunden (T17). Halter der geteilten Sperre
 * neben einem Zug sind ein Speichern im Editor (Millisekunden) und die leichten Aufträge der Warteschlange (`holdsSharedDomainLock`,
 * `jobs/kinds.ts`); die schweren lässt der Dirigent nicht neben dem Zug laufen. Zwei Minuten decken einen Wegprofil-Auftrag; wer
 * länger hält, ist ein Befund, kein stilles Warten.
 */
export const ZUG_SPERRE_MAX_WARTEN_MS = 120_000;

export interface ZugSperreOptionen {
    /** Obergrenze des Wartens; Vorgabe `ZUG_SPERRE_MAX_WARTEN_MS`. */
    maxWartenMs?: number;
    /** Wohin die Befunde gehen; Vorgabe die Fehlerausgabe des Zugs (das Log des Korridors). */
    log?: (zeile: string) => void;
}

/**
 * 🔴 Der Zug schreibt Orte, Wege und Landschaften nur unter der EXKLUSIVEN Sperre der Kartendomäne (EDIT-0003 T17, Zuteilung der
 * Koordination 2026-10-15). Das Speichern im Editor nimmt sie geteilt und antwortet mit 503 `map_import_running`, solange der Zug sie
 * hält (`editor/map-operation.ts`); so fällt kein Speichern zwischen die Zeilen eines Imports.
 *
 * Anders als `withDeriveLock` bricht der Zug nicht ab, wenn gerade ein Speichern oder ein leichter Auftrag die Sperre geteilt hält: Er
 * wartet, höchstens `maxWartenMs`, und sagt es als Befund im Log. Bleibt sie so lange belegt, bricht der Schritt ab, bevor er etwas
 * schreibt (`DeriveBusyError`, ein technischer Abbruch wie „eine andere Ableitung läuft“).
 *
 * Die Schritte nehmen sie selbst, in ihrer Eingangsfunktion; so gilt sie für `legacy:update` (auch mit `--kategorie`) und für die
 * einzelnen CLIs des Korridors. Welche Schritte das sind, folgt aus `EDITOR_TABELLEN` (`migration/pipeline-steps.ts`). 🪤 Ein Schritt,
 * der die Sperre schon selbst nimmt (das Gelände), darf sie nicht ein zweites Mal nehmen: Sie gilt je Verbindung, und die zweite
 * Verbindung desselben Prozesses wartete auf die erste.
 */
export async function withZugSperre<T>(
    database: Database,
    mapDomainId: string,
    what: string,
    run: () => Promise<T>,
    optionen: ZugSperreOptionen = {},
): Promise<T> {
    const maxWartenMs = optionen.maxWartenMs ?? ZUG_SPERRE_MAX_WARTEN_MS;
    const log = optionen.log ?? ((zeile: string) => console.warn(zeile));
    let hold = await acquireDeriveLock(database, mapDomainId, "exclusive");
    if (!hold) {
        const sekunden = String(Math.round(maxWartenMs / 1000));
        log(
            `BEFUND zug_sperre_wartet: ${what} wartet auf die Sperre der Kartendomäne ${mapDomainId}; ein Speichern im Editor oder ` +
                `ein Auftrag der Warteschlange hält sie gerade (höchstens ${sekunden} s).`,
        );
        const beginn = Date.now();
        hold = await acquireExclusiveWaiting(database, mapDomainId, maxWartenMs);
        if (!hold) {
            log(
                `BEFUND zug_sperre_belegt: ${what}: Die Sperre der Kartendomäne ${mapDomainId} blieb ${sekunden} s belegt. ` +
                    "Abgebrochen, nichts geschrieben.",
            );
            throw new DeriveBusyError(
                `${what}: Die Sperre der Kartendomäne ${mapDomainId} blieb ${sekunden} s belegt (ein Speichern im Editor oder ein ` +
                    "Auftrag der Warteschlange). Abgebrochen, nichts geschrieben. Später erneut starten.",
            );
        }
        log(
            `${what}: Sperre nach ${String(Math.round((Date.now() - beginn) / 100) / 10)} s frei, der Schritt schreibt.`,
        );
    }
    try {
        return await run();
    } finally {
        await hold.release();
    }
}
