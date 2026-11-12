import { Type, type Static } from "@sinclair/typebox";
import { PATH_NAME_MAX } from "./editor-path-update.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Der Straßen-Assistent im Wegeditor (WI-0310; Vali 2026-11-11: „bestehende wege zu benennen - inkl wiki-zuweisung. z.b. ein weg hat eine
 * lücke dann will ich mit dem assistenten alle orte listen, die auf dem weg liegen und neu zuweisen“, dazu „Zuweisen reicht“; Entwurf
 * Fassung 3, gebaut auf „passt, bauen“ vom 2026-11-12). Er gibt vorhandenen Abschnitten Name, Hauptartikel und Quellen einer Straße und
 * verlegt keine Linie: Wegtyp, Reisemittel und Geometrie bleiben, die Wegfindung rechnet nicht neu.
 *
 *     POST  /api/editor/paths/strassen-assistent/strecke   lesend: Orte, Strecke über die Abschnitte, Zustand je Abschnitt   use_editor_menu
 *     POST  /api/editor/paths/strassen-assistent/zuweisen  path.assign_street: Name, Artikel, Quellen in EINER Operation       edit_map_objects
 *
 * ↺ ist die Rücknahme der Wege (`POST /api/editor/paths/:id/restore-series`) über genau die Abschnitte der Operation.
 */

export const EDITOR_STRASSEN_ASSISTENT_STRECKE_URL = "/api/editor/paths/strassen-assistent/strecke";
export const EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL = "/api/editor/paths/strassen-assistent/zuweisen";

/** So viele Orte nimmt die Liste höchstens. */
export const STRASSEN_ASSISTENT_ORTE_MAX = 80;
/** So viele Abschnitte schreibt eine Operation höchstens (wie „Auswahl zu neuem Weg“, `PATH_SAMMEL_MAX`). */
export const STRASSEN_ASSISTENT_MAX = 500;

const strict = { additionalProperties: false } as const;
const Uuid = Type.String({ pattern: UUID_PATTERN });

export const StrasseStreckeBody = Type.Object(
    {
        /** Ein Abschnitt der Straße, wie das Wege-Fenster sie kennt. */
        anker: Uuid,
        /** Der Wiki-Artikel (`wiki_path_snapshot.wiki_key`); fehlt er, gilt der Hauptartikel der Straße, `null` heißt ohne Artikel. */
        key: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 300 }), Type.Null()])),
        /** Die Orte in Reihenfolge; fehlen sie, kommen sie aus dem Verlauf des Artikels. */
        orte: Type.Optional(Type.Array(Uuid, { maxItems: STRASSEN_ASSISTENT_ORTE_MAX })),
    },
    strict,
);
export type StrasseStreckeBody = Static<typeof StrasseStreckeBody>;

/** Was mit einem Abschnitt beim Zuweisen geschähe (Fassung 3: ● fertig, ◐ ohne Artikel, ○ ohne Namen, ⇄ andere Straße). */
export const STRASSEN_ZUSTAENDE = ["fertig", "artikel", "name", "fremd"] as const;
export type StrassenZustand = (typeof STRASSEN_ZUSTAENDE)[number];

const Ort = Type.Object({ id: Uuid, name: Type.String(), x: Type.Number(), y: Type.Number() }, strict);
export type StrassenOrt = Static<typeof Ort>;

const Artikel = Type.Object(
    { key: Type.String(), name: Type.String(), url: Type.String(), verlauf: Type.Union([Type.String(), Type.Null()]) },
    strict,
);

export const StrassenAbschnitt = Type.Object(
    {
        id: Uuid,
        revision: Type.Integer({ minimum: 1 }),
        /** Der Name, wie er gespeichert ist (auch ein Griff oder leer). */
        name: Type.String(),
        subtype: Type.String(),
        /** Länge in Meilen. */
        laenge: Type.Number({ minimum: 0 }),
        zustand: Type.Union(STRASSEN_ZUSTAENDE.map((z) => Type.Literal(z))),
        /** Der Hauptartikel heute (`null`: keiner). */
        wiki: Type.Union([Type.Object({ key: Type.String(), name: Type.String() }, strict), Type.Null()]),
        /** Wie viele der Quellen der Straße er schon trägt. */
        quellen: Type.Integer({ minimum: 0 }),
        /** Die Linie in Kartenkoordinaten, zum Zeigen. */
        coordinates: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
    },
    strict,
);
export type StrassenAbschnitt = Static<typeof StrassenAbschnitt>;

/** Die Strecke zwischen zwei Orten der Liste: die Abschnitte in Fahrtfolge, oder kein Weg (`laenge: null`). */
export const StrassenTeil = Type.Object(
    {
        von: Uuid,
        nach: Uuid,
        laenge: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        /** Länge der Strecke durch die Luftlinie (`null` ohne Weg). */
        umweg: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        abschnitte: Type.Array(Uuid),
    },
    strict,
);
export type StrassenTeil = Static<typeof StrassenTeil>;

export const StrasseStreckeAntwort = Type.Object(
    {
        artikel: Type.Union([Artikel, Type.Null()]),
        /** Der Name, den die Abschnitte bekämen: der Titel des Artikels, ohne Artikel der Name der Straße („“ ohne echten Namen). */
        name: Type.String(),
        orte: Type.Array(Ort),
        /** Namen aus dem Verlauf ohne Ort auf der Karte. */
        unbekannt: Type.Array(Type.String()),
        teile: Type.Array(StrassenTeil),
        /** Jeder genannte Abschnitt (auf der Strecke und abseits) einmal. */
        abschnitte: Type.Record(Type.String(), StrassenAbschnitt),
        /** Abschnitte mit dem Namen oder dem Artikel der Straße, die nicht auf der Strecke liegen. */
        abseits: Type.Array(Uuid),
        /** Orte an den Enden der Abschnitte abseits, die nicht in der Liste stehen („+ Ort“). */
        vorschlaege: Type.Array(Ort),
        /** Die Quellen der Straße (je einmal). */
        quellen: Type.Array(Type.Object({ id: Type.String(), titel: Type.String() }, strict)),
    },
    strict,
);
export type StrasseStreckeAntwort = Static<typeof StrasseStreckeAntwort>;

const Abschnitt = Type.Object({ publicId: Uuid, baseRevision: Type.Integer({ minimum: 1 }) }, strict);

export const StrasseZuweisenBody = Type.Object(
    {
        operationId: OperationId,
        /** Der Name der Straße, ein echter Name (kein Griff). */
        name: Type.String({ minLength: 1, maxLength: PATH_NAME_MAX }),
        /** Der Hauptartikel (`null`: nur Name und Quellen). */
        key: Type.Union([Type.String({ minLength: 1, maxLength: 300 }), Type.Null()]),
        /** Die Quellen der Straße an die Abschnitte geben, denen sie fehlen. */
        quellen: Type.Boolean(),
        /** Die Abschnitte, die Name und Artikel bekommen. */
        sections: Type.Array(Abschnitt, { maxItems: STRASSEN_ASSISTENT_MAX }),
        /** Abschnitte abseits, die Name und Artikel verlieren. */
        entfernen: Type.Array(Abschnitt, { maxItems: STRASSEN_ASSISTENT_MAX }),
    },
    strict,
);
export type StrasseZuweisenBody = Static<typeof StrasseZuweisenBody>;

/** Die Quittung nennt den Anker der Straße danach (die kleinste Kennung ihrer Abschnitte): Dort liest das Fenster sie neu. */
export const StrasseZuweisenReceipt = Type.Object(
    { ...OperationReceipt.properties, anker: Type.String({ pattern: UUID_PATTERN }) },
    strict,
);
export type StrasseZuweisenReceipt = Static<typeof StrasseZuweisenReceipt>;
