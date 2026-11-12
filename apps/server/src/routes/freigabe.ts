import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Value } from "@sinclair/typebox/value";
import {
    AVENTURIA,
    FREIGABE_ERROR_STATUS,
    FREIGABE_JOB_KIND,
    FREIGABE_URL,
    FreigabeDatei,
    FreigabeReleaseBody,
    FreigabeRollbackBody,
    FreigabeSicht,
    OperationReceipt,
    FreigabeAbbrechenBody,
    NACHT_TITEL,
    nachtsFreigeben,
    opsId,
    sperreVon,
    type FreigabeLauf,
    type FreigabeSperre,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { KanalFehler, kanalFehler } from "../kanal/db.ts";
import { createStatusFileReader } from "../system/status-files.ts";
import { fortschritteZu } from "./freigabe-fortschritt.ts";

/**
 * Die Production-Freigabe, Stufe 1 (FREIGABE-0001; Betreiber 2026-10-13: „alles wie empfohlen, ja“ — Stufe 1 zuerst).
 *
 *     GET   /api/admin/system/production            was noch nicht draußen ist          view_operations
 *     POST  /api/admin/system/production/release    der geprüfte Stand geht raus        release_to_production (Passkey)
 *     POST  /api/admin/system/production/rollback   zurück auf das vorige Release       release_to_production (Passkey)
 *
 * - 🔴 **Der Server rechnet nichts.** Er kennt weder Git noch Production; was dasteht, kommt aus Claudios Statusdatei
 *   (`FREIGABE_STATUS_FILE`, geschrieben von `npm run freigabe:stand`). Fehlt sie, heißt es „nicht eingerichtet“ — lokal der Normalfall.
 * - 🔴 **Die Freigabe ist ein Vorgang im Kanal** (§8): Der Server legt ihn an, Claudios Abholer arbeitet ihn ab, die Abnahme und der
 *   Weg zurück laufen über die Mechanik, die der Kanal seit WI-0124 hat. Hier entsteht kein zweites Protokoll.
 * - 🔴 **Nur mit grüner Stage** (`sperreVon`; im Nachtmodus genügen grüne Proben, siehe unten), und **nur auf dem Stand, den die Oberfläche gesehen hat**: Hat sich die Stage seit dem
 *   Blick bewegt, wird abgelehnt (409 `freigabe_stale`), statt etwas anderes zu schieben, als dastand.
 * - **Der Kandidat fehlt mit Absicht** — Stufe 2.
 * - **Nachts ausliefern** (WI-0234; Betreiber 2026-10-19: „dann machen wir das "Für Production freigeben, nachts ausliefern" ja“):
 *   Sagt die Statusdatei `nachts`, gibt derselbe Knopf den Stand nur frei (`nacht`, Titel `NACHT_TITEL`). Seit WI-0248 IST das Freigeben
 *   die Kandidatenbenennung: Es genügen grüne Proben (`probenGruen`), und danach wird genau dieser Stand vollständig geprüft; Claudios
 *   Abholer liefert ihn nur mit grünem Release-Nachweis im Nachtfenster (04:30–07:00) aus. Der Satz im Vorgang sagt, welcher der beiden Fälle
 *   vorliegt (`nachweis`). Ohne `nachts` schiebt der Knopf sofort und nur mit `stageGruen === true`. Eine Nacht-Freigabe zählt nicht als
 *   „läuft“; ein neuer Druck löst sie ab (`kanal_freigabe_anlegen`, 0207). Abbrechen darf jeder aktive Betreiber, ohne Passkey.
 * - 🔴 **Der Druck reiht ein** (WI-0248; Vali 2026-10-26: die Freigabe mit der Person einreihen, ihr Fortschritt im Kopf): In derselben Transaktion wie
 *   der Vorgang steht ein angekündigter Auftrag `production_freigabe` mit der Person (`freigabe_auftrag_einreihen`, Migration 0228, Ref
 *   `freigabe-<OPS>`). Er belegt keinen Platz, solange er auf Prüfung oder Abholung wartet; Claudios `record start` übernimmt ihn, und die Person sieht
 *   die Freigabe mit Phase in der Kopfleiste. Erlischt der Vorgang vorher (Abbrechen, Ablösen, rote Prüfung), endet der Auftrag (Auslöser
 *   `freigabe_auftrag`).
 */

/** Das Format der Statusdatei prüfen; eine fremde Form heißt „nicht lesbar“, nicht „halb gelesen“. */
function leseDatei(roh: unknown): FreigabeDatei | null {
    return Value.Check(FreigabeDatei, roh) ? roh : null;
}

interface VorgangZeile {
    ops: string;
    art: string;
    status: string;
    gemeldet_at: Date;
    titel: string | null;
    wer: string | null;
    release: string | null;
}

export const freigabeRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const db = (): Queryable => app.database!;
    const lesen = protect("view_operations");
    // Stufe S: der Passkey unmittelbar davor. Hier geht etwas nach draußen — das ist kein täglicher Handgriff.
    const freigeben = protect("release_to_production", { confirm: "passkey", writeClass: "system" });
    const reader = createStatusFileReader(app.config.freigabe?.statusFile, "freigabe", leseDatei, {
        warn: (message) => app.log.warn(message),
    });

    /** Die laufende Freigabe: ein Vorgang der Art `freigabe`, der noch nicht abgenommen ist. Eine Nacht-Freigabe läuft noch nicht. */
    async function laufende(environment: string): Promise<VorgangZeile | undefined> {
        const [zeile] = await db()<VorgangZeile[]>`
            SELECT v.id::text AS ops, v.art, v.status, v.gemeldet_at, v.titel,
                   NULL::text AS wer, NULL::text AS release
              FROM avesmaps_kanal.vorgang v
             WHERE v.environment = ${environment} AND v.art = 'freigabe'
               AND v.status NOT IN ('abgenommen', 'abgelehnt')
               AND coalesce(v.titel, '') NOT LIKE ${NACHT_TITEL + "%"}
             ORDER BY v.gemeldet_at DESC
             LIMIT 1
        `.catch(() => []);
        return zeile;
    }

    /** Die offene Nacht-Freigabe (WI-0234), mit Person und Commit aus dem Vorgang; `undefined`: keine. */
    async function offeneNacht(
        environment: string,
    ): Promise<{ ops: string; titel: string; nachricht: string | null; seit: Date; wer: string | null } | undefined> {
        const [zeile] = await db()<
            { ops: string; titel: string; nachricht: string | null; seit: Date; wer: string | null }[]
        >`
            SELECT v.id::text AS ops, v.titel, v.nachricht, v.gemeldet_at AS seit, p.display_name AS wer
              FROM avesmaps_kanal.vorgang v
              LEFT JOIN avesmaps_auth.person p ON p.id = v.gemeldet_von
             WHERE v.environment = ${environment} AND v.art = 'freigabe'
               AND v.status NOT IN ('abgenommen', 'abgelehnt')
               AND coalesce(v.titel, '') LIKE ${NACHT_TITEL + "%"}
             ORDER BY v.gemeldet_at DESC
             LIMIT 1
        `.catch(() => []);
        return zeile;
    }

    async function frueher(environment: string): Promise<FreigabeLauf[]> {
        const zeilen = await db()<
            {
                ops: string;
                status: string;
                titel: string | null;
                at: Date;
                wer: string | null;
                release: string | null;
            }[]
        >`
            SELECT v.id::text AS ops, v.status, v.titel, v.gemeldet_at AS at,
                   p.display_name AS wer, n.release
              FROM avesmaps_kanal.vorgang v
              LEFT JOIN avesmaps_auth.person p ON p.id = v.gemeldet_von
              LEFT JOIN LATERAL (
                  SELECT release FROM avesmaps_kanal.nachweis
                   WHERE vorgang_id = v.id AND station IN ('production_live', 'production_zurueck')
                   ORDER BY at DESC LIMIT 1
              ) n ON true
             WHERE v.environment = ${environment} AND v.art = 'freigabe' AND v.status = 'abgenommen'
             ORDER BY v.gemeldet_at DESC
             LIMIT 10
        `.catch(() => []);
        return zeilen.map((zeile) => ({
            ops: opsId(Number(zeile.ops)),
            release: zeile.release ?? "?",
            at: zeile.at.toISOString(),
            wer: zeile.wer,
            art: zeile.titel?.startsWith("Zurück") === true ? ("rollback" as const) : ("release" as const),
            themen: 0,
        }));
    }

    app.get(
        FREIGABE_URL,
        { ...lesen, schema: { response: { 200: FreigabeSicht, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const stand = await reader.read();
            const datei = stand.art === "gelesen" ? stand.stand : null;
            const laufend = await laufende(session.environment);
            const laeuft =
                laufend === undefined
                    ? null
                    : {
                          ops: opsId(Number(laufend.ops)),
                          art:
                              laufend.titel?.startsWith("Zurück") === true
                                  ? ("rollback" as const)
                                  : ("release" as const),
                          status: laufend.status,
                          seit: laufend.gemeldet_at.toISOString(),
                      };
            const vorher = await frueher(session.environment);
            const nacht = await offeneNacht(session.environment);
            const opsNacht = nacht === undefined ? null : opsId(Number(nacht.ops));
            // Der Fortschritt (WI-0204): zum laufenden Vorgang und zum jüngsten früheren, damit das Ergebnis nach dem Ende stehen bleibt.
            const juengster = vorher[0];
            const fortschritt = await fortschritteZu(
                db(),
                [
                    ...(laeuft === null ? [] : [laeuft]),
                    ...(typeof juengster?.ops === "string" ? [{ ops: juengster.ops, art: juengster.art }] : []),
                ],
                (message) => app.log.warn(message),
            );
            return {
                now: new Date().toISOString(),
                datei,
                sperre: sperreVon(datei, laufend !== undefined),
                laeuft: laeuft === null ? null : { ...laeuft, fortschritt: fortschritt.get(laeuft.ops) ?? null },
                frueher: vorher.map((lauf, stelle) =>
                    stelle === 0 && lauf.ops !== null
                        ? { ...lauf, fortschritt: fortschritt.get(lauf.ops) ?? null }
                        : lauf,
                ),
                freigabe:
                    nacht === undefined || opsNacht === null
                        ? null
                        : {
                              ops: opsNacht,
                              release: nacht.titel.slice(NACHT_TITEL.length),
                              commit: /Stand ([0-9a-f]{7,40}) /u.exec(nacht.nachricht ?? "")?.[1] ?? null,
                              seit: nacht.seit.toISOString(),
                              wer: nacht.wer,
                              // Der Prüfstand kommt aus Claudios Datei, aber nur, wenn er zu DIESER Freigabe gehört.
                              pruefung: datei?.freigabe?.ops === opsNacht ? datei.freigabe.pruefung : null,
                          },
            };
        },
    );

    /** Beide Wege legen denselben Vorgang an; nur Titel und Nachricht unterscheiden sich. */
    async function beauftrage(
        request: Parameters<typeof adminSession>[0],
        operationId: string,
        art: "release" | "rollback",
        commit: string | null,
    ): Promise<OperationReceipt> {
        const session = await adminSession(request);
        const stand = await reader.read();
        const datei = stand.art === "gelesen" ? stand.stand : null;
        const sperre: FreigabeSperre | null = sperreVon(datei, (await laufende(session.environment)) !== undefined);
        // Liefert Claudios Seite nachts aus, gibt der Knopf nur frei (WI-0234); geprüft und ausgeliefert wird in der Nacht.
        const nachts = art === "release" && nachtsFreigeben(datei);
        // Der Rückweg gilt auch, wenn die Stage gerade nichts zu schieben hat — er betrifft Production, nicht die Stage.
        const blockiert =
            art === "release" ? sperre : sperre === "laeuft" || sperre === "nicht_eingerichtet" ? sperre : null;
        if (blockiert !== null) {
            const status = blockiert === "nicht_eingerichtet" ? "freigabe_unavailable" : "freigabe_blocked";
            throw new ApiError(
                FREIGABE_ERROR_STATUS[status],
                status,
                blockiert === "nicht_eingerichtet"
                    ? "Freigaben gibt es in dieser Umgebung nicht."
                    : blockiert === "laeuft"
                      ? "Es läuft schon eine Freigabe. Erst die, dann die nächste."
                      : blockiert === "gleich"
                        ? "Production und Stage sind gleich. Es gibt nichts zu schieben."
                        : "Die Stage ist nicht grün geprüft. Ungeprüft geht nichts nach Production.",
                // 🔴 Der Grund geht MIT (Betreiber 2026-10-14): Die Oberfläche bildete `freigabe_blocked` sonst auf einen
                // Sammelsatz ab, der drei Möglichkeiten aufzählte und auf einen Stand verwies, der die Antwort nicht
                // enthält. Mit `sperre` zeigt sie den Satz, der zutrifft.
                { sperre: blockiert },
            );
        }
        if (art === "release" && commit !== null && datei !== null && !datei.stage.commit.startsWith(commit)) {
            throw new ApiError(
                FREIGABE_ERROR_STATUS.freigabe_stale,
                "freigabe_stale",
                "Die Stage hat sich seitdem bewegt. Bitte die Liste neu ansehen.",
            );
        }
        // 🔴 Der Titel wandert auf den VPS und wird dort ZEILENWEISE gelesen (`avesmaps3d-corridor-probe freigabe-auftraege`,
        // Felder mit `|`). Ein Zeilenumbruch oder ein `|` darin wäre dort eine zweite, erfundene Auftragszeile. Der Vertrag lässt
        // beides schon nicht zu (`FreigabeStand`); diese Zeile hält auch dann, wenn jemand das Muster später lockert.
        const kennung = (wert: string | undefined): string =>
            (wert ?? "?").replace(/[^\w.-]/gu, "").slice(0, 40) || "?";
        const titel = nachts
            ? `${NACHT_TITEL}${kennung(datei?.stage.release)}`
            : art === "release"
              ? `Nach Production: ${kennung(datei?.stage.release)}`
              : `Zurück auf den vorigen Stand (von ${kennung(datei?.production.release)})`;
        return await adminOperation(
            app.database!,
            session,
            { operationId, body: { action: `production.${art}`, commit } },
            async (tx) => {
                // Der Vorgang ist die Akte; Claudios Abholer sieht ihn wie jeden anderen (zuständig: claudio).
                // 🔴 Über die Funktion, nicht per INSERT: Die App hat auf den Kanal-Tafeln nur SELECT
                //    (`kanal-grants.psql`, KANAL-0001 §4) — geschrieben wird im Kanal ausschließlich über `kanal_*`.
                //    Ein direkter INSERT endete mit `permission denied for table vorgang`, und der Fehlerhandler machte
                //    daraus „Die Anmeldung ist auf dieser Instanz nicht eingerichtet“ (Claudios Befund 2026-10-14).
                // Claudios Probe liest den Commit mit `Stand ([0-9a-f]{7,40}) ` aus genau diesem Satz.
                // 🔴 Der Satz muss wahr sein (WI-0248): Mit grünem Nachweis geht der Stand jetzt nach Production (ohne Nachtfenster, Betreiber
                // 2026-10-24); sonst wird er erst geprüft, und nur bei Grün geht er gleich danach. Beide beginnen mit `Stand <sha> `.
                const nachricht = nachts
                    ? datei?.nachweis === "gruen"
                        ? `Stand ${kennung(datei.stage.commit)} geht jetzt nach Production.`
                        : `Stand ${kennung(datei?.stage.commit)} wird jetzt vollständig geprüft; ist die Prüfung grün, geht er gleich danach nach Production.`
                    : art === "release"
                      ? `Stand ${kennung(datei?.stage.commit)} nach Production.`
                      : "Production zurück auf das vorige Release.";
                const [vorgang] = await tx<{ id: string }[]>`
                    SELECT avesmaps_kanal.kanal_freigabe_anlegen(
                        ${operationId}::uuid, ${session.environment}, ${session.personId}::uuid, ${nachts ? "nacht" : art}, ${titel},
                        ${nachricht}
                    )::text AS id
                `;
                // Der Auftrag der Person in der Warteschlange, mit derselben Beschriftung, die der Abholer setzt.
                const ops = opsId(Number(vorgang?.id ?? 0));
                const [auftrag] = await tx<{ id: string }[]>`
                    SELECT freigabe_auftrag_einreihen(
                        ${ops}, ${session.personId}, ${art === "rollback" ? `Rückweg ${ops}` : `Freigabe ${ops}`}, ${AVENTURIA.mapDomain}
                    )::text AS id
                `;
                return {
                    receipt: {
                        environment: session.environment,
                        affected: [],
                        derivedWork:
                            auftrag === undefined
                                ? []
                                : [{ kind: FREIGABE_JOB_KIND, jobId: auftrag.id, state: "QUEUED" }],
                        warnings: [],
                    },
                    event: {
                        ...actorFields(session, request),
                        action: art === "release" ? "system.production_release" : "system.production_rollback",
                        targetRef: `ops:${vorgang?.id ?? "?"}`,
                        details: { release: datei?.stage.release ?? "?", von: datei?.production.release ?? "?" },
                    },
                };
            },
        );
    }

    app.post(
        `${FREIGABE_URL}/release`,
        { ...freigeben, schema: { body: FreigabeReleaseBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => await beauftrage(request, request.body.operationId, "release", request.body.commit),
    );

    app.post(
        `${FREIGABE_URL}/rollback`,
        { ...freigeben, schema: { body: FreigabeRollbackBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => await beauftrage(request, request.body.operationId, "rollback", null),
    );

    // Eine Nacht-Freigabe abbrechen (WI-0234; Vertrag mit Claudio §2): jeder aktive Betreiber, ohne Passkey, denn Abbrechen ist die
    // sichere Richtung. Darum nicht `release_to_production` (Stufe S, immer mit frischem Passkey), sondern das Recht am Kanal der
    // Betreiber (Stufe V). Die Funktion prüft, dass es die offene Nacht-Freigabe dieser Umgebung ist.
    const abbrechen = protect("use_operator_channel", { writeClass: "system" });
    app.post(
        `${FREIGABE_URL}/abbrechen`,
        {
            ...abbrechen,
            schema: { body: FreigabeAbbrechenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const vorgang = Number(request.body.ops.slice("OPS-".length));
            return await adminOperation(
                app.database!,
                session,
                {
                    operationId: request.body.operationId,
                    body: { action: "production.freigabe_abbrechen", ops: request.body.ops },
                },
                async (tx) => {
                    const [zeile] = await tx<{ titel: string | null }[]>`
                        SELECT titel FROM avesmaps_kanal.vorgang WHERE id = ${vorgang}
                    `;
                    try {
                        await tx`
                            SELECT avesmaps_kanal.kanal_freigabe_abbrechen(
                                ${request.body.operationId}::uuid, ${session.environment}, ${vorgang}, ${session.personId}::uuid
                            )
                        `;
                    } catch (roh) {
                        const error = kanalFehler(roh);
                        if (error instanceof KanalFehler && error.code === "kanal_transition")
                            throw new ApiError(
                                FREIGABE_ERROR_STATUS.freigabe_vorbei,
                                "freigabe_vorbei",
                                "Die Freigabe ist schon erloschen.",
                            );
                        if (error instanceof KanalFehler)
                            throw new ApiError(
                                404,
                                "not_found",
                                "Hier gibt es keine offene Freigabe mit dieser Nummer.",
                            );
                        throw error;
                    }
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.production_freigabe_abgebrochen",
                            targetRef: `ops:${String(vorgang)}`,
                            details: { release: (zeile?.titel ?? "").slice(NACHT_TITEL.length) || "?" },
                        },
                    };
                },
            );
        },
    );
};
