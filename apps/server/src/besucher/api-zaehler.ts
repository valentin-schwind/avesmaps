import type { FastifyInstance, FastifyRequest } from "fastify";
import {
    API_ABSENDER,
    API_AUFBEWAHRUNG_TAGE,
    API_VIELFALT_JE_TAG,
    absenderAusKennung,
    apiKlasse,
    apiZone,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { KEINE_STUNDE } from "./zaehler.ts";
import { herkunftAus, legacyPfad } from "./api-herkunft.ts";

/**
 * Die Nutzung der eigenen Schnittstellen zählen (WI-0138 V12).
 *
 * 🔴 **Gezählt wird der Routenname, nie die Adresse.** `request.routeOptions.url` ist das Muster (`/api/share/:code`), also
 * ohne Code, ohne Suchbegriff, ohne Kennung. Mit der Adresse wüchse die Tafel mit dem Verkehr statt mit der Zahl der Wege.
 *
 * 🔴 **Der Zähler hängt am Ende der Anfrage und wirft nie.** Er läuft in `onResponse`, nachdem die Antwort beim Client ist;
 * ein Fehler hier kostet höchstens eine Zeile Statistik.
 *
 * 🪤 Eine Anfrage ohne gefundene Route (404 auf nichts) zählt als `unbekannt`, nicht mit ihrem rohen Pfad: Sonst legte jeder
 * Scanner im Netz neue Zeilen an.
 *
 * **Der Grund einer Ablehnung** (Vali 2026-11-10: „kann man da nochmal den fokus drauflegen, dass sowas nicht wieder passiert“): Eine
 * schlechte Antwort zählt mit ihrem Kürzel, `details.reason` vor `error.code` (`grundAusAntwort`), etwa
 * `/api/editor/landscapes/:id|nachbar_umgezeichnet`. Unter Systemsteuerung › Status › API steht er in der Fehlerliste neben dem Weg. So
 * fällt eine neue Ablehnung beim Speichern auf, bevor ein Editor sie meldet. Bis 2026-11-10 kam hier nur die Statusklasse an.
 *
 * **Wer fragt** (WI-0307, Vali 2026-11-10: „Wird die API noch von Dritten benutzt?“): Je Anfrage zählt `herkunft` (`eigene_seite`,
 * `fremde_seite`, `ohne_seite`, `api-herkunft.ts`), dazu `weg_herkunft` als `<weg>|<herkunft>`, bei einer fremden Seite `fremde_seite` mit
 * ihrem Hostnamen und bei jeder Anfrage von außen `absender` (`absenderAusKennung`). Die alten Legacy-Pfade heißen mit Namen statt
 * `unbekannt` und zählen zusätzlich als `legacy`. Ohne Takt (er ist kein Fragen, wie im Ring der Zonen) und ohne die Anmeldetür der Stage:
 * Nginx fragt `/api/auth/gate` für jede Anfrage, auch für jede Kachel, mit deren Kopfzeilen; sie zählte jede Frage ein zweites Mal.
 *
 * 🪤 **Ohne die Proben der eigenen Maschine** (Stage-Probe 2026-11-11: 24 × `node` auf `/api/route`, dazu `/health/*`): Postflight und
 * Gesundheitsproben kommen von 127.0.0.1, ohne Seite, und stünden sonst als „Route von Dritten“ da. `request.ip` ist hinter Nginx der
 * echte Client (`trustProxy: "loopback"`); eine Rechneradresse heißt also: von dieser Maschine. Die Adresse wird nur verglichen, nie gezählt.
 * Dazu die öffentlichen Adressen der Maschine aus `API_ZAEHLER_EIGENE_ADRESSEN` (Claudio 2026-11-11: die Statusprobe
 * `avesmaps3d-system-status.sh` fragt alle 5 Minuten über `https://avesmaps.de`, also über die öffentliche Adresse, rund 288 × `curl` je Tag).
 * Der Wert steht in der `.env` der Umgebung, nie im Code.
 */

/** Die Unteranfrage der Anmeldetür (Stage, `staging-deploy.sh` `/_anmeldetuer`): kein eigener Aufruf, nur ein Echo der Hauptanfrage. */
const ANMELDETUER = "/api/auth/gate";

/** Die Kopfzeilen, die „Wer fragt“ liest. Alles andere bleibt beim Server. */
export interface AnfrageKopf {
    methode?: string | undefined;
    /** Der Pfad ohne Abfrage; nur für den Abgleich mit den alten Legacy-Pfaden, nie gezählt. */
    pfad?: string | undefined;
    origin?: string | undefined;
    referer?: string | undefined;
    secFetchSite?: string | undefined;
    userAgent?: string | undefined;
    /** Kam die Anfrage von dieser Maschine selbst (Postflight, Gesundheitsproben)? Dann zählt sie nicht bei „Wer fragt“. */
    vonDieserMaschine?: boolean | undefined;
}

/** Eine Adresse zum Vergleichen: klein geschrieben, eine IPv4 in IPv6-Schreibweise (`::ffff:1.2.3.4`) als IPv4. */
export const vergleichsAdresse = (ip: string): string =>
    ip
        .trim()
        .toLowerCase()
        .replace(/^::ffff:(?=\d+\.)/, "");

/** Ist `request.ip` diese Maschine: die Rechneradresse oder eine ihrer öffentlichen Adressen aus der Einstellung? */
function istDieseMaschine(ip: string, eigene: ReadonlySet<string>): boolean {
    const adresse = vergleichsAdresse(ip);
    return adresse === "::1" || adresse.startsWith("127.") || eigene.has(adresse);
}

/** Was ein Grund sein darf: ein Kürzel, nie ein Satz, nie Geometrie oder Personendaten (wie `grundDerAblehnung`). */
const KUERZEL = /^[\w:./-]{1,60}$/;

/** Der Grund aus unserer Fehlerform (`{ error: { code, details: { reason } } }`, auch die ältere `{ error: "…" }`); sonst keiner. */
export function grundAusAntwort(payload: unknown): string | undefined {
    if (typeof payload !== "string" || !payload.startsWith('{"error":')) return undefined;
    try {
        const fehler = (JSON.parse(payload) as { error?: unknown }).error;
        const kandidat =
            typeof fehler === "string"
                ? fehler
                : typeof fehler === "object" && fehler !== null
                  ? ((fehler as { details?: { reason?: unknown } }).details?.reason ??
                    (fehler as { code?: unknown }).code)
                  : undefined;
        return typeof kandidat === "string" && KUERZEL.test(kandidat) ? kandidat : undefined;
    } catch {
        return undefined;
    }
}

/** Der Grund je Anfrage, vom Senden bis zum Zählen; danach vergessen. */
const gruende = new WeakMap<object, string>();

export interface Posten {
    hour: number;
    metric: string;
    dimension: string;
    count: number;
}

/** Gesammelt im Prozess, einmal je Takt geschrieben: ein Einfügen je Anfrage wäre auf dem heißen Pfad zu teuer. */
const offen = new Map<string, Posten>();

/** Metriken mit frei wählbaren Namen: je Tag höchstens `API_VIELFALT_JE_TAG` verschiedene, darüber `andere`. */
const BEGRENZT = new Set(["absender", "fremde_seite"]);

/**
 * Welche Namen heute schon da sind, je begrenzter Metrik. 🪤 Je Prozess: Nach einem Neustart am selben Tag können höchstens weitere 50
 * dazukommen. Beschränkt bleibt die Tafel trotzdem, und dafür ist die Grenze da.
 */
const vielfalt = { tag: "", namen: new Map<string, Set<string>>() };

function begrenzt(metric: string, dimension: string): string {
    if (!BEGRENZT.has(metric)) return dimension;
    const heute = new Date().toISOString().slice(0, 10);
    if (vielfalt.tag !== heute) {
        vielfalt.tag = heute;
        vielfalt.namen.clear();
    }
    let namen = vielfalt.namen.get(metric);
    if (namen === undefined) {
        namen = new Set();
        vielfalt.namen.set(metric, namen);
    }
    if (namen.has(dimension)) return dimension;
    if (namen.size >= API_VIELFALT_JE_TAG) return API_ABSENDER.andere;
    namen.add(dimension);
    return dimension;
}

/** Posten in den Prozesspuffer legen; gleiche Schlüssel zählen hoch. Der Hook benutzt sie, Tests auch. */
export function merkePosten(posten: readonly Posten[]): void {
    for (const eintrag of posten) {
        const dimension = begrenzt(eintrag.metric, eintrag.dimension);
        const schluessel = `${eintrag.hour}|${eintrag.metric}|${dimension}`;
        const vorhanden = offen.get(schluessel);
        if (vorhanden) vorhanden.count += eintrag.count;
        else offen.set(schluessel, { ...eintrag, dimension });
    }
}

/**
 * Was eine abgeschlossene Anfrage ergibt. Rein, damit ein Test sie ohne Server prüft. Ohne `kopf` (ältere Aufrufer, Tests) fehlen nur
 * die Posten von „Wer fragt“.
 */
export function postenFuer(
    weg: string | undefined,
    status: number | undefined,
    stunde: number,
    fehlerCode?: string | undefined,
    kopf?: AnfrageKopf,
): Posten[] {
    const alt = kopf?.pfad === undefined ? undefined : legacyPfad(kopf.methode, kopf.pfad);
    const name = alt?.weg ?? (weg && weg.startsWith("/") ? weg.slice(0, 190) : "unbekannt");
    // Ein alter Legacy-Pfad ist keine unserer Zonen, auch wenn er mit `/api/` beginnt.
    const zone = alt === undefined ? apiZone(name) : "uebrige";
    const klasse = apiKlasse(status);
    const posten: Posten[] = [
        { hour: KEINE_STUNDE, metric: "anfrage", dimension: name, count: 1 },
        { hour: KEINE_STUNDE, metric: "klasse", dimension: klasse, count: 1 },
        { hour: KEINE_STUNDE, metric: "zone", dimension: zone, count: 1 },
        { hour: stunde, metric: "stunde", dimension: "", count: 1 },
    ];
    if (klasse === "4xx" || klasse === "5xx" || klasse === "gestorben") {
        posten.push({
            hour: KEINE_STUNDE,
            metric: "fehler",
            // Die Spalte fasst 190 Zeichen; eine längere Zeile ließe den ganzen Takt scheitern.
            dimension: `${name}|${(fehlerCode ?? klasse).slice(0, 60)}`.slice(0, 190),
            count: 1,
        });
    }
    if (alt !== undefined) posten.push({ hour: KEINE_STUNDE, metric: "legacy", dimension: alt.pfad, count: 1 });
    if (kopf !== undefined && kopf.vonDieserMaschine !== true && zone !== "takt" && name !== ANMELDETUER) {
        const { herkunft, seite } = herkunftAus(kopf.origin, kopf.referer, kopf.secFetchSite);
        posten.push(
            { hour: KEINE_STUNDE, metric: "herkunft", dimension: herkunft, count: 1 },
            // Längster Name 12 Zeichen plus Trenner: 170 für den Weg lassen die Zeile unter 190.
            { hour: KEINE_STUNDE, metric: "weg_herkunft", dimension: `${name.slice(0, 170)}|${herkunft}`, count: 1 },
        );
        if (seite !== undefined)
            posten.push({ hour: KEINE_STUNDE, metric: "fremde_seite", dimension: seite, count: 1 });
        if (herkunft !== "eigene_seite") {
            posten.push({
                hour: KEINE_STUNDE,
                metric: "absender",
                dimension: absenderAusKennung(kopf.userAgent),
                count: 1,
            });
        }
    }
    return posten;
}

/** Die Kopfzeilen einer Anfrage für `postenFuer`; eine doppelte Kopfzeile zählt mit ihrem ersten Wert. */
function kopfAus(request: FastifyRequest, eigene: ReadonlySet<string>): AnfrageKopf {
    const erster = (wert: string | string[] | undefined): string | undefined => (Array.isArray(wert) ? wert[0] : wert);
    return {
        methode: request.method,
        pfad: request.url.split("?", 1)[0],
        origin: erster(request.headers.origin),
        referer: erster(request.headers.referer),
        secFetchSite: erster(request.headers["sec-fetch-site"]),
        userAgent: erster(request.headers["user-agent"]),
        vonDieserMaschine: istDieseMaschine(request.ip, eigene),
    };
}

/**
 * Hängt den Zähler an den Server. Ohne Datenbank passiert nichts. `eigeneAdressen`: die öffentlichen Adressen dieser Maschine
 * (`API_ZAEHLER_EIGENE_ADRESSEN`, `config.ts`); ihre Anfragen zählen nicht bei „Wer fragt“.
 */
export function zaehleSchnittstellen(app: FastifyInstance, eigeneAdressen: readonly string[] = []): void {
    const eigene = new Set(eigeneAdressen.map(vergleichsAdresse));
    // Der Grund steht in der Antwort, nicht in der Route: Unsere Fehlerform trägt ihn (`error-handler.ts`). Gelesen wird nur eine
    // schlechte Antwort, und nur ihr Kürzel bleibt bis zum Zählen.
    app.addHook("onSend", async (request, reply, payload) => {
        try {
            if (reply.statusCode >= 400) {
                const grund = grundAusAntwort(payload);
                if (grund !== undefined) gruende.set(request, grund);
            }
        } catch {
            /* Die Zählung ist nie der Grund, warum eine Anfrage scheitert. */
        }
        return payload;
    });
    app.addHook("onResponse", async (request, reply) => {
        try {
            const stunde = new Date().getUTCHours();
            // Fehlt der Grund, genügt die Statusklasse.
            merkePosten(
                postenFuer(
                    request.routeOptions.url,
                    reply.raw.statusCode,
                    stunde,
                    gruende.get(request),
                    kopfAus(request, eigene),
                ),
            );
        } catch {
            /* Die Zählung ist nie der Grund, warum eine Anfrage scheitert. */
        }
    });
}

/** Schreibt, was sich seit dem letzten Takt angesammelt hat. Gibt die Zahl der geschriebenen Zeilen zurück. */
export async function schreibeSchnittstellen(sql: Queryable): Promise<number> {
    if (offen.size === 0) return 0;
    const werte = [...offen.values()];
    offen.clear();
    try {
        await sql`
            INSERT INTO api_metric (day, hour, metric, dimension, count)
            SELECT CURRENT_DATE, zeile.hour, zeile.metric, zeile.dimension, zeile.count
            FROM json_to_recordset(${JSON.stringify(werte)}::text::json)
                AS zeile(hour smallint, metric text, dimension text, count bigint)
            ON CONFLICT (day, hour, metric, dimension)
            DO UPDATE SET count = api_metric.count + EXCLUDED.count
        `;
        return werte.length;
    } catch {
        return 0;
    }
}

/**
 * Verdichten: Was älter ist als die Aufbewahrung, wird auf den Monatsersten zusammengezogen und verliert seine Stunde.
 * Die Summe bleibt richtig, die Zeilenzahl beschränkt (Legacys Regel, `api-metrics.php:510-531`).
 */
export async function verdichteSchnittstellen(sql: Queryable, tage = API_AUFBEWAHRUNG_TAGE): Promise<number> {
    const zeilen = await sql`
        WITH alt AS (
            DELETE FROM api_metric WHERE day < CURRENT_DATE - ${tage}::int
            RETURNING date_trunc('month', day)::date AS monat, metric, dimension, count
        )
        INSERT INTO api_metric (day, hour, metric, dimension, count)
        SELECT monat, ${KEINE_STUNDE}, metric, dimension, SUM(count) FROM alt
        GROUP BY monat, metric, dimension
        ON CONFLICT (day, hour, metric, dimension) DO UPDATE SET count = api_metric.count + EXCLUDED.count
        RETURNING day
    `;
    return zeilen.length;
}

/** Nur für Tests: den Prozesspuffer leeren. */
export function vergissOffene(): void {
    offen.clear();
    vielfalt.tag = "";
    vielfalt.namen.clear();
}
