import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CatalogLink } from "./catalog-links.ts";
import { GEFAHREN_ARTEN } from "./gefahren.ts";
import { LORE_ROW_LIMIT, LoreCounts, LoreKindLiteral, type LoreGroup } from "./lore.ts";
import { AVENTURIA } from "./map-domain-registry.ts";
import { LANDSCAPE_LAYERS, type LandscapeLayer } from "./map-views.ts";
import { MediaPublicView } from "./media.ts";
import { ROUTE_WAYPOINT_LIMIT } from "./route.ts";
import { MapBounds } from "./map-bounds.ts";

/**
 * Der Subject-Vertrag des Infopanels (WI-0063 P4, `project-control/work-items/WI-0063-p4-subject-und-lesevertrag.md`).
 *
 * Ein SUBJECT ist der Gegenstand, über den das Infopanel spricht. Er wird nie über seinen Anzeigenamen identifiziert
 * (WI-0063 Abschnitt 7, Kapitel 7.6), sondern über die stabile Kennung seiner Fachdomäne. Es gibt EINEN Vertrag für die
 * Kennung (`SubjectRef`), EINEN Weg, ein Subject zu öffnen (Karte, Suche, Objektlink, Planer) und EINEN Lesevertrag je
 * Subject. Kein HTML, kein Markup: Wiki-Text kommt als Rohtext mit Provenienz.
 *
 * 🔴 Der Server lässt leere Felder weg (WI-0063 5.3): ein Feld, eine Liste oder ein Zähler ohne Inhalt steht nicht in
 * der Antwort, und `counts` nennt nur Sektionen, die es gibt - nie `0`.
 *
 * 🪤 Jede Antwort trägt `revision`: der Client cacht nur unter diesem Schlüssel und kurz (WI-0063 19).
 *
 * Koordinaten in Karteneinheiten (`aventuria-v1`, ADR-0003), wie jede andere Antwort des Servers. Es gibt keine
 * erfundene Länge/Breite (WI-0063 4.9).
 */

export const SUBJECT_API_BASE = "/api/subjects";
export const SUBJECT_MAP_POINT_URL = `${SUBJECT_API_BASE}/map-point`;
export const SUBJECT_RESOLVE_LINK_URL = `${SUBJECT_API_BASE}/resolve-link`;

export const SUBJECT_LIMITS = {
    /** Abfragen je Prozess gleichzeitig; mehr belegten den Pool (sonst 503 `busy`), wie `/api/areas/at`. */
    concurrent: 4,
    /** Zeitgrenze je Abfrage in PostgreSQL (ms), wie `/api/areas/at`: Punkt, Ort, Gebiet, Gipfel. */
    statementMs: 1000,
    /**
     * Zeitgrenze für Flächen und Linien (ms): Schnitte mit Gebieten und Landschaften rechnen in GEOS und brauchen für
     * große Flächen länger als ein Punkt; derselbe Wert wie bei den Landschaften der Route (`ROUTE_LANDSCAPE_LIMITS`).
     */
    geometryStatementMs: 2000,
    /** Wie lang eine Antwort im Browser liegen darf (Sekunden); die `revision` trennt Stände. */
    cacheSeconds: 60,
} as const;

/** Fünf Bildpunkte sind bei Zoom 1 rund 5 E: so weit (E) sucht ein Kartenpunkt Flüsse um sich herum. */
export const MAP_POINT_RIVER_REACH = 4;

/** Ein Gebiet unter diesem Anteil einer Fläche fällt aus dem Kontext (die Nachbarflächen überlappen an Rändern knapp). */
export const AREA_TERRITORY_MIN_SHARE = 0.01;
/** Eine Landschaft unter diesem Anteil einer Fläche fällt aus dem Kontext (wie `LANDSCAPE_MIN_SHARE` der Route). */
export const AREA_LANDSCAPE_MIN_SHARE = 0.05;
/** Ab diesem Anteil „liegt“ eine Fläche in einem Gebiet (Betreiber/Entwurf: 99 %), darunter „überlappt“ sie es. */
export const AREA_CONTAINED_SHARE = 0.99;
/** Mehr Landschaften nennt der Kontext einer Fläche oder eines Verlaufs nicht. */
export const AREA_LANDSCAPE_LIMIT = 20;
/** Mehr Gebietsketten nennt der Kontext einer Fläche nicht (der Kontinent schneidet über 20 Gebiete); die größten Anteile zuerst. */
export const AREA_TERRITORY_CHAIN_LIMIT = 12;

/** Die Form einer öffentlichen Kennung, klein geschrieben; EINE Stelle für jeden Vertrag, der eine nennt. */
export const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const strict = { additionalProperties: false } as const;
const Uuid = (): ReturnType<typeof Type.String> => Type.String({ pattern: UUID_PATTERN });
const { bounds: WORLD } = AVENTURIA.coordinateSpace;

/** Die Arten, für die es einen Detail-Endpunkt gibt (`GET /api/subjects/{kind}/{id}`). */
export const SUBJECT_DETAIL_KINDS = ["place", "path", "area", "territory", "peak", "powerline"] as const;
export type SubjectDetailKind = (typeof SUBJECT_DETAIL_KINDS)[number];

/**
 * Alle Arten, die ein Subject haben kann. `routeStage` lebt im Planer; `climate` hat nur einen Kopf (Name, Art, Ziel; WI-0063 27.12); `loreEntry` ist der Eintrag eines Vorkommens
 * (Flora, Fauna, Ware, Spezies; WI-0257 S3b), dessen Panel seine eigene Leseroute fragt (`/api/search/eintrag`) und keinen Detail-Endpunkt hat.
 *
 * `sprache` (WI-0261 S5b) hat einen Detail-Endpunkt (`/api/subjects/sprache/{id}`), steht aber wie `climate` NICHT unter `SUBJECT_DETAIL_KINDS`: Jene Arten sind Träger
 * der Sektionen, des Kanons und der Vorkommen (Tafeln je Art in `apps/server/src/subjects/`); eine Sprache trägt nichts davon. Ihre Felder, Treffer und Quellen bringt die
 * Detailantwort selbst mit (`SubjectDetail.sprache`).
 *
 * `wetterSymbol` (WI-0288, Betreiber 2026-11-08: „ja infopanel bauen“) ist ein Wetter-Icon MIT Wiki-Verweis: Detail-Endpunkt `/api/subjects/wetter-symbol/{id}` wie die
 * Sprache, ohne Sektionen. Ein Icon ohne Verweis ist kein Subject (der Endpunkt antwortet 404).
 */
export const SUBJECT_KINDS = [
    ...SUBJECT_DETAIL_KINDS,
    "routeStage",
    "mapPoint",
    "climate",
    "loreEntry",
    "sprache",
    "wetterSymbol",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** Die Wegarten, die eine alte Kette `Name:Wegtyp` (vor WI-0177 Schritt 2b) am Ende tragen kann (`path.subtype`). */
export const SUBJECT_PATH_SUBTYPES = [
    "Reichsstrasse",
    "Strasse",
    "Weg",
    "Pfad",
    "Gebirgspass",
    "Wuestenpfad",
    "Flussweg",
    "Seeweg",
] as const;

// ---------------------------------------------------------------------------------------------------------------
// SubjectRef
// ---------------------------------------------------------------------------------------------------------------

export const PlaceRef = Type.Object({ kind: Type.Literal("place"), id: Uuid() }, strict);
export type PlaceRef = Static<typeof PlaceRef>;

/**
 * Ein Weg ist die GRUPPE seiner Abschnitte, nicht ein Abschnitt (`subject-details.yaml`, `wege`). Die Kennung nennt
 * immer ein ANKERSEGMENT (`anchor`, `path.public_id`) und löst die Gruppe daraus auf, nie aus dem Anzeigenamen.
 * - `wiki`: der `wiki_key` des Artikels, wenn der Anker zu mehreren Wegen gehört (Hauptzuweisung plus weitere); ohne
 *   Angabe gilt die Hauptzuweisung, sonst der Name, sonst das Einzelsegment.
 * - `chain`: der Kettenschlüssel `name:<Name>` der Suche und der Kartenauswahl (`pathCandidates`), solange kein Abschnitt bekannt
 *   ist; der Server nimmt dann den kleinsten Abschnitt der Kette als Anker. Ein Weg ist sein Name, über Wegtypen hinweg (WI-0177
 *   Schritt 2b, Legacys Regel (c)); das alte `Name:Wegtyp` liest `parsePathChain` weiter.
 * Die ANTWORT des Servers nennt immer den kanonischen Anker (den kleinsten Abschnitt der Gruppe) und bei einem
 * Wiki-Weg den `wiki`-Schlüssel.
 */
export const PathRef = Type.Union([
    Type.Object(
        {
            kind: Type.Literal("path"),
            anchor: Uuid(),
            chain: Type.Optional(Type.String({ minLength: 3, maxLength: 300 })),
            wiki: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        },
        strict,
    ),
    Type.Object(
        {
            kind: Type.Literal("path"),
            chain: Type.String({ minLength: 3, maxLength: 300 }),
            wiki: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        },
        strict,
    ),
]);
export type PathRef = Static<typeof PathRef>;

/**
 * Eine Landschaft, ein See, ein Gewässer: `region.public_id`, nie die Kennung einer Beschriftung. `group` nennt die
 * weiteren Regionen gleichen Namens, gleicher Art und gleicher Ebene (WI-0047: „Archipel der Perlen“ sind fünf Regionen
 * und EIN Subject); die ANTWORT nennt sie immer, mit der kleinsten Kennung als `id`.
 */
export const AreaRef = Type.Object(
    {
        kind: Type.Literal("area"),
        id: Uuid(),
        group: Type.Optional(Type.Array(Uuid(), { minItems: 1, maxItems: 63 })),
    },
    strict,
);
export type AreaRef = Static<typeof AreaRef>;

export const TerritoryRef = Type.Object({ kind: Type.Literal("territory"), id: Uuid() }, strict);
export type TerritoryRef = Static<typeof TerritoryRef>;

/** Gipfel und Vulkane: `terrain_peak.public_id`. */
export const PeakRef = Type.Object({ kind: Type.Literal("peak"), id: Uuid() }, strict);
export type PeakRef = Static<typeof PeakRef>;

/** Eine Kraftlinie ist wie ein Weg die Gruppe ihrer Segmente (Wiki-Schlüssel, sonst Name); `anchor` ist ein Segment. */
export const PowerlineRef = Type.Object({ kind: Type.Literal("powerline"), anchor: Uuid() }, strict);
export type PowerlineRef = Static<typeof PowerlineRef>;

/** Eine Etappe lebt im Planer, nicht auf dem Server: wechselt die Reise (`routeKey`), ist der Subject veraltet. */
export const RouteStageRef = Type.Object(
    {
        kind: Type.Literal("routeStage"),
        index: Type.Integer({ minimum: 0, maximum: 9999 }),
        routeKey: Type.String({ minLength: 1, maxLength: 2000 }),
    },
    strict,
);
export type RouteStageRef = Static<typeof RouteStageRef>;

/** Die Landschaftsebenen, die ein Kartenpunkt nennen darf (`LANDSCAPE_LAYERS`), als Schema für Ref und Abfrage. */
const LandscapeLayerName = Type.Union(LANDSCAPE_LAYERS.map((layer) => Type.Literal(layer)));
/** Dieselben Ebenen als Gruppe eines Musters - für die Komma-Schreibweise der Abfrage. */
const LANDSCAPE_LAYER_GROUP = `(${LANDSCAPE_LAYERS.join("|")})`;

/**
 * Eine freie Kartenstelle in `aventuria-v1`, auf 0,01 gerundet. Nie eine erfundene Länge/Breite.
 *
 * `layers`: die Landschaftsebenen, die in der ANSICHT des Fragenden teilnehmen (WI-0083 Nachtrag, Betreiber 2026-10-05
 * „ja“: „Was ist hier?“ nennt nur noch die aktive Ansicht). Kein Teil der Kennung des Punkts, sondern ein Hinweis, der
 * die ANTWORT formt - genau wie `wiki` an einem Weg, und wie dort zählt er im `subjectKey` mit, damit der Cache zwei
 * Ansichten trennt. Ohne Angabe antwortet der Endpunkt wie bisher, mit allen Ebenen (alte Links, fremde Aufrufer).
 */
export const MapPointRef = Type.Object(
    {
        kind: Type.Literal("mapPoint"),
        x: Type.Number({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y: Type.Number({ minimum: WORLD.minY, maximum: WORLD.maxY }),
        layers: Type.Optional(
            Type.Array(LandscapeLayerName, { minItems: 1, maxItems: LANDSCAPE_LAYERS.length, uniqueItems: true }),
        ),
    },
    strict,
);
export type MapPointRef = Static<typeof MapPointRef>;

/**
 * Ein Klimaband (`climate_zone_type.type_key`). Ein Gegenstand NUR mit Kopf (WI-0063 27.12, Legacy `showEcosystemAreaInfopanel`: Name und
 * „Klimazonen“, keine Felder, keine Aktion): Er ist das Ziel eines Objektlinks aus der Klimazone-Zeile des Panels und trägt Name, Art und das
 * Ziel der Kamera; Felder, Quellen und Kanon hat er nicht.
 */
export const ClimateRef = Type.Object(
    { kind: Type.Literal("climate"), band: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }) },
    strict,
);
export type ClimateRef = Static<typeof ClimateRef>;

/**
 * Der Eintrag eines Vorkommens (Flora, Fauna, Ware, Spezies; WI-0257 S3b): `lore_entry.public_id`. Er ist kein Kartenobjekt: Er hat keinen Detail-Endpunkt (`subjectDetailUrl` ist `null`), sein Panel liest
 * `GET /api/search/eintrag` und zeigt Stammdaten, genannte Orte und die Chips „Wo genau?“, die das Leuchten auf der Karte zuschneiden.
 */
export const LoreEntryRef = Type.Object({ kind: Type.Literal("loreEntry"), id: Uuid() }, strict);
export type LoreEntryRef = Static<typeof LoreEntryRef>;

/**
 * Eine Sprache der Karte (WI-0261 S5b, O1: ein Eintrag je Kartengruppe): `sprache.public_id`, wie die übrigen Objekte. Der Gruppenschlüssel (`garethi`, T-2) ist die
 * lesbare Adresse zum Teilen (`?sprache=garethi`) und steht in der Detailantwort (`SubjectDetail.sprache.schluessel`), nicht in der Kennung.
 */
export const SpracheRef = Type.Object({ kind: Type.Literal("sprache"), id: Uuid() }, strict);
export type SpracheRef = Static<typeof SpracheRef>;

/**
 * Ein Wetter-Icon mit Wiki-Verweis (WI-0288): `weather_symbol.public_id`. Die Adresse zum Teilen ist `?wetter=<Kennung>` (die Icons haben keinen lesbaren Schlüssel). Die
 * Icons des Prototyps tragen feste Kennungen, ein Verweis entsteht aber erst mit einer gespeicherten Änderung (der Map Mutation Guard der Vorgaben, WI-0288 Stufe 2).
 */
export const WetterSymbolRef = Type.Object({ kind: Type.Literal("wetterSymbol"), id: Uuid() }, strict);
export type WetterSymbolRef = Static<typeof WetterSymbolRef>;

/** Der Pfad des Detail-Endpunkts eines Wetter-Icons unter `SUBJECT_API_BASE`. */
export const SUBJECT_WETTER_SYMBOL_PFAD = "wetter-symbol";

export const SubjectRef = Type.Union([
    PlaceRef,
    PathRef,
    AreaRef,
    TerritoryRef,
    PeakRef,
    PowerlineRef,
    RouteStageRef,
    MapPointRef,
    ClimateRef,
    LoreEntryRef,
    SpracheRef,
    WetterSymbolRef,
]);
export type SubjectRef = Static<typeof SubjectRef>;

/** Auf 0,01 gerundet, ohne `-0`: die Genauigkeit eines Kartenpunkts. */
export function roundMapCoordinate(value: number): number {
    const rounded = Math.round(value * 100) / 100;
    return rounded === 0 ? 0 : rounded;
}

/**
 * Der kanonische Kartenpunkt: auf 0,01 gerundet. Zwei Druckstellen in derselben Hundertstel sind derselbe Subject.
 * `layers` ist der Hinweis auf die aktive Ansicht (siehe `MapPointRef`), nicht Teil der Kennung.
 */
export function mapPointRef(x: number, y: number, layers?: readonly LandscapeLayer[]): MapPointRef {
    return {
        kind: "mapPoint",
        x: roundMapCoordinate(x),
        y: roundMapCoordinate(y),
        ...(layers === undefined || layers.length === 0 ? {} : { layers: [...layers] }),
    };
}

/**
 * Die Zeichenkette für Vergleich, Cache und Staleness (WI-0063 Entwurf Abschnitt 2). Zwei Refs sind derselbe Subject genau
 * dann, wenn ihre Schlüssel gleich sind; die Antwort des Servers liefert den kanonischen Ref zurück (`detail.subject`),
 * dessen Schlüssel dann gilt. Davor ist der Schlüssel eines Wegs vorläufig (`path:chain:name:…`, ein Anker ohne Gruppe).
 */
export function subjectKey(ref: SubjectRef): string {
    switch (ref.kind) {
        case "place":
        case "territory":
        case "peak":
            return `${ref.kind}:${ref.id}`;
        case "area":
            return `area:${[ref.id, ...(ref.group ?? [])].sort().join("+")}`;
        case "path": {
            const wiki = ref.wiki === undefined ? "" : `:${ref.wiki}`;
            return "anchor" in ref ? `path:${ref.anchor}${wiki}` : `path:chain:${ref.chain}${wiki}`;
        }
        case "powerline":
            return `powerline:${ref.anchor}`;
        case "routeStage":
            return `routeStage:${ref.routeKey}#${String(ref.index)}`;
        case "mapPoint": {
            // Die Ebenen der Ansicht formen die Antwort (wie `wiki` am Weg): Zwei Ansichten sind nicht derselbe Eintrag im Cache.
            const layers = ref.layers === undefined ? "" : `@${[...ref.layers].join(",")}`;
            return `mapPoint:${String(roundMapCoordinate(ref.x))},${String(roundMapCoordinate(ref.y))}${layers}`;
        }
        case "climate":
            return `climate:${ref.band}`;
        case "loreEntry":
            return `loreEntry:${ref.id}`;
        case "sprache":
            return `sprache:${ref.id}`;
        case "wetterSymbol":
            return `wetterSymbol:${ref.id}`;
    }
}

export function isSameSubject(left: SubjectRef, right: SubjectRef): boolean {
    return subjectKey(left) === subjectKey(right);
}

/** Die Vorsilbe des Kettenschlüssels: Ein Weg ist sein Name (WI-0177 Schritt 2b), wie `editorPathGroupKey`. */
const KETTE_NACH_NAMEN = "name:";

/**
 * Der Kettenschlüssel eines Wegs oder Flusses, wie ihn Suche und Kartenauswahl liefern: `name:<Name>`. Ein Weg ist sein Name, über
 * Wegtypen und Kennzeichen hinweg (WI-0177 Schritt 2b, Legacys Regel (c) `wpGroupKeyOf`).
 */
export function pathChainKey(name: string): string {
    return `${KETTE_NACH_NAMEN}${name}`;
}

/**
 * Zerlegt einen Kettenschlüssel; `null`, wenn er keiner ist. Zuerst die Vorsilbe `name:` (alles danach ist der Name, auch mit „:“, und
 * auch ein Name wie „Weg“), dann das alte `Name:Wegtyp` alter Links (der Teil nach dem letzten `:` muss eine Wegart sein; der Wegtyp
 * trennt nicht mehr, er steht nur noch da).
 */
export function parsePathChain(chain: string): { name: string; subtype?: string } | null {
    if (chain.startsWith(KETTE_NACH_NAMEN)) {
        const name = chain.slice(KETTE_NACH_NAMEN.length);
        return name.trim() === "" ? null : { name };
    }
    const at = chain.lastIndexOf(":");
    if (at <= 0) return null;
    const subtype = chain.slice(at + 1);
    if (!(SUBJECT_PATH_SUBTYPES as readonly string[]).includes(subtype)) return null;
    return { name: chain.slice(0, at), subtype };
}

/**
 * Die Adresse des Detail-Endpunkts eines Subjects; `null` für Arten ohne Endpunkt (`routeStage` lebt im Planer). Ein Kartenpunkt hat
 * seinen eigenen Endpunkt mit `x` und `y`, ein Klimaband einen mit seinem Schlüssel.
 */
export function subjectDetailUrl(ref: SubjectRef): string | null {
    switch (ref.kind) {
        case "place":
        case "territory":
        case "peak":
        case "area":
            return `${SUBJECT_API_BASE}/${ref.kind}/${ref.id}`;
        case "powerline":
            return `${SUBJECT_API_BASE}/powerline/${ref.anchor}`;
        case "path": {
            const id = "anchor" in ref ? ref.anchor : ref.chain;
            const query = ref.wiki === undefined ? "" : `?wiki=${encodeURIComponent(ref.wiki)}`;
            return `${SUBJECT_API_BASE}/path/${encodeURIComponent(id)}${query}`;
        }
        case "mapPoint": {
            const layers = ref.layers === undefined ? "" : `&layers=${[...ref.layers].join(",")}`;
            return `${SUBJECT_MAP_POINT_URL}?x=${String(roundMapCoordinate(ref.x))}&y=${String(roundMapCoordinate(ref.y))}${layers}`;
        }
        case "climate":
            return `${SUBJECT_API_BASE}/climate/${ref.band}`;
        case "sprache":
            return `${SUBJECT_API_BASE}/sprache/${ref.id}`;
        case "wetterSymbol":
            return `${SUBJECT_API_BASE}/${SUBJECT_WETTER_SYMBOL_PFAD}/${ref.id}`;
        case "routeStage":
        case "loreEntry":
            return null;
    }
}

/**
 * Die Sektionen, die das Panel einzeln nachlädt (WI-0063 P4 Abschnitt 3, P8): schwere Listen gehören nicht in die Detailantwort. Jede
 * steht unter `{detail}/{sektion}`, und das Panel fragt sie nur, wo `counts` sie zählt.
 */
export const SUBJECT_SECTIONS = ["sources", "literature", "citymaps", "reviews", "lore", "staetten"] as const;
export type SubjectSection = (typeof SUBJECT_SECTIONS)[number];

/** Die Adresse einer Sektion eines Subjects (nur für Subjects mit Detail-Endpunkt außer Kartenpunkt und Klimaband). */
export function subjectSectionUrl(ref: SubjectRef, section: SubjectSection): string | null {
    if (
        ref.kind === "mapPoint" ||
        ref.kind === "routeStage" ||
        ref.kind === "climate" ||
        ref.kind === "loreEntry" ||
        ref.kind === "sprache" ||
        ref.kind === "wetterSymbol"
    )
        return null;
    const detail = subjectDetailUrl(ref);
    if (detail === null) return null;
    const query = detail.indexOf("?");
    return query === -1 ? `${detail}/${section}` : `${detail.slice(0, query)}/${section}${detail.slice(query)}`;
}

/** Die Adresse der Quellen-Sektion eines Subjects. */
export const subjectSourcesUrl = (ref: SubjectRef): string | null => subjectSectionUrl(ref, "sources");

// ---------------------------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------------------------

/** Wo ein Feld herkommt: der Wiki-Schnappschuss (mit Adresse und Stempel) oder die redaktionelle Eingabe am Objekt. */
export const SubjectProvenance = Type.Object(
    {
        kind: Type.Union([Type.Literal("wiki"), Type.Literal("editorial")]),
        wikiUrl: Type.Optional(Type.String({ minLength: 1 })),
        /** Der Stempel des Wiki-Abgleichs (ISO 8601); die Kraftlinien-Nester tragen keinen. */
        syncedAt: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type SubjectProvenance = Static<typeof SubjectProvenance>;

/** Die Felder, die ein Subject als Faktenzeile tragen kann; die Oberfläche übersetzt sie über die Sprachtafeln. */
export const SUBJECT_FACT_FIELDS = [
    "description",
    "einwohner",
    "oberhaupt",
    "lage",
    "handelszone",
    "verkehrswege",
    "bevoelkerung",
    "tempel",
    "buildingType",
    "art",
    "laenge",
    "verlauf",
    "continent",
    "regionParent",
    "affiliationStaat",
    "sprache",
    "vegetation",
    "synonyms",
    "neighbors",
    "staerke",
    "affinitaet",
    "regionen",
    "status",
    "validity",
    "capital",
    "seat",
    // Die Staatsinfobox des Gebiets (E4, WI-0063 27.18; Legacy `createRegionWikiInfoBoxMarkup`): acht Zeilen, die nur das Gebiet hat;
    // `oberhaupt`, `sprache`, `handelszone`, `capital` und `seat` teilt es mit Ort, Landschaft und seiner bisherigen Antwort.
    // Die Namen folgen den Beschriftungen der Zeilen.
    "herrschaftsform",
    "gruendung",
    "aufloesung",
    "gruender",
    "waehrung",
    "einwohnerzahl",
    "geographisch",
    "handelswaren",
    // Was Legacys Staatsinfobox NICHT zeigt (E4): kommt mit `legacyHidden` und ist in keiner Freigabe (`continent` teilt das Gebiet mit
    // Ort und Landschaft, seine Freigabe gilt für das Gebiet nicht).
    "politisch",
    "wappenbeschreibung",
    "zugehoerigkeitRoh",
    // Die Infobox einer Sprache (WI-0261 S5b): die Felder der Vorlage „Infobox Sprache“ aus dem Wiki-Stand ihres ersten Artikels (`wiki_sprache_artikel`, 0255) und
    // die Dialekte; die Kurzbeschreibung steht als `description`.
    "sprachfamilie",
    "vorstufen",
    "schrift",
    "dialekte",
    "sprecheranzahl",
    "amtssprache",
    "weitereVerbreitung",
] as const;
export type SubjectFactField = (typeof SUBJECT_FACT_FIELDS)[number];

const FactField = Type.Union(SUBJECT_FACT_FIELDS.map((field) => Type.Literal(field)));

/** Die Himmelsrichtungen der Nachbarn einer Landschaft (Legacy-Reihenfolge). */
export const SUBJECT_DIRECTIONS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] as const;

/**
 * Ein Verweis in einem Faktentext auf ein anderes Subject: der Anzeigetext und sein Gegenstand.
 * `at` ist die Stelle im Wert (UTF-16-Index, wie `String.prototype.indexOf`), an der `text` steht: Ohne sie sucht der Leser den Text von
 * links nach der Reihenfolge der Verweise (Verkehrswege). Wo derselbe Name auch ungelinkt davor stehen kann („Alt-Gareth · Gareth“),
 * trägt der Server die Stelle (Wiki-Texte, WI-0063 27.12, „anklickbar“).
 */
export const SubjectFactLink = Type.Object(
    { text: Type.String({ minLength: 1 }), ref: SubjectRef, at: Type.Optional(Type.Integer({ minimum: 0 })) },
    strict,
);
export type SubjectFactLink = Static<typeof SubjectFactLink>;

/**
 * 🔴 `legacyHidden` (WI-0063 27.8, Betreiber 2026-10-04: „aussehn wie legacy“): der Server liefert auch Fakten, die Legacys
 * Infobox nicht zeigt, und markiert sie damit. Das Panel zeigt sie standardmäßig NICHT; welche Felder je Subject-Art erscheinen,
 * entscheidet EINE Freigabeliste (`PANEL_APPROVED_EXTRAS` in `subject-display.ts`). Der Wert fehlt, wenn der Fakt sichtbar ist.
 */
const LegacyHidden = Type.Optional(Type.Literal(true));

/**
 * Eine Zeile mit einem Text; `ref` verweist auf ein Subject (Hauptstadt, Sitz), `links` auf Wege im Text.
 * `layer: "direct"` heißt: der Wert steht direkt am Objekt (`place_detail`), nicht im Wiki-Nest; fehlt `layer`, kommt er aus
 * dem Nest oder ist abgeleitet. Ein Ort mit Nest trägt dasselbe Feld darum zweimal: der Nestwert und der direkte Wert.
 */
export const SubjectTextFact = Type.Object(
    {
        field: FactField,
        value: Type.String({ minLength: 1 }),
        ref: Type.Optional(SubjectRef),
        links: Type.Optional(Type.Array(SubjectFactLink, { minItems: 1 })),
        provenance: SubjectProvenance,
        layer: Type.Optional(Type.Literal("direct")),
        legacyHidden: LegacyHidden,
    },
    strict,
);
export type SubjectTextFact = Static<typeof SubjectTextFact>;

/**
 * Ein Verweis in einem Wert einer Liste: wie `SubjectFactLink`, dazu `value` - die Stelle des Wertes in `values` -, und `at` ist der Anfang
 * des Textes IM WERT. Ein Wert kann mehrere Namen tragen („Winhaller Land / Farindelwald“) und einen Zusatz („Svalltermoor (Region)“).
 */
export const SubjectListLink = Type.Object(
    {
        value: Type.Integer({ minimum: 0 }),
        text: Type.String({ minLength: 1 }),
        ref: SubjectRef,
        at: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type SubjectListLink = Static<typeof SubjectListLink>;

/**
 * Eine Zeile mit einer Liste (Synonyme; Nachbarn, je Himmelsrichtung eine Zeile). `links` (WI-0063 27.12): welche Namen in den Werten auf
 * ein Objekt der Karte zeigen - nur über das Linkziel des Quelltextes und seinen Wiki-Key, nie über den Namen; ein Name ohne Eintrag ist ein Text
 * (kein Linkziel, nicht auf der Karte oder mehrdeutig). Heute liefert die Quelle keine Linkziele für die Nachbarn.
 */
export const SubjectListFact = Type.Object(
    {
        field: FactField,
        direction: Type.Optional(Type.Union(SUBJECT_DIRECTIONS.map((direction) => Type.Literal(direction)))),
        values: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        links: Type.Optional(Type.Array(SubjectListLink, { minItems: 1 })),
        provenance: SubjectProvenance,
        legacyHidden: LegacyHidden,
    },
    strict,
);
export type SubjectListFact = Static<typeof SubjectListFact>;

export const SubjectFact = Type.Union([SubjectTextFact, SubjectListFact]);
export type SubjectFact = Static<typeof SubjectFact>;

/** Ein Verweis auf ein Subject mit Namen (Hauptstadt, Sitz, Gebiet). */
export const SubjectLink = Type.Object({ ref: SubjectRef, name: Type.String({ minLength: 1 }) }, strict);
export type SubjectLink = Static<typeof SubjectLink>;

/**
 * Der Untertitel besteht aus STRUKTURIERTEN Teilen, nicht aus einem Satz: Art und Ebene sind Schlüssel für die
 * Sprachtafeln, `kind` ist die Ortsart als Text der Daten (Festung, Kloster), `capitalOf`/`seatOf` nennen ein Gebiet.
 */
export const SubjectSubtitlePart = Type.Union([
    Type.Object({ part: Type.Literal("type"), key: Type.String({ minLength: 1 }) }, strict),
    Type.Object({ part: Type.Literal("layer"), key: Type.String({ minLength: 1 }) }, strict),
    Type.Object({ part: Type.Literal("kind"), text: Type.String({ minLength: 1 }) }, strict),
    Type.Object({ part: Type.Literal("ruin") }, strict),
    // Ein Merkmal des Ortseditors, nicht aus Legacy (WI-0128 E21, EDIT-0001 D21): Das Panel nennt es hinter dem Ortstyp.
    Type.Object({ part: Type.Literal("underground") }, strict),
    // Ungefähre Lage (WI-0267, Kanal OPS-000067): ein Merkmal des Ortseditors, hinter dem Ortstyp wie „unterirdisch“.
    Type.Object({ part: Type.Literal("approximate") }, strict),
    // Ein Merkmal des Wegeditors, nicht aus Legacy (WI-0177, Migration 0172): Das Panel nennt es hinter dem Wegtyp; `partial`, wenn
    // nur ein Teil der Abschnitte der gezeigten Straße durch einen Tunnel läuft („mit Tunnel“).
    Type.Object({ part: Type.Literal("tunnel"), partial: Type.Optional(Type.Literal(true)) }, strict),
    // Das Kennzeichen über dem Wegtyp (WI-0177 §30, Migration 0174; `PATH_MARKS`): Das Panel nennt es vor dem Wegtyp; `partial`, wenn
    // nur ein Teil der Abschnitte der gezeigten Straße es trägt.
    Type.Object(
        { part: Type.Literal("mark"), key: Type.Literal("karawanenroute"), partial: Type.Optional(Type.Literal(true)) },
        strict,
    ),
    Type.Object({ part: Type.Literal("capitalOf"), territory: SubjectLink }, strict),
    Type.Object({ part: Type.Literal("seatOf"), territory: SubjectLink }, strict),
]);
export type SubjectSubtitlePart = Static<typeof SubjectSubtitlePart>;

/** Die Wikizeile („Quelle: Wiki Aventurica“): Adresse, Seitentitel, Korpus samt Lizenz und Namensnennung. */
export const SubjectWikiLine = Type.Object(
    {
        url: Type.String({ minLength: 1 }),
        title: Type.Optional(Type.String({ minLength: 1 })),
        corpus: Type.Object(
            { key: Type.String({ minLength: 1 }), label: Type.Optional(Type.String({ minLength: 1 })) },
            strict,
        ),
        license: Type.Optional(
            Type.Object(
                { name: Type.String({ minLength: 1 }), uri: Type.Optional(Type.String({ pattern: "^https://" })) },
                strict,
            ),
        ),
        attribution: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type SubjectWikiLine = Static<typeof SubjectWikiLine>;

/** Wie ein Subject zur Geometrie des Kontextes steht (WI-0063 5.4): „Liegt in“, „überlappt“, „verläuft durch“, „an dieser Stelle“. */
export const SUBJECT_RELATIONS = ["lies_in", "overlaps", "runs_through", "at_point"] as const;
export type SubjectRelation = (typeof SUBJECT_RELATIONS)[number];
const Relation = Type.Union(SUBJECT_RELATIONS.map((relation) => Type.Literal(relation)));

/**
 * Eine Kopie eines Schemas ohne `$id` (auch in seinen Teilen): Fastify und Ajv verweigern ein Schema, in dem dieselbe `$id`
 * zweimal vorkommt („reference resolves to more than one schema“). Das Wappen und die Kopfbilder sind beide ein
 * `MediaPublicView`; die Kopie hat denselben Inhalt, die Quelle bleibt `media.ts`.
 */
function anonymous<T extends TSchema>(schema: T): T {
    const copy = Value.Clone(schema);
    const walk = (node: unknown): void => {
        if (node === null || typeof node !== "object") return;
        delete (node as Record<string, unknown>)["$id"];
        for (const value of Object.values(node)) walk(value);
    };
    walk(copy);
    return copy;
}

const MediaView = anonymous(MediaPublicView);

/**
 * Ein Gebiet in einer Kette; `share` (0 bis 1) nur bei Flächen: der Anteil der Fläche, den das Gebiet deckt.
 *
 * `coat` ist das Wappen des Gebiets als kleiner Daumen vor dem Namen (WI-0094, Legacy `settlementTerritoryCoatThumbMarkup`
 * in `js/ui/popups.js`: `node.coat_url` im Link der Treppe). 🔴 **Dieselbe Quelle und dieselbe Variantenwahl wie das Wappen
 * im Panelkopf** - der Media Core, `resolveTerritoryCoats` über dieselbe Entscheidung (`policy.ts`) und dieselbe
 * veröffentlichte Variante (`roles.ts`); es gibt keine zweite Wappenquelle und deshalb auch keine zweite Form: das Feld ist
 * ein `MediaPublicView` wie `SubjectMedia.coat`. 🔴 Optional heißt FEHLT: Ein Gebiet ohne öffentlich erlaubtes Wappen trägt
 * das Feld nicht, nie einen leeren Wert - und die Treppe rückt dann auf, wie in Legacy (dort liefert der Daumen `""`).
 */
export const ContextTerritory = Type.Object(
    {
        ref: TerritoryRef,
        name: Type.String({ minLength: 1 }),
        type: Type.Optional(Type.String({ minLength: 1 })),
        share: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        coat: Type.Optional(MediaView),
    },
    strict,
);
export type ContextTerritory = Static<typeof ContextTerritory>;

/** Die Gebiete im Kontext: Ketten von der Wurzel bis zum innersten Gebiet, bei mehreren Gebieten je Kette eine. */
export const ContextTerritories = Type.Object(
    {
        relation: Relation,
        chains: Type.Array(Type.Array(ContextTerritory, { minItems: 1 }), { minItems: 1 }),
    },
    strict,
);
export type ContextTerritories = Static<typeof ContextTerritories>;

/**
 * Eine Landschaft im Kontext. `name` fehlt bei einer Fläche, die nur einen Griff trägt („Wald-925“): die Oberfläche
 * zeigt dann die Art (`landscapeReaderName`). `share` (0 bis 1) bei Flächen und Linien: der Anteil an Fläche oder Länge.
 */
export const ContextLandscape = Type.Object(
    {
        ref: AreaRef,
        name: Type.Optional(Type.String({ minLength: 1 })),
        /** Die Art (`region_type`); fehlt bei Regionen ohne Art (die derographischen Landschaften). */
        type: Type.Optional(Type.String({ minLength: 1 })),
        layer: Type.String({ minLength: 1 }),
        share: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    },
    strict,
);
export type ContextLandscape = Static<typeof ContextLandscape>;

export const ContextLandscapes = Type.Object(
    { relation: Relation, items: Type.Array(ContextLandscape, { minItems: 1 }) },
    strict,
);
export type ContextLandscapes = Static<typeof ContextLandscapes>;

export const ContextClimateBand = Type.Object(
    {
        band: Type.String({ minLength: 1 }),
        label: Type.String({ minLength: 1 }),
        share: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    },
    strict,
);
export type ContextClimateBand = Static<typeof ContextClimateBand>;

export const ContextClimate = Type.Object(
    { relation: Relation, items: Type.Array(ContextClimateBand, { minItems: 1 }) },
    strict,
);
export type ContextClimate = Static<typeof ContextClimate>;

/**
 * Ein benannter Fluss im Umkreis eines Kartenpunkts; `ref` ist die Kette `name:<Name>`. `distance` ist der Abstand zum Punkt in
 * Karteneinheiten (auf 0,01 gerundet): Die Oberfläche entscheidet je Zoom, welcher Fluss noch „hier“ ist; der nächste steht zuerst.
 */
export const ContextRiver = Type.Object(
    {
        ref: PathRef,
        name: Type.String({ minLength: 1 }),
        subtype: Type.String({ minLength: 1 }),
        isBach: Type.Boolean(),
        distance: Type.Number({ minimum: 0 }),
    },
    strict,
);
export type ContextRiver = Static<typeof ContextRiver>;

/** Der räumliche KONTEXT (WI-0063 5.2): ergibt sich aus Geometrie, ist kein direktes Objektattribut und trägt keine Quellen. */
export const SubjectContext = Type.Object(
    {
        territories: Type.Optional(ContextTerritories),
        landscapes: Type.Optional(ContextLandscapes),
        climate: Type.Optional(ContextClimate),
        rivers: Type.Optional(Type.Array(ContextRiver, { minItems: 1 })),
    },
    strict,
);
export type SubjectContext = Static<typeof SubjectContext>;

/** Der Kanon (offiziell/inoffiziell) wie Legacy ihn ableitet (D1): `unlabelled` heißt, es gibt nichts zu sagen. */
export const SubjectCanon = Type.Object(
    {
        canon: Type.Union([Type.Literal("official"), Type.Literal("unofficial"), Type.Literal("unlabelled")]),
        /** Die gemeinsame Art der Quellen (Schlüssel für die Sprachtafeln); seit WI-0253 B-2 auch bei offiziell. */
        designatorType: Type.Optional(Type.String({ minLength: 1 })),
        /** Bei mindestens zwei zählenden Quellen: ihre Anzahl (bei offiziell wie bei inoffiziell). */
        designatorCount: Type.Optional(Type.Integer({ minimum: 2 })),
        /** Ein fester Bezeichner der Zeile wie „Wiki Aventurica“ oder „Avesmaps“ (Namensraum-Tafel, Rang 4). */
        designatorLabel: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type SubjectCanon = Static<typeof SubjectCanon>;

/** Wohin die Kamera fliegt, wenn das Subject geöffnet wird: ein Punkt samt Zoom, bei Linien und Flächen der Ausschnitt. */
export const SubjectTarget = Type.Object(
    { x: Type.Number(), y: Type.Number(), zoom: Type.Number(), bounds: Type.Optional(MapBounds) },
    strict,
);
export type SubjectTarget = Static<typeof SubjectTarget>;

/** Die Medien eines Subjects, nur über den Media-Resolver: Wappen und Kopfbilder, nur was öffentlich erlaubt ist. */
export const SubjectMedia = Type.Object(
    {
        coat: Type.Optional(MediaView),
        header: Type.Optional(Type.Array(MediaView, { minItems: 1 })),
        /**
         * Die Typbilder eines Ortes, die der Kopf neben Ortsansicht oder Reisebild zurückhält (`withholdTypeImages`). Sie stehen nur da, wenn der Filter „Ohne KI“ alle Bilder aus `header` nimmt
         * (Vali 2026-11-03: „wenn keins mehr da ist, rückfall auf die typbilder wie bisher“).
         */
        typbilder: Type.Optional(Type.Array(MediaView, { minItems: 1 })),
    },
    strict,
);
export type SubjectMedia = Static<typeof SubjectMedia>;

/**
 * Die Zähler der Sektionen, die es gibt. 🔴 Eine Sektion ohne Inhalt FEHLT, sie steht nie als 0 da (WI-0063 5.3, 14): Das Panel baut
 * einen Abschnitt nur, wo hier eine Zahl steht, und holt seine Liste dann in einer eigenen Frage (`subjectSectionUrl`).
 */
export const SubjectCounts = Type.Object(
    {
        sources: Type.Optional(Type.Integer({ minimum: 1 })),
        /**
         * Werke der Spielliteratur, die OFFEN dastehen (Rolle `start` oder `covers`, D3). 🔴 Ein verdecktes Werk (`play`) zählt NICHT
         * mit: „sonst verriete die Zahl allein schon, wie viel hier gespielt wird“ (Legacy, Owner 2026-07-18).
         */
        literature: Type.Optional(Type.Integer({ minimum: 1 })),
        /**
         * Es gibt verdeckte Werke (Rolle `play`). 🔴 Es ist eine eigene Aussage und kein Zähler: Sie sagt, DASS der Abschnitt gebaut
         * werden muss, ohne zu sagen, WIE VIELE verdeckt sind. Ohne `literature` steht die Überschrift dann ohne Zahl.
         */
        literatureHidden: Type.Optional(Type.Literal(true)),
        /** Karten der Kartensammlung, die diesen Gegenstand abbilden (D2). */
        citymaps: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Sichtbare Bewertungen (D4); nur Orte haben welche. */
        reviews: Type.Optional(Type.Integer({ minimum: 1 })),
        /**
         * Die Vorkommen je Art (D5, `lore.yaml` -> `panelbezug.detailvertrag`): die vier Zeilen der Datentabelle entstehen aus
         * diesen Zahlen, die Listen holt die Sektion `lore` beim Aufklappen. 🔴 Welche Ränge die Zahl zählt, steht an EINER Stelle
         * (`LORE_READING` in `lore.ts`, offene Betreiberfrage WI-0091 §3). Das Objekt fehlt, wo es keine Vorkommen gibt; eine Art
         * ohne Eintrag fehlt darin.
         */
        lore: Type.Optional(LoreCounts),
        /**
         * Die Staetten eines Ortes (D7, WI-0109, Vertrag `staetten.yaml`): die EINE Zahl, aus der die Zeile entsteht; die Namen holt
         * die Sektion `staetten` beim Aufklappen. 🔴 Nur Orte haben welche, und sie fehlt, wo es keine gibt - eine Zeile
         * „0 besondere Staetten verzeichnet" waere eine Aussage ueber unseren Datenbestand, die niemanden interessiert, und sie
         * stuende an 4.489 der 4.984 Orte (Legacy laesst die Zeile aus demselben Grund weg). 🪤 Das ist NICHT der Fall der
         * Vorkommen: dort traegt die Zeile bei 0 immer noch den Link „Ueberall in Aventurien", hier gibt es keinen.
         */
        staetten: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    strict,
);
export type SubjectCounts = Static<typeof SubjectCounts>;

/**
 * Ein Ort der Straße für „Weg als Route“ (WI-0063 P7, B12; Legacy `avesmapsWegAlsRouteFuerPfad`): so viel, wie der Planer für einen
 * Wegpunkt braucht. Es stehen nur Orte darin, die Besucher sehen: Kreuzungen, offene Wegenden und verborgene Orte fahren nicht mit.
 */
export const SubjectRoutePlace = Type.Object(
    {
        id: Uuid(),
        name: Type.String({ minLength: 1 }),
        subtype: Type.String({ minLength: 1 }),
        x: Type.Number(),
        y: Type.Number(),
    },
    strict,
);
export type SubjectRoutePlace = Static<typeof SubjectRoutePlace>;

/**
 * Ein Anspruchsteller eines umstrittenen Gebiets (Legacy „Umstritten mit“, `collectRegionContestedClaimants`): sein Gebiet, der Name
 * und die Farbe, in der es auf der Karte schraffiert steht.
 */
export const SubjectClaimant = Type.Object(
    {
        ref: TerritoryRef,
        name: Type.String({ minLength: 1 }),
        color: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
    },
    strict,
);
export type SubjectClaimant = Static<typeof SubjectClaimant>;

/** Wie viele Stationen „Verläuft über“ einer Kraftlinie nennt, bevor „…“ kürzt (Legacy `powerlinePlaceLinksMarkup`, Grenze 12). */
export const POWERLINE_VIA_LIMIT = 12;

/**
 * Die Gestalt einer Kraftlinie (Legacy `getPowerlineTopology`, Infobox „Verbindet“, „Verläuft über“, „Abschnitte“): Sie besteht aus vielen
 * Segmenten, die nur der Name zusammenhält. Es stehen nur benannte Orte darin, die Besucher sehen; ein Nodix, ein Label und ein
 * verborgener Ort sind Knoten der Linie, aber keine Namen.
 * - `ends`: die Orte an den äußeren Enden (zwei: „A ↔ B“, bei einer Verzweigung alle); ein Ring hat keine.
 * - `via`: die übrigen benannten Orte entlang der Linie, höchstens `POWERLINE_VIA_LIMIT`; `viaMore` sagt, dass es mehr gibt.
 * - `segments`: die Zahl der Segmente (nur bei mehr als einem); `ring`: sie schließt sich.
 * - `segmentsWithoutWiki`: wie viele davon den Artikel der Linie NICHT tragen (Teilzuordnung, WI-0205); nur, wenn die Linie einen
 *   Artikel hat und nicht jeder Abschnitt ihn trägt.
 */
export const SubjectLineShape = Type.Object(
    {
        ends: Type.Optional(Type.Array(SubjectLink, { minItems: 1 })),
        via: Type.Optional(Type.Array(SubjectLink, { minItems: 1, maxItems: POWERLINE_VIA_LIMIT })),
        viaMore: Type.Optional(Type.Literal(true)),
        segments: Type.Optional(Type.Integer({ minimum: 2 })),
        ring: Type.Optional(Type.Literal(true)),
        segmentsWithoutWiki: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    strict,
);
export type SubjectLineShape = Static<typeof SubjectLineShape>;

/** `#rrggbb`, Kleinbuchstaben: die Farbe einer Sprache (Bedingung der Tafel `sprache`, Migration 0254). */
const SPRACH_FARBE = "^#[0-9a-f]{6}$";

/**
 * Eine Sprache, die ein Objekt trifft (WI-0261 S5b, Zeile „Sprachen“ zwischen „Regionen“ und „Topographie“): ihr Verweis, ihr Name, ihre Farbe (das Kästchen davor)
 * und ihr Anteil an der Fläche oder Länge des Objekts (0 bis 1; ein Ort hat 1). Es stehen nur Sprachen ab dem Mindestanteil der Karteneinstellungen da
 * (`sprachenMindestanteil`, O4), der größte Anteil zuerst.
 */
export const SubjectSprache = Type.Object(
    {
        ref: SpracheRef,
        name: Type.String({ minLength: 1 }),
        farbe: Type.String({ pattern: SPRACH_FARBE }),
        anteil: Type.Number({ minimum: 0, maximum: 1 }),
    },
    strict,
);
export type SubjectSprache = Static<typeof SubjectSprache>;

/** Die Arten der Treffer einer Sprache in der Reihenfolge der Infobox (Bauvorlage 2026-10-30: Herrschaftsgebiete, Regionen, Orte; dazu die Wege). */
export const SPRACH_TREFFER_ARTEN = ["territory", "region", "place", "path"] as const;
export type SprachTrefferArt = (typeof SPRACH_TREFFER_ARTEN)[number];

/**
 * So viele Einträge nennt eine Trefferliste der Infobox höchstens (WI-0261 S5b, O4 „nur Zahlen, aufklappbar“): Garethi trifft Tausende Orte und Wege, und eine Liste
 * dieser Länge liest niemand. Die Zahl nennt immer alle; was nicht in der Liste steht, sagt „… und n weitere“.
 */
export const SPRACH_TREFFER_LISTE_LIMIT = 50;

/** Ein Eintrag einer Trefferliste: der Verweis auf das Objekt, sein Name und (bei Flächen und Wegen) der Anteil der Sprache daran. */
export const SprachTrefferEintrag = Type.Object(
    {
        ref: Type.Union([TerritoryRef, AreaRef, PlaceRef, PathRef]),
        name: Type.String({ minLength: 1 }),
        anteil: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    },
    strict,
);
export type SprachTrefferEintrag = Static<typeof SprachTrefferEintrag>;

/** Die Treffer einer Art: die Zahl aller und die ersten Einträge (`SPRACH_TREFFER_LISTE_LIMIT`). Eine Art ohne Treffer fehlt. */
export const SprachTrefferListe = Type.Object(
    {
        art: Type.Union(SPRACH_TREFFER_ARTEN.map((art) => Type.Literal(art))),
        anzahl: Type.Integer({ minimum: 1 }),
        eintraege: Type.Array(SprachTrefferEintrag, { maxItems: SPRACH_TREFFER_LISTE_LIMIT }),
    },
    strict,
);
export type SprachTrefferListe = Static<typeof SprachTrefferListe>;

/** Woher die Flächen einer Sprache stammen (T-1): aus der eingespielten Referenzkarte oder von der Redaktion. */
export const SPRACH_HERKUENFTE = ["sprachenkarte", "redaktion"] as const;
export type SprachHerkunft = (typeof SPRACH_HERKUENFTE)[number];

/**
 * Die Quelle der Flächen aus der Referenzkarte (O5, E0): so steht sie im Quellenkasten der Infobox. Ein Titel eines Werks, kein Text der Oberfläche; er wird nicht
 * übersetzt.
 */
export const SPRACHENKARTE_TITEL = "Referenzkarte „Aventurische Sprachen“ (Steffen Brand, Ulisses 2026)";

/** Ein Wiki-Artikel einer Sprache (eine Pille des Spracheditors, O1), in der Reihenfolge der Zuordnung. */
export const SprachArtikel = Type.Object(
    { titel: Type.String({ minLength: 1 }), url: Type.String({ pattern: "^https?://" }) },
    strict,
);
export type SprachArtikel = Static<typeof SprachArtikel>;

/**
 * Was die Infobox einer Sprache über den gemeinsamen Vertrag hinaus braucht (WI-0261 S5b). Name (`title`), Art (`subtitle`), die Felder der Wiki-Infobox und die
 * Dialekte (`facts`), die Wikizeile des ersten Artikels (`wiki`) und das Ziel der Kamera (`target`: die Teile, die zusammen 85 % der Fläche tragen) stehen, wo sie bei
 * jedem Gegenstand stehen.
 */
export const SubjectSpracheBlock = Type.Object(
    {
        /** Der Gruppenschlüssel (T-2): die lesbare Adresse und der Schlüssel der Kacheln (`sprache_flaeche_render.schluessel`). */
        schluessel: Type.String({ pattern: "^[a-z][a-z0-9_-]*$", maxLength: 64 }),
        farbe: Type.String({ pattern: SPRACH_FARBE }),
        /** Alle zugeordneten Wiki-Artikel in ihrer Reihenfolge; der erste trägt die Felder. Leer: „platziert, ohne Wiki-Artikel“ (O1). */
        artikel: Type.Array(SprachArtikel),
        /** Die Treffer je Art ab dem Mindestanteil, in der Reihenfolge `SPRACH_TREFFER_ARTEN`; eine Art ohne Treffer fehlt. */
        treffer: Type.Array(SprachTrefferListe, { maxItems: SPRACH_TREFFER_ARTEN.length }),
        /** Wie viele Teilflächen die Sprache hat (für Besucher „Gegenden“). */
        gegenden: Type.Integer({ minimum: 0 }),
        /** Woher ihre Flächen stammen (T-1), jede Herkunft einmal; leer ohne Fläche. */
        herkunft: Type.Array(Type.Union(SPRACH_HERKUENFTE.map((wert) => Type.Literal(wert))), {
            maxItems: SPRACH_HERKUENFTE.length,
            uniqueItems: true,
        }),
    },
    strict,
);
export type SubjectSpracheBlock = Static<typeof SubjectSpracheBlock>;

/** Die Revision: ein Satz der Legacy-Daten samt abgeleiteten Gebieten; der Client cacht nur unter diesem Schlüssel. */
export const SUBJECT_REVISION_PATTERN = "^[0-9a-f]{12}$";

export const SubjectDetail = Type.Object(
    {
        /** Der kanonische Ref (Weg und Kraftlinie: die Gruppe samt Anker; Fläche: samt Gruppe). */
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        /** Name aus der Fachdomäne, nie aus dem Wiki-Feld; fehlt bei einer namenlosen Fläche oder einem namenlosen Weg. */
        title: Type.Optional(Type.String({ minLength: 1 })),
        subtitle: Type.Optional(Type.Array(SubjectSubtitlePart, { minItems: 1 })),
        media: Type.Optional(SubjectMedia),
        facts: Type.Optional(Type.Array(SubjectFact, { minItems: 1 })),
        wiki: Type.Optional(SubjectWikiLine),
        context: Type.Optional(SubjectContext),
        canon: Type.Optional(SubjectCanon),
        /**
         * Ort: Er ist verborgen (WI-0080, `place.is_hidden`). Nur gesetzt, wo es zutrifft - der Kopf des Panels stellt dann die Pille
         * „Verborgen“ neben das Kanon-Etikett (Betreiber 2026-10-05).
         *
         * 🔴 Das Merkmal steht IM Vertrag, weil der Client sonst raten müsste: Er fragt nicht die Karte, ob ein Ort verborgen ist. Dass
         * ein verborgener Ort überhaupt ein Detail bekommt, ist die Regel aus WI-0080 (gefunden heißt „ganz normal“); verborgen bleibt er
         * in der Suche und in den Listen anderer Objekte, und dort sendet der Server ihn nie.
         */
        hidden: Type.Optional(Type.Literal(true)),
        /**
         * Fläche: ihre wirksame Gefahrenlage (WI-0308; Vali 2026-11-12, Antwort 12: „du kannst die pille "Gefahrengebiet" verwenden“). Die Arten der
         * Gruppe in der Folge des Katalogs, nur in Derographie, Vegetation und Topographie (`wirksameGefahren`); fehlt bei „ungefährlich“. Der Kopf des
         * Panels zeigt dann die Pille „Gefahrengebiet“ und nennt die Arten.
         */
        gefahr: Type.Optional(
            Type.Object(
                {
                    arten: Type.Array(Type.Union(GEFAHREN_ARTEN.map((art) => Type.Literal(art))), {
                        minItems: 1,
                        maxItems: GEFAHREN_ARTEN.length,
                        uniqueItems: true,
                    }),
                },
                strict,
            ),
        ),
        counts: Type.Optional(SubjectCounts),
        target: Type.Optional(SubjectTarget),
        /** Weg: die Orte der ganzen Straße in Reihenfolge, wo es „Weg als Route“ gibt (Wiki-Artikel, kein Seeweg, mindestens zwei Orte). */
        routePlaces: Type.Optional(Type.Array(SubjectRoutePlace, { minItems: 2, maxItems: ROUTE_WAYPOINT_LIMIT })),
        /** Weg: „Von – Bis“ der ganzen Straße, die zwei am weitesten auseinanderliegenden Orte unter den offenen Enden (Legacy „Ganze Straße: A – B“). */
        stretch: Type.Optional(
            Type.Object({ from: Type.String({ minLength: 1 }), to: Type.String({ minLength: 1 }) }, strict),
        ),
        /**
         * Weg (WI-0302; Vali 2026-11-10, Option „Ja, mitzählen“): die anderen Straßen, mit denen dieser Weg Abschnitte teilt, also Abschnitte seiner
         * Gruppe, die einer Straße mit anderem Namen gehören und seinen Artikel als weiteren Straßennamen tragen (Zeile „Gemeinsam mit“). Je Straße ihr
         * Name, ihr Ref (zum Öffnen), wie viele Abschnitte geteilt sind und, bei genau einem, dessen „Von – Bis“. Fehlt ohne.
         */
        gemeinsam: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        name: Type.String({ minLength: 1 }),
                        ref: SubjectRef,
                        abschnitte: Type.Integer({ minimum: 1 }),
                        von: Type.Optional(Type.String()),
                        bis: Type.Optional(Type.String()),
                    },
                    strict,
                ),
                { minItems: 1 },
            ),
        ),
        /**
         * Weg (WI-0302): die öffentlichen Kennungen aller Abschnitte der Gruppe, auch der geteilten, und dazu die Kette ihrer echten Namen ohne fremden
         * Artikel (OPS-000109: ein Fluss, dessen Artikel nur an einem Teil hängt). „Anzeigen“ lässt genau sie leuchten; ohne das Feld leuchtet der Weg
         * wie bisher über seinen Namen.
         */
        abschnitte: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 5000 })),
        /** Gebiet: die Anspruchsteller umstrittener Teile des Gebiets (Legacy „Umstritten mit“). */
        claimants: Type.Optional(Type.Array(SubjectClaimant, { minItems: 1 })),
        /** Kraftlinie: ihre Gestalt aus den Segmenten (Verbindet, Verläuft über, Abschnitte). */
        lineShape: Type.Optional(SubjectLineShape),
        /**
         * Ort, Herrschaftsgebiet, Landschaft und Weg: die Sprachen, deren Flächen das Objekt treffen (WI-0261 S5b, Zeile „Sprachen“); fehlt, wo keine trifft. Sie
         * kommen aus dem abgeleiteten Zwischenspeicher `sprache_treffer` (S4) und stehen nach einer Änderung für dessen Sammelzeit auf dem alten Stand.
         */
        sprachen: Type.Optional(Type.Array(SubjectSprache, { minItems: 1 })),
        /** Sprache: was ihre Infobox über den gemeinsamen Vertrag hinaus braucht (Treffer, Wiki-Artikel, Herkunft der Flächen). */
        sprache: Type.Optional(SubjectSpracheBlock),
    },
    { $id: "SubjectDetail", ...strict },
);
export type SubjectDetail = Static<typeof SubjectDetail>;

// ---------------------------------------------------------------------------------------------------------------
// Sektion Quellen
// ---------------------------------------------------------------------------------------------------------------

export const SOURCE_TYPES = [
    "regionalspielhilfe",
    "abenteuer",
    "aventurischer_bote",
    "quellenband",
    "roman",
    "briefspiel",
    "regelbuch",
    "sonstiges",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_REFERENCE_KINDS = ["ausfuehrlich", "ergaenzend", "erwaehnung"] as const;
export type SourceReferenceKind = (typeof SOURCE_REFERENCE_KINDS)[number];

/**
 * Eine Quelle eines Subjects: Titel, Art, Seiten, Notiz, Lizenz und Namensnennung getrennt. `referenceKind` fehlt bei
 * einer echten Quelle und nennt bei einer Publikation, wie ausführlich sie das Subject behandelt. Eine nicht erfasste
 * Lizenz fehlt (leer heißt nie „keine Lizenz“, D1).
 */
export const SourceEntry = Type.Object(
    {
        title: Type.Optional(Type.String({ minLength: 1 })),
        url: Type.Optional(Type.String({ pattern: "^https?://" })),
        type: Type.Union(SOURCE_TYPES.map((type) => Type.Literal(type))),
        official: Type.Boolean(),
        referenceKind: Type.Optional(Type.Union(SOURCE_REFERENCE_KINDS.map((kind) => Type.Literal(kind)))),
        pages: Type.Optional(Type.String({ minLength: 1 })),
        note: Type.Optional(Type.String({ minLength: 1 })),
        license: Type.Optional(
            Type.Object(
                {
                    statement: Type.Union([
                        Type.Literal("license"),
                        Type.Literal("public_domain"),
                        Type.Literal("unfree"),
                    ]),
                    name: Type.Optional(Type.String({ minLength: 1 })),
                    uri: Type.Optional(Type.String({ pattern: "^https://" })),
                },
                strict,
            ),
        ),
        attribution: Type.Optional(Type.String({ minLength: 1 })),
        corpus: Type.Optional(
            Type.Object(
                { key: Type.String({ minLength: 1 }), label: Type.Optional(Type.String({ minLength: 1 })) },
                strict,
            ),
        ),
    },
    strict,
);
export type SourceEntry = Static<typeof SourceEntry>;

/** Die Quellen des Subjects SELBST, nie vererbt (WI-0063 5.5); bei einer Gruppe die Vereinigung ohne Doppel. */
export const SubjectSourcesSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        sources: Type.Array(SourceEntry),
    },
    { $id: "SubjectSourcesSection", ...strict },
);
export type SubjectSourcesSection = Static<typeof SubjectSourcesSection>;

// ---------------------------------------------------------------------------------------------------------------
// Sektion Literatur (WI-0063 P8, D3, `literature.yaml`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mit welcher Aussage ein Werk an diesem Gegenstand steht (`adventure_place.role`): `start` „beginnt hier“, `play` „spielt hier“,
 * `covers` „beschreibt“.
 *
 * 🔴 `play` IST der Spoiler (`literature.yaml` -> `spoiler`): Es gibt kein zweites Feld daneben, weil es keine zweite Wahrheit geben
 * soll. Dasselbe Werk kann an einem Ort offen (`start`) und an einem anderen verschleiert (`play`) stehen.
 */
export const LITERATURE_ROLES = ["start", "play", "covers"] as const;
export type LiteratureRole = (typeof LITERATURE_ROLES)[number];

/** Die Läden, in die die Deckelfläche eines Werks führt, in Legacys Rangfolge (`advLinkMeta`): Ulisses eBook vor F-Shop. */
export const LITERATURE_SHOPS = ["ulisses", "fshop"] as const;
export type LiteratureShop = (typeof LITERATURE_SHOPS)[number];

/**
 * Ein Werk der Spielliteratur, das diesen Gegenstand nennt (Legacy `buildGameLiteratureCardMarkup`). Alles wörtlich aus dem Katalog:
 * `productType` ist Legacys offenes Vokabular (`gruppenabenteuer`, `regionalspielhilfe` …), `edition` und `year` sind die Angaben des
 * Werks, wie sie dastehen. Nicht erfasste Felder fehlen (WI-0063 5.3).
 *
 * Die Karte zeigt sie in dieser Reihenfolge: Umschlag - Titel - `edition · year` - `productType` - „enthalten in: `containedIn`“.
 * Der Umschlag kommt aus dem Media Core und fehlt an einem Teil der Werke; die Karte bleibt dieselbe. Das Fenster „Literatur zu …“
 * und sein vergrößerter Eintrag zeigen dazu Schlagworte, Schwierigkeit, Jahr und ALLE Links (WI-0118).
 */
export const LiteratureEntry = Type.Object(
    {
        /** Die Kennung des Werks (`adventure.public_id`): Das Fenster der Literatur merkt sich darüber, welcher Eintrag aufgeklappt ist. */
        id: Uuid(),
        title: Type.String({ minLength: 1 }),
        /** Der Artikel des Werks in der Wiki Aventurica; nur http(s) (`literature.yaml` -> `url_regel`). Ohne ihn bleibt der Titel Text. */
        url: Type.Optional(Type.String({ pattern: "^https?://" })),
        /**
         * Der Umschlag des Werks (Rolle `literature_cover`), genau wie der Media Core ihn freigibt. 🔴 Er FEHLT, wo es keine
         * veröffentlichte Datei gibt - und das ist kein Fehler, sondern der Normalfall an einem Teil des Bestands. Wo er fehlt,
         * zeichnet die Karte KEIN Bild: keinen Rahmen, keine Beschriftung, keinen Alternativtext (MEDIA-M12).
         */
        cover: Type.Optional(MediaView),
        productType: Type.String({ minLength: 1 }),
        edition: Type.Optional(Type.String({ minLength: 1 })),
        /** Die Jahresangabe, wörtlich (`bf_label`, sonst `bf_year`); Legacy führt sie nur an sechs Werken. */
        year: Type.Optional(Type.String({ minLength: 1 })),
        /** Das Jahr als Zahl (`bf_year`), wo der Bestand es führt: Der Filter „Zeitraum“ des Fensters rechnet damit. */
        bfYear: Type.Optional(Type.Integer()),
        /** „Enthalten in“: das Sammelwerk, in dem das Werk steckt - dorthin führt auch sein Ladenlink. */
        containedIn: Type.Optional(Type.String({ minLength: 1 })),
        role: Type.Union(LITERATURE_ROLES.map((role) => Type.Literal(role))),
        /** Der Laden, in den der Umschlag führt; ohne ihn führt er auf denselben Artikel wie der Titel (Legacy `advBestLink`). */
        shop: Type.Optional(
            Type.Object(
                {
                    kind: Type.Union(LITERATURE_SHOPS.map((shop) => Type.Literal(shop))),
                    url: Type.String({ pattern: "^https?://" }),
                },
                strict,
            ),
        ),
        /**
         * Die Schlagworte des Werks (Spalte `genre`, am Komma getrennt, jedes für sich getrimmt): „Stadtabenteuer, Kriegsszenario“
         * sind zwei. Der Filter „Genre“ des Fensters vergleicht EIN Schlagwort, nicht den ganzen Text (WI-0118).
         */
        genres: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
        /** Die Schwierigkeit, wie Legacy sie nennt: die der Spielleitung (`complexity_gm`), sonst die der Spielenden (`complexity_pl`). */
        complexity: Type.Optional(Type.String({ minLength: 1 })),
        /** Ein offizielles Werk (`is_official`); dreiwertig, ein fehlender Wert heißt unbekannt. */
        official: Type.Optional(Type.Boolean()),
        /**
         * ALLE Links des Werks in Legacys Klickreihenfolge (Ulisses eBook, F-Shop, Wiki Aventurica, Dt. Nationalbibliothek), nur
         * http(s). Die Nationalbibliothek ist eine Suche nach dem Titel (der Bestand führt keine ISBN). Ein Prüfzustand der Links
         * (online, offline) gehört NICHT dazu: ein eigener Linkprüfer ist ein eigenes Paket (WI-0118).
         */
        links: Type.Optional(Type.Array(CatalogLink, { minItems: 1 })),
    },
    strict,
);
export type LiteratureEntry = Static<typeof LiteratureEntry>;

/**
 * Die Werke, die diesen Gegenstand nennen (D3), in Legacys Anzeigereihenfolge (`avesmapsCompareGameLiteratureRecency`): Edition
 * (DSA5 vor DSA1, Nicht-DSA danach, ohne Edition zuletzt), dann Jahr absteigend, dann Titel.
 *
 * 🔴 Die ROLLE geht in die Reihenfolge NICHT ein: Ein Spoiler steht verschleiert an seinem Sortierplatz, nicht als Block am Ende
 * (Legacy, Owner 2026-07-19).
 * 🔴 Nie vererbt und nie erfunden: genau die Werke, die auf diesen Träger zeigen; bei einer Gruppe (Weg, Landschaft) die Vereinigung
 * ihrer Mitglieder, jedes Werk einmal.
 */
export const SubjectLiteratureSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        works: Type.Array(LiteratureEntry),
        /** Ein Inhaltsschalter blendet den Abschnitt aus (WI-0127 SYS-10, `panel.literature`): `works` ist dann leer. */
        paused: Type.Optional(Type.Literal(true)),
        /** Nur für einen Editor mit `?editor=true` (WI-0127 SYS-11): der Abschnitt ist echt, für Besucher aber ausgeblendet. */
        publicHidden: Type.Optional(Type.Literal(true)),
    },
    { $id: "SubjectLiteratureSection", ...strict },
);
export type SubjectLiteratureSection = Static<typeof SubjectLiteratureSection>;

/**
 * Wie viele Werke OFFEN dastehen: alles außer `play` (Legacy `place-extras.js:929-933`). 🔴 Ein verdeckter Eintrag zählt nicht mit -
 * „sonst verriete die Zahl allein schon, wie viel hier gespielt wird“.
 */
export const openLiteratureCount = (works: readonly { role: LiteratureRole }[]): number =>
    works.filter((work) => work.role !== "play").length;

// ---------------------------------------------------------------------------------------------------------------
// Sektion Kartensammlung (WI-0063 P8, D2, `citymaps.yaml`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Eine Karte der Kartensammlung, die diesen Gegenstand abbildet (Legacy `cityMapCardMarkup`, `buildCityMapRowMarkup`): Die Kachel
 * des Streifens zeigt die Vorschau und darunter den vollen Titel, nichts weiter. Alles andere - Art, Typen, Farbmodus, Zeitraum,
 * Zeichner, Verlag, Auflösung, Notiz, der Band, alle Fundstellen und das Vollbild - steht im Fenster „Kartensammlung von …“ und
 * in dessen vergrößertem Eintrag (WI-0118). 🔴 Alles Neue ist additiv: ein Feld ohne Wert fehlt.
 *
 * 🪤 `spoiler` steht nur bei einem ausdrücklichen Ja: `is_spoiler` ist dreiwertig, und UNBEKANNT ist KEIN Spoiler (Legacy
 * `cityMapIsSpoiler`, `citymaps.yaml` -> `spoiler`).
 */
export const CitymapEntry = Type.Object(
    {
        /** Die Kennung der Karte (`citymap.public_id`): Das Fenster merkt sich darüber, welcher Eintrag aufgeklappt ist. */
        id: Uuid(),
        title: Type.String({ minLength: 1 }),
        spoiler: Type.Optional(Type.Literal(true)),
        /**
         * Wo es die Karte gibt (Karten-Link `primary`). Bei Wiki-Karten zeigt er auf die PUBLIKATION, nicht auf die Karte selbst -
         * darum heißt er Fundstelle (`citymaps.yaml` -> `map_url_ist_publikationsseite`). 🪤 `paid` ist dreiwertig: Ein fehlender Wert
         * heißt unbekannt, nie „frei“. Ohne Fundstelle zeigt die Kachel ihren Titel und tut nicht so, als verlinke sie (Legacy).
         */
        find: Type.Optional(
            Type.Object(
                {
                    label: Type.String({ minLength: 1 }),
                    url: Type.String({ pattern: "^https?://" }),
                    paid: Type.Optional(Type.Boolean()),
                },
                strict,
            ),
        ),
        /**
         * Die Vorschau der Karte (Rolle `map_preview`), genau wie der Media Core sie freigibt. 🔴 Sie FEHLT, wo es keine
         * veröffentlichte Datei gibt; die Kachel zeichnet dann KEIN Bild - keinen Rahmen, keine Beschriftung, keinen
         * Alternativtext (MEDIA-M12).
         */
        preview: Type.Optional(MediaView),
        /**
         * Das Vollbild der Karte (Rolle `map_full`), genau wie der Media Core es freigibt - dieselbe Entscheidung wie bei der
         * Vorschau, keine zweite Rechteliste. 🔴 Es FEHLT fast überall: am Bestand trägt heute eine einzige Karte eines (Rhôndur),
         * und die Rechte der übrigen sind nicht geklärt. Das vergrößerte Verzeichnis zeigt es groß; ein Klick darauf öffnet es in
         * voller Größe (WI-0118).
         */
        full: Type.Optional(MediaView),
        /**
         * WI-0287 Stufe 2: ALLE Versionen der Karte (die aktiven `map_full` des Eintrags, in ihrer Reihenfolge), je mit ihrer Bezeichnung („Spielerversion“; fehlt, wo
         * niemand eine vergeben hat) und ihrem Vollbild, wo der Media Core es freigibt (`view`; fehlt sonst, das Fenster zeigt dann die Vorschau). `full` bleibt das
         * Vollbild der ersten Version, die eines hat. Fehlt, wo es keine Karte gibt. Das Fenster zeigt ab zwei Versionen Reiter.
         */
        fulls: Type.Optional(
            Type.Array(
                Type.Object(
                    { label: Type.Optional(Type.String({ minLength: 1 })), view: Type.Optional(MediaView) },
                    strict,
                ),
                { minItems: 1 },
            ),
        ),
        /**
         * Der Band, aus dem die Karte stammt: der Titel ihrer ersten Quelle (`citymap_source` -> `feature_source.title`, in
         * Legacys Reihenfolge). Er ist die Identität einer Zeile im Fenster (Legacy `cityMapBandLabel`).
         */
        band: Type.Optional(Type.String({ minLength: 1 })),
        /**
         * WI-0287: ALLE Publikationen der Karte (die aktiven Quellen, in der Reihenfolge am Eintrag), die erste ist `band`. Fehlt, wo es keine gibt. Das Fenster zeigt sie unter
         * „Bände“, sobald es mehr als eine sind.
         */
        bands: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
        /** Die Kartentypen (`citymap_type.type_key`, Legacy: Ortsplan, Stadtplan, Grundriss …), eine Menge; der Client benennt sie. */
        types: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
        /** Politisch, derographisch, topologisch oder Skizze; fehlt, wo niemand es erfasst hat. */
        art: Type.Optional(Type.String({ minLength: 1 })),
        /** Graustufen, Brauntöne oder farbig (`citymap.color_mode`); fehlt, wo niemand es erfasst hat. */
        colorMode: Type.Optional(Type.String({ minLength: 1 })),
        /**
         * Die dreiwertigen Eigenschaften (`is_official` …): NUR ein ausdrückliches Ja oder Nein steht da, UNBEKANNT fehlt - nie
         * als `false` erfunden (Legacy: „Unbekannte Werte matchen keinen Filter außer ‚alle‘“).
         */
        official: Type.Optional(Type.Boolean()),
        labeled: Type.Optional(Type.Boolean()),
        multilevel: Type.Optional(Type.Boolean()),
        hasScale: Type.Optional(Type.Boolean()),
        /** Der Zeitraum in BF. `validTo` 9999 ist Legacys offenes Ende und KEINE Jahreszahl (Migration 0069). */
        validFrom: Type.Optional(Type.Integer()),
        validTo: Type.Optional(Type.Integer()),
        /** Das gedruckte Blattformat, Freitext („A2“, „43 x 57 cm“), nie geparst. */
        format: Type.Optional(Type.String({ minLength: 1 })),
        /** Der Zeichner; der Verlag steht daneben, nie an seiner Stelle. */
        author: Type.Optional(Type.String({ minLength: 1 })),
        publisher: Type.Optional(Type.String({ minLength: 1 })),
        /** Die Auflösung der Karte in Pixeln, wie die Quelle sie nennt (kein Dateimaß). */
        widthPx: Type.Optional(Type.Integer({ minimum: 1 })),
        heightPx: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Die Notiz, wörtlich (kann halbstrukturierten Abgleichstext tragen). */
        note: Type.Optional(Type.String({ minLength: 1 })),
        /**
         * ALLE Fundstellen der Karte, der Karten-Link `primary` und die weiteren, in Legacys Klickreihenfolge, nur http(s). Ein
         * Prüfzustand der Links (online, offline) gehört NICHT dazu (WI-0118).
         */
        links: Type.Optional(Type.Array(CatalogLink, { minItems: 1 })),
    },
    strict,
);
export type CitymapEntry = Static<typeof CitymapEntry>;

/**
 * Die Karten, die diesen Gegenstand abbilden (D2), nach Titel sortiert - Legacys Katalog liefert sie so (`ORDER BY title ASC`), und
 * der Streifen behält die Reihenfolge des Katalogs.
 */
export const SubjectCitymapsSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        maps: Type.Array(CitymapEntry),
        /** Ein Inhaltsschalter blendet den Abschnitt aus (WI-0127 SYS-10, `panel.citymaps`): `maps` ist dann leer. */
        paused: Type.Optional(Type.Literal(true)),
        /** Nur für einen Editor mit `?editor=true` (WI-0127 SYS-11): der Abschnitt ist echt, für Besucher aber ausgeblendet. */
        publicHidden: Type.Optional(Type.Literal(true)),
    },
    { $id: "SubjectCitymapsSection", ...strict },
);
export type SubjectCitymapsSection = Static<typeof SubjectCitymapsSection>;

// ---------------------------------------------------------------------------------------------------------------
// Sektion Bewertungen (WI-0063 P8, D4, `reviews.yaml`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * So viele Bewertungen liefert die Sektion höchstens (Legacys Serverlimit); `count` nennt weiter ALLE öffentlichen. Der Reiter zeigt zuerst
 * zwölf (`BEWERTUNG_ZUERST_GEZEIGT`, Legacys Client) und mit „Alle N zeigen“ die übrigen.
 */
export const SUBJECT_REVIEW_LIMIT = 50;

/**
 * Eine sichtbare Bewertung eines Ortes. 🔴 KEINE Personenangabe (`reviews.yaml`, Datenschutz): `author` ist der freie Anzeigename,
 * den der Verfasser selbst eingetragen hat, und fehlt, wo keiner steht (der Leser schreibt dann „Anonym“); es gibt keine Kennung,
 * keine Anlagezeit und keine Zuordnung zu einem Konto. `date` ist das aventurische Datum, wörtlich, nie ein echtes Datum.
 */
export const ReviewEntry = Type.Object(
    {
        /**
         * Die öffentliche Kennung der Bewertung (`place_review.public_id`; WI-0269): für „Teilen“, „Gefällt mir“ und „Melden“. Fehlt bei
         * Antworten eines älteren Servers; der Client liest tolerant.
         */
        id: Type.Optional(Type.String({ minLength: 1 })),
        /** Die anonyme Zahl „Gefällt mir“; fehlt bei 0. */
        likes: Type.Optional(Type.Integer({ minimum: 1 })),
        stars: Type.Integer({ minimum: 1, maximum: 5 }),
        author: Type.Optional(Type.String({ minLength: 1 })),
        text: Type.Optional(Type.String({ minLength: 1 })),
        date: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type ReviewEntry = Static<typeof ReviewEntry>;

/**
 * Die Bewertungen eines Ortes (D4), neueste zuerst. `count` und `average` gelten für ALLE sichtbaren Bewertungen, nicht für die
 * gezeigten; beide sind abgeleitet und nie gespeichert (`reviews.yaml` -> `zusammenfassung`).
 */
export const SubjectReviewsSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        count: Type.Integer({ minimum: 0 }),
        /** Der Durchschnitt auf eine Nachkommastelle; fehlt ohne Bewertung. */
        average: Type.Optional(Type.Number({ minimum: 1, maximum: 5 })),
        /** Die Verteilung der Sterne über ALLE öffentlichen Bewertungen: `[Anzahl 5, 4, 3, 2, 1]` (WI-0269); fehlt ohne Bewertung. */
        distribution: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }), { minItems: 5, maxItems: 5 })),
        reviews: Type.Array(ReviewEntry, { maxItems: SUBJECT_REVIEW_LIMIT }),
        /** Ein Inhaltsschalter blendet den Abschnitt aus (WI-0127 SYS-10, `panel.reviews`): ohne Zahl und Liste. */
        paused: Type.Optional(Type.Literal(true)),
        /** Nur für einen Editor mit `?editor=true` (WI-0127 SYS-11): der Abschnitt ist echt, für Besucher aber ausgeblendet. */
        publicHidden: Type.Optional(Type.Literal(true)),
    },
    { $id: "SubjectReviewsSection", ...strict },
);
export type SubjectReviewsSection = Static<typeof SubjectReviewsSection>;

// ---------------------------------------------------------------------------------------------------------------
// Sektion Vorkommen (WI-0091, D5, `lore.yaml` -> `panelbezug`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ein Eintrag im aufgeklappten Inhalt einer Lore-Zeile: der Name und, wo es eines gibt, sein Ziel.
 *
 * 🔴 `ref` entsteht NUR über den Wiki-Schlüssel des Eintrags durch dieselbe Schleuse wie alle Objektlinks
 * (`wiki-key-lookup.ts`, `canonicalWikiKey`) und nur, wenn GENAU EIN Kartenobjekt ihn trägt - nie über den Namen
 * (Betreiber 2026-10-05: „was du mit der namensauflösung gemacht hast, haben wir schonmal verbockt“). Mehrdeutig heißt
 * kein Link.
 *
 * Wo kein Kartenobjekt passt, trägt `ref` den Eintrag selbst (`{ kind: "loreEntry", id }`, `id` = `lore_entry.public_id`): Der Name öffnet die
 * Infobox des Vorkommens wie ein Treffer der Suche (Betreiber 2026-10-30). Der Wiki-Artikel steht dort im Quellenkasten. `url` bleibt im Vertrag
 * für ältere Antworten, der Server füllt es für Vorkommen nicht mehr.
 *
 * 🔍 Gemessen am Satz vom 2026-10-06: von 5.138 Einträgen trägt **einer** einen Schlüssel, den ein Kartenobjekt trägt
 * (die Ware „Schattenstein“); alle 5.138 tragen eine Wiki-Adresse. Ein Tier, eine Pflanze und eine Ware sind eben keine
 * Kartenobjekte - der Kartenobjekt-Link ist der Ausnahmefall, der Link auf die Infobox des Vorkommens die Regel.
 */
export const LoreEntryView = Type.Object(
    {
        name: Type.String({ minLength: 1 }),
        ref: Type.Optional(SubjectRef),
        url: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type LoreEntryView = Static<typeof LoreEntryView>;

/** Eine Gruppe des aufgeklappten Inhalts (`LORE_GROUPS`); eine leere Gruppe steht nicht in der Antwort. */
export const LoreGroupView = Type.Object(
    {
        group: Type.Union([Type.Literal("origin"), Type.Literal("here"), Type.Literal("region")]),
        entries: Type.Array(LoreEntryView, { minItems: 1, maxItems: LORE_ROW_LIMIT }),
    },
    strict,
);
export type LoreGroupView = Static<typeof LoreGroupView>;

/**
 * Der Link „Überall in Aventurien“ am Ende einer Zeile (Betreiber 2026-10-06): 🔴 **keine Liste, sondern ein Weg zur Landschaft
 * „Aventurien“**, wo genau diese Einträge ihr eigenes „Direkt hier“ sind. Darum reist kein einziger der bis zu 476 Namen mit.
 *
 * `ref` entsteht über dieselbe Schleuse wie jeder andere Objektlink (`wiki-key-lookup.ts`, `canonicalWikiKey` auf den Schlüssel
 * `aventurien`); löst er nicht auf GENAU EIN Kartenobjekt auf, fehlt der Link ganz - nie ein toter Link. `count` sagt, was am
 * Ziel steht, damit der Leser weiß, ob der Klick sich lohnt (Design Guide §16.3).
 */
export const LoreEverywhereLink = Type.Object({ ref: SubjectRef, count: Type.Integer({ minimum: 1 }) }, strict);
export type LoreEverywhereLink = Static<typeof LoreEverywhereLink>;

/**
 * Eine der vier Zeilen, aufgeklappt. `count` ist dieselbe Zahl wie `counts.lore[kind]` der Detailantwort: Satz und Liste kommen
 * aus derselben Regel (`LORE_READING`), damit die Zeile nicht „11“ sagt und 458 zeigt.
 *
 * 🪤 `groups` darf LEER sein, solange `everywhere` steht: Ein Gegenstand ohne eigene und ohne regionale Einträge trägt dann nur
 * die Linkzeile. 🔴 **Ob eine solche Zeile entsteht, entscheidet seit WI-0104 `loreRowStands`, nicht ihr Zähler** - unter
 * `countScope: "own"` ist `count` dort **0**, und die Zeile steht trotzdem (Betreiber 2026-10-07: die Linkzeile steht überall).
 * Darum ist die Untergrenze von `count` `0` und nicht `1`.
 */
export const LoreRowView = Type.Object(
    {
        kind: LoreKindLiteral,
        count: Type.Integer({ minimum: 0 }),
        groups: Type.Array(LoreGroupView),
        everywhere: Type.Optional(LoreEverywhereLink),
    },
    strict,
);
export type LoreRowView = Static<typeof LoreRowView>;

/**
 * Die Vorkommen eines Gegenstands (D5), verzögert geholt: `GET {detail}/lore`. 🔴 Sie steht NICHT in der Detailantwort - bei
 * Median 47 und bis zu 256 geerbten Einträgen je Ort wäre die eifrige Liste an jedem Ort dreistellig (`lore.yaml` -> `panelbezug.detailvertrag`, WI-0091 §4.1).
 * Eine Art ohne Eintrag hat keine Zeile; ein Gegenstand ohne Vorkommen antwortet mit `rows: []`.
 */
export const SubjectLoreSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        rows: Type.Array(LoreRowView, { maxItems: 4 }),
        /** Die Arten, die ein Inhaltsschalter ausblendet (WI-0127 SYS-10, `panel.lore.<art>`); ihre Zeilen fehlen in `rows`. */
        pausedKinds: Type.Optional(Type.Array(LoreKindLiteral, { maxItems: 4 })),
        /** Nur für einen Editor mit `?editor=true` (WI-0127 SYS-11): diese Arten stehen echt da, für Besucher aber ausgeblendet. */
        publicHiddenKinds: Type.Optional(Type.Array(LoreKindLiteral, { maxItems: 4 })),
    },
    { $id: "SubjectLoreSection", ...strict },
);
export type SubjectLoreSection = Static<typeof SubjectLoreSection>;

/** Die Gruppen einer Zeile in der Reihenfolge, in der sie dastehen (`LORE_GROUPS`); nur für die Sortierung der Antwort. */
export const loreGroupOrder = (group: LoreGroup): number => ({ origin: 0, here: 1, region: 2 })[group];

/**
 * Die Abfrage einer freien Kartenstelle.
 *
 * `layers`: die teilnehmenden Landschaftsebenen der aktiven Ansicht, durch Komma getrennt - dieselbe Schreibweise wie
 * bei `/api/areas/at` (WI-0058). 🔴 **Optional, und das ist der Vertrag:** Fehlt der Parameter, antwortet der Endpunkt
 * wie vor WI-0083 (alle Ebenen, Flüsse im Umkreis), damit alte Links und fremde Aufrufer gültig bleiben. Der Client
 * füllt ihn mit dem, was die Karteninteraktion ohnehin kennt (`areaLayersInView`), nie mit einer eigenen Liste.
 */
export const MapPointQuery = Type.Object(
    {
        x: Type.Number({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y: Type.Number({ minimum: WORLD.minY, maximum: WORLD.maxY }),
        layers: Type.Optional(
            Type.String({
                pattern: `^${LANDSCAPE_LAYER_GROUP}(,${LANDSCAPE_LAYER_GROUP}){0,${String(LANDSCAPE_LAYERS.length - 1)}}$`,
            }),
        ),
    },
    { $id: "MapPointQuery", ...strict },
);
export type MapPointQuery = Static<typeof MapPointQuery>;

/**
 * Die Ebenen aus `layers` der Abfrage, als Liste; `undefined` ohne Parameter („alle Ebenen, wie bisher“).
 *
 * 🪤 Die EINE Stelle, die die Schreibweise liest: Das Schema prüft sie schon, hier wird sie nur zerlegt. Unbekanntes
 * fällt weg, statt die Abfrage zu kippen - der Filter wird damit nur weiter, nie falsch.
 */
export function mapPointLayers(value: string | undefined): readonly LandscapeLayer[] | undefined {
    if (value === undefined) return undefined;
    const known = value
        .split(",")
        .filter((layer): layer is LandscapeLayer => (LANDSCAPE_LAYERS as readonly string[]).includes(layer));
    return [...new Set(known)];
}

/**
 * Ein Nachbar einer freien Kartenstelle (WI-0063 P7, Legacy „In der Nähe“): ein Ort oder ein Weg mit Abstand und Peilung. `type` ist die
 * Ortsklasse beziehungsweise die Wegart als Schlüssel für die Sprachtafeln; `name` fehlt bei einem Weg ohne Namen. `miles` ist die
 * Entfernung in Meilen (der Maßstab steht nur im Kartenraum, nie im Client), `bearing` die rechtweisende Peilung in Grad: 0 = Norden,
 * im Uhrzeigersinn.
 */
export const NearbyItem = Type.Object(
    {
        ref: Type.Union([PlaceRef, PathRef]),
        type: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        miles: Type.Number({ minimum: 0 }),
        bearing: Type.Number({ minimum: 0, exclusiveMaximum: 360 }),
    },
    strict,
);
export type NearbyItem = Static<typeof NearbyItem>;

/**
 * Die Auskunft über eine freie Kartenstelle: Kontext exakt am Punkt und, was rundherum liegt (WI-0063 4.9, 5.4, P7), dazu
 * die Vorkommen der Flächen, die den Punkt enthalten (WI-0110).
 *
 * 🔴 **Die vier Vorkommenszeilen reisen HIER mit, nicht in einer zweiten Frage** (WI-0110, Nachfrage der Editoren
 * 2026-10-08: „‚Was ist hier‘ -> Vorkommen anzeigen? geht das?“). Ein Kartenpunkt hat keine Adresse, unter der eine Sektion
 * nachzuholen wäre (`subjectSectionUrl` gibt für ihn `null`) - dieselbe Lage wie bei der Routenetappe (WI-0106), und wie
 * dort kommen Zähler UND Namen in EINEM Lauf. 🪤 Das ist am Punkt auch die billigste Form: Die Stelle ist ein PUNKT, kein
 * Linienzug und keine zu vereinigende Fläche.
 *
 * 🔴 **`layers` filtert die Vorkommen NICHT.** Die Ansicht formt nur, welche Landschaften GENANNT werden
 * (`context.landscapes`); was in einer Fläche vorkommt, beschreibt die Stelle und nicht das Kartenbild - dieselbe
 * Begründung, mit der schon Gebietskette und Klimaband ungefiltert bleiben.
 *
 * Fehlt das Feld, gibt es an dieser Stelle keine einzige Zeile (ein Teil ohne Inhalt steht nicht in der Antwort, WI-0063 5.3).
 */
export const MapPointDetail = Type.Object(
    {
        subject: MapPointRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        context: Type.Optional(SubjectContext),
        nearby: Type.Optional(Type.Array(NearbyItem, { minItems: 1 })),
        lore: Type.Optional(Type.Array(LoreRowView, { minItems: 1, maxItems: 4 })),
        /** Die Sprachen, deren Flächen die Stelle enthalten (WI-0261, Betreiber 2026-10-31), wie an einem Ort ohne Anteil. Ohne Sprache fehlt das Feld. */
        sprachen: Type.Optional(Type.Array(SubjectSprache, { minItems: 1 })),
    },
    { $id: "MapPointDetail", ...strict },
);
export type MapPointDetail = Static<typeof MapPointDetail>;

// ---------------------------------------------------------------------------------------------------------------
// Stätten (D7, WI-0109, `staetten.yaml` -> `panelbezug`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Eine Stätte im aufgeklappten Inhalt der Zeile „Stätten“: der Name, sein Wiki-Artikel und, wo sie auf der Karte steht, der Sprung.
 *
 * `url` ist der Wiki-Artikel, aber **nur auf `https://de.wiki-aventurica.de/`** - genau wie bei den Vorkommen; alles andere bleibt
 * reiner Text (gemessen 2026-10-08: 273 Adressen zeigen auf `garetien.de`, eine auf `koschwiki.de`, 21 Stätten haben gar keine).
 *
 * 🔴 `jump` ist der Sprung ⊕ auf das Kartenobjekt und entsteht NUR, wo Legacys `auf_der_karte` wahr ist UND die Kennung einen
 * aktiven Ort trifft - sonst fehlt er ganz (nie ein toter Sprung). Er ist **auch für Besucher** da, kein Editorrecht (Legacy:
 * „auch für Besucher sichtbar“). Gemessen tragen 2 von 4.092 Stätten einen.
 */
export const StaetteView = Type.Object(
    {
        name: Type.String({ minLength: 1 }),
        url: Type.Optional(Type.String({ minLength: 1 })),
        jump: Type.Optional(SubjectRef),
    },
    strict,
);
export type StaetteView = Static<typeof StaetteView>;

/**
 * Eine Gruppe des aufgeklappten Inhalts: **die ART**, nicht die Nähe (das ist der eine Unterschied zu den Vorkommen - dort
 * gliedert die Nähe, hier die Art).
 *
 * 🔴 `type` ist Legacys `settlement_place.place_type`, **wörtlich und auch LEER**. Legacys Leser setzt dort den Rückfall
 * „Bauwerk“ (`art = type || "Bauwerk"`); das ist ein ANZEIGEWORT und steht bei uns in der Sprachtafel, nicht in der Antwort -
 * ein erfundener Wert wäre beim nächsten Zug nicht mehr von einem echten zu unterscheiden. Leer heißt also „Legacy nennt keine
 * Art“ (gemessen 10 von 4.092).
 *
 * 💣 Legacys Wert kann HTML-Reste tragen (14 Arten, 36 Stätten): `organisation-seats.php` schneidet mit `explode('/')` am
 * Schrägstrich des schließenden `</small>`. 🔴 **Der Import speichert die Art bereinigt** (WI-0122, Betreiber 2026-10-09:
 * „Markup im Import bereinigen“; `cleanPlaceType` in `apps/server/src/migration/staetten.ts`), hier wird nichts gefiltert.
 */
export const StaettenGroup = Type.Object(
    {
        type: Type.String(),
        entries: Type.Array(StaetteView, { minItems: 1 }),
    },
    strict,
);
export type StaettenGroup = Static<typeof StaettenGroup>;

/**
 * Die Stätten eines Ortes (D7), verzögert geholt: `GET {detail}/staetten`. 🔴 Sie stehen NICHT in der Detailantwort - Gareth
 * trägt 414 Stätten in 121 Arten (gemessen 2026-10-08), der Median über die 495 Orte mit Stätten ist 2.
 *
 * 🪤 **Legacy braucht dafür keine Frage**, weil die ganze flache Liste (4.092 Einträge) im Kartenpayload mitreist und der Leser
 * sie EINMAL in einen Eimer nach Stadtnamen legt. Bei uns reist sie nicht mit, und das ist der ganze Unterschied: eine Frage je
 * geöffnete Zeile statt 4.092 Einträge je Kartenaufruf.
 *
 * `count` ist dieselbe Zahl wie `counts.staetten` der Detailantwort - Satz und Liste kommen aus derselben Abfrage. Ein Ort ohne
 * Stätten antwortet mit `groups: []` und `count: 0`; eine Zeile entsteht daraus nicht.
 */
export const SubjectStaettenSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        count: Type.Integer({ minimum: 0 }),
        groups: Type.Array(StaettenGroup),
    },
    { $id: "SubjectStaettenSection", ...strict },
);
export type SubjectStaettenSection = Static<typeof SubjectStaettenSection>;

/**
 * Höchstzahl der Einträge im Abschnitt „Treffer“ einer Sprache: eine Schranke gegen Ausreißer, keine Auswahl. Garethi trifft rund 4 700 Orte und ebenso viele Wege.
 */
export const SPRACH_TREFFER_ABSCHNITT_LIMIT = 20_000;

/**
 * `GET /api/subjects/sprache/{id}/treffer/{art}` (WI-0261; Betreiber 2026-10-31: „kannst du dich hier an das design der bisherigen item in der infobox halten“): ALLE
 * Treffer einer Art, für die aufgeklappte Zeile unter „Wo sie gesprochen wird“, die wie eine Vorkommenszeile sucht und nach Buchstaben gliedert. Geholt wird erst beim
 * Aufklappen; die Detailantwort trägt nur die Zahl und die ersten Einträge (`SprachTrefferListe`). `anzahl` ist dieselbe Zahl wie dort.
 */
export const SubjectSprachTrefferSection = Type.Object(
    {
        subject: SubjectRef,
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        art: Type.Union(SPRACH_TREFFER_ARTEN.map((art) => Type.Literal(art))),
        anzahl: Type.Integer({ minimum: 0 }),
        eintraege: Type.Array(SprachTrefferEintrag, { maxItems: SPRACH_TREFFER_ABSCHNITT_LIMIT }),
    },
    { $id: "SubjectSprachTrefferSection", ...strict },
);
export type SubjectSprachTrefferSection = Static<typeof SubjectSprachTrefferSection>;

// ---------------------------------------------------------------------------------------------------------------
// Objektlinks (WI-0063 4.6, `subject-details.yaml` -> `objektlinks`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Die Objektlink-Schlüssel, so wie die Wiki Aventurica sie nutzt: Legacys deutsche Namen bleiben gültig, dazu gibt es
 * englische Aliase. Die Reihenfolge ist Legacys feste Priorität (`place` wird wie in Legacy davor verarbeitet): der erste
 * vorhandene gewinnt, bei deutsch und englisch gleicher Bedeutung der deutsche Schlüssel.
 */
export const OBJECT_LINK_PARAMS = ["place", "siedlung", "staat", "region", "strasse", "fluss"] as const;
export type ObjectLinkParam = (typeof OBJECT_LINK_PARAMS)[number];

/** Die englischen Aliase auf den deutschen Schlüssel. `region` und `place` heißen in beiden Sprachen gleich. */
export const OBJECT_LINK_ALIASES: Readonly<Record<string, ObjectLinkParam>> = {
    place: "place",
    siedlung: "siedlung",
    settlement: "siedlung",
    staat: "staat",
    state: "staat",
    region: "region",
    strasse: "strasse",
    road: "strasse",
    fluss: "fluss",
    river: "fluss",
};

/** Alle Namen, unter denen ein Objektlink ankommen kann, in der Reihenfolge der Priorität (deutsch vor englisch). */
export const OBJECT_LINK_NAMES = [
    "place",
    "siedlung",
    "settlement",
    "staat",
    "state",
    "region",
    "strasse",
    "road",
    "fluss",
    "river",
] as const;
export type ObjectLinkName = (typeof OBJECT_LINK_NAMES)[number];

export interface ObjectLinkRequest {
    /** Der deutsche Schlüssel der Bedeutung. */
    param: ObjectLinkParam;
    /** Der Name, unter dem der Wert ankam (`settlement` für `?settlement=`). */
    name: ObjectLinkName;
    /** Der Wert, getrimmt, sonst unverändert (die Auflösung dekodiert ihn selbst). */
    value: string;
}

/**
 * Welcher Objektlink gilt? Der erste vorhandene Schlüssel in der Reihenfolge der Priorität; ein leerer oder nur aus
 * Leerraum bestehender Wert ist nicht vorhanden (Legacy `readWikiDeeplinkRequest`). `null`, wenn kein Objektlink dabei ist.
 */
export function readObjectLink(get: (name: string) => string | null | undefined): ObjectLinkRequest | null {
    for (const name of OBJECT_LINK_NAMES) {
        const raw = get(name);
        if (raw === null || raw === undefined) continue;
        const value = raw.trim();
        if (value !== "") return { param: OBJECT_LINK_ALIASES[name] as ObjectLinkParam, name, value };
    }
    return null;
}

const LinkValue = Type.Optional(Type.String({ minLength: 1, maxLength: 600 }));

/** `GET /api/subjects/resolve-link`: alle Objektlink-Schlüssel, mindestens einer; die Priorität entscheidet der Server. */
export const ResolveLinkQuery = Type.Object(
    {
        place: LinkValue,
        siedlung: LinkValue,
        settlement: LinkValue,
        staat: LinkValue,
        state: LinkValue,
        region: LinkValue,
        strasse: LinkValue,
        road: LinkValue,
        fluss: LinkValue,
        river: LinkValue,
    },
    { $id: "ResolveLinkQuery", additionalProperties: false, minProperties: 1 },
);
export type ResolveLinkQuery = Static<typeof ResolveLinkQuery>;

/** Wie der Link aufgelöst wurde: über die Wiki-Adresse des Objekts, über seine Kennung (`place`) oder über den Namen. */
export const ResolveLinkVia = Type.Union([Type.Literal("wiki"), Type.Literal("id"), Type.Literal("name")]);
export type ResolveLinkVia = Static<typeof ResolveLinkVia>;

const LinkParamName = Type.Union(OBJECT_LINK_PARAMS.map((param) => Type.Literal(param)));

export const ResolveLinkCandidate = Type.Object(
    {
        ref: SubjectRef,
        /** Der Name aus der Fachdomäne; fehlt bei einem namenlosen Gegenstand. */
        title: Type.Optional(Type.String({ minLength: 1 })),
        /** Die Art (Ortsklasse, Gebietsart, Landschaftsart, Wegart) als Schlüssel, zur Anzeige. */
        type: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type ResolveLinkCandidate = Static<typeof ResolveLinkCandidate>;

/**
 * Die Auflösung eines Objektlinks: genau ein Ref, mehrere Kandidaten (mehrdeutig heißt Auswahl, nie still gewählt) oder
 * nichts (`notFound`: der Compatibility-Hinweis aus WI-0029, nie still Gareth oder die Startansicht).
 */
export const ResolveLinkResponse = Type.Union([
    Type.Object({ ref: SubjectRef, param: LinkParamName, via: ResolveLinkVia }, strict),
    Type.Object(
        {
            candidates: Type.Array(ResolveLinkCandidate, { minItems: 2 }),
            param: LinkParamName,
            via: ResolveLinkVia,
        },
        strict,
    ),
    Type.Object({ notFound: Type.Object({ param: LinkParamName, value: Type.String() }, strict) }, strict),
]);
export type ResolveLinkResponse = Static<typeof ResolveLinkResponse>;
