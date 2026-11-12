import { AVENTURIA, roundMapCoordinate } from "@avesmaps3d/shared";

/**
 * Die offenen Meldungen aus Legacy (`map_reports`, Status `neu`) als Vorgänge der Community (WI-0268 C9, Entscheidung E6; Vertrag
 * `project-control/migration/contracts/community-meldungen.yaml`). REINE Funktionen: Sie lesen keine Datei und keine Datenbank, sie bilden ab.
 *
 * Quelle ist `api/discord/reports-export.php` (Legacy, nur mit dem Token der Discord-App). Die Antwort trägt NIE IP, IP-Hash, User-Agent,
 * Seitenadresse, Meldeart, Objektbezug, mehrere Quellen oder die Nutzlast; was fehlt, kann dieses Werkzeug nicht übernehmen (Vertrag, „bekannte Lücken“).
 *
 * 🔴 Datenschutz: Kein Befund und keine Zahl nennt einen Namen oder einen Text, nur Legacy-Nummern und Zählungen.
 *
 * Koordinaten: Legacy führt `lat`/`lng`; das GeoJSON dort ist `[x, y] = [lng, lat]` und Avesmaps3D übernimmt x/y unverändert: also `x = lng`, `y = lat`.
 * Zeit: `created_at` ist die naive Serverzeit und wird als Europe/Berlin gelesen.
 */

/** Die Grenzen der Welt `aventuria`; eine Meldung außerhalb wird nicht übernommen. */
const WELT = AVENTURIA.coordinateSpace.bounds;

/** Ein Ort mit gleichem Namen gilt als „derselbe“, wenn er höchstens so weit von der Meldung liegt (Karteneinheiten). */
export const NAMENSABGLEICH_ABSTAND = 30;
/** Liegt die Meldung weiter als das vom Ort, wird ihre Lage als Vorschlag mitgegeben (Karteneinheiten). */
export const VORSCHLAG_ABSTAND = 0.5;
/** Grenzen wie `community_melden` (Beschreibung) und die Einschränkungen der Tafeln. */
export const TEXT_MIN = 10;
export const TEXT_MAX = 2000;
export const QUELLE_MAX = 1000;
export const NAME_MAX = 80;
export const NOTIZ_MAX = 4000;
const BEZUG_NAME_MAX = 200;
const BEZUG_TYP_MAX = 80;

export class LegacyDateiFehler extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LegacyDateiFehler";
    }
}

/** Eine Meldung, wie der Export sie liefert (alle Felder geprüft). */
export interface LegacyMeldung {
    id: number;
    type: string;
    subtype: string;
    name: string;
    reporter: string;
    lat: number;
    lng: number;
    source: string;
    wiki_url: string;
    comment: string;
    review_note: string;
    created_at: string;
}

/** Ein aktiver Ort der Welt `aventuria`, so wie das Werkzeug ihn aus der Datenbank liest. */
export interface OrtZeile {
    publicId: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
}

export interface Lage {
    x: number;
    y: number;
}

/** Der Bezug, wie `community_melden` ihn als `p_bezug` nimmt. */
export type UebernahmeBezug =
    | {
          art: "objekt";
          objektArt: "place";
          objektId: string;
          name: string;
          typ: string;
          lage: Lage;
          vorschlagLage?: Lage;
      }
    | { art: "stelle"; lage: Lage; naechsterOrt?: string };

export type UebernahmeKategorie = "angabe" | "fehlt" | "sonstiges";
export type FehltArt = "ort" | "fluss" | "gebirge" | "gewaesser" | "gebiet" | "anderes";

/** Alles, was `community_legacy_uebernehmen` für EINE Meldung braucht. */
export interface Uebernahme {
    legacyId: number;
    kategorie: UebernahmeKategorie;
    fehltArt: FehltArt | null;
    text: string;
    quelle: string | null;
    melderName: string | null;
    bezug: UebernahmeBezug;
    /** Die Eingangszeit als UTC-Zeitpunkt (ISO), aus der Berliner Serverzeit gerechnet. */
    eingegangenAt: string;
    notiz: string;
}

/** Wozu die Nummern gehören, die der Bericht nennt. Nie ein Name oder Text. */
export interface Befunde {
    /** Name, Kommentar oder Melder beginnt mit „ZZ-Systemtest“. */
    testzeile: number[];
    /** Lage nicht endlich oder außerhalb der Welt. */
    lageUngueltig: number[];
    /** Zeile unbrauchbar (kein Objekt, keine Nummer, Zeit unlesbar); Nummer, wo sie lesbar war, sonst 0. */
    unbrauchbar: number[];
    /** Dieselbe Nummer mehrfach in der Datei; die erste gilt. */
    doppelt: number[];
    /** Untertyp einer Beschriftung ist dem Werkzeug unbekannt (wird `anderes`). */
    artUnbekannt: number[];
    /** Meldeart ist dem Werkzeug unbekannt (wird `sonstiges`). */
    typUnbekannt: number[];
    /** Quelle länger als 1000 Zeichen (entfällt). */
    quelleZuLang: number[];
    /** Name des Melders länger als 80 Zeichen (gekürzt). */
    nameGekuerzt: number[];
    /** Text länger als 2000 Zeichen (gekürzt). */
    textGekuerzt: number[];
}

export interface Plan {
    /** Zahl der gelieferten Zeilen (`reports.length`). */
    geliefert: number;
    uebernahmen: Uebernahme[];
    befunde: Befunde;
    /** Wie viele Texte den Satz „Vorschlag aus der alten Karte“ davor bekamen. */
    aufgefuellt: number;
    objektGefunden: number;
    stelle: number;
    /** Zählung je Kategorie: `angabe`, `fehlt:ort`, `fehlt:gebiet`, `sonstiges` … */
    jeKategorie: Record<string, number>;
}

// --- Datei -----------------------------------------------------------------------------------------------------------------------------------

/** Prüft die Antwort des Exports und gibt ihre Zeilen zurück. Sonst `LegacyDateiFehler` mit einem klaren Satz. */
export function pruefeDatei(inhalt: unknown): unknown[] {
    if (typeof inhalt !== "object" || inhalt === null || Array.isArray(inhalt)) {
        throw new LegacyDateiFehler("Die Datei ist keine Antwort des Exports (kein Objekt).");
    }
    const datei = inhalt as Record<string, unknown>;
    if (datei["ok"] !== true) {
        throw new LegacyDateiFehler(
            "Die Antwort meldet nicht ok: true; der Abruf ist gescheitert, nichts wird übernommen.",
        );
    }
    const reports = datei["reports"];
    if (!Array.isArray(reports)) {
        throw new LegacyDateiFehler("Die Antwort hat keine Liste reports; nichts wird übernommen.");
    }
    if (datei["count"] !== reports.length) {
        throw new LegacyDateiFehler(
            `count (${String(datei["count"])}) und die Zahl der Zeilen (${String(reports.length)}) widersprechen sich; die Antwort ist unvollständig oder verändert.`,
        );
    }
    return reports;
}

// Legacy liefert `created_at` mit Sekundenbruchteilen (`2026-10-12 14:03:07.123`, Spalte wohl `DATETIME(3)`; Production-Probelauf 2026-11-01: alle vier Zeilen
// daran gescheitert). Die Bruchteile sind optional; `berlinZuUtc` behält die Millisekunden, mehr Stellen schneidet es ab.
const ZEIT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u;

function text(wert: unknown): string | undefined {
    if (wert === undefined || wert === null) return "";
    return typeof wert === "string" ? wert : undefined;
}

/** Eine Zeile des Exports als `LegacyMeldung`; `undefined`, wenn sie sich nicht lesen lässt. Fehlende Textfelder sind leer (PHP liefert `''`). */
export function leseZeile(zeile: unknown): LegacyMeldung | undefined {
    if (typeof zeile !== "object" || zeile === null || Array.isArray(zeile)) return undefined;
    const z = zeile as Record<string, unknown>;
    const id = z["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return undefined;
    const felder = {
        type: text(z["type"]),
        subtype: text(z["subtype"]),
        name: text(z["name"]),
        reporter: text(z["reporter"]),
        source: text(z["source"]),
        wiki_url: text(z["wiki_url"]),
        comment: text(z["comment"]),
        review_note: text(z["review_note"]),
        created_at: text(z["created_at"]),
    };
    if (Object.values(felder).some((wert) => wert === undefined)) return undefined;
    return {
        id,
        ...(felder as Record<keyof typeof felder, string>),
        // Eine Lage, die keine Zahl ist, gilt als ungültige Lage (Befund), nicht als unlesbare Zeile.
        lat: typeof z["lat"] === "number" ? z["lat"] : Number.NaN,
        lng: typeof z["lng"] === "number" ? z["lng"] : Number.NaN,
    };
}

// --- Zeit ------------------------------------------------------------------------------------------------------------------------------------

const BERLIN = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

/** Der Versatz Berlins gegen UTC in Minuten zu einem Zeitpunkt (60 im Winter, 120 im Sommer). */
function berlinVersatz(zeitpunktMs: number): number {
    const teile = Object.fromEntries(
        BERLIN.formatToParts(new Date(zeitpunktMs)).map((teil) => [teil.type, teil.value]),
    );
    const lokal = Date.UTC(
        Number(teile["year"]),
        Number(teile["month"]) - 1,
        Number(teile["day"]),
        Number(teile["hour"]),
        Number(teile["minute"]),
        Number(teile["second"]),
    );
    return Math.round((lokal - Math.floor(zeitpunktMs / 1000) * 1000) / 60000);
}

/**
 * Die naive Serverzeit (`YYYY-MM-DD HH:MM:SS`) als Berliner Zeit gelesen, als UTC-Zeitpunkt (ISO). `undefined`, wenn sie sich nicht lesen
 * lässt. In der doppelten Stunde der Zeitumstellung gilt die zweite, in der ausgefallenen die danach: stets dasselbe Ergebnis.
 */
export function berlinZuUtc(naiv: string): string | undefined {
    const treffer = ZEIT.exec(naiv.trim());
    if (treffer === null) return undefined;
    const [jahr, monat, tag, stunde, minute, sekunde] = treffer.slice(1, 7).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
    ];
    const millis = Number((treffer[7] ?? "").padEnd(3, "0").slice(0, 3));
    const alsUtc = Date.UTC(jahr, monat - 1, tag, stunde, minute, sekunde, millis);
    const probe = new Date(alsUtc);
    if (
        probe.getUTCFullYear() !== jahr ||
        probe.getUTCMonth() !== monat - 1 ||
        probe.getUTCDate() !== tag ||
        stunde > 23 ||
        minute > 59 ||
        sekunde > 59
    ) {
        return undefined;
    }
    const erster = alsUtc - berlinVersatz(alsUtc) * 60_000;
    return new Date(alsUtc - berlinVersatz(erster) * 60_000).toISOString();
}

/** `2026-08-05 14:03:00` als `05.08.2026`. */
function datumDeutsch(naiv: string): string {
    const treffer = ZEIT.exec(naiv.trim());
    return treffer === null ? naiv.trim() : `${treffer[3]}.${treffer[2]}.${treffer[1]}`;
}

// --- Texte -----------------------------------------------------------------------------------------------------------------------------------

/** Zeichen im Sinne von PostgreSQL (`char_length`): Codepunkte, nicht UTF-16-Einheiten. */
function laenge(wert: string): number {
    return Array.from(wert).length;
}

function kuerze(wert: string, max: number): string {
    const zeichen = Array.from(wert);
    return zeichen.length <= max ? wert : zeichen.slice(0, max).join("").trimEnd();
}

const rund = (x: number, y: number): Lage => ({ x: roundMapCoordinate(x), y: roundMapCoordinate(y) });

/** Wie Legacy die Orte nennt, in Alltagssprache; für den Satz, der einen zu kurzen Text auffüllt. */
const ART_NAME: Readonly<Record<string, string>> = {
    dorf: "Dorf",
    gebaeude: "Gebäude",
    stadtviertel: "Stadtviertel",
    kleinstadt: "Kleinstadt",
    stadt: "Stadt",
    grossstadt: "Großstadt",
    metropole: "Metropole",
    fluss: "Fluss",
    meer: "Meer",
    see: "See",
    region: "Region",
    insel: "Insel",
    inselgruppe: "Inselgruppe",
    gebirge: "Gebirge",
    berggipfel: "Berggipfel",
    vulkan: "Vulkan",
    bergkette: "Bergkette",
    felsformation: "Felsformation",
    huegel: "Hügel",
    wald: "Wald",
    steppe: "Steppe",
    graslandschaft: "Graslandschaft",
    auenlandschaft: "Auenlandschaft",
    ebene: "Ebene",
    huegelland: "Hügelland",
    tal: "Tal",
    tundra: "Tundra",
    kueste: "Küste",
    wueste: "Wüste",
    suempfe_moore: "Sumpf oder Moor",
    flussland_flusstal: "Flussland oder Flusstal",
    dschungel: "Dschungel",
    wuestenoase: "Wüstenoase",
    wadi: "Wadi",
    schlucht: "Schlucht",
    hochebene: "Hochebene",
    tiefebene: "Tiefebene",
    flussdelta: "Flussdelta",
    kulturlandschaft: "Kulturlandschaft",
    gletscher: "Gletscher",
    flachkueste: "Flachküste",
    steilkueste: "Steilküste",
    schneelandschaft: "Schneelandschaft",
    eislandschaft: "Eislandschaft",
    sonstiges: "Sonstiges",
};
const TYP_NAME: Readonly<Record<string, string>> = {
    location: "Ort",
    label: "Beschriftung",
    comment: "Anmerkung",
    path: "Weg",
    powerline: "Kraftlinie",
    territory: "Herrschaftsgebiet",
    citymap: "Stadtkarte",
    citymap_link: "Fundort einer Karte",
};

/** Die Art in Alltagssprache: bei Orten und Beschriftungen der Untertyp, sonst die Meldeart. */
export function artName(typ: string, untertyp: string): string {
    if (typ === "location" || typ === "label") return ART_NAME[untertyp] ?? TYP_NAME[typ] ?? "Eintrag";
    return TYP_NAME[typ] ?? "Eintrag";
}

// --- Kategorie -------------------------------------------------------------------------------------------------------------------------------

const FEHLT_ART_JE_UNTERTYP: Readonly<Record<string, FehltArt>> = {
    fluss: "fluss",
    meer: "gewaesser",
    see: "gewaesser",
    gebirge: "gebirge",
    bergkette: "gebirge",
    berggipfel: "gebirge",
    vulkan: "gebirge",
    huegel: "gebirge",
    huegelland: "gebirge",
    felsformation: "gebirge",
    sonstiges: "anderes",
    // Alle übrigen Landschafts- und Regionsarten sind ein Gebiet.
    region: "gebiet",
    insel: "gebiet",
    inselgruppe: "gebiet",
    wald: "gebiet",
    steppe: "gebiet",
    graslandschaft: "gebiet",
    auenlandschaft: "gebiet",
    ebene: "gebiet",
    tal: "gebiet",
    tundra: "gebiet",
    kueste: "gebiet",
    wueste: "gebiet",
    suempfe_moore: "gebiet",
    flussland_flusstal: "gebiet",
    dschungel: "gebiet",
    wuestenoase: "gebiet",
    wadi: "gebiet",
    schlucht: "gebiet",
    hochebene: "gebiet",
    tiefebene: "gebiet",
    flussdelta: "gebiet",
    kulturlandschaft: "gebiet",
    gletscher: "gebiet",
    flachkueste: "gebiet",
    steilkueste: "gebiet",
    schneelandschaft: "gebiet",
    eislandschaft: "gebiet",
};

const TYPEN_SONSTIGES = new Set(["path", "territory", "comment", "citymap", "citymap_link"]);

// --- Orte ------------------------------------------------------------------------------------------------------------------------------------

/** Name ohne Rand und ohne Groß/Klein, in einer Schreibweise der Zeichen. */
function namensschluessel(name: string): string {
    return name.normalize("NFC").trim().toLowerCase();
}

interface OrtsIndex {
    jeName: Map<string, OrtZeile[]>;
    alle: readonly OrtZeile[];
}

function ortsIndex(orte: readonly OrtZeile[]): OrtsIndex {
    const jeName = new Map<string, OrtZeile[]>();
    for (const ort of orte) {
        const schluessel = namensschluessel(ort.name);
        if (schluessel === "") continue;
        const liste = jeName.get(schluessel);
        if (liste === undefined) jeName.set(schluessel, [ort]);
        else liste.push(ort);
    }
    return { jeName, alle: orte };
}

function abstand(ort: OrtZeile, x: number, y: number): number {
    return Math.hypot(ort.x - x, ort.y - y);
}

function naechster(
    kandidaten: readonly OrtZeile[],
    x: number,
    y: number,
): { ort: OrtZeile; abstand: number } | undefined {
    let beste: { ort: OrtZeile; abstand: number } | undefined;
    for (const ort of kandidaten) {
        const d = abstand(ort, x, y);
        if (beste === undefined || d < beste.abstand) beste = { ort, abstand: d };
    }
    return beste;
}

// --- Abbildung -------------------------------------------------------------------------------------------------------------------------------

const istTestzeile = (m: LegacyMeldung): boolean =>
    [m.name, m.comment, m.reporter].some((wert) => wert.trim().toLowerCase().startsWith("zz-systemtest"));

const lageGueltig = (m: LegacyMeldung): boolean =>
    Number.isFinite(m.lat) &&
    Number.isFinite(m.lng) &&
    m.lng >= WELT.minX &&
    m.lng <= WELT.maxX &&
    m.lat >= WELT.minY &&
    m.lat <= WELT.maxY;

function leereBefunde(): Befunde {
    return {
        testzeile: [],
        lageUngueltig: [],
        unbrauchbar: [],
        doppelt: [],
        artUnbekannt: [],
        typUnbekannt: [],
        quelleZuLang: [],
        nameGekuerzt: [],
        textGekuerzt: [],
    };
}

/**
 * Bildet die gelieferten Zeilen ab. Die Zeilen sind die geprüfte Liste aus `pruefeDatei`; `orte` sind die aktiven Orte der Welt `aventuria`.
 * Die Reihenfolge der Antwort (älteste zuerst) bleibt.
 */
export function planeUebernahme(zeilen: readonly unknown[], orte: readonly OrtZeile[]): Plan {
    const index = ortsIndex(orte);
    const befunde = leereBefunde();
    const plan: Plan = {
        geliefert: zeilen.length,
        uebernahmen: [],
        befunde,
        aufgefuellt: 0,
        objektGefunden: 0,
        stelle: 0,
        jeKategorie: {},
    };
    const gesehen = new Set<number>();
    for (const roh of zeilen) {
        const m = leseZeile(roh);
        if (m === undefined) {
            const id = (roh as { id?: unknown } | null)?.id;
            befunde.unbrauchbar.push(typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : 0);
            continue;
        }
        if (gesehen.has(m.id)) {
            befunde.doppelt.push(m.id);
            continue;
        }
        gesehen.add(m.id);
        if (istTestzeile(m)) {
            befunde.testzeile.push(m.id);
            continue;
        }
        const eingegangenAt = berlinZuUtc(m.created_at);
        if (eingegangenAt === undefined) {
            befunde.unbrauchbar.push(m.id);
            continue;
        }
        if (!lageGueltig(m)) {
            befunde.lageUngueltig.push(m.id);
            continue;
        }
        const uebernahme = bilde(m, eingegangenAt, index, plan);
        plan.uebernahmen.push(uebernahme);
        const schluessel =
            uebernahme.fehltArt === null ? uebernahme.kategorie : `${uebernahme.kategorie}:${uebernahme.fehltArt}`;
        plan.jeKategorie[schluessel] = (plan.jeKategorie[schluessel] ?? 0) + 1;
    }
    return plan;
}

function bilde(m: LegacyMeldung, eingegangenAt: string, index: OrtsIndex, plan: Plan): Uebernahme {
    const { befunde } = plan;
    const x = m.lng;
    const y = m.lat;

    // Objektabgleich nur für Orte: gleicher Name, höchstens 30 Einheiten entfernt, bei mehreren der nächste.
    let treffer: { ort: OrtZeile; abstand: number } | undefined;
    if (m.type === "location") {
        const schluessel = namensschluessel(m.name);
        const kandidaten = schluessel === "" ? undefined : index.jeName.get(schluessel);
        const naechste = kandidaten === undefined ? undefined : naechster(kandidaten, x, y);
        if (naechste !== undefined && naechste.abstand <= NAMENSABGLEICH_ABSTAND) treffer = naechste;
    }

    let bezug: UebernahmeBezug;
    if (treffer !== undefined) {
        plan.objektGefunden += 1;
        bezug = {
            art: "objekt",
            objektArt: "place",
            objektId: treffer.ort.publicId,
            name: kuerze(treffer.ort.name.trim(), BEZUG_NAME_MAX),
            typ: kuerze(treffer.ort.subtype, BEZUG_TYP_MAX),
            lage: rund(treffer.ort.x, treffer.ort.y),
            ...(treffer.abstand > VORSCHLAG_ABSTAND ? { vorschlagLage: rund(x, y) } : {}),
        };
    } else {
        plan.stelle += 1;
        const nah = naechster(index.alle, x, y);
        const ortName = nah === undefined ? "" : kuerze(nah.ort.name.trim(), BEZUG_NAME_MAX);
        bezug = { art: "stelle", lage: rund(x, y), ...(ortName === "" ? {} : { naechsterOrt: ortName }) };
    }

    // Kategorie und Art des Fehlenden.
    let kategorie: UebernahmeKategorie;
    let fehltArt: FehltArt | null = null;
    if (m.type === "location") {
        if (treffer !== undefined) kategorie = "angabe";
        else {
            kategorie = "fehlt";
            fehltArt = "ort";
        }
    } else if (m.type === "label") {
        kategorie = "fehlt";
        const art = FEHLT_ART_JE_UNTERTYP[m.subtype.trim()];
        if (art === undefined) befunde.artUnbekannt.push(m.id);
        fehltArt = art ?? "anderes";
    } else if (m.type === "powerline") {
        kategorie = "angabe";
    } else {
        kategorie = "sonstiges";
        if (!TYPEN_SONSTIGES.has(m.type)) befunde.typUnbekannt.push(m.id);
    }

    // Text: der Kommentar; ist er zu kurz, geht der Satz mit der Art und dem Namen davor.
    const kommentar = m.comment.trim();
    let beschreibung = kommentar;
    if (laenge(kommentar) < TEXT_MIN) {
        const name = m.name.trim();
        const satz = `Vorschlag aus der alten Karte: ${artName(m.type, m.subtype.trim())}${name === "" ? "" : ` „${name}“`}.`;
        beschreibung = kommentar === "" ? satz : `${satz} ${kommentar}`;
        plan.aufgefuellt += 1;
    }
    if (laenge(beschreibung) > TEXT_MAX) {
        beschreibung = kuerze(beschreibung, TEXT_MAX);
        befunde.textGekuerzt.push(m.id);
    }

    // Quelle: Quelle und Wiki-Adresse, mit · verbunden; zu lang heißt keine.
    let quelle: string | null = [m.source.trim(), m.wiki_url.trim()].filter((teil) => teil !== "").join(" · ");
    if (quelle === "") quelle = null;
    else if (laenge(quelle) > QUELLE_MAX) {
        quelle = null;
        befunde.quelleZuLang.push(m.id);
    }

    // Melder: nur der Name.
    let melderName: string | null = m.reporter.trim();
    if (melderName === "") melderName = null;
    else if (laenge(melderName) > NAME_MAX) {
        melderName = kuerze(melderName, NAME_MAX);
        befunde.nameGekuerzt.push(m.id);
    }

    return {
        legacyId: m.id,
        kategorie,
        fehltArt,
        text: beschreibung,
        quelle,
        melderName,
        bezug,
        eingegangenAt,
        notiz: notiz(m, x, y),
    };
}

/** Die interne Notiz. 🔴 Nie der Name des Melders. */
function notiz(m: LegacyMeldung, x: number, y: number): string {
    const name = m.name.trim();
    const lage = rund(x, y);
    const kopf =
        `Aus Legacy übernommen: Meldung ${String(m.id)} vom ${datumDeutsch(m.created_at)}, Art ${m.type}/${m.subtype}` +
        `${name === "" ? "" : `, Name „${name}“`}, Lage ${String(lage.x)}/${String(lage.y)}.`;
    const redaktion = m.review_note.trim();
    const voll = redaktion === "" ? kopf : `${kopf} Notiz der Redaktion in Legacy: ${redaktion}`;
    return kuerze(voll, NOTIZ_MAX);
}

/** Der Bezug als JSON für `p_bezug` (genau die Schlüssel von `community_melden`). */
export function bezugJson(bezug: UebernahmeBezug): Record<string, unknown> {
    return { ...bezug };
}
