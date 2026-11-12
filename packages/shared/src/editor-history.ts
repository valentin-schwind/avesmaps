import { Type, type Static } from "@sinclair/typebox";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Verlauf und „Änderungen“ (WI-0128 E17; EDIT-0001 §6.2, §7.1 E17; WI-0126 §5.8): was an der Karte geschah, wann, durch wen.
 *
 *     GET /api/editor/places/:id/history   Verlauf eines Orts, neueste zuerst          use_editor_menu
 *     GET /api/editor/powerlines/:id/history   Verlauf einer Kraftlinie (alle ihre Abschnitte)   use_editor_menu
 *     GET /api/editor/changes              alle Operationen der Domäne (Meine · Alle, Suche, Filter)   use_editor_menu
 *     GET /api/editor/changes/:operationId   eine Operation mit Vorher/Nachher-Nutzlast (Geometrie, Netz)     use_editor_menu
 *
 * - **Ein Eintrag ist eine Operation**, nicht ein Feld (WI-0126 §5.8): Zeit, wer (Person mit Anzeigename; ein Agent nur mit Verweis auf
 *   die Freigabe des Betreibers; System für Import und Testwelt), Quelle, Zusammenfassung, und je Gegenstand jedes Feld alt → neu
 *   samt Revision vorher und nachher. Wege, die eine Operation mitnahm, stehen als eigene Gegenstände darin.
 * - **Seitenweise** über die Reihenfolge `seq` (der Cursor `before` ist die kleinste gelesene `seq`): kein Deckel je Person wie bei
 *   Legacy (200 Zeilen), nichts geht verloren.
 * - **Zurücknehmen** (↺) ist eine neue Operation mit der Quelle `restore` (Feld \`reverts\` an \`place.update\` und \`place.move\`):
 *   nichts wird gelöscht.
 * - **Zustand, Rücknahme-Bezug, Arbeitsserien, Filter, Detail** (WI-0265 B2a; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-
 *   fachvertrag.md` A, B, C.4, E.2): additiv. Jeder Eintrag trägt `status` (aus der Link-Tafel `map_operation_revert_link` und der Quelle abgeleitet,
 *   nie gespeichert), `revertedBy` (die Rücknahme, die ihn aufhob und selbst noch gilt), bei einer Rücknahme `reverts[]` und, wenn er zu einer
 *   Arbeitsserie gehört (zur Lesezeit berechnet, nichts gespeichert), `series`. Die Seite trägt dazu `series[]`: die Serien mit ALLEN ihren Mitgliedern.
 *   `status` und die übrigen neuen Felder sind im Typ optional, damit vorhandene Aufrufer und Prüfkörper weiter übersetzen; der Server setzt sie immer.
 */

export const editorPlaceHistoryUrl = (publicId: string): string => `/api/editor/places/${publicId}/history`;
export const EDITOR_CHANGES_URL = "/api/editor/changes";
/** Eine Operation mit ihrer vollen Nutzlast (Vorher/Nachher samt Geometrie), lazy: die Liste trägt sie nicht. */
export const editorChangeUrl = (operationId: string): string => `${EDITOR_CHANGES_URL}/${operationId}`;

/** So viele Operationen kommen höchstens auf einmal. */
export const MAP_HISTORY_PAGE = 50;

/** Eine Liste von Feldern für `qFelder`: `hidden,name`, höchstens 60. */
export const MAP_CHANGES_FELDER = /^[A-Za-z_]+(,[A-Za-z_]+){0,59}$/u;

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));

// `wikisync`: eine Übernahme oder Rücknahme des WikiSync (WI-0253 D-1, Migration 0225); ihr ↺ ist die Rücknahme des WikiSync, kein Handgriff der Editoren.
export const MAP_HISTORY_SOURCES = ["editor", "import", "restore", "testwelt_reset", "wikisync"] as const;
export type MapHistorySource = (typeof MAP_HISTORY_SOURCES)[number];

export const MAP_HISTORY_ACTOR_KINDS = ["person", "agent", "cli", "system"] as const;

/**
 * Die Arten eines Gegenstands (`MapHistoryObject.kind`); dieselbe Liste benennt die Filter `kind` und `object` der „Änderungen“ und die
 * Gegenstände einer Arbeitsserie.
 */
export const MAP_HISTORY_OBJECT_KINDS = [
    "place",
    "path",
    "powerline",
    "nodix",
    "landscape",
    "area",
    "label",
    "territory",
    "territory_area",
    "peak",
    // Die Inhaltsredaktion (WI-0254): eine Katalogquelle und ein Werk der Spielliteratur.
    "source",
    "work",
    "lore",
    "corpus",
    // Ein Sprachartikel des WikiSync (WI-0261 S3): Seinen Wiki-Stand schreibt nur die Übernahme.
    "sprache_artikel",
    // Ein Landmarken-Artikel des WikiSync (WI-0271 L7): Seinen Wiki-Stand schreibt die Übernahme, „nicht auf die Karte“ die Redaktion.
    "landmarke_artikel",
    // Ein Wiki-Eintrag ohne Fläche (WI-0284): Seine Felder schreibt nur die Übernahme.
    "region_artikel",
    // Ein Orts- oder Bauwerk-Artikel ohne Ort (WI-0295): Seine Felder schreibt nur die Übernahme.
    "ort_artikel",
    // Eine Sprache und eine ihrer Teilflächen (WI-0261 S5d, Spracheditor, Migration 0258).
    "sprache",
    "sprache_flaeche",
] as const;
export type MapHistoryObjectKind = (typeof MAP_HISTORY_OBJECT_KINDS)[number];

/**
 * Der Zustand einer Operation in der Liste (Fachvertrag A.3, Vertragsnamen des Katalogs), abgeleitet und nie gespeichert:
 *
 * - `ruecknehmbar`: nicht durch die Quelle ausgeschlossen und keine geltende Rücknahme. 🔴 Eine Anzeige, keine Zusage: Ob die Rücknahme geht, sagt
 *   erst die Vorprüfung (Konflikt, Sperre, Recht, Art der Aktion); `konflikt` und `in_pruefung` gibt es darum nicht in der Liste.
 * - `bereits_zurueckgenommen`: es gibt einen Eintrag der Link-Tafel auf diese Operation, dessen Rücknahme selbst nicht zurückgenommen wurde.
 * - `nicht_ruecknehmbar`: Import, WikiSync und Zurücksetzen der Testwelt haben eigene Wege (`statusReason: "quelle"`); eine Art von Operation, die keine Familie zurücknimmt
 *   (Anlegen, Weg teilen, Gebiet-Form, die Inhalte-Stammdaten …), trägt `statusReason: "art"` (WI-0265 B6f; der Katalog steht in `apps/server/src/editor/ruecknahme-arten.ts`).
 *   Weitere Gründe (Bereich, Recht, Archiv) folgen, wenn es sie gibt.
 */
export const MAP_HISTORY_STATUS = ["ruecknehmbar", "bereits_zurueckgenommen", "nicht_ruecknehmbar"] as const;
export type MapHistoryStatus = (typeof MAP_HISTORY_STATUS)[number];
export const MAP_HISTORY_STATUS_GRUENDE = ["quelle", "art"] as const;

export const MapHistoryActor = Type.Object(
    {
        kind: Union(MAP_HISTORY_ACTOR_KINDS),
        /**
         * Die stabile, pseudonyme Kennung der Person (`map_operation.actor_person_id`) für Filter und Sprung; Anzeigenamen wechseln, sie nicht
         * (Fachvertrag F.3). Nur bei einer Person, und nur in Antworten, die `use_editor_menu` voraussetzen (alle Routen der Änderungen und Verläufe).
         */
        id: Type.Optional(Type.String()),
        /** Anzeigename der Person, Bezeichnung des Agenten oder der Kommandozeile. */
        name: Type.Optional(Type.String()),
        /** Die Person der Sitzung selbst („Meine“). */
        self: Type.Optional(Type.Literal(true)),
        /** Bei einem Agenten: der Verweis auf die Freigabe des Betreibers (Map Mutation Guard). */
        approvalRef: Type.Optional(Type.String()),
    },
    strict,
);
export type MapHistoryActor = Static<typeof MapHistoryActor>;

/** Ein Feld vorher und nachher, wie das Fachprotokoll es führt (Positivliste der Schreibnaht). */
export const MapHistoryChange = Type.Object(
    {
        before: Type.Optional(Type.Unknown()),
        after: Type.Optional(Type.Unknown()),
        /**
         * Nur in der Liste der „Änderungen“ (`GET /api/editor/changes`): Der Wert ist Geometrie, ein Netz oder sonst groß und steht erst im Detail
         * (`GET /api/editor/changes/:operationId`); `before` und `after` fehlen dann. Der Feldname bleibt, die Liste sagt also weiter, WAS sich änderte.
         */
        omitted: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type MapHistoryChange = Static<typeof MapHistoryChange>;

/**
 * Ein Gegenstand einer Operation: ein Ort, ein Weg, ein Abschnitt einer Kraftlinie, ein Kraftlinienpunkt, eine Fläche der Derographie
 * (`landscape`), eine ihrer Teilflächen (`area`) oder Beschriftungen (`label`; WI-0178 D3), ein Herrschaftsgebiet (`territory`) oder eine
 * seiner Flächen (`territory_area`; WI-0209 D5), was ihm geschah, und seine Felder.
 */
export const MapHistoryObject = Type.Object(
    {
        kind: Union(MAP_HISTORY_OBJECT_KINDS),
        id: Type.String(),
        /** Der heutige Name; fehlt, wenn es den Gegenstand nicht mehr gibt. */
        name: Type.Optional(Type.String()),
        /** Was ihm geschah, etwa `place.moved`, `path.endpoint_moved`. */
        action: Type.String(),
        revisionBefore: Type.Union([Type.Integer(), Type.Null()]),
        revisionAfter: Type.Union([Type.Integer(), Type.Null()]),
        changes: Type.Record(Type.String(), MapHistoryChange),
        /**
         * Nur an einer Teilfläche (`area`) und einer Beschriftung (`label`): die Landschaft, zu der sie gehört (WI-0265 B5d). Der Eintrag nennt sonst nur die Teilfläche; die Oberfläche
         * braucht die Landschaft als Adresse der Rücknahme (`restore-series`) auch für eine einzelne Änderung ohne Arbeitsserie (`series.scope` gibt es erst ab zwei Mitgliedern).
         * Im Typ optional; der Server setzt es, wo das Protokoll die Landschaft kennt.
         */
        landscape: Type.Optional(Type.Object({ id: Type.String(), name: Type.Optional(Type.String()) }, strict)),
        /**
         * Nur an einer Fläche eines Herrschaftsgebiets (`territory_area`): das Gebiet, zu dem sie gehört (WI-0265 B6b). Entfernen von der Karte und Vereinigen schreiben nur Flächen ins Protokoll; die
         * Oberfläche braucht das Gebiet als Adresse der Rücknahme (`restore-series`). Im Typ optional; der Server setzt es, wo das Protokoll das Gebiet kennt.
         */
        territory: Type.Optional(Type.Object({ id: Type.String(), name: Type.Optional(Type.String()) }, strict)),
        /**
         * Nur an einer Teilfläche einer Sprache (`sprache_flaeche`): die Sprache, zu der sie gehört (WI-0265 B6e). Eine Operation, die nur Teilflächen ändert (stilllegen, umformen, die
         * Werkzeuge), schreibt keine Zeile an der Sprache selbst; die Oberfläche braucht die Sprache als Adresse der Rücknahme (`restore-series`). Im Typ optional; der Server setzt es, wo das
         * Protokoll die Sprache kennt.
         */
        sprache: Type.Optional(Type.Object({ id: Type.String(), name: Type.Optional(Type.String()) }, strict)),
        /**
         * Nur im Detail (`GET /api/editor/changes/:operationId`): die Felder, deren frühere Form das Protokoll NICHT vollständig führt (der Eintrag
         * kennt nur `after`, oder nur die bewegten Punkte einer mitgezogenen Fläche, `*.carried`). Die Oberfläche zeigt dort keine Kontur als
         * „Vorher“ und sagt es; sie rekonstruiert nie etwas aus dem heutigen Stand (Fachvertrag Gate 4).
         */
        formFehlt: Type.Optional(Type.Array(Type.String())),
    },
    strict,
);
export type MapHistoryObject = Static<typeof MapHistoryObject>;

/** Die Rücknahme, die eine Operation aufhob (und selbst nicht zurückgenommen wurde): Operation, Zeit, Person (Fachvertrag A.2). */
export const MapHistoryRevertedBy = Type.Object(
    {
        operationId: Type.String(),
        at: Type.String({ format: "date-time" }),
        actor: MapHistoryActor,
        /** Der Grund dieser Rücknahme (Gate 2: bei der Rücknahme einer fremden Person Pflicht); fehlt, wenn keiner genannt wurde. */
        reason: Type.Optional(Type.String()),
    },
    strict,
);
export type MapHistoryRevertedBy = Static<typeof MapHistoryRevertedBy>;

/** Die Stelle eines Eintrags in seiner Arbeitsserie (Fachvertrag A.2): `id` ist die `operationId` des ältesten Mitglieds, `position` zählt von 1 an, das älteste zuerst. */
export const MapHistoryEntrySeries = Type.Object(
    {
        id: Type.String(),
        position: Type.Integer({ minimum: 1 }),
        size: Type.Integer({ minimum: 2 }),
    },
    strict,
);
export type MapHistoryEntrySeries = Static<typeof MapHistoryEntrySeries>;

/**
 * Wofür eine Operation in einer kurzen Zeile steht (WI-0276, Editorenliste): ihr erster Gegenstand mit Namen. Eine Teilfläche steht für ihr Ganzes
 * (Teilfläche und Beschriftung für die Derographie-Fläche, Gebietsfläche für das Herrschaftsgebiet, Sprachfläche für die Sprache): So heißt sie, und nur das Ganze lässt sich anfliegen.
 */
export function hauptGegenstand(
    objects: readonly MapHistoryObject[],
): { readonly kind: MapHistoryObjectKind; readonly id: string; readonly name?: string | undefined } | undefined {
    const ganze = objects.map((gegenstand) => {
        if (gegenstand.landscape !== undefined) return { kind: "landscape" as const, ...gegenstand.landscape };
        if (gegenstand.territory !== undefined) return { kind: "territory" as const, ...gegenstand.territory };
        if (gegenstand.sprache !== undefined) return { kind: "sprache" as const, ...gegenstand.sprache };
        return { kind: gegenstand.kind, id: gegenstand.id, name: gegenstand.name };
    });
    return ganze.find((gegenstand) => gegenstand.name !== undefined) ?? ganze[0];
}

export const MapHistoryEntry = Type.Object(
    {
        operationId: Type.String(),
        seq: Type.Integer(),
        at: Type.String({ format: "date-time" }),
        /** Die benannte Operation, etwa `place.move`. */
        operation: Type.String(),
        source: Union(MAP_HISTORY_SOURCES),
        summary: Type.Optional(Type.String()),
        actor: MapHistoryActor,
        objects: Type.Array(MapHistoryObject),
        /** Der Zustand (`MAP_HISTORY_STATUS`); der Server setzt ihn immer, der Typ nennt ihn optional. */
        status: Type.Optional(Union(MAP_HISTORY_STATUS)),
        /** Bei `nicht_ruecknehmbar`: warum (`quelle`: Import, WikiSync, Testwelt; `art`: eine Art Änderung, die keine Familie zurücknimmt). */
        statusReason: Type.Optional(Union(MAP_HISTORY_STATUS_GRUENDE)),
        /** Die geltende Rücknahme dieser Operation; fehlt, wenn es keine gibt. Bei `source = wikisync` aus dem Protokoll des WikiSync, nie aus der Link-Tafel. */
        revertedBy: Type.Optional(MapHistoryRevertedBy),
        /**
         * Bei einer Rücknahme: die Operationen, die sie zurücknimmt, in der Reihenfolge der Anfrage (Link-Tafel). Fehlt an einer Rücknahme (`source = restore`) das
         * Feld, ist es eine ältere Etikett-Rücknahme ohne Bezug zum Original; die Oberfläche nennt sie so („Rücknahme ohne Bezug zum Original“), kein Backfill nach Vermutung.
         */
        reverts: Type.Optional(Type.Array(Type.String())),
        /**
         * Nur an einer Rücknahme (`source = restore`): ihr Grund (WI-0265 B3/B4, Gate 2), aus `restoreReason` des Fachprotokolls gelesen; fehlt, wenn keiner genannt wurde
         * (eigene Änderungen und ältere Rücknahmen). Das Original nennt ihn als `revertedBy.reason`.
         */
        reason: Type.Optional(Type.String()),
        /** Nur an einem Mitglied einer Arbeitsserie. */
        series: Type.Optional(MapHistoryEntrySeries),
        /**
         * Nur an einer Operation, die aus einem Community-Vorgang geöffnet wurde (WI-0268 C7, Migration 0272 `map_operation.community_vorgang`; Anzeige „aus COM-000123“ in „Änderungen“,
         * WI-0265 B6g1): die Nummer des Vorgangs in der Form `COM-000123` (`comNummer`). Fehlt bei allen anderen; der Server lässt das Feld bei NULL weg.
         */
        communityVorgang: Type.Optional(Type.String({ pattern: "^COM-[0-9]{6,}$" })),
    },
    strict,
);
export type MapHistoryEntry = Static<typeof MapHistoryEntry>;

/**
 * Eine Arbeitsserie (Fachvertrag B): die Operationen EINER Person am selben Gegenstand, ohne fremde Operation daran dazwischen und mit höchstens 30 Minuten
 * Pause von Mitglied zu Mitglied; zur Lesezeit berechnet, nie gespeichert. `members` sind ALLE Mitglieder (älteste zuerst), auch die, die diese Antwort
 * nicht als Eintrag trägt; `delivered` zählt die Einträge dieser Antwort. `membersHash` ist die Prüfsumme über die sortierten Kennungen, die eine Rücknahme
 * mitschickt (409 `series_changed`, wenn die Serie wuchs). Eine Rücknahme betrifft immer die offene Mitgliederliste, nie die Treffer eines Filters.
 */
export const MapHistorySeries = Type.Object(
    {
        id: Type.String(),
        size: Type.Integer({ minimum: 2 }),
        delivered: Type.Integer({ minimum: 0 }),
        members: Type.Array(Type.String()),
        membersHash: Type.String(),
        /** Der Gegenstand der Serie (sein Name, wenn ein Eintrag dieser Antwort ihn nennt). */
        scope: Type.Object(
            { kind: Union(MAP_HISTORY_OBJECT_KINDS), id: Type.String(), name: Type.Optional(Type.String()) },
            strict,
        ),
        /** „Setzt sich fort“: Mitglieder, die zum Filter passen, liegen außerhalb dieser Seite, weil das Nachladen der Serie an seiner Obergrenze endete. */
        continues: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type MapHistorySeries = Static<typeof MapHistorySeries>;

export const MapHistoryPage = Type.Object(
    {
        /**
         * Neueste zuerst nach `seq`. Die Seite ist ein zusammenhängender Bereich der Operationen (die Treffer eines Filters): Eine Arbeitsserie, die über
         * ihre Grenze reicht, wird bis zu ihrem ältesten Mitglied nachgeladen (Fachvertrag B.4); die Seite kann darum länger sein als `limit`.
         */
        entries: Type.Array(MapHistoryEntry),
        /** Der Cursor für die nächste (ältere) Seite (die kleinste gelieferte `seq`); fehlt, wenn es keine gibt. */
        next: Type.Optional(Type.Integer()),
        /** Die Arbeitsserien, zu denen Einträge dieser Seite gehören. */
        series: Type.Optional(Type.Array(MapHistorySeries)),
    },
    strict,
);
export type MapHistoryPage = Static<typeof MapHistoryPage>;

export const MapHistoryQuery = Type.Object(
    {
        before: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    strict,
);
export type MapHistoryQuery = Static<typeof MapHistoryQuery>;

/** Der Filter `person`: eine Kennung (`actor.id`) oder `geloescht`. */
export const MAP_CHANGES_PERSON = new RegExp(`^(${UUID_PATTERN.slice(1, -1)}|geloescht)$`, "u");

/** Der Filter `object`: `<art>:<kennung>` mit einer Art aus `MAP_HISTORY_OBJECT_KINDS`. */
export const MAP_CHANGES_OBJEKT = new RegExp(
    `^(${MAP_HISTORY_OBJECT_KINDS.join("|")}):${UUID_PATTERN.slice(1, -1)}$`,
    "u",
);

export const MapChangesQuery = Type.Object(
    {
        before: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        /** Nur die eigenen Operationen („Meine“); ohne alle. */
        mine: Type.Optional(Type.Boolean()),
        /**
         * Freitext (Betreiber 2026-10-11, Entscheidungsprotokoll 3f7acfc8: eine Suche links in jeder Leiste): Teil des Namens eines
         * Gegenstands (heute oder vorher), eines Felds oder der handelnden Person, dazu die Zusammenfassung; ohne Groß und Klein.
         * `%` und `_` sind Zeichen, kein Muster.
         */
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        /**
         * Zur Suche gehörig: die Felder, deren angezeigter Name den Freitext enthält („Verborgen“ für `hidden`), mit Komma getrennt.
         * Die Namen kennt nur die Oberfläche (i18n) und rechnet die Liste aus, wie `qAktionen` im Protokoll. Gilt nur mit `q`.
         */
        qFelder: Type.Optional(Type.String({ pattern: MAP_CHANGES_FELDER.source, maxLength: 1000 })),
        /**
         * Nur die Operationen dieser Person (`actor.id`); `geloescht` ist der Sammelwert für Personen, deren Konto es nicht mehr gibt (Fachvertrag F.3).
         * Mit `mine` zusammen gelten beide.
         */
        person: Type.Optional(Type.String({ pattern: MAP_CHANGES_PERSON.source })),
        /** Zeitraum: `from` einschließlich, `to` ausschließlich; beide mit Zeitzone (`2026-10-31T14:03:00+01:00` oder `…Z`). */
        from: Type.Optional(Type.String({ format: "date-time" })),
        to: Type.Optional(Type.String({ format: "date-time" })),
        /**
         * Die Art: Operationen, deren Protokoll einen Gegenstand dieser Art nennt. Eine Teilfläche und eine Beschriftung tragen ihre Fläche mit,
         * `landscape` findet also auch sie (wie der Verlauf der Fläche); ebenso `territory` und `sprache` ihre Teilflächen.
         */
        kind: Type.Optional(Union(MAP_HISTORY_OBJECT_KINDS)),
        /** Ein einzelner Gegenstand, `<art>:<kennung>` (etwa `place:…`): dieselben Operationen wie sein Verlauf. Ein Weg ist hier ein Abschnitt. */
        object: Type.Optional(Type.String({ pattern: MAP_CHANGES_OBJEKT.source })),
        /** Der Zustand (`MAP_HISTORY_STATUS`); wirkt auf die Treffer, nie auf eine Rücknahme. */
        status: Type.Optional(Union(MAP_HISTORY_STATUS)),
    },
    strict,
);
export type MapChangesQuery = Static<typeof MapChangesQuery>;

/** Die Parameter von `GET /api/editor/changes/:operationId`. */
export const MapChangeParams = Type.Object({ operationId: Type.String({ pattern: UUID_PATTERN }) }, strict);
export type MapChangeParams = Static<typeof MapChangeParams>;

/**
 * Die Lage einer Änderung (`GET /api/editor/changes/:operationId/lage`, WI-0265 B9; Vali 2026-11-01: „bei den änderungensitems immer (wenn möglich) 'Auf Karte anzeigen' machen, sodass die Ansicht hinfliegt, wo die Änderung war“):
 * der HEUTIGE Ort der Gegenstände, die eine Operation betraf, als ein Kasten in Kartenkoordinaten (`aventuria-v1`). Das Fachprotokoll führt Geometrie nur für Änderungen an der Lage selbst; ein Feld, eine Quelle,
 * ein Wiki-Lauf trägt keine. Dann fragt die Oberfläche hier, wo die Gegenstände jetzt liegen.
 *
 * - `grenzen`: `[minX, minY, maxX, maxY]` um alle Gegenstände mit bekannter Lage; `null`, wenn keiner eine hat (ein Werk ohne Orte, ein Ort ohne Lage).
 * - `gegenstaende`: so viele Gegenstände haben eine Lage (zählt Gegenstände, nicht Protokollzeilen: Ein Gebirge mit zehn Teilflächen ist EIN Gegenstand).
 * - `stillgelegt`: davon so viele liegen nicht mehr auf der Karte (stillgelegt oder gelöscht). Sie zählen mit ihrer letzten Lage; die Oberfläche sagt „nicht mehr auf der Karte“.
 * - `mit`: weitere Operationen derselben Anfrage (die Mitglieder einer Arbeitsserie), höchstens `MAP_CHANGES_LAGE_MIT_MAX`; die Lage gilt für alle zusammen.
 */
export const MAP_CHANGES_LAGE_MIT_MAX = 100;
export const MAP_CHANGES_LAGE_MIT = new RegExp(
    `^${UUID_PATTERN.slice(1, -1)}(,${UUID_PATTERN.slice(1, -1)}){0,${String(MAP_CHANGES_LAGE_MIT_MAX - 1)}}$`,
    "u",
);

export const MapChangeLageQuery = Type.Object(
    {
        mit: Type.Optional(
            Type.String({ pattern: MAP_CHANGES_LAGE_MIT.source, maxLength: MAP_CHANGES_LAGE_MIT_MAX * 37 }),
        ),
    },
    strict,
);
export type MapChangeLageQuery = Static<typeof MapChangeLageQuery>;

export const MapChangeLage = Type.Object(
    {
        grenzen: Type.Union([Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]), Type.Null()]),
        gegenstaende: Type.Integer({ minimum: 0 }),
        stillgelegt: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type MapChangeLage = Static<typeof MapChangeLage>;

/** Die Lage einer Operation; mit `mit` zusammen mit weiteren (eine Arbeitsserie). */
export const editorChangeLageUrl = (operationId: string, mit: readonly string[] = []): string =>
    `${editorChangeUrl(operationId)}/lage${mit.length > 0 ? `?mit=${mit.join(",")}` : ""}`;
