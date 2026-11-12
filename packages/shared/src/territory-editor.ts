import { Type, type Static } from "@sinclair/typebox";
import { WikiFeldAenderung } from "./feld-herkunft.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { upperPoliticalBandFromLegacy } from "./zoom-bands.ts";

/**
 * Der Lesepfad des Herrschaftsgebiete-Editors (WI-0209 Paket A1; EDIT-0005 §3, §9), nach dem Muster des Landschaftseditors
 * (`landscape-editor.ts`).
 *
 * - 🔴 Recht `use_editor_menu` (ab Reviewer), am Server über `protect`; ohne Recht 403 vor jeder Abfrage.
 * - **Ein Gebiet ist ein Knoten im Baum** (EDIT-0003 T23): `territory` mit Elter (`parent_id`), 0..n eigenen Flächen
 *   (`territory_area`) und einer Zoomspanne. Alle aktiven Gebiete stehen in der Liste, auch die 795 ohne Fläche (○ im Baum, Frage 9)
 *   und die, die im Anzeigejahr nicht gelten (`notInYear`). Ganz gelöschte (`is_active = false`) fehlen.
 * - **Der Kreis** nach Legacys Regel über die Untergebiete (EDIT-0003 T26 (5): „außer für herrschaftsgebiete, da gilt die alte regel
 *   aus legacy“; Legacy `wiki-sync-monitor.html`, coverage), rekursiv: ● `voll` das Gebiet und alle Untergebiete auf der Karte ·
 *   ◑ `halb-rechts` das Gebiet auf der Karte, Untergebiete unvollständig · ◐ `halb` nur über Untergebiete, unvollständig · ○ `leer`
 *   nicht auf der Karte. „Auf der Karte“ heißt: eine eigene aktive Fläche. Die Füllungen sind dieselben wie in den anderen Listen.
 * - **Knapp:** rund 1.700 Zeilen; was falsch oder leer ist, fehlt in der Zeile. Der Server schickt die Liste gepackt, der schwache
 *   ETag über den Inhalt macht jeden weiteren Abruf zu einem 304, bis sich etwas ändert.
 * - **Kennungen** sind öffentliche (`public_id`). Koordinaten sind MCS `aventuria-v1`.
 * - Revisionen kommen mit der Datenseite (Paket B1); bis dahin trägt das Detail keine.
 */

export const EDITOR_TERRITORIES_URL = "/api/editor/territories";

export const EDITOR_TERRITORY_CIRCLES = ["leer", "halb", "halb-rechts", "voll"] as const;
export type EditorTerritoryCircle = (typeof EDITOR_TERRITORY_CIRCLES)[number];

/** Die 17 Detailfelder aus dem Wiki (Migration 0076, `territory_detail`), in Legacys Folge des Sync-Editors. */
export const EDITOR_TERRITORY_DETAIL_FIELDS = [
    "continent",
    "form_of_government",
    "capital_name",
    "seat_name",
    "ruler",
    "founder",
    "language",
    "currency",
    "population",
    "trade_goods",
    "trade_zone",
    "political",
    "geographic",
    "blazon",
    "founded_text",
    "dissolved_text",
    "affiliation_raw",
] as const;
export type EditorTerritoryDetailField = (typeof EDITOR_TERRITORY_DETAIL_FIELDS)[number];

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** Ein Merkmal, das nur dasteht, wenn es zutrifft. */
const Flag = () => Type.Optional(Type.Literal(true));
const PublicId = () => Type.String({ pattern: UUID_PATTERN });
const Zoom = () => Type.Optional(Type.Integer({ minimum: 0, maximum: 8 }));
const Rahmen = () => Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]));

export const EditorTerritoryRow = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        /** Die Art (`territory.territory_type`: Kaiserreich, Baronie …), roh. */
        type: Type.Optional(Type.String()),
        /** Der gespeicherte Elter, wenn er aktiv ist; fehlt bei einer Wurzel. */
        parent: Type.Optional(PublicId()),
        circle: Union(EDITOR_TERRITORY_CIRCLES),
        /** Das Gebiet hat eine eigene aktive Fläche. */
        area: Flag(),
        /** Die Zoomspanne (`min_zoom`, `max_zoom`); fehlt eine Grenze, ist sie offen. */
        minZoom: Zoom(),
        maxZoom: Zoom(),
        /** Die feste Farbe des Gebiets (`territory.color`, T38). */
        color: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
        /** Der Wiki-Artikel (`territory.wiki_url`); fehlt ohne. */
        wiki: Type.Optional(Type.String({ minLength: 1 })),
        /** Der Platz unter den Geschwistern (`territory.sort_order`). */
        order: Type.Integer(),
        /** Das Gebiet gilt im Anzeigejahr nicht (`valid_from_bf`, `valid_to_bf`); die Karte zeigt es dann nie. */
        notInYear: Flag(),
        /** Ganz gelöscht (D3, weich; EDIT-0003 T54): steht nur unter der Facette „Gelöscht“, zählt in keiner Legende. */
        deleted: Flag(),
        /** Der Rahmen dessen, was die Karte unter diesem Gebiet zeigt (abgeleitete Formen aller Bänder): [x0, y0, x1, y1]; fehlt ohne. */
        bounds: Rahmen(),
        /** Woher das Gebiet stammt, wenn nicht aus Legacy (`territory.source_system`). */
        source: Type.Optional(Type.String()),
    },
    strict,
);
export type EditorTerritoryRow = Static<typeof EditorTerritoryRow>;

export const EditorTerritoryList = Type.Object(
    {
        /** Das Anzeigejahr der Karte (BF), nach dem `notInYear` gerechnet ist. */
        yearBf: Type.Integer(),
        rows: Type.Array(EditorTerritoryRow),
    },
    strict,
);
export type EditorTerritoryList = Static<typeof EditorTerritoryList>;

/** Ein Ort, auf den ein Feld zeigt (Hauptstadt, Herrschaftssitz); `missing`, wenn die Kennung auf keinen aktiven Ort zeigt. */
export const EditorTerritoryPlace = Type.Object(
    {
        id: PublicId(),
        name: Type.Optional(Type.String()),
        /** Die Art des Ortes (`place.subtype`: metropole, stadt, dorf, gebaeude …), roh. */
        kind: Type.Optional(Type.String()),
        missing: Flag(),
    },
    strict,
);
export type EditorTerritoryPlace = Static<typeof EditorTerritoryPlace>;

export const EditorTerritoryRef = Type.Object({ id: PublicId(), name: Type.String() }, strict);
export type EditorTerritoryRef = Static<typeof EditorTerritoryRef>;

/**
 * Ein Detailfeld mit seinem wirksamen Wert und der Herkunft; `''` ist der bewusste Leerwert eines Overrides (Migration 0076). Dazu der
 * Wiki-Wert für den Feldbaustein (`fenster/wiki-feld`, WI-0225, Form `WikiText`; Schnappschuss `wiki_territory_snapshot`):
 * - `wiki: "Text"`: der Wiki-Wert; weicht der Wert ab, steht er durchgestrichen hinter dem Label, ↺ setzt auf ihn zurück.
 * - `wiki: null`: Das Wiki kennt keinen Wert (↺ leert das Feld).
 * - `wiki` fehlt: unbekannt (Legacy führte einen eigenen Wert und lieferte den Wiki-Wert nie, oder das Gebiet hat keinen Artikel); kein
 *   Durchstreichen, kein ↺. Den Unterschied macht allein, ob der Schlüssel da ist; darum optional, nie Pflicht mit `null`.
 * - `value: null`: Das Gebiet hat keinen eigenen Wert, das Wiki aber einen (G6: er steht durchgestrichen, ↺ holt ihn). Ein Feld ohne
 *   Wert und ohne Wiki-Text fehlt.
 */
export const EditorTerritoryDetailValue = Type.Object(
    {
        value: Type.Union([Type.String(), Type.Null()]),
        origin: Type.Optional(Union(["override", "wiki"] as const)),
        wiki: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    },
    strict,
);

/** Die Detailfelder eines Gebiets, die einen Wert tragen: im Detail und im Stand der Mehrfachauswahl. */
export const EditorTerritoryDetailValues = Type.Partial(
    Type.Object(
        Object.fromEntries(EDITOR_TERRITORY_DETAIL_FIELDS.map((f) => [f, EditorTerritoryDetailValue])) as Record<
            EditorTerritoryDetailField,
            typeof EditorTerritoryDetailValue
        >,
        strict,
    ),
);

/** Eine eigene Fläche des Gebiets, ohne Geometrie (die kommt mit dem Modus, Paket C1). */
export const EditorTerritoryArea = Type.Object(
    {
        id: PublicId(),
        /** Der Stand der Fläche (B2): Konflikt und „Überschreiben“ der Form rücken auf ihn. */
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        minZoom: Zoom(),
        maxZoom: Zoom(),
        validFromBf: Type.Optional(Type.Integer()),
        validToBf: Type.Optional(Type.Integer()),
        /** Die Fläche gilt im Anzeigejahr nicht oder ist von einer jüngeren verdrängt (Legacys „aktuelle Form“). */
        notInYear: Flag(),
        /** Die Geometrie ist ungültig; die Ableitung liest sie repariert (`territory_area_valid`). */
        invalid: Flag(),
        bounds: Rahmen(),
    },
    strict,
);
export type EditorTerritoryArea = Static<typeof EditorTerritoryArea>;

export const EditorTerritoryDetail = Type.Object(
    {
        id: PublicId(),
        /** Der Stand der Felder (B2, `territory.update`); die Flächen tragen je ihre eigene Revision (T44 (4)). */
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        name: Type.String(),
        shortName: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
        wikiType: Type.Optional(Type.String()),
        status: Type.Optional(Type.String()),
        color: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
        /** Die Deckkraft aus den Daten (0 bis 1); die Karte zeigt alle Gebiete gleich (Frage 11), nur lesend. */
        opacity: Type.Number({ minimum: 0, maximum: 1 }),
        minZoom: Zoom(),
        maxZoom: Zoom(),
        validFromBf: Type.Optional(Type.Integer()),
        validToBf: Type.Optional(Type.Integer()),
        validLabel: Type.Optional(Type.String()),
        notInYear: Flag(),
        order: Type.Integer(),
        wiki: Type.Optional(
            Type.Object({ url: Type.Optional(Type.String()), key: Type.Optional(Type.String()) }, strict),
        ),
        source: Type.Optional(Type.String()),
        /** Der gespeicherte Elter und die Kette bis zur Wurzel (zuerst der Elter); ein Elter außerhalb des Anzeigejahrs bleibt drin. */
        parents: Type.Array(EditorTerritoryRef),
        /**
         * Woher der Elter kommt (D1, Migration 0159): `override`, wenn ihn der Editor umgehängt hat (✎ „Eigener Wert“); fehlt, kommt er
         * aus dem Gebietsimport. „Obergebiet halten“ und ↺ mit dem Wiki-Wert kommen mit G6.
         */
        parentOrigin: Type.Optional(Type.Literal("override")),
        /** Ganz gelöscht (D3, T54): Das Fenster zeigt es nur lesend, der Verlauf holt es zurück. */
        deleted: Flag(),
        children: Type.Array(EditorTerritoryRef),
        /** Hauptstadt (wählbar, B2) und Herrschaftssitz (nur lesend, Frage 10). */
        capital: Type.Optional(EditorTerritoryPlace),
        seat: Type.Optional(EditorTerritoryPlace),
        /** Die Detailfelder aus dem Wiki, die einen Wert tragen (auch den leeren eines Overrides). */
        details: EditorTerritoryDetailValues,
        areas: Type.Array(EditorTerritoryArea),
        /** Wer dieses Gebiet beansprucht, und was es selbst beansprucht (Schraffur; bearbeitet wird das später). */
        claimedBy: Type.Array(EditorTerritoryRef),
        claims: Type.Array(EditorTerritoryRef),
        /** Ein Wappen ist gebunden (`territory_media`, Rolle `coat`); gebunden wird in der Medienverwaltung (Frage 13). */
        hasCoat: Flag(),
        /** Die veröffentlichte Datei des Wappens; fehlt, solange es nicht veröffentlicht ist. */
        coat: Type.Optional(Type.String({ minLength: 1 })),
    },
    strict,
);
export type EditorTerritoryDetail = Static<typeof EditorTerritoryDetail>;

/**
 * Ein Gebiet als Eingabe der Anzeigeregel im Reiter „Hierarchie“ (A3). `above`: ein Glied der Kette über dem gewählten Gebiet; es
 * steht nicht im Reiter, gewinnt aber mit engerer Spanne. `revision` (D2): der Stand, gegen den „Zoombänder bearbeiten“ speichert;
 * die Glieder darüber tragen keine, sie ändert der Reiter nicht.
 */
export const EditorTerritoryHierarchyTerritory = Type.Object(
    {
        id: PublicId(),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        name: Type.String(),
        shortName: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
        parent: Type.Optional(PublicId()),
        minZoom: Zoom(),
        maxZoom: Zoom(),
        validFromBf: Type.Optional(Type.Integer()),
        validToBf: Type.Optional(Type.Integer()),
        color: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
        order: Type.Integer(),
        above: Flag(),
    },
    strict,
);
export type EditorTerritoryHierarchyTerritory = Static<typeof EditorTerritoryHierarchyTerritory>;

/** Eine Fläche eines Nachfahren als Eingabe der Anzeigeregel. */
export const EditorTerritoryHierarchyArea = Type.Object(
    {
        id: PublicId(),
        territory: PublicId(),
        minZoom: Zoom(),
        maxZoom: Zoom(),
        validFromBf: Type.Optional(Type.Integer()),
        validToBf: Type.Optional(Type.Integer()),
    },
    strict,
);
export type EditorTerritoryHierarchyArea = Static<typeof EditorTerritoryHierarchyArea>;

/**
 * Der Reiter „Hierarchie“ (A3; EDIT-0005 §3): das Gebiet, seine Kette und alle Nachfahren samt deren Flächen. Der Browser rechnet daraus
 * mit derselben Regel wie der Nachweis N2 (`territory-display-rule.ts`), was die Karte je Band zeigt. `derivedMaxBand`: das oberste
 * abgeleitete Band; darüber zeigt die Karte dieses (Gebietszeiger `maxBand`), -1 ohne Ableitung.
 */
export const EditorTerritoryHierarchy = Type.Object(
    {
        yearBf: Type.Integer(),
        derivedMaxBand: Type.Integer({ minimum: -1, maximum: 8 }),
        territories: Type.Array(EditorTerritoryHierarchyTerritory),
        areas: Type.Array(EditorTerritoryHierarchyArea),
    },
    strict,
);
export type EditorTerritoryHierarchy = Static<typeof EditorTerritoryHierarchy>;

/** Die Adresse des Reiters „Hierarchie“ eines Gebiets. */
export const editorTerritoryHierarchyUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}/hierarchy`;

/**
 * Der Modus „Grenzen bearbeiten“ (WI-0209 Paket C1; EDIT-0005 §3, T23 Frage 1 und 2), geholt beim Start, nie während der Geste
 * (Recht `edit_map_geometry`), nach dem Muster der Andockziele der Landschaft (`EditorLandscapeTargets`):
 *
 * - **Welches Gebiet** (Frage 2): das verlangte. Mit `?x=&y=` (der Klickpunkt, Karteneinheiten) und ohne eigene Fläche dort ist das
 *   verlangte abgeleitet; dann gilt der Nachfahr, dessen eigene Fläche den Punkt enthält, die kleinste zuerst („Grenzen bearbeiten“
 *   führt zur Baronie darunter). `id` und `name` sind die des bearbeiteten Gebiets, `requested` das verlangte, wenn es ein anderes war.
 * - `areas`: die eigenen Flächen, die im Anzeigejahr gelten, eckig wie gespeichert, je mit Revision. Leer heißt: nichts zu bearbeiten
 *   (Grenze zeichnen kommt mit C3).
 * - `parents`: die Kette bis zur Wurzel, zuerst der Elter. Die Leiste nennt sie (Frage 1): Ihre Grenzen werden nach „Fertig“ neu
 *   abgeleitet.
 * - `neighbors`: Flächen anderer Gebiete, die mit einer eigenen Fläche mindestens eine Ecke koordinatengleich teilen, ganz und mit
 *   Revision: Ihre gemeinsamen Ecken ziehen mit, gespeichert wird gegen ihre Revision (C2).
 * - `edges`: Kanten der übrigen Flächen anderer Gebiete im Kasten der eigenen plus `margin`, als Strecken.
 */
export const editorTerritoryFormUrl = (id: string, at?: { x: number; y: number }): string =>
    `${EDITOR_TERRITORIES_URL}/${id}/form${at === undefined ? "" : `?x=${String(at.x)}&y=${String(at.y)}`}`;

/** So weit um den Kasten der Flächen holt der Modus die Andockziele, in Karteneinheiten (wie bei der Landschaft). */
export const TERRITORY_TARGET_MARGIN = 15;

const Ecke = () => Type.Tuple([Type.Number(), Type.Number()]);
const Polygone = () => Type.Array(Type.Array(Type.Array(Ecke(), { minItems: 3 }), { minItems: 1 }), { minItems: 1 });

export const EditorTerritoryFormArea = Type.Object(
    { id: PublicId(), revision: Type.Integer({ minimum: 1 }), polygons: Polygone() },
    strict,
);
export type EditorTerritoryFormArea = Static<typeof EditorTerritoryFormArea>;

export const EditorTerritoryFormNeighbor = Type.Object(
    {
        /** Die Fläche (`territory_area.public_id`). */
        id: PublicId(),
        territory: PublicId(),
        name: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        polygons: Polygone(),
    },
    strict,
);
export type EditorTerritoryFormNeighbor = Static<typeof EditorTerritoryFormNeighbor>;

export const EditorTerritoryFormEdge = Type.Object(
    { areaId: PublicId(), name: Type.String(), a: Ecke(), b: Ecke() },
    strict,
);
export type EditorTerritoryFormEdge = Static<typeof EditorTerritoryFormEdge>;

export const EditorTerritoryForm = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        requested: Type.Optional(EditorTerritoryRef),
        parents: Type.Array(EditorTerritoryRef),
        margin: Type.Number(),
        areas: Type.Array(EditorTerritoryFormArea),
        neighbors: Type.Array(EditorTerritoryFormNeighbor),
        edges: Type.Array(EditorTerritoryFormEdge),
    },
    strict,
);
export type EditorTerritoryForm = Static<typeof EditorTerritoryForm>;

/** So viele Flächen trägt eine Operation höchstens (eigene und mitgezogene), wie bei der Landschaft. */
export const TERRITORY_RESHAPE_AREAS_MAX = 64;

/** Eine Fläche der Form in `territory.update` (WI-0209 C2, B2): eckig wie gespeichert (Ringe ohne Schlusspunkt), gegen ihre Revision. */
export const TerritoryReshapeArea = Type.Object(
    { id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }), polygons: Polygone() },
    strict,
);
export type TerritoryReshapeArea = Static<typeof TerritoryReshapeArea>;

/**
 * „Fertig“ im Gebietseditor (WI-0209 B2; O3, `apps/web/src/fenster/bearbeitung.ts`; EDIT-0003 T27 (4), T44): `territory.update` schreibt
 * Felder und Form EINES Gebiets als EINE Operation (`PATCH /api/editor/territories/:id`), wie `landscape.update`.
 *
 * - **Felder** (B2): Name, Kurzname, Art, Status und die Hauptstadt als Ort (Ortssuche; `""` nimmt sie weg). Der Sitz bleibt nur lesend
 *   (E1). Leere Texte bei Kurzname, Art und Status leeren das Feld. Felder brauchen `baseRevision` des Gebiets.
 * - **Obergebiet** (`parent`, D1, „Umhängen“): ein anderes aktives Gebiet derselben Karte oder `""` (Wurzel); nie das Gebiet selbst
 *   oder eines seiner Untergebiete (400 mit Satz). Die Untergebiete ziehen mit um; die Herkunft wird `override`. Die Folgen je Band
 *   zeigt vorher `editorTerritoryParentConsequencesUrl`.
 * - **Form** (`areas`, `TerritoryReshapeArea`): je Fläche gegen ihre Revision; die Revision des Gebiets zählt nur seine Felder
 *   (T44 (4)). Für die Form braucht es zusätzlich `edit_map_geometry`.
 * - Konflikt 409 `edit_conflict` nimmt alles zurück; hält ein anderer das Gebiet oder einen mitgezogenen Nachbarn, 409
 *   `object_locked`; Zug 503. Nichts zu schreiben ist 400. Danach `territory_derive` (der Inhalts-Hash entscheidet, ob er rechnet).
 */
export const editorTerritoryUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}`;

/**
 * Der Verlauf eines Gebiets (WI-0209 D5; gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`): jede Operation am Gebiet oder an einer
 * seiner Flächen, neueste zuerst, seitenweise über `before` (`MapHistoryPage`). ↺ schreibt `territory.update` oder
 * `territory.display` mit `reverts` (Quelle `restore`). Recht `use_editor_menu`.
 */
export const editorTerritoryHistoryUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}/history`;

/** Ein Detailtext höchstens so lang (Legacy nennt keine Grenze; die längsten Wiki-Texte im Bestand bleiben weit darunter). */
export const TERRITORY_DETAIL_MAX = 20000;

/**
 * Ein Detailwert in der Operation: ein Text oder `null` (kein Wert). 🪤 EIN Schema mit `type: ["string", "null"]`, keine Vereinigung:
 * Fastifys ajv fragt die Zweige einer Vereinigung der Reihe nach und wandelt schon im ersten um, mit dem Textzweig vorn wird `null` zu
 * `""` (der bewusste Leerwert), mit `null` vorn `""` zu `null` (`docs/regeln/entwicklung.md`; `territory-detail-vertrag.test.ts`).
 */
const DETAIL_WERT = Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: TERRITORY_DETAIL_MAX });

export const TerritoryDetailChanges = Type.Partial(
    Type.Object(
        Object.fromEntries(
            EDITOR_TERRITORY_DETAIL_FIELDS.map((feld) => [feld, WikiFeldAenderung(DETAIL_WERT)]),
        ) as Record<EditorTerritoryDetailField, ReturnType<typeof WikiFeldAenderung<typeof DETAIL_WERT>>>,
        strict,
    ),
);
export type TerritoryDetailChanges = Partial<Record<EditorTerritoryDetailField, WikiFeldAenderung<string | null>>>;

export const TerritoryUpdateChanges = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
        shortName: Type.Optional(Type.String({ maxLength: 160 })),
        type: Type.Optional(Type.String({ maxLength: 160 })),
        status: Type.Optional(Type.String({ maxLength: 255 })),
        capital: Type.Optional(Type.Union([PublicId(), Type.Literal("")])),
        parent: Type.Optional(Type.Union([PublicId(), Type.Literal("")])),
        /**
         * Die 17 Detailfelder mit Wiki-Wert (WI-0209 G6; Wiki-Feld WI-0225, Modell c): `{ value }` ist ein eigener Wert (Herkunft `override`,
         * also manual; `""` der bewusste Leerwert, der den Wiki-Wert verdeckt, Migration 0076; `null` kein Wert und kein Vermerk, etwa
         * wenn ↺ im Verlauf ein Feld leert, das vorher keinen hatte), `{ revert: "wiki" }` holt den Wert aus dem
         * Schnappschuss `wiki_territory_snapshot` (Herkunft `wiki`; kennt das Wiki keinen Wert, bleibt das Feld ohne Wert; ist er unbekannt,
         * 400). Die Herkunft bleibt in `territory_detail_field_origin`, nicht in `field_origin` (`feld-herkunft.ts`).
         */
        details: Type.Optional(TerritoryDetailChanges),
    },
    strict,
);
export type TerritoryUpdateChanges = Static<typeof TerritoryUpdateChanges>;

export const TerritoryUpdateBody = Type.Object(
    {
        operationId: OperationId,
        /** ↺ im Verlauf (D5): die Operation, die diese zurücknimmt; die neue trägt die Quelle `restore`. */
        reverts: Type.Optional(PublicId()),
        baseRevision: Type.Optional(Type.Integer({ minimum: 1 })),
        changes: Type.Optional(TerritoryUpdateChanges),
        areas: Type.Optional(Type.Array(TerritoryReshapeArea, { minItems: 1, maxItems: TERRITORY_RESHAPE_AREAS_MAX })),
    },
    strict,
);
export type TerritoryUpdateBody = Static<typeof TerritoryUpdateBody>;

export const TerritoryUpdateReceipt = OperationReceipt;
export type TerritoryUpdateReceipt = Static<typeof TerritoryUpdateReceipt>;

/**
 * „Fertig“ in „Farben und Zoombänder“ (WI-0209 D2, D4; EDIT-0005 §3, §6, §7 D2 und D4; T23 Frage 6 und 7, H2): EINE Operation
 * `territory.display` mit Zoomspanne und Farbe der Gebiete, die der Entwurf im Reiter „Hierarchie“ geändert hat, je gegen ihre Revision.
 *
 * - **Zoomspanne** (`zoom`, D2): Eine fehlende Grenze ist offen (Legacy NULL). Wie Legacy (`avesmapsPoliticalUpdateTerritoryZoomRange`,
 *   `api/_internal/political/territories-write.php`, Mirror 5ff58118): Bekommt ein Gebiet eine neue Spanne, verlieren seine Flächen ihr
 *   eigenes Band; danach gilt an ihnen die des Gebiets. Sonst stünde eine Baronie mit Spanne 4 bis 8 in Band 7 und 8 leer.
 * - **Farbe** (`color`, D4, H2): eine feste Farbe je Gebiet wie in Legacy; Mitziehen und „Farbhierarchie erstellen“ rechnet der Editor,
 *   hier stehen nur die Ergebnisse. Die Kacheln lesen die Farbe live: Ändert die Operation nur Farben, leitet nichts neu ab, eine neue
 *   Kachelrevision genügt.
 * - **Sperre nur der geänderten Gebiete** (Frage 6): Hält ein anderer eines davon, 409 `object_locked`; ein Konflikt nimmt alles
 *   zurück (409 `edit_conflict`); läuft der Zug, 503 `map_import_running`.
 * - Lücken und Überlappungen sind Befunde, nie eine Sperre: Der Server weist nur ab, was die Datenbank nicht trägt (von > bis).
 * - Mit einer Spanne leitet danach der Auftrag `territory_derive` neu ab (B3). Recht `edit_map_objects`.
 */
export const EDITOR_TERRITORY_DISPLAY_URL = `${EDITOR_TERRITORIES_URL}/display`;

/** So viele Gebiete trägt eine Operation höchstens; „⇉ für alle Geschwister“ oder eine Farbhierarchie eines großen Reichs bleibt darunter. */
export const TERRITORY_DISPLAY_MAX = 512;

/**
 * So viele Gebiete trägt eine Operation der Mehrfachauswahl höchstens (Lesen, „Fertig“, „Entfernen …“, „Unter neues Obergebiet …“). Der
 * Betreiber räumt mit „Entfernen für alle“ Platzhalter weg (2026-10-20: 512 reichten nicht, die Stage hat 1685 Gebiete); mit Luft über
 * allen Gebieten der Karte. Über der Grenze sagt die Oberfläche den Grund, bevor etwas geschickt wird.
 */
export const TERRITORY_SAMMEL_MAX = 4096;

/** Die Zoomspanne eines Gebiets; eine fehlende Grenze ist offen. */
export const TerritoryDisplayZoom = Type.Object({ minZoom: Zoom(), maxZoom: Zoom() }, strict);
export type TerritoryDisplayZoom = Static<typeof TerritoryDisplayZoom>;

export const TerritoryDisplayTerritory = Type.Object(
    {
        id: PublicId(),
        baseRevision: Type.Integer({ minimum: 1 }),
        zoom: Type.Optional(TerritoryDisplayZoom),
        color: Type.Optional(Type.String({ pattern: "^#[0-9a-f]{6}$" })),
    },
    strict,
);
export type TerritoryDisplayTerritory = Static<typeof TerritoryDisplayTerritory>;

export const TerritoryDisplayBody = Type.Object(
    {
        operationId: OperationId,
        /** ↺ im Verlauf (D5): die Operation, die diese zurücknimmt; die neue trägt die Quelle `restore`. */
        reverts: Type.Optional(PublicId()),
        territories: Type.Array(TerritoryDisplayTerritory, { minItems: 1, maxItems: TERRITORY_DISPLAY_MAX }),
    },
    strict,
);
export type TerritoryDisplayBody = Static<typeof TerritoryDisplayBody>;

export const TerritoryDisplayReceipt = OperationReceipt;
export type TerritoryDisplayReceipt = Static<typeof TerritoryDisplayReceipt>;

/**
 * „Fertig“ der Mehrfachauswahl an den Herrschaftsgebieten (EDIT-0003 T57; Fassung 5, Betreiber 2026-10-19: „perfekt genau das wollen
 * wir“; `fenster/sammel.ts`): EINE Operation `territory.sammel` mit den gemeinsamen Feldern für ALLE gewählten Gebiete, je gegen ihre
 * Revision.
 *
 * - **Gemeinsam:** Art und Status (`changes`, leer heißt kein Wert), das Obergebiet (`changes.parent`, Umhängen; `""` heißt Wurzel; nie
 *   unter sich selbst oder ein eigenes Untergebiet), Farbe und Zoomspanne (`color`, `zoom`, wie `territory.display`: die Flächen
 *   verlieren ihr eigenes Band) und ↺ der Wiki-Felder (`wiki`, wie `{ revert: "wiki" }` in `territory.update`).
 * - Geschrieben wird an einem Gebiet nur, was sich dort ändert; eines, an dem sich nichts ändert, behält seine Revision.
 * - Ein Konflikt an einem Gebiet nimmt alles zurück (409 `edit_conflict`), eine fremde Sperre an einem davon 409 `object_locked`, der
 *   laufende Zug 503 `map_import_running`. Im Verlauf steht es je Gebiet wie `territory.update` und `territory.display`.
 * - Mit Spanne oder Obergebiet leitet danach `territory_derive` neu ab. Recht `edit_map_objects`.
 * - **↺ im Verlauf** eines Gebiets nimmt eine Operation, die an ihm Felder UND Farbe oder Spanne änderte, hierüber zurück (`reverts`,
 *   Quelle `restore`; `changes.details` mit den Werten davor, wie `territory.update`). Die Mehrfachauswahl selbst tippt keine Detailwerte.
 */
export const EDITOR_TERRITORY_SAMMEL_URL = `${EDITOR_TERRITORIES_URL}/sammel`;

export const TerritorySammelBody = Type.Object(
    {
        operationId: OperationId,
        reverts: Type.Optional(PublicId()),
        territories: Type.Array(Type.Object({ id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) }, strict), {
            minItems: 1,
            maxItems: TERRITORY_SAMMEL_MAX,
        }),
        changes: Type.Optional(
            Type.Object(
                {
                    type: Type.Optional(Type.String({ maxLength: 160 })),
                    status: Type.Optional(Type.String({ maxLength: 255 })),
                    parent: Type.Optional(Type.Union([PublicId(), Type.Literal("")])),
                    details: Type.Optional(TerritoryDetailChanges),
                },
                strict,
            ),
        ),
        wiki: Type.Optional(
            Type.Array(Union(EDITOR_TERRITORY_DETAIL_FIELDS), { maxItems: EDITOR_TERRITORY_DETAIL_FIELDS.length }),
        ),
        color: Type.Optional(Type.String({ pattern: "^#[0-9a-f]{6}$" })),
        zoom: Type.Optional(TerritoryDisplayZoom),
    },
    strict,
);
export type TerritorySammelBody = Static<typeof TerritorySammelBody>;

/**
 * Der Stand der gewählten Gebiete für die Mehrfachauswahl (EDIT-0003 T57): je Gebiet Revision, Status und die Detailfelder wie im
 * Detail, damit ein Feld „gemischt“ oder einen Wert für alle zeigt und „Fertig“ gegen die Revisionen schreibt (`TerritorySammelBody`).
 * POST, weil bis zu `TERRITORY_SAMMEL_MAX` Kennungen nicht in eine Adresse passen; liest nur. Gelöschte und unbekannte fehlen in der
 * Antwort, die übrigen stehen in der Folge der Anfrage. Recht `use_editor_menu`.
 */
export const EDITOR_TERRITORY_SAMMEL_STAND_URL = `${EDITOR_TERRITORY_SAMMEL_URL}/stand`;

export const TerritorySammelStandBody = Type.Object(
    { ids: Type.Array(PublicId(), { minItems: 1, maxItems: TERRITORY_SAMMEL_MAX }) },
    strict,
);
export type TerritorySammelStandBody = Static<typeof TerritorySammelStandBody>;

export const EditorTerritorySammelStand = Type.Object(
    {
        territories: Type.Array(
            Type.Object(
                {
                    id: PublicId(),
                    revision: Type.Integer({ minimum: 1 }),
                    status: Type.Optional(Type.String()),
                    details: EditorTerritoryDetailValues,
                },
                strict,
            ),
        ),
    },
    strict,
);
export type EditorTerritorySammelStand = Static<typeof EditorTerritorySammelStand>;

/**
 * „Entfernen“ eines Herrschaftsgebiets in zwei Stufen (WI-0209 D3; EDIT-0005 §7 D3, Fragen 4 und 5; EDIT-0003 T22 Fassung 4, T43; wie
 * Ort, Weg, Landschaft und Kraftlinie): EINE Operation `territory.retire`, sofort geschrieben (kein Entwurf), vorher ein Blatt mit den
 * Folgen (R13). Nichts wird gelöscht, alles geht weich (`is_active`).
 *
 * - **`off_map`, „Von der Karte nehmen“:** Die eigenen Flächen gehen; das Gebiet bleibt im Baum, die Untergebiete bleiben darunter.
 *   Ein Gebiet ohne eigene Fläche kann das nicht (400).
 * - **`retire`, „Ganz löschen“:** Das Gebiet geht aus Karte und Baum. Seine Untergebiete (`children`) gehen eine Ebene hoch (`up`,
 *   an sein Obergebiet), werden mitgelöscht (`along`, der ganze Teilbaum) oder Wurzeln (`root`); mit Untergebieten ist die Wahl Pflicht.
 * - **Sperre:** Hält ein anderer das Gebiet oder ein Untergebiet, das sich mitändert, 409 `object_locked` (Frage 5: eine gesperrte
 *   Baronie verhindert das Entfernen ihres Obergebiets). Gegen `baseRevision` des Gebiets (409 `edit_conflict`).
 * - **Zurück** über ↺ im Verlauf (`editorTerritoryRestoreUrl`, `territory.restore` mit `reverts`): Die Operation wird umgekehrt,
 *   wenn noch alles so steht, wie sie es hinterließ.
 * - Danach leitet `territory_derive` neu ab. Rechte `edit_map_objects` und `edit_map_geometry`.
 */
export const editorTerritoryRetireUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}/retire`;
export const editorTerritoryRestoreUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}/restore`;

export const TERRITORY_RETIRE_STAGES = ["off_map", "retire"] as const;
export const TERRITORY_RETIRE_CHILDREN = ["up", "along", "root"] as const;

export const TerritoryRetireBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        stage: Union(TERRITORY_RETIRE_STAGES),
        children: Type.Optional(Union(TERRITORY_RETIRE_CHILDREN)),
    },
    strict,
);
export type TerritoryRetireBody = Static<typeof TerritoryRetireBody>;

/**
 * „Entfernen …“ der Mehrfachauswahl (EDIT-0003 T57; Fassung 5): EINE Operation `territory.retire` für alle gewählten, je gegen ihre
 * Revision. `off_map` nimmt die eigenen Flächen der gewählten von der Karte (eines ohne eigene Fläche bleibt unberührt; hat keines eine,
 * 400). `retire` löscht sie ganz; die nicht gewählten Untergebiete rücken eine Ebene hoch (`up`), Obergebiete vor ihren Untergebieten,
 * damit ↺ (`territory.restore` im Verlauf eines jeden) den Baum wieder herstellt. Rechte wie `territory.retire`.
 */
export const EDITOR_TERRITORY_SAMMEL_RETIRE_URL = `${EDITOR_TERRITORIES_URL}/sammel/retire`;

export const TerritorySammelRetireBody = Type.Object(
    {
        operationId: OperationId,
        territories: Type.Array(Type.Object({ id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) }, strict), {
            minItems: 1,
            maxItems: TERRITORY_SAMMEL_MAX,
        }),
        stage: Union(TERRITORY_RETIRE_STAGES),
    },
    strict,
);
export type TerritorySammelRetireBody = Static<typeof TerritorySammelRetireBody>;

/**
 * „Unter neues Obergebiet …“ (EDIT-0003 T57, Variante A, Betreiber 2026-10-19): ein neues Herrschaftsgebiet OHNE eigene Fläche und das
 * Umhängen der gewählten darunter als EINE Operation `territory.create_parent`. ↺ im Verlauf des neuen oder eines gewählten
 * (`territory.restore` mit `reverts`) hängt sie zurück und setzt das neue still, wenn noch alles so steht.
 *
 * - `name`: leer oder fehlend heißt der erste freie wie beim Anlegen („Neues Herrschaftsgebiet“, „… (2)“ …). `zoom`: die Spanne des
 *   neuen (Vorschlag des Editors: von 0 bis ein Band vor dem frühesten gewählten). `parent`: wo das neue selbst hängt (ohne: Wurzel);
 *   nie unter einem der gewählten oder ihren Untergebieten. `color`: die Variante des Obergebiets, die der Editor rechnet (D4).
 * - Die gewählten je gegen ihre Revision, Herkunft des Obergebiets `override`; hält ein anderer eines, 409 `object_locked`.
 * - Danach leitet `territory_derive` neu ab; die Karte zeigt das neue aus seinen Untergebieten (◐). Recht `edit_map_objects`.
 */
export const EDITOR_TERRITORY_OBERGEBIET_URL = `${EDITOR_TERRITORIES_URL}/sammel/obergebiet`;

export const TerritoryObergebietBody = Type.Object(
    {
        operationId: OperationId,
        territories: Type.Array(Type.Object({ id: PublicId(), baseRevision: Type.Integer({ minimum: 1 }) }, strict), {
            minItems: 1,
            maxItems: TERRITORY_SAMMEL_MAX,
        }),
        name: Type.Optional(Type.String({ maxLength: 300 })),
        parent: Type.Optional(PublicId()),
        color: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        zoom: Type.Object(
            { minZoom: Type.Integer({ minimum: 0, maximum: 8 }), maxZoom: Type.Integer({ minimum: 0, maximum: 8 }) },
            strict,
        ),
    },
    strict,
);
export type TerritoryObergebietBody = Static<typeof TerritoryObergebietBody>;

/** Die Quittung: die gewöhnliche, dazu das neue Gebiet und sein Name. */
export const TerritoryObergebietReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: PublicId(), name: Type.String() },
    strict,
);
export type TerritoryObergebietReceipt = Static<typeof TerritoryObergebietReceipt>;

/** ↺ für „Entfernen“: die Operation `territory.retire`, die zurückgenommen wird. */
export const TerritoryRestoreBody = Type.Object({ operationId: OperationId, reverts: PublicId() }, strict);
export type TerritoryRestoreBody = Static<typeof TerritoryRestoreBody>;

/**
 * „Neue Fläche“ für Herrschaftsgebiete (WI-0209 C3; EDIT-0003 T47 und §6 „Neue Fläche“, Fragen 1 bis 4; Kopf
 * `project-control/discovery/wi-0209-c3-neue-flaeche-schnittstelle-2026-10-18.md`), gezeichnet über den gemeinsamen Ablauf
 * `apps/web/src/map/geometrie/neue-flaeche.ts`.
 *
 * - **Neues Gebiet** und **Untergebiet** (`territory.create`, `POST /api/editor/territories`): das Gebiet samt seiner ersten Fläche in
 *   EINER Operation, als eigenes Gebiet (`source_system = 'avesmaps3d'`). `parent` ist das Obergebiet (ohne: Wurzel); der Editor nimmt
 *   das Gebiet, das die Karte im aktuellen Band an der ersten Ecke zeigt, und nennt es vorher in der Leiste (Frage 2); umgehängt wird
 *   danach im Fenster (D1). **Name** wie Legacy (`avesmapsPoliticalUniqueName`): „Neues Herrschaftsgebiet“, besetzt „… (2)“, „… (3)“;
 *   er bleibt ein Befund (D6), bis jemand umbenennt (Frage 3). **Farbe:** die Variante des Obergebiets, die der Editor rechnet (D4,
 *   `farbVariante`), ohne Obergebiet Legacys Grau. **Deckkraft** die des Obergebiets, ohne Legacys 0,33. **Zoomspanne:** die Vorgabe
 *   nach Tiefe (`territoryDefaultZoomRange`, T23 Frage 7), am Server aus der Kette gerechnet. Kein Ausschneiden aus dem Obergebiet; eine
 *   Überlappung ist ein Befund (T23 Frage 8).
 * - **Grenze zeichnen** (`territory_area.create`, `POST /api/editor/territories/:id/areas`): eine Fläche an einem Gebiet ohne eigene
 *   Fläche im Anzeigejahr, auch an einem mit abgeleiteter Grenze (◐, ●; Legacys Regel N2, Frage 4), gegen die Revision des Gebiets; hält
 *   ein anderer es, 409 `object_locked`. Hat es schon eine eigene Fläche, 400 mit Satz („Grenzen bearbeiten“ ist dafür der Weg).
 * - **Beide:** der Ring eckig wie gezeichnet, offen (die erste Ecke nicht wiederholt), mindestens drei Ecken, jede in der Karte; beide
 *   Rechte (`edit_map_objects`, `edit_map_geometry`), `MAP_EDITING`, Zug 503. Eine ungültige Form (Schleife) ist ein Befund (D6),
 *   kein Fehler, wie bei `territory.update`. Danach `territory_derive` (B3).
 * - **Ziele** (`GET …/targets?x0=&y0=&x1=&y1=`, Recht `edit_map_geometry`): Ecken und Kanten der Gebietsflächen im Kasten, die im
 *   Anzeigejahr gelten. Ist eine Seite größer als `TERRITORY_TARGETS_MAX_SIDE`, kürzt der Editor auf den Kasten um die letzte Ecke (wie
 *   die Wege); höchstens `TERRITORY_TARGETS_MAX` Ecken und ebenso viele Kanten, `truncated` sagt, ob mehr da wäre.
 */
export const EDITOR_TERRITORY_TARGETS_URL = `${EDITOR_TERRITORIES_URL}/targets`;
export const editorTerritoryTargetsUrl = (kasten: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}): string => {
    const zahl = (wert: number): string => String(Math.round(wert * 1000) / 1000);
    return `${EDITOR_TERRITORY_TARGETS_URL}?x0=${zahl(kasten.x0)}&y0=${zahl(kasten.y0)}&x1=${zahl(kasten.x1)}&y1=${zahl(kasten.y1)}`;
};
export const editorTerritoryAreasUrl = (id: string): string => `${EDITOR_TERRITORIES_URL}/${id}/areas`;

/** Die größte Seite des Kastens der Ziele in Karteneinheiten, wie bei den Wegen (`PATH_TARGETS_MAX_SIDE`). */
export const TERRITORY_TARGETS_MAX_SIDE = 160;
/** So viele Ecken und so viele Kanten trägt eine Antwort höchstens. */
export const TERRITORY_TARGETS_MAX = 20000;
/** So viele Ecken hat ein neu gezeichneter Ring höchstens. */
export const TERRITORY_RING_MAX = 2000;

export const TerritoryTargetsQuery = Type.Object(
    { x0: Type.Number(), y0: Type.Number(), x1: Type.Number(), y1: Type.Number() },
    strict,
);
export type TerritoryTargetsQuery = Static<typeof TerritoryTargetsQuery>;

export const EditorTerritoryTargetCorner = Type.Object(
    { areaId: PublicId(), name: Type.String(), x: Type.Number(), y: Type.Number() },
    strict,
);
export type EditorTerritoryTargetCorner = Static<typeof EditorTerritoryTargetCorner>;

export const EditorTerritoryTargets = Type.Object(
    {
        corners: Type.Array(EditorTerritoryTargetCorner),
        edges: Type.Array(EditorTerritoryFormEdge),
        truncated: Type.Boolean(),
    },
    strict,
);
export type EditorTerritoryTargets = Static<typeof EditorTerritoryTargets>;

const Ring = () => Type.Array(Ecke(), { minItems: 3, maxItems: TERRITORY_RING_MAX });

export const TerritoryCreateBody = Type.Object(
    {
        operationId: OperationId,
        /** Das Obergebiet; ohne wird das neue Gebiet eine Wurzel. */
        parent: Type.Optional(PublicId()),
        /** Die Farbe, die der Editor gerechnet hat (die Variante des Obergebiets). */
        color: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        ring: Ring(),
    },
    strict,
);
export type TerritoryCreateBody = Static<typeof TerritoryCreateBody>;

/** Die Quittung: die gewöhnliche, dazu das neue Gebiet, sein Name und seine erste Fläche. */
export const TerritoryCreateReceipt = Type.Object(
    {
        ...OperationReceipt.properties,
        publicId: PublicId(),
        name: Type.String(),
        areaId: PublicId(),
        /** Ab welchem Band die Karte das Gebiet zeigt (Vorgabe nach Tiefe): Darunter steht es auch nach der Ableitung nicht da. */
        minZoom: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type TerritoryCreateReceipt = Static<typeof TerritoryCreateReceipt>;

export const TerritoryAreaCreateBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 1 }), ring: Ring() },
    strict,
);
export type TerritoryAreaCreateBody = Static<typeof TerritoryAreaCreateBody>;

/** Die Quittung: die gewöhnliche, dazu das Gebiet (`publicId`, `name`) und seine neue Fläche. */
export const TerritoryAreaCreateReceipt = TerritoryCreateReceipt;
export type TerritoryAreaCreateReceipt = Static<typeof TerritoryAreaCreateReceipt>;

/**
 * „Prüfen“ im Gebietseditor (WI-0209 D6; EDIT-0005 §9 D6, §7 D6; Muster Ortseditor E20): Befunde zu allen Gebieten der Karte, **nie eine
 * Sperre** (`AGENTS.md` „Blockierende Prüfungen im Betrieb“). Je Befund das Gebiet und, wo es eines gibt, die Fläche, das andere Gebiet,
 * die Bänder oder der Ort:
 *
 * - `n2`: Die Ableitung zeigt eine eigene Fläche in diesen Bändern anders als die Regel (Nachweis N2); nach einer Änderung, bis der
 *   Auftrag `territory_derive` gelaufen ist, erwartet.
 * - `luecke`: In diesen Bändern zeigt eine eigene Fläche nichts (keine Spanne der Kette enthält sie, oder ihr eigenes Band).
 * - `ueberlappung`: Die Form überlappt die eines nicht verwandten Gebiets im obersten Band (über 0,001 E², `size`); kein Ausschneiden
 *   (T23 Frage 8).
 * - `platzhalter`: Legacys Name beim Anlegen, „Neues Herrschaftsgebiet (n)“.
 * - `ungueltig`: Die Fläche ist geometrisch ungültig (Schleife, Loch außerhalb); die Ableitung repariert sie beim Lesen.
 * - `verweis`: Hauptstadt oder Sitz zeigt auf einen Ort, den es nicht (mehr) gibt (`field`).
 * - `hauptstadt`: Die Hauptstadt liegt in keiner Form ihres Gebiets.
 *
 * Ähnliche Farben von Geschwistern sind gewollt und kein Befund (H2). Recht `use_editor_menu`.
 */
export const EDITOR_TERRITORY_FINDINGS_URL = `${EDITOR_TERRITORIES_URL}/findings`;

/**
 * Die Folgen von „Umhängen“ vorher (WI-0209 D1; EDIT-0003 R13; EDIT-0005 §7 D1): Je Band, unter welchem Gebiet die Karte die Flächen
 * des Teilbaums danach zeigt statt vorher, mit derselben Regel wie N2 (`territory-display-rule.ts`, Spannen bis 8). Gleiche Wechsel in
 * mehreren Bändern stehen in einer Zeile. `kreis`: Das neue Obergebiet ist das Gebiet selbst oder eines seiner Untergebiete (der Server
 * schreibt das nie). Nur lesend, Recht `use_editor_menu`.
 */
export const editorTerritoryParentConsequencesUrl = (id: string, parent: string): string =>
    `${EDITOR_TERRITORIES_URL}/${id}/reparent?parent=${encodeURIComponent(parent)}`;

export const EditorTerritoryParentChange = Type.Object(
    {
        bands: Type.Array(Type.Integer({ minimum: 0, maximum: 8 }), { minItems: 1 }),
        /** Vorher und nachher das Gebiet, unter dem die Karte die Flächen zeigt; fehlt: dort zeigt sie sie nicht. */
        from: Type.Optional(EditorTerritoryRef),
        to: Type.Optional(EditorTerritoryRef),
        areas: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type EditorTerritoryParentChange = Static<typeof EditorTerritoryParentChange>;

export const EditorTerritoryParentConsequences = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        from: Type.Optional(EditorTerritoryRef),
        to: Type.Optional(EditorTerritoryRef),
        kreis: Type.Boolean(),
        /** Wie viele Untergebiete mit umziehen. */
        descendants: Type.Integer({ minimum: 0 }),
        changes: Type.Array(EditorTerritoryParentChange),
    },
    strict,
);
export type EditorTerritoryParentConsequences = Static<typeof EditorTerritoryParentConsequences>;

export const EDITOR_TERRITORY_FINDING_KINDS = [
    "n2",
    "luecke",
    "ueberlappung",
    "platzhalter",
    "ungueltig",
    "verweis",
    "hauptstadt",
] as const;
export type EditorTerritoryFindingKind = (typeof EDITOR_TERRITORY_FINDING_KINDS)[number];

export const EditorTerritoryFinding = Type.Object(
    {
        territory: PublicId(),
        kind: Type.Union(EDITOR_TERRITORY_FINDING_KINDS.map((k) => Type.Literal(k))),
        area: Type.Optional(PublicId()),
        bands: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 8 }))),
        other: Type.Optional(EditorTerritoryRef),
        size: Type.Optional(Type.Number({ minimum: 0 })),
        field: Type.Optional(Type.Union([Type.Literal("capital"), Type.Literal("seat")])),
        place: Type.Optional(PublicId()),
    },
    strict,
);
export type EditorTerritoryFinding = Static<typeof EditorTerritoryFinding>;

export const EditorTerritoryFindings = Type.Object(
    {
        yearBf: Type.Integer(),
        /** Die Revision der Ableitung, gegen die N2 und die Überlappungen gerechnet sind; fehlt ohne Ableitung. */
        derivedRevision: Type.Optional(Type.String()),
        findings: Type.Array(EditorTerritoryFinding),
    },
    strict,
);
export type EditorTerritoryFindings = Static<typeof EditorTerritoryFindings>;

/**
 * Die Vorgabe nach Tiefe (T23 Frage 7: „Vorgabe nach Tiefe aus Legacys WikiSync-Tafel, die unterste Ebene reicht bis 8“): Legacys
 * `defaultWikiSyncTerritoryZoomRange` (`js/territory/territory-drag-assignment.js` 45–72, Mirror 5ff58118), Legacys 6 als 8
 * (`upperPoliticalBandFromLegacy`, WI-0188). `laenge` ist die Länge der Kette von der Wurzel bis zum tiefsten Gebiet darunter,
 * `stufe` die Stelle des Gebiets darin (0 die Wurzel). Legacy kennt drei leicht verschiedene Tafeln; die Daten folgen dieser.
 */
export function territoryDefaultZoomRange(laenge: number, stufe: number): { min: number; max: number } {
    const kette = Math.max(1, laenge);
    const tafel: Record<number, readonly (readonly [number, number])[]> = {
        1: [[0, 6]],
        2: [
            [0, 1],
            [2, 6],
        ],
        3: [
            [0, 1],
            [2, 2],
            [3, 6],
        ],
        4: [
            [0, 1],
            [2, 2],
            [3, 3],
            [4, 6],
        ],
        5: [
            [0, 1],
            [2, 2],
            [3, 3],
            [4, 4],
            [5, 6],
        ],
    };
    const lang: readonly (readonly [number, number])[] = [
        [0, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
    ];
    const zeile = tafel[kette];
    const [min, max] =
        zeile !== undefined ? zeile[Math.min(Math.max(0, stufe), kette - 1)]! : (lang[Math.max(0, stufe)] ?? [6, 6]);
    return { min, max: upperPoliticalBandFromLegacy(max) };
}

/** Legacys Kreis über die Untergebiete, rekursiv; `kinder` liefert die aktiven Kinder je Gebiet, `eigen` die eigene Fläche. */
export function editorTerritoryCircles(
    ids: readonly string[],
    kinder: (id: string) => readonly string[],
    eigen: (id: string) => boolean,
): Map<string, EditorTerritoryCircle> {
    const stand = new Map<string, { kreis: EditorTerritoryCircle; ganz: boolean; irgend: boolean }>();
    const rechne = (id: string): { kreis: EditorTerritoryCircle; ganz: boolean; irgend: boolean } => {
        const fertig = stand.get(id);
        if (fertig) return fertig;
        // Ein Zyklus im Baum endet hier „leer“, statt endlos zu laufen.
        stand.set(id, { kreis: "leer", ganz: false, irgend: false });
        const selbst = eigen(id);
        const ks = kinder(id).map(rechne);
        let r: { kreis: EditorTerritoryCircle; ganz: boolean; irgend: boolean };
        if (!ks.length) r = { kreis: selbst ? "voll" : "leer", ganz: selbst, irgend: selbst };
        else {
            const irgendKind = ks.some((k) => k.irgend);
            const alleGanz = ks.every((k) => k.ganz);
            if (selbst && alleGanz) r = { kreis: "voll", ganz: true, irgend: true };
            else if (selbst) r = { kreis: "halb-rechts", ganz: false, irgend: true };
            else if (irgendKind && alleGanz) r = { kreis: "voll", ganz: true, irgend: true };
            else if (irgendKind) r = { kreis: "halb", ganz: false, irgend: true };
            else r = { kreis: "leer", ganz: false, irgend: false };
        }
        stand.set(id, r);
        return r;
    };
    return new Map(ids.map((id) => [id, rechne(id).kreis]));
}
