import { Type, type Static } from "@sinclair/typebox";
import {
    MAP_HISTORY_OBJECT_KINDS,
    MAP_HISTORY_SOURCES,
    MAP_HISTORY_STATUS,
    MAP_HISTORY_STATUS_GRUENDE,
    MapHistoryActor,
} from "./editor-history.ts";
import { EDITOR_LANDSCAPES_URL } from "./landscape-editor.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { EDITOR_WIKI_BOX_URL, type WikiBoxArt } from "./wiki-box.ts";

/**
 * Rücknahme einer Arbeitsserie und Vorprüfung (WI-0265 B3; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, D, F.1,
 * Gate 2 und 3 abgenommen 2026-10-31). Je Objektfamilie eine Adresse, weil eine Serie nie mehrere Familien mischt (C.1); die erste ist das Gebirge einer Landschaft:
 *
 *     POST /api/editor/landscapes/:id/restore-series/preview   lesend: das Ergebnis der Vorprüfung       use_editor_menu
 *     POST /api/editor/landscapes/:id/restore-series            nimmt die Serie in EINER Operation zurück   edit_map_objects
 *
 * - **Die Mitglieder** nennt der Aufrufer ausdrücklich (`members`, die GANZE Serie wie `series.members` der Liste, eine Einzelrücknahme genau eine Kennung) samt
 *   Prüfsumme (`membersHash`). Der Server weitet nie still aus: Ist die Serie gewachsen, antwortet er `409 series_changed` mit der neuen Liste.
 * - **Rücknahme:** genau EINE neue Operation (Quelle `restore`), die den Wert vor dem ersten Mitglied setzt, verlangt, dass der heutige Stand dem Stand nach dem
 *   letzten entspricht, alles oder nichts schreibt und die abgeleiteten Daten EINMAL anstößt. Antworten wie in C.2:
 *   `200` (`applied`, bei gleicher Kennung und gleichem Inhalt `replayed`), `400 not_revertable`, `400 invalid_members`, `400 reason_required`, `403`,
 *   `409 edit_conflict` (+ Gegenstände), `409 object_locked`, `409 series_changed`, `409 already_reverted`, `423`, `503`.
 * - **Grund** (`reason`, Gate 2): Betrifft die Rücknahme eine andere Person, ist er Pflicht und bleibt im Eintrag der Rücknahme sichtbar; sonst ist er freiwillig.
 */
export const editorLandscapeRestoreSeriesUrl = (id: string): string => `${EDITOR_LANDSCAPES_URL}/${id}/restore-series`;
export const editorLandscapeRestoreSeriesPreviewUrl = (id: string): string =>
    `${EDITOR_LANDSCAPES_URL}/${id}/restore-series/preview`;

/** Dasselbe am Ort (WI-0265 B4): Felder einer Serie, EINE Verschiebung samt Wegenden oder EIN Löschen (auch für mehrere Orte); jedes Mitglied berührt den Ort `:id`. */
export const editorPlaceRestoreSeriesUrl = (id: string): string => `/api/editor/places/${id}/restore-series`;
export const editorPlaceRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/places/${id}/restore-series/preview`;

/** Dasselbe am Weg (WI-0265 B6a): Felder der Straße (auch als Serie), die Kurve oder EIN Wechsel des Stands; `:id` ist ein Abschnitt, den jedes Mitglied berührt. */
export const editorPathRestoreSeriesUrl = (id: string): string => `/api/editor/paths/${id}/restore-series`;
export const editorPathRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/paths/${id}/restore-series/preview`;

/**
 * Dasselbe am Herrschaftsgebiet und an der Kraftlinie (WI-0265 B6b): Felder, Darstellung und Obergebiet des Gebiets (auch einer Operation über mehrere Gebiete: ganz oder gar nicht),
 * Entfernen, „Unter neues Obergebiet“ und Vereinigen als EINE Rücknahme; an der Kraftlinie Felder, Bogen und Enden je Abschnitt, angefügte und herausgenommene Abschnitte und der Stand
 * der Linie. Jedes Mitglied berührt das Gebiet `:id` bzw. einen Abschnitt der Linie `:id` (der Anker darf jeder ihrer Abschnitte sein).
 */
export const editorTerritoryRestoreSeriesUrl = (id: string): string => `/api/editor/territories/${id}/restore-series`;
export const editorTerritoryRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/territories/${id}/restore-series/preview`;
export const editorPowerlineRestoreSeriesUrl = (id: string): string => `/api/editor/powerlines/${id}/restore-series`;
export const editorPowerlineRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/powerlines/${id}/restore-series/preview`;
/** Der Kraftlinienpunkt (Nodix, WI-0265 B8b): Anlegen, Verschieben und Entfernen, auch als Serie; `:id` ist der Punkt, den jedes Mitglied berührt. */
export const editorNodixRestoreSeriesUrl = (id: string): string => `/api/editor/nodices/${id}/restore-series`;
export const editorNodixRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/nodices/${id}/restore-series/preview`;

/**
 * Dasselbe am Gipfel (WI-0265 B6c): Felder, Höhe, Lage und Stilllegen/Wiederherstellen eines Gipfels (auch als Serie); `:id` ist ein Gipfel, den jedes Mitglied berührt. Die Adresse der
 * Landschaft (oben) nimmt dazu alle übrigen Arten der Derographie zurück: Felder, Beschriftungen, Form, Stilllegen und die Werkzeuge an Flächen.
 */
export const editorPeakRestoreSeriesUrl = (id: string): string => `/api/editor/peaks/${id}/restore-series`;
export const editorPeakRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/peaks/${id}/restore-series/preview`;

/**
 * Dasselbe an der Sprache (WI-0265 B6e, Spracheditor): Felder, Wiki-Artikel (samt dem, was einer anderen Sprache dafür genommen wurde), Stilllegen und Zurückholen der Sprache, Form, Stilllegen und
 * Zurückholen ihrer Teilflächen, die Werkzeuge an Teilflächen (Unterflächen, Zerschneiden, Mit anderer Fläche, Kopieren, auch in eine neue Sprache) als EINE Rücknahme. `:id` ist eine Sprache,
 * die jedes Mitglied berührt (eine Teilfläche trägt ihre Sprache mit). Das Anlegen und `sprache.flaeche_aus_landschaft` bleiben `not_revertable`.
 */
export const editorSpracheRestoreSeriesUrl = (id: string): string => `/api/editor/sprachen/${id}/restore-series`;
export const editorSpracheRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/sprachen/${id}/restore-series/preview`;

/**
 * Dasselbe an Quelle, Werk und Korpus des Fensters „Inhalte bearbeiten“ (WI-0265 B6g1): die Felder einer Quelle (ohne ihre Verwendungen an Trägern), die Felder und die Ortsliste eines Werks, die
 * Angaben eines Korpus samt der Wirkung auf seine Quellen, auch als Serie; `:id` ist die Quelle, das Werk beziehungsweise der Korpus, den jedes Mitglied berührt. Das Anlegen bleibt `not_revertable`.
 */
export const editorQuelleRestoreSeriesUrl = (id: string): string => `/api/editor/inhalte/quellen/${id}/restore-series`;
export const editorQuelleRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/inhalte/quellen/${id}/restore-series/preview`;
export const editorWerkRestoreSeriesUrl = (id: string): string => `/api/editor/inhalte/literatur/${id}/restore-series`;
export const editorWerkRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/inhalte/literatur/${id}/restore-series/preview`;
export const editorKorpusRestoreSeriesUrl = (id: string): string => `/api/editor/inhalte/korpora/${id}/restore-series`;
export const editorKorpusRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/inhalte/korpora/${id}/restore-series/preview`;

/**
 * Dasselbe am Vorkommen des Fensters „Inhalte bearbeiten“ (WI-0265 B6g2): die Felder, Ortszeilen, Quellenverknüpfungen und Regeln eines Eintrags (`lore.update`) und die Regeln und Quellen, die „Regeln als
 * Text“ an bestehenden Einträgen anlegte (`lore.rules_text`; EINE Operation über mehrere Einträge hängt an einem von ihnen und nimmt alle zurück), auch als Serie; `:id` ist der Eintrag, den jedes Mitglied
 * berührt. Das Anlegen (`lore.create`, auch ein Eintrag, den „Regeln als Text“ anlegte) bleibt `not_revertable`.
 */
export const editorVorkommenRestoreSeriesUrl = (id: string): string =>
    `/api/editor/inhalte/vorkommen/${id}/restore-series`;
export const editorVorkommenRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/inhalte/vorkommen/${id}/restore-series/preview`;

/**
 * Dasselbe an der Wiki-Box der Karteneditoren (WI-0265 B8d): Zuweisen und Entfernen eines Wiki-Artikels, je Art der Box (`ort`, `weg`, `gebiet`, `region`, `kraftlinie`, `gipfel`); `:id` ist der Träger (beim Weg
 * und bei der Kraftlinie irgendein Abschnitt). Ein Schritt der Box steht als Einzeleintrag da, nie in einer Serie; die Rücknahme stellt den Artikel von vorher samt Herkunft der Zuordnung wieder her.
 */
export const editorWikiBoxRestoreSeriesUrl = (art: WikiBoxArt, id: string): string =>
    `${EDITOR_WIKI_BOX_URL}/${art}/${id}/restore-series`;
export const editorWikiBoxRestoreSeriesPreviewUrl = (art: WikiBoxArt, id: string): string =>
    `${EDITOR_WIKI_BOX_URL}/${art}/${id}/restore-series/preview`;

/**
 * Dasselbe an den Übernahmen des WikiSync (WI-0265 B8d): `:id` ist die Operation der Übernahme (`wikisync.uebernehmen` oder `lore.rules_wikisync`, Quelle `wikisync`). Das ↺ ruft die Rücknahme auf, die der
 * WikiSync selbst hat (`wiki_zuruecknehmen`, `lore.rules_wikisync_undo`; Recht `undo_wikisync_run`, frischer Passkey): Feld für Feld, bei einem Lauf als Auftrag (200 mit `derivedWork`, `reverts` leer), bei den
 * Regelvorschlägen sofort. `members` nennt genau diese Operation. Seit WI-0265 B8e lassen sich auch die Rücknahmen (`wikisync.zuruecknehmen`, `lore.rules_wikisync_undo`) und die Gegenrichtung der Regelvorschläge
 * (`lore.rules_wikisync_redo`) zurücknehmen: die Umkehrung aus dem Protokoll.
 */
export const editorWikiSyncRestoreSeriesUrl = (id: string): string => `/api/editor/wikisync/${id}/restore-series`;
export const editorWikiSyncRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/wikisync/${id}/restore-series/preview`;

/**
 * Dasselbe an den Schritten des WikiSync, die der Editor am Objekt auslöst (WI-0265 B8e): der Sync eines Objekts in der Wiki-Box (`wikisync.objekt_sync`, zurück als Auftrag `wiki_zuruecknehmen`: 200 mit `derivedWork`,
 * `reverts` leer) und die Zuweisung eines Artikels an eine Fläche im Regelfenster (`wikisync.flaeche_zuweisen`, sofort). Recht `edit_map_objects` (die Zuweisung in Production mit frischem Passkey), nicht `undo_wikisync_run`.
 */
export const editorWikiSyncEditRestoreSeriesUrl = (id: string): string =>
    `/api/editor/wikisync-schritt/${id}/restore-series`;
export const editorWikiSyncEditRestoreSeriesPreviewUrl = (id: string): string =>
    `/api/editor/wikisync-schritt/${id}/restore-series/preview`;

/** So viele Mitglieder hat eine Arbeitsserie höchstens (`SERIEN_MAX_MITGLIEDER`, Fachvertrag B.1). */
export const RUECKNAHME_MITGLIEDER_MAX = 100;
/** So lang darf der Grund sein. */
export const RUECKNAHME_GRUND_MAX = 500;

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const Kennung = () => Type.String({ pattern: UUID_PATTERN });
const Mitglieder = () => Type.Array(Kennung(), { minItems: 1, maxItems: RUECKNAHME_MITGLIEDER_MAX });
/** Die Prüfsumme der Liste (`mitgliederHash`: SHA-256, hexadezimal). */
const Pruefsumme = () => Type.String({ pattern: "^[0-9a-f]{64}$" });

/** Die Vorprüfung: lesend, kein Grund, keine Kennung. */
export const RuecknahmeVorschauBody = Type.Object(
    { members: Mitglieder(), membersHash: Type.Optional(Pruefsumme()) },
    strict,
);
export type RuecknahmeVorschauBody = Static<typeof RuecknahmeVorschauBody>;

/** Die Rücknahme: eine Kennung je Benutzeraktion (Doppelklick und Netzretry geben dieselbe Quittung), die Liste samt Prüfsumme, der Grund. */
export const RuecknahmeBody = Type.Object(
    {
        operationId: OperationId,
        members: Mitglieder(),
        membersHash: Pruefsumme(),
        reason: Type.Optional(Type.String({ maxLength: RUECKNAHME_GRUND_MAX })),
    },
    strict,
);
export type RuecknahmeBody = Static<typeof RuecknahmeBody>;

/** Die Quittung der Rücknahme: die der Schreibnaht und dazu die Operationen, die sie zurückgenommen hat (Link-Tafel, in der Reihenfolge der Serie). */
export const RuecknahmeReceipt = Type.Object(
    { ...OperationReceipt.properties, reverts: Type.Array(Kennung()) },
    strict,
);
export type RuecknahmeReceipt = Static<typeof RuecknahmeReceipt>;

export const RUECKNAHME_ERGEBNISSE = [
    "ok",
    "forbidden",
    "object_locked",
    "invalid_members",
    "not_revertable",
    "series_changed",
    "already_reverted",
    "edit_conflict",
] as const;
export type RuecknahmeErgebnis = (typeof RUECKNAHME_ERGEBNISSE)[number];

export const RUECKNAHME_AUSSCHLUSS_GRUENDE = ["quelle", "art", "bereich"] as const;
export const RUECKNAHME_UNGUELTIG = ["unbekannt", "leer", "hash", "keine_serie"] as const;
export const RUECKNAHME_KONFLIKT_ARTEN = ["spaeter", "ueberholt", "revision", "geloescht", "wert"] as const;

/**
 * Was bei einem Konflikt der Art `wert` nicht stimmt, als Schlüssel statt als Satz (WI-0265 B5d): Die Oberfläche baut den Satz aus ihren Sprachtafeln; ein deutscher Satz vom Server
 * erreicht den Menschen nie.
 *
 * - `felder`: die Felder in `RuecknahmeKonflikt.felder` stehen heute anders als nach dem letzten Schritt (beim Netz nennt `netzTeile` die Teile).
 * - `flusshoehe`: eine Flusshöhe ist seit dem ersten Schritt mit ihrem Weg gewandert (Gebirge); weichen zugleich Felder ab, stehen sie in `felder`.
 * - `ort_geloescht`, `ort_nicht_auf_karte`, `ort_lage`: der Ort ist gelöscht, steht nicht mehr auf der Karte oder liegt woanders (`heute`, `erwartet`).
 * - `weg_fehlt`, `weg_anfang`, `weg_ende`: ein mitgezogenes Wegende; der Weg ist weg oder das Ende liegt woanders (`heute`, `erwartet`).
 * - `weg_strasse`: Felder, die für die ganze Straße gelten (Name, Wegart, Kennzeichen, „Name auf der Karte“), lassen sich nicht als Ganzes zurücksetzen: Die Straße bestand vorher nicht
 *   aus denselben Abschnitten oder die Werte davor waren je Abschnitt verschieden (`felder`).
 * - `weg_wert`: der Wert davor lässt sich am Weg nicht wieder setzen (ein leerer Name, eine Wegart ohne Auswahl, ein früherer Stand, den kein Wechsel erreicht; `felder`).
 * - `flaeche_nachbar`: die mitgezogenen Ecken einer Nachbarfläche lassen sich nicht eindeutig zurückbewegen (das Protokoll kennt sie ohne Ring- und Eckenindex): Es liegt nicht mehr jede genau
 *   einmal an ihrer Stelle, oder zwei Ecken zogen auf denselben Punkt (`felder`: `geometry`). Ganz oder gar nicht.
 * - `gipfel_wert`: der Wert davor lässt sich am Gipfel nicht wieder setzen (eine Höhe, die vorher leer war; `felder`).
 * - `sprache_wiki`: ein Wiki-Artikel, der an der Sprache zurückkäme, gehört heute einer anderen Sprache oder steht nicht mehr im Wiki (`felder`: `wiki`). Ganz oder gar nicht.
 * - `ort_kraftlinie`: am Ort endet seither eine Kraftlinie; er lässt sich nicht stilllegen oder von der Karte nehmen (Anlegen, Wiederherstellen und Setzen zurück; WI-0265 B8a).
 * - `ort_auf_karte`: der Ort steht inzwischen wieder auf der Karte, `Von der Karte nehmen` lässt sich nicht zurücknehmen (WI-0265 B8a).
 * - `weg_am_ort`: seit dem Anlegen des Orts endet ein Weg dort (der Weg ist der Gegenstand); der Ort lässt sich nicht stilllegen (WI-0265 B8a).
 * - `zuordnung`: am Ort oder Weg hängt seit dem Anlegen eine Wiki-Zuordnung, die er beim Anlegen nicht hatte (`felder`: `wiki`; WI-0265 B8a).
 * - `inhalt_verwendet`: am angelegten Inhalt (Quelle, Werk, Vorkommen) hängt seither etwas, das die Serie nicht anlegte; `felder` nennt es mit den Namen des Protokolls (`links`: Verwendungen an Trägern,
 *   `places`: Ortszeilen oder Ortsliste, `sources`: Quellenverknüpfungen, `rules`: Regeln, `wiki`: ein Wiki-Schlüssel). Der Inhalt ließe sich nicht stilllegen, ohne es mitzunehmen (WI-0265 B8d).
 * - `wikibox_artikel`: der Wiki-Artikel, der an der Wiki-Box zurückkäme, hat keinen Wiki-Stand mehr (`felder`: `wiki`; WI-0265 B8d).
 * - `wikibox_teilweise`: der Artikel, der zurückkäme, hing nur an einem Teil der Abschnitte einer Straße oder Linie; die Rücknahme gäbe ihn allen (`felder`: `wiki`; WI-0265 B8d).
 */
export const RUECKNAHME_ABWEICHUNGEN = [
    "felder",
    "flusshoehe",
    "ort_geloescht",
    "ort_nicht_auf_karte",
    "ort_lage",
    "weg_fehlt",
    "weg_anfang",
    "weg_ende",
    "weg_strasse",
    "weg_wert",
    "flaeche_nachbar",
    "gipfel_wert",
    "sprache_wiki",
    "ort_kraftlinie",
    "ort_auf_karte",
    "weg_am_ort",
    "zuordnung",
    "inhalt_verwendet",
    "wikibox_artikel",
    "wikibox_teilweise",
] as const;
/** Die Teile des gezeichneten Netzes eines Gebirges, in denen es sich unterscheiden kann. */
export const RUECKNAHME_NETZ_TEILE = ["kaemme", "nebengipfel", "mulden", "flussHoehen", "seeHoehen"] as const;

const Gegenstand = Type.Object(
    {
        kind: Union(MAP_HISTORY_OBJECT_KINDS),
        id: Type.String(),
        name: Type.Optional(Type.String()),
        /** Was ihm geschah (`area.gebirge`). */
        action: Type.String(),
        revisionBefore: Type.Union([Type.Integer(), Type.Null()]),
        revisionAfter: Type.Union([Type.Integer(), Type.Null()]),
        /** Nur die Namen der Felder. */
        felder: Type.Array(Type.String()),
    },
    strict,
);

const Mitglied = Type.Object(
    {
        operationId: Type.String(),
        seq: Type.Integer(),
        at: Type.String({ format: "date-time" }),
        operation: Type.String(),
        source: Union(MAP_HISTORY_SOURCES),
        actor: MapHistoryActor,
        status: Union(MAP_HISTORY_STATUS),
        /** Bei `nicht_ruecknehmbar`: der Grund der Liste (`quelle`, `art`; WI-0265 B6f). */
        statusReason: Type.Optional(Union(MAP_HISTORY_STATUS_GRUENDE)),
        /** Das Mitglied nimmt die Rücknahme mit: nicht schon zurückgenommen und nicht ausgeschlossen. */
        offen: Type.Boolean(),
        ausschluss: Type.Optional(Type.Object({ grund: Union(RUECKNAHME_AUSSCHLUSS_GRUENDE) }, strict)),
        gegenstaende: Type.Array(Gegenstand),
        series: Type.Optional(
            Type.Object({ id: Type.String(), position: Type.Integer(), size: Type.Integer() }, strict),
        ),
        /** Bei einer Einzelrücknahme in einer Serie: der spätere offene Schritt, der dieses Mitglied überholt („überholt durch Schritt 6“). */
        ueberholtDurch: Type.Optional(
            Type.Object({ operationId: Type.String(), seq: Type.Integer(), position: Type.Integer() }, strict),
        ),
    },
    strict,
);

const PruefGegenstand = Type.Object(
    {
        kind: Union(MAP_HISTORY_OBJECT_KINDS),
        id: Type.String(),
        name: Type.Optional(Type.String()),
        erwarteteRevision: Type.Union([Type.Integer(), Type.Null()]),
        istRevision: Type.Union([Type.Integer(), Type.Null()]),
        fehlt: Type.Optional(Type.Literal(true)),
    },
    strict,
);

const Punkt = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);

/** Der Konflikt in der Form von `409 edit_conflict` (C.2): Gegenstand, Revision, wer, wann. */
export const RuecknahmeKonflikt = Type.Object(
    {
        art: Union(RUECKNAHME_KONFLIKT_ARTEN),
        kind: Union(MAP_HISTORY_OBJECT_KINDS),
        id: Type.String(),
        name: Type.Optional(Type.String()),
        currentRevision: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
        erwarteteRevision: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
        changedBy: Type.Optional(MapHistoryActor),
        changedAt: Type.Optional(Type.String({ format: "date-time" })),
        operationId: Type.Optional(Type.String()),
        seq: Type.Optional(Type.Integer()),
        felder: Type.Optional(Type.Array(Type.String())),
        eigene: Type.Optional(Type.Boolean()),
        ueberholtDurch: Type.Optional(Type.Object({ operationId: Type.String(), position: Type.Integer() }, strict)),
        /**
         * Bei `wert`: was abweicht, als Schlüssel (`RUECKNAHME_ABWEICHUNGEN`) mit den Angaben dazu; die Oberfläche schreibt daraus den Satz in der Sprache der Person.
         * Im Typ optional, damit ältere Prüfkörper übersetzen; der Server setzt es an jedem Konflikt der Art `wert`.
         */
        abweichung: Type.Optional(
            Type.Object(
                {
                    was: Union(RUECKNAHME_ABWEICHUNGEN),
                    /** Beim Netz (`felder` nennt `netz`): die Teile, die heute anders stehen. */
                    netzTeile: Type.Optional(Type.Array(Union(RUECKNAHME_NETZ_TEILE))),
                    /** Bei `ort_lage`, `weg_anfang`, `weg_ende`: wo es heute liegt und wo es nach dem letzten Schritt lag. */
                    heute: Type.Optional(Punkt),
                    erwartet: Type.Optional(Punkt),
                },
                strict,
            ),
        ),
        /** Bei `wert`: derselbe Befund als deutscher Satz, nur noch als Hinweis beim Überfahren und für Protokolle; die Oberfläche zeigt `abweichung`. */
        detail: Type.Optional(Type.String()),
    },
    strict,
);
export type RuecknahmeKonflikt = Static<typeof RuecknahmeKonflikt>;

const Sperre = Type.Object(
    {
        kind: Type.String(),
        id: Type.String(),
        person: Type.Object({ id: Type.String(), name: Type.String() }, strict),
        part: Type.String(),
        since: Type.String({ format: "date-time" }),
    },
    strict,
);

/** Die Folgen, die das Bestätigungsblatt VOR dem Schreiben nennt (C.2, F.2): wie viele Gebirge, und was mit dem Gelände geschieht. */
export const RuecknahmeFolgen = Type.Object(
    {
        /** Wie viele Gegenstände (Teilflächen) die Rücknahme schreibt. */
        gegenstaende: Type.Integer({ minimum: 0 }),
        /**
         * `lokal`: das Gelände im Umkreis rechnet nach der Rücknahme neu (EIN Lauf, gesammelt); `veraltet`: das gültige Rezept kennt keine regionale
         * Rückverteilung, es gibt keinen Lauf, das Gelände bleibt veraltet bis zum vollständigen Lauf (nie „aktualisiert“); `keines`: nichts, was ins Gelände eingeht.
         */
        gelaende: Union(["lokal", "veraltet", "keines"] as const),
    },
    strict,
);

/** Das Ergebnis der Vorprüfung (`vorpruefen`, `apps/server/src/editor/ruecknahme.ts`) mit den Folgen. */
export const RuecknahmePruefung = Type.Object(
    {
        ergebnis: Union(RUECKNAHME_ERGEBNISSE),
        membersHash: Type.String(),
        mitglieder: Type.Array(Mitglied),
        offen: Type.Array(Type.String()),
        gegenstaende: Type.Array(PruefGegenstand),
        konflikte: Type.Array(RuecknahmeKonflikt),
        sperren: Type.Array(Sperre),
        fehlendeRechte: Type.Array(Type.String()),
        fremdePersonen: Type.Array(
            Type.Object(
                {
                    kind: Union(["person", "agent", "cli", "system"] as const),
                    id: Type.Optional(Type.String()),
                    name: Type.Optional(Type.String()),
                },
                strict,
            ),
        ),
        reasonRequired: Type.Boolean(),
        neueMitglieder: Type.Optional(Type.Array(Type.String())),
        neuerHash: Type.Optional(Type.String()),
        ungueltig: Type.Optional(Union(RUECKNAHME_UNGUELTIG)),
        folgen: RuecknahmeFolgen,
    },
    strict,
);
export type RuecknahmePruefung = Static<typeof RuecknahmePruefung>;
