import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    ABGLEICH_KATEGORIE,
    ABGLEICH_QUELLEN,
    AVENTURIA,
    AbgleichStartBody,
    AdminAbgleiche,
    OperationReceipt,
    abgleichSichtbar,
    type AbgleichAusfuehrungen,
    type AbgleichQuelle,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { ausfuehrungFuer, pickupJobKinds } from "../abgleiche/ausfuehrung.ts";
import { readAbgleiche } from "../abgleiche/lesen.ts";
import { SYNC_EVENT, assertExecutes, enqueueAbgleich } from "../abgleiche/start.ts";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { demand, protect } from "../auth/plugin.ts";
import type { Database } from "../database.ts";
import { planerAktiv } from "../jobs/overview.ts";
import { standJetzt, type StandLage } from "../jobs/stand-datei.ts";
import { leseWarteumstand, umstandMitStand } from "../jobs/wartegrund.ts";

/**
 * Die Abgleiche in der Systemsteuerung (WI-0127 SYS-14, SYS-0001 §9b, §9d). Betreiber 2026-10-10: „du kannst "Zieh mal" auch in die
 * verwaltung tun, dann brauch ichs dir nicht sagen“.
 *
 *     GET  /api/admin/system/abgleiche         je Quelle Kreis, letzter Lauf, laufender Auftrag; Ausführung, Planer   view_operations (V)
 *     POST /api/admin/system/abgleiche/start   { operationId, quelle }                                                 run_legacy_sync (V)
 *                                              Quelle mit Kategorie zusätzlich                                         run_legacy_zug (S)
 *                                              Quelle `production` zusätzlich                                        run_production_pull (S)
 *
 * Unter `/api/admin/system…`, weil der Wächter der Protokollpflicht dort jede schreibende Route einer Ereignisart zuordnet (SYS-0001
 * §9d.2). Der Start reiht in DERSELBEN Transaktion wie sein Protokollereignis (`system.sync_requested`) einen Job ein (`enqueueAbgleich`,
 * dieselbe Stelle wie die Kommandozeile `abgleich-starten`), mit der Person als Auslöser. Er ist ein Produktprozess eines berechtigten
 * Nutzers, kein Agenten-Zug (AGENTS.md, Map Mutation Guard); das Werkzeug bekommt `--auftrag <Job>` statt eines Betreiberzitats.
 *
 * - Schreibklasse `import`: Weder Kartensperre noch Systemsperre halten einen Import an (Betreiber 2026-10-10, Frage 3).
 * - Wartet oder läuft schon ein Auftrag dieser Zeile: 409 `sync_running`, nichts eingereiht, kein Protokoll. Hinter einem anderen
 *   Abgleich reiht eine Zeile ein; der Betrieb fährt sie nacheinander (Betreiber 2026-10-17, `abgleiche/start.ts`).
 * - Führt diese Umgebung keine Aufträge dieser Quelle aus (`ABGLEICHE`, Quelle `aus`): 503 `sync_unavailable`. Bei `korridor` (Stage,
 *   SYS-14b) übernimmt Claudios Abholer über `job_sync_claim` (Migration 0098); der Auftrag wartet bis dahin auf die Abholung.
 * - Läuft kein Planer, wartet der Auftrag; die Quittung sagt es (`planner_inactive`).
 * - **Je Kategorie eine Zeile** (WI-0141, Betreiber 2026-10-13): `legacy_landschaften`, `legacy_wege`, `legacy_orte` reihen die Art
 *   `legacy_zug` mit ihrer Kategorie in der Eingabe ein und verlangen zusätzlich `run_legacy_zug` (Stufe S, frischer Passkey), weil
 *   sie die Tafeln der Lesekarte ersetzen. Bis 2026-10-17 sperrte ein wartender oder laufender Zug alle vier Knöpfe; seitdem reiht
 *   jede Zeile hinter ihm ein, nur sich selbst sperrt sie.
 * - **Der Production-Zug** (`production`, WI-0144, Betreiber 2026-10-14) reiht `production_pull` ein und verlangt zusätzlich
 *   `run_production_pull` (Stufe S): Er ersetzt die Kartendaten, die Kacheln und die Medien der ganzen Umgebung. Er schließt jeden
 *   anderen Abgleich aus und jeder andere ihn (409 `sync_running`). Rechnen kann ihn nur Claudios Abholer über den Korridor.
 * - **Verborgene Zeilen** (`ABGLEICHE=…:verborgen`) stehen nicht in der Antwort: Was diese Umgebung nicht hat, zeigt sie auch nicht.
 * - **Die gemeinsame Warteschlange** (WI-0163): Mit dem Stand des Dirigenten kommen Grund und Platz eines wartenden Auftrags aus der
 *   gemeinsamen Reihe, und „Planer aktiv“ heißt: Der Dirigent plant diese Umgebung (Stand nicht älter als 30 s).
 */

async function plannerActive(
    database: Database,
    stand: { lage: StandLage; umgebung: WarteschlangeUmgebung },
): Promise<boolean | null> {
    try {
        return await planerAktiv(database, AVENTURIA.mapDomain, stand);
    } catch {
        return null;
    }
}

export const adminAbgleicheRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        "/api/admin/system/abgleiche",
        { ...protect("view_operations"), schema: { response: { 200: AdminAbgleiche, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            const database = app.database!;
            const modes = Object.fromEntries(
                ABGLEICH_QUELLEN.map((quelle) => [quelle, ausfuehrungFuer(app.config.abgleiche, quelle)]),
            ) as AbgleichAusfuehrungen;
            const stand = await standJetzt(app.warteschlangeStand);
            const planerAktiv = await plannerActive(database, stand);
            // Der Wartegrund kommt aus derselben Stelle wie auf der Statusseite (WI-0160): In Production schreibt kein Planer
            // einen, und eine wartende Zeile stand dort stumm da. Mit dem Stand des Dirigenten dessen Grund (WI-0163).
            const umstand = umstandMitStand(
                await leseWarteumstand(database, {
                    plannerActive: planerAktiv === true,
                    pickupKinds: pickupJobKinds(modes),
                }),
                stand.lage,
                stand.umgebung,
            );
            const alle = await readAbgleiche(database, modes, umstand);
            // 🔴 Verborgene Zeilen gehen nicht hinaus (WI-0144): Die Regel steht hier und nicht in der Oberfläche, damit ein
            //    älterer Bundle im Browser sie auch nicht zeigt.
            //    Lokal steht im Datenabgleich allein der Abzug von Stage und Production (WI-0251), solange `ABGLEICHE` nichts anderes will.
            const zeilen =
                app.config.abzug?.abgleicheVerbergen === true
                    ? []
                    : alle.filter((zeile) => abgleichSichtbar(zeile.ausfuehrung, zeile.quelle));
            return { now: new Date().toISOString(), ausfuehrung: modes.legacy, planerAktiv, zeilen };
        },
    );

    app.post(
        "/api/admin/system/abgleiche/start",
        {
            ...protect("run_legacy_sync", { writeClass: "import" }),
            schema: { body: AbgleichStartBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId } = request.body;
            const quelle: AbgleichQuelle = request.body.quelle;
            const kategorie = ABGLEICH_KATEGORIE[quelle];
            // Eine Kategorie ersetzt Tafeln der Lesekarte: dafür das eigene Recht mit frischem Passkey (WI-0141).
            if (kategorie !== null) demand(session, "run_legacy_zug", app.authConfig);
            // Der Production-Zug ersetzt die Daten, Kacheln und Medien der ganzen Umgebung (WI-0144): eigenes Recht, Stufe S.
            if (quelle === "production") demand(session, "run_production_pull", app.authConfig);
            const ausfuehrung = ausfuehrungFuer(app.config.abgleiche, quelle);
            assertExecutes(ausfuehrung);
            const database = app.database!;
            // Den Planer braucht nur der Worker; Claudios Abholer holt den Auftrag ohne ihn ab.
            const planner =
                ausfuehrung === "worker"
                    ? await plannerActive(database, await standJetzt(app.warteschlangeStand))
                    : null;
            return adminOperation(
                database,
                session,
                { operationId, body: { action: "sync.start", quelle } },
                async (tx) => {
                    const { kind, jobId } = await enqueueAbgleich(tx, { quelle, actorRef: session.personId });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind, jobId, state: "queued" }],
                            warnings:
                                planner === false
                                    ? [
                                          {
                                              code: "planner_inactive",
                                              message:
                                                  "Der Planer der Warteschlange läuft nicht: Der Auftrag wartet, bis er startet.",
                                          },
                                      ]
                                    : [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: SYNC_EVENT,
                            targetRef: `job:${jobId}`,
                            details: { source: quelle, job: jobId },
                        },
                    };
                },
            );
        },
    );
};
