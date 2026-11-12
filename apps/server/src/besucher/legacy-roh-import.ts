import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { Queryable } from "../database.ts";
import { normalizeSearchText } from "../migration/path-groups.ts";
import { regionKennung } from "./geo-import.ts";
import {
    dauerKorb,
    DIMENSIONEN_JE_METRIK,
    dimensionErlaubt,
    einstiegAus,
    KEINE_STUNDE,
    spracheAus,
} from "./zaehler.ts";

/**
 * Legacys **Ausprägungen** übernehmen (WI-0151; Betreiber 2026-10-14: Legacys alte Statistik übernehmen, „so weit wie es uns
 * nützt“, Suchbegriffe nur mit Kartenbezug, Herkunft nur als Domäne).
 *
 * Der erste Import (`legacy-import.ts`, WI-0138 V14) nahm Legacys **Tagessummen** aus `visitor-metrics.php`: Aufrufe, eindeutige
 * Besucher, Routen. Alles mit einer Ausprägung — woher, welches Land, welches Reisemittel — stand dort nicht drin. Diese Datei
 * nimmt Claudios Rohabzug der Legacy-Tabelle `visitor_metric` (450.491 Zeilen, 109 Tage), bildet ihn auf unser Schema ab und
 * schreibt nur, was eine Frage des Betreibers beantwortet.
 *
 * 🔴 **Nur der Tageswert.** Jede geschriebene Zeile trägt `hour = 24`. Legacys Stunde ist keine Semantik: Vor dem 25.08.2026 war
 * die Spalte NULL (und legte je Ereignis eine neue Zeile an), danach war sie gesetzt. Vor allem aber würde eine Stundenzeile zur
 * Tageszeile der Messreihe **hinzuaddieren** statt mit ihr zu kollidieren — `ON CONFLICT` schützt nur bei gleichem Schlüssel, und
 * der Tag wäre doppelt gezählt.
 *
 * 🔴 **Nichts wird überschrieben** (`ON CONFLICT … DO NOTHING`): Wer zuerst da war, gewinnt — also unsere eigene Zählung und die
 * 428 Zeilen der Messreihe. Ein zweiter Lauf schreibt 0 und ändert keine Zahl.
 *
 * 🔴 **Freitext von Besuchern kommt nicht in die Datenbank.** Ein Suchbegriff nur, wenn er zu einem Kartenobjekt passt (§4 des
 * Work Items), eine Herkunft nur als Domäne. Was durchfällt, wird nicht gesammelt, nicht gezählt und nicht protokolliert.
 */

/** Legacys eigener Host; eine Herkunft von dort heißt bei uns `intern`, wie im Zählpfad. */
export const LEGACY_HOST = "avesmaps.de";

/** Eine Zeile des Abzugs: `day hour actor_type metric dimension count`, Kopfzeile, `NULL` wie `mysql --batch`. */
export interface RohZeile {
    day: string;
    /** `undefined`, wo Legacy NULL stand — bei 413.133 von 450.491 Zeilen. */
    hour: number | undefined;
    actorType: string;
    metric: string;
    dimension: string;
    count: number;
}

/** Was daraus in `visitor_metric` wird; die Stunde steht nicht drin, sie ist immer `KEINE_STUNDE`. */
export interface ZielZeile {
    day: string;
    actorType: string;
    metric: string;
    dimension: string;
    count: number;
}

/** Die Namen der Karte, nach der Normalisierung der Suche auf den Namen, wie er auf der Karte steht. */
export type KartenNamen = ReadonlyMap<string, string>;

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const SORTEN = new Set(["visitor", "editor", "bot"]);

/**
 * `mysql --batch` maskiert `\t`, `\n`, `\r`, `\\` und `\0`; ein Feld, das genau `NULL` lautet, ist NULL (das prüft der Aufrufer
 * **vor** dieser Funktion, sonst wäre ein maskiertes `NULL` nicht zu unterscheiden).
 */
function entmaskiert(feld: string): string {
    let text = "";
    for (let stelle = 0; stelle < feld.length; stelle += 1) {
        if (feld[stelle] !== "\\" || stelle + 1 >= feld.length) {
            text += feld[stelle];
            continue;
        }
        stelle += 1;
        const zeichen = feld[stelle];
        text +=
            zeichen === "t" ? "\t" : zeichen === "n" ? "\n" : zeichen === "r" ? "\r" : zeichen === "0" ? "\0" : zeichen;
    }
    return text;
}

/**
 * Eine Zeile lesen. `undefined` heißt: Kopfzeile, leer oder kaputt — nie ein stillschweigend geratener Wert.
 *
 * 🪤 Die Felder werden an `\t` getrennt, und ein Tabulator **im** Wert steht als `\t` da: Erst trennen, dann entmaskieren.
 */
export function zeileLesen(zeile: string): RohZeile | undefined {
    if (zeile.trim() === "") return undefined;
    const felder = zeile.replace(/\r$/, "").split("\t");
    if (felder.length !== 6) return undefined;
    const [tag, stunde, sorte, metrik, auspraegung, anzahl] = felder as [
        string,
        string,
        string,
        string,
        string,
        string,
    ];
    if (tag === "day") return undefined;
    if (!TAG.test(tag)) return undefined;
    if (!SORTEN.has(sorte)) return undefined;
    let hour: number | undefined;
    if (stunde !== "NULL" && stunde !== "") {
        hour = Number(stunde);
        if (!Number.isInteger(hour) || hour < 0 || hour > KEINE_STUNDE) return undefined;
    }
    const count = Number(anzahl);
    if (!Number.isInteger(count) || count < 0) return undefined;
    return {
        day: tag,
        hour,
        actorType: sorte,
        metric: entmaskiert(metrik),
        dimension: auspraegung === "NULL" ? "" : entmaskiert(auspraegung),
        count,
    };
}

/**
 * Die Herkunft auf die **Domäne**, nie die ganze Adresse (Betreiber 2026-10-14). `undefined` heißt: kommt nicht an.
 *
 * Die Fälle, an denen eine naive Zerlegung scheitert:
 *  - **ohne Schema** (`google.de/search?q=…`) — `new URL` lehnt das ab, also wird `https://` davorgesetzt;
 *  - **mit Port** (`example.org:8080/x`) — `hostname` lässt den Port weg, `host` nicht;
 *  - **mit Unterdomäne** (`www.google.de`, `de.wikipedia.org`) — `www.` fällt weg, jede andere bleibt;
 *  - **leer** — keine Zeile, denn „keine Herkunft“ und „Feld nicht gefüllt“ sind im Abzug nicht zu unterscheiden;
 *  - **Müll** (`(none)`, `android-app://…`, `localhost`, eine IP) — fällt weg.
 */
export function herkunftDomain(roh: string): string | undefined {
    const text = roh.trim();
    if (text === "") return undefined;
    // Legacy schrieb den fehlenden Verweis teils als Wort; das ist genau unser Korb „direkt“.
    if (/^(direct|direkt|\(direct\)|\(none\)|none|-)$/i.test(text)) return "direkt";
    // 🪤 Ein Schema erkennt man an `://`, nicht am Doppelpunkt: `example.org:8080/x` wäre sonst ein Schema namens
    // „example.org“. Und nur http und https sind eine Herkunft - `android-app://com.x` hat als Hostnamen `com.x`, das
    // sähe nach einer Domäne aus.
    const schema = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
    if (schema !== null && !/^https?$/i.test(schema[1] as string)) return undefined;
    const mitSchema = schema === null ? `https://${text}` : text;
    let host: string;
    try {
        host = new URL(mitSchema).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
        return undefined;
    }
    // Eine Domäne hat mindestens einen Punkt und keine Klammern: `localhost`, `[::1]` und `(none)` sind keine Herkunft.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return undefined;
    // 🔴 Eine IP ist eine Adresse eines Rechners, keine Quelle, die eine Frage beantwortet - und sie ist personennah.
    if (/^\d+(\.\d+)*$/.test(host)) return undefined;
    // Dieselbe Regel wie im Zählpfad: der Name der Suchmaschine, sonst der Host ohne `www.`, die eigene Seite als `intern`.
    return einstiegAus(`https://${host}/`, LEGACY_HOST);
}

/**
 * Ein von Besuchern eingegebener Name — nur, wenn er zu einem Objekt auf der Karte passt (Betreiber 2026-10-14).
 *
 * Verglichen wird der **ganze** Name nach der Normalisierung der Suche (`normalizeSearchText`): Groß- und Kleinschreibung,
 * Akzente, `ß` und Satzzeichen sind damit egal, ein Teiltreffer aber nicht — „gar“ ist kein Ort, und ein Präfixvergleich machte
 * aus jedem Buchstaben einen Treffer. Gespeichert wird der Name, wie er auf der Karte steht, damit „gareth“ und „Gareth“ **eine**
 * Zeile werden und auf derselben Zeile landen wie unsere eigene Zählung (`melde("search", hit.name)`).
 *
 * 🔴 Ein Tippfehler kommt nirgends an: kein „übrige“, keine Sammelzeile, keine Zahl je Begriff.
 */
export function kartenName(roh: string, namen: KartenNamen): string | undefined {
    const schluessel = normalizeSearchText(roh);
    if (schluessel === "") return undefined;
    return namen.get(schluessel);
}

const GERAETE: Readonly<Record<string, string>> = {
    desktop: "rechner",
    rechner: "rechner",
    mobile: "telefon",
    mobil: "telefon",
    phone: "telefon",
    telefon: "telefon",
    tablet: "tablet",
};

const OPTIONEN: Readonly<Record<string, string>> = {
    kuerzeste: "kuerzeste",
    kürzeste: "kuerzeste",
    shortest: "kuerzeste",
    schnellste: "schnellste",
    fastest: "schnellste",
};

/** Eine Kennung aus einer eigenen Liste; geprüft mit derselben Positivliste wie der Zählpfad. */
const kennung =
    (metrik: string) =>
    (roh: string): string | undefined => {
        const text = roh.trim();
        return dimensionErlaubt(metrik, text) ? text : undefined;
    };

/** Nichts dran: die Metrik steht für sich (`pageview`, `unique`, `route`). */
const ohneAuspraegung = (): string => "";

/**
 * Legacys Metrik → unsere Metrik, samt der Regel für die Ausprägung. Eine Metrik, die hier nicht steht, kommt nicht an:
 * `dwell_seconds` und `dwell_sessions` (Tagessummen, die niemand liest — Sitzungen und Mittel rechnet der Leseweg aus den
 * `dauer`-Körben) und `map_load` (vier Zeilen in 109 Tagen).
 */
export const ZIELE: Readonly<
    Record<string, { metrik: string; wert: (roh: string, namen: KartenNamen) => string | undefined }>
> = {
    country: {
        metrik: "land",
        wert: (roh) => {
            const code = roh.trim().toUpperCase();
            return /^[A-Z]{2}$/.test(code) ? code : undefined;
        },
    },
    // 🔴 Nur Deutschland, und nur als Kennung: Die Ansicht färbt Bundesländer nach `NW`, `BY` … (`de-bundeslaender.ts`);
    // alles andere wäre Freitext in einer Liste, die ihn nicht zeigt. Dieselbe Regel wie beim Geo-Import.
    region: {
        metrik: "region",
        wert: (roh) => {
            const kennzeichen = regionKennung("DE", roh);
            return kennzeichen === "" ? undefined : kennzeichen;
        },
    },
    language: { metrik: "sprache", wert: (roh) => spracheAus(roh) },
    device: { metrik: "geraet", wert: (roh) => GERAETE[roh.trim().toLowerCase()] },
    referrer: { metrik: "einstieg", wert: (roh) => herkunftDomain(roh) },
    // 🪤 Über `dauerKorb`, nicht roh übernommen: Legacys Eimer müssen nicht unser Raster treffen, und `dimensionErlaubt`
    // greift hier nicht (die Positivliste verlangt einen Buchstaben am Anfang, ein Korb beginnt mit einer Ziffer) - genau
    // wie im eigenen Schreibpfad, der die Körbe am Takt vorbei schreibt.
    dwell: {
        metrik: "dauer",
        wert: (roh) => {
            const sekunden = Number(roh.trim());
            return Number.isFinite(sekunden) && sekunden >= 0 ? dauerKorb(sekunden) : undefined;
        },
    },
    search: { metrik: "search", wert: (roh, namen) => kartenName(roh, namen) },
    route_waypoint: { metrik: "route_waypoint", wert: (roh, namen) => kartenName(roh, namen) },
    transport: { metrik: "transport", wert: kennung("transport") },
    route_option: { metrik: "route_option", wert: (roh) => OPTIONEN[roh.trim().toLowerCase()] },
    map_mode: { metrik: "map_mode", wert: kennung("map_mode") },
    map_style: { metrik: "map_style", wert: kennung("map_style") },
    display_toggle: { metrik: "display_toggle", wert: kennung("display_toggle") },
    eco_kind: { metrik: "eco_kind", wert: kennung("eco_kind") },
    // 🔴 Ohne Ausprägung, damit sie auf denselben Schlüssel treffen wie die Messreihe aus V14. Eine benannte Zeile hätte
    // einen anderen Schlüssel, `ON CONFLICT` griffe nicht, und derselbe Tag wäre zweimal gezählt.
    pageview: { metrik: "pageview", wert: ohneAuspraegung },
    unique: { metrik: "unique", wert: ohneAuspraegung },
    route: { metrik: "route", wert: ohneAuspraegung },
};

/** Eine Rohzeile als Zielzeile, oder `undefined`: kein Ziel, oder eine Ausprägung, die nicht ankommt. */
export function abgebildet(roh: RohZeile, namen: KartenNamen): ZielZeile | undefined {
    const ziel = ZIELE[roh.metric];
    if (ziel === undefined) return undefined;
    const dimension = ziel.wert(roh.dimension, namen);
    if (dimension === undefined) return undefined;
    return { day: roh.day, actorType: roh.actorType, metric: ziel.metrik, dimension, count: roh.count };
}

/**
 * Die Namen aller Kartenobjekte, die auch die Suche findet: Orte, Beschriftungen, Regionen, Wege und Klimazonen
 * (`search/search.ts`). Nur **gelesen**; keine Kartendaten werden berührt.
 *
 * 🪤 `ORDER BY name` macht die Wahl bei zwei Objekten, die sich nur in Schreibweise unterscheiden, wiederholbar.
 */
export async function leseKartenNamen(sql: Queryable, mapDomainId = "aventuria"): Promise<Map<string, string>> {
    const zeilen = await sql<{ name: string }[]>`
        SELECT name FROM place WHERE is_active AND map_domain_id = ${mapDomainId} AND name <> ''
        UNION
        SELECT name FROM map_label WHERE is_active AND name <> ''
        UNION
        SELECT btrim(name) FROM region WHERE is_active AND map_domain_id = ${mapDomainId} AND btrim(name) <> ''
        UNION
        SELECT name FROM path WHERE is_active AND map_domain_id = ${mapDomainId} AND name <> ''
        UNION
        SELECT label FROM climate_zone_type WHERE is_active AND label <> ''
        ORDER BY name
    `;
    const namen = new Map<string, string>();
    for (const zeile of zeilen) {
        const schluessel = normalizeSearchText(zeile.name);
        if (schluessel !== "" && !namen.has(schluessel)) namen.set(schluessel, zeile.name);
    }
    return namen;
}

export interface MetrikZahl {
    /** Zeilen des Abzugs mit dieser Legacy-Metrik. */
    gelesen: number;
    /** Zeilen, die abgebildet wurden. */
    uebernommen: number;
    /** Zeilen, deren Ausprägung nicht ankommt (Tippfehler, Müll, fremde Region). */
    verworfen: number;
}

export interface RohErgebnis {
    gelesen: number;
    kaputt: number;
    /** Je **Legacy**-Metrik; Metriken ohne Ziel stehen mit `uebernommen = 0`. */
    jeMetrik: Map<string, MetrikZahl>;
    /** Je **Ziel**-Metrik: verdichtete Zeilen und ihre Summe. */
    jeZiel: Map<string, { zeilen: number; summe: number }>;
    zeilen: number;
    angeboten: number;
    geschrieben: number;
    von: string;
    bis: string;
    kartenNamen: number;
}

/**
 * Dieselbe Obergrenze, die der Takt der eigenen Zählung einhält (`verdichte`, `DIMENSIONEN_JE_METRIK`): je Tag, Sorte und Metrik
 * bleiben die häufigsten Ausprägungen stehen, der Rest wird auf `übrige` gebucht. Die Summe bleibt richtig, die Zeilenzahl
 * beschränkt.
 *
 * 💣 **Hier und nicht im Takt**, weil `verdichte` nur `day >= CURRENT_DATE - 2` anfasst: Legacys 109 Tage liegen weit davor und
 * würden nie verdichtet. Ohne diese Grenze brächte allein `route_waypoint` zehntausende Zeilen mit — genau die Falle, an der
 * Legacy 449.715 Zeilen und 68,7 MB angesammelt hat.
 */
export function aufGrenze(zeilen: readonly ZielZeile[], grenze = DIMENSIONEN_JE_METRIK): ZielZeile[] {
    const gruppen = new Map<string, ZielZeile[]>();
    const behalten: ZielZeile[] = [];
    for (const zeile of zeilen) {
        // Metriken ohne Ausprägung haben nur eine Zeile je Tag und Sorte; sie zählen gegen keine Grenze.
        if (zeile.dimension === "") {
            behalten.push(zeile);
            continue;
        }
        const schluessel = `${zeile.day}|${zeile.actorType}|${zeile.metric}`;
        const gruppe = gruppen.get(schluessel);
        if (gruppe === undefined) gruppen.set(schluessel, [zeile]);
        else gruppe.push(zeile);
    }
    for (const gruppe of gruppen.values()) {
        if (gruppe.length <= grenze) {
            behalten.push(...gruppe);
            continue;
        }
        // Dieselbe Ordnung wie in `verdichte`: nach Anzahl, bei Gleichstand nach der Ausprägung.
        gruppe.sort((links, rechts) => rechts.count - links.count || (links.dimension < rechts.dimension ? -1 : 1));
        const vorn = gruppe.slice(0, grenze);
        const rest = gruppe.slice(grenze).reduce((summe, zeile) => summe + zeile.count, 0);
        // 🪤 `übrige` kann es schon geben (`einstiegAus` vergibt es für einen Host, der keine Domainform hat). Dann wird dazu
        // addiert, statt eine zweite Zeile mit demselben Schlüssel anzulegen - die fiele still unter `ON CONFLICT`.
        const vorhanden = vorn.find((zeile) => zeile.dimension === "übrige");
        if (vorhanden) vorhanden.count += rest;
        else vorn.push({ ...(gruppe[0] as ZielZeile), dimension: "übrige", count: rest });
        behalten.push(...vorn);
    }
    return behalten;
}

/** Der Schlüssel einer Zeile in `visitor_metric` - ohne Stunde, denn die ist immer `KEINE_STUNDE`. */
const schluesselVon = (zeile: ZielZeile): string =>
    `${zeile.day}|${zeile.actorType}|${zeile.metric}|${zeile.dimension}`;

function zeilenStrom(pfad: string): NodeJS.ReadableStream {
    const datei = createReadStream(pfad);
    return /\.gz$/i.test(pfad) ? datei.pipe(createGunzip()) : datei;
}

/**
 * Den Abzug einspielen. Gelesen wird zeilenweise (die Datei ist groß), verdichtet wird im Speicher — erst damit ergeben Legacys
 * Ereigniszeilen (vor dem 25.08.2026 je Ereignis eine Zeile mit `count = 1`) wieder Tagessummen.
 *
 * 🔴 Ohne Transaktion, und das ist Absicht: Der Lauf ist wiederholbar, ein Abbruch kostet also nichts außer einem zweiten Lauf.
 */
export async function importiereRohabzug(
    sql: Queryable,
    pfad: string,
    optionen: { trocken?: boolean; namen?: KartenNamen } = {},
): Promise<RohErgebnis> {
    // Die Namen kommen aus der Karte; ein Test gibt sie direkt mit, statt Kartenobjekte anzulegen.
    const namen = optionen.namen ?? (await leseKartenNamen(sql));
    const jeMetrik = new Map<string, MetrikZahl>();
    const verdichtet = new Map<string, ZielZeile>();
    let gelesen = 0;
    let kaputt = 0;
    let von = "";
    let bis = "";

    const strom = createInterface({ input: zeilenStrom(pfad), crlfDelay: Infinity });
    for await (const zeile of strom) {
        if (zeile.trim() === "") continue;
        const roh = zeileLesen(zeile);
        if (roh === undefined) {
            // Die Kopfzeile ist nicht kaputt, sie ist die Kopfzeile.
            if (!zeile.startsWith("day\t")) kaputt += 1;
            continue;
        }
        gelesen += 1;
        if (von === "" || roh.day < von) von = roh.day;
        if (bis === "" || roh.day > bis) bis = roh.day;
        const zahl = jeMetrik.get(roh.metric) ?? { gelesen: 0, uebernommen: 0, verworfen: 0 };
        zahl.gelesen += 1;
        const ziel = abgebildet(roh, namen);
        if (ziel === undefined) {
            if (ZIELE[roh.metric] !== undefined) zahl.verworfen += 1;
            jeMetrik.set(roh.metric, zahl);
            continue;
        }
        zahl.uebernommen += 1;
        jeMetrik.set(roh.metric, zahl);
        if (ziel.count === 0) continue;
        const schluessel = schluesselVon(ziel);
        const vorhanden = verdichtet.get(schluessel);
        if (vorhanden) vorhanden.count += ziel.count;
        else verdichtet.set(schluessel, { ...ziel });
    }

    const alle = aufGrenze([...verdichtet.values()]);
    const jeZiel = new Map<string, { zeilen: number; summe: number }>();
    for (const zeile of alle) {
        const zahl = jeZiel.get(zeile.metric) ?? { zeilen: 0, summe: 0 };
        zahl.zeilen += 1;
        zahl.summe += zeile.count;
        jeZiel.set(zeile.metric, zahl);
    }
    const angeboten = [...jeZiel.values()].reduce((summe, zahl) => summe + zahl.summe, 0);
    const ergebnis: RohErgebnis = {
        gelesen,
        kaputt,
        jeMetrik,
        jeZiel,
        zeilen: alle.length,
        angeboten,
        geschrieben: 0,
        von,
        bis,
        kartenNamen: namen.size,
    };
    if (optionen.trocken === true) return ergebnis;

    for (let anfang = 0; anfang < alle.length; anfang += 500) {
        const block = alle.slice(anfang, anfang + 500).map((zeile) => ({
            day: zeile.day,
            hour: KEINE_STUNDE,
            actor_type: zeile.actorType,
            metric: zeile.metric,
            dimension: zeile.dimension,
            count: zeile.count,
        }));
        const geschrieben = await sql`
            INSERT INTO visitor_metric ${sql(block, "day", "hour", "actor_type", "metric", "dimension", "count")}
            ON CONFLICT (day, hour, actor_type, metric, dimension) DO NOTHING
            RETURNING day
        `;
        ergebnis.geschrieben += geschrieben.length;
    }
    return ergebnis;
}
