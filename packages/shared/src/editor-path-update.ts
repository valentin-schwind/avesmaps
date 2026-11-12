import { Type, type Static } from "@sinclair/typebox";
import { CALENDAR_MONTHS } from "./calendar.ts";
import { EditorPathEnds, PATH_MAX_POINTS, PathCarriedPoint } from "./editor-path-ops.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { CLOSURE_REASONS } from "./travel-model.ts";

/**
 * Die Felder einer Straße schreiben (WI-0177 W5b; EDIT-0003 T44, T27 (4); Muster `powerline-editor-ops.ts`, K6).
 *
 *     POST  /api/editor/paths/:id/update   path.update: die Felder der ganzen Straße in EINER Operation   edit_map_objects
 *
 * - `:id` ist ein Abschnitt der Straße (der Anker der Bearbeitung, `EditorPathStreet.id`). `sections` nennt ALLE Abschnitte der Straße,
 *   wie der Entwurf sie gelesen hat, je mit Revision. Weicht der Satz oder eine Revision ab, hat jemand die Straße inzwischen geändert:
 *   409 `edit_conflict`. Hält ein anderer einen Abschnitt, 409 `object_locked` (EDIT-0003 §4).
 * - Ein fehlendes Feld bleibt. Name und Wegart gelten allen Abschnitten (sie machen die Straße aus); „Name auf der Karte“ ebenso, auch
 *   wenn er vorher gemischt war.
 * - **Wegart** unter den Landwegen und dem Flussweg (`PATH_EDIT_SUBTYPES`; Plan Fluss/Bach 2026-10-19, wie Legacys Dialog mit allen
 *   Wegtypen): `bach` macht einen Flussweg zum Bach. Wechselt ein Abschnitt zwischen Land und Wasser oder Bach und Fluss, fallen seine
 *   Reisemittel auf die Vorgabe der neuen Art (Legacy `resetToDefault`; ein Bach ohne Boote, F14), außer der Körper nennt sie. Die
 *   Fließrichtung bleibt stehen (Legacy). Seewege sind abgeschaltet (WI-0046, WI-0131). Wechselt die Wegart, rechnet die Wegfindung neu.
 * - **Fließrichtung** je Abschnitt (`sections[].flowDirection`, Schritt 4): `forward` in Zeichenrichtung, `reverse` dagegen, `null`
 *   offen (das Gelände leitet sie dann ab). Nur an einem Fluss; Legacy dreht das Feld, nie die Linie.
 * - Heißt die Straße danach wie eine andere derselben Art, sind beide eine (Hinweis `merged` in der Quittung), wie bei der Kraftlinie.
 * - **Kennzeichen** (`mark`, Migration 0174, WI-0177 §30): `karawanenroute` über dem Wegtyp, `""` nimmt es weg. Es gilt allen Abschnitten,
 *   nur an Landwegen, und ändert keine Reisezeit: Tempo und Reisemittel kommen weiter vom Wegtyp jedes Abschnitts. Eine Straße mit
 *   Kennzeichen sind die Abschnitte gleichen Namens und gleichen Kennzeichens, auch auf gemischtem Untergrund; die Wegart setzt dann
 *   alle Abschnitte auf denselben Wegtyp.
 * - **↺ zum Wiki-Wert** (WI-0225 §7, Modell c): Name, Wegart und Kennzeichen nehmen auch `{ revert: "wiki" }`. Der Server holt den Wert
 *   aus dem Artikel der Straße (Titel, Weg-Art über `wegtypAusWiki` und `kennzeichenAusWiki`) und vermerkt Herkunft wiki an allen
 *   Abschnitten (`field_origin`); ein Wert vermerkt manual. Ohne Wiki-Wert dafür: 400.
 * - **Die Kurve** (`shape`, W5b Schritt 3, EDIT-0003 T44): das neue Kontrollpolygon EINES Abschnitts der Straße samt der mitgezogenen
 *   Punkte anderer Wege, in derselben Operation wie die Felder. Der Abschnitt schreibt gegen seine Revision aus `sections`, jeder
 *   Mitgezogene gegen seine eigene. Mit Kurve braucht es dazu `edit_map_geometry`. Der eigene Schreibweg `path.reshape` ist entfallen.
 * - **Reisemittel je Abschnitt** (`sections[].reisen`, Vorschlag 3 Schritt 3, Migration 0208): die ganze Liste und alle Fenster dieses
 *   Abschnitts, danach „vollständig geschrieben“ (F16 „A“, Betreiber 2026-10-18): Nichts erbt mehr (`freigabeErbe`), die Liste gilt wie
 *   gespeichert, auch leer, ein Mittel ohne Fenster fährt ganzjährig. Die Liste nennt nur Mittel, die der Wegtyp anbietet; ein Fenster
 *   nur an einem Mittel der Liste. Wechselt etwas, rechnet die Wegfindung neu.
 */

export const editorPathUpdateUrl = (publicId: string): string => `/api/editor/paths/${publicId}/update`;

/** So lang darf der Name eines Wegs sein (wie bei der Kraftlinie, Legacy `maxlength="160"`). */
export const PATH_NAME_MAX = 160;

/** Die Landwege. Ein Kennzeichen tragen nur sie. */
export const PATH_LAND_SUBTYPES = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"] as const;
export type PathLandSubtype = (typeof PATH_LAND_SUBTYPES)[number];

/** Die Wegarten, zwischen denen der Editor wechseln darf: die Landwege und der Fluss (Plan Fluss/Bach 2026-10-19). Seeweg nie. */
export const PATH_EDIT_SUBTYPES = [...PATH_LAND_SUBTYPES, "Flussweg"] as const;
export type PathEditSubtype = (typeof PATH_EDIT_SUBTYPES)[number];

/** Die Fließrichtung eines Flusses: in Zeichenrichtung, dagegen; `null` offen. */
export const PATH_FLOW_DIRECTIONS = ["forward", "reverse"] as const;
export type PathFlowDirection = (typeof PATH_FLOW_DIRECTIONS)[number];

/**
 * Die Kennzeichen über dem Wegtyp (Migration 0174, `path.mark`; WI-0177 §30). Ein Kennzeichen hat keine Reisewerte: Tempo, Reisemittel,
 * Eiltempo und Unterbringung kommen vom Wegtyp des Abschnitts. Es ändert Linie, Namensfarbe, Liste und Infopanel. Der Legacy-Zug
 * schreibt es nie.
 */
export const PATH_MARKS = ["karawanenroute"] as const;
export type PathMark = (typeof PATH_MARKS)[number];

/** Ist das ein Kennzeichen? (Kachel und Lesepfad liefern freien Text.) */
export const isPathMark = (wert: unknown): wert is PathMark =>
    typeof wert === "string" && (PATH_MARKS as readonly string[]).includes(wert);

const strict = { additionalProperties: false } as const;

/** ↺ in `path.update`: zurück auf den Wiki-Wert der Straße (Herkunft wiki; WI-0225 §7). */
const ZumWiki = Type.Object({ revert: Type.Literal("wiki") }, strict);

const Tag = Type.Integer({ minimum: 1, maximum: 30 });

/**
 * Ein Zeitfenster der Reisemittel eines Abschnitts, wie gespeichert (`path.transport_seasons[mittel]`, WI-0038; Legacys Form): vom Tag
 * bis zum Tag, beide 1 bis 30; ein Fenster über den Jahreswechsel schließt die Namenlosen Tage ein. Ohne Fenster fährt das Mittel
 * ganzjährig. `reason` (Vorschlag 3 Schritt 3, Migration 0208) sagt, warum es sonst gesperrt ist (`CLOSURE_REASONS`); fehlt ohne. Beim
 * Lesen ist der Monat freier Text (ein falscher fällt weg), beim Schreiben einer der zwölf (`PathReisenBody`).
 */
export const EditorPathSaison = Type.Object(
    {
        from_month: Type.String(),
        from_day: Tag,
        to_month: Type.String(),
        to_day: Tag,
        reason: Type.Optional(Type.Union(CLOSURE_REASONS.map((grund) => Type.Literal(grund)))),
    },
    strict,
);
export type EditorPathSaison = Static<typeof EditorPathSaison>;

const Monat = Type.Union(CALENDAR_MONTHS.map((monat) => Type.Literal(monat)));

/**
 * Die Reisemittel EINES Abschnitts zum Schreiben (Vorschlag 3 Schritt 3, F16 „A“): die ganze Liste und alle Fenster. Was fehlt, fährt
 * nicht oder ganzjährig; geerbt wird danach nichts mehr. Die Liste nennt nur Mittel, die der Wegtyp anbietet, ein Fenster nur Mittel
 * der Liste.
 *
 * `geschrieben: false` nimmt nur ↺ aus dem Verlauf: zurück auf den Stand vor dem ersten Speichern, mit Erbe; die Liste darf dann `null`
 * sein (die Vorgabe des Wegtyps) und wird nicht gegen das Angebot geprüft (Legacys Listen nennen auch anderes).
 */
export const PathReisenBody = Type.Object(
    {
        liste: Type.Union([
            Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 40, uniqueItems: true }),
            Type.Null(),
        ]),
        fenster: Type.Record(
            Type.String({ minLength: 1, maxLength: 40 }),
            Type.Object(
                {
                    from_month: Monat,
                    from_day: Tag,
                    to_month: Monat,
                    to_day: Tag,
                    reason: Type.Optional(Type.Union(CLOSURE_REASONS.map((grund) => Type.Literal(grund)))),
                },
                strict,
            ),
        ),
        geschrieben: Type.Optional(Type.Literal(false)),
    },
    strict,
);
export type PathReisenBody = Static<typeof PathReisenBody>;

/** Die Kurve eines Abschnitts: wie bisher `path.reshape`, der Abschnitt ist einer aus `sections`. */
export const PathShape = Type.Object(
    {
        publicId: Type.String({ pattern: UUID_PATTERN }),
        points: Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() }, strict), {
            minItems: 2,
            maxItems: PATH_MAX_POINTS,
        }),
        carried: Type.Array(PathCarriedPoint, { maxItems: 64 }),
    },
    strict,
);
export type PathShape = Static<typeof PathShape>;

/** So viele weitere Straßennamen trägt ein Abschnitt höchstens (WI-0302); Legacy kannte keine Grenze, gesehen sind bis zu drei. */
export const PATH_WEITERE_MAX = 12;

export const PathUpdateBody = Type.Object(
    {
        operationId: OperationId,
        /** Alle Abschnitte der Straße, wie der Entwurf sie gelesen hat. */
        sections: Type.Array(
            Type.Object(
                {
                    publicId: Type.String({ pattern: UUID_PATTERN }),
                    baseRevision: Type.Integer({ minimum: 1 }),
                    /** Tunnel je Abschnitt (Migration 0172); fehlt: unverändert. Wirkt nur auf Querfeldein-Anschluss und Darstellung. */
                    tunnel: Type.Optional(Type.Boolean()),
                    /** Die Reisemittel des Abschnitts, vollständig (Migration 0208, F16 „A“); fehlt: unverändert. */
                    reisen: Type.Optional(PathReisenBody),
                    /**
                     * Der Wegtyp NUR dieses Abschnitts (Vorschlag 3 Schritt 3, seit ein Weg sein Name ist, Schritt 2a); geht vor `subtype` der
                     * Straße. Landwege und Flussweg; ein Seeweg bleibt Seeweg.
                     */
                    subtype: Type.Optional(Type.Union(PATH_EDIT_SUBTYPES.map((art) => Type.Literal(art)))),
                    /** Bach an oder aus NUR an diesem Abschnitt (nur an einem Fluss); geht vor `bach` der Straße. */
                    bach: Type.Optional(Type.Boolean()),
                    /** Die Fließrichtung dieses Abschnitts (Schritt 4); fehlt: unverändert. Nur an einem Fluss. */
                    flowDirection: Type.Optional(
                        Type.Union([...PATH_FLOW_DIRECTIONS.map((richtung) => Type.Literal(richtung)), Type.Null()]),
                    ),
                    /**
                     * Die weiteren Straßennamen dieses Abschnitts (WI-0302, OPS-000108), vollständig: die Schlüssel der Wiki-Artikel der Wege
                     * (`wiki_path_snapshot.wiki_key`), die neben seinem Hauptartikel hier mitlaufen. Fehlt: unverändert. Nur Wiki-Artikel (Vali
                     * 2026-11-10, Option „Nur Wiki-Artikel“), nicht der Hauptartikel des Abschnitts. Gespeichert als weitere Zuweisung (Rolle `further`).
                     */
                    weitere: Type.Optional(
                        Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
                            maxItems: PATH_WEITERE_MAX,
                            uniqueItems: true,
                        }),
                    ),
                },
                strict,
            ),
            { minItems: 1, maxItems: 500 },
        ),
        /** Ein Name (Herkunft manual) oder ↺ auf den Titel des Artikels (Herkunft wiki). */
        name: Type.Optional(Type.Union([Type.String({ maxLength: PATH_NAME_MAX }), ZumWiki])),
        /** Eine Wegart (manual) oder ↺ auf die des Wiki (`wegtypAusWiki`, wiki). */
        subtype: Type.Optional(Type.Union([...PATH_EDIT_SUBTYPES.map((art) => Type.Literal(art)), ZumWiki])),
        /** Bach an oder aus an allen Abschnitten (nur an einem Fluss; Plan Fluss/Bach). */
        bach: Type.Optional(Type.Boolean()),
        labelVisible: Type.Optional(Type.Boolean()),
        /** Das Kennzeichen aller Abschnitte; `""` nimmt es weg; ↺ folgt der Weg-Art des Wiki (`kennzeichenAusWiki`). */
        mark: Type.Optional(Type.Union([...PATH_MARKS.map((m) => Type.Literal(m)), Type.Literal(""), ZumWiki])),
        shape: Type.Optional(PathShape),
    },
    strict,
);
export type PathUpdateBody = Static<typeof PathUpdateBody>;

/** Die Quittung von `path.update`: die gewöhnliche, mit Kurve dazu, woran die Enden des Abschnitts jetzt hängen (sichtbar bestätigen). */
export const PathUpdateReceipt = Type.Object(
    { ...OperationReceipt.properties, ends: Type.Optional(EditorPathEnds) },
    strict,
);
export type PathUpdateReceipt = Static<typeof PathUpdateReceipt>;
