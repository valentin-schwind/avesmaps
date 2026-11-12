import type { Capability } from "@avesmaps3d/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    AVENTURIA,
    EDITOR_WIKI_BOX_URL,
    OperationReceipt,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    UUID_PATTERN,
    WIKI_BOX_ARTEN,
    WikiBoxOperationBody,
    WikiBoxStand,
    WikiBoxSuchAbfrage,
    WikiBoxZuweisenBody,
    WikiTrefferListe,
    rechteVon,
    editorWikiBoxRestoreSeriesPreviewUrl,
    editorWikiBoxRestoreSeriesUrl,
    type WikiBoxArt,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demandEines, protect, protectEines } from "../auth/plugin.ts";
import type { Sql } from "../auth/session-store.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { mapOperation, type MapActor } from "../editor/map-operation.ts";
import { ruecknehmenWikiBox, vorschauWikiBox } from "../editor/ruecknahme-wikibox.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { ApiError } from "../http/api-error.ts";
import { OBJEKT_IDS_MAX } from "../jobs/wiki-objekt-sync.ts";
import { zuordnungsEintraege, zuordnungsZusatz, type Anschluss, type BoxObjekt } from "../wiki/objekt/anschluss.ts";
import { ANSCHLUESSE, leseBoxStand, syncGrund, syncLaeuft, syncTitel } from "../wiki/objekt/box.ts";
import { leseObjektStand } from "../wiki/objekt/stand.ts";

/**
 * Die Routen der Wiki-Box im Objekteditor (WI-0253; Vertrag und Entwurf in `packages/shared/src/wiki-box.ts`):
 *
 *     GET  /api/editor/wiki-box/:art/:id           der Stand der Box                                  use_editor_menu
 *     GET  /api/editor/wiki-box/:art/:id/suche     die Artikel zum Zuweisen                           use_editor_menu
 *     POST /api/editor/wiki-box/:art/:id/zuweisen  den Artikel zuordnen (sofort)                      edit_map_objects
 *     POST /api/editor/wiki-box/:art/:id/entfernen die Zuordnung lösen (sofort)                       edit_map_objects
 *     POST /api/editor/wiki-box/:art/:id/sync      den Artikel neu holen und anwenden (Auftrag)       edit_map_objects
 *     POST /api/editor/wiki-box/:art/:id/restore-series[/preview]   Zuweisen oder Entfernen zurücknehmen (WI-0265 B8d)   edit_map_objects (Vorschau: use_editor_menu)
 *
 * - 🔴 Wie die übrigen Schreibwege der Editoren: Schreibklasse `map` (423 `map_locked`) und der Schalter `MAP_EDITING` (423 `map_editing_off`), beide vor dem Handler.
 * - **Zuweisen und Entfernen sind je EINE Operation an der Karte** (Quelle `editor`, im Verlauf des Objekts), höchstens einmal je `operationId`; sie zählen die Revision des Objekts, damit ein offener Entwurf
 *   danach 409 bekommt, statt den neuen Stand zu überschreiben. Nach dem Zuweisen folgt der Sync, den die Oberfläche selbst anstößt.
 * - **Die Rücknahme** (WI-0265 B8d, `editor/ruecknahme-wikibox.ts`): ein Schritt der Box steht als Einzeleintrag (nie in einer Serie) und geht von hinten einzeln zurück; Zuweisen und Entfernen halten dazu die Herkunft der
 *   Zuordnung vor und nach dem Schreiben fest (`zuordnung`, wo die Art sie führt), damit die Rücknahme sie zurückgibt. Recht, Klasse und Naht wie vorwärts.
 * - **Der Sync reiht einen Auftrag ein** (`wiki_artikel` mit dem Objekt): Keine Route fragt das Wiki. Er sagt vorher, was nicht geht: 409 `kein_artikel`, `kein_stand`, `abruf_gesperrt` (lokal nie), `gehoert_legacy`,
 *   `pausiert` (das Wiki hat gedrosselt, mit dem Ende der Pause in `details.freiAb`) und `sync_laeuft`.
 */

const Params = Type.Object(
    {
        art: Type.Union(WIKI_BOX_ARTEN.map((art) => Type.Literal(art))),
        id: Type.String({ pattern: UUID_PATTERN }),
    },
    { additionalProperties: false },
);

const EVENT_SYNC = "system.wikisync_artikel_angestossen" as const;

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

/** Die Wiki-Box schreibt am Objekt (WI-0279): an Gebieten und Flächen reicht das Fachrecht, an Berggipfeln das Gebirge, sonst die Sammelrechte. */
const WIKI_BOX_RECHTE: Readonly<Record<WikiBoxArt, readonly [Capability, ...Capability[]]>> = {
    ort: ["edit_map_objects"],
    weg: ["edit_map_objects"],
    kraftlinie: ["edit_map_objects"],
    gebiet: ["edit_territories"],
    region: ["edit_landscapes"],
    gipfel: ["edit_map_objects", "edit_landscapes", "edit_mountains"],
};

function anschlussFuer(art: WikiBoxArt): Anschluss {
    const anschluss = ANSCHLUESSE[art];
    if (anschluss === undefined) {
        throw new ApiError(404, "not_found", "Für diese Art gibt es die Wiki-Box noch nicht.");
    }
    return anschluss;
}

async function ladeObjekt(db: Parameters<Anschluss["lies"]>[0], anschluss: Anschluss, id: string): Promise<BoxObjekt> {
    const objekt = await anschluss.lies(db, id);
    if (objekt === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
    return objekt;
}

/** Reiht den Auftrag ein (`job_enqueue`, SECURITY DEFINER: dieselbe Tür wie bei jedem Auftrag). */
async function reiheEin(tx: Sql, eingabe: Record<string, unknown>, actorRef: string): Promise<string> {
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue('wiki_artikel', 1::smallint, ${AVENTURIA.mapDomain}, ${actorRef}, ${tx.json(eingabe as never)}, 50::smallint, NULL, 'tiles', '{}'::smallint[])
    `;
    return job!.public_id;
}

export const editorWikiBoxRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const verlangeArt = async (request: FastifyRequest): Promise<void> => {
        const { art } = request.params as { art: WikiBoxArt };
        demandEines(await adminSession(request), WIKI_BOX_RECHTE[art], app.authConfig);
    };
    app.get(
        `${EDITOR_WIKI_BOX_URL}/:art/:id`,
        { ...protect("use_editor_menu"), schema: { params: Params, response: { 200: WikiBoxStand, ...ADMIN_ERRORS } } },
        async (request, reply) => {
            const anschluss = anschlussFuer(request.params.art);
            const objekt = await ladeObjekt(app.database!, anschluss, request.params.id);
            void reply.header("cache-control", "private, no-cache");
            return leseBoxStand(app.database!, objekt, process.env);
        },
    );

    app.get(
        `${EDITOR_WIKI_BOX_URL}/:art/:id/suche`,
        {
            ...protect("use_editor_menu"),
            schema: {
                params: Params,
                querystring: WikiBoxSuchAbfrage,
                response: { 200: WikiTrefferListe, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const anschluss = anschlussFuer(request.params.art);
            const objekt = await ladeObjekt(app.database!, anschluss, request.params.id);
            void reply.header("cache-control", "private, no-cache");
            return { articles: await anschluss.suche(app.database!, objekt, request.query.q ?? "") };
        },
    );

    app.post(
        `${EDITOR_WIKI_BOX_URL}/:art/:id/zuweisen`,
        {
            ...protectEines(["edit_map_objects", "edit_territories", "edit_landscapes", "edit_mountains"], {
                writeClass: "map",
            }),
            preHandler: [requireMapEditing, verlangeArt as typeof requireMapEditing],
            schema: { params: Params, body: WikiBoxZuweisenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const { art, id } = request.params;
            const anschluss = anschlussFuer(art);
            const actor = await actorOf(request);
            const objekt = await ladeObjekt(app.database!, anschluss, id);
            return mapOperation(
                app.database!,
                actor,
                {
                    operationId: request.body.operationId,
                    operation: "wikibox.zuweisen",
                    mapDomainId: objekt.mapDomainId,
                    body: { art, id, key: request.body.key },
                },
                async (tx) => {
                    const vorher = await anschluss.sperre(tx, objekt);
                    // Unter der Sperre noch einmal lesen: Was vorher an dem Objekt hing, entscheidet der Stand von jetzt.
                    const aktuell = await ladeObjekt(tx, anschluss, id);
                    const herkunftVorher = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                    // Der Stand je Abschnitt (OPS-000112): Hing der Artikel nur an einem Teil, braucht die Rücknahme ihn.
                    const standVorher = await anschluss.abschnitte?.lies(tx, aktuell, () => request.body.key);
                    const artikel = await anschluss.weise(tx, aktuell, request.body.key);
                    const herkunftNachher = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                    const standNachher = await anschluss.abschnitte?.lies(tx, aktuell, () => null);
                    const nachher = await anschluss.beruehre(tx, aktuell);
                    return {
                        receipt: {
                            affected: aktuell.ids.map((kennung) => ({
                                kind: anschluss.schreiber.affectedArt,
                                id: kennung,
                                revision: nachher.get(kennung) ?? 0,
                            })),
                            derivedWork: [],
                            warnings: [],
                        },
                        entries: zuordnungsEintraege(
                            anschluss,
                            "wiki_zugewiesen",
                            aktuell,
                            vorher,
                            nachher,
                            { vorher: aktuell.artikel?.key ?? null, nachher: artikel.key },
                            zuordnungsZusatz(anschluss, herkunftVorher, herkunftNachher),
                            standVorher === undefined || standNachher === undefined
                                ? undefined
                                : { vorher: standVorher, nachher: standNachher },
                        ),
                        summary: `Wiki-Artikel „${artikel.name}“ zugewiesen`,
                        ableitung: false,
                    };
                },
            );
        },
    );

    app.post(
        `${EDITOR_WIKI_BOX_URL}/:art/:id/entfernen`,
        {
            ...protectEines(["edit_map_objects", "edit_territories", "edit_landscapes", "edit_mountains"], {
                writeClass: "map",
            }),
            preHandler: [requireMapEditing, verlangeArt as typeof requireMapEditing],
            schema: {
                params: Params,
                body: WikiBoxOperationBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { art, id } = request.params;
            const anschluss = anschlussFuer(art);
            const actor = await actorOf(request);
            const objekt = await ladeObjekt(app.database!, anschluss, id);
            return mapOperation(
                app.database!,
                actor,
                {
                    operationId: request.body.operationId,
                    operation: "wikibox.entfernen",
                    mapDomainId: objekt.mapDomainId,
                    body: { art, id },
                },
                async (tx) => {
                    const vorher = await anschluss.sperre(tx, objekt);
                    const aktuell = await ladeObjekt(tx, anschluss, id);
                    if (aktuell.artikel === null) {
                        throw new ApiError(409, "kein_artikel", "An diesem Objekt hängt kein Wiki-Artikel.");
                    }
                    const herkunftVorher = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                    const standVorher = await anschluss.abschnitte?.lies(tx, aktuell, () => null);
                    await anschluss.entferne(tx, aktuell);
                    const herkunftNachher = (await anschluss.herkunft?.(tx, aktuell)) ?? null;
                    const standNachher = await anschluss.abschnitte?.lies(tx, aktuell, () => null);
                    const nachher = await anschluss.beruehre(tx, aktuell);
                    return {
                        receipt: {
                            affected: aktuell.ids.map((kennung) => ({
                                kind: anschluss.schreiber.affectedArt,
                                id: kennung,
                                revision: nachher.get(kennung) ?? 0,
                            })),
                            derivedWork: [],
                            warnings: [],
                        },
                        entries: zuordnungsEintraege(
                            anschluss,
                            "wiki_entfernt",
                            aktuell,
                            vorher,
                            nachher,
                            { vorher: aktuell.artikel.key, nachher: null },
                            zuordnungsZusatz(anschluss, herkunftVorher, herkunftNachher),
                            standVorher === undefined || standNachher === undefined
                                ? undefined
                                : { vorher: standVorher, nachher: standNachher },
                        ),
                        summary: `Wiki-Artikel „${aktuell.artikel.name}“ entfernt`,
                        ableitung: false,
                    };
                },
            );
        },
    );

    // Weitere Artikel (WI-0300) schreibt die Box nicht mehr (WI-0302): Sie sind die weiteren Straßennamen je Abschnitt und gehen mit „Fertig“ über `path.update`. Die Box zeigt sie nur an;
    // die Schritte, die sie schon schrieb (`wikibox.weitere_zuweisen`, `.weitere_entfernen`), nimmt die Rücknahme weiter zurück.

    // Zuweisen und Entfernen zurücknehmen (WI-0265 B8d, Fachvertrag C.2): die Vorprüfung liest nur (wie jede Vorschau unter der Kartensperre), die Rücknahme schreibt EINE Operation mit der Quelle restore.
    app.post(
        editorWikiBoxRestoreSeriesPreviewUrl(":art" as WikiBoxArt, ":id"),
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                params: Params,
                body: RuecknahmeVorschauBody,
                response: { 200: RuecknahmePruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return vorschauWikiBox(
                app.database!,
                request.params.art,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorWikiBoxRestoreSeriesUrl(":art" as WikiBoxArt, ":id"),
        {
            ...protectEines(["edit_map_objects", "edit_territories", "edit_landscapes", "edit_mountains"], {
                writeClass: "map",
            }),
            preHandler: [requireMapEditing, verlangeArt as typeof requireMapEditing],
            schema: { params: Params, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenWikiBox(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.art,
                request.params.id,
                request.body,
            ),
    );

    app.post(
        `${EDITOR_WIKI_BOX_URL}/:art/:id/sync`,
        {
            ...protectEines(["edit_map_objects", "edit_territories", "edit_landscapes", "edit_mountains"], {
                writeClass: "map",
            }),
            preHandler: [requireMapEditing, verlangeArt as typeof requireMapEditing],
            schema: {
                params: Params,
                body: WikiBoxOperationBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { art, id } = request.params;
            const session = await adminSession(request);
            const anschluss = anschlussFuer(art);
            const database = app.database!;
            const objekt = await ladeObjekt(database, anschluss, id);
            const grund = await syncGrund(database, objekt, process.env);
            if (grund !== undefined) {
                const saetze = {
                    kein_artikel: "An diesem Objekt hängt kein Wiki-Artikel.",
                    kein_stand: "Zu diesem Artikel gibt es noch keinen Wiki-Stand.",
                    abruf_gesperrt: "In dieser Umgebung gibt es keinen Abruf beim Wiki.",
                    gehoert_legacy: "Für diesen Bereich gibt es noch keine Übernahme.",
                } as const;
                throw new ApiError(409, grund, saetze[grund], { grund });
            }
            const titel = syncTitel(objekt);
            if (titel === null || objekt.ids.length > OBJEKT_IDS_MAX) {
                throw new ApiError(409, "kein_stand", "Zu diesem Artikel gibt es keinen Sync.");
            }
            // Das Wiki hat gedrosselt: bis zum Ende der Pause geht kein neuer Sync hinaus.
            const stand = await leseObjektStand(database, art, objekt.ids);
            const frei = stand.fehler?.freiAb ?? null;
            if (frei !== null && new Date(frei).getTime() > Date.now()) {
                throw new ApiError(409, "pausiert", "Das Wiki hat die Anfragen gedrosselt; später erneut.", {
                    freiAb: frei,
                });
            }
            return adminOperation(
                database,
                session,
                { operationId: request.body.operationId, body: { action: "wikibox.sync", art, id } },
                async (tx) => {
                    if (await syncLaeuft(tx, objekt)) {
                        throw new ApiError(409, "sync_laeuft", "Ein Sync dieses Objekts wartet schon oder läuft.");
                    }
                    const job = await reiheEin(
                        tx,
                        { titel, ausgeloestVon: session.displayName, objekt: { art, id, ids: objekt.ids } },
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
                            action: EVENT_SYNC,
                            targetRef: `job:${job}`,
                            details: { job },
                        },
                    };
                },
            );
        },
    );
};
