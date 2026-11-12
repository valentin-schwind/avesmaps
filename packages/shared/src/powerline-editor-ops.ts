import { Type, type Static } from "@sinclair/typebox";
import { OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Der Schreibweg einer Kraftlinie (WI-0205 Pakete K6 und K8; Blatt Kraftlinien; Legacy `update_powerline_line`).
 *
 *     GET  /api/editor/powerlines/:anker/targets  die Nodices, an denen ein Ende einrasten kann        edit_map_geometry
 *     POST /api/editor/powerlines/:anker/update   powerline.update_line: Felder und Form in EINER Operation
 *                                                  edit_map_objects, mit Kurve oder Ende auch edit_map_geometry
 *     GET  /api/editor/powerline-targets         die Nodices für eine neue Kraftlinie (K9)                edit_map_geometry
 *     POST /api/editor/powerlines                powerline.create: ein Abschnitt von Nodix zu Nodix (K9)  beide Rechte
 *     POST /api/editor/nodices                   nodix.create: ein neuer Kraftlinienpunkt (K9, R7)         beide Rechte
 *     GET  /api/editor/powerlines/:anker/history  der Verlauf der Linie, neueste zuerst (`editor-history.ts`) use_editor_menu
 *     POST /api/editor/powerlines/:anker/take-off-map  powerline.take_off_map: „Von der Karte nehmen“ (K10)  edit_map_geometry
 *     POST /api/editor/powerlines/:anker/put-on-map    powerline.put_on_map: „Zurück auf die Karte“ (K10)    edit_map_geometry
 *     POST /api/editor/powerlines/:anker/retire        powerline.retire: „Ganz löschen“, weich (K10, T39)    edit_map_objects
 *     POST /api/editor/powerlines/:anker/restore       powerline.restore: eine gelöschte Linie zurück (K10)  edit_map_objects
 *     POST /api/editor/nodices/:id/retire              nodix.retire: ein Kraftlinienpunkt ohne Linie weg (K10) beide Rechte
 *     POST /api/editor/nodices/:id/move                nodix.move: ein Kraftlinienpunkt an eine neue Stelle (K5) beide Rechte
 *
 * - **Eine Operation an der Linie** trägt ALLE ihre Abschnitte mit der Revision, die der Entwurf gesehen hat. Fehlt einer, kam einer
 *   dazu oder hat einer eine andere Revision, ist das ein Konflikt (409 `edit_conflict`): Jemand hat die Linie inzwischen geändert.
 * - **Felder der Linie** gehen an alle Abschnitte: Name (bindet sie zur Linie; heißt schon eine andere so, verschmelzen beide, wie
 *   Legacy), „Name auf der Karte anzeigen“, Beschreibung (KF1). 🔴 Ein FEHLENDES Feld heißt „unverändert“ (Legacys Lehre: Ein Feld,
 *   das immer mitreist, löscht beim nächsten Speichern, was ein anderer Weg gesetzt hat). Eine leere Beschreibung (`""` oder `null`)
 *   löscht sie.
 * - Der Name ist nie leer: Eine Linie ohne Namen hätte keine Gruppe mehr (ihre Abschnitte zerfielen in Linien für sich).
 * - **Form je Abschnitt** (K8, EDIT-0003 T27 (4): „Fertig“ schreibt Form und Felder zusammen): der Bogen (`curve`, ±45 % der Sehne,
 *   `null` heißt gerade wie „nie gespeichert“) und ein umgehängtes Ende (`from`, `to`: ein Ort oder eine Beschriftung mit dem Merkmal
 *   Nodix oder ein Kraftlinienpunkt, R6). Abschnitt und Wiki-Zuordnung bleiben; die gezeichnete Bahn rechnet der Server in derselben
 *   Transaktion neu (K5).
 * - **Nodix anfügen und herausnehmen** (T28 (5), R5; im selben Entwurf wie die Kurve): `add` legt Abschnitte von Nodix zu Nodix an, die
 *   Name, Beschriftung und Beschreibung der Linie erben; `remove` an einem Abschnitt legt ihn still. Herausnehmen ist im Entwurf schon
 *   gerechnet (die Nachbarn verbinden sich, indem ein Abschnitt umgehängt wird und der andere entfällt). Es bleibt mindestens ein
 *   Abschnitt; die ganze Linie geht mit „Kraftlinie entfernen“.
 * - **Wiki-Artikel** (`wiki`, je LINIE wie Legacy): `{ key }` ordnet den Artikel des Abzugs allen Abschnitten zu (Herkunft `editor`,
 *   der Import fasst sie dann nie an), `null` löst ihn an allen. Ein fehlendes Feld lässt die Zuordnung, wie sie ist. Die Artikel kommen
 *   aus `GET /api/editor/powerline-wiki` (`WikiTrefferListe`).
 * - **Zurück an die Linie** (`revive`, nur für ↺ im Verlauf): Ein herausgenommener Abschnitt kommt mit seinen Enden zurück und nimmt
 *   Name, Beschriftung und Beschreibung der Linie an. Er muss gelöscht sein (weder auf der Karte noch abgenommen) und die Revision
 *   tragen, die das Protokoll nach dem Herausnehmen nennt; sonst 400 oder 409.
 */

export const editorPowerlineUpdateUrl = (anker: string): string => `/api/editor/powerlines/${anker}/update`;
/** Der Verlauf einer Linie: jede Operation an einem ihrer Abschnitte (`MapHistoryPage`). */
export const editorPowerlineHistoryUrl = (anker: string): string => `/api/editor/powerlines/${anker}/history`;

/** So lang darf der Name sein (Legacy `maxlength="160"`). */
export const POWERLINE_NAME_MAX = 160;
/** So lang darf die Beschreibung sein (Legacy `maxlength="2000"`). */
export const POWERLINE_DESCRIPTION_MAX = 2000;

const strict = { additionalProperties: false } as const;
const PublicId = () => Type.String({ pattern: UUID_PATTERN });

/** Ein Abschnitt, wie der Entwurf ihn sah, und was sich an seiner Form ändert; ein fehlendes Feld bleibt. */
export const PowerlineSegmentBase = Type.Object(
    {
        id: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        // Eine Typliste, keine Union: Mit `coerceTypes` machte ajv aus `null` still 0 (Number zuerst) oder aus 0 ein `null` (Null zuerst;
        // Befund der Koordination 2026-10-19, ajv-umwandlung). Wie `packages/shared/src/system/wegfindung.ts`.
        curve: Type.Optional(Type.Unsafe<number | null>({ type: ["number", "null"], minimum: -45, maximum: 45 })),
        from: Type.Optional(PublicId()),
        to: Type.Optional(PublicId()),
        /** Der Abschnitt entfällt (Nodix herausnehmen); gemeinsam mit einem Umhängen eines anderen Abschnitts verbindet das die Nachbarn. */
        remove: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type PowerlineSegmentBase = Static<typeof PowerlineSegmentBase>;

/** Ein neuer Abschnitt der Linie (Nodix anfügen): von einem Nodix zum anderen, auf Wunsch gebogen. */
export const PowerlineSegmentNew = Type.Object(
    {
        from: PublicId(),
        to: PublicId(),
        // Eine Typliste, keine Union: Mit `coerceTypes` machte ajv aus `null` still 0 (Number zuerst) oder aus 0 ein `null` (Null zuerst;
        // Befund der Koordination 2026-10-19, ajv-umwandlung). Wie `packages/shared/src/system/wegfindung.ts`.
        curve: Type.Optional(Type.Unsafe<number | null>({ type: ["number", "null"], minimum: -45, maximum: 45 })),
    },
    strict,
);
export type PowerlineSegmentNew = Static<typeof PowerlineSegmentNew>;

/** Ein herausgenommener Abschnitt, der an die Linie zurückkommt (↺ im Verlauf), mit seiner Revision nach dem Herausnehmen. */
export const PowerlineSegmentRevive = Type.Object(
    { id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type PowerlineSegmentRevive = Static<typeof PowerlineSegmentRevive>;

/** ↺ an einem Feld mit Wiki-Wert (WI-0225): zurück auf den Wiki-Wert, Herkunft wiki. */
const WikiZurueck = Type.Object({ revert: Type.Literal("wiki") }, strict);

/** Die Wahl des Artikels: der Wiki-Key eines Artikels aus dem Abzug, oder `null` (lösen). */
export const PowerlineWikiWahl = Type.Union([Type.Object({ key: Type.String({ minLength: 1 }) }, strict), Type.Null()]);
export type PowerlineWikiWahl = Static<typeof PowerlineWikiWahl>;

/** Die Artikel der Kraftlinien (`wiki_powerline_snapshot`) mit Werten und der Linie, an der jeder schon hängt. */
export const EDITOR_POWERLINE_WIKI_URL = "/api/editor/powerline-wiki";

export const PowerlineUpdateBody = Type.Object(
    {
        operationId: PublicId(),
        /** Alle Abschnitte der Linie, wie der Entwurf sie gesehen hat. */
        segments: Type.Array(PowerlineSegmentBase, { minItems: 1, maxItems: 500 }),
        /** Neue Abschnitte (Nodix anfügen); fehlt, wenn keine. */
        add: Type.Optional(Type.Array(PowerlineSegmentNew, { minItems: 1, maxItems: 50 })),
        /** Herausgenommene Abschnitte, die zurückkommen (nur ↺ im Verlauf); fehlt, wenn keine. */
        revive: Type.Optional(Type.Array(PowerlineSegmentRevive, { minItems: 1, maxItems: 50 })),
        /** Ein Name (Herkunft manual) oder ↺ auf den Namen des Wiki-Artikels der Linie (Herkunft wiki; WI-0225, wie am Ort). */
        name: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: POWERLINE_NAME_MAX }), WikiZurueck])),
        labelVisible: Type.Optional(Type.Boolean()),
        /**
         * Eine Beschreibung (Herkunft manual; `null` leert) oder ↺: Die eigene wird geleert und folgt dem Wiki (Herkunft wiki). Leer heißt
         * an der Kraftlinie „folgt dem Wiki“, der Leser zeigt dann die des Artikels (Legacy, Orchestrierung 2026-10-18).
         */
        description: Type.Optional(
            Type.Union([
                Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: POWERLINE_DESCRIPTION_MAX }),
                WikiZurueck,
            ]),
        ),
        /** Der Artikel der ganzen Linie; fehlt, wenn er bleibt. */
        wiki: Type.Optional(PowerlineWikiWahl),
        /** ↺ im Verlauf: die Operation, die diese zurücknimmt; die neue Operation trägt dann die Quelle `restore`. */
        reverts: Type.Optional(PublicId()),
    },
    strict,
);
export type PowerlineUpdateBody = Static<typeof PowerlineUpdateBody>;

export const editorPowerlineTargetsUrl = (anker: string): string => `/api/editor/powerlines/${anker}/targets`;

/** Ein Nodix, an dem ein Ende einrasten kann: ein Ort oder eine Beschriftung mit dem Merkmal, oder ein Kraftlinienpunkt. */
export const EditorPowerlineTarget = Type.Object(
    {
        id: PublicId(),
        kind: Type.Union([
            Type.Literal("place"),
            Type.Literal("label"),
            Type.Literal("nodix"),
            Type.Literal("landmark"),
        ]),
        /** Der Name eines Orts oder einer Beschriftung; ein Kraftlinienpunkt hat keinen. */
        name: Type.Optional(Type.String()),
        x: Type.Number(),
        y: Type.Number(),
        /** Nur am Kraftlinienpunkt: seine Revision, gegen die „Kraftlinienpunkt entfernen“ schreibt (`nodix.retire`). */
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    strict,
);
export type EditorPowerlineTarget = Static<typeof EditorPowerlineTarget>;

export const EditorPowerlineTargets = Type.Object({ targets: Type.Array(EditorPowerlineTarget) }, strict);
export type EditorPowerlineTargets = Static<typeof EditorPowerlineTargets>;

export const editorPowerlineRetireUrl = (anker: string): string => `/api/editor/powerlines/${anker}/retire`;
export const editorPowerlineTakeOffMapUrl = (anker: string): string => `/api/editor/powerlines/${anker}/take-off-map`;
export const editorPowerlinePutOnMapUrl = (anker: string): string => `/api/editor/powerlines/${anker}/put-on-map`;
export const editorPowerlineRestoreUrl = (anker: string): string => `/api/editor/powerlines/${anker}/restore`;

/**
 * Der Stand einer Linie (K10, EDIT-0003 T43, wie Wege und Ort): auf der Karte (`is_active`), von der Karte genommen (`off_map`, bleibt
 * in der Liste unter „Nicht auf der Karte“) oder gelöscht (weich, beides falsch). Die vier Wechsel gehen je an ALLE Abschnitte.
 */
export const POWERLINE_STATES = ["karte", "abgenommen", "geloescht"] as const;
export type PowerlineState = (typeof POWERLINE_STATES)[number];

/** Die vier Wechsel des Stands: woher, wohin. */
export const POWERLINE_STATE_CHANGES = {
    "powerline.take_off_map": { from: ["karte"], to: "abgenommen" },
    "powerline.put_on_map": { from: ["abgenommen"], to: "karte" },
    "powerline.retire": { from: ["karte", "abgenommen"], to: "geloescht" },
    "powerline.restore": { from: ["geloescht"], to: "karte" },
} as const satisfies Record<string, { from: readonly PowerlineState[]; to: PowerlineState }>;
export type PowerlineStateChange = keyof typeof POWERLINE_STATE_CHANGES;

/**
 * `powerline.retire` (K10 knapp, EDIT-0003 T39: „Kraftlinie entfernen“ am Nodix in der Ansicht Kraftlinien): alle Abschnitte der Linie
 * still (`is_active`), gegen ihre Revisionen; nichts wird gelöscht, das Protokoll hält es, der Verlauf holt es zurück.
 */
export const PowerlineRetireBody = Type.Object(
    {
        operationId: PublicId(),
        segments: Type.Array(Type.Object({ id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) }, strict), {
            minItems: 1,
            maxItems: 500,
        }),
        /** ↺ im Verlauf: die Operation, die dieser Wechsel zurücknimmt; die neue Operation trägt dann die Quelle `restore`. */
        reverts: Type.Optional(PublicId()),
    },
    strict,
);
export type PowerlineRetireBody = Static<typeof PowerlineRetireBody>;
/** Derselbe Körper für alle vier Wechsel des Stands. */
export const PowerlineStateBody = PowerlineRetireBody;
export type PowerlineStateBody = PowerlineRetireBody;

/**
 * Mehrere Linien auf einmal (WI-0238; EDIT-0003 T57 Mehrfachauswahl, für Kraftlinien „zunächst nur ‚Entfernen …‘ und ↺“): ein Wechsel des
 * Stands oder ↺ auf die Wiki-Werte für ALLE gewählten Linien als EINE Operation, unter dem Namen des Einzelfalls (`powerline.retire` …,
 * `powerline.update_line`), damit Verlauf und Protokoll sie kennen. Je Linie ihr Anker und ihre Abschnitte mit den Revisionen, die die
 * Auswahl zuletzt sah (409 wie beim Einzelfall).
 */
export const POWERLINE_SAMMEL_MAX = 200;
export const EDITOR_POWERLINES_SAMMEL_STAND_URL = "/api/editor/powerlines/sammel/stand";
export const EDITOR_POWERLINES_SAMMEL_WIKI_URL = "/api/editor/powerlines/sammel/wiki";

export const PowerlineSammelLinie = Type.Object(
    {
        anker: PublicId(),
        segments: Type.Array(Type.Object({ id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) }, strict), {
            minItems: 1,
            maxItems: 500,
        }),
    },
    strict,
);
export type PowerlineSammelLinie = Static<typeof PowerlineSammelLinie>;

export const PowerlineSammelStandBody = Type.Object(
    {
        operationId: PublicId(),
        wechsel: Type.Union([
            Type.Literal("powerline.take_off_map"),
            Type.Literal("powerline.put_on_map"),
            Type.Literal("powerline.retire"),
            Type.Literal("powerline.restore"),
        ]),
        lines: Type.Array(PowerlineSammelLinie, { minItems: 1, maxItems: POWERLINE_SAMMEL_MAX }),
        /** ↺ im Verlauf: die Operation, die dieser Wechsel zurücknimmt (alle ihre Linien zusammen). */
        reverts: Type.Optional(PublicId()),
    },
    strict,
);
export type PowerlineSammelStandBody = Static<typeof PowerlineSammelStandBody>;

/** ↺ für alle: Name und/oder Beschreibung jeder Linie zurück auf den Wiki-Wert (Herkunft wiki), wie `{ revert: "wiki" }` am Einzelfall. */
export const PowerlineSammelWikiBody = Type.Object(
    {
        operationId: PublicId(),
        felder: Type.Array(Type.Union([Type.Literal("name"), Type.Literal("description")]), {
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
        }),
        lines: Type.Array(PowerlineSammelLinie, { minItems: 1, maxItems: POWERLINE_SAMMEL_MAX }),
    },
    strict,
);
export type PowerlineSammelWikiBody = Static<typeof PowerlineSammelWikiBody>;

/** Die Nodices einer neuen Kraftlinie (K9): dieselben Ziele wie beim Umhängen eines Endes, ohne Linie. */
export const EDITOR_POWERLINE_TARGETS_URL = "/api/editor/powerline-targets";

/**
 * `powerline.create` (K9; Legacy `create_powerline`, Blatt Kraftlinien R4): ein gerader Abschnitt von einem Nodix zu einem anderen, EINE
 * Operation. Ohne `name` heißt er wie Legacy „A - B“ nach seinen Enden und ist eine Linie für sich; mit `name` schließt er an die Linie
 * dieses Namens an („Nodix anfügen“) und übernimmt ihre Beschriftung und Beschreibung. Beide Enden müssen ein Nodix sein und verschieden.
 */
export const PowerlineCreateBody = Type.Object(
    {
        operationId: PublicId(),
        from: PublicId(),
        to: PublicId(),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: POWERLINE_NAME_MAX })),
    },
    strict,
);
export type PowerlineCreateBody = Static<typeof PowerlineCreateBody>;

/** Die Quittung: die gewöhnliche, dazu der neue Abschnitt und der Name seiner Linie. */
export const PowerlineCreateReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: PublicId(), name: Type.String() },
    strict,
);
export type PowerlineCreateReceipt = Static<typeof PowerlineCreateReceipt>;

/** „Neuer Kraftlinienpunkt“ (K9; Blatt Kraftlinien R7, Frage 4: über „Hier hinzufügen ›“). */
export const EDITOR_NODICES_URL = "/api/editor/nodices";

/**
 * `nodix.create` (K9): ein Kraftlinienpunkt an einer Stelle der Karte (Karteneinheiten), EINE Operation. Er ist eine Abzweigung
 * (`legacy_kind = 'junction'`, KF4, von der Orchestrierung 2026-10-17 festgelegt: das Feld wird nur gespeichert) und trägt keinen Namen.
 */
export const NodixCreateBody = Type.Object({ operationId: PublicId(), x: Type.Number(), y: Type.Number() }, strict);
export type NodixCreateBody = Static<typeof NodixCreateBody>;

export const editorNodixRetireUrl = (id: string): string => `${EDITOR_NODICES_URL}/${id}/retire`;

/**
 * `nodix.retire` (K10): ein Kraftlinienpunkt geht weich (`is_active`), nur wenn keine Linie mehr an ihm endet, auch keine von der
 * Karte genommene; sonst 400 mit der Zahl. Gegen seine Revision.
 */
export const NodixRetireBody = Type.Object(
    { operationId: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);
export type NodixRetireBody = Static<typeof NodixRetireBody>;

export const editorNodixMoveUrl = (id: string): string => `${EDITOR_NODICES_URL}/${id}/move`;

/**
 * `nodix.move` (K5): ein Kraftlinienpunkt an eine neue Stelle der Karte, gegen seine Revision; die Bahnen der Linien, die an ihm enden,
 * zieht der Server in derselben Operation nach. Außerhalb der Karte 400.
 */
export const NodixMoveBody = Type.Object(
    { operationId: PublicId(), baseRevision: Type.Integer({ minimum: 1 }), x: Type.Number(), y: Type.Number() },
    strict,
);
export type NodixMoveBody = Static<typeof NodixMoveBody>;

/** Die Quittung: die gewöhnliche, dazu der neue Kraftlinienpunkt. */
export const NodixCreateReceipt = Type.Object({ ...OperationReceipt.properties, publicId: PublicId() }, strict);
export type NodixCreateReceipt = Static<typeof NodixCreateReceipt>;
