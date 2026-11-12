import { Type, type Static } from "@sinclair/typebox";
import { LoreKindLiteral } from "./lore.ts";
import { LoreRowView, SUBJECT_REVISION_PATTERN, UUID_PATTERN } from "./subject.ts";
import { SearchEintragGegend, SearchLeuchtAnfrage } from "./vorkommen-suche.ts";

/**
 * Die Vorkommen EINER ROUTENETAPPE (WI-0106): `POST /api/route/stage/lore`.
 *
 * 🔴 **Der Betreiber hat die Etappe selbst gemeint, und er hat es zweimal gesagt.** Am 2026-10-06 stand sie wörtlich in der
 * Regel des Enthaltenseins: „etwas kommt in einer region vor -> es wird da gelistet. … dasselbe für wege, **routenetappen**,
 * landschaften, politische regionen usw.“ Am 2026-10-07 kam die Frage „kannst du die lore auch in etappen anzeigen“. Gebaut ist
 * deshalb die Etappe als TRÄGER: Sie erbt aus allen Flächen, die ihre ganze Wegkette berühren - nicht eine Aufzählung der
 * Vorkommen ihrer einzelnen Wege.
 *
 * 🔴 **Es ist dieselbe Stelle, nicht eine zweite Fassung.** Eine Etappe IST eine Kette von Wegen, und das Enthaltensein einer
 * Linie ist seit WI-0103 auf EINE Stelle gezogen (`LoreSpot`/`spotSource` mit `at: "lines"`, `apps/server/src/subjects/sections/lore.ts`).
 * Diese Stelle nimmt schon eine LISTE von Wegen (`ST_Collect(l.geom) … WHERE l.public_id = ANY(…)`) - die Etappe gibt ihr die
 * Wege ihrer Abschnitte, und die Rechnung ist Zeichen für Zeichen die des Weges. Eine Etappe hat darum, wie ein Weg, nur
 * „Aus der Region“ und den Link „Überall in Aventurien“; „Direkt von hier“ kann sie strukturell nicht haben
 * (`lore_place_target` hat keine `path_id`).
 *
 * ⭐ **Gemessen, und das Ergebnis dreht die Erwartung um: eine Etappe ist der GÜNSTIGSTE Träger.** Ein Weg heißt „Reichsstraße 2“
 * und zieht sich über den halben Kontinent (105 Abschnitte, Median 56 geerbte Einträge, höchstens 395, Antwort bis 20 393 B,
 * WI-0103). Eine Etappe ist ein STÜCK zwischen zwei Punkten: über vier Reisen gemessen (16 bis 73 Etappen) berührt sie 2 bis 30
 * Träger und erbt im Median 23 Einträge, höchstens 130. Darum trägt diese Antwort Zähler UND Namen in EINEM Lauf - sie zu
 * trennen wie beim Ort (`counts` im Detail, Namen beim Aufklappen) kostete eine zweite Frage für im Median 2,0 kB.
 *
 * 🔴 **POST auf einem Lesepfad, wie `/api/route/landscapes`** (WI-0035): Geschrieben wird nichts, aber die Wege einer Etappe
 * gehören in einen Körper, nicht in die Adresszeile - und die Antwort darf nicht im Cache eines Zwischenspeichers landen, weil
 * die Anfrage die Kennungen einer Reise trägt, die es morgen nicht mehr gibt.
 *
 * 🪤 **Eine Etappe ohne Weg ist kein Fehler** (Querfeldein, freie Seefahrt: gemessen 8 von 73 Etappen einer Reise tragen keinen
 * einzigen Wegabschnitt). Sie fragt mit einer leeren Liste, bekommt keine Träger - und trotzdem die vier Zeilen mit dem Link,
 * weil „Überall in Aventurien“ seit dem 2026-10-07 überall steht.
 *
 * 🔴 **Seit WI-0257 S2 trägt die Anfrage auch die Linien der Abschnitte OHNE Weg** (`lines`): Eine Etappe querfeldein oder über freies
 * Wasser hat keine Zeile in `path`, aber einen Verlauf - und ohne ihn blieb sie leer, obwohl sie durch Wald führt (die erste Etappe der
 * Beispielreise Burg Eichstein → Nardesfels: ein Abschnitt, 6,9 Einheiten, kein Weg, kein einziger Eintrag). Der Server fügt sie den
 * Wegen als Stelle hinzu; die Linien sind öffentliche Kartenkoordinaten, die der Client aus seiner Routenantwort hat.
 */

export const ROUTE_STAGE_LORE_LIMITS = {
    /** Der Körper ist eine Liste kurzer Kennungen; 64 kB sind das Zehnfache des größten gemessenen Falls. */
    bodyBytes: 64 * 1024,
    /**
     * So viele Wege nennt eine Etappe höchstens. 🔴 **Abgeleitet, nicht geraten:** über vier Reisen (16, 31, 9 und 73 Etappen)
     * waren es im Median **1** und höchstens **13**. 64 lässt der Darstellung also fast das Fünffache Luft und hält die Kosten
     * der Abfrage dort, wo sie gemessen sind - die Zeit hängt an den Trägern, aber die Geometrie wächst mit den Wegen.
     */
    paths: 64,
    /** So viele Abfragen rechnen höchstens gleichzeitig; die nächste bekommt 503 `busy` (wie `/api/route/landscapes`). */
    concurrent: 2,
    /** So viele Linien (Abschnitte ohne Weg) nennt eine Etappe höchstens; gemessen höchstens einige je Reise. */
    lines: 16,
    /** So viele Stützpunkte hat eine Linie höchstens (der Client dünnt aus); 16 Linien zu 200 Punkten bleiben unter dem Körperlimit. */
    vertices: 200,
} as const;

const strict = { additionalProperties: false } as const;

/** Die Geometrie EINER Etappe: ihre Wege und die Linien ihrer Abschnitte ohne Weg. Die Anfrage der Etappe und die der ganzen Route (`unterwegs`) tragen dieselbe Form. */
const stageGeometry = {
    paths: Type.Array(Type.String({ pattern: UUID_PATTERN }), { maxItems: ROUTE_STAGE_LORE_LIMITS.paths }),
    /**
     * Die Linien der Abschnitte ohne Weg (`RouteSegment.synthetic`), in Fahrtrichtung, je Linie flach `[x0, y0, x1, y1, …]` in
     * Kartenkoordinaten (`aventuria-v1`). Fehlt, wie bisher: nur die Wege. Ein überzähliger letzter Wert (ungerade Länge) zählt nicht.
     */
    lines: Type.Optional(
        Type.Array(
            Type.Array(Type.Number({ minimum: 0, maximum: 4096 }), {
                minItems: 4,
                maxItems: ROUTE_STAGE_LORE_LIMITS.vertices * 2,
            }),
            { maxItems: ROUTE_STAGE_LORE_LIMITS.lines },
        ),
    ),
};

/**
 * `POST /api/route/stage/lore`: die Wege EINER Etappe, als öffentliche Kennungen von `path` - genau die, die der Browser aus den
 * Abschnitten der Etappe schon hat (`RouteSegment.public_id`).
 *
 * 🔴 **Kennungen, nie Namen** (`AGENTS.md`: „Die Zuordnung läuft über den Wiki-Key, nie über den Namen“). Und nie die Geometrie:
 * Der Verlauf steht in der Tabelle, ihn hinzuschicken wäre dieselbe Antwort für tausende Stützpunkte.
 */
export const RouteStageLoreRequest = Type.Object(stageGeometry, { $id: "RouteStageLoreRequest", ...strict });
export type RouteStageLoreRequest = Static<typeof RouteStageLoreRequest>;

/**
 * Die vier Zeilen der Etappe samt aufgeklapptem Inhalt - dieselbe Form wie `SubjectLoreSection.rows`, damit Oberfläche und
 * Prüffälle keine zweite Gestalt lernen müssen. Kein `subject`: Eine Etappe lebt im Planer, sie hat kein Kartenobjekt
 * (`RouteStageRef` kennt nur der Browser).
 */
export const RouteStageLoreResponse = Type.Object(
    {
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        rows: Type.Array(LoreRowView, { maxItems: 4 }),
    },
    { $id: "RouteStageLoreResponse", ...strict },
);
export type RouteStageLoreResponse = Static<typeof RouteStageLoreResponse>;

/** Die Adresse, an einer Stelle: Server und Browser nehmen dieselbe. */
export const ROUTE_STAGE_LORE_URL = "/api/route/stage/lore";

// ---------------------------------------------------------------------------------------------------------------------
// Unterwegs: die Vorkommen der GANZEN Route (WI-0257 S4)
// ---------------------------------------------------------------------------------------------------------------------

/** Die Adresse der Vorkommen der ganzen Route, an einer Stelle: Server und Browser nehmen dieselbe. */
export const ROUTE_UNTERWEGS_URL = "/api/route/unterwegs";

export const ROUTE_UNTERWEGS_LIMITS = {
    /** Der Körper trägt je Etappe ihre Wege und Linien; gemessen höchstens 73 Etappen (WI-0106), die Schranke lässt das Dreifache. */
    bodyBytes: 512 * 1024,
    /** So viele Etappen nennt die Anfrage höchstens (die Landschaftsabfrage der Route lässt 1.000 zu, der Planer weit weniger). */
    stages: 256,
} as const;

/**
 * `POST /api/route/unterwegs`: die Etappen der Route, jede mit ihren Wegen und Linien - genau das, was die Anfrage `stage/lore` je Etappe trägt, in EINEM Körper.
 *
 * 🔴 **Eine Antwort je Route statt einer Frage je Etappe** (Betreiber 2026-10-29, „Unterwegs gibt es:“): Die Klappbox in den Routendetails nennt alles, was auf der Reise
 * vorkommt, samt der ersten Etappe. Gerechnet wird je Etappe mit denselben Bedingungen wie im Infopanel der Etappe (`loreCarriersOf` und die Listen von `listLore`), für alle Etappen auf
 * einmal und danach vereinigt - eine zweite Wahrheit gibt es nicht: Was im Panel der Etappe 3 steht, steht hier „ab Etappe 3“ oder früher.
 *
 * 🪤 POST wie `/api/route/stage/lore` (die Wege gehören in einen Körper, die Antwort nicht in einen Zwischenspeicher), dieselbe Zweierschranke; das Zeitbudget gilt für die ganze Route.
 */
export const RouteUnterwegsRequest = Type.Object(
    {
        stages: Type.Array(Type.Object(stageGeometry, strict), {
            minItems: 1,
            maxItems: ROUTE_UNTERWEGS_LIMITS.stages,
        }),
    },
    { $id: "RouteUnterwegsRequest", ...strict },
);
/**
 * Dieselbe Anfrage OHNE `$id`, als Feld der Landschaftsanfrage (`RouteLandscapesRequest.unterwegs`, WI-0292): Ein Schema mit `$id` darf in einem zweiten Schema nicht noch
 * einmal stehen, sonst lehnt ajv die zweite Anmeldung ab.
 */
export const RouteUnterwegsMitfahrt = Type.Object(
    {
        stages: Type.Array(Type.Object(stageGeometry, strict), {
            minItems: 1,
            maxItems: ROUTE_UNTERWEGS_LIMITS.stages,
        }),
    },
    strict,
);
export type RouteUnterwegsRequest = Static<typeof RouteUnterwegsRequest>;

/**
 * Ein Eintrag, der unterwegs vorkommt.
 *
 * - `id` ist `lore_entry.public_id` - dieselbe Kennung wie in der Suche (`SearchLeuchtAnfrage.eintrag`): Sie lässt den Eintrag auf der Karte leuchten.
 * - `etappen` sind die Nummern (ab 0, aufsteigend, jede einmal) der Etappen, in deren Panel der Eintrag steht; die erste ist das „ab Etappe …“.
 * - `gegend` ist der Name der Ortszeile oder der getroffenen Gegend, in der er unterwegs zuerst vorkommt: nie ein automatischer Name („Wald-925“), dann die benannte Gegend oder das
 *   Gebiet darüber. Er fehlt nur, wo es keinen Namen gibt (gemessen: nie).
 */
export const RouteUnterwegsEintrag = Type.Object(
    {
        id: Type.String({ pattern: UUID_PATTERN }),
        name: Type.String(),
        kind: LoreKindLiteral,
        etappen: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 }),
        gegend: Type.Optional(Type.String()),
    },
    strict,
);
export type RouteUnterwegsEintrag = Static<typeof RouteUnterwegsEintrag>;

/** Alle Einträge der Reise, ohne Dopplung; geordnet nach Art (Waren, Fauna, Flora, Spezies) und Name. Eine durch den Inhaltsschalter ausgeblendete Art fehlt. */
export const RouteUnterwegsResponse = Type.Object(
    {
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        eintraege: Type.Array(RouteUnterwegsEintrag),
    },
    { $id: "RouteUnterwegsResponse", ...strict },
);
export type RouteUnterwegsResponse = Static<typeof RouteUnterwegsResponse>;
/** Dieselbe Antwort ohne `$id`, als Feld der Landschaftsantwort (`RouteLandscapesResponse.unterwegs`, WI-0292). */
export const RouteUnterwegsMitfahrtAntwort = Type.Object(
    {
        revision: Type.String({ pattern: SUBJECT_REVISION_PATTERN }),
        eintraege: Type.Array(RouteUnterwegsEintrag),
    },
    strict,
);

export const ROUTE_UNTERWEGS_GEGENDEN_URL = "/api/route/unterwegs/gegenden";

/**
 * `POST /api/route/unterwegs/gegenden`: EIN Vorkommen und die Etappen der Route (dieselben wie bei `POST /api/route/unterwegs`).
 *
 * 🔴 Vali 2026-10-31: „kannst du bei selektionen von "vorkommen unterwegs" nur die gegenden anzeigen (also auch mehrfachauswahl zulassen), die von der route durchkreuzt
 * werden (die auswahl rechts in der infobox) und in der farbe lassen … die es von "Ausgewählte vorkommen" erhalten hat“. Gefragt wird je GEWÄHLTEM Eintrag, nicht für die ganze
 * Liste: Die Gegenden kommen aus dem Leuchten des Eintrags, und das rechnet der Server nur für den, nach dem gefragt wird.
 */
export const RouteUnterwegsGegendenRequest = Type.Object(
    {
        eintrag: Type.String({ pattern: UUID_PATTERN }),
        stages: RouteUnterwegsRequest.properties.stages,
    },
    { $id: "RouteUnterwegsGegendenRequest", ...strict },
);
export type RouteUnterwegsGegendenRequest = Static<typeof RouteUnterwegsGegendenRequest>;

/**
 * Die Gegenden des Eintrags, die die Route kreuzt: dieselben Gegenden wie „Wo es vorkommt“ in seiner Infobox (`SearchEintrag.wo.gegenden`, je Name und Art eine), nur die, deren Flächen
 * eine Linie der Route berührt, und ohne Deckel. `alle` lässt alles leuchten, was der Eintrag an der Route hat, auch Flächen ohne Namen („Wald-925“), die keine Gegend sind: eine Anfrage
 * für die Landschaften (höchstens `SEARCH_LEUCHTEN_LANDSCHAFTEN_MAX` je Anfrage) und eine je Gebiet. Beide Listen sind leer, wo die Route keine Fläche des Leuchtens berührt.
 */
export const RouteUnterwegsGegendenResponse = Type.Object(
    {
        gegenden: Type.Array(SearchEintragGegend),
        alle: Type.Array(SearchLeuchtAnfrage),
    },
    { $id: "RouteUnterwegsGegendenResponse", ...strict },
);
export type RouteUnterwegsGegendenResponse = Static<typeof RouteUnterwegsGegendenResponse>;
