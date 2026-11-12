import { feld, feldRoh, type Infoboxseite } from "./seite.ts";
import { LEER, LEER_FOLGE, bereinige, einzeilig, entschluesseleHtml, phpTrim, schluesselform } from "./text.ts";

/**
 * Das Herrschaftsgebiet aus dem Infobox-Kasten (WI-0253 C): die Felder, die Legacys Dump-Lauf für ein Gebiet speichert
 * (`avesmapsWikiSyncMonitorParsePage` in `sync-monitor-parsing.php` mit `avesmapsPoliticalNormalizeWikiRecord` und
 * `avesmapsWikiSyncBuildPoliticalTemporalPayload`). Die 14 Detailfelder von 17: `political` und `trade_zone` liest dieser Lauf in Legacy nie
 * (kein Schlüssel im Datensatz), also liest sie auch der Abgleich nicht – sonst stünde dort ein „Wiki kennt nichts“, das Legacy nie behauptet hat. Der `continent`
 * bleibt für C-2: Legacy überschreibt ihn im hybriden Lauf mit dem Ergebnis der Kategorie-Abfrage (`online_continent_map`); aus dem Text allein wäre er eine
 * Vermutung, die einen richtigen Wert „ändern“ könnte.
 *
 * Zwei Dinge sind NICHT Fachtext, sondern Legacy-Vorgabe und stehen deshalb so in den Werten: ein Gebiet ohne Gründungsdatum trägt „0 BF“ und eines
 * ohne Auflösung „besteht“ (`avesmapsFormatBfYear`, Staging-Text); die Sonderregel der Detailfelder („wirksamer Wert“, `territory-detail-felder.php`)
 * nimmt den Staging-Text unverändert.
 */

const ALLES = "[\\s\\S]";

// ----------------------------------------------------------------------------------------------------------------------------
// Zugehörigkeit
// ----------------------------------------------------------------------------------------------------------------------------

/** Eine reine Eigenschaft (umstritten, unabhängig, vakant …) ist kein Elternteil. */
function nurQualifizierer(text: string): boolean {
    const schluessel = schluesselform(text);
    if (schluessel === "") return true;
    const woerter = [
        "unabhangig",
        "unabh",
        "keine",
        "unbekannt",
        "ungeklart",
        "umstritten",
        "strittig",
        "vakant",
        "niemand",
        "souveran",
        "eigenstandig",
        "eigenstand",
        "independent",
        "ehemals",
        "ehemalig",
        "fruher",
        "vormals",
        "zuvor",
        "ehem",
        "reichsstadt",
        "freiestadt",
    ];
    return woerter.some((wort) => schluessel === wort || schluessel.startsWith(wort));
}

const ANSPRUCH_PRAEFIX = new RegExp(
    `^${LEER}*(?:Gebiet${LEER}+)?(?:nach${LEER}+Aufl[o\\u00f6]sung${LEER}+(?:in${LEER}+)?(?:de[rmsn]${LEER}+)?|beansprucht${LEER}+vo[nm]|teil${LEER}+vo[nm]|teil${LEER}+des|geh[o\\u00f6]rt${LEER}+zu|zuletzt(?:${LEER}+vo[nm])?|vermutlich|zuvor|sowie|ehemal[a-z\\u00e4\\u00f6\\u00fc]*|vormals|fr[u\\u00fc]her)(?:${LEER}+de[rmsn])?${LEER}+`,
    "iu",
);

/** Präfixe vor einem Anspruchsteller („zuletzt“, „vermutlich“ …) und ein nachgestelltes „beansprucht“ fallen weg. */
function ohneAnspruchspraefix(wert: string): string {
    let text = phpTrim(wert);
    text = phpTrim(text.replace(new RegExp(`^\\([^)]*\\)${LEER}*`, "u"), ""));
    for (let i = 0; i < 2; i += 1) {
        const naechster = text.replace(ANSPRUCH_PRAEFIX, "");
        if (naechster === text) break;
        text = phpTrim(naechster);
    }
    text = phpTrim(text.replace(new RegExp(`${LEER}+beansprucht${LEER}*$`, "iu"), ""));
    return phpTrim(text);
}

/** Klammerzusätze fallen weg, vom Rest gilt der erste Teil vor einem Komma. */
function bereinigeKettenglied(teil: string): string {
    let text = phpTrim(teil.replace(/\([^)]*\)/gu, " "));
    if (text.includes(",")) {
        const erster = phpTrim(text.split(",")[0] ?? "");
        if (erster !== "") text = erster;
    }
    return phpTrim(text);
}

export interface Zugehoerigkeit {
    /** Der Text nach Abzug der Klammern mit „beansprucht von“, wie Legacy ihn als `affiliation_raw` führt. */
    roh: string;
    /** Die Kette vom Wurzelgebiet abwärts. */
    pfad: string[];
    /** Kein Elternteil: unabhängig, umstritten, nur ein Anspruch. */
    unabhaengig: boolean;
}

/**
 * Die Zugehörigkeit (`|Staat=`) wie Legacy (`avesmapsWikiSyncMonitorParseAffiliation`): in Klauseln an `;` und `/` teilen, die erste Klausel, die
 * kein reiner Qualifizierer ist, ist die Hauptkette; Ansprüche anderer („beansprucht von …“) sind Konflikte und tragen nichts zur Kette bei.
 * Die Konfliktliste und die Verknüpfungen braucht der Abgleich nicht und führt er nicht.
 */
export function leseZugehoerigkeit(staatRoh: string): Zugehoerigkeit {
    const roh = phpTrim(staatRoh);
    if (roh === "") return { roh: "", pfad: [], unabhaengig: false };
    const bereinigt = bereinige(roh).replace(/\(([^()]*)\)/gu, " ");
    const klauseln = bereinigt
        .split(new RegExp(`${LEER}*[;/]${LEER}*`, "u"))
        .map((klausel) => phpTrim(klausel))
        .filter((klausel) => klausel !== "");
    let haupt = "";
    for (const klausel of klauseln) {
        if (new RegExp(`^${LEER}*(?:bis|seit)${LEER}+`, "iu").test(klausel)) continue;
        if (new RegExp(`^${LEER}*sowie\\b`, "iu").test(klausel)) continue;
        const anspruch = new RegExp(`^(${ALLES}*?)\\bbeansprucht${LEER}+vo[nm]\\b${LEER}*:?${LEER}*(.+)$`, "iu").exec(
            klausel,
        );
        if (anspruch !== null) {
            const davor = ohneAnspruchspraefix(phpTrim(anspruch[1] ?? ""));
            if (
                haupt === "" &&
                davor !== "" &&
                !nurQualifizierer(davor) &&
                !new RegExp(`^(?:Gebiet|teile?|teilweise)${LEER}*$`, "iu").test(davor)
            ) {
                haupt = davor;
            }
            continue;
        }
        const gestrippt = ohneAnspruchspraefix(klausel);
        if (gestrippt === "" || nurQualifizierer(gestrippt)) continue;
        if (haupt === "") haupt = gestrippt;
    }
    const pfad: string[] = [];
    for (const teil of haupt.split(new RegExp(`${LEER}*(?::|>|»|›)${LEER}*`, "u"))) {
        const glied = bereinigeKettenglied(teil);
        if (glied === "" || nurQualifizierer(glied)) continue;
        if (!pfad.includes(glied)) pfad.push(glied);
    }
    return { roh: bereinigt, pfad, unabhaengig: pfad.length === 0 };
}

// ----------------------------------------------------------------------------------------------------------------------------
// Zeitangaben
// ----------------------------------------------------------------------------------------------------------------------------

/** Ein BF-Jahr als Text: 9999 und mehr heißt „besteht“, vor Bosparans Fall „n v. BF“, sonst „n BF“ (0 BF ist ein Jahr). */
function bfJahr(jahr: number): string {
    if (jahr >= 9999) return "besteht";
    return jahr < 0 ? `${String(Math.abs(jahr))} v. BF` : `${String(jahr)} BF`;
}

function jahre(text: string): number[] {
    if (text === "") return [];
    const muster = new RegExp(
        `(?:\\b\\d{1,2}\\.${LEER}*)?(?:(?:PRA|RON|EFF|TRA|BOR|HES|FIR|TSA|PHE|PER|ING|RAH|NAM)${LEER}+)?(\\d{1,5})${LEER}*(v\\.${LEER}*BF|BF)\\b`,
        "giu",
    );
    return [...text.matchAll(muster)].map((treffer) => {
        const jahr = Number.parseInt(treffer[1] ?? "0", 10);
        return new RegExp(`v\\.${LEER}*BF`, "iu").test(treffer[2] ?? "") ? -jahr : jahr;
    });
}

function zeitText(roh: string): string {
    return phpTrim(entschluesseleHtml(roh).replace(LEER_FOLGE, " "));
}

/** `{{BF|1050}}` und `{{Datum|Jahr|Monat|Tag}}` werden „1050 BF“, negative Jahre „n v. BF“; danach die übliche Bereinigung. */
function zeitangabeText(roh: string): string {
    let wert = phpTrim(roh);
    if (wert === "") return "";
    wert = wert.replace(
        new RegExp(`\\{\\{${LEER}*BF${LEER}*\\|${LEER}*(-?\\d{1,5})[^}]*\\}\\}`, "giu"),
        (_t: string, jahr: string) => {
            const zahl = Number.parseInt(jahr, 10);
            return zahl < 0 ? `${String(Math.abs(zahl))} v. BF` : `${String(zahl)} BF`;
        },
    );
    wert = wert.replace(
        new RegExp(`\\{\\{${LEER}*Datum${LEER}*\\|([^}]*)\\}\\}`, "giu"),
        (_t: string, rumpf: string) => {
            const jahr = phpTrim(rumpf.split("|")[0] ?? "");
            if (!/^-?\d{1,5}$/u.test(jahr)) return "";
            const zahl = Number.parseInt(jahr, 10);
            return zahl < 0 ? `${String(Math.abs(zahl))} v. BF` : `${String(zahl)} BF`;
        },
    );
    return bereinige(wert);
}

/** Gründung und Auflösung als Text, wie Legacys Staging sie führt (`avesmapsWikiSyncBuildPoliticalTemporalPayload`). */
export function zeitangaben(gruendungRoh: string, aufloesungRoh: string): { gruendung: string; aufloesung: string } {
    let gruendung = zeitText(einzeilig(zeitangabeText(gruendungRoh), 500));
    const gruendungsjahre = jahre(gruendung);
    if (gruendung === "") gruendung = bfJahr(gruendungsjahre.length === 0 ? 0 : Math.min(...gruendungsjahre));

    // Ob die Auflösung läuft, hat in Legacy nur Folgen für die Jahreszahlen; der Text bleibt, wie er ist, und nur ein leerer heißt „besteht“.
    const aufloesungText = zeitText(einzeilig(zeitangabeText(aufloesungRoh), 500));
    const aufloesung = aufloesungText === "" ? "besteht" : aufloesungText;
    return { gruendung, aufloesung };
}

// ----------------------------------------------------------------------------------------------------------------------------
// Der Leser
// ----------------------------------------------------------------------------------------------------------------------------

/** Die Felder, die der Abgleich für ein Herrschaftsgebiet liest (die Namen der Spalten in `territory_detail` und `wiki_territory_snapshot`). */
export const GEBIET_FELDER = [
    "founded_text",
    "dissolved_text",
    "form_of_government",
    "capital_name",
    "seat_name",
    "ruler",
    "language",
    "currency",
    "population",
    "founder",
    "trade_goods",
    "geographic",
    "blazon",
    "affiliation_raw",
] as const;

export type GebietFeld = (typeof GEBIET_FELDER)[number];

const STAAT_SCHLUESSEL = [
    "staat",
    "staatpolitisch",
    "zugehorigkeitpolitisch",
    "politischezugehorigkeit",
    "politisch",
] as const;

/** Die Art der Infobox, mit der ein Gebiet gelesen wird: Staat, Herrschaftsgebiet, Reich – oder eine Stadt, die Legacy zum Gebiet hebt. */
export function istGebietsInfobox(infoboxSchluessel: string): boolean {
    return (
        infoboxSchluessel !== "" &&
        (infoboxSchluessel.includes("staat") ||
            infoboxSchluessel.includes("herrschaftsgebiet") ||
            infoboxSchluessel.includes("reich"))
    );
}

/** Ob eine Siedlungs-Infobox ein Gebiet ist: Reichsstadt, Freie Stadt oder eigenständig (Stadtstaat). Sonst ist die Seite „reine Siedlung“. */
function stadtIstGebiet(seite: Infoboxseite, zugehoerigkeit: Zugehoerigkeit, status: string): boolean {
    const staatRoh = feldRoh(seite, STAAT_SCHLUESSEL);
    const statusUndInfobox = schluesselform(`${status} ${seite.infobox}`);
    const reichsstadt =
        new RegExp(`\\{\\{${LEER}*Reichsstadt\\b`, "iu").test(staatRoh) || statusUndInfobox.includes("reichsstadt");
    const freieStadt =
        new RegExp(`\\bFreie${LEER}+Stadt\\b`, "iu").test(staatRoh) || statusUndInfobox.includes("freiestadt");
    const unabhaengigkeit = schluesselform(`${status} ${zugehoerigkeit.roh}`);
    const eigenstaendig =
        zugehoerigkeit.unabhaengig ||
        unabhaengigkeit.includes("stadtstaat") ||
        unabhaengigkeit.includes("eigenstand") ||
        unabhaengigkeit.includes("unabh") ||
        unabhaengigkeit.includes("souveran");
    return reichsstadt || freieStadt || eigenstaendig;
}

export type GebietErgebnis =
    | { ok: true; felder: Partial<Record<GebietFeld, string>> }
    | { ok: false; grund: "fremde_infobox" | "reine_siedlung" };

/**
 * Das Gebiet aus einer Seite. Ein Feld ohne Wert fehlt im Ergebnis (das Wiki kennt nichts). Gründung und Auflösung tragen immer einen Text
 * („0 BF“, „besteht“), wie Legacys Staging.
 */
export function leseGebiet(seite: Infoboxseite): GebietErgebnis {
    const gebietsInfobox = istGebietsInfobox(seite.infoboxSchluessel);
    const stadtInfobox =
        seite.infoboxSchluessel !== "" &&
        (seite.infoboxSchluessel.includes("siedlung") ||
            seite.infoboxSchluessel.includes("stadt") ||
            seite.infoboxSchluessel.includes("ort"));
    if (!gebietsInfobox && !stadtInfobox) return { ok: false, grund: "fremde_infobox" };

    const zugehoerigkeit = leseZugehoerigkeit(feldRoh(seite, STAAT_SCHLUESSEL));
    const status = feld(seite, ["status"]);
    if (!gebietsInfobox && !stadtIstGebiet(seite, zugehoerigkeit, status))
        return { ok: false, grund: "reine_siedlung" };

    const zeit = zeitangaben(
        feldRoh(seite, ["grundungsdatum", "grundung", "gegrundet", "unabhangigkeit", "entstehung"]),
        feldRoh(seite, ["aufgelost", "auflosung", "besetzt", "untergang", "ende"]),
    );
    const werte: Record<GebietFeld, string> = {
        founded_text: zeit.gruendung,
        dissolved_text: zeit.aufloesung,
        form_of_government: einzeilig(feld(seite, ["herrschaftsform"]), 255),
        capital_name: einzeilig(feld(seite, ["hauptstadt"]), 255),
        seat_name: einzeilig(feld(seite, ["herrschaftssitz"]), 255),
        ruler: einzeilig(feld(seite, ["oberhaupt"]), 255),
        language: einzeilig(feld(seite, ["sprache"]), 2000),
        currency: einzeilig(feld(seite, ["wahrung", "wahrungen"]), 2000),
        population: einzeilig(feld(seite, ["einwohnerzahl", "einwohner"]), 2000),
        founder: einzeilig(feld(seite, ["grunder"]), 255),
        trade_goods: einzeilig(feld(seite, ["handelswaren"]), 4000),
        geographic: einzeilig(feld(seite, ["region", "geographisch"]), 500),
        blazon: einzeilig(feld(seite, ["blasonierung"]), 4000),
        affiliation_raw: einzeilig(zugehoerigkeit.roh, 500),
    };
    const felder: Partial<Record<GebietFeld, string>> = {};
    for (const name of GEBIET_FELDER) if (werte[name] !== "") felder[name] = werte[name];
    return { ok: true, felder };
}
