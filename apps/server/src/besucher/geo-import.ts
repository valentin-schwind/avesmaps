import { createReadStream } from "node:fs";
import type { Queryable } from "../database.ts";

/**
 * Das Nachschlagewerk „Netz → Land“ einspielen (WI-0138 V6, BESUCH-0001 §5): aus dem öffentlichen Datensatz **DB-IP lite**
 * (CC BY 4.0) in `visitor_geo_range`.
 *
 * Der Datensatz kommt als CSV mit **Bereichen**: `ip_start,ip_end,continent,country,stateprov,city,lat,lon`. Unsere Tabelle
 * hält **CIDR-Netze** — ein Bereich wird also in die größten Blöcke zerlegt, die hineinpassen. Das ist der Teil, den man
 * nicht nach Gefühl schreibt, und darum steht er hier und nicht in einem Einzeiler auf dem Server.
 *
 * 🔴 **`region` wird nur für Deutschland gefüllt.** Die Oberfläche zeigt Bundesländer allein für DE; alles andere wäre
 * Ballast, der die Tabelle vervielfacht. Dadurch verschmelzen die Bereiche eines Landes zu wenigen Zeilen statt zu
 * Millionen (ein Land hat tausende Stadtbereiche, aber nur eine Landeskennung).
 *
 * 🔴 **`region` trägt die Kennung nach ISO 3166-2 ohne Präfix** (`NW`, `BY`), nie den Namen: DB-IP schreibt je nach
 * Ausgabe „North Rhine-Westphalia“ oder „Nordrhein-Westfalen“, und beides meint dieselbe Fläche. Die Karte färbt nach der
 * Kennung (`apps/web/src/besuch/de-bundeslaender.ts`).
 */

/** Die sechzehn Bundesländer unter den Namen, die ein Geodatensatz dafür schreibt; Schlüssel kleingeschrieben. */
const DE_KENNUNGEN = new Set([
    "BW",
    "BY",
    "BE",
    "BB",
    "HB",
    "HH",
    "HE",
    "MV",
    "NI",
    "NW",
    "RP",
    "SL",
    "SN",
    "ST",
    "SH",
    "TH",
]);

const DE_REGIONEN: Readonly<Record<string, string>> = {
    "baden-wurttemberg": "BW",
    "baden-württemberg": "BW",
    bavaria: "BY",
    bayern: "BY",
    berlin: "BE",
    brandenburg: "BB",
    bremen: "HB",
    "freie hansestadt bremen": "HB",
    hamburg: "HH",
    hesse: "HE",
    hessen: "HE",
    "lower saxony": "NI",
    niedersachsen: "NI",
    "mecklenburg-vorpommern": "MV",
    "mecklenburg-west pomerania": "MV",
    "north rhine-westphalia": "NW",
    "nordrhein-westfalen": "NW",
    "rheinland-pfalz": "RP",
    "rhineland-palatinate": "RP",
    saarland: "SL",
    saxony: "SN",
    sachsen: "SN",
    "saxony-anhalt": "ST",
    "sachsen-anhalt": "ST",
    "schleswig-holstein": "SH",
    thuringia: "TH",
    thüringen: "TH",
};

/** Die Kennung zu dem, was im Datensatz steht; eine schon fertige Kennung bleibt, alles Unbekannte wird leer. */
export function regionKennung(land: string, stateprov: string): string {
    if (land.toUpperCase() !== "DE") return "";
    const roh = stateprov.trim().replace(/^DE-/i, "");
    // Eine fertige Kennung bleibt - aber nur, wenn es wirklich eine der sechzehn ist: „XY“ wäre sonst Freitext.
    if (DE_KENNUNGEN.has(roh.toUpperCase())) return roh.toUpperCase();
    return DE_REGIONEN[roh.toLowerCase()] ?? "";
}

/** Eine IPv4-Adresse als Zahl; `null`, wenn es keine ist (die Datei trägt auch IPv6, das überspringen wir). */
export function ipv4Zahl(text: string): number | null {
    const teile = text.split(".");
    if (teile.length !== 4) return null;
    let zahl = 0;
    for (const teil of teile) {
        const wert = Number(teil);
        if (!Number.isInteger(wert) || wert < 0 || wert > 255 || teil === "") return null;
        zahl = zahl * 256 + wert;
    }
    return zahl;
}

const alsIp = (zahl: number): string => [zahl >>> 24, (zahl >>> 16) & 255, (zahl >>> 8) & 255, zahl & 255].join(".");

/**
 * Ein Bereich als Liste von CIDR-Blöcken, immer der größte, der an dieser Stelle beginnt und noch hineinpasst.
 *
 * 🪤 Zwei Grenzen zugleich: Der Block darf nicht über `ende` hinausreichen **und** muss an seiner eigenen Größe
 * ausgerichtet sein. Wer nur das eine prüft, erzeugt Netze, die Nachbarbereiche überdecken — und der Treffer liefert
 * später das falsche Land.
 */
export function alsCidr(start: number, ende: number): string[] {
    const bloecke: string[] = [];
    let jetzt = start;
    while (jetzt <= ende) {
        // Die größte Blockgröße, die an dieser Adresse ausgerichtet ist, steckt im niedrigsten gesetzten Bit:
        // .1 trägt nur ein /32, .2 ein /31, .8 ein /29. 🪤 Ein Bit danebengerechnet, und der Block beginnt im Nachbarn.
        // 🪤 Nicht `jetzt & -jetzt`: Bitoperatoren rechnen in vorzeichenbehafteten 32 Bit, ab 128.0.0.0 (2^31) kippt das ins Negative
        // und der Logarithmus wird NaN („128.0.0.0/NaN“, Import auf Stage 2026-10-14). Das niedrigste gesetzte Bit hier ohne Bitoperatoren.
        let tiefstesBit = 1;
        while (tiefstesBit < 2 ** 32 && jetzt % (tiefstesBit * 2) === 0) tiefstesBit *= 2;
        const ausrichtung = jetzt === 0 ? 0 : 32 - Math.log2(tiefstesBit);
        let praefix = Math.max(0, ausrichtung);
        while (praefix < 32 && jetzt + 2 ** (32 - praefix) - 1 > ende) praefix += 1;
        bloecke.push(`${alsIp(jetzt)}/${praefix}`);
        const naechste = jetzt + 2 ** (32 - praefix);
        if (naechste > 0xff_ff_ff_ff) break;
        jetzt = naechste;
    }
    return bloecke;
}

export interface GeoZeile {
    start: number;
    ende: number;
    land: string;
    region: string;
}

/** Eine CSV-Zeile des Datensatzes; `undefined`, wenn sie uns nichts sagt (IPv6, Kopfzeile, kaputt). */
export function zeileLesen(zeile: string): GeoZeile | undefined {
    const felder = zeile.split(",").map((feld) => feld.replace(/^"|"$/g, ""));
    if (felder.length < 5) return undefined;
    const start = ipv4Zahl(felder[0] ?? "");
    const ende = ipv4Zahl(felder[1] ?? "");
    const land = (felder[3] ?? "").trim().toUpperCase();
    if (start === null || ende === null || ende < start || !/^[A-Z]{2}$/.test(land)) return undefined;
    return { start, ende, land, region: regionKennung(land, felder[4] ?? "") };
}

/**
 * Aufeinanderfolgende Bereiche mit demselben Land und derselben Kennung werden einer.
 *
 * Das ist der Grund, warum die Tabelle Zehntausende statt Millionen Zeilen trägt: Der Datensatz zerlegt jedes Land in
 * Stadtbereiche, die uns nicht interessieren.
 */
export function verschmelze(zeilen: Iterable<GeoZeile>): GeoZeile[] {
    const heraus: GeoZeile[] = [];
    for (const zeile of zeilen) {
        const letzte = heraus.at(-1);
        if (letzte && letzte.land === zeile.land && letzte.region === zeile.region && zeile.start <= letzte.ende + 1) {
            letzte.ende = Math.max(letzte.ende, zeile.ende);
            continue;
        }
        heraus.push({ ...zeile });
    }
    return heraus;
}

const STAPEL = 5_000;

/**
 * Die Zeilen einer Datei, verlustfrei auch dann, wenn der Aufrufer zwischen zwei Zeilen wartet.
 *
 * 🔴 Nicht `for await` über `readline.createInterface`: Wartet der Schleifenkörper (hier auf die Datenbank), gehen Zeilen
 * verloren, die `readline` in der Zwischenzeit ausgibt — auf Stage und Production fehlten 2026-10-14 je ein anderer Teil
 * der 3,6 Mio Zeilen (3,14 und 2,38 Mio gelesen). Der Strom selbst als asynchroner Iterator hält dagegen an, solange
 * niemand den nächsten Block will.
 */
export async function* zeilenAus(pfad: string): AsyncGenerator<string> {
    let rest = "";
    for await (const block of createReadStream(pfad, { encoding: "utf8" })) {
        const teile = (rest + (block as string)).split("\n");
        rest = teile.pop() ?? "";
        for (const teil of teile) yield teil.endsWith("\r") ? teil.slice(0, -1) : teil;
    }
    if (rest !== "") yield rest.endsWith("\r") ? rest.slice(0, -1) : rest;
}

/**
 * Spielt die Datei ein und ersetzt den Bestand. Zeilenweise gelesen, damit auch eine Datei von Gigabytes durchläuft.
 *
 * Die Tabelle wird in derselben Transaktion geleert und neu gefüllt: Ein halb ersetztes Nachschlagewerk lieferte sonst
 * für Minuten falsche Länder.
 */
export async function importiereGeoDaten(
    sql: Queryable,
    pfad: string,
    log: (satz: string) => void = () => undefined,
): Promise<{ gelesen: number; geschrieben: number }> {
    let gelesen = 0;
    let geschrieben = 0;
    let puffer: GeoZeile[] = [];

    await sql`DELETE FROM visitor_geo_range`;

    const schreibe = async (zeilen: readonly GeoZeile[]): Promise<void> => {
        const netze = zeilen.flatMap((zeile) =>
            alsCidr(zeile.start, zeile.ende).map((netz) => ({ netz, country: zeile.land, region: zeile.region })),
        );
        for (let i = 0; i < netze.length; i += STAPEL) {
            const block = netze.slice(i, i + STAPEL);
            await sql`
                INSERT INTO visitor_geo_range ${sql(block, "netz", "country", "region")}
                ON CONFLICT (netz) DO UPDATE SET country = EXCLUDED.country, region = EXCLUDED.region
            `;
            geschrieben += block.length;
        }
    };

    for await (const zeile of zeilenAus(pfad)) {
        const gelesene = zeileLesen(zeile);
        if (!gelesene) continue;
        gelesen += 1;
        puffer.push(gelesene);
        if (puffer.length >= 50_000) {
            const fertig = verschmelze(puffer);
            // Die letzte bleibt liegen: Sie könnte mit der ersten des nächsten Puffers verschmelzen.
            await schreibe(fertig.slice(0, -1));
            puffer = fertig.slice(-1);
            log(`${gelesen} Zeilen gelesen, ${geschrieben} Netze geschrieben`);
        }
    }
    await schreibe(verschmelze(puffer));
    return { gelesen, geschrieben };
}
