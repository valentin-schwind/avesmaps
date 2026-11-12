import {
    BESUCH_GRENZEN,
    BESUCH_METRIKEN_MIT_STUNDE,
    BESUCH_NAME_FORM,
    CLIENT_FEHLER_ARTEN,
    fensterKlasse,
    MAX_BAND,
    WETTER_DIMENSION_FORM,
    WETTER_METRIKEN,
    type BesuchMeldung,
    type BesuchMetrik,
    type BesuchSorte,
    type BesuchZustand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Zählpfad (WI-0138, BESUCH-0001 §6). Er schreibt ausschließlich Summen.
 *
 * - **Keine Zeile je Besuch.** `visitor_metric` wird hochgezählt; aus ihr lässt sich kein einzelner Besuch rekonstruieren.
 * - **Die Stunde ist nie NULL** (Platzhalter 24). In Legacy war sie es, und `ON DUPLICATE KEY` griff für dreizehn von fünfzehn
 *   Metriken nie: 449.715 Zeilen statt einiger tausend. `ON CONFLICT` hätte dieselbe Falle.
 * - **Fehler bleiben hier.** Ein Zählfehler darf die Karte nie stören; die Routen antworten immer 204.
 */

/** „Keine Stunde“. Dieselbe Zahl wie in der Migration und bei Legacy (`AVESMAPS_VISITOR_KEINE_STUNDE`). */
export const KEINE_STUNDE = 24;

/** Wie lange eine Anwesenheit ohne Lebenszeichen gilt. Der Takt ist 60 s; zwei verpasste Pings beenden den Lauf. */
export const LIVE_FENSTER_MINUTEN = 5;

/**
 * Wohin gezählt wird: die Sorten des Panels und `visitor_lang`, dieselben Besucher ohne Besuche unter 10 s (OPS-000118, Migration 0340).
 * `visitor_lang` ist keine eigene Sorte im Panel, sondern die gefilterte Sicht der Besucher.
 */
export type ZaehlSorte = BesuchSorte | "visitor_lang";

/**
 * Der Korb der Verweildauer für einen Besuch mit nur einem Lebenszeichen (OPS-000118). Seine Dauer ist nicht gemessen; bis dahin stand
 * er als 0 s im Korb „unter 10 s“ und machte kurze Besuche häufiger, als sie waren.
 */
export const DAUER_OHNE = "ohne";

/** Warum ein Aufruf als Automat zählt (OPS-000118); die Ausprägung nennt den Grund, der Leser zeigt sie unter „ausgeschlossen“. */
export const METRIK_AUTOMAT_GRUND = "automat_grund";

export interface Zeile {
    metrik: string;
    dimension: string;
    stunde: number;
}

/** Alles außerhalb von 0..23 wird zum Platzhalter, nie zu 0: eine stille 0 stünde als Mitternacht in der Tafel. */
export function stundeOder24(stunde: number | undefined): number {
    return stunde === undefined || !Number.isInteger(stunde) || stunde < 0 || stunde > 23 ? KEINE_STUNDE : stunde;
}

/** Die Quellen, die wir beim Namen nennen; verglichen wird die registrierte Domain, nie ein Teilstück. */
const QUELLEN: readonly (readonly [string, string])[] = [
    ["google.com", "Google"],
    ["google.de", "Google"],
    ["bing.com", "Bing"],
    ["duckduckgo.com", "DuckDuckGo"],
    ["ecosia.org", "Ecosia"],
    ["startpage.com", "Startpage"],
    ["yahoo.com", "Yahoo"],
    ["discord.com", "Discord"],
    ["discordapp.com", "Discord"],
    ["facebook.com", "Facebook"],
    ["wiki-aventurica.de", "Wiki-Aventurica"],
];

/**
 * Welche Ausprägung eine Metrik tragen darf (Befund der Sicherheitsprüfung 2026-10-13: ein freier Text aus dem Browser würde zum
 * Schlüssel einer Zeile und könnte die Tafel fluten oder mit Müll füllen).
 *
 * - **leer**: die Metrik steht für sich (`pageview`, `unique`, `tilt` …).
 * - **schluessel**: ein technischer Wert aus unseren eigenen Listen (`political`, `riverSailer`, `toggleRivers:on`).
 * - **name**: ein Name aus dem Kartenbestand (Ort, Route). Er kommt aus unserer eigenen Suche, trägt aber Buchstaben; das Muster
 *   lässt nur Namensformen zu, und die Verdichtung im Takt hält die Zahl der Zeilen klein.
 *
 * 🪤 **Die Art muss beschreiben, was der Sender wirklich schickt** - sonst fällt die Zeile still weg (WI-0157). Deshalb trägt
 * `place_open` seit WI-0159 **schluessel**: Der Sender meldet `ref.kind` (`place`, `path`, `area`, `territory`, `peak`,
 * `powerline`, `routeStage`, `mapPoint`, `climate`), keinen Namen. Es zählte vorher auch, weil jede dieser Kennungen beide
 * Formen trifft; die Art log nur über den Inhalt.
 * - **fehlerArt**: eine Art aus `CLIENT_FEHLER_ARTEN` (WI-0202), sonst nichts. Strenger als **schluessel**, weil die Liste fest
 *   ist und jeder Eintrag einen Fänger hat.
 * - **nameOderLeer**: wie **name**, aber die leere Ausprägung zählt auch. Nur `route`: Die Kennzahl „Routen geplant“ summiert
 *   alle `route`-Zeilen, und sie darf nicht daran hängen, ob sich „Start → Ziel“ bilden ließ. Hier stand bis WI-0157 **name**,
 *   und weil der Planer `melde("route")` ohne Ausprägung schickt, verwarf `zeilenAus` jede eigene Route still: Vom 13.10.2026
 *   an zählte nur noch Legacys Import, während `route_option` und `transport` desselben Laufs weiterliefen.
 * - **zoomStufe**: eine Zoomstufe als Zahl, 0 bis `MAX_BAND` (WI-0286). Eigene Art, weil **schluessel** einen Buchstaben am Anfang
 *   verlangt und der Leser mit der Zahl rechnet.
 */
const SCHLUESSEL = /^[A-Za-z][A-Za-z0-9 _:.-]{0,39}$/;
const DIMENSIONSART: Record<
    string,
    "leer" | "schluessel" | "name" | "nameOderLeer" | "fehlerArt" | "zoomStufe" | "wetter"
> = {
    pageview: "leer",
    unique: "leer",
    dauer: "schluessel",
    search_empty: "leer",
    tilt: "leer",
    flight: "leer",
    profile: "leer",
    play: "leer",
    share_create: "leer",
    map_mode: "schluessel",
    map_style: "schluessel",
    eco_kind: "schluessel",
    transport: "schluessel",
    route_option: "schluessel",
    display_toggle: "schluessel",
    zoom_band: "schluessel",
    zoom_stufe: "zoomStufe",
    theme: "schluessel",
    sprache_eingestellt: "schluessel",
    geraet: "schluessel",
    system: "schluessel",
    browser: "schluessel",
    fenster: "schluessel",
    faehig: "schluessel",
    sprache: "schluessel",
    einstieg: "name",
    land: "schluessel",
    region: "name",
    search: "name",
    place_open: "schluessel",
    route: "nameOderLeer",
    route_fail: "schluessel",
    route_waypoint: "name",
    client_fehler: "fehlerArt",
    // Das experimentelle Wetter (WI-0288): `rechner` oder `telefon`, bei den Klassen dahinter `:klasse` (`besucher-wetter.ts`).
    ...Object.fromEntries(WETTER_METRIKEN.map((metrik) => [metrik, "wetter" as const])),
};

/** Verwerfen statt kürzen: Ein unbekannter Wert wird nicht abgeschnitten, er zählt gar nicht. */
export function dimensionErlaubt(metrik: string, dimension: string): boolean {
    const art = DIMENSIONSART[metrik];
    if (art === undefined) return false;
    if (art === "leer") return dimension === "";
    if (art === "fehlerArt") return (CLIENT_FEHLER_ARTEN as readonly string[]).includes(dimension);
    if (art === "wetter") return WETTER_DIMENSION_FORM.test(dimension);
    if (art === "zoomStufe") return /^\d$/.test(dimension) && Number(dimension) <= MAX_BAND;
    if (dimension === "") return art === "nameOderLeer";
    return art === "schluessel" ? SCHLUESSEL.test(dimension) : BESUCH_NAME_FORM.test(dimension);
}

/**
 * Der Name der Quelle, aus der ein Besuch kam — nie der Pfad.
 *
 * Suchmaschinen tragen ihren Namen, alles andere den Host ohne `www.`; ohne Herkunft „direkt“. Die eigene Seite erscheint als
 * „intern“, damit sie die Liste nicht anführt (Legacy zählte sich mit 2.286 selbst).
 */
export function einstiegAus(herkunft: string | undefined, eigenerHost: string | undefined): string {
    const roh = (herkunft ?? "").trim();
    if (roh === "") return "direkt";
    let host: string;
    try {
        host = new URL(roh).host.toLowerCase().replace(/^www\./, "");
    } catch {
        return "direkt";
    }
    if (host === "") return "direkt";
    if (eigenerHost && host === eigenerHost.toLowerCase().replace(/^www\./, "")) return "intern";
    // 🪤 Verglichen wird die REGISTRIERTE Domain, nie ein Stück des Hosts: `host.includes("google")` zählte
    // `boese-google.example` als Google, und die Quelle kommt vom Client (Befund der Sicherheitsprüfung 2026-10-13).
    for (const [domain, name] of QUELLEN) {
        if (host === domain || host.endsWith(`.${domain}`)) return name;
    }
    // Ein fremder Host wird nicht roh gespeichert: nur die Form einer Domain, gekürzt, sonst „übrige“.
    return /^[a-z0-9.-]{1,60}$/.test(host) ? host : "übrige";
}

/**
 * Die Sprache des Browsers, auf die erste Marke gekürzt: `de-DE,de;q=0.9` wird zu `de`.
 *
 * 🪤 Steht hier und nicht an der Route, weil der Legacy-Import dieselbe Regel braucht (WI-0151): Ein Werkzeug soll keine
 * Fastify-Route laden, nur um eine Kopfzeile zu kürzen.
 */
export function spracheAus(kopfzeile: string | undefined): string {
    const erste = (kopfzeile ?? "").split(",")[0]?.trim().slice(0, 5) ?? "";
    const marke = erste.split("-")[0]?.toLowerCase() ?? "";
    return /^[a-z]{2}$/.test(marke) ? marke : "ohne";
}

/** Rechner, Telefon, Tablet — die drei Klassen, die Legacy auch kennt. */
export function geraeteArt(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
    if (ua.includes("mobi") || ua.includes("android") || ua.includes("iphone")) return "telefon";
    return "rechner";
}

/** Das Betriebssystem, grob. Eine eigene Zeile, nie mit Browser oder Gerät in derselben (sonst wäre es ein Fingerabdruck). */
export function systemArt(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes("android")) return "Android";
    if (/iphone|ipad|ipod/.test(ua)) return "iOS";
    if (ua.includes("mac os")) return "macOS";
    if (ua.includes("windows")) return "Windows";
    if (ua.includes("linux")) return "Linux";
    return "übrige";
}

/** Der Browser, grob. Reihenfolge trägt: Edge und Chrome nennen sich beide „Chrome“, Safari steckt in jedem iOS-Browser. */
export function browserArt(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes("edg/")) return "Edge";
    if (ua.includes("opr/") || ua.includes("opera")) return "Opera";
    if (ua.includes("firefox") || ua.includes("fxios")) return "Firefox";
    if (ua.includes("chrome") || ua.includes("crios")) return "Chrome";
    if (ua.includes("safari")) return "Safari";
    return "übrige";
}

/**
 * Ist das ein Automat? Dieselbe Liste wie in Legacy (`visitor-analytics.php:845-855`), dazu der leere User-Agent.
 *
 * 🪤 Im Abzug vom 2026-10-12 steht in der ganzen Geo-Tafel bei den Bots 0: Crawler führen kein Skript aus und melden sich nie.
 * Die Sorte bleibt trotzdem, denn der eine Automat, der es doch tut, gehört nicht zu den Besuchern.
 */
export function istBot(userAgent: string): boolean {
    if (userAgent.trim() === "") return true;
    return /bot\b|crawl|spider|slurp|headless|phantom|puppeteer|playwright|python-requests|\bcurl\/|\bwget\b|libwww|scrapy|facebookexternalhit|embedly|whatsapp|telegrambot|discordbot|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|sogou|ia_archiver|googlebot|applebot|duckduckbot|bingbot/i.test(
        userAgent,
    );
}

/** Welche Zeilen eine Meldung ergibt. Rein, ohne Datenbank: so prüft ein Test sie ohne Cluster. */
export function zeilenAus(meldung: BesuchMeldung): Zeile[] {
    const zeilen: Zeile[] = [];
    const stunde = stundeOder24(meldung.stunde);
    for (const ereignis of meldung.ereignisse.slice(0, BESUCH_GRENZEN.ereignisse)) {
        const metrik = ereignis.metrik as BesuchMetrik;
        const dimension = (ereignis.dimension ?? "").trim();
        if (!dimensionErlaubt(metrik, dimension)) continue;
        zeilen.push({
            metrik,
            dimension,
            stunde: BESUCH_METRIKEN_MIT_STUNDE.includes(metrik) ? stunde : KEINE_STUNDE,
        });
    }
    // Was der Browser beim Start einer Seite meldet (`sende(true)`), jedes Merkmal für sich. Was die Person ausmacht, steht in `zeilenJePerson`.
    const fest: Zeile[] = [];
    const geraet = meldung.geraet;
    if (geraet?.breite !== undefined)
        fest.push({ metrik: "fenster", dimension: fensterKlasse(geraet.breite), stunde: KEINE_STUNDE });
    if (geraet?.dreid !== undefined)
        fest.push({ metrik: "faehig", dimension: geraet.dreid ? "3d" : "kein3d", stunde: KEINE_STUNDE });
    if (geraet?.grob === true) fest.push({ metrik: "faehig", dimension: "finger", stunde: KEINE_STUNDE });
    if (geraet?.wenigerBewegung === true)
        fest.push({ metrik: "faehig", dimension: "wenigerBewegung", stunde: KEINE_STUNDE });
    if (geraet?.dunkel === true) fest.push({ metrik: "faehig", dimension: "dunkel", stunde: KEINE_STUNDE });
    return [...fest, ...zeilen];
}

/**
 * Was zu einer Person gehört und nicht zu einem Klick: Gerät, System, Browser, Einstieg und die Sprache des Browsers. Der Aufrufer
 * zählt sie nur bei der ersten Meldung einer Person am Tag (WI-0286; dieselbe Regel wie die Herkunft, Betreiber 2026-11-03: „zähl
 * richtig“). Jede Meldung trug sie vorher mit: Wer viel klickte, zählte öfter, und „Deutsch“ stand bei 270.716 für 34.925 Aufrufe.
 *
 * 🪤 Der Einstieg ist damit der erste des Tages. Kommt dieselbe Person später von woanders, zählt das nicht mehr.
 */
export function zeilenJePerson(
    meldung: BesuchMeldung,
    umgebung: { userAgent: string; eigenerHost: string | undefined; sprache: string | undefined },
): Zeile[] {
    return [
        { metrik: "geraet", dimension: geraeteArt(umgebung.userAgent), stunde: KEINE_STUNDE },
        { metrik: "system", dimension: systemArt(umgebung.userAgent), stunde: KEINE_STUNDE },
        { metrik: "browser", dimension: browserArt(umgebung.userAgent), stunde: KEINE_STUNDE },
        { metrik: "einstieg", dimension: einstiegAus(meldung.herkunft, umgebung.eigenerHost), stunde: KEINE_STUNDE },
        { metrik: "sprache", dimension: spracheAus(umgebung.sprache), stunde: KEINE_STUNDE },
    ];
}

/** Hochzählen. Mehrere Zeilen in einer Anweisung; gleiche Schlüssel werden vorher zusammengefasst (sonst trifft ON CONFLICT zweimal). */
export async function zaehle(
    sql: Queryable,
    sorte: ZaehlSorte,
    zeilen: readonly Zeile[],
    tag?: string,
): Promise<boolean> {
    if (zeilen.length === 0) return false;
    const gebuendelt = new Map<string, { metrik: string; dimension: string; stunde: number; anzahl: number }>();
    for (const zeile of zeilen) {
        const schluessel = `${zeile.stunde}|${zeile.metrik}|${zeile.dimension}`;
        const vorhanden = gebuendelt.get(schluessel);
        if (vorhanden) vorhanden.anzahl += 1;
        else gebuendelt.set(schluessel, { ...zeile, anzahl: 1 });
    }
    const werte = [...gebuendelt.values()].map((zeile) => ({
        day: tag ?? null,
        hour: zeile.stunde,
        actor_type: sorte,
        metric: zeile.metrik.slice(0, 40),
        dimension: zeile.dimension,
        count: zeile.anzahl,
    }));
    // 🪤 Der Tag kommt aus der DATENBANK, wenn der Aufrufer keinen nennt: `day` ist NOT NULL, und ein NULL aus dem Wertesatz
    // ließe den ganzen Einfügevorgang scheitern - still, weil der Zählpfad nie wirft. Deshalb COALESCE statt eines Werts aus Node.
    try {
        await sql`
            INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
            SELECT COALESCE(zeile.day, CURRENT_DATE), zeile.hour, zeile.actor_type, zeile.metric, zeile.dimension, zeile.count
            FROM json_to_recordset(${JSON.stringify(werte)}::text::json)
                AS zeile(day date, hour smallint, actor_type text, metric text, dimension text, count bigint)
            ON CONFLICT (day, hour, actor_type, metric, dimension)
            DO UPDATE SET count = visitor_metric.count + EXCLUDED.count
        `;
        return true;
    } catch {
        return false;
    }
}

/** Das Land und, bei Deutschland, das Bundesland zu einer Adresse. Ohne Nachschlagewerk bleibt beides leer. */
export async function geoTreffer(sql: Queryable, ip: string): Promise<{ land: string; region: string }> {
    const leer = { land: "", region: "" };
    if (!ip) return leer;
    try {
        const zeilen = await sql<{ country: string; region: string }[]>`
            SELECT country, region FROM visitor_geo_range
            WHERE netz >>= ${ip}::inet
            ORDER BY masklen(netz) DESC
            LIMIT 1
        `;
        const treffer = zeilen[0];
        return treffer ? { land: treffer.country, region: treffer.region } : leer;
    } catch {
        return leer;
    }
}

/**
 * Die Metrik der Editorenköpfe: verschiedene Personen mit Editorkonto an einem Tag (`kopfKennung`, Vali 2026-11-11).
 *
 * 🔴 **Ein eigener Name statt `unique`, damit die alte Zählung nicht mitliest.** Bis zum 2026-11-11 zählte `unique` der Editoren
 * Geräte (Adresse und Browser), dazu Legacys Reihe; auf der Stage elf „Köpfe“ bei zwei Personen. Diese Zeilen bleiben stehen, aber
 * niemand liest sie mehr: Ein Tag vor der ersten `kopf`-Zeile ist „nicht gezählt“ (`null`), nie die alte Zahl und nie 0. Wann die
 * Zählung begann, sagt die Tafel selbst, auf jeder Umgebung zu ihrem eigenen Tag.
 *
 * Wie `gleichzeitig` kennt `DIMENSIONSART` sie nicht: Ein Browser kann sie nicht melden, sie entsteht allein in `zaehleEindeutig`.
 */
export const METRIK_KOPF = "kopf";

/**
 * Zählt die Kennung einmal am Tag; gibt zurück, ob sie neu war. Ohne Kennung (kein Schlüssel) zählt nichts. Editoren zählen als
 * `kopf` (ihre Kennung ist die Person), alle anderen als `unique` (ihre Kennung ist das Gerät).
 */
export async function zaehleEindeutig(
    sql: Queryable,
    kennung: Buffer | undefined,
    sorte: ZaehlSorte,
): Promise<boolean> {
    if (!kennung) return false;
    try {
        const zeilen = await sql`
            INSERT INTO visitor_daily_seen (day, visitor_hash) VALUES (CURRENT_DATE, ${kennung})
            ON CONFLICT DO NOTHING RETURNING day
        `;
        if (zeilen.length === 0) return false;
        await zaehle(sql, sorte, [
            { metrik: sorte === "editor" ? METRIK_KOPF : "unique", dimension: "", stunde: KEINE_STUNDE },
        ]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Die Metrik der Tagesspitze: wie viele einer Sorte höchstens zugleich anwesend waren (WI-0213).
 *
 * 🔴 **Sie ist ein Höchstwert, keine Summe.** Jede andere Zeile in `visitor_metric` wird hochgezählt; diese wird nur ersetzt,
 * wenn der neue Wert größer ist. Deshalb schreibt sie nie `zaehle`, und `DIMENSIONSART` kennt sie nicht: Ein Browser kann sie
 * nicht melden, sie entsteht allein hier aus `visitor_live`.
 */
export const METRIK_GLEICHZEITIG = "gleichzeitig";

/** Das Lebenszeichen: Anwesenheit setzen oder auffrischen, danach die Tagesspitze der Sorte nachführen. */
export async function lebenszeichen(
    sql: Queryable,
    kennung: Buffer | undefined,
    sorte: Exclude<BesuchSorte, "bot">,
    zustand: BesuchZustand,
): Promise<void> {
    if (!kennung) return;
    await sql`
        INSERT INTO visitor_live (visitor_hash, actor_type, state, first_seen, last_seen)
        VALUES (${kennung}, ${sorte}, ${zustand}, now(), now())
        ON CONFLICT (visitor_hash) DO UPDATE SET
            actor_type = EXCLUDED.actor_type,
            state = EXCLUDED.state,
            last_seen = now(),
            first_seen = CASE
                WHEN visitor_live.last_seen < now() - ${`${LIVE_FENSTER_MINUTEN} minutes`}::interval THEN now()
                ELSE visitor_live.first_seen END
    `.catch(() => undefined);
    await merkeSpitze(sql, sorte);
}

/**
 * Die Tagesspitze nachführen: die Zahl „anwesend“ dieser Sorte, so wie das Panel sie unter „Anwesend jetzt“ zeigt (alle drei
 * Zustände, Fenster `LIVE_FENSTER_MINUTEN`).
 *
 * Gemessen wird bei jedem Lebenszeichen, nicht im Takt: Die Zahl wächst nur, wenn ein Lebenszeichen eintrifft, also verpasst
 * diese Stelle keine Spitze; ein Fünf-Minuten-Takt sähe nur Stichproben. Geschrieben wird nur, wenn die Spitze steigt (`WHERE`
 * im `DO UPDATE`), sonst bleibt die Zeile unberührt.
 *
 * ⚠️ Der Tag kommt aus der Datenbank, wie bei `zaehle` ohne Tag.
 */
export async function merkeSpitze(sql: Queryable, sorte: Exclude<BesuchSorte, "bot">): Promise<void> {
    await sql`
        INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
        SELECT CURRENT_DATE, ${KEINE_STUNDE}, ${sorte}, ${METRIK_GLEICHZEITIG}, '', COUNT(*)
        FROM visitor_live
        WHERE actor_type = ${sorte} AND last_seen >= now() - ${`${LIVE_FENSTER_MINUTEN} minutes`}::interval
        ON CONFLICT (day, hour, actor_type, metric, dimension)
        DO UPDATE SET count = EXCLUDED.count WHERE visitor_metric.count < EXCLUDED.count
    `.catch(() => undefined);
}

/**
 * Der Korb, in dem ein Besuch dieser Länge zählt: seine Untergrenze in Sekunden, fünfstellig mit führenden Nullen.
 *
 * 💣 Die Nullen tragen: `dimension` ist Text, der Leser sortiert als Zeichenkette, und ohne Auffüllung stünde „1200“ vor „300“.
 * Fein gespeichert, grob gezeigt — die Anzeige darf ihre Balken später anders schneiden (Legacys Regel, übernommen).
 */
export function dauerKorb(sekunden: number): string {
    const begrenzt = Math.max(0, Math.min(sekunden, 43200));
    let unten: number;
    if (begrenzt >= 43200) unten = 43200;
    else if (begrenzt < 300) unten = Math.floor(begrenzt / 10) * 10;
    else if (begrenzt < 3600) unten = Math.floor(begrenzt / 60) * 60;
    else unten = Math.floor(begrenzt / 300) * 300;
    return String(unten).padStart(5, "0");
}

/**
 * Aufräumen: beendete Anwesenheiten in Dauerkörbe verbuchen, alte Tageskennungen löschen.
 *
 * ⚠️ Der Tag kommt aus der Datenbank, nicht aus Node: ein Besuch, der um 23:58 endet und um 00:14 verbucht wird, gehört in den
 * Vortag, sonst wäre die letzte Stunde des Tages systematisch leer (Legacys Lehre, `visitor-analytics.php:607-643`).
 */
export async function raeumeAuf(sql: Queryable): Promise<{ beendet: number; kennungen: number }> {
    // 🔴 Ein einziges Lebenszeichen misst keine Dauer (OPS-000118): `last_seen = first_seen` heißt „unbekannt“, nicht 0 s.
    const beendet = await sql<{ sekunden: number; gemessen: boolean; tag: string; actor_type: BesuchSorte }[]>`
        DELETE FROM visitor_live
        WHERE last_seen < now() - ${`${LIVE_FENSTER_MINUTEN} minutes`}::interval
        RETURNING
            GREATEST(0, EXTRACT(EPOCH FROM (last_seen - first_seen)))::int AS sekunden,
            last_seen > first_seen AS gemessen,
            (last_seen AT TIME ZONE 'UTC')::date::text AS tag,
            actor_type
    `;
    for (const lauf of beendet) {
        await zaehle(
            sql,
            lauf.actor_type,
            [
                {
                    metrik: "dauer",
                    dimension: lauf.gemessen ? dauerKorb(lauf.sekunden) : DAUER_OHNE,
                    stunde: KEINE_STUNDE,
                },
            ],
            lauf.tag,
        );
    }
    const kennungen = await sql`DELETE FROM visitor_daily_seen WHERE day < CURRENT_DATE RETURNING day`;
    return { beendet: beendet.length, kennungen: kennungen.length };
}

/** So viele verschiedene Ausprägungen behält eine Metrik je Tag; der Rest wird zu „übrige“ verschmolzen. */
export const DIMENSIONEN_JE_METRIK = 200;

/**
 * Verdichten (Befund der Sicherheitsprüfung 2026-10-13): Namensmetriken wie `route` oder `route_waypoint` könnten über die Zeit
 * viele Zeilen anlegen - eine Reise darf bis zu `ROUTE_WAYPOINT_LIMIT` Wegpunkte haben, und jeder zählt (WI-0159). Der Takt
 * behält je Metrik und Tag die häufigsten und bucht den Rest auf „übrige“ um. Die Summe bleibt richtig, die Zeilenzahl
 * beschränkt.
 */
export async function verdichte(sql: Queryable, grenze = DIMENSIONEN_JE_METRIK): Promise<number> {
    const verschoben = await sql<{ count: string }[]>`
        WITH rang AS (
            SELECT day, hour, actor_type, metric, dimension, count,
                   row_number() OVER (PARTITION BY day, actor_type, metric ORDER BY count DESC, dimension) AS platz
            FROM visitor_metric
            WHERE dimension <> '' AND dimension <> 'übrige' AND day >= CURRENT_DATE - 2
        ),
        zuviel AS (SELECT * FROM rang WHERE platz > ${grenze}),
        weg AS (
            DELETE FROM visitor_metric ziel
            USING zuviel
            WHERE ziel.day = zuviel.day AND ziel.hour = zuviel.hour AND ziel.actor_type = zuviel.actor_type
              AND ziel.metric = zuviel.metric AND ziel.dimension = zuviel.dimension
            RETURNING ziel.day, ziel.hour, ziel.actor_type, ziel.metric, ziel.count
        )
        INSERT INTO visitor_metric (day, hour, actor_type, metric, dimension, count)
        SELECT day, hour, actor_type, metric, 'übrige', SUM(count) FROM weg
        GROUP BY day, hour, actor_type, metric
        ON CONFLICT (day, hour, actor_type, metric, dimension)
        DO UPDATE SET count = visitor_metric.count + EXCLUDED.count
        RETURNING count::text
    `;
    return verschoben.length;
}
