import { Type, type Static } from "@sinclair/typebox";
import { FORM_FEHLER_ARTEN } from "./flaechen-gueltig.ts";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1; Blatt 1 vom Betreiber abgenommen 2026-10-10: „sehr gut das wollen wir“).
 *
 * Die Gruppe „Prüfen · nur Editoren“ zeigt auf der Karte, was die zuständigen Prüfer melden; je Haken ein Leseweg:
 *
 *     GET /api/editor/checks/:check      die Funde einer Prüfung, mit ETag      use_editor_menu (R)
 *
 * - 🔴 **Eine Rechnung.** Jeder Haken zeigt, was sein Prüfer meldet: „Flüsse bergaufwärts“ den Befund `gelaende/fluss_steigt` des
 *   gültigen Domain-Rasters, „Offene Wegenden“ `loadLooseEndpoints` (dieselbe Rechnung wie `verify:paths` und
 *   `ops:lose-wegenden`), „Unverbunden“ `buildRouteNetwork`, „Wege treffen sich nicht“ `unmetSpots` über dieselbe Topologie wie
 *   der Router (WI-0132 P2), „Keine Wiki-Zuweisung“ die Zuordnungstafel X2 (`wiki_key_assignment`), „Flächen kreuzen sich“
 *   `ST_IsValidDetail` mit `formFehlerArt`, dieselbe Prüfung wie beim Speichern einer Form. Der Client rechnet nichts nach und hat
 *   keine eigene Schwelle.
 * - 🔴 **Nur öffentliche Kennungen.** Interne Kennungen (`path.id`) verlassen den Server nie.
 * - 🔴 **Recht `use_editor_menu`** (ab Reviewer), am Server vor jeder Abfrage geprüft. Die Haken stehen nicht in der Adresse: Ein
 *   geteilter Link schaltet bei Besuchern nichts ein. Der Browser merkt sie sich je Person.
 * - **Nur lesend.** Kein Haken ändert Kartendaten oder stößt eine Ableitung an.
 *
 * Lage und Linien stehen in Kartenkoordinaten (MCS, `aventuria-v1`). Wie Legacy zeigen „Flüsse bergaufwärts“, „Offene Wegenden“ und
 * „Unverbunden“ ihre Funde unabhängig von Zoom, Ortsklasse und Wegart (Owner Legacy 2026-08-14), deshalb liefert der Server die
 * Geometrie mit. „Keine Wiki-Zuweisung“ färbt dagegen nur, was die Karte gerade zeigt, und blendet nichts ein (Legacy
 * `wiki-zuweisung.js`); dafür genügen die Kennungen.
 */

export const MAP_CHECKS_URL = "/api/editor/checks";

/**
 * Die Haken, in der Reihenfolge im Auge (WI-0131 §3; „Wege treffen sich nicht“ seit WI-0132 Release N, „Flächen kreuzen sich“ seit
 * 2026-11-10).
 */
export const MAP_CHECKS = [
    "uphill-rivers",
    "loose-ends",
    "unconnected",
    "paths-apart",
    "no-wiki",
    "invalid-areas",
] as const;
export type MapCheck = (typeof MAP_CHECKS)[number];

export function isMapCheck(value: string): value is MapCheck {
    return (MAP_CHECKS as readonly string[]).includes(value);
}

const Id = Type.String({ minLength: 1 });
/** Ein Punkt in Kartenkoordinaten: `[x, y]`. */
const Point = Type.Tuple([Type.Number(), Type.Number()]);
/** Die Linien eines Weges (eine bei `LineString`, mehrere bei `MultiLineString`). */
const Lines = Type.Array(Type.Array(Point));

export const UphillRiversResult = Type.Object(
    {
        check: Type.Literal("uphill-rivers"),
        rivers: Type.Array(
            Type.Object(
                {
                    id: Id,
                    name: Type.String(),
                    /** Wie weit der Fluss im fertigen Höhenraster steigt, in Schritt; `null`, wo der Bericht es nicht nennt. */
                    rise: Type.Union([Type.Number(), Type.Null()]),
                    lines: Lines,
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type UphillRiversResult = Static<typeof UphillRiversResult>;

export const LooseEndsResult = Type.Object(
    {
        check: Type.Literal("loose-ends"),
        /**
         * Die Wege mit einem losen Ende (mehr als 0,05 E neben seinem Ort) und die, die ganz aus dem Netz fallen: rot, ganz. Seit
         * WI-0132 Release N stehen Sackgassen nicht mehr hier, sondern unter „Wege treffen sich nicht“.
         */
        paths: Type.Array(Type.Object({ id: Id, name: Type.String(), lines: Lines }, { additionalProperties: false })),
        /** Jedes lose Ende ohne genauen Wegkontakt: ein Ring. `path` ist die Kennung seines Weges. */
        ends: Type.Array(
            Type.Object({ x: Type.Number(), y: Type.Number(), path: Id }, { additionalProperties: false }),
        ),
        /**
         * Nur als Zahl (Entscheidung B der Koordination 2026-10-10, WI-0132 §10.6): Wegenden mit genauem Wegkontakt, die nach
         * „Ort zuerst“ zum Ort im Kasten springen, und Wege ohne Kante (ganz im Ortskasten). Verbunden, nichts zu reparieren.
         */
        absorbed_ends: Type.Integer({ minimum: 0 }),
        looped_paths: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type LooseEndsResult = Static<typeof LooseEndsResult>;

export const UnconnectedResult = Type.Object(
    {
        check: Type.Literal("unconnected"),
        /**
         * Orte und technische Knoten ohne jede Kante im Netz; verborgene Orte zählen nicht (Owner Legacy 2026-10-09). Seit WI-0132
         * Release N gibt es keine Kreuzungen mehr im Netz; `crossing` bleibt für ein Release in der Liste, damit ein älterer
         * Client nichts Unbekanntes sieht (Felder nur hinzufügen).
         */
        nodes: Type.Array(
            Type.Object(
                {
                    id: Id,
                    kind: Type.Union([Type.Literal("place"), Type.Literal("technical"), Type.Literal("crossing")]),
                    /** Der Ortsname; ein technischer Knoten hat keinen. */
                    name: Type.Union([Type.String(), Type.Null()]),
                    x: Type.Number(),
                    y: Type.Number(),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type UnconnectedResult = Static<typeof UnconnectedResult>;

/**
 * Die Arten einer Stelle „Wege treffen sich nicht“ (WI-0132 P2): `offen` ein Wegende trifft weder Ort noch Weg (Sackgasse);
 * `getrennt` ein fremdes Wegende knapp daneben an einem anderen Knoten; `kreuzt` zwei durchgehende Wege mit deckungsgleichem
 * Stützpunkt, gewollt getrennt. Enden genau auf einem Weg, die am Ort im Kasten hängen, stehen nur als Zahl (`at_place`).
 */
export const PATHS_APART_KINDS = ["offen", "getrennt", "kreuzt"] as const;
export type PathsApartKind = (typeof PATHS_APART_KINDS)[number];

export const PathsApartResult = Type.Object(
    {
        check: Type.Literal("paths-apart"),
        /** Je Wegende bzw. Stützpunkt eine Stelle; nur Anzeige, nie eine Verbindung. */
        spots: Type.Array(
            Type.Object(
                {
                    kind: Type.Union(PATHS_APART_KINDS.map((kind) => Type.Literal(kind))),
                    x: Type.Number(),
                    y: Type.Number(),
                    /** Der Weg, an dem die Stelle hängt. */
                    path: Id,
                    /** Der fremde Weg, der hier nicht trifft; `null` bei einem offenen Ende ohne Weg im Umkreis von 0,5 E. */
                    other: Type.Union([Id, Type.Null()]),
                    /** Abstand zum fremden Weg in Karteneinheiten; `null` ohne. */
                    distance: Type.Union([Type.Number(), Type.Null()]),
                    /** „knapp verfehlt“: unter 0,001 E, ein Rundungsfall (Hinweis, keine Verbindung). */
                    near_miss: Type.Boolean(),
                },
                { additionalProperties: false },
            ),
        ),
        /**
         * Nur als Zahl (Entscheidung B der Koordination 2026-10-10, WI-0132 §10.6): Wegenden genau auf einem fremden Weg, die nach
         * „Ort zuerst“ am Ort im Kasten hängen, den der Weg nicht erreicht. Genauer Kontakt; der Ortskasten nimmt sie auf.
         */
        at_place: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type PathsApartResult = Static<typeof PathsApartResult>;

export const NoWikiResult = Type.Object(
    {
        check: Type.Literal("no-wiki"),
        /** Orte ohne Wiki-Zuweisung; Kreuzungen sind keine Orte und gar nicht gemeint. */
        places: Type.Array(Id),
        /** Wege mit einem von Menschen gegebenen Namen und ohne Zuweisung; ein Griff („Pfad-3443“) kann keinen Artikel haben. */
        paths: Type.Array(Id),
    },
    { additionalProperties: false },
);
export type NoWikiResult = Static<typeof NoWikiResult>;

/** Welche Fläche: die eines Herrschaftsgebiets oder die einer Landschaft (Derographie). */
export const INVALID_AREA_KINDS = ["territory", "landscape"] as const;
export type InvalidAreaKind = (typeof INVALID_AREA_KINDS)[number];

/**
 * „Flächen kreuzen sich“ (Vali 2026-11-10: „kann man die dinger anzeigen? wir haben in der anzeige extra prüf-layer“): jede aktive Fläche
 * eines aktiven Gebiets oder einer aktiven Landschaft, die PostGIS ungültig nennt. Dieselbe Prüfung wie beim Speichern einer Form
 * (`ST_IsValidDetail`, übersetzt mit `formFehlerArt`); eine solche Fläche bleibt bearbeitbar, der Editor lässt ihren alten Mangel stehen.
 * Je Fläche EINE Stelle, die erste, die GEOS findet: Die Fläche selbst ist groß, die Stelle klein.
 */
export const InvalidAreasResult = Type.Object(
    {
        check: Type.Literal("invalid-areas"),
        spots: Type.Array(
            Type.Object(
                {
                    kind: Type.Union(INVALID_AREA_KINDS.map((kind) => Type.Literal(kind))),
                    /** Die Fläche (`territory_area` bzw. `region_area`). */
                    area: Id,
                    /** Das Gebiet bzw. die Landschaft, der die Fläche gehört. */
                    owner: Id,
                    name: Type.String(),
                    art: Type.Union(FORM_FEHLER_ARTEN.map((art) => Type.Literal(art))),
                    x: Type.Number(),
                    y: Type.Number(),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type InvalidAreasResult = Static<typeof InvalidAreasResult>;

export const MapCheckResult = Type.Union([
    UphillRiversResult,
    LooseEndsResult,
    UnconnectedResult,
    PathsApartResult,
    NoWikiResult,
    InvalidAreasResult,
]);
export type MapCheckResult = Static<typeof MapCheckResult>;
