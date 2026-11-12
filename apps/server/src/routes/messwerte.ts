import { cpus, freemem, loadavg, totalmem } from "node:os";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ApiErrorBody, MESSWERTE_URL, MESSWERTE_VERLAUF_URL, Messwerte, MesswerteVerlauf } from "@avesmaps3d/shared";
import { protect } from "../auth/plugin.ts";
import { leseServerVerlauf } from "../besucher/server-verlauf.ts";
import { LIVE_FENSTER_MINUTEN } from "../besucher/zaehler.ts";

/**
 * Die Messwerte des Betriebs (WI-0138 V15): was das Messfenster über diese Instanz und über die Anwesenden sagt.
 *
 * 🔴 **Nur Zahlen dieser Instanz.** Kein Pfad, kein Prozessname, keine Umgebung; wer das liest, erfährt die Auslastung und
 * sonst nichts. Deshalb genügt `use_editor_menu` statt `view_operations`: Die Systemsteuerung zeigt mit SYS-8 das große Bild
 * (Dienste, Platte, Tür) und bleibt beim Admin.
 *
 * 🪤 **CPU ist eine Differenz, kein Zustand.** `process.cpuUsage()` zählt seit dem Start; der Anteil entsteht erst zwischen
 * zwei Fragen. Die erste Antwort nach dem Start trägt deshalb `null`, nicht 0 — eine erfundene Null sähe aus wie Ruhe.
 */

interface Stand {
    cpu: ReturnType<typeof process.cpuUsage>;
    zeit: bigint;
}

let letzter: Stand | undefined;

/** Der Anteil der Kernzeit zwischen zwei Fragen; beim ersten Mal `null`. Rein, damit ein Test ihn ohne Prozess prüft. */
export function cpuAnteil(
    vorher: Stand | undefined,
    jetzt: Stand,
    kerne: number,
): { anteil: number | null; stand: Stand } {
    if (vorher === undefined || jetzt.zeit <= vorher.zeit) return { anteil: null, stand: jetzt };
    const mikrosekunden = Number(jetzt.zeit - vorher.zeit) / 1000;
    const verbraucht = jetzt.cpu.user - vorher.cpu.user + (jetzt.cpu.system - vorher.cpu.system);
    const anteil = verbraucht / (mikrosekunden * Math.max(1, kerne));
    return { anteil: Math.max(0, Math.min(1, anteil)), stand: jetzt };
}

export const messwerteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        MESSWERTE_URL,
        // 🪤 `503: Type.Null()` wäre falsch: Die Route hängt an `protect`, und das setzt `errorEnvelope` (ADR-0018).
        //    Fällt die Datenbank aus, sendet der Fehlerhandler `{ error: { code, message } }`; gegen `null` scheiterte
        //    dessen Serialisierung und aus dem 503 würde ein 500. Dieselbe Falle wie in `besuch.ts`.
        { ...protect("use_editor_menu"), schema: { response: { 200: Messwerte, 503: ApiErrorBody } } },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            const kerne = cpus().length;
            const { anteil, stand } = cpuAnteil(
                letzter,
                { cpu: process.cpuUsage(), zeit: process.hrtime.bigint() },
                kerne,
            );
            letzter = stand;

            // Unter Windows meldet loadavg() drei Nullen; dann steht „unbekannt“ statt einer erfundenen Ruhe.
            const eineMinute = loadavg()[0] ?? 0;
            const last = eineMinute === 0 && process.platform === "win32" ? null : eineMinute / Math.max(1, kerne);

            let besucher = 0;
            let editoren = 0;
            if (app.database) {
                const [zeile] = await app.database<{ besucher: string; editoren: string }[]>`
                    SELECT COUNT(*) FILTER (WHERE actor_type = 'visitor')::text AS besucher,
                           COUNT(*) FILTER (WHERE actor_type = 'editor')::text AS editoren
                    FROM visitor_live
                    WHERE last_seen >= now() - ${`${LIVE_FENSTER_MINUTEN} minutes`}::interval
                `.catch(() => [] as { besucher: string; editoren: string }[]);
                besucher = Number(zeile?.besucher ?? 0);
                editoren = Number(zeile?.editoren ?? 0);
            }

            return {
                server: {
                    cpu: anteil,
                    rss: process.memoryUsage.rss(),
                    ramBelegt: totalmem() - freemem(),
                    ramGesamt: totalmem(),
                    last: last === null ? null : Math.round(last * 1000) / 1000,
                    kerne,
                    laeuftSeit: Math.round(process.uptime()),
                },
                jetzt: { besucher, editoren, fensterMinuten: LIVE_FENSTER_MINUTEN },
            };
        },
    );

    /**
     * Der Verlauf für den Unterreiter „Server“ (WI-0141). Dieselbe Tür wie die Momentwerte: `use_editor_menu`, und es
     * stehen nur Zahlen darin. Ohne Datenbank eine leere Reihe statt eines Fehlers — das Panel zeigt dann „noch keine“.
     */
    app.get(
        MESSWERTE_VERLAUF_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: MesswerteVerlauf } } },
        async (_request, reply) => {
            void reply.header("cache-control", "private, no-store");
            if (!app.database) return { tag: [], tage: [], tafel: leereTafel(), stunden: 0 };
            return await leseServerVerlauf(app.database);
        },
    );
};

/** Sieben Zeilen zu vierundzwanzig Stunden, alles unbekannt. */
const leereTafel = (): (number | null)[][] => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null));
