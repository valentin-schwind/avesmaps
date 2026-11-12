/**
 * Die Orte und Werkzeuge des WikiSync (WI-0253 B-1), aus der Umgebung des Prozesses. Kein Wert ist ein Geheimnis; die Zugangsdaten des
 * Bot-Kontos stehen NICHT hier, nur der Pfad der Datei, die sie trägt.
 *
 * - `WIKI_DUMP_ROOT`: der Ordner des Wiki-Dumps. EIN Dump für alle Umgebungen des Servers (Vali 2026-10-25: einmal geholt, gilt er für Stage
 *   und Production, lokal für diesen Rechner). Ohne Wert gilt lokal (Windows, der Entwicklungsrechner) `C:/avesmaps3d-data/wiki-dump`; auf dem
 *   VPS richtet Claudio den Ordner ein, ohne Wert ist dort kein Dump da.
 * - `WIKI_TAKT_ROOT`: der Ordner des Takts (Vermerk der letzten Wiki-Anfrage, Schutz-Zustand, abgelegte Bot-Sitzung). Er gilt für den
 *   ganzen Host: alle Prozesse, beide Umgebungen und jede Anfrage teilen sich einen Abstand (Crawl-delay des Wikis, IP-weit). 🔴 Es gibt KEINE
 *   Vorgabe, auch nicht lokal (bis 2026-10-25 stand hier `C:/avesmaps3d-data/wiki-takt`): Ohne Wert gibt es keinen Takt, und dann geht keine
 *   Wiki-Anfrage hinaus (geschlossen). Dazu `wikiAbrufErlaubt`: ein echter Abruf nur auf Stage oder Production mit echtem Release.
 * - `WIKI_BZIP2_PFAD`: das Programm `bzip2` für `.xml.bz2`-Dumps; ohne Wert wird `bzip2` im Suchpfad gesucht.
 * - `WIKI_BOT_ZUGANG_DATEI`: die Datei mit den Zugangsdaten des Bot-Kontos, ausdrücklich AUSSERHALB des Repositorys (`anmeldung.ts`).
 */

export interface WikiKonfiguration {
    readonly dumpWurzel: string | undefined;
    readonly taktWurzel: string | undefined;
    readonly bzip2: string;
    readonly zugangsdatei: string | undefined;
}

const LOKALE_DATENWURZEL = "C:/avesmaps3d-data";

function wert(environment: NodeJS.ProcessEnv, name: string): string | undefined {
    const roh = (environment[name] ?? "").trim();
    return roh === "" ? undefined : roh;
}

export function wikiKonfiguration(
    environment: NodeJS.ProcessEnv,
    plattform: NodeJS.Platform = process.platform,
): WikiKonfiguration {
    const lokal = (unterordner: string): string | undefined =>
        plattform === "win32" ? `${LOKALE_DATENWURZEL}/${unterordner}` : undefined;
    return {
        dumpWurzel: wert(environment, "WIKI_DUMP_ROOT") ?? lokal("wiki-dump"),
        taktWurzel: wert(environment, "WIKI_TAKT_ROOT"),
        bzip2: wert(environment, "WIKI_BZIP2_PFAD") ?? "bzip2",
        zugangsdatei: wert(environment, "WIKI_BOT_ZUGANG_DATEI"),
    };
}

/** Warum ein echter Wiki-Abruf in dieser Umgebung nicht entsteht. */
export type WikiAbrufGrund = "umgebung" | "release" | "takt";

export type WikiAbrufUrteil = { erlaubt: true } | { erlaubt: false; grund: WikiAbrufGrund; text: string };

/**
 * 🔴 DIE HARTE SPERRE (Koordination 2026-10-25): Ein echter Abruf beim Wiki Aventurica entsteht nur, wenn ALLES stimmt: `AVESMAPS_ENV` ist
 * `staging` oder `production`, ein echtes Release läuft (`RELEASE_ID` fehlt nicht und ist nicht `dev`) und der Ordner des Takts ist
 * benannt (`WIKI_TAKT_ROOT`). Beim Wiki ist nur die IP des VPS freigegeben, und der Crawl-delay von 20 s gilt IP-weit: Ein Entwicklungsrechner
 * darf nicht einmal versehentlich anfragen, auch nicht mit `AVESMAPS_ENV=production` ohne Release (dieselbe Regel wie beim Discord-Bericht).
 * Die Erlaubnis ist reine Rechnung auf der Umgebung; sie fragt weder das Wiki noch den Takt.
 */
export function wikiAbrufErlaubt(environment: NodeJS.ProcessEnv): WikiAbrufUrteil {
    const umgebung = wert(environment, "AVESMAPS_ENV");
    if (umgebung !== "staging" && umgebung !== "production") {
        return {
            erlaubt: false,
            grund: "umgebung",
            text: "Ein Abruf beim Wiki Aventurica gibt es nur auf Stage und Production (AVESMAPS_ENV).",
        };
    }
    if ((wert(environment, "RELEASE_ID") ?? "dev") === "dev") {
        return {
            erlaubt: false,
            grund: "release",
            text: "Ein Abruf beim Wiki Aventurica gibt es nur mit einem echten Release (RELEASE_ID).",
        };
    }
    if (wert(environment, "WIKI_TAKT_ROOT") === undefined) {
        return {
            erlaubt: false,
            grund: "takt",
            text: "Ohne den Ordner des Takts (WIKI_TAKT_ROOT) geht keine Anfrage an das Wiki hinaus.",
        };
    }
    return { erlaubt: true };
}

export type DumpHolenUrteil =
    { erlaubt: true } | { erlaubt: false; grund: "umgebung" | "release" | "ordner"; text: string };

/**
 * Darf diese Umgebung das Holen des Dumps anfordern (WI-0253 §22, `POST /api/admin/wikisync/dump`)? Die App holt den Dump nie selbst; sie reiht nur den Auftrag `wiki_dump_holen` ein,
 * den Claudios Korridor ausführt. Darum gelten hier die ersten zwei Bedingungen der harten Sperre (`wikiAbrufErlaubt`): `staging` oder `production` und ein echtes Release; ein
 * Entwicklungsrechner reiht nichts ein, das nie jemand abholt. Der Takt gehört nicht dazu: Der Dump kommt von `offline.wiki-aventurica.de` über Claudios Skript, nicht über den Client
 * der App. Dazu muss der Dump-Ordner (`WIKI_DUMP_ROOT`) benannt sein, sonst gäbe es keinen Ort, an den das Skript ihn ablegt. Reine Rechnung auf der Umgebung.
 */
export function dumpHolenErlaubt(
    environment: NodeJS.ProcessEnv,
    plattform: NodeJS.Platform = process.platform,
): DumpHolenUrteil {
    const umgebung = wert(environment, "AVESMAPS_ENV");
    if (umgebung !== "staging" && umgebung !== "production") {
        return {
            erlaubt: false,
            grund: "umgebung",
            text: "Den Dump holt der Betrieb auf Stage und Production (AVESMAPS_ENV); lokal gibt es keinen Abruf.",
        };
    }
    if ((wert(environment, "RELEASE_ID") ?? "dev") === "dev") {
        return {
            erlaubt: false,
            grund: "release",
            text: "Den Dump holt der Betrieb nur mit einem echten Release (RELEASE_ID).",
        };
    }
    if (wikiKonfiguration(environment, plattform).dumpWurzel === undefined) {
        return {
            erlaubt: false,
            grund: "ordner",
            text: "Auf diesem Server ist kein Dump-Ordner eingerichtet (WIKI_DUMP_ROOT).",
        };
    }
    return { erlaubt: true };
}
