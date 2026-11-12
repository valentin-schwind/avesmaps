import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { dateiMerkmale } from "../dump/manifest.ts";
import { DumpFehler } from "../dump/xml.ts";

/**
 * Die Datei `dump_categorylinks.sql.gz` des Wikis lesen (WI-0294): ein MariaDB-Auszug der Tabelle `categorylinks`, gepackt, im Dump-Ordner (`WIKI_DUMP_ROOT`) neben dem XML-Dump.
 * Sie liefert dieselben Angaben wie die Kategorie-Abfragen der API (Ortsgröße, Bauwerkart, Kontinent), nur in Sekunden und ohne das Wiki anzurufen. Gelesen wird als Strom
 * (gunzip, Zeile für Zeile); die Datei steht nie im Speicher (rund 136 MB entpackt, 1,3 Millionen Zeilen).
 *
 * 🔴 Eine Datei ohne die Endzeile `-- Dump completed on …` ist abgeschnitten und liefert keine Teilergebnisse: Wer nur den Anfang liest, zählte Seiten als „ohne Kategorie“, die nur
 * nicht gelesen wurden. Jeder Durchgang prüft die Endzeile selbst, am Ende des Stroms.
 *
 * Die Datei wird nie ausgeführt, nur gelesen. Verglichen wird der Aufbau der Tabelle (`CREATE TABLE`): Hat das Wiki die Spalten umgebaut, hält das Lesen an, statt Spalten zu verwechseln.
 */

export type KategorienArt = "page" | "subcat" | "file";

/** Eine Zeile der Tabelle `categorylinks`: Die Seite `von` steht in der Kategorie `nach` (Name mit Unterstrichen, wie das Wiki ihn speichert). */
export interface KategorienZeile {
    /** `cl_from`: die Seitennummer des Mitglieds (bei einer Unterkategorie die Nummer ihrer Kategorieseite). */
    von: number;
    /** `cl_to`: der Name der Kategorie, mit Unterstrichen, ohne das Präfix `Kategorie:`. */
    nach: string;
    /** `cl_type`: Artikel (`page`), Unterkategorie (`subcat`) oder Datei (`file`). */
    art: KategorienArt;
    /** `cl_sortkey`: der Sortierschlüssel; die Reihenfolge der Mitglieder einer Kategorie im Wiki (die API listet sie danach). */
    sortierschluessel: string;
}

export interface KategorienKopf {
    /** Der Dateiname (ohne Ordner). */
    datei: string;
    sha256: string;
    /** Die Endzeile `-- Dump completed on` ist da und das Gzip heil. */
    vollstaendig: boolean;
    /** Der Zeitpunkt aus der Endzeile (ISO, UTC); `null`, wenn die Datei unvollständig ist. */
    stand: string | null;
    /** Wie viele Zeilen der Tabelle die Datei trägt. */
    zeilen: number;
}

/** Wie die Spalten von `categorylinks` in dieser Datei stehen müssen (MariaDB 10.x, MediaWiki bis 1.44). */
const SPALTEN = [
    "cl_from",
    "cl_to",
    "cl_sortkey",
    "cl_timestamp",
    "cl_sortkey_prefix",
    "cl_collation",
    "cl_type",
] as const;

const ENDZEILE = /^-- Dump completed on (\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*$/u;
const SPALTEN_ZEILE = /^\s+`([A-Za-z_]+)`\s/u;

/** Ein Text in einfachen Anführungszeichen: alles außer `'` und `\`, oder ein maskiertes Zeichen. */
const TEXT = "'((?:[^'\\\\]|\\\\[\\s\\S])*)'";
const TUPEL = new RegExp(`\\((\\d+),${TEXT},${TEXT},${TEXT},${TEXT},${TEXT},'(page|subcat|file)'\\)`, "uy");

const MASKIERUNG: Readonly<Record<string, string>> = {
    "0": "\0",
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    Z: "\x1a",
};

/** Die Maskierung eines MySQL-Textes auflösen (`\'`, `\\`, `\n` …); `\%` und `\_` behalten das Gegenschrägstrich-Zeichen wie in MySQL. */
export function entmaskiere(roh: string): string {
    if (!roh.includes("\\")) return roh;
    return roh.replace(/\\([\s\S])/gu, (_treffer, zeichen: string) => {
        if (zeichen === "%" || zeichen === "_") return `\\${zeichen}`;
        return MASKIERUNG[zeichen] ?? zeichen;
    });
}

export function istKategorienDateiname(name: string): boolean {
    const trenner = name.includes("/") || name.includes("\\") || name.includes("\0");
    return (
        name !== "" &&
        name === name.trim() &&
        !trenner &&
        !name.startsWith(".") &&
        /^dump_categorylinks.*\.sql\.gz$/iu.test(name)
    );
}

/**
 * Welche Kategorien-Datei im Dump-Ordner gemeint ist: der Auftrag nennt höchstens einen Dateinamen, nie einen Pfad; ohne Namen gilt die jüngste Datei `dump_categorylinks*.sql.gz`
 * des Ordners. Anders als beim XML-Dump ist „keine Datei da“ ein Fall, den der Aufrufer kennt (Fehlercode `kategorien_datei_fehlt`).
 */
export async function waehleKategorienDatei(wurzel: string | undefined, datei?: string): Promise<string> {
    if (wurzel === undefined) {
        throw new DumpFehler("dump_root_fehlt", "Für den Wiki-Dump ist kein Ordner eingerichtet (WIKI_DUMP_ROOT)");
    }
    if (datei !== undefined) {
        if (!istKategorienDateiname(datei)) {
            throw new DumpFehler(
                "datei_ungueltig",
                "Die Kategorien-Datei muss ein Dateiname der Form dump_categorylinks….sql.gz sein, ohne Pfad",
            );
        }
        const pfad = join(wurzel, datei);
        const eintrag = await stat(pfad).catch(() => null);
        if (eintrag === null || !eintrag.isFile()) {
            throw new DumpFehler("kategorien_datei_fehlt", "Die genannte Kategorien-Datei liegt nicht im Dump-Ordner");
        }
        return pfad;
    }
    const namen = await readdir(wurzel).catch(() => null);
    if (namen === null) throw new DumpFehler("dump_fehlt", "Der Dump-Ordner ist nicht lesbar oder fehlt");
    let juengste: { pfad: string; zeit: number } | null = null;
    for (const name of namen) {
        if (!istKategorienDateiname(name)) continue;
        const pfad = join(wurzel, name);
        const eintrag = await stat(pfad).catch(() => null);
        if (eintrag === null || !eintrag.isFile()) continue;
        if (juengste === null || eintrag.mtimeMs > juengste.zeit) juengste = { pfad, zeit: eintrag.mtimeMs };
    }
    if (juengste === null) {
        throw new DumpFehler(
            "kategorien_datei_fehlt",
            "Im Dump-Ordner liegt keine Kategorien-Datei (dump_categorylinks….sql.gz)",
        );
    }
    return juengste.pfad;
}

const unvollstaendig = (grund: string): DumpFehler =>
    new DumpFehler("kategorien_unvollstaendig", `Die Kategorien-Datei ist unvollständig: ${grund}`);

/** Der Zeitpunkt aus der Endzeile als ISO-Text (UTC: Die Datei setzt `TIME_ZONE='+00:00'`). */
function standAus(treffer: RegExpExecArray): string {
    const [, jahr, monat, tag, stunde, minute, sekunde] = treffer;
    return `${jahr ?? ""}-${monat ?? ""}-${tag ?? ""}T${(stunde ?? "").padStart(2, "0")}:${minute ?? ""}:${sekunde ?? ""}Z`;
}

/**
 * Die Zeilen der Tabelle im Strom. Am Ende (wenn der Strom ganz gelesen ist) liefert der Generator den Stand der Endzeile als Rückgabewert; fehlt die Endzeile, ist das Gzip
 * abgeschnitten oder hat der Strom keine Zeile der Tabelle, wirft er `kategorien_unvollstaendig`. Ändert sich der Aufbau der Tabelle, wirft er `kategorien_schema_unbekannt`.
 */
export async function* leseKategorienZeilen(pfad: string): AsyncGenerator<KategorienZeile, { stand: string }> {
    const quelle = createReadStream(pfad);
    const entpackt = createGunzip();
    quelle.on("error", (fehler) => entpackt.destroy(fehler));
    quelle.pipe(entpackt);
    const dekoder = new TextDecoder("utf-8");
    let rest = "";
    let stand: string | null = null;
    let spaltenZeilen: string[] | null = null;
    let schemaGeprueft = false;
    let zeilen = 0;

    const pruefeSchema = (): void => {
        const namen = spaltenZeilen ?? [];
        if (namen.length !== SPALTEN.length || namen.some((name, index) => name !== SPALTEN[index])) {
            throw new DumpFehler(
                "kategorien_schema_unbekannt",
                `Die Tabelle categorylinks hat andere Spalten als erwartet (${namen.join(", ")}); das Lesen hält an`,
            );
        }
        schemaGeprueft = true;
    };

    function* zeileLesen(zeile: string): Generator<KategorienZeile> {
        if (zeile === "") return;
        if (spaltenZeilen !== null && !schemaGeprueft) {
            // Die Spaltenliste endet mit der ersten Zeile, die keine Spalte ist (`PRIMARY KEY …`).
            const spalte = SPALTEN_ZEILE.exec(zeile);
            if (spalte !== null) {
                spaltenZeilen.push(spalte[1] ?? "");
                return;
            }
            pruefeSchema();
        }
        if (zeile.startsWith("CREATE TABLE `categorylinks`")) {
            spaltenZeilen = [];
            return;
        }
        let ab: number;
        if (zeile.startsWith("(")) {
            ab = 0;
        } else if (zeile.startsWith("INSERT INTO `categorylinks`")) {
            const werte = zeile.indexOf("VALUES");
            if (werte === -1) return;
            ab = werte + "VALUES".length;
            while (zeile.charAt(ab) === " ") ab += 1;
            // `VALUES` am Zeilenende: Die Tupel folgen in den nächsten Zeilen.
            if (ab >= zeile.length) return;
        } else {
            const ende = ENDZEILE.exec(zeile);
            if (ende !== null) stand = standAus(ende);
            return;
        }
        if (!schemaGeprueft) {
            throw new DumpFehler(
                "kategorien_schema_unbekannt",
                "Die Datei hat Zeilen vor dem Aufbau der Tabelle categorylinks; das Lesen hält an",
            );
        }
        while (ab < zeile.length) {
            TUPEL.lastIndex = ab;
            const treffer = TUPEL.exec(zeile);
            if (treffer === null) {
                throw new DumpFehler(
                    "kategorien_zeile_unlesbar",
                    `Eine Zeile der Kategorien-Datei ist kein Eintrag der Tabelle (ab Zeichen ${String(ab)})`,
                );
            }
            zeilen += 1;
            yield {
                von: Number(treffer[1]),
                nach: entmaskiere(treffer[2] ?? ""),
                sortierschluessel: entmaskiere(treffer[3] ?? ""),
                art: (treffer[7] ?? "page") as KategorienArt,
            };
            ab = TUPEL.lastIndex;
            while (zeile.charAt(ab) === "," || zeile.charAt(ab) === ";" || zeile.charAt(ab) === " ") ab += 1;
        }
    }

    try {
        for await (const stueck of entpackt) {
            rest += dekoder.decode(stueck as Buffer, { stream: true });
            let von = 0;
            for (let ende = rest.indexOf("\n", von); ende !== -1; ende = rest.indexOf("\n", von)) {
                yield* zeileLesen(rest.slice(von, ende));
                von = ende + 1;
            }
            rest = rest.slice(von);
        }
        rest += dekoder.decode();
        yield* zeileLesen(rest);
    } catch (fehler) {
        if (fehler instanceof DumpFehler) throw fehler;
        const grund = fehler instanceof Error ? fehler.message : String(fehler);
        throw unvollstaendig(`Die Datei ist nicht ganz lesbar (${grund})`);
    } finally {
        quelle.destroy();
        entpackt.destroy();
    }
    if (stand === null) throw unvollstaendig("Die Endzeile „-- Dump completed on“ fehlt, die Datei ist abgeschnitten");
    if (zeilen === 0) throw unvollstaendig("Sie trägt keine Zeile der Tabelle categorylinks");
    return { stand };
}

/**
 * Prüft die Datei in einem Durchgang: Prüfsumme der gepackten Datei, Endzeile und Zahl der Zeilen. Eine abgeschnittene Datei ist KEIN Fehler dieser Funktion (`vollstaendig: false`):
 * Der Aufrufer entscheidet. Ein anderer Aufbau der Tabelle wirft.
 */
export async function pruefeKategorienDatei(pfad: string): Promise<KategorienKopf> {
    const merkmale = await dateiMerkmale(pfad);
    const lauf = leseKategorienZeilen(pfad);
    let zeilen = 0;
    try {
        for (;;) {
            const schritt = await lauf.next();
            if (schritt.done === true) {
                return {
                    datei: merkmale.datei,
                    sha256: merkmale.sha256,
                    vollstaendig: true,
                    stand: schritt.value.stand,
                    zeilen,
                };
            }
            zeilen += 1;
        }
    } catch (fehler) {
        if (fehler instanceof DumpFehler && fehler.code === "kategorien_unvollstaendig") {
            return { datei: merkmale.datei, sha256: merkmale.sha256, vollstaendig: false, stand: null, zeilen };
        }
        throw fehler;
    }
}
