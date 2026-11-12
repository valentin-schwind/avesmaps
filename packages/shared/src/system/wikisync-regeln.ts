import { Type, type Static, type TLiteral, type TSchema, type TUnion } from "@sinclair/typebox";
import { OperationId, UUID_PATTERN } from "../operation.ts";

/**
 * Die Regelvorschläge der Vorkommen und die Begriffstafel (WikiSync, WI-0253 Scheibe Regelvorschläge, §24; Regelbuch `review/wi-0253/regelbuch/regelbuch.md`):
 *
 *     GET  /api/admin/wikisync/regeln                 die Vorschläge des jüngsten Laufs, gefiltert                     view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/regeln/uebernehmen     { operationId, lauf, vorschlaege }   nur die Ausgewählten         apply_wiki_lore_rules (`editor`) + Passkey
 *     POST /api/admin/wikisync/regeln/zuruecknehmen   { operationId, uebernahme }          eine Übernahme zurück        undo_wikisync_run (`admin`) + Passkey
 *     GET  /api/admin/wikisync/regeln/flaechen        die offenen Flächen mit einer gleichnamigen Fläche ohne Wiki-Schlüssel (aus dem Protokoll des Laufs)   view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/regeln/flaeche-zuweisen       { operationId, flaeche, titel }   der Fläche den Wiki-Artikel zuweisen   edit_map_objects (`editor`), in Production + Passkey
 *     POST /api/admin/wikisync/regeln/flaeche-zuruecknehmen  { operationId, flaeche }          diese Zuweisung zurücknehmen           edit_map_objects (`editor`), in Production + Passkey
 *     GET  /api/admin/wikisync/begriffe               die Begriffstafel: jede Wortfamilie (Kopfwort, Formen) mit ihren Pillen   view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/begriffe               { operationId, baseRevision, aenderungen }   jede Form einer Familie, gespeichert unter dem Kopfwort   manage_canon_tables (`admin`), in Production + Passkey
 *
 * 🔴 Die Ableitung (die Berechnung der Vorschläge) schreibt nichts in die Fachtafeln: Sie entsteht im Auftrag `wiki_vorschau` (Bereich `vorkommen`) und liegt als Protokoll des Laufs da
 * (`wikisync_regel_vorschlag`). Erst „Übernehmen“ legt Regeln an (`lore_rule`, Herkunft `wiki_verbreitung`), und nur die ausgewählten.
 */

export const WIKISYNC_REGELN_URL = "/api/admin/wikisync/regeln";
export const WIKISYNC_REGELN_UEBERNEHMEN_URL = "/api/admin/wikisync/regeln/uebernehmen";
export const WIKISYNC_REGELN_ZURUECK_URL = "/api/admin/wikisync/regeln/zuruecknehmen";
export const WIKISYNC_REGELN_FLAECHEN_URL = "/api/admin/wikisync/regeln/flaechen";
export const WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL = "/api/admin/wikisync/regeln/flaeche-zuweisen";
export const WIKISYNC_REGELN_FLAECHE_ZURUECK_URL = "/api/admin/wikisync/regeln/flaeche-zuruecknehmen";
export const WIKISYNC_BEGRIFFE_URL = "/api/admin/wikisync/begriffe";

const union = <T extends readonly string[]>(werte: T) =>
    Type.Union(werte.map((wert) => Type.Literal(wert))) as unknown as TUnion<{
        -readonly [K in keyof T]: TLiteral<T[K] & string>;
    }>;
/** Nur in Antworten: Im Anfrageinhalt verfälscht ajv eine Vereinigung mit `null` (`docs/regeln/entwicklung.md`). */
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Unsere Begriffe: die Ziele einer Pille
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const WIKISYNC_EBENEN = ["derographisch", "vegetation", "topographie"] as const;
export type WikisyncEbene = (typeof WIKISYNC_EBENEN)[number];

/**
 * Unsere Landschaftsarten, wie Legacys Katalog (`ecosystem_region_type`) und `region.region_type` sie führen: Ebene und Art. Die Bezeichnung steht in den Sprachtafeln
 * (`landscape.type.<art>`), nicht hier. Eine Pille der Begriffstafel zeigt auf genau eine dieser Arten (`vegetation|wald`) oder auf eine Klimazone (`zone|tropisch`).
 */
export const WIKISYNC_LANDSCHAFTSARTEN: readonly { readonly ebene: WikisyncEbene; readonly art: string }[] = [
    { ebene: "vegetation", art: "wald" },
    { ebene: "vegetation", art: "urwald" },
    { ebene: "vegetation", art: "dschungel" },
    { ebene: "vegetation", art: "suempfe_moore" },
    { ebene: "vegetation", art: "steppe" },
    { ebene: "vegetation", art: "graslandschaft" },
    { ebene: "vegetation", art: "tundra" },
    { ebene: "vegetation", art: "auenlandschaft" },
    { ebene: "vegetation", art: "flussland_flusstal" },
    { ebene: "vegetation", art: "wueste" },
    { ebene: "vegetation", art: "wuestenoase" },
    { ebene: "vegetation", art: "kulturlandschaft" },
    { ebene: "vegetation", art: "eislandschaft" },
    { ebene: "vegetation", art: "schneelandschaft" },
    // Neu in Avesmaps3D, nicht aus Legacys Katalog (WI-0301, Betreiber 2026-11-09).
    { ebene: "vegetation", art: "bergtundra" },
    { ebene: "vegetation", art: "savanne" },
    { ebene: "vegetation", art: "heideland" },
    { ebene: "vegetation", art: "oedland" },
    { ebene: "topographie", art: "gebirge" },
    { ebene: "topographie", art: "huegelland" },
    { ebene: "topographie", art: "hochebene" },
    { ebene: "topographie", art: "tiefebene" },
    { ebene: "topographie", art: "tal" },
    { ebene: "topographie", art: "schlucht" },
    { ebene: "topographie", art: "wadi" },
    { ebene: "topographie", art: "gletscher" },
    { ebene: "topographie", art: "see" },
    { ebene: "topographie", art: "meer" },
    { ebene: "topographie", art: "kueste" },
    { ebene: "topographie", art: "flachkueste" },
    { ebene: "topographie", art: "steilkueste" },
    { ebene: "topographie", art: "flussdelta" },
    { ebene: "topographie", art: "insel" },
    { ebene: "derographisch", art: "region" },
    { ebene: "derographisch", art: "inselgruppe" },
    { ebene: "derographisch", art: "kontinent" },
    { ebene: "derographisch", art: "sonstiges" },
];

/** Unsere Klimazonen (`climate_zone_type`), von kalt nach warm. Eine Pille ergibt eine Spanne von der kältesten bis zur wärmsten gewählten Zone. */
export const WIKISYNC_KLIMAZONEN = [
    "polar",
    "subpolar",
    "boreal",
    "gemaessigt",
    "subtropen_winterfeucht",
    "trockene_subtropen",
    "subtropisch",
    "tropisch",
] as const;
export type WikisyncKlimazone = (typeof WIKISYNC_KLIMAZONEN)[number];

/** Die Pille einer Landschaftsart: `<ebene>|<art>`. */
export const wikisyncArtPille = (ebene: string, art: string): string => `${ebene}|${art}`;
/** Die Pille einer Klimazone: `zone|<schluessel>`. */
export const wikisyncZonePille = (zone: string): string => `zone|${zone}`;

const PILLEN_ARTEN: ReadonlySet<string> = new Set(
    WIKISYNC_LANDSCHAFTSARTEN.map((eintrag) => wikisyncArtPille(eintrag.ebene, eintrag.art)),
);
const PILLEN_ZONEN: ReadonlySet<string> = new Set(WIKISYNC_KLIMAZONEN.map((zone) => wikisyncZonePille(zone)));

/** Ist das eine Pille, die es gibt (eine unserer Arten oder Klimazonen)? */
export const wikisyncPilleGueltig = (pille: string): boolean => PILLEN_ARTEN.has(pille) || PILLEN_ZONEN.has(pille);

/** Die Pille in Ebene und Art oder Zone zerlegt; `null`, wo sie keine ist. */
export function wikisyncPilleZerlegt(
    pille: string,
): { art: "art"; ebene: WikisyncEbene; wert: string } | { art: "zone"; wert: WikisyncKlimazone } | null {
    if (PILLEN_ZONEN.has(pille)) return { art: "zone", wert: pille.slice("zone|".length) as WikisyncKlimazone };
    if (!PILLEN_ARTEN.has(pille)) return null;
    const trenner = pille.indexOf("|");
    return { art: "art", ebene: pille.slice(0, trenner) as WikisyncEbene, wert: pille.slice(trenner + 1) };
}

/** Ein Wort der Begriffstafel: kleingeschrieben, Buchstaben und Bindestrich, höchstens 40 Zeichen. */
export const WIKISYNC_WORT_MUSTER = "^[\\p{L}][\\p{L}-]{0,39}$";
export const WIKISYNC_PILLEN_MAX = 8;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Der Vorschlag
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Die Art eines Vorschlags (Mockup „Art des Vorschlags“), in der Rangfolge, nach der die Ableitung sie vergibt. */
export const WIKISYNC_REGEL_TYPEN = [
    "manuell",
    "wartet",
    "negiert",
    "mehrdeutig",
    "unvollstaendig",
    "rueckfrage",
    "vollstaendig",
] as const;
export type WikisyncRegelTyp = (typeof WIKISYNC_REGEL_TYPEN)[number];

/** Was der Vorschlag an den Regeln des Eintrags ändert. */
export const WIKISYNC_REGEL_STATUS = ["neu", "geaendert", "entfaellt", "manuell"] as const;
export type WikisyncRegelStatus = (typeof WIKISYNC_REGEL_STATUS)[number];

export const WIKISYNC_REGEL_ARTEN = ["fauna", "flora", "spezies", "ware"] as const;
export const WIKISYNC_REGEL_BEZIEHUNGEN = ["verbreitung", "vorkommen", "herkunft", "regionen"] as const;

/**
 * Warum etwas nicht in die Regel kam oder eine Rückfrage braucht: die Wörter, die die Oberfläche in ihren Sprachtafeln kennt
 * (`admin.wikisync.regeln.grund.<code>`).
 */
export const WIKISYNC_REGEL_GRUENDE = [
    // nicht abbildbar (Teil)
    "linie",
    "teilflaeche",
    "bezugspunkt",
    "verneinung",
    "frueher",
    "hoehe",
    "unterwelt",
    "fluss",
    "volk",
    "gebiet_mit_art",
    "siedlung",
    "klima_vage",
    "freitext",
    "kein_artikel",
    "begriff_ohne_ort",
    "wort_offen",
    "wort_luecke",
    "nach_verneinung",
    "zu_viele",
    // Rückfrage
    "rand",
    "naehe",
    "unsicher",
    "magisch",
    "klima",
    "ohne",
    "mehrere_links",
    "wort_am_link",
    "klammerzusatz",
    "flaeche_name_im_text",
    "platzhalter_art",
    "ort_im_lebensraum",
    "ganz_dere",
    "ueberall",
    "kein_ort",
    // Großraum ohne Fläche, als Spanne von Klimazonen innerhalb einer umgebenden Fläche gelesen (Begriffstafel, Gruppe `grossraum`)
    "grossraum",
    // Lage zu einer Linie aus dem Wiki gelesen („südlich von Gareth“, „nördlich der Linie Perricum–Havena“): die Orte der Linie sind nach dem Namen gewählt und müssen geprüft werden.
    // 🔴 `lage`, nicht `linie`: `linie` ist schon der Grund eines Satzteils, der NICHT abgebildet wird (Fluss, Küste, Straße).
    "lage",
] as const;
export type WikisyncRegelGrund = (typeof WIKISYNC_REGEL_GRUENDE)[number];

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Lage zu einer Linie
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Die vier Richtungen einer Lage zu einer Linie (WI-0253 §27, WI-0254 Regeleditor; Vali 2026-10-28 zum klickbaren Entwurf: „oh ja das is geil, bau das“): Die Bedingung trifft, was auf der Karte im Norden, Süden,
 * Osten oder Westen der Linie liegt. Nur diese vier; „nordöstlich“ und „nördlich davon“ sind keine Lage, sie bleiben Teile der Ableitung.
 */
export const WIKISYNC_LAGE_RICHTUNGEN = ["nord", "sued", "ost", "west"] as const;
export type WikisyncLageRichtung = (typeof WIKISYNC_LAGE_RICHTUNGEN)[number];

/**
 * Die Ortsarten (`place.subtype`), die ein Ort der Linie sein dürfen: Siedlungen, nicht Gebäude und Stadtviertel. Die Linie läuft durch einen Ort oder zwischen zwei Orten; ein Ort ist nur gewählt, wenn er
 * eindeutig ist (nie geraten), darum steht nur die Siedlung zur Wahl.
 */
export const WIKISYNC_LAGE_ORTSARTEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf"] as const;
export type WikisyncLageOrtsart = (typeof WIKISYNC_LAGE_ORTSARTEN)[number];

export const WikisyncRegelFlaeche = Type.Object(
    {
        /** Der Name der Fläche; bei einer offenen Fläche der Name im Wiki. */
        name: Type.String(),
        /** `region.public_id`; `null`, solange die Fläche (noch) nicht zugewiesen ist. */
        kennung: nullable(Type.String({ pattern: UUID_PATTERN })),
        /** F4 (Vali 2026-10-27): Es gibt (noch) keine Fläche mit diesem Wiki-Schlüssel. Die Regel wartet und zählt nirgends, bis jede Fläche zugewiesen ist. */
        offen: Type.Boolean(),
        /** Der Titel des Wiki-Artikels, über den die Fläche gefunden wird. */
        titel: nullable(Type.String()),
        /** Bei einer offenen Fläche: eine Fläche gleichen Namens ohne Wiki-Schlüssel (nie geraten, nur genannt). */
        kandidat: nullable(Type.String()),
    },
    strict,
);
export type WikisyncRegelFlaeche = Static<typeof WikisyncRegelFlaeche>;

/** Ein Ort der Linie einer Lage: die Siedlung der Karte (`place.public_id`) mit dem Namen und der Stelle, an der sie liegt (Kartenkoordinaten, `y` nach Norden). */
export const WikisyncRegelLageOrt = Type.Object(
    {
        kennung: Type.String({ pattern: UUID_PATTERN }),
        name: Type.String(),
        x: Type.Number(),
        y: Type.Number(),
    },
    strict,
);
export type WikisyncRegelLageOrt = Static<typeof WikisyncRegelLageOrt>;

/**
 * Die Lage zu einer Linie (Bedingung „südlich von Gareth“, „nördlich der Linie Perricum–Havena“, „zwischen A und B“ als zwei Bedingungen mit UND): die Richtung und ein oder zwei Orte.
 *
 * - **Ein Ort:** die Linie läuft waagerecht (Nord, Süd) oder senkrecht (Ost, West) durch ihn. **Zwei Orte:** die Linie läuft durch beide, auf der Karte verlängert; die Reihenfolge der Orte ist ohne Bedeutung
 *   (A–B ist B–A), darum geht sie sortiert in den Fingerabdruck.
 * - Nur die vier Richtungen (`WIKISYNC_LAGE_RICHTUNGEN`); die Orte sind Siedlungen (`WIKISYNC_LAGE_ORTSARTEN`).
 * - Sie steht NEBEN Fläche, Landschaftsart und Klimaspanne und schränkt sie wie diese ein (innerhalb einer Bedingung wirkt immer UND). Eine Bedingung ohne Fläche, Art und Klima, aber mit Lage trifft „alles
 *   südlich von …“ und ist darum keine leere Bedingung.
 */
export const WikisyncRegelLage = Type.Object(
    {
        richtung: union(WIKISYNC_LAGE_RICHTUNGEN),
        orte: Type.Array(WikisyncRegelLageOrt, { minItems: 1, maxItems: 2 }),
    },
    strict,
);
export type WikisyncRegelLage = Static<typeof WikisyncRegelLage>;

export const WikisyncRegelBedingung = Type.Object(
    {
        /** Die Verknüpfung mit dem bisherigen Ergebnis, streng von links nach rechts; `ohne` heißt „bisher minus diese Bedingung“ (F1). Bei der ersten Bedingung bedeutungslos (`und`). */
        verknuepfung: union(["und", "oder", "ohne"] as const),
        flaeche: nullable(WikisyncRegelFlaeche),
        arten: Type.Array(Type.Object({ ebene: Type.String(), art: Type.String() }, strict)),
        klima: nullable(Type.Object({ von: Type.String(), bis: Type.String() }, strict)),
        /** Die Lage zu einer Linie; fehlt, wo die Bedingung keine hat (und in jedem Protokoll vor der Lage: ältere Läufe bleiben gültig). Nie `null`. */
        lage: Type.Optional(WikisyncRegelLage),
        /** Die Wörter des Wikis, aus denen die Arten kamen (Begriffstafel). */
        woerter: Type.Array(Type.String()),
        /** Rückfragen an dieser Bedingung (Wörter aus `WIKISYNC_REGEL_GRUENDE`). */
        rueckfragen: Type.Array(Type.String()),
    },
    strict,
);
export type WikisyncRegelBedingung = Static<typeof WikisyncRegelBedingung>;

export const WikisyncRegelTeil = Type.Object(
    {
        beziehung: union(WIKISYNC_REGEL_BEZIEHUNGEN),
        /** Der Satzteil im Wortlaut des Wikis (Links als Anzeigetext). */
        text: Type.String(),
        grund: Type.String(),
        /** `nicht_abbildbar`: kommt in keine Bedingung (Richtung, Linie, Teilfläche, Bezugspunkt, Freitext …); `rueckfrage`: kommt hinein, braucht aber ein Wort. */
        art: union(["nicht_abbildbar", "rueckfrage"] as const),
    },
    strict,
);
export type WikisyncRegelTeil = Static<typeof WikisyncRegelTeil>;

export const WikisyncRegelBeziehung = Type.Object(
    {
        beziehung: union(WIKISYNC_REGEL_BEZIEHUNGEN),
        status: union(WIKISYNC_REGEL_STATUS),
        bedingungen: Type.Array(WikisyncRegelBedingung),
        /** Die Bedingungen der bisherigen, vom Wiki abgeleiteten Regel (`geaendert`, `entfaellt`); `null`, wo es keine gibt. */
        bisher: nullable(Type.Array(WikisyncRegelBedingung)),
        teile: Type.Array(WikisyncRegelTeil),
        /** Kennung der bisherigen Regel (`lore_rule.id`), wo eine wiki-abgeleitete besteht. */
        bisherId: nullable(Type.String({ pattern: "^[0-9]{1,18}$" })),
    },
    strict,
);
export type WikisyncRegelBeziehung = Static<typeof WikisyncRegelBeziehung>;

export const WIKISYNC_ORIGINAL_ZUSTAENDE = ["ok", "offen", "fehler", "neutral"] as const;
export const WikisyncRegelOriginal = Type.Object(
    {
        feld: union(WIKISYNC_REGEL_BEZIEHUNGEN),
        /** Der Wortlaut des Wikis in der Reihenfolge des Artikels; was die Ableitung gelesen hat (ok), nur teilweise (offen) oder nicht darstellen kann (fehler). */
        teile: Type.Array(
            Type.Object(
                { text: Type.String(), zustand: union(WIKISYNC_ORIGINAL_ZUSTAENDE), trenner: Type.String() },
                strict,
            ),
        ),
    },
    strict,
);
export type WikisyncRegelOriginal = Static<typeof WikisyncRegelOriginal>;

export const WikisyncRegelVorschlag = Type.Object(
    {
        id: Type.Integer(),
        eintrag: Type.Object(
            {
                id: Type.String({ pattern: UUID_PATTERN }),
                name: Type.String(),
                art: union(WIKISYNC_REGEL_ARTEN),
            },
            strict,
        ),
        artikel: nullable(Type.String()),
        typ: union(WIKISYNC_REGEL_TYPEN),
        status: union(WIKISYNC_REGEL_STATUS),
        /** Gelesen vom ganzen Eintrag: Eine Bedingung hat eine Fläche, die es (noch) nicht gibt (F4, „!“). */
        wartet: Type.Boolean(),
        vorgewaehlt: Type.Boolean(),
        waehlbar: Type.Boolean(),
        /** Warum der Vorschlag nicht wählbar ist (`manuell`, `redaktion`, `nichts`). */
        sperre: nullable(Type.String()),
        original: Type.Array(WikisyncRegelOriginal),
        regeln: Type.Array(WikisyncRegelBeziehung),
    },
    strict,
);
export type WikisyncRegelVorschlag = Static<typeof WikisyncRegelVorschlag>;

export const WikisyncRegelLauf = Type.Object(
    {
        id: Type.Integer(),
        beendetAm: nullable(Type.String()),
        dumpStand: nullable(Type.String()),
        /** Die Revision der Begriffstafel, nach der der Lauf rechnete; `null` heißt: nach den Startwerten. */
        begriffeRevision: nullable(Type.Integer()),
        /** Die Begriffstafel hat sich seitdem geändert: die Vorschläge sind nach einer älteren Tafel gerechnet. */
        veraltet: Type.Boolean(),
        /**
         * Seit dem Lauf wurde einer Landschaft ein Wiki-Artikel zugewiesen oder genommen (aus dem Fenster oder aus der Wiki-Box): Die offenen Flächen der Vorschläge sind nach einem älteren Stand der
         * Karte gerechnet. Die Übernahme prüft ohnehin jeden Vorschlag gegen den Stand von jetzt; die Oberfläche gibt sie trotzdem erst nach dem Neuableiten frei.
         */
        flaechenGeaendert: Type.Boolean(),
    },
    strict,
);
export type WikisyncRegelLauf = Static<typeof WikisyncRegelLauf>;

export const WikisyncRegelZahlen = Type.Object(
    {
        /** Einträge mit einer Aussage über Aventurien. */
        mitAussage: Type.Integer(),
        vollstaendig: Type.Integer(),
        teilweise: Type.Integer(),
        garNicht: Type.Integer(),
        nurLebensraum: Type.Integer(),
        ohneAussage: Type.Integer(),
        /** Vorgeschlagen (eine Zeile der Liste) und davon schon gleich (keine Zeile). */
        vorgeschlagen: Type.Integer(),
        gleich: Type.Integer(),
        wartend: Type.Integer(),
    },
    strict,
);
export type WikisyncRegelZahlen = Static<typeof WikisyncRegelZahlen>;

export const WikisyncRegelUebernahme = Type.Object(
    {
        id: Type.Integer(),
        am: Type.String(),
        von: nullable(Type.String()),
        regeln: Type.Integer(),
        stillgelegt: Type.Integer(),
        zurueckgenommenAm: nullable(Type.String()),
    },
    strict,
);
export type WikisyncRegelUebernahme = Static<typeof WikisyncRegelUebernahme>;

export const WikisyncRegelFacetten = Type.Object(
    {
        art: Type.Record(Type.String(), Type.Integer()),
        typ: Type.Record(Type.String(), Type.Integer()),
        status: Type.Record(Type.String(), Type.Integer()),
    },
    strict,
);

export const WikisyncRegelAbfrage = Type.Object(
    {
        art: Type.Optional(union(WIKISYNC_REGEL_ARTEN)),
        typ: Type.Optional(union(WIKISYNC_REGEL_TYPEN)),
        status: Type.Optional(union(WIKISYNC_REGEL_STATUS)),
        q: Type.Optional(Type.String({ maxLength: 120 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type WikisyncRegelAbfrage = Static<typeof WikisyncRegelAbfrage>;

export const WikisyncRegelListe = Type.Object(
    {
        jetzt: Type.String(),
        /** Der jüngste fertige Lauf der Vorschau mit dem Bereich `vorkommen`; `null`, solange keiner vorliegt (unbekannt ist nicht null Vorschläge). */
        lauf: nullable(WikisyncRegelLauf),
        zahlen: nullable(WikisyncRegelZahlen),
        gesamt: Type.Integer(),
        offset: Type.Integer(),
        limit: Type.Integer(),
        facetten: WikisyncRegelFacetten,
        /** Alle vorgewählten Vorschläge des Laufs (nicht nur der Seite): Damit beginnt die Auswahl im Fenster. */
        vorgewaehlt: Type.Array(Type.Integer()),
        vorschlaege: Type.Array(WikisyncRegelVorschlag),
        /** Die jüngsten Übernahmen von Regeln, jede mit dem Zurücknehmen. */
        uebernahmen: Type.Array(WikisyncRegelUebernahme),
    },
    strict,
);
export type WikisyncRegelListe = Static<typeof WikisyncRegelListe>;

export const WikisyncRegelnUebernehmenBody = Type.Object(
    {
        operationId: OperationId,
        lauf: Type.Integer({ minimum: 1 }),
        vorschlaege: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 3000, uniqueItems: true }),
    },
    strict,
);
export type WikisyncRegelnUebernehmenBody = Static<typeof WikisyncRegelnUebernehmenBody>;

export const WikisyncRegelnZuruecknehmenBody = Type.Object(
    { operationId: OperationId, uebernahme: Type.Integer({ minimum: 1 }) },
    strict,
);
export type WikisyncRegelnZuruecknehmenBody = Static<typeof WikisyncRegelnZuruecknehmenBody>;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Offene Flächen: eine gleichnamige Fläche ohne Wiki-Schlüssel bekommt ihren Artikel
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Wie eine offene Fläche (F4) dasteht, wenn es eine Fläche gleichen Namens ohne Wiki-Schlüssel gibt:
 *   zuweisbar   genau eine solche Fläche; der Knopf weist ihr den Artikel zu.
 *   mehrdeutig  mehrere Flächen gleichen Namens ohne Schlüssel: Der Knopf bleibt weg (welche gemeint ist, sagt kein Name), die Wiki-Box im Landschaftseditor weist einer einzelnen zu.
 *   zugewiesen  die Fläche trägt den Artikel jetzt; die Liste muss neu abgeleitet werden. `zuruecknehmbar`, solange die Zuweisung aus diesem Fenster noch so dasteht.
 */
export const WIKISYNC_FLAECHE_ZUSTAENDE = ["zuweisbar", "mehrdeutig", "zugewiesen"] as const;
export type WikisyncFlaecheZustand = (typeof WIKISYNC_FLAECHE_ZUSTAENDE)[number];

export const WikisyncRegelOffeneFlaeche = Type.Object(
    {
        /** Der Titel des Wiki-Artikels, auf den die Regeln warten (so, wie die Bedingung ihn nennt). */
        titel: Type.String(),
        /** Der Name der Fläche auf der Karte, die ihn tragen soll. */
        name: Type.String(),
        /** `region.public_id` dieser Fläche; `null` bei `mehrdeutig`. */
        kennung: nullable(Type.String({ pattern: UUID_PATTERN })),
        /** Wie viele Vorschläge des Laufs auf diese Fläche warten. */
        vorschlaege: Type.Integer(),
        zustand: union(WIKISYNC_FLAECHE_ZUSTAENDE),
        /** Bei `zugewiesen`: Die Zuweisung stammt aus diesem Fenster, die Fläche trägt den Artikel noch so, und seitdem hat niemand an ihrer Zuordnung geändert. */
        zuruecknehmbar: Type.Boolean(),
        /** Bei `zugewiesen`: wann und von wem (aus dem Fachprotokoll). */
        zugewiesenAm: nullable(Type.String()),
        zugewiesenVon: nullable(Type.String()),
    },
    strict,
);
export type WikisyncRegelOffeneFlaeche = Static<typeof WikisyncRegelOffeneFlaeche>;

export const WikisyncRegelFlaechen = Type.Object(
    {
        jetzt: Type.String(),
        /** Der Lauf, aus dessen Protokoll die offenen Flächen stammen; `null`, solange keiner vorliegt. */
        lauf: nullable(Type.Integer()),
        flaechen: Type.Array(WikisyncRegelOffeneFlaeche),
    },
    strict,
);
export type WikisyncRegelFlaechen = Static<typeof WikisyncRegelFlaechen>;

export const WikisyncRegelnFlaecheZuweisenBody = Type.Object(
    {
        operationId: OperationId,
        /** Die Fläche, die den Artikel bekommt (`region.public_id`, aus `WikisyncRegelOffeneFlaeche.kennung`). */
        flaeche: Type.String({ pattern: UUID_PATTERN }),
        /** Der Titel des Wiki-Artikels, wie die offene Bedingung ihn nennt. */
        titel: Type.String({ minLength: 1, maxLength: 300 }),
    },
    strict,
);
export type WikisyncRegelnFlaecheZuweisenBody = Static<typeof WikisyncRegelnFlaecheZuweisenBody>;

export const WikisyncRegelnFlaecheZuruecknehmenBody = Type.Object(
    { operationId: OperationId, flaeche: Type.String({ pattern: UUID_PATTERN }) },
    strict,
);
export type WikisyncRegelnFlaecheZuruecknehmenBody = Static<typeof WikisyncRegelnFlaecheZuruecknehmenBody>;

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Begriffstafel
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Wie sicher ein Startwert ist (`regelbuch-abbildung.json`): `gleichwertig` (Mehrzahl, Synonym, Unterart ohne eigene Art), `naeherung` (nur ungefähr), `offen` (mehrdeutig: startet leer, muss
 * entschieden werden), `luecke` (keine passende Art im Modell), `uebergehen` (Kleinstandort: engt nur ein, wird übergangen), `neu` (ein gefundenes Wort ohne Startwert).
 */
export const WIKISYNC_BEGRIFF_LAGEN = ["gleichwertig", "naeherung", "offen", "luecke", "uebergehen", "neu"] as const;
export type WikisyncBegriffLage = (typeof WIKISYNC_BEGRIFF_LAGEN)[number];

export const WikisyncBegriff = Type.Object(
    {
        /** Das Kopfwort der Familie (kalt, kalte, kalten, kaltes, kälteren sind EINE Zeile): Unter ihm steht die Entscheidung, und es nimmt jede Form der Familie beim Speichern. */
        wort: Type.String(),
        /** Alle Formen der Familie, das Kopfwort zuerst; ein Wort ohne Familie steht allein. */
        formen: Type.Array(Type.String()),
        /** Die Pillen, die jetzt gelten (Startwert oder eigene Wahl). */
        pillen: Type.Array(Type.String()),
        /** Der Startwert (Claudias Näherung); leer bei einem gefundenen Wort. */
        startwert: Type.Array(Type.String()),
        lage: union(WIKISYNC_BEGRIFF_LAGEN),
        /** Eigene Wahl: Die Zeile weicht vom Startwert ab oder ist von Hand angelegt. */
        eigen: Type.Boolean(),
        /** Wie oft die Familie in den Angaben des Wikis vorkommt, die Summe ihrer Formen (aus dem jüngsten Lauf, sonst die Zählung der Analyse); `null`: unbekannt. */
        gesehen: nullable(Type.Integer()),
        hinweis: nullable(Type.String()),
        geaendertAm: nullable(Type.String()),
        geaendertVon: nullable(Type.String()),
    },
    strict,
);
export type WikisyncBegriff = Static<typeof WikisyncBegriff>;

export const WIKISYNC_BEGRIFF_FILTER = ["alle", "offen", "ohne", "zugewiesen", "eigen"] as const;

export const WikisyncBegriffeAbfrage = Type.Object(
    {
        filter: Type.Optional(union(WIKISYNC_BEGRIFF_FILTER)),
        q: Type.Optional(Type.String({ maxLength: 60 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type WikisyncBegriffeAbfrage = Static<typeof WikisyncBegriffeAbfrage>;

export const WikisyncBegriffe = Type.Object(
    {
        jetzt: Type.String(),
        /** Die Revision der Tafel (`baseRevision` beim Speichern). */
        revision: Type.Integer(),
        /** `datenbank` oder `vorgabe` (vor der Migration oder ohne Datenbank gelten die Startwerte). */
        quelle: union(["datenbank", "vorgabe"] as const),
        gesamt: Type.Integer(),
        offset: Type.Integer(),
        limit: Type.Integer(),
        /** Zahl der Wörter je Filter (ohne die anderen Filter). */
        zahlen: Type.Record(Type.String(), Type.Integer()),
        /** Der Lauf, aus dem die Fundzahlen stammen. */
        lauf: nullable(Type.Integer()),
        woerter: Type.Array(WikisyncBegriff),
    },
    strict,
);
export type WikisyncBegriffe = Static<typeof WikisyncBegriffe>;

export const WikisyncBegriffAenderung = Type.Object(
    {
        wort: Type.String({ pattern: WIKISYNC_WORT_MUSTER }),
        /** Die Pillen, die gelten sollen (auch leer: „bewusst keine“). Fehlt sie, muss `zuruecksetzen` gesetzt sein. */
        pillen: Type.Optional(Type.Array(Type.String(), { maxItems: WIKISYNC_PILLEN_MAX, uniqueItems: true })),
        /** ↺: setzt die Zeile auf den Startwert zurück (ein von Hand angelegtes Wort entfällt). */
        zuruecksetzen: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type WikisyncBegriffAenderung = Static<typeof WikisyncBegriffAenderung>;

export const WikisyncBegriffeBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        aenderungen: Type.Array(WikisyncBegriffAenderung, { minItems: 1, maxItems: 50 }),
    },
    strict,
);
export type WikisyncBegriffeBody = Static<typeof WikisyncBegriffeBody>;
