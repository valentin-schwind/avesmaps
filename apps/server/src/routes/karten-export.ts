import { createReadStream } from "node:fs";
import { pipeline, Transform, type Readable } from "node:stream";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
    ApiErrorBody,
    KARTEN_API_URL,
    KARTEN_EXPORT_URL,
    KARTEN_FRISTEN,
    KARTEN_ID_MUSTER,
    KARTEN_PAKET_PFAD,
    KARTEN_PAKET_URL,
    KARTEN_SVG_EXPORT_URL,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_ROH,
    KARTEN_VERTRAG_FASSUNG,
    KartenApiListe,
    KartenExportStand,
    KartenPaketSicht,
    KartenSvgAuftrag,
    KartenZugangAnlegen,
    KartenZugangHandlung,
    KartenZugangNeu,
    OperationReceipt,
    istKartenSchluessel,
    type KartenEintrag,
} from "@avesmaps3d/shared";
import { recordEvent } from "../auth/audit.ts";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, linkOrigin } from "../auth/admin-guard.ts";
import { protect, requestMeta } from "../auth/plugin.ts";
import { isWellFormedToken } from "../auth/tokens.ts";
import { isNotProvisioned } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import {
    baueKartenPaket,
    leseKartenBestand,
    pruefeDatei,
    pruefungenAnstossen,
    type KartenBestand,
    type KartenDatei,
    type KartenPaket,
} from "../karten-export/quellen.ts";
import { auftragEinreihen, leseSvgStand, standardMitId } from "../karten-export/svg-auftrag.ts";
import { leseSvgWurzel } from "../karten-export/svg-wurzel.ts";
import { zipStrom } from "../karten-export/zip.ts";
import {
    beendeAbruf,
    beginneAbruf,
    findeAbruf,
    legeZugangAn,
    listeZugaenge,
    loeseTicketEin,
    merkeNutzung,
    nimmZugangZurueck,
    pruefeZugang,
    stelleTicketAus,
    stelleZugangNeuAus,
    type GeprueftZugang,
} from "../karten-export/zugang.ts";
import { leseBereich } from "./abzug-holen.ts";

/**
 * Karten herunterladen (WI-0280; die Wege stehen im Kopf von `packages/shared/src/karten-export.ts`). Drei Türen, EIN Auslieferer (`liefere`): Der Teil mit Strom, `Range`
 * und Kopfzeilen ist heikel genug, dass er nicht dreimal existieren darf (Legacy: „ein endpunkt reicht“).
 *
 * - **Beleg vor dem ersten Byte:** Ein Abruf steht in `karten_abruf` und im Protokoll, bevor etwas hinausgeht; ein Fortsetzen mit `Range` ist derselbe Abruf.
 * - **Ungepuffert:** `X-Accel-Buffering: no`, damit Nginx nicht bis zu 1 GB zwischenspeichert. Darum läuft das auch ohne eigenen `location`-Block.
 * - **Gedeckelt:** höchstens `HOECHSTENS_ZUGLEICH` Ströme je Instanz, je Zugang `HOECHSTENS_JE_ZUGANG` (429 mit `Retry-After`). Ein Download von 1,8 GB läuft über die eine
 *   Leitung, die auch die Karte bedient.
 * - **Keine CORS-Kopfzeilen:** Ein Schlüssel gehört nicht in eine fremde Webseite.
 * - **Kein Geheimnis im Protokoll:** Das Protokoll trägt die Kennung, nie den Wert; `fuer_wen` bleibt in der Tafel (Freitext über Dritte gehört nicht ins Protokoll).
 */

const HOECHSTENS_ZUGLEICH = 4;
const HOECHSTENS_JE_ZUGANG = 2;
const NEU_VERSUCHEN_S = 30;

const strict = { additionalProperties: false } as const;
const IdParam = Type.Object({ id: Type.String({ format: "uuid" }) }, strict);
const IdsQuery = Type.Object({ ids: Type.String({ minLength: 1, maxLength: 1500 }) }, strict);
const TicketParam = Type.Object({ ticket: Type.String({ minLength: 1, maxLength: 200 }) }, strict);
const DateiParam = Type.Object({ datei: Type.String({ minLength: 5, maxLength: 60 }) }, strict);
/** Nicht `strict`: Ein Werkzeug darf weitere Parameter anhängen (etwa gegen Zwischenspeicher), wie bei Legacy. */
const SvgQuery = Type.Object({ smooth: Type.Optional(Type.String({ maxLength: 10 })) });
/** Der Rumpf eines 404 an diesem Endpunkt, wie ihn die Pipeline erwartet: `{"error":"smooth_export_not_available"}`. */
const SvgFehlt = Type.Object({ error: Type.String(), message: Type.String() });
const ID = new RegExp(KARTEN_ID_MUSTER, "u");

/** Die Hüllen auch der Fehler, die dieser Vertrag nach außen trägt. */
const FEHLER = { ...ADMIN_ERRORS, 410: ApiErrorBody, 416: ApiErrorBody, 429: ApiErrorBody };

const bearer = (kopf: string | undefined): string | undefined => /^Bearer (\S+)$/u.exec(kopf ?? "")?.[1];

function zuViel(reply: FastifyReply): never {
    void reply.header("retry-after", String(NEU_VERSUCHEN_S));
    throw new ApiError(429, "too_many_requests", "Gerade laufen zu viele Downloads. Versuch es gleich noch einmal.");
}

function nichtDa(fehlend: readonly string[]): ApiError {
    return new ApiError(404, "export_not_available", `Auf diesem Server liegt keine Datei für: ${fehlend.join(", ")}.`);
}

/** Die angefragten Karten in der Reihenfolge des Katalogs. 🔴 Fehlt eine, gibt es kein ZIP: nie ein kleineres oder ersatzweise anderes. */
function waehle(bestand: KartenBestand, ids: readonly string[]): KartenDatei[] {
    const unbekannt = ids.filter((id) => !bestand.dateien.some((d) => d.eintrag.id === id));
    const gewaehlt = bestand.dateien.filter((d) => ids.includes(d.eintrag.id));
    const fehlend = [...unbekannt, ...gewaehlt.filter((d) => d.pfad === null).map((d) => d.eintrag.id)];
    if (fehlend.length > 0) throw nichtDa(fehlend);
    return gewaehlt;
}

function idsAus(text: string): string[] {
    const ids = [...new Set(text.split(",").map((id) => id.trim()))];
    if (ids.length > 32 || ids.some((id) => !ID.test(id))) {
        throw new ApiError(400, "invalid_request", "Die Kennungen der Karten sind ungültig.");
    }
    return ids;
}

function dateiName(jetzt: Date): string {
    return `avesmaps-karten-${jetzt.toISOString().slice(0, 10)}.zip`;
}

/** Trifft die Anfrage den Stand, den der Aufrufer schon hat? Nimmt den ETag mit Anführungszeichen, schwach oder in einer Liste, und die blanke Prüfsumme. */
function istUnveraendert(kopf: string | string[] | undefined, sha256: string): boolean {
    if (typeof kopf !== "string") return false;
    return kopf.split(",").some((teil) => teil.trim().replace(/^W\//u, "").replace(/^"|"$/gu, "") === sha256);
}

/** Was `liefere` hinausgibt: ein ZIP aus mehreren Dateien oder eine SVG, wie sie liegt. */
interface Lieferung {
    readonly sha256: string;
    readonly bytes: number;
    readonly karten: readonly string[];
    readonly typ: string;
    readonly dateiname: string;
    /** Kopfzeilen, die auch ein 304 trägt. */
    readonly kopf: Readonly<Record<string, string>>;
    strom(start: number, letztes: number, zaehle: (anzahl: number) => void): Readable;
}

function alsZip(paket: KartenPaket): Lieferung {
    const { plan } = paket;
    return {
        sha256: plan.sha256,
        bytes: plan.bytes,
        karten: paket.dateien.map((d) => d.eintrag.id),
        typ: "application/zip",
        dateiname: dateiName(new Date()),
        kopf: paket.fassung === null ? {} : { "x-avesmaps-kartenfassung": paket.fassung },
        strom: (start, letztes, zaehle) => zipStrom(plan, start, letztes, zaehle),
    };
}

/** `?smooth=1` oder `true` ist die geglättete Fassung, alles andere die rohe (Legacy, `avesmapsSvgExportVarianteAusAnfrage`). */
function svgVariante(smooth: string | undefined): "glatt" | "roh" {
    const wert = (smooth ?? "").trim().toLowerCase();
    return wert === "1" || wert === "true" ? "glatt" : "roh";
}

function dateiStrom(pfad: string, start: number, letztes: number, zaehle: (anzahl: number) => void): Readable {
    const zaehler = new Transform({
        transform(stueck: Buffer, _kodierung, weiter) {
            zaehle(stueck.length);
            weiter(null, stueck);
        },
    });
    // Ein Lesefehler reißt beide Ströme ab: Die Antwort bricht sichtbar ab, statt still zu kurz zu sein.
    pipeline(createReadStream(pfad, { start, end: letztes }), zaehler, () => undefined);
    return zaehler;
}

/**
 * Die SVG für die Terrain-Pipeline, Kopfzeilen wie Legacys `api/svg-export.php`. `null`: Es liegt keine passende Datei vor.
 * 💣 Nie eine eckige Datei als geglättete: Ob Kurven drin sind, sagt die Wurzel der Datei, nicht ihre Kennung.
 */
async function alsSvg(datei: KartenDatei, variante: "glatt" | "roh"): Promise<Lieferung | null> {
    const pfad = datei.pfad;
    if (pfad === null) return null;
    const [pruefung, wurzel] = await Promise.all([pruefeDatei(pfad), leseSvgWurzel(pfad)]);
    if (wurzel === null || wurzel.geglaettet !== (variante === "glatt")) return null;
    const kartenfassung = wurzel.kartenfassung ?? datei.eintrag.fassung ?? "0";
    const kopf: Record<string, string> = {
        "x-avesmaps-kartenfassung": kartenfassung,
        "x-avesmaps-variante": variante,
        "x-avesmaps-quelle": datei.quelle ?? "routine",
    };
    if (wurzel.landschaftsfassung !== null) kopf["x-avesmaps-landschaftsfassung"] = wurzel.landschaftsfassung;
    if (wurzel.exportiert !== null) kopf["x-avesmaps-exported-at"] = wurzel.exportiert;
    if (datei.zeit !== null) kopf["last-modified"] = datei.zeit.toUTCString();
    const tag = (wurzel.exportiert ?? datei.zeit?.toISOString() ?? new Date().toISOString()).slice(0, 10);
    return {
        sha256: pruefung.sha256,
        bytes: pruefung.bytes,
        karten: [datei.eintrag.id],
        typ: "image/svg+xml; charset=utf-8",
        // Die festen Abzüge schreiben immer Inkscape; der Name wie Legacys letzter: `avesmaps-karte-2026-11-01-r220376-inkscape-glatt.svg`.
        dateiname: `avesmaps-karte-${tag}-r${kartenfassung}-inkscape-${variante}.svg`,
        kopf,
        strom: (start, letztes, zaehle) => dateiStrom(pfad, start, letztes, zaehle),
    };
}

export const karteExportRoutes: FastifyPluginAsyncTypebox = async (app) => {
    let zugleich = 0;
    const jeZugang = new Map<string, number>();

    const bestand = (): Promise<KartenBestand> => leseKartenBestand(app.database, app.config.tileRoot);
    const umgebung = (): NonNullable<typeof app.authConfig.environment> => {
        const wert = app.authConfig.environment;
        if (wert === undefined || app.database === undefined) {
            throw new ApiError(503, "auth_unavailable", "Die Anmeldung ist auf dieser Instanz nicht eingerichtet.");
        }
        return wert;
    };

    interface Auftrag {
        lieferung: Lieferung;
        weg: "sitzung" | "link" | "schluessel";
        zugang: GeprueftZugang | null;
        personId: string | null;
        ereignis: Pick<
            Parameters<typeof recordEvent>[1],
            "actorKind" | "actorPersonId" | "actorLabel" | "sessionId" | "ipPrefix" | "clientLabel" | "recovery"
        >;
    }

    /** Liefert ein ZIP oder eine SVG. Der einzige Ort mit Strom, `Range` und Kopfzeilen. */
    async function liefere(request: FastifyRequest, reply: FastifyReply, auftrag: Auftrag): Promise<FastifyReply> {
        const { lieferung, zugang, personId } = auftrag;
        const { sha256, bytes, karten } = lieferung;
        const sql = app.database!;
        // 🔴 Alle Kopfzeilen vor dem 304: Ein Client weiß nach „unverändert“, auf welche Fassung sich sein Hash bezieht (Legacy ebenso).
        void reply
            .header("etag", `"${sha256}"`)
            .header("x-avesmaps-sha256", sha256)
            .header("accept-ranges", "bytes")
            .header("cache-control", "private, no-cache")
            .header("x-content-type-options", "nosniff");
        for (const [name, wert] of Object.entries(lieferung.kopf)) void reply.header(name, wert);
        if (istUnveraendert(request.headers["if-none-match"], sha256)) return reply.code(304).send();

        const bereich = leseBereich(request.headers.range, bytes);
        if (bereich === null) {
            throw new ApiError(416, "range_not_satisfiable", "Dieser Bereich liegt außerhalb der Datei.");
        }
        const start = bereich?.start ?? 0;
        const letztes = bereich?.ende ?? bytes - 1;
        void reply
            .code(bereich === undefined ? 200 : 206)
            .header("content-type", lieferung.typ)
            .header("content-length", String(letztes - start + 1))
            .header("content-disposition", `attachment; filename="${lieferung.dateiname}"`)
            .header("x-accel-buffering", "no");
        if (bereich !== undefined) {
            void reply.header("content-range", `bytes ${String(start)}-${String(letztes)}/${String(bytes)}`);
        }
        if (request.method === "HEAD") return reply.send();

        const schluessel = zugang?.id ?? "sitzung";
        if (zugleich >= HOECHSTENS_ZUGLEICH || (jeZugang.get(schluessel) ?? 0) >= HOECHSTENS_JE_ZUGANG) zuViel(reply);
        zugleich += 1;
        jeZugang.set(schluessel, (jeZugang.get(schluessel) ?? 0) + 1);
        const frei = (): void => {
            zugleich -= 1;
            const rest = (jeZugang.get(schluessel) ?? 1) - 1;
            if (rest > 0) jeZugang.set(schluessel, rest);
            else jeZugang.delete(schluessel);
        };

        let abrufId: string | null;
        try {
            const zugangId = zugang?.id ?? null;
            if (start === 0) {
                // Der Beleg steht, bevor das erste Byte hinausgeht; scheitert er, geht nichts hinaus.
                abrufId = await beginneAbruf(sql, { zugangId, personId, karten, bytes });
                await recordEvent(sql, {
                    environment: umgebung(),
                    action: "system.karten_abruf",
                    targetRef: zugang === null ? "karten:sitzung" : `karten-zugang:${zugang.id}`,
                    details: { weg: auftrag.weg, kennung: zugang?.kennung ?? null, karten, bytes },
                    ...auftrag.ereignis,
                });
            } else {
                abrufId = await findeAbruf(sql, { zugangId, personId, karten });
            }
        } catch (error) {
            frei();
            throw error;
        }

        let geliefert = 0;
        const strom = lieferung.strom(start, letztes, (anzahl) => {
            geliefert += anzahl;
        });
        reply.raw.once("close", () => {
            frei();
            if (abrufId !== null) {
                void beendeAbruf(sql, {
                    id: abrufId,
                    geliefert: start + geliefert,
                    vollstaendig: start + geliefert >= bytes,
                }).catch((error: unknown) => request.log.warn({ err: error }, "karten_abruf nicht abgeschlossen"));
            }
        });
        return reply.send(strom as never);
    }

    // Die Sitzung: Fenster und eigener Download.

    app.get(
        `${KARTEN_EXPORT_URL}/stand`,
        { ...protect("export_maps"), schema: { response: { 200: KartenExportStand, ...FEHLER } } },
        async (_request, reply) => {
            void reply.header("cache-control", "no-store");
            const sql = app.database!;
            const { dateien } = await bestand();
            pruefungenAnstossen(dateien);
            const [links, schluessel, svg] = await Promise.all([
                listeZugaenge(sql, "link"),
                listeZugaenge(sql, "schluessel"),
                leseSvgStand(sql, dateien),
            ]);
            return { jetzt: new Date().toISOString(), karten: dateien.map((d) => d.eintrag), links, schluessel, svg };
        },
    );

    app.get(
        `${KARTEN_EXPORT_URL}/paket.zip`,
        { ...protect("export_maps"), schema: { querystring: IdsQuery, response: { ...FEHLER } } },
        async (request, reply) => {
            const session = await adminSession(request);
            const vorrat = await bestand();
            const paket = await baueKartenPaket(waehle(vorrat, idsAus(request.query.ids)), vorrat.lizenz);
            const felder = actorFields(session, request);
            return liefere(request, reply, {
                lieferung: alsZip(paket),
                weg: "sitzung",
                zugang: null,
                personId: session.personId,
                ereignis: felder,
            });
        },
    );

    app.post(
        `${KARTEN_EXPORT_URL}/zugaenge`,
        {
            ...protect("export_maps", { writeClass: "system" }),
            schema: { body: KartenZugangAnlegen, response: { 200: KartenZugangNeu, ...FEHLER } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const { operationId, art, fuerWen, tage, karten } = request.body;
            const name = fuerWen.trim();
            if (name === "") throw new ApiError(400, "invalid_request", "Trag ein, für wen das ist.");
            if (!KARTEN_FRISTEN[art].includes(tage))
                throw new ApiError(400, "invalid_request", "Diese Frist gibt es nicht.");
            waehle(await bestand(), karten);
            const angelegt: { wert?: string; id?: string; laeuftAb?: string } = {};
            await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "karten.zugang", art, fuerWen: name, tage, karten } },
                async (tx) => {
                    const neu = await legeZugangAn(tx, {
                        art,
                        fuerWen: name,
                        karten,
                        tage,
                        personId: session.personId,
                    });
                    angelegt.id = neu.id;
                    angelegt.laeuftAb = neu.laeuftAb.toISOString();
                    angelegt.wert =
                        art === "link"
                            ? `${linkOrigin(request, app.authConfig)}${KARTEN_PAKET_PFAD}#${neu.geheimnis}`
                            : neu.geheimnis;
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.karten_zugang",
                            targetRef: `karten-zugang:${neu.id}`,
                            details: { aktion: "angelegt", art, kennung: neu.kennung, tage, karten },
                        },
                    };
                },
            );
            if (angelegt.wert === undefined) {
                throw new ApiError(
                    409,
                    "karten_zugang_gesehen",
                    "Dieser Aufruf wurde schon beantwortet; der Wert steht nur einmal da.",
                );
            }
            void reply.header("cache-control", "no-store");
            return { id: angelegt.id!, wert: angelegt.wert, laeuftAb: angelegt.laeuftAb! };
        },
    );

    app.post(
        `${KARTEN_EXPORT_URL}/zugaenge/:id/neu`,
        {
            ...protect("export_maps", { writeClass: "system" }),
            schema: { params: IdParam, body: KartenZugangHandlung, response: { 200: KartenZugangNeu, ...FEHLER } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const { operationId } = request.body;
            const { id } = request.params;
            const angelegt: { wert?: string; id?: string; laeuftAb?: string } = {};
            await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "karten.zugang_neu", id } },
                async (tx) => {
                    const neu = await stelleZugangNeuAus(tx, { id, personId: session.personId });
                    angelegt.id = neu.id;
                    angelegt.laeuftAb = neu.laeuftAb.toISOString();
                    angelegt.wert =
                        neu.art === "link"
                            ? `${linkOrigin(request, app.authConfig)}${KARTEN_PAKET_PFAD}#${neu.geheimnis}`
                            : neu.geheimnis;
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.karten_zugang",
                            targetRef: `karten-zugang:${neu.id}`,
                            details: {
                                aktion: "neu",
                                art: neu.art,
                                kennung: neu.kennung,
                                tage: neu.tage,
                                karten: neu.karten,
                            },
                        },
                    };
                },
            );
            if (angelegt.wert === undefined) {
                throw new ApiError(
                    409,
                    "karten_zugang_gesehen",
                    "Dieser Aufruf wurde schon beantwortet; der Wert steht nur einmal da.",
                );
            }
            void reply.header("cache-control", "no-store");
            return { id: angelegt.id!, wert: angelegt.wert, laeuftAb: angelegt.laeuftAb! };
        },
    );

    app.post(
        `${KARTEN_EXPORT_URL}/zugaenge/:id/weg`,
        {
            // Zurücknehmen schützt: Es läuft auch unter einer Systemsperre.
            ...protect("export_maps", { writeClass: "security" }),
            schema: { params: IdParam, body: KartenZugangHandlung, response: { 200: OperationReceipt, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId } = request.body;
            const { id } = request.params;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "karten.zugang_weg", id } },
                async (tx) => {
                    const alt = await nimmZugangZurueck(tx, { id, personId: session.personId });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.karten_zugang",
                            targetRef: `karten-zugang:${id}`,
                            details: { aktion: "zurueck", art: alt.art, kennung: alt.kennung },
                        },
                    };
                },
            );
        },
    );

    app.post(
        `${KARTEN_EXPORT_URL}/svg`,
        {
            ...protect("export_maps", { writeClass: "system" }),
            schema: { body: KartenSvgAuftrag, response: { 200: OperationReceipt, ...FEHLER } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, einstellungen } = request.body;
            const eingabe = standardMitId(einstellungen);
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "karten.svg", eingabe } },
                async (tx) => {
                    const jobId = await auftragEinreihen(tx, eingabe, session.personId);
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [],
                            derivedWork: [{ kind: "karten_svg", jobId, state: "queued" }],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.karten_svg",
                            targetRef: "karten:svg",
                            details: { aktion: "erzeugen", art: eingabe.art },
                        },
                    };
                },
            );
        },
    );

    // Der Link: Empfängerseite und Datei, ohne Sitzung.

    const offen = { config: { auth: "karten_zugang" as const, errorEnvelope: true as const } };
    const linkFehlt = (): ApiError => new ApiError(410, "link_abgelaufen", "Dieser Link gilt nicht mehr.");
    const sicherLesen = async <T>(lesen: () => Promise<T>): Promise<T> => {
        try {
            return await lesen();
        } catch (error) {
            if (isNotProvisioned(error))
                throw new ApiError(503, "auth_unavailable", "Das ist auf dieser Instanz noch nicht bereit.");
            throw error;
        }
    };

    app.get(
        `${KARTEN_PAKET_URL}/oeffnen`,
        { ...offen, schema: { response: { 200: KartenPaketSicht, ...FEHLER } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            umgebung();
            const wert = bearer(request.headers.authorization);
            const zugang = isWellFormedToken(wert)
                ? await sicherLesen(() => pruefeZugang(app.database!, wert, "link"))
                : null;
            if (zugang === null) throw linkFehlt();
            await merkeNutzung(app.database!, zugang.id);
            const vorrat = await bestand();
            const dateien = waehle(vorrat, zugang.karten);
            pruefungenAnstossen(dateien);
            const nennung = [...new Set(dateien.map((d) => d.nennung).filter((n): n is string => n !== null))];
            return {
                karten: dateien.map((d): KartenEintrag => d.eintrag),
                bytes: dateien.reduce((summe, d) => summe + (d.eintrag.bytes ?? 0), 0),
                laeuftAb: zugang.laeuftAb.toISOString(),
                datei: `${KARTEN_PAKET_URL}/datei/${stelleTicketAus(zugang)}`,
                nennung,
                lizenz: { name: vorrat.lizenz.name, uri: vorrat.lizenz.uri },
            };
        },
    );

    app.get(
        `${KARTEN_PAKET_URL}/datei/:ticket`,
        { ...offen, schema: { params: TicketParam, response: { ...FEHLER } } },
        async (request, reply) => {
            umgebung();
            const zugang = await sicherLesen(() => loeseTicketEin(app.database!, request.params.ticket));
            if (zugang === null) throw linkFehlt();
            const vorrat = await bestand();
            const paket = await baueKartenPaket(waehle(vorrat, zugang.karten), vorrat.lizenz);
            await merkeNutzung(app.database!, zugang.id);
            return liefere(request, reply, {
                lieferung: alsZip(paket),
                weg: "link",
                zugang,
                personId: null,
                ereignis: { actorKind: "system", actorLabel: `karten-link:${zugang.kennung}`, ...requestMeta(request) },
            });
        },
    );

    // Der Schlüssel: der Vertrag nach außen.

    const prueft = new WeakMap<FastifyRequest, GeprueftZugang>();
    const apiTuer = async (request: FastifyRequest): Promise<void> => {
        umgebung();
        const wert = bearer(request.headers.authorization);
        const zugang = istKartenSchluessel(wert)
            ? await sicherLesen(() => pruefeZugang(app.database!, wert, "schluessel"))
            : null;
        // Fehlt oder falsch: mit Absicht nicht zu unterscheiden.
        if (zugang === null) throw new ApiError(401, "unauthorized", "Dieser Schlüssel gilt hier nicht.");
        prueft.set(request, zugang);
        await merkeNutzung(app.database!, zugang.id);
    };
    const api = { config: { auth: "karten_zugang" as const, errorEnvelope: true as const }, preValidation: apiTuer };
    const apiZugang = (request: FastifyRequest): GeprueftZugang => prueft.get(request)!;

    async function apiPaket(
        request: FastifyRequest,
        reply: FastifyReply,
        ids: readonly string[],
    ): Promise<FastifyReply> {
        const zugang = apiZugang(request);
        const fremd = ids.filter((id) => !zugang.karten.includes(id));
        if (fremd.length > 0) {
            throw new ApiError(403, "not_in_scope", `Dieser Schlüssel gilt nicht für: ${fremd.join(", ")}.`);
        }
        const vorrat = await bestand();
        const paket = await baueKartenPaket(waehle(vorrat, ids), vorrat.lizenz);
        return liefere(request, reply, {
            lieferung: alsZip(paket),
            weg: "schluessel",
            zugang,
            personId: null,
            ereignis: {
                actorKind: "system",
                actorLabel: `karten-schluessel:${zugang.kennung}`,
                ...requestMeta(request),
            },
        });
    }

    app.get(
        KARTEN_API_URL,
        { ...api, schema: { response: { 200: KartenApiListe, ...FEHLER } } },
        async (request, reply) => {
            void reply.header("cache-control", "no-store");
            const zugang = apiZugang(request);
            const { dateien } = await bestand();
            return {
                vertrag: KARTEN_VERTRAG_FASSUNG as typeof KARTEN_VERTRAG_FASSUNG,
                jetzt: new Date().toISOString(),
                laeuftAb: zugang.laeuftAb.toISOString(),
                karten: dateien.filter((d) => zugang.karten.includes(d.eintrag.id)).map((d) => d.eintrag),
            };
        },
    );

    // Die Vektorkarte ohne ZIP: Nachfolger von Legacys `api/svg-export.php` für die Terrain-Pipeline (Vali 2026-11-05). Ohne Weiterleitung, ohne Tür;
    // der Schlüssel braucht `svg-roh` bzw. `svg-glatt` in seinem Umfang.
    app.get(
        KARTEN_SVG_EXPORT_URL,
        { ...api, schema: { querystring: SvgQuery, response: { ...FEHLER, 404: SvgFehlt } } },
        async (request, reply) => {
            const variante = svgVariante(request.query.smooth);
            const id = variante === "glatt" ? KARTEN_SVG_GLATT : KARTEN_SVG_ROH;
            const zugang = apiZugang(request);
            if (!zugang.karten.includes(id)) {
                throw new ApiError(403, "not_in_scope", `Dieser Schlüssel gilt nicht für: ${id}.`);
            }
            const datei = (await bestand()).dateien.find((d) => d.eintrag.id === id);
            const lieferung = datei === undefined ? null : await alsSvg(datei, variante);
            if (lieferung === null) {
                // 💣 Nie ersatzweise die andere Fassung (Legacy): Wer Kurven bestellt und Ecken bekommt, rendert falsche Kanten und sucht den Fehler bei sich.
                const glatt = variante === "glatt";
                return reply
                    .code(404)
                    .header("cache-control", "no-store")
                    .send({
                        error: glatt ? "smooth_export_not_available" : "export_not_available",
                        message: glatt
                            ? "Es liegt noch kein geglätteter Abzug bereit. Ohne ?smooth=1 gibt es die rohe Fassung."
                            : "Es liegt noch kein Abzug bereit. Der tägliche Lauf erzeugt ihn.",
                    });
            }
            return liefere(request, reply, {
                lieferung,
                weg: "schluessel",
                zugang,
                personId: null,
                ereignis: {
                    actorKind: "system",
                    actorLabel: `karten-schluessel:${zugang.kennung}`,
                    ...requestMeta(request),
                },
            });
        },
    );

    app.get(
        `${KARTEN_API_URL}/paket.zip`,
        { ...api, schema: { querystring: IdsQuery, response: { ...FEHLER } } },
        (request, reply) => apiPaket(request, reply, idsAus(request.query.ids)) as never,
    );

    app.get(
        `${KARTEN_API_URL}/:datei`,
        { ...api, schema: { params: DateiParam, response: { ...FEHLER } } },
        (request, reply) => {
            const treffer = /^(.+)\.zip$/u.exec(request.params.datei);
            if (treffer === null || !ID.test(treffer[1]!)) throw nichtDa([request.params.datei]);
            return apiPaket(request, reply, [treffer[1]!]) as never;
        },
    );
};
