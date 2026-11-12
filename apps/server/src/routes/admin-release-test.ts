import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    AVENTURIA,
    OperationReceipt,
    RELEASE_TEST_ERROR_STATUS,
    RELEASE_TEST_JOB_KIND,
    RELEASE_TEST_URL,
    ReleaseTestAbbrechenBody,
    ReleaseTestBericht,
    ReleaseTestBerichtQuery,
    ReleaseTestSicht,
    ReleaseTestStartBody,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { standJetzt } from "../jobs/stand-datei.ts";
import { leseReleaseTestAuftrag } from "../system/release-test-auftrag.ts";
import { createReleaseTestDienst, freigabeKennung } from "../system/release-test.ts";

/**
 * Der Release-Test auf dem Entwicklungsrechner (WI-0248 L; Betreiber 2026-10-23: den Test löst er selbst aus, in der lokalen Systemsteuerung):
 *
 *     GET  /api/admin/system/release-test            Kandidat, Stand des Laufs, Start, Auftrag      switch_environment (V)
 *     POST /api/admin/system/release-test/starten    { operationId, commit, wiederholen?, volltest? } release_to_production + Passkey (Stufe S)
 *     POST /api/admin/system/release-test/abbrechen  { operationId, commit }                         switch_environment (V)
 *     GET  /api/admin/system/release-test/bericht    ?commit=<sha40>                                 switch_environment (V)
 *
 * - 🔴 **Nur lokal.** `admin.ts` meldet diese Datei nur an, wenn die Konfiguration `releaseTest` trägt (`releaseTestLokal`: Entwicklungsrechner);
 *   auf Stage und Production gibt es die Routen nicht.
 * - Nur Betreiber (`switch_environment`, wie der Stand der Umgebungen). **Starten mit frischem Passkey** wie die Production-Freigabe: Der Lauf
 *   dauert Stunden und belegt den Rechner. **Abbrechen ohne**: die sichere Richtung.
 * - 🔴 **Starten reiht ein** (Vali 2026-10-26): Die Vorprüfung des Starters (Stand gewechselt, schon grün, es läuft schon, Sperre) läuft VOR der
 *   Verwaltungshandlung und weist ab wie bisher; die Handlung reiht in derselben Transaktion wie ihr Ereignis einen schweren Auftrag `release_test`
 *   mit der Person ein (`release_test_einreihen`, Migration 0228). Den Starter ruft der Ausführer, wenn der schwere Platz frei ist
 *   (`jobs/release-test-job.ts`). Wartet oder läuft schon ein Auftrag, weist die Route ab (409 `release_test_laeuft`).
 * - **Abbrechen** bricht den Auftrag ab (wartend: sofort; laufend: der Ausführer beendet den Lauf) und legt, wo ein Lauf läuft, gleich die Datei
 *   ABBRUCH an. Ein Lauf ohne Auftrag (von Hand gestartet) wird wie bisher über den Starter abgebrochen.
 * - 🔴 **Der Start ist die Production-Freigabe** (WI-0248; Vali 2026-10-26: „Nein das passiert automatisch, sobald der test grün war“). Darum das Recht
 *   `release_to_production` mit Passkey, und in derselben Transaktion wie der Auftrag die Freigabe für genau diesen Stand mit der Person
 *   (`refs/notes/release-auftrag`, Kennung `RT-<Auftrag>`, über den Starter). Lässt sie sich nicht schreiben, rollt alles zurück: kein Test ohne
 *   Freigabe. Ist der Stand schon grün geprüft, gibt der Druck ihn frei, ohne neuen Lauf. Abbrechen beendet auch die Freigabe (`abgebrochen`).
 * - **Der Bericht** (`…/bericht`): die eine Seite des Laufs (`bericht.md`, `scripts/dev/release-seite.ts`) für die Karte und „Bericht kopieren“.
 * - 🔴 **Der Volltest** (`volltest: true`, WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): dieselbe Route, dasselbe Recht und derselbe Passkey
 *   (er belegt den Rechner Stunden), derselbe Auftrag `release_test` mit `volltest` in der Eingabe. Aber KEINE Freigabe: Die Route schreibt nichts
 *   nach `refs/notes/release-auftrag`, und Abbrechen beendet bei einem Volltest keine Freigabe (es gibt keine, und eine Abbruchzeile an derselben SHA
 *   überschriebe die Freigabe eines Schnelltests). Das Ereignis trägt `volltest: true` statt einer Kennung.
 */
export const adminReleaseTestRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Tests geben den Starter über `config.releaseTest.starter` vor (ein Ersatz-Skript); die Dienstlogik prüfen sie mit ersetztem Prozessaufruf.
    const dienst = createReleaseTestDienst({
        starter: app.config.releaseTest?.starter,
        warn: (meldung) => app.log.warn(meldung),
    });
    const laeuftSchon = (auftrag: string): ApiError =>
        new ApiError(
            RELEASE_TEST_ERROR_STATUS.release_test_laeuft,
            "release_test_laeuft",
            "Ein Release-Test wartet oder läuft schon in der Warteschlange.",
            { auftrag },
        );
    /** Der aktive Auftrag, wenn einer wartet oder läuft; vor jeder Vorprüfung, damit ein zweiter Druck den Starter gar nicht erst fragt. */
    async function aktiverAuftrag(): Promise<string | null> {
        return (await aktiverAuftragMitStand())?.id ?? null;
    }
    /** Dasselbe mit dem Stand, den er prüft (für das Beenden seiner Freigabe, WI-0248), und ob er ein Volltest ist (der hat keine, WI-0264). */
    async function aktiverAuftragMitStand(): Promise<{ id: string; commit: string | null; volltest: boolean } | null> {
        const [zeile] = await app.database!<{ public_id: string; commit: string | null; volltest: boolean }[]>`
            SELECT public_id::text AS public_id, input_ref->>'commit' AS commit,
                   COALESCE((input_ref->>'volltest')::boolean, false) AS volltest
              FROM job
             WHERE kind = ${RELEASE_TEST_JOB_KIND} AND state IN ('QUEUED', 'RUNNING')
             ORDER BY id DESC LIMIT 1
        `;
        return zeile === undefined ? null : { id: zeile.public_id, commit: zeile.commit, volltest: zeile.volltest };
    }

    app.get(
        RELEASE_TEST_URL,
        {
            ...protect("switch_environment"),
            // `?frisch=1`: die Karte liest unmittelbar vor einem Start den Kandidaten neu (Notizen holen, nicht aus dem Gedächtnis).
            schema: {
                querystring: Type.Object({ frisch: Type.Optional(Type.Literal("1")) }, { additionalProperties: false }),
                response: { 200: ReleaseTestSicht, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const [sicht, auftrag] = await Promise.all([
                dienst.sicht({ frisch: request.query.frisch === "1" }),
                leseReleaseTestAuftrag(
                    app.database!,
                    await standJetzt(app.warteschlangeStand, new Date()),
                    AVENTURIA.mapDomain,
                ).catch((error: unknown) => {
                    app.log.warn({ err: error }, "release-test: Auftrag der Warteschlange nicht lesbar");
                    return null;
                }),
            ]);
            return { ...sicht, auftrag };
        },
    );

    app.post(
        `${RELEASE_TEST_URL}/starten`,
        {
            // Der Start IST die Production-Freigabe (WI-0248): dasselbe Recht wie der frühere Freigabe-Knopf, mit Passkey unmittelbar davor.
            ...protect("release_to_production", { confirm: "passkey", writeClass: "system" }),
            schema: { body: ReleaseTestStartBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, commit, wiederholen = false, volltest = false } = request.body;
            const body = {
                action: "release_test.starten",
                commit,
                ...(wiederholen ? { wiederholen } : {}),
                ...(volltest ? { volltest } : {}),
            };
            const schon = await aktiverAuftrag();
            // Dieselbe Handlung noch einmal (Netz, Doppelklick) bekommt ihre Quittung; ein anderer Druck neben einem Auftrag nicht.
            if (schon !== null)
                return await adminOperation(app.database!, session, { operationId, body }, async () => {
                    throw laeuftSchon(schon);
                });
            const schein = await dienst.pruefeStart(commit, wiederholen, volltest);
            try {
                return await adminOperation(app.database!, session, { operationId, body }, async (tx) => {
                    // Der Volltest (WI-0264) hat seine eigene Funktion (Migration 0267): derselbe Auftrag mit `volltest` in der Eingabe, nie `wiederholen`.
                    const [job] = volltest
                        ? await tx<{ public_id: string; created: boolean }[]>`
                              SELECT public_id::text AS public_id, created
                                FROM release_test_volltest_einreihen(
                                    ${session.personId}, ${commit}, ${schein.erwartetS}::integer, ${AVENTURIA.mapDomain}
                                )
                          `
                        : await tx<{ public_id: string; created: boolean }[]>`
                              SELECT public_id::text AS public_id, created
                                FROM release_test_einreihen(
                                    ${session.personId}, ${commit}, ${wiederholen}, ${schein.erwartetS}::integer, ${AVENTURIA.mapDomain}
                                )
                          `;
                    if (job === undefined) throw new Error("release_test_einreihen lieferte keine Zeile");
                    if (!job.created) throw laeuftSchon(job.public_id);
                    // 🔴 Die Freigabe für genau diesen Stand, mit der Person, in derselben Handlung (WI-0248). Scheitert sie, wirft sie, und die
                    // Transaktion rollt zurück: kein Auftrag, kein Ereignis, kein Test ohne Freigabe. Der Volltest gibt nichts frei (WI-0264).
                    const kennung = volltest ? null : freigabeKennung(job.public_id);
                    if (kennung !== null) await dienst.freigeben(schein, kennung, session.displayName);
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: RELEASE_TEST_JOB_KIND, jobId: job.public_id, state: "QUEUED" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.release_test_gestartet",
                            details: {
                                commit: commit.slice(0, 12),
                                ...(kennung === null ? { volltest: true } : { freigabe: kennung }),
                                ...(wiederholen ? { wiederholen } : {}),
                            },
                        },
                    };
                });
            } finally {
                dienst.verwirf(schein);
            }
        },
    );

    app.post(
        `${RELEASE_TEST_URL}/abbrechen`,
        {
            ...protect("switch_environment", { writeClass: "system" }),
            schema: { body: ReleaseTestAbbrechenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, commit } = request.body;
            /** Was der Auftrag sagte: `abgebrochen` (wartete), `angefordert` (läuft), `keiner` (kein Auftrag). */
            let auftrag: string | null = null;
            /** Der Auftrag, dessen Freigabe mit dem Abbruch endet (WI-0248). */
            const aktiv = await aktiverAuftragMitStand();
            const quittung = await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "release_test.abbrechen", commit } },
                async (tx) => {
                    const [zeile] = await tx<{ ergebnis: string }[]>`SELECT release_test_abbrechen() AS ergebnis`;
                    auftrag = zeile?.ergebnis ?? "keiner";
                    // Ohne Auftrag (ein Lauf, von Hand gestartet) bricht der Starter ab, wie bisher; scheitert das, gibt es kein Ereignis.
                    if (auftrag === "keiner") await dienst.abbrechen(commit);
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.release_test_abgebrochen",
                            details: {
                                commit: commit.slice(0, 12),
                                ...(aktiv === null
                                    ? {}
                                    : aktiv.volltest
                                      ? { volltest: true }
                                      : { freigabe: freigabeKennung(aktiv.id) }),
                            },
                        },
                    };
                },
            );
            // Läuft der Auftrag, liegt gleich die Datei ABBRUCH im Ergebnisordner, statt auf den nächsten Takt des Ausführers zu warten. Baut der
            // Starter noch, gibt es keinen Lauf zum Abbrechen: Dann bricht der Ausführer ab, sobald der Runner da ist.
            if (auftrag === "angefordert")
                await dienst.abbrechen(commit).catch((error: unknown) => {
                    app.log.info({ err: error }, "release-test: Abbruch über den Ausführer (noch kein Lauf)");
                });
            // Abbrechen heißt auch: keine Auslieferung (WI-0248). Ein wartender Auftrag kommt nie zum Ausführer, darum beendet die Route die Freigabe
            // selbst; ein laufender tut es an seinem Ende noch einmal (dann „unverändert“). Ein Fehler hier hält den Abbruch nicht an: Ohne grünen
            // Nachweis mit dieser Kennung liefert ohnehin nichts aus.
            // 🔴 Nicht beim Volltest (WI-0264): Er hat keine Freigabe, und eine Abbruchzeile an derselben SHA überschriebe die eines Schnelltests.
            if (aktiv !== null && !aktiv.volltest && aktiv.commit !== null && /^[0-9a-f]{40}$/u.test(aktiv.commit)) {
                const ende = await dienst.freigabeBeenden(
                    aktiv.commit,
                    freigabeKennung(aktiv.id),
                    `Abgebrochen von ${session.displayName}`,
                );
                if (ende.status === "fehler")
                    app.log.warn({ grund: ende.grund }, "release-test: Freigabe nicht beendet");
            }
            return quittung;
        },
    );

    app.get(
        `${RELEASE_TEST_URL}/bericht`,
        {
            ...protect("switch_environment"),
            schema: { querystring: ReleaseTestBerichtQuery, response: { 200: ReleaseTestBericht, ...ADMIN_ERRORS } },
        },
        async (request) => await dienst.bericht(request.query.commit),
    );
};
