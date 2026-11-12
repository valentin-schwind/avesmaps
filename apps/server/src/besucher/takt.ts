import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../database.ts";
import { schreibeSchnittstellen, verdichteSchnittstellen } from "./api-zaehler.ts";
import { raeumeDiagnosenAuf } from "./diagnosen.ts";
import { raeumeAuf, verdichte } from "./zaehler.ts";

/**
 * Der Takt der Besucherstatistik (WI-0138): alle fünf Minuten aufräumen und verdichten.
 *
 * 🔴 **Ohne diesen Takt wäre die Aufbewahrung nur eine Behauptung** (Befund der Sicherheitsprüfung 2026-10-13): Tageskennungen von
 * gestern blieben stehen, und eine Anwesenheit ohne Lebenszeichen würde nie zur Verweildauer. Beides steht im Datenschutztext,
 * also muss es laufen und nicht nur geschrieben sein.
 *
 * Vorbild und Form: die Stichprobe des Systemzustands (`system/stichprobe.ts`, SYS-8). Ein Lauf ist für sich genommen harmlos:
 * Er löscht nur, was ohnehin abgelaufen ist, und verschmilzt seltene Ausprägungen zu „übrige“. Zwei Instanzen stören einander
 * nicht (alles additiv beziehungsweise idempotent).
 */

export interface BesucherTakt {
    start(): void;
    stop(): void;
    /** Für Tests: ein Lauf von Hand. */
    lauf(): Promise<void>;
}

export const BESUCHER_TAKT_MS = 5 * 60_000;

export function createBesucherTakt(options: {
    database: Database;
    log: FastifyBaseLogger;
    intervalMs?: number;
}): BesucherTakt {
    const intervalMs = options.intervalMs ?? BESUCHER_TAKT_MS;
    let timer: ReturnType<typeof setInterval> | undefined;
    let laeuft = false;

    const lauf = async (): Promise<void> => {
        if (laeuft) return;
        laeuft = true;
        try {
            const aufgeraeumt = await raeumeAuf(options.database);
            const verschoben = await verdichte(options.database);
            const wege = await schreibeSchnittstellen(options.database);
            const verdichtet = await verdichteSchnittstellen(options.database);
            // Die Frist der Diagnosen aus dem Browser (WI-0202): Was hier nicht läuft, stünde nur im Datenschutztext.
            const diagnosen = await raeumeDiagnosenAuf(options.database);
            if (
                aufgeraeumt.beendet > 0 ||
                aufgeraeumt.kennungen > 0 ||
                verschoben > 0 ||
                wege > 0 ||
                verdichtet > 0 ||
                diagnosen > 0
            ) {
                options.log.debug(
                    { ...aufgeraeumt, verschoben, wege, verdichtet, diagnosen },
                    "Besucherstatistik aufgeräumt",
                );
            }
        } catch (fehler) {
            options.log.warn({ err: fehler }, "Besucherstatistik: Aufräumen fehlgeschlagen");
        } finally {
            laeuft = false;
        }
    };

    return {
        start(): void {
            if (timer) return;
            void lauf();
            timer = setInterval(() => void lauf(), intervalMs);
            timer.unref?.();
        },
        stop(): void {
            if (timer) clearInterval(timer);
            timer = undefined;
        },
        lauf,
    };
}
