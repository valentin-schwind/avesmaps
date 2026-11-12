import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    ApiErrorBody,
    ApiZahlen,
    BESUCH_SCHNITTSTELLEN_URL,
    BESUCH_GRENZEN,
    BESUCH_SCHALTER,
    BESUCH_PING_URL,
    BESUCH_URL,
    BESUCH_ZAHLEN_URL,
    BESUCH_EDITOREN_URL,
    BesuchEditoren,
    BesuchMeldung,
    BesuchPing,
    BesuchZahlen,
    type BesuchSorte,
} from "@avesmaps3d/shared";
import { protect } from "../auth/plugin.ts";
import { apiErrorBody } from "../http/api-error.ts";
import { HaeufungsWaechter, imRechenzentrum, type AutomatGrund } from "../besucher/automaten.ts";
import { kopfKennung, langKennung, tagesKennung } from "../besucher/kennung.ts";
import { leseApiZahlen } from "../besucher/api-lesen.ts";
import { speichereDiagnosen } from "../besucher/diagnosen.ts";
import { leseEditoren } from "../besucher/editoren.ts";
import { leseZahlen } from "../besucher/lesen.ts";
import {
    browserArt,
    geoTreffer,
    istBot,
    KEINE_STUNDE,
    lebenszeichen,
    METRIK_AUTOMAT_GRUND,
    zaehle,
    zaehleEindeutig,
    zeilenAus,
    zeilenJePerson,
    type Zeile,
    type ZaehlSorte,
} from "../besucher/zaehler.ts";
import { istAus } from "../system/inhaltsstand.ts";
import { isSameOrigin } from "./share.ts";

/**
 * Die anonyme Besucherstatistik (WI-0138, BESUCH-0001).
 *
 *     POST /api/besuch         Ereignisse eines Besuchs      öffentlich, immer 204
 *     POST /api/besuch/ping    Lebenszeichen alle 60 s       öffentlich, immer 204
 *     GET  /api/besuch/zahlen  Die Zahlen des Panels         use_editor_menu
 *
 * 🔴 **Die Zählung darf die Karte nie stören.** Beide Schreibwege antworten immer 204, auch wenn die Datenbank fehlt, der Körper
 * nicht passt oder die Drossel greift. Ein Zählfehler ist kein Fehler des Besuchs.
 *
 * 🔴 **Keine IP wird abgelegt.** `request.ip` geht in den Geo-Treffer (Ergebnis: zwei Zeichenketten) und in die Tageskennung
 * (16 Byte, verfällt um Mitternacht). Sonst nirgends hin — auch nicht ins Protokoll.
 *
 * 🪤 `request.ip` stimmt nur, weil die App allein dem Proxy auf derselben Maschine traut (`trustProxy: "loopback"`, app.ts).
 */

/**
 * Die Drossel lebt im Speicher des Prozesses: ein Zähler je Minute, und zwar **je Adresse**.
 *
 * 🪤 Erst hing sie an der Tageskennung — die steckt den User-Agent mit ein, und den setzt der Client. Wer ihn je Anfrage ändert,
 * bekommt jedes Mal einen neuen Zähler (Befund der Sicherheitsprüfung 2026-10-13). Die Adresse kann er nicht wechseln.
 * Gespeichert wird sie nicht: der Schlüssel ist ein kurzer Hash, und abgelaufene Einträge fallen einzeln heraus, statt dass die
 * ganze Tafel geleert wird (sonst wäre das Leeren selbst der Umweg um die Drossel).
 */
const drossel = new Map<string, { minute: number; anzahl: number }>();

function drosselSchluessel(ip: string): string {
    return createHash("sha256").update(ip).digest("base64").slice(0, 16);
}

function darfZaehlen(schluessel: string, jetzt = Date.now()): boolean {
    const minute = Math.floor(jetzt / 60_000);
    if (drossel.size > 5000) {
        for (const [eintrag, stand] of drossel) if (stand.minute < minute) drossel.delete(eintrag);
    }
    const stand = drossel.get(schluessel);
    if (!stand || stand.minute !== minute) {
        drossel.set(schluessel, { minute, anzahl: 1 });
        return true;
    }
    stand.anzahl += 1;
    return stand.anzahl <= BESUCH_GRENZEN.proMinute;
}

export const besuchRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const salt = app.config.besucher?.salt;
    /** Häufung neuer Personen je Netz (OPS-000118); lebt im Speicher dieses Prozesses, je App einer. */
    const haeufung = new HaeufungsWaechter();

    /**
     * Wer zählt: ein Angemeldeter als Person, jeder andere als Gerät (`kopfKennung`, `tagesKennung`). Daran hängen „Köpfe je Tag“,
     * „Dazu im Editor“ und die Verweildauer der Editoren; jedes Gerät einer Person als eigener Kopf ergab auf der Stage elf Köpfe bei
     * zwei Personen (2026-11-11).
     */
    const besuchsKennung = (
        sitzung: { personId: string } | undefined,
        ip: string,
        userAgent: string,
    ): Buffer | undefined =>
        sitzung !== undefined ? kopfKennung(salt, sitzung.personId) : tagesKennung(salt, ip, userAgent);

    /**
     * Der Schalter „Besucherzählung“ (SYS-10, `visits.count`; BESUCH-0001 §4.7): Steht er auf aus, tut die Seite dasselbe und
     * wird nur nicht gezählt. Gelesen wird der Stand aus dem Speicher der Anwendung, nicht je Meldung aus der Datenbank.
     */
    const zaehlungAus = async (): Promise<boolean> => {
        const store = app.inhaltsschalter;
        return store !== undefined && istAus(await store.read(), BESUCH_SCHALTER);
    };

    app.post(
        BESUCH_URL,
        {
            config: { auth: "public", writeClass: "public" },
            bodyLimit: BESUCH_GRENZEN.bodyBytes,
            schema: { body: BesuchMeldung, response: { 204: Type.Null() } },
            onRequest: async (request, reply) => {
                void reply.header("cache-control", "no-store");
                // Nur von der eigenen Seite: eine fremde Seite soll unsere Zahlen nicht füllen können.
                if (!isSameOrigin(request.headers.origin, request.headers.host)) return reply.code(204).send(null);
            },
            // Ein unpassender Körper ist kein Fehler des Besuchs: still annehmen, nichts zählen.
            attachValidation: true,
        },
        async (request, reply) => {
            void reply.code(204).send(null);
            if (request.validationError || !app.database) return;
            if (await zaehlungAus()) return;
            const sql = app.database;
            const userAgent = String(request.headers["user-agent"] ?? "");
            const sitzung = await request.auth.session();
            const kennung = besuchsKennung(sitzung, request.ip, userAgent);
            if (!darfZaehlen(drosselSchluessel(request.ip))) return;
            // 🔴 Ein Automat ist, wer sich so nennt, aus einem Rechenzentrum kommt oder aus einem Netz, aus dem gerade auffällig viele neue
            // Personen kommen (OPS-000118, `automaten.ts`). Land und Dauer entscheiden nie; Angemeldete sind nie Automaten.
            const grund: AutomatGrund | undefined =
                sitzung !== undefined
                    ? undefined
                    : istBot(userAgent)
                      ? "useragent"
                      : imRechenzentrum(request.ip)
                        ? "rechenzentrum"
                        : kennung !== undefined && haeufung.auffaellig(request.ip, kennung.toString("hex"))
                          ? "haeufung"
                          : undefined;
            const sorte: BesuchSorte = sitzung !== undefined ? "editor" : grund !== undefined ? "bot" : "visitor";

            // Eine Meldung, die nur Diagnosen trägt (WI-0202), zählt nichts: Gerät, Sprache und Herkunft hat derselbe Besuch
            // schon gemeldet, und sie sollen nicht mit der Zahl der Fehler wachsen.
            if (request.body.ereignisse.length > 0) {
                try {
                    const ereignisZeilen = zeilenAus(request.body);
                    // 🔴 Die Herkunft zählt jede Person einmal am Tag, nicht jede Meldung (Betreiber 2026-11-03: „zähl richtig“): Wer
                    // viel klickt, schickt viele Meldungen, und sein Bundesland stand sonst stärker da als eines mit mehr Besuchern.
                    // Gerät, System, Browser, Einstieg und Browsersprache ebenso (WI-0286, `zeilenJePerson`). Ohne `VISITOR_SALT`
                    // gibt es keine Tageskennung und darum auch diese Zahlen nicht.
                    const zaehleIn = async (ziel: ZaehlSorte, zielKennung: Buffer | undefined): Promise<void> => {
                        const zeilen: Zeile[] = [...ereignisZeilen];
                        if (await zaehleEindeutig(sql, zielKennung, ziel)) {
                            zeilen.push(
                                ...zeilenJePerson(request.body, {
                                    userAgent,
                                    eigenerHost: request.headers.host,
                                    sprache: request.headers["accept-language"] as string | undefined,
                                }),
                            );
                            const geo = await geoTreffer(sql, request.ip);
                            if (geo.land !== "")
                                zeilen.push({ metrik: "land", dimension: geo.land, stunde: KEINE_STUNDE });
                            if (geo.region !== "")
                                zeilen.push({ metrik: "region", dimension: geo.region, stunde: KEINE_STUNDE });
                        }
                        // Ein Automat trägt seinen Grund mit (OPS-000118), damit „ausgeschlossen“ sagen kann, warum.
                        if (ziel === "bot" && ereignisZeilen.some((zeile) => zeile.metrik === "pageview")) {
                            zeilen.push({
                                metrik: METRIK_AUTOMAT_GRUND,
                                dimension: grund ?? "useragent",
                                stunde: KEINE_STUNDE,
                            });
                        }
                        await zaehle(sql, ziel, zeilen);
                    };
                    // 🔴 Besuche unter 10 s ausblendbar (OPS-000118): Ein Besuch, der nach zehn Sekunden noch offen ist, zählt ein zweites
                    // Mal in `visitor_lang`. Der Nachtrag trägt alles bis dahin und zählt NUR dort, jede spätere Meldung in beiden.
                    const bestaetigt = request.body.bestaetigt;
                    if (bestaetigt !== "nachtrag") await zaehleIn(sorte, kennung);
                    if (sorte === "visitor" && bestaetigt !== undefined) {
                        await zaehleIn("visitor_lang", kennung === undefined ? undefined : langKennung(kennung));
                    }
                } catch (fehler) {
                    request.log.debug({ err: fehler }, "Besuch nicht gezählt");
                }
            }

            // Diagnosen zu Fehlern im Browser (WI-0202): bereinigt, ohne Sorte, Kennung oder Adresse; Automaten liefern keine.
            const diagnosen = request.body.fehler;
            if (diagnosen === undefined || diagnosen.length === 0 || sorte === "bot") return;
            try {
                await speichereDiagnosen(sql, diagnosen, {
                    release: app.config.releaseId,
                    browser: browserArt(userAgent),
                });
            } catch (fehler) {
                // Nicht still (Review L3-05): Ein Fehler hier heißt meist, dass Migration 0148 fehlt.
                request.log.warn({ err: fehler }, "Diagnose aus dem Browser nicht gespeichert");
            }
        },
    );

    app.post(
        BESUCH_PING_URL,
        {
            config: { auth: "public", writeClass: "public" },
            bodyLimit: 256,
            schema: { body: BesuchPing, response: { 204: Type.Null() } },
            onRequest: async (request, reply) => {
                void reply.header("cache-control", "no-store");
                if (!isSameOrigin(request.headers.origin, request.headers.host)) return reply.code(204).send(null);
            },
            attachValidation: true,
        },
        async (request, reply) => {
            void reply.code(204).send(null);
            if (request.validationError || !app.database) return;
            if (await zaehlungAus()) return;
            const userAgent = String(request.headers["user-agent"] ?? "");
            const sitzung = await request.auth.session();
            // Ein Automat ist nie anwesend (OPS-000118): dieselben Gründe wie beim Zählen, ohne die Häufung weiterzuzählen.
            if (
                sitzung === undefined &&
                (istBot(userAgent) || imRechenzentrum(request.ip) || haeufung.istAuffaellig(request.ip))
            ) {
                return;
            }
            const kennung = besuchsKennung(sitzung, request.ip, userAgent);
            if (!kennung || !darfZaehlen(drosselSchluessel(request.ip))) return;
            await lebenszeichen(
                app.database,
                kennung,
                sitzung === undefined ? "visitor" : "editor",
                request.body.zustand,
            );
            // Woran jemand gerade sitzt (WI-0141b): nur für Angemeldete, an der Sitzung, überschrieben statt angehängt.
            // Das Schema hat die Kennung schon gegen die Positivliste geprüft; ein fremder Wert käme hier nie an.
            if (sitzung !== undefined && request.body.ansicht !== undefined) {
                await app.database`UPDATE avesmaps_auth.session SET view_key = ${request.body.ansicht} WHERE id = ${sitzung.id}::uuid`.catch(
                    () => undefined,
                );
            }
        },
    );

    /**
     * 🪤 Hier stand `503: Type.Null()`, und `reply.code(503).send(null)` passte dazu. Beide Lesewege hängen aber an `protect`,
     * und das setzt `errorEnvelope` (ADR-0018): Der Fehlerhandler sendet den Datenbankausfall dann als Umschlag
     * `{ error: { code: "database_unavailable", message } }`. Gegen `null` scheiterte dessen Serialisierung, und aus dem 503
     * wurde ein 500 (Wächter `route-error-shapes.test.ts`). Route und Handler sprechen jetzt dieselbe Form.
     */
    const DATENBANK_WEG = apiErrorBody("database_unavailable", "Die Datenbank ist gerade nicht erreichbar.");

    app.get(
        BESUCH_ZAHLEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: Type.Object({
                    sorte: Type.Optional(
                        Type.Union([Type.Literal("visitor"), Type.Literal("editor"), Type.Literal("bot")]),
                    ),
                    tage: Type.Optional(Type.Integer({ minimum: 1, maximum: 3660 })),
                    /** Besuche unter 10 s ausblenden (OPS-000118). */
                    ohneKurz: Type.Optional(Type.Boolean()),
                }),
                response: { 200: BesuchZahlen, 503: ApiErrorBody },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            if (!app.database) return reply.code(503).send(DATENBANK_WEG);
            return leseZahlen(app.database, request.query.sorte ?? "visitor", request.query.tage ?? 30, Boolean(salt), {
                ohneKurz: request.query.ohneKurz === true,
            });
        },
    );

    /**
     * Wer im Editor ist (WI-0141b). Dieselbe Tür wie die Zahlen: `use_editor_menu` — es ist eine Anwesenheitsliste für
     * die Kollegschaft, keine Personenverwaltung (die steht hinter `manage_people`).
     */
    app.get(
        BESUCH_EDITOREN_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: BesuchEditoren } } },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            const sitzung = await request.auth.session();
            if (!app.database || sitzung === undefined) return { editoren: [], fensterMinuten: 5 };
            return await leseEditoren(app.database, sitzung.environment);
        },
    );

    app.get(
        BESUCH_SCHNITTSTELLEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: Type.Object({ tage: Type.Optional(Type.Integer({ minimum: 1, maximum: 3660 })) }),
                response: { 200: ApiZahlen, 503: ApiErrorBody },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            if (!app.database) return reply.code(503).send(DATENBANK_WEG);
            return leseApiZahlen(app.database, request.query.tage ?? 30);
        },
    );
};
