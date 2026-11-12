import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    AVENTURIA,
    OperationReceipt,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    UUID_PATTERN,
    WIKISYNC_ARTIKEL_URL,
    WIKISYNC_BEREICHE,
    WIKISYNC_BEREICHE_URL,
    WIKISYNC_BERICHT_URL,
    WIKISYNC_DUMP_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKISYNC_VORSCHAU_URL,
    WIKISYNC_ZURUECKNEHMEN_URL,
    WIKI_DUMP_HOLEN_ART,
    WikisyncBereiche,
    WikisyncBericht,
    WikisyncBerichtAbfrage,
    WikisyncArtikelBody,
    WikisyncArtikelListe,
    WikisyncDumpHolenBody,
    WikisyncUebernehmenBody,
    WikisyncVorschauBody,
    WikisyncZuruecknehmenBody,
    rechteVon,
    editorWikiSyncEditRestoreSeriesPreviewUrl,
    editorWikiSyncEditRestoreSeriesUrl,
    editorWikiSyncRestoreSeriesPreviewUrl,
    editorWikiSyncRestoreSeriesUrl,
    wikisyncAngeschlossen,
    type WikisyncBereich,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, protect } from "../auth/plugin.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { kehreUnterdrueckungUm, OPERATION_ANBIETEN, OPERATION_UNTERDRUECKEN } from "../editor/landmarken-kandidaten.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { mapOperation, type MapActor } from "../editor/map-operation.ts";
import { WIKISYNC_EDITOR_OPERATIONEN } from "../editor/ruecknahme-arten.ts";
import { grundVon } from "../editor/ruecknahme-ablauf.ts";
import { erzwingeRuecknahme, pruefeWikiSync, vorschauWikiSync } from "../editor/ruecknahme-wikisync.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { ApiError } from "../http/api-error.ts";
import { regelUebernahmeZuruecknehmen } from "./admin-wikisync-regeln.ts";
import {
    OPERATION_WIEDER,
    OPERATION_ZURUECK,
    nimmFlaecheZuweisungZurueck,
    stelleFlaecheZuweisungWiederHer,
} from "../wiki/regeln/flaechen.ts";
import { leseBericht } from "../wiki/abgleich/ablage.ts";
import { ladeBekannteTitel } from "../wiki/abgleich/lokal.ts";
import { bekannterTitelSchluessel } from "../wiki/abgleich/plan.ts";
import { leseVergleiche } from "../wiki/artikel/ablage.ts";
import { artikelTitelOk, normalisiereArtikelTitel } from "../wiki/artikel/titel.ts";
import { dumpHolenErlaubt, wikiAbrufErlaubt } from "../wiki/config.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { leseBereiche } from "../wiki/abgleich/uebernahme/lesen.ts";
import { schreiberFuer } from "../wiki/abgleich/uebernahme/liste.ts";
import { pruefeUebernahme } from "../wiki/abgleich/uebernahme/pruefen.ts";

/**
 * Die Steuerung des WikiSync (WI-0253 C, D-1; Mockup `review/wi-0253/wikisync-mockup.html`):
 *
 *     GET  /api/admin/wikisync/bericht         Bereich, Wirkung, Eigentümer, Status, Befund, Freitext, Seite                       view_wikisync (ab `tester`)
 *     GET  /api/admin/wikisync/bereiche        die Bereiche mit der jüngsten Übernahme je Bereich                                  view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/vorschau        { operationId, bereiche? }                          die Vorschau anstoßen             view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/uebernehmen     { operationId, bereiche | alle, lauf?, ablauf? }    übernehmen, oder (`ablauf`) einen verketteten Lauf    run_wikisync_areas (`editor`) + Passkey; alle: run_wikisync_all (`admin`)
 *     POST /api/admin/wikisync/zuruecknehmen   { operationId, lauf, bereich? }                     eine Übernahme zurücknehmen (ohne `bereich`: den ganzen Lauf)   undo_wikisync_run (`admin`) + Passkey
 *     POST /api/editor/wikisync/:id/restore-series[/preview]   das ↺ in „Änderungen“ (WI-0265 B8d): genau diese Rücknahme für EINE Übernahme, seit B8e auch die einer Rücknahme   undo_wikisync_run + Passkey (Vorschau: use_editor_menu)
 *     POST /api/editor/wikisync-schritt/:id/restore-series[/preview]   das ↺ am Sync eines Objekts (Auftrag) und an der Zuweisung einer Fläche (sofort; WI-0265 B8e)   edit_map_objects (Fläche in Production + Passkey; Vorschau: use_editor_menu)
 *     POST /api/admin/wikisync/artikel         { operationId, titel }                              EINEN Artikel über die API vergleichen   compare_wiki_article (`editor`, ohne Passkey)
 *     GET  /api/admin/wikisync/artikel                                                              die jüngsten Vergleiche mit ihren Zeilen   view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/dump            { operationId }                                     das Holen des Dumps anfordern             fetch_wiki_dump (`operator`); in Production + Passkey
 *
 * - **Der Bericht** ist der jüngste fertige Lauf je Bereich und seine Planzeilen (`wikisync_lauf`, mit gepinntem Dump, Prüfsumme und Tafel-Revision): je Feld der Istwert,
 *   der Wiki-Wert, der Eigentümer und die Wirkung, oder ein Befund zum Artikel. Alles Gelesene ist ein Protokoll der Vorschau, kein Fachwert, und es steht kein Wikitext darin.
 * - **Ortsgröße, Bauwerkart und Kontinent** (WI-0294) rechnet die Vorschau selbst aus der Kategorien-Datei neben dem Dump (`wiki/kategorien/`); es gibt keinen Wiki-Teil und keine Route dafür mehr. 🔴 Lokal (und überall,
 *   wo `wikiAbrufErlaubt` nein sagt) reiht die Route den Vergleich eines einzelnen Artikels nicht ein: 409 `abruf_gesperrt` mit dem Grund.
 * - **Die drei Aufträge reiht die Route ein, sie rechnet nichts** (`wiki_vorschau`, `wiki_uebernehmen`, `wiki_zuruecknehmen`; Warteschlange, `jobs/wiki-*-jobs.ts`), in derselben
 *   Transaktion wie ihr Ereignis im Protokoll der Verwaltung (`system.wikisync_*`). Was die Übernahme dann an der Karte tut, steht als Operation mit der Quelle `wikisync` im
 *   Fachprotokoll (Auslöser: die Person oder, ohne Person, das System) und im Protokoll der Übernahme (`wikisync_uebernahme`); dorthin kommt die Jobs-Rolle, nicht ins
 *   Protokoll der Verwaltung.
 * - **Vor dem Einreihen prüft die Route** (`pruefeUebernahme`): ob für den Bereich eine Übernahme angeschlossen ist (409 `gehoert_legacy`; die Bereiche gehören fest dem WikiSync, einen Schalter gibt es seit dem Cutoff 2026-11-02 nicht mehr), ob die Vorschau seine Kategorien-Datei gelesen hat (409 `kategorien_fehlen`), ob die Übernahme
 *   angeschlossen ist (409 `nicht_angeschlossen`), ob es einen Lauf der Vorschau gibt (409 `kein_lauf`) und ob er eine Grundlage ist (409 `vorschau_veraltet`). Der Auftrag prüft es
 *   unter der Sperre noch einmal. Wartet oder läuft schon ein Auftrag, der die Karte schreibt: 409 `uebernahme_laeuft`.
 * - **Ein verketteter Lauf** (`ablauf: "ganz"`, WI-0253 §20, Variante A des Ablaufs): EIN Start statt dreier Knöpfe. Die Route reiht nur den ersten Auftrag ein (die Vorschau); die Übernahme reiht der Auftrag selbst ein
 *   (`wiki/abgleich/folge.ts`), für die Bereiche mit Kategorien nur, wenn die Vorschau eine Kategorien-Datei gelesen hat. Ein Bereich, der nicht dem WikiSync gehört, ist kein Teil des Laufs (409 `gehoert_legacy`); die Vorschau
 *   rechnet trotzdem alle Bereiche, wie bisher.
 * - **„Dump holen“** (WI-0253 §22) reiht den Auftrag `wiki_dump_holen` ein und holt selbst NICHTS: Die App hat für ihn keinen Handler, Claudios Korridor führt ihn aus
 *   (`ops/production/wiki-einrichten.sh --dump-holen`). Die Route weist ab, wo es keinen Abholer gibt (lokal, ohne echtes Release, ohne Dump-Ordner: 409), und reiht keinen zweiten Auftrag
 *   ein, solange einer wartet oder läuft (409 `dump_holen_laeuft`). Der frische Passkey gilt nur in Production (Vali 2026-10-27, wie bei den Kanon-Tafeln).
 * - **Schreibklassen:** die Vorschau `import` (sie liest nur; keine Sperre hält sie an), Übernehmen und Zurücknehmen `map`
 *   (sie ändern Kartendaten; die Kartensperre hält sie an, wie jeden Editor).
 */

const EVENT_VORSCHAU = "system.wikisync_vorschau_angestossen" as const;
const EVENT_UEBERNAHME = "system.wikisync_uebernahme_angestossen" as const;
const EVENT_ZURUECK = "system.wikisync_zurueckgenommen" as const;
const EVENT_ARTIKEL = "system.wikisync_artikel_angestossen" as const;
const EVENT_DUMP = "system.wikisync_dump_holen_angestossen" as const;

/** Die Arten, die die Karte schreiben: Von ihnen läuft höchstens eine zugleich. */
const SCHREIBENDE_ARTEN = ["wiki_uebernehmen", "wiki_zuruecknehmen"] as const;

/**
 * Reiht einen Auftrag des WikiSync ein. Die Vorschau hat keinen Fußabdruck auf der Karte (`tiles` ohne Kacheln: Sie wartet nicht hinter jedem Zug); die Übernahme und die
 * Rücknahme schreiben Orte, Wege, Gebiete, Landschaften und Kraftlinien (nur Namen, Texte und Wiki-Werte) und berühren kein Gelände, tragen also denselben Bereich: Sie warten nur hinter einem LAUFENDEN Auftrag im Bereich `domain` (Zug, Import).
 */
async function reiheEin(tx: Sql, kind: string, eingabe: Record<string, unknown>, actorRef: string): Promise<string> {
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${kind}, 1::smallint, ${AVENTURIA.mapDomain}, ${actorRef}, ${tx.json(eingabe as never)}, 50::smallint, NULL,
                           'tiles', '{}'::smallint[])
    `;
    return job!.public_id;
}

/** Wartet oder läuft schon ein Auftrag dieser Arten? Dann 409, nichts eingereiht. */
async function weigereBeiLaufendem(tx: Sql, arten: readonly string[], code: string, satz: string): Promise<void> {
    const [laeuft] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM job WHERE state IN ('QUEUED', 'RUNNING') AND kind = ANY (${[...arten]}::text[]) LIMIT 1
    `;
    if (laeuft !== undefined) throw new ApiError(409, code, satz, { job: laeuft.public_id });
}

/** Die Arten, die ein verketteter Lauf nicht neben sich duldet, mit dem Wort, das die Oberfläche kennt. */
const LAUF_ARTEN: readonly { art: string; code: string; satz: string }[] = [
    { art: "wiki_vorschau", code: "vorschau_laeuft", satz: "Die Vorschau wird schon berechnet oder wartet darauf." },
    {
        art: "wiki_uebernehmen",
        code: "uebernahme_laeuft",
        satz: "Eine Übernahme oder Rücknahme wartet schon oder läuft.",
    },
    {
        art: "wiki_zuruecknehmen",
        code: "uebernahme_laeuft",
        satz: "Eine Übernahme oder Rücknahme wartet schon oder läuft.",
    },
];

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

/** Was die Rücknahme zurücknimmt: der ganze Lauf (alle Bereiche, deren jüngste Übernahme noch steht) oder genau EINE Übernahme. */
export type ZuruecknehmenZiel =
    | { art: "ganz"; lauf: number; bereiche: WikisyncBereich[] }
    | { art: "eine"; lauf: number; bereich: WikisyncBereich; uebernahme: number }
    /** Der Sync EINES Objekts (Wiki-Box), WI-0265 B8e: `operationId` ist die Operation des Syncs. */
    | { art: "objekt"; bereich: WikisyncBereich; operationId: string };

/**
 * Reiht die Rücknahme einer Übernahme (oder des ganzen Laufs) ein, in der Transaktion der Operation der Verwaltung: EINE Funktion für `POST /api/admin/wikisync/zuruecknehmen` und das ↺ in „Änderungen“
 * (WI-0265 B8d, `editor/ruecknahme-wikisync.ts`), damit es keinen zweiten Weg gibt. `grund` (nur aus „Änderungen“, bei einer fremden Person Pflicht) geht in den Auftrag und steht danach als `restoreReason` an den
 * Einträgen der Rücknahme.
 */
async function zuruecknehmenEinreihen(
    tx: Sql,
    session: Awaited<ReturnType<typeof adminSession>>,
    request: FastifyRequest,
    ziel: ZuruecknehmenZiel,
    grund?: string,
): Promise<Awaited<ReturnType<Parameters<typeof adminOperation>[3]>>> {
    await weigereBeiLaufendem(
        tx,
        SCHREIBENDE_ARTEN,
        "uebernahme_laeuft",
        "Eine Übernahme oder Rücknahme wartet schon oder läuft.",
    );
    const mitGrund = grund === undefined ? {} : { grund };
    const job = await reiheEin(
        tx,
        "wiki_zuruecknehmen",
        ziel.art === "ganz"
            ? { lauf: ziel.lauf, bereiche: ziel.bereiche, ...mitGrund }
            : ziel.art === "objekt"
              ? { bereich: ziel.bereich, objekt: ziel.operationId, ...mitGrund }
              : { bereich: ziel.bereich, lauf: ziel.lauf, uebernahme: ziel.uebernahme, ...mitGrund },
        session.personId,
    );
    return {
        receipt: {
            environment: session.environment,
            affected: [],
            derivedWork: [{ kind: "wiki_zuruecknehmen", jobId: job, state: "queued" }],
            warnings: [],
        },
        event: {
            ...actorFields(session, request),
            action: EVENT_ZURUECK,
            targetRef: `job:${job}`,
            details:
                ziel.art === "ganz"
                    ? { bereiche: ziel.bereiche, lauf: ziel.lauf, job }
                    : ziel.art === "objekt"
                      ? { bereich: ziel.bereich, objekt: ziel.operationId, job }
                      : { bereich: ziel.bereich, lauf: ziel.lauf, job },
        },
    };
}

export const adminWikisyncRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        WIKISYNC_BERICHT_URL,
        {
            ...protect("view_wikisync"),
            schema: { querystring: WikisyncBerichtAbfrage, response: { 200: WikisyncBericht, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return leseBericht(app.database!, request.query, new Date());
        },
    );

    app.get(
        WIKISYNC_BEREICHE_URL,
        { ...protect("view_wikisync"), schema: { response: { 200: WikisyncBereiche, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            return leseBereiche(app.database!, new Date());
        },
    );

    app.post(
        WIKISYNC_VORSCHAU_URL,
        {
            ...protect("view_wikisync", { writeClass: "import" }),
            schema: { body: WikisyncVorschauBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, bereiche } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wikisync.vorschau", bereiche: bereiche ?? null } },
                async (tx) => {
                    await weigereBeiLaufendem(
                        tx,
                        ["wiki_vorschau"],
                        "vorschau_laeuft",
                        "Die Vorschau wird schon berechnet oder wartet darauf.",
                    );
                    const job = await reiheEin(
                        tx,
                        "wiki_vorschau",
                        bereiche === undefined ? {} : { bereiche },
                        session.personId,
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "wiki_vorschau", jobId: job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT_VORSCHAU,
                            targetRef: `job:${job}`,
                            details: { bereiche: bereiche ?? null, job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        WIKISYNC_UEBERNEHMEN_URL,
        {
            ...protect("run_wikisync_areas", { confirm: "passkey", writeClass: "map" }),
            schema: { body: WikisyncUebernehmenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, bereiche: genannt, alle, lauf, ablauf } = request.body;
            if ((genannt === undefined) === (alle !== true)) {
                throw new ApiError(
                    400,
                    "validation_failed",
                    'Entweder "bereiche" oder "alle" nennen, nicht beides und nicht keins.',
                );
            }
            // Über alle Bereiche löst nur ein Admin aus; die Route selbst verlangt von einem Editor das Recht für einzelne.
            if (alle === true) demand(session, "run_wikisync_all", app.authConfig, "passkey");
            const database = app.database!;
            if (ablauf !== undefined) {
                if (lauf !== undefined) {
                    throw new ApiError(
                        400,
                        "validation_failed",
                        'Bei "ablauf" gibt es keinen "lauf": Die Vorschau entsteht im Lauf.',
                    );
                }
                // Die Bereiche des Laufs: genannte (dann muss jeder dem WikiSync gehören) oder alle, die ihm gehören und deren Übernahme angeschlossen ist.
                const gehoeren = await wikisyncBereiche(database);
                for (const bereich of genannt ?? []) {
                    if (!gehoeren.has(bereich)) {
                        throw new ApiError(409, "gehoert_legacy", "Für diesen Bereich gibt es noch keine Übernahme.", {
                            bereich,
                        });
                    }
                    if (!wikisyncAngeschlossen(bereich)) {
                        throw new ApiError(
                            409,
                            "nicht_angeschlossen",
                            "Für diesen Bereich gibt es noch keine Übernahme.",
                            { bereich },
                        );
                    }
                }
                const ziele = [...(genannt ?? [...gehoeren])]
                    .filter((bereich) => wikisyncAngeschlossen(bereich))
                    .sort((a, b) => WIKISYNC_BEREICHE.indexOf(a) - WIKISYNC_BEREICHE.indexOf(b));
                if (ziele.length === 0) {
                    throw new ApiError(
                        409,
                        "keine_bereiche",
                        "Es gibt keinen Bereich, der dem WikiSync gehört und übernommen werden kann.",
                    );
                }
                return adminOperation(
                    database,
                    session,
                    { operationId, body: { action: "wikisync.uebernehmen", bereiche: ziele, lauf: null, ablauf } },
                    async (tx) => {
                        for (const regel of LAUF_ARTEN) {
                            await weigereBeiLaufendem(tx, [regel.art], regel.code, regel.satz);
                        }
                        const job = await reiheEin(
                            tx,
                            "wiki_vorschau",
                            { folge: { bereiche: ziele }, ausgeloestVon: session.displayName },
                            session.personId,
                        );
                        return {
                            receipt: {
                                environment: session.environment,
                                affected: [],
                                derivedWork: [{ kind: "wiki_vorschau", jobId: job, state: "queued" }],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: EVENT_UEBERNAHME,
                                targetRef: `job:${job}`,
                                details: { bereiche: ziele, lauf: null, job },
                            },
                        };
                    },
                );
            }
            const kandidaten: WikisyncBereich[] =
                genannt ?? [...(await wikisyncBereiche(database))].filter((bereich) => wikisyncAngeschlossen(bereich));
            const bereiche: WikisyncBereich[] = [];
            const warnungen: { code: string; message: string }[] = [];
            for (const bereich of kandidaten) {
                const pruefung = await pruefeUebernahme(database, bereich, lauf);
                if (pruefung.ok) {
                    bereiche.push(bereich);
                } else if (alle === true) {
                    // „Alle“ übernimmt, was übernommen werden darf, und sagt, was nicht.
                    warnungen.push({ code: pruefung.grund, message: `${bereich}: ${pruefung.text}` });
                } else {
                    throw new ApiError(409, pruefung.grund, pruefung.text, { bereich });
                }
            }
            if (bereiche.length === 0) {
                throw new ApiError(
                    409,
                    warnungen[0]?.code ?? "keine_bereiche",
                    warnungen[0]?.message ??
                        "Es gibt keinen Bereich, der dem WikiSync gehört und übernommen werden kann.",
                );
            }
            return adminOperation(
                database,
                session,
                { operationId, body: { action: "wikisync.uebernehmen", bereiche, lauf: lauf ?? null } },
                async (tx) => {
                    await weigereBeiLaufendem(
                        tx,
                        SCHREIBENDE_ARTEN,
                        "uebernahme_laeuft",
                        "Eine Übernahme oder Rücknahme wartet schon oder läuft.",
                    );
                    const job = await reiheEin(
                        tx,
                        "wiki_uebernehmen",
                        lauf === undefined ? { bereiche } : { bereiche, lauf },
                        session.personId,
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "wiki_uebernehmen", jobId: job, state: "queued" }],
                            warnings: warnungen,
                        },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT_UEBERNAHME,
                            targetRef: `job:${job}`,
                            details: { bereiche, lauf: lauf ?? null, job },
                        },
                    };
                },
            );
        },
    );

    app.post(
        WIKISYNC_ZURUECKNEHMEN_URL,
        {
            ...protect("undo_wikisync_run", { confirm: "passkey", writeClass: "map" }),
            schema: { body: WikisyncZuruecknehmenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, lauf, bereich } = request.body;
            const database = app.database!;
            // Die Übernahmen dieses Laufs, die etwas geschrieben haben und noch stehen (je Bereich die jüngste): eine bestimmte oder, ohne `bereich`, alle.
            if (bereich !== undefined && schreiberFuer(bereich) === undefined) {
                throw new ApiError(409, "nicht_angeschlossen", "Für diesen Bereich gibt es noch keine Übernahme.", {
                    bereich,
                });
            }
            const stehende = await database<{ id: number; bereich: WikisyncBereich }[]>`
                SELECT DISTINCT ON (bereich) id::int AS id, bereich
                  FROM wikisync_uebernahme
                 WHERE lauf_id = ${lauf} AND art = 'uebernahme' AND status = 'fertig' AND operation_id IS NOT NULL AND zurueckgenommen_am IS NULL
                   AND (${bereich ?? null}::text IS NULL OR bereich = ${bereich ?? null})
                 ORDER BY bereich, id DESC
            `;
            const ziele = stehende.filter((zeile) => schreiberFuer(zeile.bereich) !== undefined);
            if (ziele.length === 0) {
                throw new ApiError(
                    404,
                    "nichts_zurueckzunehmen",
                    bereich === undefined
                        ? "Zu diesem Lauf gibt es keine Übernahme, die etwas geschrieben hat und noch steht."
                        : "Zu diesem Lauf und Bereich gibt es keine Übernahme, die etwas geschrieben hat und noch steht.",
                    bereich === undefined ? { lauf } : { lauf, bereich },
                );
            }
            const bereiche = ziele.map((zeile) => zeile.bereich);
            return adminOperation(
                database,
                session,
                {
                    operationId,
                    body:
                        bereich === undefined
                            ? { action: "wikisync.zuruecknehmen", lauf, bereiche }
                            : { action: "wikisync.zuruecknehmen", lauf, bereich, uebernahme: ziele[0]!.id },
                },
                (tx) =>
                    zuruecknehmenEinreihen(
                        tx,
                        session,
                        request,
                        bereich === undefined
                            ? { art: "ganz", lauf, bereiche }
                            : { art: "eine", lauf, bereich, uebernahme: ziele[0]!.id },
                    ),
            );
        },
    );

    // Das ↺ in „Änderungen“ (WI-0265 B8d; Fachvertrag C.2): die Vorprüfung liest nur (wie jede Vorschau unter der Kartensperre) und sagt, ob und was; die Rücknahme ruft GENAU die Rücknahme des WikiSync auf
    // (`zuruecknehmenEinreihen`, `regelUebernahmeZuruecknehmen`), keine zweite. Recht `undo_wikisync_run` und frischer Passkey wie `POST …/zuruecknehmen`; Einzelheiten und was anders ist: `editor/ruecknahme-wikisync.ts`.
    app.post(
        editorWikiSyncRestoreSeriesPreviewUrl(":id"),
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                params: ById,
                body: RuecknahmeVorschauBody,
                response: { 200: RuecknahmePruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return vorschauWikiSync(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorWikiSyncRestoreSeriesUrl(":id"),
        {
            ...protect("undo_wikisync_run", { confirm: "passkey", writeClass: "map" }),
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request): Promise<RuecknahmeReceipt> => {
            const session = await adminSession(request);
            const database = app.database!;
            const { operationId, members, membersHash } = request.body;
            const id = request.params.id.toLowerCase();
            const leser = leserVon(session, app.authConfig.kanal);
            const grund = grundVon(request.body.reason);
            const pruefe = async (db: Database | Sql) => {
                const { vor, ziel } = await pruefeWikiSync(db, id, members, membersHash, leser);
                await erzwingeRuecknahme(db, vor, grund);
                return ziel!;
            };
            // Welche Rücknahme: Die Antwort nennt die Übernahme; ist sie keine, die der WikiSync zurücknimmt, sagt die Prüfung es (400, 403, 409) und es wird nichts eingereiht.
            const vorab = await pruefeWikiSync(database, id, members, membersHash, leser);
            if (vorab.ziel === undefined) {
                await erzwingeRuecknahme(database, vorab.vor, grund);
                throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                    reason: "art",
                });
            }
            if (vorab.ziel.art === "regeln") {
                // Die Übernahme von Regelvorschlägen: in der Anfrage, mit Wiederholung über die Kennung (`replayed`). Wie `POST …/regeln/zuruecknehmen` nur bei eingeschaltetem Bearbeiten der Karte; die Rücknahme eines
                // Laufs (unten) braucht den Schalter nicht, wie `POST …/zuruecknehmen`.
                await requireMapEditing(request);
                const quittung = await regelUebernahmeZuruecknehmen(database, session, {
                    operationId,
                    uebernahme: vorab.ziel.uebernahme,
                    richtung: vorab.ziel.richtung,
                    ...(grund === undefined ? {} : { grund }),
                    vorher: async (tx) => {
                        await pruefe(tx);
                    },
                });
                return { ...quittung, reverts: [id] };
            }
            // Die Übernahme eines Laufs: als Auftrag (derselbe wie `POST …/zuruecknehmen`); der Auftrag nimmt GENAU diese Übernahme zurück, nie eine andere desselben Laufs.
            const ziel = vorab.ziel;
            if (ziel.art !== "lauf") throw new ApiError(500, "unexpected", "Unerwartete Art der Übernahme.");
            const quittung = await adminOperation(
                database,
                session,
                {
                    operationId,
                    body: {
                        action: "wikisync.zuruecknehmen",
                        lauf: ziel.lauf,
                        bereich: ziel.bereich,
                        uebernahme: ziel.uebernahme,
                        ...(grund === undefined ? {} : { grund }),
                    },
                },
                async (tx) => {
                    await pruefe(tx);
                    const eingereiht = await zuruecknehmenEinreihen(
                        tx,
                        session,
                        request,
                        { art: "eine", lauf: ziel.lauf, bereich: ziel.bereich, uebernahme: ziel.uebernahme },
                        grund,
                    );
                    return {
                        ...eingereiht,
                        receipt: {
                            ...eingereiht.receipt,
                            // Die Rücknahme läuft als Auftrag: Die Liste zeigt sie, sobald er fertig ist (`entwurf.befund.wikisync_auftrag`).
                            warnings: [
                                ...eingereiht.receipt.warnings,
                                {
                                    code: "wikisync_auftrag",
                                    message:
                                        "Die Rücknahme läuft als Auftrag; die Liste zeigt sie, sobald er fertig ist.",
                                },
                            ],
                        },
                    };
                },
            );
            return { ...quittung, reverts: [] };
        },
    );

    // Das ↺ an den Schritten des WikiSync, die der Editor am Objekt auslöst (WI-0265 B8e): der Sync eines Objekts (Wiki-Box) und die Zuweisung eines Artikels an eine Fläche (Regelfenster). Recht `edit_map_objects`
    // wie sie selbst, Klasse `map` und der Schalter `MAP_EDITING` wie jeder Schreibweg der Editoren; die Zuweisung einer Fläche verlangt in Production den frischen Passkey (Vali 2026-10-27, wie vorwärts).
    app.post(
        editorWikiSyncEditRestoreSeriesPreviewUrl(":id"),
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                params: ById,
                body: RuecknahmeVorschauBody,
                response: { 200: RuecknahmePruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return vorschauWikiSync(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
                WIKISYNC_EDITOR_OPERATIONEN,
            );
        },
    );
    app.post(
        editorWikiSyncEditRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request): Promise<RuecknahmeReceipt> => {
            const session = await adminSession(request);
            const database = app.database!;
            const { operationId, members, membersHash } = request.body;
            const id = request.params.id.toLowerCase();
            const leser = leserVon(session, app.authConfig.kanal);
            const grund = grundVon(request.body.reason);
            const pruefe = async (db: Database | Sql) => {
                const { vor, ziel } = await pruefeWikiSync(
                    db,
                    id,
                    members,
                    membersHash,
                    leser,
                    WIKISYNC_EDITOR_OPERATIONEN,
                );
                await erzwingeRuecknahme(db, vor, grund);
                return ziel!;
            };
            const vorab = await pruefeWikiSync(database, id, members, membersHash, leser, WIKISYNC_EDITOR_OPERATIONEN);
            if (vorab.ziel === undefined) {
                await erzwingeRuecknahme(database, vorab.vor, grund);
                throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                    reason: "art",
                });
            }
            const ziel = vorab.ziel;
            if (ziel.art === "flaeche") {
                // Die Zuweisung eines Artikels an eine Fläche: sofort, in der Anfrage, mit der Rücknahme des Regelfensters (`nimmFlaecheZuweisungZurueck`), nur für genau diese Zuweisung.
                if (app.authConfig.environment === "production")
                    demand(session, "edit_map_objects", app.authConfig, "passkey");
                const [region] = await database<
                    { map_domain_id: string }[]
                >`SELECT map_domain_id FROM region WHERE public_id = ${ziel.flaeche}::uuid AND is_active`;
                if (region === undefined) throw new ApiError(404, "flaeche_weg", "Diese Fläche gibt es nicht (mehr).");
                const actor: MapActor = {
                    kind: "person",
                    personId: session.personId,
                    environment: session.environment,
                };
                const quittung = await mapOperation(
                    database,
                    actor,
                    {
                        operationId,
                        operation: ziel.richtung === "wieder" ? OPERATION_WIEDER : OPERATION_ZURUECK,
                        mapDomainId: region.map_domain_id,
                        body: { flaeche: ziel.flaeche, zuweisung: id, ...(grund === undefined ? {} : { grund }) },
                        source: "wikisync",
                    },
                    async (tx) => {
                        await pruefe(tx);
                        // Eine Zuweisung geht zurück (Rücknahme des Regelfensters); eine Rücknahme geht zurück, indem dieselbe Zuweisung wiederkommt (B8e2).
                        const arbeit =
                            ziel.richtung === "wieder"
                                ? await stelleFlaecheZuweisungWiederHer(tx, {
                                      kennung: ziel.flaeche,
                                      operationId: ziel.operationId,
                                  })
                                : await nimmFlaecheZuweisungZurueck(tx, {
                                      kennung: ziel.flaeche,
                                      operationId: ziel.operationId,
                                  });
                        return grund === undefined
                            ? arbeit
                            : {
                                  ...arbeit,
                                  entries: arbeit.entries.map((eintrag) => ({
                                      ...eintrag,
                                      changes: { ...eintrag.changes, restoreReason: { after: grund } },
                                  })),
                              };
                    },
                );
                return { ...quittung, reverts: [id] };
            }
            if (ziel.art === "landmarke") {
                // „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7): sofort, in der Anfrage; die Rücknahme ist die andere der beiden Operationen mit dem umgekehrten Wert.
                const actor: MapActor = {
                    kind: "person",
                    personId: session.personId,
                    environment: session.environment,
                };
                const quittung = await mapOperation(
                    database,
                    actor,
                    {
                        operationId,
                        operation: ziel.unterdrueckt ? OPERATION_ANBIETEN : OPERATION_UNTERDRUECKEN,
                        mapDomainId: AVENTURIA.mapDomain,
                        body: { kandidat: ziel.kandidat, ruecknahme: id, ...(grund === undefined ? {} : { grund }) },
                        source: "wikisync",
                    },
                    async (tx) => {
                        await pruefe(tx);
                        const arbeit = await kehreUnterdrueckungUm(tx, ziel.kandidat, ziel.unterdrueckt);
                        return grund === undefined
                            ? arbeit
                            : {
                                  ...arbeit,
                                  entries: arbeit.entries.map((eintrag) => ({
                                      ...eintrag,
                                      changes: { ...eintrag.changes, restoreReason: { after: grund } },
                                  })),
                              };
                    },
                );
                return { ...quittung, reverts: [id] };
            }
            // Der Sync eines Objekts: als Auftrag (derselbe `wiki_zuruecknehmen`), denn er schreibt auch den Wiki-Stand, und der gehört der Jobs-Rolle.
            if (ziel.art !== "objekt") throw new ApiError(500, "unexpected", "Unerwartete Art der Operation.");
            const quittung = await adminOperation(
                database,
                session,
                {
                    operationId,
                    body: {
                        action: "wikisync.objekt_zuruecknehmen",
                        bereich: ziel.bereich,
                        operation: ziel.operationId,
                        ...(grund === undefined ? {} : { grund }),
                    },
                },
                async (tx) => {
                    await pruefe(tx);
                    const eingereiht = await zuruecknehmenEinreihen(
                        tx,
                        session,
                        request,
                        { art: "objekt", bereich: ziel.bereich, operationId: ziel.operationId },
                        grund,
                    );
                    return {
                        ...eingereiht,
                        receipt: {
                            ...eingereiht.receipt,
                            warnings: [
                                ...eingereiht.receipt.warnings,
                                {
                                    code: "wikisync_auftrag",
                                    message:
                                        "Die Rücknahme läuft als Auftrag; die Liste zeigt sie, sobald er fertig ist.",
                                },
                            ],
                        },
                    };
                },
            );
            return { ...quittung, reverts: [] };
        },
    );

    // Die jüngsten Vergleiche einzelner Artikel mit ihren Zeilen (der Dump-Bericht zeigt sie).
    app.get(
        WIKISYNC_ARTIKEL_URL,
        { ...protect("view_wikisync"), schema: { response: { 200: WikisyncArtikelListe, ...ADMIN_ERRORS } } },
        async (request) => {
            await adminSession(request);
            // Darf diese Umgebung einen Artikel abrufen? Die Oberfläche sagt es vor dem Klick (lokal nie).
            const urteil = wikiAbrufErlaubt(process.env);
            return {
                jetzt: new Date().toISOString(),
                abruf: urteil.erlaubt
                    ? { erlaubt: true, grund: null, text: null }
                    : { erlaubt: false, grund: urteil.grund, text: urteil.text },
                vergleiche: await leseVergleiche(app.database!),
            };
        },
    );

    // EINEN Artikel über die MediaWiki-API mit der Karte vergleichen (D-2): ein leichter Auftrag, eine Anfrage ohne Anmeldung im Takt; der Klick wartet nicht auf die Antwort.
    app.post(
        WIKISYNC_ARTIKEL_URL,
        {
            ...protect("compare_wiki_article", { writeClass: "import" }),
            schema: { body: WikisyncArtikelBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, titel: roh } = request.body;
            const titel = normalisiereArtikelTitel(roh);
            if (!artikelTitelOk(titel)) {
                throw new ApiError(400, "validation_failed", "Das ist kein Titel eines Wiki-Artikels.", {
                    field: "titel",
                });
            }
            const urteil = wikiAbrufErlaubt(process.env);
            if (!urteil.erlaubt) throw new ApiError(409, "abruf_gesperrt", urteil.text, { grund: urteil.grund });
            const database = app.database!;
            // Hängt ein Objekt der Karte an diesem Artikel? Sonst gibt es nichts zu vergleichen (und keine Wiki-Anfrage dafür).
            if (!(await ladeBekannteTitel(database)).has(bekannterTitelSchluessel(titel))) {
                throw new ApiError(
                    409,
                    "kein_objekt",
                    "An diesem Artikel hängt kein Objekt der Karte; es gibt nichts zu vergleichen.",
                    { titel },
                );
            }
            return adminOperation(
                database,
                session,
                { operationId, body: { action: "wikisync.artikel", titel } },
                async (tx) => {
                    await weigereBeiLaufendem(
                        tx,
                        ["wiki_artikel"],
                        "artikel_laeuft",
                        "Ein Vergleich wartet schon oder läuft; er braucht seinen Takt.",
                    );
                    const job = await reiheEin(
                        tx,
                        "wiki_artikel",
                        { titel, ausgeloestVon: session.displayName },
                        session.personId,
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "wiki_artikel", jobId: job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT_ARTIKEL,
                            targetRef: `job:${job}`,
                            details: { job },
                        },
                    };
                },
            );
        },
    );

    // „Dump holen“ (WI-0253 §22): den Auftrag für Claudios Korridor einreihen. Die App holt nichts; der Klick wartet nicht auf das Ergebnis, die Oberfläche liest den Stand.
    app.post(
        WIKISYNC_DUMP_URL,
        {
            // Der frische Passkey nur in Production (Vali 2026-10-27): Auf der Stage und lokal genügt das Recht (`fetch_wiki_dump`, Betreiber, Stufe V).
            // Die Schreibklasse `import`: Das Holen liest das Wiki und legt eine Datei in den Dump-Ordner, es ändert keine Kartendaten (keine Sperre hält es an).
            ...protect("fetch_wiki_dump", {
                ...(app.authConfig.environment === "production" ? { confirm: "passkey" as const } : {}),
                writeClass: "import",
            }),
            schema: { body: WikisyncDumpHolenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId } = request.body;
            const urteil = dumpHolenErlaubt(process.env);
            if (!urteil.erlaubt) {
                throw new ApiError(
                    409,
                    urteil.grund === "ordner" ? "dump_ordner_fehlt" : "abruf_gesperrt",
                    urteil.text,
                    {
                        grund: urteil.grund,
                    },
                );
            }
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wikisync.dump" } },
                async (tx) => {
                    // Zwei Klicks zugleich (zwei Sitzungen, zwei Operationen) dürfen nicht beide durch die Prüfung: Eine Sperre je Datenbank hält sie hintereinander.
                    await tx`SELECT pg_advisory_xact_lock(hashtext('wikisync:dump_holen'))`;
                    await weigereBeiLaufendem(
                        tx,
                        [WIKI_DUMP_HOLEN_ART],
                        "dump_holen_laeuft",
                        "Das Holen des Dumps wartet schon oder läuft; warte, bis es fertig ist.",
                    );
                    const job = await reiheEin(
                        tx,
                        WIKI_DUMP_HOLEN_ART,
                        { ausgeloestVon: session.displayName },
                        session.personId,
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: WIKI_DUMP_HOLEN_ART, jobId: job, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT_DUMP,
                            targetRef: `job:${job}`,
                            details: { job },
                        },
                    };
                },
            );
        },
    );
};
