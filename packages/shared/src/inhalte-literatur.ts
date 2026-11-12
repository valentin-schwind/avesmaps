import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import { INHALTE_HERKUENFTE, INHALTE_KOMMENTAR_MAX, INHALTE_TITEL_MAX, INHALTE_TRAEGER } from "./inhalte-quellen.ts";
import { MediaPublicView } from "./media.ts";
import { MutationEnvelope, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Literatur“ (WI-0254, Runde 2; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`).
 *
 *     GET  /api/editor/inhalte/literatur            die Werke, seitenweise, mit Suche und Filter                      use_editor_menu
 *     GET  /api/editor/inhalte/literatur/:id        ein Werk: Stammdaten, Cover, geordnete Ortsliste                  use_editor_menu
 *     POST /api/editor/inhalte/literatur            work.create: ein Werk anlegen (Titel, Produkttyp)                  manage_sources
 *     POST /api/editor/inhalte/literatur/:id/update work.update: Stammdaten und Ortsliste in EINER Operation          manage_sources
 *
 * Die Ziele zum Anhängen liefert dieselbe Suche wie bei den Quellen (`INHALTE_ZIELE_URL`): nur echte Kennungen, nie ein Name.
 *
 * - 🔴 **Das Werk ist die Wurzel** (`adventure`, Migration 0068): seine Kennung ist `adventure.public_id`. Ein gleichlautender Titel oder
 *   Wiki-Schlüssel ist kein Beweis für dasselbe Werk, und ein Werk ist keine Quelle. Der Wiki-Schlüssel ist hier nur lesbar.
 * - **Die Ortsliste ist Aussage:** `adventure_place.sort_order` (der kleinste ist der Startort) wird von Hand geordnet und nie still neu
 *   sortiert. Jede Zeile hat EINE Rolle (`start` beginnt hier, `play` spielt hier und IST der Spoiler, `covers` beschreibt). Die Liste im
 *   Körper von `work.update` ist die GANZE aktive Liste in der Reihenfolge, die gelten soll: vorhandene Zeilen über ihre `rowId`, neue über
 *   ein echtes Ziel (`kind` + `carrierId`) oder als ungeklärter Name (`rawName`, ohne Kartenbezug). Eine aktive Zeile, die fehlt, wird still
 *   gelegt; eine gelöste, die erscheint, kommt zurück.
 * - **Entfernen legt still, es löscht nie:** eine Zeile aus Legacy wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine eigene
 *   gelöst (`retired`), beides mit `retired_origin = editor`.
 * - **Cover** gehört der Medienverwaltung (Rechte, Quarantäne, Freigaberegel): Der Reiter zeigt es nur und führt dorthin.
 * - Jede Schreibroute trägt `MutationEnvelope` (`operationId`, `baseRevision` des Werks) und antwortet mit `OperationReceipt`;
 *   409 `edit_conflict` bei veraltetem Stand, 423 `map_locked` und `map_editing_off`, 503 `map_import_running`.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const INHALTE_LITERATUR_URL = "/api/editor/inhalte/literatur";
export const inhalteWerkUrl = (id: string): string => `${INHALTE_LITERATUR_URL}/${id}`;
export const inhalteWerkAendernUrl = (id: string): string => `${INHALTE_LITERATUR_URL}/${id}/update`;

/**
 * Die Arten, die die Redaktion wählt: Legacys Vokabular von `adventure.product_type` (offen und wörtlich, ohne CHECK). Ein Werk mit einem
 * anderen Wort behält es und zeigt es in der Auswahl als vorhandenen Wert; das Infopanel nennt sie in `infoPanel.literature.type.*`.
 */
export const INHALTE_WERK_TYPEN = [
    "gruppenabenteuer",
    "soloabenteuer",
    "kurzabenteuer",
    "szenario",
    "anthologie",
    "kampagne",
    "kampagnenband",
    "metaband",
    "roman",
    "kurzgeschichte",
    "regionalspielhilfe",
    "spielhilfe",
] as const;

/** Die Regelsysteme der Auswahl (Mockup); ein anderer vorhandener Wert bleibt stehen. `edition` ist offen (höchstens 16 Zeichen). */
export const INHALTE_WERK_EDITIONEN = ["DSA1", "DSA2", "DSA3", "DSA4", "DSA4.1", "DSA5"] as const;

/** Die Rolle einer Ortszeile: `start` beginnt hier, `play` spielt hier (der Spoiler), `covers` beschreibt (spoilerfrei). */
export const INHALTE_WERK_ROLLEN = ["start", "play", "covers"] as const;
export type InhalteWerkRolle = (typeof INHALTE_WERK_ROLLEN)[number];

/** `resolved` hat genau ein Ziel; `unresolved` nur einen Namen; `unmatched` nennt Legacy ein Ziel, das Avesmaps3D nicht findet. */
export const INHALTE_WERK_ZIEL_STAENDE = ["resolved", "unresolved", "unmatched"] as const;
export type InhalteWerkZielStand = (typeof INHALTE_WERK_ZIEL_STAENDE)[number];

/** Die Arten der Ziele einer Zeile; der Weg steht nur lesend da (Ankersegment einer Gruppe, wie bei den Quellen). */
export const INHALTE_WERK_ZIELARTEN = [...INHALTE_TRAEGER, "path"] as const;
export type InhalteWerkZielart = (typeof INHALTE_WERK_ZIELARTEN)[number];

/** Woher eine Angabe stammt: das Wiki, die Hand (Legacy-Redaktion oder dieses Fenster) oder Legacy ohne Auskunft (`unknown`). */
export const INHALTE_URSPRUENGE = ["wiki", "manual", "legacy"] as const;
export type InhalteUrsprung = (typeof INHALTE_URSPRUENGE)[number];

export const INHALTE_WERK_SORTIERUNGEN = ["title", "title_desc", "year"] as const;
export type InhalteWerkSortierung = (typeof INHALTE_WERK_SORTIERUNGEN)[number];

/** `aktiv` (Vorgabe), `stillgelegt` (nur die von der Redaktion unterdrückten) oder `alle`. */
export const INHALTE_WERK_STAENDE = ["aktiv", "stillgelegt", "alle"] as const;
export type InhalteWerkStand = (typeof INHALTE_WERK_STAENDE)[number];

/** Die Längen, die Legacy kennt (`literature.yaml`: Art 32, Regelsystem 16, Genre 160, Rohname 300); die Notiz ist unsere. */
export const INHALTE_WERK_ART_MAX = 32;
export const INHALTE_WERK_EDITION_MAX = 16;
export const INHALTE_WERK_SERIE_MAX = 200;
export const INHALTE_WERK_GENRE_MAX = 160;
export const INHALTE_WERK_NOTIZ_MAX = INHALTE_KOMMENTAR_MAX;
export const INHALTE_WERK_ROHNAME_MAX = 300;
export const INHALTE_WERK_JAHR_MIN = -9999;
export const INHALTE_WERK_JAHR_MAX = 9999;
export const INHALTE_WERK_ORTE_MAX = 500;

export const InhalteWerkeAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        sort: Type.Optional(oneOf(INHALTE_WERK_SORTIERUNGEN)),
        herkunft: Type.Optional(oneOf(INHALTE_HERKUENFTE)),
        stand: Type.Optional(oneOf(INHALTE_WERK_STAENDE)),
    },
    strict,
);
export type InhalteWerkeAnfrage = Static<typeof InhalteWerkeAnfrage>;

/** Eine Zeile der Liste links. */
export const InhalteWerkZeile = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        productType: Type.String(),
        edition: Type.Optional(Type.String()),
        /** Die Jahresangabe wie das Infopanel sie zeigt (`bf_label`, sonst das Jahr). */
        year: Type.Optional(Type.String()),
        bfYear: Type.Optional(Type.Integer()),
        /** Wie viele aktive Ortszeilen das Werk hat. */
        orte: Type.Integer({ minimum: 0 }),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Von der Redaktion stillgelegt (unterdrückt): Der Kreis ist leer. */
        stillgelegt: Type.Boolean(),
    },
    strict,
);
export type InhalteWerkZeile = Static<typeof InhalteWerkZeile>;

export const InhalteWerkListe = Type.Object(
    {
        total: Type.Integer({ minimum: 0 }),
        items: Type.Array(InhalteWerkZeile),
        /** Für den Reiter und die Legende: alle aktiven Werke, davon im Editor angelegt oder geändert, und die stillgelegten. */
        zahlen: Type.Object(
            {
                aktiv: Type.Integer({ minimum: 0 }),
                editor: Type.Integer({ minimum: 0 }),
                stillgelegt: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
    },
    strict,
);
export type InhalteWerkListe = Static<typeof InhalteWerkListe>;

export const InhalteWerkZustand = oneOf(["active", "retired", "suppressed"] as const);
export type InhalteWerkZustand = Static<typeof InhalteWerkZustand>;

/** Eine Zeile der Ortsliste. Die Identität einer Zeile ist `rowId` (die Zeile selbst); das Ziel ist `kind` + `carrierId`, nie der Name. */
export const InhalteWerkOrt = Type.Object(
    {
        rowId: Type.String({ pattern: "^[0-9]{1,18}$" }),
        role: oneOf(INHALTE_WERK_ROLLEN),
        targetState: oneOf(INHALTE_WERK_ZIEL_STAENDE),
        /** Nur bei `resolved`. */
        kind: Type.Optional(oneOf(INHALTE_WERK_ZIELARTEN)),
        carrierId: Type.Optional(Uuid()),
        /** Der Name des Ziels, bei einem ungeklärten Ziel der Rohname. */
        name: Type.String(),
        /** Die Art des Ziels in Worten der Schlüssel (Ortsklasse, Gebietsart, …); fehlt, wo es keine gibt. */
        subtype: Type.Optional(Type.String()),
        state: InhalteWerkZustand,
        ursprung: oneOf(INHALTE_URSPRUENGE),
        /** Wer die Zeile führt: Legacy (der Zug) oder die Redaktion. Eine Zeile aus Legacy wird beim Lösen unterdrückt, eine eigene gelöst. */
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Das Ziel steht noch auf der Karte beziehungsweise ist aktiv. */
        traegerAktiv: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteWerkOrt = Static<typeof InhalteWerkOrt>;

/** Das Cover gehört der Medienverwaltung: `gebunden` nennt, ob eine aktive Bindung besteht, `ansicht` die öffentlich erlaubte Sicht. */
export const InhalteWerkCover = Type.Object(
    { gebunden: Type.Boolean(), ansicht: Type.Optional(MediaPublicView) },
    strict,
);
export type InhalteWerkCover = Static<typeof InhalteWerkCover>;

export const InhalteWerk = Type.Object(
    {
        id: Uuid(),
        revision: Type.Integer({ minimum: 1 }),
        /** Der Wiki-Schlüssel des Werks; nur lesbar. */
        wikiKey: Type.Optional(Type.String()),
        title: Type.String(),
        productType: Type.String(),
        edition: nullable(Type.String()),
        series: nullable(Type.String()),
        bfYear: nullable(Type.Integer()),
        /** Die Jahresangabe in Worten (`bf_label`), wo Legacy eine führt; sie steht neben dem Jahr, bis das Jahr geändert wird. */
        bfLabel: nullable(Type.String()),
        genre: nullable(Type.String()),
        isOfficial: Type.Boolean(),
        editorNote: nullable(Type.String()),
        ursprung: oneOf(INHALTE_URSPRUENGE),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** `false`: von der Redaktion stillgelegt (unterdrückt). */
        aktiv: Type.Boolean(),
        /** Je Feld, woher der Wert kam (`adventure_field_origin`); was fehlt, ist nicht bekannt. Schlüssel sind die Namen des Vertrags. */
        feldUrsprung: Type.Record(Type.String(), oneOf(["wiki", "manual"] as const)),
        cover: InhalteWerkCover,
        /** Alle Zeilen, aktive und stille, in der Reihenfolge der Liste (`sort_order`, dann `export_ordinal`). */
        orte: Type.Array(InhalteWerkOrt),
    },
    strict,
);
export type InhalteWerk = Static<typeof InhalteWerk>;

/** Die Felder des Werks selbst; was fehlt, bleibt. `aktiv: false` legt das Werk still („unterdrücken“), `true` holt es zurück. */
export const InhalteWerkFelder = Type.Object(
    {
        title: Type.Optional(Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX })),
        productType: Type.Optional(Type.String({ minLength: 1, maxLength: INHALTE_WERK_ART_MAX })),
        edition: Type.Optional(nullable(Type.String({ maxLength: INHALTE_WERK_EDITION_MAX }))),
        series: Type.Optional(nullable(Type.String({ maxLength: INHALTE_WERK_SERIE_MAX }))),
        bfYear: Type.Optional(
            nullable(Type.Integer({ minimum: INHALTE_WERK_JAHR_MIN, maximum: INHALTE_WERK_JAHR_MAX })),
        ),
        genre: Type.Optional(nullable(Type.String({ maxLength: INHALTE_WERK_GENRE_MAX }))),
        isOfficial: Type.Optional(Type.Boolean()),
        editorNote: Type.Optional(nullable(Type.String({ maxLength: INHALTE_WERK_NOTIZ_MAX }))),
        aktiv: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteWerkFelder = Static<typeof InhalteWerkFelder>;

/** Ein Eintrag der Ortsliste im Körper: eine vorhandene Zeile, ein neues echtes Ziel oder ein ungeklärter Name. */
export const InhalteWerkOrtEintrag = Type.Union([
    Type.Object({ rowId: Type.String({ pattern: "^[0-9]{1,18}$" }), role: oneOf(INHALTE_WERK_ROLLEN) }, strict),
    Type.Object({ kind: oneOf(INHALTE_TRAEGER), carrierId: Uuid(), role: oneOf(INHALTE_WERK_ROLLEN) }, strict),
    Type.Object(
        {
            rawName: Type.String({ minLength: 1, maxLength: INHALTE_WERK_ROHNAME_MAX }),
            role: oneOf(INHALTE_WERK_ROLLEN),
        },
        strict,
    ),
]);
export type InhalteWerkOrtEintrag = Static<typeof InhalteWerkOrtEintrag>;

/** `work.update`: Stammdaten und die ganze Ortsliste gegen den gesehenen Stand (`baseRevision`), mindestens eines von beiden. */
export const InhalteWerkAendernBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        fields: Type.Optional(InhalteWerkFelder),
        orte: Type.Optional(Type.Array(InhalteWerkOrtEintrag, { maxItems: INHALTE_WERK_ORTE_MAX })),
    },
    strict,
);
export type InhalteWerkAendernBody = Static<typeof InhalteWerkAendernBody>;

/** `work.create`: ein Werk mit Titel und Art; alles Weitere folgt im Entwurf. */
export const InhalteWerkAnlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        title: Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX }),
        productType: Type.String({ minLength: 1, maxLength: INHALTE_WERK_ART_MAX }),
        isOfficial: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteWerkAnlegenBody = Static<typeof InhalteWerkAnlegenBody>;

/** Die Antwort auf `work.create`: die gewöhnliche Quittung, dazu die Kennung des neuen Werks. */
export const InhalteWerkAngelegt = Type.Object({ ...OperationReceipt.properties, publicId: Uuid() }, strict);
export type InhalteWerkAngelegt = Static<typeof InhalteWerkAngelegt>;
