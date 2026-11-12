import { Type, type Static, type TLiteral, type TUnion } from "@sinclair/typebox";
import { INHALTE_VORKOMMEN_ARTEN } from "./inhalte-vorkommen.ts";
import { UUID_PATTERN } from "./operation.ts";
import { PeakRef, PlaceRef, SourceEntry, SubjectWikiLine } from "./subject.ts";
import { VorkommenForm, VorkommenRahmen } from "./vorkommen-treffer.ts";

/**
 * Die Vorkommen in der Spotlight-Suche (WI-0257, Scheibe S3a): Sektion „Vorkommen“, Herrschaftsgebiete als Treffer, kurze Anfragen
 * „Begriff Präposition Ziel“ samt Autovervollständigung, der Weg zum Leuchten und die Beispiele für den Platzhalter. Hier stehen nur
 * die Verträge; gerechnet wird in `apps/server/src/search/` und `apps/server/src/vorkommen/`.
 *
 *     GET /api/search?q=…           wie bisher; neu und nur, wo es etwas gibt: `vorkommen`, `gebiete`, `anfrage`
 *     GET /api/search/leuchten      was für einen Treffer auf der Karte leuchtet (ganze Gegenden, Zuschnitte, Orte, Rahmen für den Flug)
 *     GET /api/search/zahlen        die Zahl der leuchtenden Gegenden für bis zu acht Einträge (die Sektion selbst rechnet nichts)
 *     GET /api/search/beispiele     echte Anfragen mit Treffern für den wechselnden Platzhalter
 *     GET /api/search/eintrag       ein Eintrag für sein Panel: Stammdaten, genannte Orte, Wiki-Adresse und die Ziele der Chips „Wo genau?“ (S3b); seit WI-0260 auch Kurzbeschreibung, Gegenstandstyp,
 *                                   Kontinent, „Wo es vorkommt“ (Gegenden je Name einmal, Orte, auch genannt) und die Publikationen
 *
 * 🔴 **Alles liest nur.** Keine Route dieser Datei schreibt, und die Inhaltsschalter je Art gelten (`panel.lore.<art>`): Ein ausgeblendeter
 * Eintrag fehlt in der Sektion, und sein Leuchten antwortet leer mit `pausiert`.
 *
 * 🪤 Die Namen der Gegenden stehen in den Kartendaten und werden nie übersetzt; die Namen der Landschaftsarten („Wald“) und der
 * Präpositionen sind der deutsche Stamm (wie bei den Klimazonen), die Anzeige in anderen Sprachen bleibt der Sprachtafel des Browsers.
 */

const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const oneOf = <T extends string>(werte: readonly T[]): TUnion<TLiteral<T>[]> =>
    Type.Union(werte.map((wert) => Type.Literal(wert)));
const ZAHL = () => Type.Integer({ minimum: 0 });
/**
 * Ein Ausschnitt `[minX, minY, maxX, maxY]` wie `MapBounds`, aber ohne `$id`: In der Antwort der Suche steht `MapBounds` schon an den Treffern, und dieselbe Kennung an zwei Stellen
 * macht das Antwortschema der Route unbrauchbar (Fastify: „resolves to more than one schema“).
 */
const Ausschnitt = () => Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]);

/** So viele Treffer zeigt eine Sektion oder Gruppe höchstens; die Gesamtzahl steht daneben („… und N weitere“). */
export const SEARCH_VORKOMMEN_SICHTBAR = 5;

export const SEARCH_LEUCHTEN_URL = "/api/search/leuchten";
export const SEARCH_ZAHLEN_URL = "/api/search/zahlen";
export const SEARCH_BEISPIELE_URL = "/api/search/beispiele";
export const SEARCH_EINTRAG_URL = "/api/search/eintrag";

/** So viele Einträge fragt `zahlen` höchstens auf einmal. */
export const SEARCH_ZAHLEN_MAX = 8;

/** Wie viele Landschaften ein Ziel „in …“ höchstens zusammenfasst (gleichnamige Landschaften sind EIN Ziel, `AreaRef.group` hält 63 weitere). */
export const SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX = 64;

// ---------------------------------------------------------------------------------------------------------------------
// Die Grammatik der kurzen Anfragen
// ---------------------------------------------------------------------------------------------------------------------

/** Die Lagen eines Ziels: vier Himmelsrichtungen zu einem Ort und „zwischen“ zwei Orten. */
export const SEARCH_LAGEN = ["nord", "sued", "ost", "west", "zwischen"] as const;
export type SearchLage = (typeof SEARCH_LAGEN)[number];

/**
 * Die Präpositionen der kurzen Anfragen „Begriff Präposition Ziel“ (WI-0257 §4 S3), in der Reihenfolge der Vorschläge.
 *
 * - `gegend`: das Ziel ist eine benannte Landschaft oder ein Herrschaftsgebiet („in Kosch“, „im Kosch“, „auf Maraskan“). Die drei Wörter
 *   sind gleichwertig: Die Wahl der Präposition ändert nichts an der Auswertung.
 * - `ort`: das Ziel ist ein Ort; es leuchtet die Halbebene durch ihn („südlich von Gareth“, die Linie gehört dazu).
 * - `zwei-orte`: „zwischen A und B“; es leuchtet der Streifen zwischen den Linien durch A und B (WI-0253 §27 B: „südlich von A UND nördlich von B“, A der nördlichere Ort; liegen die
 *   Orte eher ost-west auseinander, entsprechend „östlich von A UND westlich von B“ mit senkrechten Linien; beide Linien gehören dazu).
 *
 * `lage` ist der Schlüssel an der Leuchten-Route.
 */
export const SEARCH_PRAEPOSITIONEN: readonly {
    readonly text: string;
    readonly ziel: "gegend" | "ort" | "zwei-orte";
    readonly lage?: SearchLage;
}[] = [
    { text: "in", ziel: "gegend" },
    { text: "im", ziel: "gegend" },
    { text: "auf", ziel: "gegend" },
    { text: "nördlich von", ziel: "ort", lage: "nord" },
    { text: "südlich von", ziel: "ort", lage: "sued" },
    { text: "östlich von", ziel: "ort", lage: "ost" },
    { text: "westlich von", ziel: "ort", lage: "west" },
    { text: "zwischen", ziel: "zwei-orte", lage: "zwischen" },
];

// ---------------------------------------------------------------------------------------------------------------------
// Was leuchten soll: die Anfrage an die Leuchten-Route
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Was für einen Treffer leuchtet, als Anfrage. Genau eines von `eintrag` (ein Vorkommen, `lore_entry.public_id`) und `art` (eine
 * Landschaftsart, z. B. `wald`; dann ist mindestens ein Rahmen nötig) und dazu beliebig viele Rahmen, die einander schneiden:
 *
 * - `landschaften`: die Landschaften des Ziels (`region.public_id`; gleichnamige Landschaften sind EIN Ziel) – ihre Flächen werden vereinigt.
 * - `gebiet`: ein Herrschaftsgebiet (`territory.public_id`), seine feinste Form.
 * - `lage` mit `orte` (`place.public_id`): die Halbebene durch einen Ort oder, bei `zwischen`, der Streifen zwischen den Linien durch zwei Orte.
 *
 * Die Treffer der Suche tragen genau diese Form im Feld `leuchten`; die Route nimmt sie als flache Adresse (Listen mit Komma).
 */
export const SearchLeuchtAnfrage = Type.Object(
    {
        eintrag: Type.Optional(Uuid()),
        art: Type.Optional(Type.String({ pattern: "^[a-z_]{2,40}$" })),
        landschaften: Type.Optional(Type.Array(Uuid(), { minItems: 1, maxItems: SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX })),
        gebiet: Type.Optional(Uuid()),
        lage: Type.Optional(oneOf(SEARCH_LAGEN)),
        orte: Type.Optional(Type.Array(Uuid(), { minItems: 1, maxItems: 2 })),
    },
    strict,
);
export type SearchLeuchtAnfrage = Static<typeof SearchLeuchtAnfrage>;

// ---------------------------------------------------------------------------------------------------------------------
// Was leuchtet: die Antwort der Leuchten-Route
// ---------------------------------------------------------------------------------------------------------------------

/** Ein zugeschnittener Teil einer Landschaft oder eines Herrschaftsgebiets: `form` ist der Teil, der leuchtet. */
export const SearchLeuchtenForm = Type.Object(
    { publicId: Uuid(), name: Type.String(), form: VorkommenForm, rahmen: VorkommenRahmen },
    strict,
);
export type SearchLeuchtenForm = Static<typeof SearchLeuchtenForm>;

/** Ein genannter Ort (oder Gipfel), der als Punkt leuchtet. `art` ist die Ortsklasse (`dorf`, `stadt` …) oder `gipfel`. */
export const SearchLeuchtenOrt = Type.Object(
    { id: Uuid(), name: Type.String(), art: Type.String(), x: Type.Number(), y: Type.Number() },
    strict,
);
export type SearchLeuchtenOrt = Static<typeof SearchLeuchtenOrt>;

/** Worauf sich das Leuchten bezieht (für die Überschrift und die Besucherstatistik). */
export const SearchLeuchtenBegriff = Type.Object(
    {
        name: Type.String(),
        kind: Type.Optional(oneOf(INHALTE_VORKOMMEN_ARTEN)),
        art: Type.Optional(Type.String()),
        eintrag: Type.Optional(Uuid()),
    },
    strict,
);
export type SearchLeuchtenBegriff = Static<typeof SearchLeuchtenBegriff>;

/**
 * Was für einen Treffer auf der Karte leuchtet.
 *
 * - **Ganze Gegenden** als Kennungen (`ganz`, `region.public_id`): die Karte lässt sie über den Kachelfilter leuchten (wie die Mehrfachmarkierung).
 *   **Angeschnittene** Gegenden tragen den Teil, der leuchtet, als Form (auf Rahmen, Klima und Linie zugeschnitten, vereinfacht, eine Nachkommastelle).
 *   Dasselbe für Herrschaftsgebiete (`gebiete`, `territory.public_id`). Was zu keiner Landschaft gehört (eine Regel nur mit Klima oder Lage), steht in `rest`.
 * - **Orte** sind die in der Wiki-Zeile des Eintrags genannten Orte und Gipfel, nie die Siedlungen, in die eine Regel fällt.
 * - **`rahmen`** ist der gemeinsame Rahmen aller Treffer für den Flug; `null`, wo nichts leuchtet oder nur der Kontinent bleibt.
 * - **`nurKontinent`:** Nach „Ortszeile neben Regel“ (WI-0257 F2) bleibt nur die Zeile „Aventurien“: nichts leuchtet gefüllt, die Oberfläche zeigt
 *   den Kontinent (`kontinent`) als Umriss ohne Füllung mit „überall in Aventurien“. Mit einem Rahmen („Karotte in Kosch“) gilt das nicht: Was überall
 *   vorkommt, kommt auch dort vor, und es leuchtet der Rahmen selbst.
 * - **`gegenden`** zählt die Gegenden, die leuchten (Landschaften und Herrschaftsgebiete, ganze und angeschnittene); `rest` und Orte zählen nicht mit.
 * - **`pausiert`:** Die Art ist durch den Inhaltsschalter ausgeblendet; alles ist leer, auch der Name.
 */
export const SearchLeuchten = Type.Object(
    {
        titel: Type.String(),
        begriff: SearchLeuchtenBegriff,
        pausiert: Type.Boolean(),
        ganz: Type.Array(Uuid()),
        angeschnitten: Type.Array(SearchLeuchtenForm),
        rest: Type.Optional(Type.Object({ form: VorkommenForm, rahmen: VorkommenRahmen }, strict)),
        gebiete: Type.Object({ ganz: Type.Array(Uuid()), angeschnitten: Type.Array(SearchLeuchtenForm) }, strict),
        orte: Type.Array(SearchLeuchtenOrt),
        gegenden: ZAHL(),
        rahmen: Type.Union([VorkommenRahmen, Type.Null()]),
        nurKontinent: Type.Boolean(),
        kontinent: Type.Optional(
            Type.Object({ publicId: Uuid(), name: Type.String(), rahmen: VorkommenRahmen }, strict),
        ),
    },
    strict,
);
export type SearchLeuchten = Static<typeof SearchLeuchten>;

/** Die Zahlen eines Eintrags, ohne die Formen (die Sektion „Vorkommen“ rechnet nichts; die Zahlen holt die Oberfläche hinterher). */
export const SearchZahl = Type.Object(
    { id: Uuid(), gegenden: ZAHL(), orte: ZAHL(), nurKontinent: Type.Boolean() },
    strict,
);
export type SearchZahl = Static<typeof SearchZahl>;

export const SearchZahlen = Type.Object({ zahlen: Type.Array(SearchZahl) }, strict);
export type SearchZahlen = Static<typeof SearchZahlen>;

// ---------------------------------------------------------------------------------------------------------------------
// Die Sektionen der Trefferliste
// ---------------------------------------------------------------------------------------------------------------------

/** Wodurch ein Vorkommen gefunden wurde. */
export const SEARCH_VORKOMMEN_FUNDE = ["name", "synonym", "gruppe"] as const;

/**
 * Ein Vorkommen als Suchtreffer. `gruppe` ist der Wiki-Text ohne Auszeichnung („Gras“, nicht `[[Gras]]`); `synonym` der weitere Name, über den der Eintrag
 * gefunden wurde. `kartenbezug` sagt, ob es Regeln oder aufgelöste Ortszeilen gibt: ohne ihn leuchtet nichts („noch kein Ort auf der Karte“).
 * `leuchten` ist die Anfrage an die Leuchten-Route.
 */
export const SearchVorkommenHit = Type.Object(
    {
        id: Uuid(),
        name: Type.String(),
        kind: oneOf(INHALTE_VORKOMMEN_ARTEN),
        gefundenIn: oneOf(SEARCH_VORKOMMEN_FUNDE),
        synonym: Type.Optional(Type.String()),
        gruppe: Type.Optional(Type.String()),
        kartenbezug: Type.Boolean(),
        leuchten: SearchLeuchtAnfrage,
    },
    strict,
);
export type SearchVorkommenHit = Static<typeof SearchVorkommenHit>;

/** Höchstens `SEARCH_VORKOMMEN_SICHTBAR` Treffer; `total` ist die Zahl aller („… und N weitere“). */
export const SearchVorkommenSektion = Type.Object({ hits: Type.Array(SearchVorkommenHit), total: ZAHL() }, strict);
export type SearchVorkommenSektion = Static<typeof SearchVorkommenSektion>;

/**
 * Ein Herrschaftsgebiet als Suchtreffer: nur Gebiete mit einer Form. `id` ist `territory.public_id`; `bounds` der Ausschnitt seiner feinsten
 * Form für den Flug, `x`/`y` der Punkt seiner Beschriftung.
 *
 * 🪤 Die Gebiete stehen in einer eigenen Sektion neben `hits`, nicht als fünfte Art in `SearchHitKind`: Sonst belegten sie den gemeinsamen
 * Deckel der Trefferliste, und jede Oberfläche, die die Arten ausschöpfend behandelt, brächte sie ungewollt mit.
 */
export const SearchGebietHit = Type.Object(
    {
        id: Uuid(),
        name: Type.String(),
        typ: Type.Optional(Type.String()),
        x: Type.Number(),
        y: Type.Number(),
        bounds: Ausschnitt(),
    },
    strict,
);
export type SearchGebietHit = Static<typeof SearchGebietHit>;

export const SearchGebietSektion = Type.Object({ hits: Type.Array(SearchGebietHit), total: ZAHL() }, strict);
export type SearchGebietSektion = Static<typeof SearchGebietSektion>;

// ---------------------------------------------------------------------------------------------------------------------
// Die kurze Anfrage „Begriff Präposition Ziel“
// ---------------------------------------------------------------------------------------------------------------------

/** Wofür ein Ziel steht. */
export const SEARCH_ZIEL_ARTEN = ["landschaft", "gebiet", "ort"] as const;

/**
 * Ein Ziel der Anfrage, zugleich Vorschlag der Autovervollständigung. `text` ist der ganze Anfragetext („Wirselkraut in Bornland“), den die
 * Oberfläche in das Feld setzt. Mit `leuchten` ist die Anfrage vollständig und kann leuchten; ohne es ergänzt der Treffer nur den Text
 * („zwischen Gareth und …“). `genannt`: das Ziel steht in einer Wiki-Zeile des Eintrags („im Wiki genannt“). `genau`: der Name ist
 * genau das Getippte.
 *
 * `gegenden` und `orte` sind die Zahlen, die beim Wählen leuchten würden – dieselbe Rechnung wie die Leuchten-Route, also dieselbe Zahl.
 */
export const SearchZielHit = Type.Object(
    {
        name: Type.String(),
        typ: Type.Optional(Type.String()),
        genannt: Type.Boolean(),
        genau: Type.Boolean(),
        gegenden: Type.Optional(ZAHL()),
        orte: Type.Optional(ZAHL()),
        text: Type.String(),
        leuchten: Type.Optional(SearchLeuchtAnfrage),
    },
    strict,
);
export type SearchZielHit = Static<typeof SearchZielHit>;

/**
 * Eine Gruppe von Zielen. `hits` sind höchstens `SEARCH_VORKOMMEN_SICHTBAR`; `total` zählt die Ziele mit Treffern, die gerechnet wurden. 🔴 Es wird
 * höchstens eine feste Zahl von Zielen gerechnet (Kosten); `ungeprueft` nennt, wie viele passende Ziele darüber hinaus nicht gerechnet wurden – nie eine stille Kappung.
 */
export const SearchZielGruppe = Type.Object(
    { art: oneOf(SEARCH_ZIEL_ARTEN), hits: Type.Array(SearchZielHit), total: ZAHL(), ungeprueft: ZAHL() },
    strict,
);
export type SearchZielGruppe = Static<typeof SearchZielGruppe>;

/**
 * Was die Suche an der Anfrage verstanden hat. Steht nur da, wo der Anfang ein Begriff ist: ein Vorkommen (genauer Name oder weiterer Name) oder eine
 * Landschaftsart (deutscher Name oder Schlüssel). Nichts wird geraten: Ein unbekanntes Wort bleibt eine gewöhnliche Volltextsuche ohne `anfrage`.
 *
 * - `praepositionen`: noch keine ganze Präposition: die passenden Vorschläge (nach dem Begriff alle, danach die, die zum Getippten passen).
 * - `praeposition` und `ziele`: die Präposition steht; `ziele` sind die Ziele, an denen der Begriff leuchtet (nur Ziele mit Treffern). Ohne Getipptes nach
 *   der Präposition sind es die Ziele, an denen er gelistet ist: zuerst die im Wiki genannten, dann die größten Gegenden und Gebiete mit Treffern.
 *   Leer heißt „keine Orte mit Treffern“. Fehlt `ziele` bei ganzer Präposition, wurde nicht gerechnet (die Rechnung war überlastet): erneut fragen, nicht „keine Treffer“ zeigen.
 */
export const SearchAnfrage = Type.Object(
    {
        begriff: SearchLeuchtenBegriff,
        praepositionen: Type.Optional(Type.Array(Type.String())),
        praeposition: Type.Optional(Type.String()),
        ziele: Type.Optional(Type.Array(SearchZielGruppe)),
    },
    strict,
);
export type SearchAnfrage = Static<typeof SearchAnfrage>;

// ---------------------------------------------------------------------------------------------------------------------
// Beispiele für den Platzhalter
// ---------------------------------------------------------------------------------------------------------------------

export const SEARCH_BEISPIEL_ARTEN = ["ort", "vorkommen", "vorkommen-in", "landschaftsart-lage"] as const;

/** Eine echte Anfrage mit Treffern, serverseitig geprüft; `gegenden` nennt, wie viele Gegenden leuchten (fehlt beim Ort). */
export const SearchBeispiel = Type.Object(
    { text: Type.String(), art: oneOf(SEARCH_BEISPIEL_ARTEN), gegenden: Type.Optional(ZAHL()) },
    strict,
);
export type SearchBeispiel = Static<typeof SearchBeispiel>;

export const SearchBeispiele = Type.Object({ beispiele: Type.Array(SearchBeispiel) }, strict);
export type SearchBeispiele = Static<typeof SearchBeispiele>;

// ---------------------------------------------------------------------------------------------------------------------
// Das Panel eines Eintrags
// ---------------------------------------------------------------------------------------------------------------------

/** Was eine Gegend des Eintrags ist: eine benannte Landschaft oder ein Herrschaftsgebiet. */
export const SEARCH_EINTRAG_GEGEND_ARTEN = ["landschaft", "gebiet"] as const;

/**
 * Wie der Eintrag zu einer Gegend steht: `verbreitung` (das Wiki nennt sie als Verbreitung oder Heimat), `herkunft` (das Wiki nennt sie als Herkunft einer Ware) oder `regel` (sie folgt nur aus
 * einer Regel, meist dem Lebensraum, und steht nicht im Wiki).
 */
export const SEARCH_EINTRAG_RELATIONEN = ["verbreitung", "herkunft", "regel"] as const;

/** Wie viele Gegenden je Beziehung mitkommen (die übrigen leuchten trotzdem, `SearchEintragWo.weitere` zählt sie): ein Wildschwein lebt in 2.800 Gegenden, und die Liste zeigt höchstens vierzig. */
export const SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG = 60;

/**
 * Eine Gegend, in der der Eintrag vorkommt. JEDE Gegend steht einmal je Name und Art: Eine Gegend, die als Region, Moor und Tiefebene gezeichnet ist („Nebelmoor“), ist EINE Zeile.
 *
 * - `name` ist der Name der Karte, nie ein Griff („Wald-003“). `typ` ist der Schlüssel der obersten Landschaftsart des Namens (Region vor Topographie vor Vegetation: `region`, `tiefebene`, `suempfe_moore` …),
 *   bei einem Herrschaftsgebiet dessen Art als Wort („Grafschaft“, „Baronie“).
 * - `ziel` ist die Anfrage an die Leuchten-Route, die nur diese Gegend leuchten lässt (der Eintrag, geschnitten auf diese Gegend); dieselbe Form, die ein Chip an `waehle` des Zugangs gibt.
 * - `key` ist stabil über Abrufe (`landschaft:nebelmoor`) und taugt als Schlüssel der Zeile.
 */
export const SearchEintragGegend = Type.Object(
    {
        key: Type.String({ minLength: 1 }),
        name: Type.String({ minLength: 1 }),
        kind: oneOf(SEARCH_EINTRAG_GEGEND_ARTEN),
        typ: Type.String(),
        relation: oneOf(SEARCH_EINTRAG_RELATIONEN),
        ziel: SearchLeuchtAnfrage,
    },
    strict,
);
export type SearchEintragGegend = Static<typeof SearchEintragGegend>;

/** Wie der Eintrag zu einem genannten Ort steht: Orte folgen nie einer Regel. */
export const SEARCH_EINTRAG_ORT_RELATIONEN = ["verbreitung", "herkunft"] as const;

/** Ein genannter Ort oder Gipfel (`klasse`: `dorf`, `stadt` … `berggipfel`, `vulkan`); `ref` ist sein Objektlink. */
export const SearchEintragOrt = Type.Object(
    {
        ref: Type.Union([PlaceRef, PeakRef]),
        name: Type.String({ minLength: 1 }),
        klasse: Type.String({ minLength: 1 }),
        relation: oneOf(SEARCH_EINTRAG_ORT_RELATIONEN),
    },
    strict,
);
export type SearchEintragOrt = Static<typeof SearchEintragOrt>;

/**
 * Wo ein Eintrag vorkommt, ohne Zahlen:
 *
 * - `gegenden`: die Gegenden, die für den Eintrag leuchten (ganze und angeschnittene Landschaften und Herrschaftsgebiete), je Name und Art einmal; zuerst die Herkunft, dann die Verbreitung, dann die Gegenden aus
 *   einer Regel, innerhalb davon nach Name. Höchstens `SEARCH_EINTRAG_GEGENDEN_JE_BEZIEHUNG` je Beziehung (bei den Regeln die größten); `weitere` nennt, wie viele Gegenden darüber hinaus leuchten.
 * - `orte`: die im Wiki genannten Orte und Gipfel, die auf der Karte stehen, nach Name.
 * - `auchGenannt`: Orte des Wikis ohne Kartenbezug (kein Treffer auf der Karte, ein anderer Kontinent) als Text, in der Reihenfolge des Artikels. Der Kontinent „Aventurien“ selbst steht nie hier.
 *
 * Nennt der Eintrag nur den Kontinent, sind `gegenden` und `orte` leer und `SearchEintrag.nurKontinent` gesetzt.
 */
export const SearchEintragWo = Type.Object(
    {
        gegenden: Type.Array(SearchEintragGegend),
        orte: Type.Array(SearchEintragOrt),
        auchGenannt: Type.Array(Type.String()),
        weitere: Type.Optional(ZAHL()),
    },
    strict,
);
export type SearchEintragWo = Static<typeof SearchEintragWo>;

/**
 * Ein Eintrag für sein Panel (WI-0257, S3b): was die Sektion „Vorkommen“ nicht trägt – Lebensraum, die genannten Orte, die Wiki-Adresse – und die Ziele der Chips „Wo genau?“.
 *
 * - `gruppe`, `lebensraum`, `weitereNamen` und `genanntIn` stehen ohne Wiki-Auszeichnung (wie die Sektion); `genanntIn` sind die Titel der Ortszeilen in ihrer Reihenfolge, gleich ob sie aufgelöst wurden.
 * - `wiki`: die Wikizeile des Artikels (Adresse, Titel, Korpus, Lizenz und Namensnennung aus dem gemeinsamen Katalog, wie bei jedem Subject), nur wenn die Adresse auf die Wiki Aventurica zeigt
 *   (alles andere bleibt Text, wie im Panel der Orte).
 * - `ziele` sind die im Wiki GENANNTEN Landschaften und Herrschaftsgebiete mit Treffern, jedes mit der Zahl der Gegenden, die dort leuchten, und der Anfrage dafür (`leuchten`); höchstens `SEARCH_VORKOMMEN_SICHTBAR`
 *   je Art. Dieselbe Rechnung und dieselben Zahlen wie die Autovervollständigung nach „… in “.
 * - `gegenden`, `orte`, `nurKontinent`: das Leuchten des ganzen Eintrags (der Chip „alle“); `leuchten` ist seine Anfrage.
 * - Eine durch den Inhaltsschalter ausgeblendete Art gibt es hier nicht (404, wie bei `leuchten`).
 *
 * Neu mit WI-0260 (Infobox neu; die Felder oben bleiben bis zum nächsten Release, `ziele` ist der alte Weg der Chips):
 * - `kurzbeschreibung`: `lore_entry.kurzbeschreibung`, der Anfang des Wiki-Artikels ohne Auszeichnung; `null`, wo der WikiSync keinen erfasst hat. Der Text steht unter der Lizenz der Wiki Aventurica (`wiki.license`).
 * - `typ`: der Gegenstandstyp einer Ware („Speise“, „Hartwurst“) ohne Auszeichnung; `null` bei allen anderen Arten. `kontinent`: `lore_entry.continent` mit „/“ ohne Leerraum („Myranor/Güldenland“); `null`: nicht erkannt.
 * - `wo`: wo es vorkommt, ohne Zahlen (siehe `SearchEintragWo`).
 * - `publikationen`: die Quellen des Eintrags in der Reihenfolge des Wikis (`SourceEntry`, derselbe Typ wie `GET /api/subjects/…/sources`): Mit `referenceKind` eine Publikation (ausführlich, ergänzend, erwähnt),
 *   ohne eine von Hand zugeordnete Quelle. Das Gerüst des Quellenkastens der übrigen Infoboxen nimmt sie ohne Umbau.
 *
 * Neu mit WI-0299: `liste`, die Adresse der Unterseite `<Artikel>/Liste` im Wiki (Varianten und Einzelexemplare, etwa Langschwert/Liste); sie fehlt, wo der WikiSync keine im Dump gefunden hat.
 */
export const SearchEintrag = Type.Object(
    {
        id: Uuid(),
        name: Type.String(),
        kind: oneOf(INHALTE_VORKOMMEN_ARTEN),
        gruppe: Type.Optional(Type.String()),
        weitereNamen: Type.Optional(Type.Array(Type.String())),
        lebensraum: Type.Optional(Type.String()),
        genanntIn: Type.Optional(Type.Array(Type.String())),
        wiki: Type.Optional(SubjectWikiLine),
        liste: Type.Optional(Type.String()),
        kartenbezug: Type.Boolean(),
        gegenden: ZAHL(),
        orte: ZAHL(),
        nurKontinent: Type.Boolean(),
        leuchten: SearchLeuchtAnfrage,
        ziele: Type.Array(SearchZielHit),
        kurzbeschreibung: Type.Union([Type.String(), Type.Null()]),
        typ: Type.Union([Type.String(), Type.Null()]),
        kontinent: Type.Union([Type.String(), Type.Null()]),
        wo: SearchEintragWo,
        publikationen: Type.Array(SourceEntry),
    },
    strict,
);
export type SearchEintrag = Static<typeof SearchEintrag>;
