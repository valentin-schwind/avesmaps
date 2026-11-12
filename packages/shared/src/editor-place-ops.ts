import { Type, type Static } from "@sinclair/typebox";
import { FeldHerkuenfte } from "./feld-herkunft.ts";
import { OperationId } from "./operation.ts";

/**
 * Lesen und Schreiben eines Orts im Ortseditor (WI-0128 E10, EDIT-0001 §4.3, §4.4, §6.2).
 *
 *     GET   /api/editor/places/:id         Felder, Wiki-Werte, Herkunft, Revision, Wegenden am Ort     use_editor_menu
 *     PATCH /api/editor/places/:id         place.update                                                edit_map_objects
 *     POST  /api/editor/places/:id/move    place.move (samt Wegenden, in EINER Operation)              edit_map_geometry
 *     GET   /api/editor/places/:id/move-targets   freie Wegenden im Umkreis, einmal beim Start des Verschiebens (E12)
 *     POST  /api/editor/places             place.create (mit Lage, ohne Lage, aus einem Wiki-Eintrag)  edit_map_objects (mit Lage auch edit_map_geometry)
 *
 * Ein Ort ohne Lage (E16) hat dieselbe Kennung und dieselben Wege: Das Detail kommt ohne `position` und ohne Wegenden, `place.update`
 * ändert ihn, und `place.move` setzt ihn auf die Karte (danach ist er ein Ort mit Lage, dieselbe `publicId`).
 *
 * 🔴 Jede Schreibroute trägt `MutationEnvelope` mit `baseRevision` (der Stand, auf dem der Entwurf beruht) und antwortet mit
 * `OperationReceipt`. Fehler im Umschlag (ADR-0018): 409 `edit_conflict` (`EditConflictDetails`: jetzige Revision, wann, wer),
 * 409 `idempotency_key_reused`, 403, 400 `validation_failed`, 404, 423 `map_locked` (SYS-4), 423 `map_editing_off` (E9),
 * 503 `map_import_running` (der Zug importiert gerade; nichts geschrieben, `Retry-After`).
 *
 * Herkunft je Feld (`*_origin` der Einzelheiten, 0065): `wiki` = der Wert stammt aus dem Wiki-Stand, `manual` = eigener Wert der
 * Redaktion. `{ revert: "wiki" }` setzt Wert und Herkunft aus `wiki_settlement_snapshot` (↺); ohne Wiki-Wert leert es das Feld.
 */

export const editorPlaceUrl = (publicId: string): string => `/api/editor/places/${publicId}`;
export const editorPlaceMoveUrl = (publicId: string): string => `/api/editor/places/${publicId}/move`;
export const editorPlaceTakeOffMapUrl = (publicId: string): string => `/api/editor/places/${publicId}/take-off-map`;
export const editorPlaceMoveTargetsUrl = (publicId: string): string => `/api/editor/places/${publicId}/move-targets`;

/**
 * Wie weit um den Ort der Verschiebemodus freie Wegenden als Einrastziele holt, in Kartenpunkten (E12, EDIT-0001 §4.4: „holt der Modus
 * einmal beim Start“). Gezogen wird in der Nähe; ein Ziel weiter weg verlangt ein zweites Verschieben.
 */
export const MOVE_TARGET_RADIUS = 50;

/**
 * Wie weit ein Wegende vom Ort liegen darf und noch „am Ort“ hängt: 0,5 Kartenpunkte, Legacys `ENDPOINT_BOX`
 * (`js/features/location-editing.js`, EDIT-0001 §4.4).
 */
export const PATH_END_AT_PLACE = 0.5;

const strict = { additionalProperties: false } as const;
const Origin = Type.Union([Type.Literal("wiki"), Type.Literal("manual"), Type.Null()]);
const Point = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);

/** Die sieben Ortsgrößen (`place.subtype`, Bedingung `place_subtype_check`). */
export const PLACE_SUBTYPES = [
    "metropole",
    "grossstadt",
    "stadt",
    "kleinstadt",
    "dorf",
    "gebaeude",
    "stadtviertel",
] as const;
export type PlaceSubtype = (typeof PLACE_SUBTYPES)[number];

export const EDITOR_PLACE_TEXT_FIELDS = ["description", "einwohner", "lage", "oberhaupt"] as const;
export type EditorPlaceTextField = (typeof EDITOR_PLACE_TEXT_FIELDS)[number];

/** Ein Textfeld der Einzelheiten: eigener Wert, seine Herkunft und der Wert im Wiki-Stand (für ↺ und die durchgestrichene Anzeige). */
export const EditorPlaceText = Type.Object(
    {
        value: Type.Union([Type.String(), Type.Null()]),
        origin: Origin,
        wiki: Type.Union([Type.String(), Type.Null()]),
    },
    strict,
);
export type EditorPlaceText = Static<typeof EditorPlaceText>;

/** Ein Wegende, das am Ort hängt (innerhalb `PATH_END_AT_PLACE`). */
export const EditorPathEnd = Type.Object(
    {
        pathId: Type.String(),
        name: Type.String(),
        end: Type.Union([Type.Literal("start"), Type.Literal("end")]),
        revision: Type.Integer({ minimum: 1 }),
        x: Type.Number(),
        y: Type.Number(),
        /** Der Punkt des Wegs neben diesem Ende: für die gestrichelte Vorschau beim Verschieben (E12). */
        neighbor: Point,
    },
    strict,
);
export type EditorPathEnd = Static<typeof EditorPathEnd>;

/** Ein freies Wegende: Es hängt an keinem aktiven Ort (Kasten ±`PATH_END_AT_PLACE`). Ein Ort rastet in 10 px daran ein (E12). */
export const EditorFreePathEnd = Type.Object(
    {
        pathId: Type.String(),
        name: Type.String(),
        end: Type.Union([Type.Literal("start"), Type.Literal("end")]),
        x: Type.Number(),
        y: Type.Number(),
    },
    strict,
);
export type EditorFreePathEnd = Static<typeof EditorFreePathEnd>;

export const EditorMoveTargets = Type.Object(
    { radius: Type.Number(), freeEnds: Type.Array(EditorFreePathEnd) },
    strict,
);
export type EditorMoveTargets = Static<typeof EditorMoveTargets>;

export const EditorPlaceDetail = Type.Object(
    {
        publicId: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        name: Type.String(),
        subtype: Type.String(),
        kind: Type.Union([Type.String(), Type.Null()]),
        /** Fehlt bei einem Ort ohne Lage (E16): Er steht unter „Nicht auf der Karte“. */
        position: Type.Optional(Point),
        active: Type.Boolean(),
        hidden: Type.Boolean(),
        ruined: Type.Boolean(),
        nodix: Type.Boolean(),
        seaport: Type.Boolean(),
        /** Unterirdisch (D21, Betreiber 2026-10-10): nur Anzeige im Infopanel hinter dem Ortstyp. */
        underground: Type.Boolean(),
        /** Unauffindbar / entrückt (D21): Die Wegfindung nennt den Ort nicht; auf der Karte bleibt er sichtbar. */
        withdrawn: Type.Boolean(),
        /** Ungefähre Lage (WI-0267, Kanal OPS-000067): Die genaue Lage ist nicht bekannt; Infopanel und Karte sagen es. */
        approximate: Type.Boolean(),
        /**
         * Liegt Meer oder See so nah, dass ein Schiff anlegen kann (`LANDING_REACH` der Seewege, H1)? Nur ein Hinweis zum Seehafen, nie
         * seine Ursache (Betreiber 2026-10-11). Fehlt bei einem Ort ohne Lage.
         */
        waterNearby: Type.Optional(Type.Boolean()),
        /** Die Gebiete, deren Hauptstadt der Ort ist, die ihn aber nicht enthalten (E20, ein Befund). */
        capitalOutside: Type.Optional(Type.Array(Type.String())),
        sourceSystem: Type.String(),
        fields: Type.Object(
            {
                description: EditorPlaceText,
                einwohner: EditorPlaceText,
                lage: EditorPlaceText,
                oberhaupt: EditorPlaceText,
            },
            strict,
        ),
        wiki: Type.Union([
            Type.Object(
                {
                    url: Type.Union([Type.String(), Type.Null()]),
                    title: Type.Union([Type.String(), Type.Null()]),
                    state: Type.String(),
                },
                strict,
            ),
            Type.Null(),
        ]),
        /**
         * Der Name laut Wiki (WI-0225; Legacy `nest.name`, bei uns `wiki_settlement_snapshot.wiki_name`): fehlt ohne Artikel oder ohne
         * Namen im Schnappschuss (unbekannt). Die Ortsgröße des Wiki kennt der Schnappschuss nicht (subject-details.yaml).
         */
        nameWiki: Type.Optional(Type.String()),
        /**
         * Die Ortsgröße laut Wiki (WI-0225, Migration 0184; Legacy `nest.settlement_class`): fehlt ohne Artikel, ohne Klasse oder wenn
         * Legacy sie geraten hat (Legacys Regel: ohne Kennzeichen gilt „dorf“ als geraten).
         */
        subtypeWiki: Type.Optional(Type.Union(PLACE_SUBTYPES.map((value) => Type.Literal(value)))),
        /**
         * Die Bauwerkart laut Wiki-Stand (WI-0295, `wiki_settlement_snapshot.building_type`): fehlt ohne Artikel oder ohne Art. Das Feld „Art“
         * zeigt sie, solange es leer ist; die Infobox der Besucher nimmt sie dann ohnehin (eigene Art, sonst die des Wiki).
         */
        kindWiki: Type.Optional(Type.String()),
        /** Herkunft der Felder in `field_origin` (heute der Name); ein fehlender Schlüssel heißt kein Vermerk. */
        herkunft: Type.Optional(FeldHerkuenfte),
        pathEnds: Type.Array(EditorPathEnd),
    },
    strict,
);
export type EditorPlaceDetail = Static<typeof EditorPlaceDetail>;

/** Ein Textfeld setzen (`null` leert es) oder auf den Wiki-Stand zurücksetzen (↺). */
export const EditorPlaceTextChange = Type.Union([
    Type.Object({ value: Type.Union([Type.String({ minLength: 1, maxLength: 20_000 }), Type.Null()]) }, strict),
    Type.Object({ revert: Type.Literal("wiki") }, strict),
]);
export type EditorPlaceTextChange = Static<typeof EditorPlaceTextChange>;

/**
 * `place.update`: nur die Felder, die sich ändern; die Lage ändert `place.move`. Seehafen und Nodix sind Merkmale wie Ruine und
 * Verborgen, gespeichert am Ort und vom Editor gesetzt (Betreiber 2026-10-11: Seehafen hängt nicht an Seewegen, „seewege werden
 * verschwinden und sind auf avesmaps3d tot“); Unterirdisch und Entrückt sind eigene Merkmale von Avesmaps3D (D21).
 */
/** ↺ im Verlauf (E17): die Operation, die diese zurücknimmt. Die neue Operation trägt dann die Quelle `restore`. */
const Reverts = Type.Optional(OperationId);

export const PlaceUpdateBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        reverts: Reverts,
        changes: Type.Object(
            {
                /** Ein Name (Herkunft manual) oder ↺ auf den Wiki-Namen (`nameWiki`, Herkunft wiki; WI-0225). */
                name: Type.Optional(
                    Type.Union([
                        Type.String({ minLength: 1, maxLength: 160 }),
                        Type.Object({ revert: Type.Literal("wiki") }, strict),
                    ]),
                ),
                /** Eine Ortsgröße (Herkunft manual) oder ↺ auf die des Wiki (`subtypeWiki`, Herkunft wiki; WI-0225). */
                subtype: Type.Optional(
                    Type.Union([
                        ...PLACE_SUBTYPES.map((value) => Type.Literal(value)),
                        Type.Object({ revert: Type.Literal("wiki") }, strict),
                    ]),
                ),
                kind: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()])),
                hidden: Type.Optional(Type.Boolean()),
                ruined: Type.Optional(Type.Boolean()),
                seaport: Type.Optional(Type.Boolean()),
                nodix: Type.Optional(Type.Boolean()),
                underground: Type.Optional(Type.Boolean()),
                withdrawn: Type.Optional(Type.Boolean()),
                approximate: Type.Optional(Type.Boolean()),
                description: Type.Optional(EditorPlaceTextChange),
                einwohner: Type.Optional(EditorPlaceTextChange),
                lage: Type.Optional(EditorPlaceTextChange),
                oberhaupt: Type.Optional(EditorPlaceTextChange),
            },
            { ...strict, minProperties: 1 },
        ),
    },
    strict,
);
export type PlaceUpdateBody = Static<typeof PlaceUpdateBody>;

/** Ein Wegende, das beim Verschieben mitgeht: an die neue Lage des Orts oder an einen Einrastpunkt. */
export const PlaceMovePathEnd = Type.Object(
    {
        pathId: Type.String(),
        end: Type.Union([Type.Literal("start"), Type.Literal("end")]),
        baseRevision: Type.Integer({ minimum: 1 }),
        to: Point,
    },
    strict,
);
export type PlaceMovePathEnd = Static<typeof PlaceMovePathEnd>;

/**
 * `place.move`: der Ort an `to`, die genannten Wegenden mit. Wegenden am Ort, die NICHT genannt sind, bleiben liegen (Strg, D11);
 * die Quittung nennt sie als Befund `path_end_left` (G1, „offenes Wegende“).
 */
export const PlaceMoveBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        reverts: Reverts,
        to: Point,
        pathEnds: Type.Array(PlaceMovePathEnd, { maxItems: 64 }),
    },
    strict,
);
export type PlaceMoveBody = Static<typeof PlaceMoveBody>;

/**
 * `place.take_off_map` (EDIT-0001 D20, „⊖ Von der Karte nehmen“; Betreiber 2026-10-11: „hier fehlt "von der karte entfernen"“): Der Ort
 * steht danach unter „Nicht auf der Karte“, mit derselben Kennung, bis „● Auf der Karte setzen“ ihn wieder platziert. Wegenden am Ort
 * bleiben liegen (G1). Hängen Stätten am Ort, sagt `staetten: "bleiben"`, dass sie mit ihm unter „Nicht auf der Karte“ stehen (E22,
 * „Ort entfernen“); ohne die Angabe lehnt der Server ab. Umhängen und Eigenständig-Machen sowie ein Ort, der selbst eine Stätte ist,
 * warten auf E18.
 */
export const PlaceTakeOffMapBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        staetten: Type.Optional(Type.Literal("bleiben")),
    },
    strict,
);
export type PlaceTakeOffMapBody = Static<typeof PlaceTakeOffMapBody>;

/**
 * `place.create` (E10 Teil b, E16): ein neuer Ort, eigene Daten von Avesmaps3D. Der Name ist eindeutig wie bei `place.update`; die
 * Quittung nennt die neue Kennung unter `affected`.
 *
 * - Mit `position`: ein Ort auf der Karte („✚ Hier hinzufügen“).
 * - Ohne `position`: ein Ort ohne Lage, er steht unter „Nicht auf der Karte“ (E16, Betreiber 2026-10-11).
 * - Mit `wikiKey` (und `position`): ein Wiki-Eintrag aus „Nicht auf der Karte“ wird platziert (Ziehen auf die Karte). Der Ort trägt
 *   danach den Artikel, und der Eintrag verschwindet aus der Liste.
 *
 * 🔴 **Dieselben Felder wie `place.update`** (Betreiber 2026-10-13: „neuer ort hat immer noch nicht alle felder“). Wer einen Ort
 * anlegt, weiß in aller Regel schon, was drinsteht; ihn erst anzulegen und dann sofort zu ändern, wären zwei Operationen und zwei
 * Zeilen im Verlauf für einen Vorgang. Alle Felder sind optional: Name und Ortsgröße reichen weiterhin.
 *
 * 🪤 Die Texte sind hier EINFACHE Werte, keine `EditorPlaceTextChange`. Ein neuer Ort hat keinen Wiki-Stand, auf den `revert`
 * zurückginge – auch nicht mit `wikiKey`, denn der Eintrag aus „Nicht auf der Karte“ trägt nur Name und Adresse. Was hier steht,
 * ist der eigene Wert eines Menschen (`origin = 'manual'`).
 */
export const PlaceCreateBody = Type.Object(
    {
        operationId: OperationId,
        name: Type.String({ minLength: 1, maxLength: 160 }),
        subtype: Type.Union(PLACE_SUBTYPES.map((value) => Type.Literal(value))),
        kind: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()])),
        hidden: Type.Optional(Type.Boolean()),
        ruined: Type.Optional(Type.Boolean()),
        seaport: Type.Optional(Type.Boolean()),
        nodix: Type.Optional(Type.Boolean()),
        underground: Type.Optional(Type.Boolean()),
        withdrawn: Type.Optional(Type.Boolean()),
        approximate: Type.Optional(Type.Boolean()),
        description: Type.Optional(Type.String({ maxLength: 4000 })),
        einwohner: Type.Optional(Type.String({ maxLength: 200 })),
        lage: Type.Optional(Type.String({ maxLength: 400 })),
        oberhaupt: Type.Optional(Type.String({ maxLength: 200 })),
        position: Type.Optional(Point),
        /** Der kanonische Wiki-Key eines Eintrags aus „Nicht auf der Karte“ (`wiki:…`); nur mit `position`. */
        wikiKey: Type.Optional(Type.String({ minLength: 6, maxLength: 300, pattern: "^wiki:" })),
    },
    strict,
);

/** Die sieben Merkmale eines Orts, in der Reihenfolge der Oberfläche (E11, Migration 0108; „ungefähre Lage“ WI-0267, Migration 0263). */
export const PLACE_FLAGS = ["ruined", "hidden", "seaport", "nodix", "underground", "withdrawn", "approximate"] as const;
export type PlaceFlag = (typeof PLACE_FLAGS)[number];
export type PlaceCreateBody = Static<typeof PlaceCreateBody>;
