import { createHash, randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_STUECK_BYTES,
    KARTENSERIE_STUECK_PRUEFSUMME,
    KARTENSERIEN_UPLOADS_URL,
    KartenserieUpload,
    KartenserieUploadAbschluss,
    KartenserieUploadAnlegen,
    OperationReceipt,
    kartenserieStufen,
    pngKopf,
    wirksamerKatalog,
} from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import {
    ablageAus,
    empfangen,
    freieBytes,
    grenzeBytes,
    haengeAn,
    kopfVon,
    legeQuelleAb,
    legeUploadAn,
    leseUpload,
    offeneUploads,
    raeumeAuf,
    uebergib,
    uploadSicht,
    type Ablage,
} from "../map-series/ablage.ts";
import { leseKartenserien } from "../map-series/stand.ts";
import { assertWritable } from "../system/write-guard.ts";

/**
 * Hochladen einer Kartenserie (WI-0220 Schnitt 3; Vertrag mit Claudio 2026-10-18):
 *
 *     POST /api/admin/system/kartenserien/uploads                        anlegen (Ziel, Größe, Kante)     manage_map_series + Passkey
 *     PUT  /api/admin/system/kartenserien/uploads/:id?versatz=<bytes>    ein Stück (≤ 8 MiB, SHA-256)     manage_map_series
 *     GET  /api/admin/system/kartenserien/uploads/:id                    was angekommen ist               manage_map_series
 *     POST /api/admin/system/kartenserien/uploads/:id/abschluss          prüfen, Auftrag einreihen        manage_map_series
 *
 * - **Protokoll:** Anlegen und Abschluss schreiben je ein Ereignis `system.map_series_changed` (`aktion` `hochladen`, `zerlegen`). Ein
 *   Stück ist keine Handlung, sondern Daten eines angelegten Uploads; es steht in der Ausnahmeliste der Protokollpflicht
 *   (`SYSTEM_ROUTE_DATENSTUECKE`). Der Passkey gilt dem Anlegen; nach zehn Minuten Hochladen fragt der Abschluss nicht noch einmal.
 * - 🪤 **Den Körper immer lesen** (Claudio 2026-10-18): Nginx gibt die Stücke ungepuffert weiter. Antwortet die App, bevor sie den
 *   Körper gelesen hat, bricht die Weitergabe mit 502 ab. Der Parser liest jedes Stück ganz; eine Ablehnung vor dem Parser (Herkunft,
 *   Systemsperre) liest den Rest im `onError` aus.
 * - **Platz:** Ein Upload wird nur angenommen, wenn danach mindestens `MAP_SERIES_MIN_FREE_GB` (Vorgabe 20) frei bleiben.
 * - Auf Production weist die App ab (`kartenserien_production`); der Weg dorthin ist „von Stage übernehmen“ (Schnitt 4).
 * - Der Auftrag `map_series_tile` überschneidet sich mit keinem Kartenauftrag (`p_scope_kind = 'tiles'`): Er fasst keine Kartendaten an.
 *   Wie jeder Auftrag einer Person wartet er unter der Kartensperre.
 */

const KIND = "map_series_tile" as const;
const EVENT = "system.map_series_changed" as const;
const UploadId = Type.Object({ id: Type.String({ format: "uuid" }) }, { additionalProperties: false });

/** Den Rest eines Körpers auslesen, damit Nginx' ungepufferte Weitergabe nicht mit 502 abbricht. */
async function leerlesen(request: FastifyRequest): Promise<void> {
    const raw = request.raw;
    if (raw.readableEnded || raw.destroyed) return;
    raw.resume();
    await new Promise<void>((done) => {
        raw.once("end", done);
        raw.once("close", done);
        raw.once("error", done);
    });
}

function ablageOder503(tileRoot: string | undefined): Ablage {
    const ablage = ablageAus(process.env, tileRoot);
    if (ablage === undefined) {
        throw new ApiError(
            503,
            "kartenserien_ablage_fehlt",
            "Auf dieser Instanz gibt es keine Ablage für Kartenquellen.",
        );
    }
    return ablage;
}

function nichtAufProduction(environment: string): void {
    if (environment === "production") {
        throw new ApiError(
            409,
            "kartenserien_production",
            "Auf Production ändert sich hier nichts: Kartenserien kommen von der Stage (Schnitt 4).",
        );
    }
}

export const adminMapSeriesUploadRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Ein Stück ganz lesen, auch wenn die Route es danach ablehnt (siehe oben).
    app.addContentTypeParser(
        "application/octet-stream",
        { parseAs: "buffer", bodyLimit: KARTENSERIE_STUECK_BYTES + 64 * 1024 },
        (_request, body, done) => done(null, body),
    );

    app.post(
        KARTENSERIEN_UPLOADS_URL,
        {
            ...protect("manage_map_series", { confirm: "passkey", writeClass: "system" }),
            schema: { body: KartenserieUploadAnlegen, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            nichtAufProduction(session.environment);
            await assertWritable(request, "system");
            const ablage = ablageOder503(app.config.tileRoot);
            const { operationId, ziel, bytes, kante } = request.body;
            if (kartenserieStufen(kante) === null) {
                throw new ApiError(
                    400,
                    "kartenserien_kante",
                    "Gebraucht wird ein Quadrat mit 8.192, 16.384, 32.768 oder 65.536 px Kante.",
                );
            }
            await raeumeAuf(ablage, Date.now());
            return adminOperation(app.database!, session, { operationId, body: request.body }, async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext('map_series:schreiben'))`;
                const stand = await leseKartenserien(tx);
                const zeile = stand.zeilen.find((z) => z.id === ziel.id);
                const vorgabe = AVENTURIA_SERIES.series.some((s) => s.id === ziel.id);
                if (ziel.art === "neu") {
                    // Eine neue Kennung darf es nicht geben; eine angelegte, aber nie fertig zerlegte darf neu hochgeladen werden.
                    const unfertig =
                        zeile !== undefined && !vorgabe && zeile.sourcePixels === null && zeile.status === "aktiv";
                    if (vorgabe || (zeile !== undefined && !unfertig)) {
                        throw new ApiError(409, "kartenserien_kennung_vergeben", "Diese Kennung gibt es schon.");
                    }
                } else if (!vorgabe && zeile === undefined) {
                    throw new ApiError(404, "unknown_series", "Diese Kartenserie gibt es nicht.");
                } else if (zeile?.status === "papierkorb") {
                    throw new ApiError(409, "in_papierkorb", "Diese Kartenserie liegt im Papierkorb.");
                }
                if (ziel.art === "quelle") {
                    // Die Quelle gehört zu den Kacheln, die schon da sind: gleiche Kante, sonst wäre sie eine andere Karte.
                    const serie = wirksamerKatalog(AVENTURIA_SERIES, stand.zeilen).series.find((s) => s.id === ziel.id);
                    if (serie === undefined || serie.sourcePixels !== kante) {
                        throw new ApiError(400, "kartenserien_kante", "Diese Datei hat nicht die Kante der Serie.");
                    }
                }
                if ((await offeneUploads(ablage)).some(({ wert }) => wert.ziel.id === ziel.id)) {
                    throw new ApiError(409, "kartenserien_upload_offen", "Für diese Serie läuft schon ein Upload.");
                }
                const frei = await freieBytes(ablage.wurzel);
                const grenze = grenzeBytes(process.env);
                if (frei - bytes < grenze) {
                    throw new ApiError(507, "kartenserien_platz", "Danach bliebe zu wenig Platz auf dem Server.", {
                        freiBytes: frei,
                        grenzeBytes: grenze,
                    });
                }
                const uploadId = randomUUID();
                await legeUploadAn(ablage, {
                    uploadId,
                    ziel,
                    bytes,
                    kante,
                    personId: session.personId,
                    angelegt: new Date().toISOString(),
                });
                return {
                    receipt: {
                        environment: session.environment,
                        affected: [{ kind: "map_series_upload", id: uploadId }],
                        derivedWork: [],
                        warnings: [],
                    },
                    event: {
                        ...actorFields(session, request),
                        action: EVENT,
                        targetRef: `map-series:${ziel.id}`,
                        details: { series: ziel.id, aktion: "hochladen", from: null, to: kante },
                    },
                };
            });
        },
    );

    app.put(
        `${KARTENSERIEN_UPLOADS_URL}/:id`,
        {
            ...protect("manage_map_series", { writeClass: "system" }),
            bodyLimit: KARTENSERIE_STUECK_BYTES + 64 * 1024,
            onError: async (request) => leerlesen(request),
            schema: {
                params: UploadId,
                querystring: Type.Object({ versatz: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
                response: {
                    200: Type.Object({ empfangen: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
                    ...ADMIN_ERRORS,
                },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            nichtAufProduction(session.environment);
            await assertWritable(request, "system");
            const ablage = ablageOder503(app.config.tileRoot);
            const wert = await leseUpload(ablage, request.params.id);
            if (wert === undefined || wert.personId !== session.personId) {
                throw new ApiError(404, "kartenserien_upload_fehlt", "Diesen Upload gibt es nicht (mehr).");
            }
            const stueck = request.body as unknown;
            if (!(stueck instanceof Uint8Array) || stueck.length === 0) {
                throw new ApiError(415, "kartenserien_stueck", "Ein Stück kommt als application/octet-stream.");
            }
            // Die Prüfsumme des Stücks (SubtleCrypto im Browser): Ein verfälschtes Stück kommt nicht in die Datei, der Browser schickt es neu.
            const angegeben = request.headers[KARTENSERIE_STUECK_PRUEFSUMME];
            const gerechnet = createHash("sha256").update(stueck).digest("hex");
            if (angegeben !== gerechnet) {
                throw new ApiError(422, "kartenserien_pruefsumme", "Die Prüfsumme des Stücks stimmt nicht.", {
                    empfangen: Math.max(0, await empfangen(ablage, wert.uploadId)),
                });
            }
            const ergebnis = await haengeAn(ablage, wert, request.query.versatz, stueck);
            if (!ergebnis.ok) {
                throw new ApiError(409, "kartenserien_versatz", "Der Versatz passt nicht zum Stand.", {
                    empfangen: ergebnis.empfangen,
                });
            }
            return { empfangen: ergebnis.empfangen };
        },
    );

    app.get(
        `${KARTENSERIEN_UPLOADS_URL}/:id`,
        {
            ...protect("manage_map_series"),
            schema: { params: UploadId, response: { 200: KartenserieUpload, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const ablage = ablageOder503(app.config.tileRoot);
            const wert = await leseUpload(ablage, request.params.id);
            if (wert === undefined || wert.personId !== session.personId) {
                throw new ApiError(404, "kartenserien_upload_fehlt", "Diesen Upload gibt es nicht (mehr).");
            }
            return uploadSicht(wert, await empfangen(ablage, wert.uploadId));
        },
    );

    app.post(
        `${KARTENSERIEN_UPLOADS_URL}/:id/abschluss`,
        {
            ...protect("manage_map_series", { writeClass: "system" }),
            schema: {
                params: UploadId,
                body: KartenserieUploadAbschluss,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            nichtAufProduction(session.environment);
            await assertWritable(request, "system");
            const ablage = ablageOder503(app.config.tileRoot);
            const { operationId } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { id: request.params.id } },
                async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtext('map_series:schreiben'))`;
                    const wert = await leseUpload(ablage, request.params.id);
                    if (wert === undefined || wert.personId !== session.personId) {
                        throw new ApiError(404, "kartenserien_upload_fehlt", "Diesen Upload gibt es nicht (mehr).");
                    }
                    const bekommen = await empfangen(ablage, wert.uploadId);
                    if (bekommen !== wert.bytes) {
                        throw new ApiError(
                            409,
                            "kartenserien_unvollstaendig",
                            "Der Upload ist noch nicht vollständig.",
                            {
                                empfangen: Math.max(0, bekommen),
                            },
                        );
                    }
                    const kopf = pngKopf(await kopfVon(ablage, wert.uploadId));
                    if (kopf === null || kopf.breite !== wert.kante || kopf.hoehe !== wert.kante) {
                        throw new ApiError(
                            400,
                            "kartenserien_kante",
                            "Die Datei ist kein PNG mit der angemeldeten Kante.",
                        );
                    }
                    if (wert.ziel.art === "quelle") {
                        // Nur ablegen: kein Auftrag, keine neue Fassung, die Karte bleibt, wie sie ist.
                        const eingangQuelle = await uebergib(ablage, wert);
                        const name = await legeQuelleAb(ablage, wert.ziel.id, eingangQuelle);
                        return {
                            receipt: {
                                environment: session.environment,
                                affected: [{ kind: "map_series", id: wert.ziel.id }],
                                derivedWork: [],
                                warnings: [],
                            },
                            event: {
                                ...actorFields(session, request),
                                action: EVENT,
                                targetRef: `map-series:${wert.ziel.id}`,
                                details: { series: wert.ziel.id, aktion: "quelle", from: null, to: name },
                            },
                        };
                    }
                    const [laeuft] = await tx<{ public_id: string }[]>`
                    SELECT public_id::text AS public_id FROM job
                     WHERE kind = ${KIND} AND state IN ('QUEUED', 'RUNNING') AND input_ref->>'serie' = ${wert.ziel.id}
                     LIMIT 1
                `;
                    if (laeuft !== undefined) {
                        throw new ApiError(
                            409,
                            "kartenserien_auftrag_laeuft",
                            "Für diese Serie läuft schon ein Auftrag.",
                            {
                                job: laeuft.public_id,
                            },
                        );
                    }
                    if (wert.ziel.art === "neu") {
                        const { id, anlage } = wert.ziel;
                        // Die Zeile entsteht jetzt, ohne Kante: Im Fächer erscheint die Serie erst, wenn der Auftrag sie einträgt.
                        await tx`
                        INSERT INTO map_series (
                            series_id, label, description, visibility, labels_in_image, changed_at, changed_by, changed_by_label
                        ) VALUES (
                            ${id}, ${anlage.label}, ${anlage.description ?? null},
                            ${anlage.nurEditoren || anlage.labelsInImage ? "EDITOR_ONLY" : "PUBLIC"}, ${anlage.labelsInImage},
                            now(), ${session.personId}::uuid, ${session.displayName}
                        )
                        ON CONFLICT (series_id) DO UPDATE SET
                            label = EXCLUDED.label, description = EXCLUDED.description, visibility = EXCLUDED.visibility,
                            labels_in_image = EXCLUDED.labels_in_image, changed_at = now(), changed_by = EXCLUDED.changed_by,
                            changed_by_label = EXCLUDED.changed_by_label
                    `;
                    }
                    const eingang = await uebergib(ablage, wert);
                    const eingabe = {
                        serie: wert.ziel.id,
                        eingang,
                        bytes: wert.bytes,
                        kante: wert.kante,
                        art: wert.ziel.art,
                    };
                    const [job] = await tx<{ public_id: string }[]>`
                    SELECT public_id::text AS public_id
                      FROM job_enqueue(${KIND}, 1::smallint, ${AVENTURIA_SERIES.mapDomain}, ${session.personId},
                                       ${tx.json(eingabe)}, 50::smallint, NULL, 'tiles', '{}'::smallint[])
                `;
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "map_series", id: wert.ziel.id }],
                            derivedWork: [{ kind: KIND, jobId: job!.public_id, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT,
                            targetRef: `map-series:${wert.ziel.id}`,
                            details: { series: wert.ziel.id, aktion: "zerlegen", from: null, to: job!.public_id },
                        },
                    };
                },
            );
        },
    );
};
