import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import { EditorLock } from "./editor-lock.ts";
import {
    LANDSCAPE_BOOLEAN_OPERATIONS,
    LANDSCAPE_CREATE_POINTS_MAX,
    LANDSCAPE_PARTS_OPERATIONS,
    LandscapeBooleanPreview,
} from "./landscape-editor.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Der Spracheditor (WI-0261 S5d; Betreiber 2026-10-30: „intern sind es inhalten -> Auf der Karte -> Sprachen und benötigen auch einen editor“,
 * „flächen dürfen sich überlappen und sind unabhängig voneinander“, „sprachen dürfen also farben haben (eigenschaft im spracheditor)“; E4, O1, O6;
 * Bauvorlage: Probierseite `sprachen-probe.html`, Zustand 5 und 6). Server: `apps/server/src/routes/editor-sprachen.ts`.
 *
 *     GET  /api/editor/sprachen                               die Liste mit den vier Zuständen (Sprachen und freie Wiki-Artikel)      use_editor_menu
 *     GET  /api/editor/sprachen/:id                           eine Sprache: Felder, Wiki-Pillen, Teilflächen, Treffer, Sperre         use_editor_menu
 *     GET  /api/editor/sprachen/:id/flaechen/:flaeche         die Form einer Teilfläche (Ringe ohne Schlusspunkt) für den Modus        use_editor_menu
 *     GET  /api/editor/sprachen/:id/history                   der Verlauf der Sprache (jede Operation, die sie nennt)                  use_editor_menu
 *     GET  /api/editor/sprachen-artikel                       Wiki-Artikel für das Zuordnen, mit ihrem heutigen Besitzer              use_editor_menu
 *     POST /api/editor/sprachen                               sprache.create: Name, Farbe, Legende, Wiki-Artikel                      edit_languages
 *     POST /api/editor/sprachen/aus-landschaft                sprache.flaeche_aus_landschaft: Fläche der Derographie in eine Sprache  edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/update                    sprache.update: Name, Legende, Farbe, Reihenfolge                       edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/wiki                      sprache.wiki: die geordnete Liste der Wiki-Artikel setzen               edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/retire                    sprache.retire: stilllegen, Wiki-Artikel werden frei                   edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/restore                   sprache.restore: zurückholen, freie Artikel kommen mit                  edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/treffer                   die Treffer der Sprache neu rechnen lassen („↻ Jetzt neu berechnen“)    edit_languages
 *     POST /api/editor/sprachen/:id/flaechen                  sprache_flaeche.create: eine gezeichnete Teilfläche                     edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/reshape sprache_flaeche.reshape: die Form ändern                                edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/brush   ein Pinselstrich (malen, radieren), nur gerechnet, nichts geschrieben  edit_languages
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/parts   sprache_flaeche.parts: Unterflächen vereinigen, herauslösen, löschen    edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/split   sprache_flaeche.split: an einer Linie zerschneiden                     edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean-preview  „Mit anderer Fläche“ rechnen, nichts geschrieben               edit_languages
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean sprache_flaeche.boolean: mit der Teilfläche einer anderen Sprache      edit_languages + Sperren
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/copy    sprache_flaeche.copy: als Kopie in eine andere Sprache                 edit_languages + Sperren
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/retire  sprache_flaeche.retire: die Teilfläche stilllegen                       edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/flaechen/:flaeche/restore sprache_flaeche.restore: eine von der Redaktion stillgelegte zurückholen edit_languages + Sperre
 *     POST /api/editor/sprachen/:id/restore-series/preview    die Vorprüfung einer Rücknahme (liest nur; `editor-ruecknahme.ts`)        use_editor_menu
 *     POST /api/editor/sprachen/:id/restore-series            sprache.restore_series: Änderungen der Sprache zurücknehmen (WI-0265)      edit_languages
 *
 * - **Rechte:** lesen ab Reviewer (`use_editor_menu`), schreiben `edit_languages` (ab Admin und über die Sonderrolle Linguist, WI-0279 E17a, Betreiber 2026-11-08; bis dahin
 *   `manage_sources` wie die übrigen Inhalte, O6), auch die Sperre einer Sprache (`editor-locks.ts`), Klasse `map`, Schalter
 *   `MAP_EDITING` (423 `map_locked`, `map_editing_off`); läuft der Zug, 503 `map_import_running`.
 * - 🔴 **Sperre:** Eine Sprache wird als Ganzes gesperrt (`EDITOR_LOCK_KINDS` „sprache“, `POST /api/editor/locks` mit `part` „felder“ oder „form“). Jede Operation
 *   an einer bestehenden Sprache und an ihren Teilflächen verlangt, dass die fragende Person ihre Sperre hält: sonst 409 `lock_required`; hält sie ein anderer,
 *   409 `object_locked` mit der Sperre in `details.lock`. Anlegen braucht keine. Ein Artikel, der beim Zuordnen einer anderen Sprache weggenommen wird, darf nicht
 *   fremd gesperrt sein (409 `object_locked`).
 * - **Revision:** Felder, Wiki-Artikel, Stilllegen und Zurückholen gehen gegen die Revision der Sprache (`baseRevision`), Form und Stand einer Teilfläche gegen
 *   die Revision der Teilfläche; eine neue Teilfläche gegen die der Sprache. Veraltet: 409 `edit_conflict` mit wer und wann. Das Zuordnen von Wiki-Artikeln zählt
 *   die Revision der Sprache hoch (die Zuordnung ist ein Feld des Entwurfs), eine Teilfläche nicht.
 * - 🔴 **Flächen sind unabhängig und dürfen sich überlappen** (E2): Der Server prüft nur die eigene Form (Ringe mit drei Ecken, gültig, in der Karte), nie gegen
 *   andere Sprachen, und rastet nichts ein (E4). Eine Form, die sich selbst schneidet, ist 400; eine schon vorher ungültige Fläche bleibt bearbeitbar.
 * - 🔴 **Umformen macht eine Fläche zu einer der Redaktion** (T-1): Herkunft `redaktion`, `quelleRevision` leer. Ein erneuter Import der Sprachenkarte ersetzt nur
 *   Flächen der Herkunft `sprachenkarte` und lässt die umgeformte deshalb in Ruhe.
 * - **Stilllegen löscht nie.** Eine stillgelegte Sprache verschwindet aus Karte, Suche und Infoboxen; ihre Teilflächen bleiben (die Kachelsicht zeigt nur Flächen
 *   aktiver Sprachen), ihre Wiki-Zuordnungen werden still gelegt, damit die Artikel frei sind. Zurückholen belebt die Zuordnungen, die mit dem Stilllegen
 *   fielen und deren Artikel noch frei sind.
 * - **Zurücknehmen** (WI-0265 B6e, `editor-ruecknahme.ts`): Felder und Wiki-Artikel (auch der, der einer anderen Sprache dafür genommen wurde, mit der Herkunft der Zuordnung von vorher), Stilllegen
 *   und Zurückholen von Sprache und Teilfläche, die Form (samt Herkunft und Revision der Quelle) und die Werkzeuge an Teilflächen, auch das Kopieren in eine neue Sprache, nimmt der Server in EINER Operation
 *   zurück, einzeln oder als Arbeitsserie; sie verlangt nicht die eigene Sperre, nur dass kein anderer die Sprache hält. Nicht zurücknehmbar: das Anlegen (Sprache, Teilfläche) und
 *   `sprache.flaeche_aus_landschaft`.
 * - **Folgen:** Jede Operation meldet `map.changed` (Art `sprache`, Teilflächen `sprache_flaeche`; die Karte lädt die Quellen der Sprachen neu). Ändert sie Fläche oder
 *   Bestand (Teilfläche, Stilllegen, Zurückholen), reiht sie den Auftrag `sprache_treffer` für die Sprache ein (`derivedWork`); Name, Legende, Farbe, Reihenfolge und
 *   Wiki-Artikel gehen in keinen Treffer ein. Der WikiSync schreibt weder Fläche noch Farbe noch Zuordnung (O6).
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const EDITOR_SPRACHEN_URL = "/api/editor/sprachen";
export const EDITOR_SPRACHEN_ARTIKEL_URL = "/api/editor/sprachen-artikel";
/**
 * „Kopieren …“ einer Fläche der Derographie in eine Sprache (WI-0261; Betreiber 2026-10-31: „Ja, bauen“): `sprache.flaeche_aus_landschaft`, siehe
 * `SpracheAusLandschaftBody`.
 */
export const EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL = `${EDITOR_SPRACHEN_URL}/aus-landschaft`;
export const editorSpracheUrl = (id: string): string => `${EDITOR_SPRACHEN_URL}/${id}`;
export const editorSpracheAendernUrl = (id: string): string => `${editorSpracheUrl(id)}/update`;
export const editorSpracheWikiUrl = (id: string): string => `${editorSpracheUrl(id)}/wiki`;
export const editorSpracheStilllegenUrl = (id: string): string => `${editorSpracheUrl(id)}/retire`;
export const editorSpracheZurueckholenUrl = (id: string): string => `${editorSpracheUrl(id)}/restore`;
export const editorSpracheVerlaufUrl = (id: string): string => `${editorSpracheUrl(id)}/history`;
export const editorSpracheTrefferUrl = (id: string): string => `${editorSpracheUrl(id)}/treffer`;
export const editorSpracheFlaechenUrl = (id: string): string => `${editorSpracheUrl(id)}/flaechen`;
export const editorSpracheFlaecheUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaechenUrl(id)}/${flaeche}`;
export const editorSpracheFlaecheUmformenUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/reshape`;
/**
 * „Fläche malen“ und „Fläche radieren“ an einer Teilfläche (WI-0261 Stufe 2): EIN Strich (`PinselStrich`, wie an der Landschaft), gerechnet und nicht
 * geschrieben; die Antwort ist `PinselErgebnis`. Das Ergebnis geht als Schritt in den Entwurf, „Fertig“ schreibt `sprache_flaeche.reshape`.
 */
export const editorSpracheFlaechePinselUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/brush`;
/**
 * Die übrigen Werkzeuge der Fläche an einer Teilfläche (WI-0261 Stufe 3; Betreiber 2026-10-31, wörtlich: „beim editieren der sprachflächen wär es gut, wenn wir die
 * tools des flächeneditors hätten“, danach „bau weiter“): „Unterflächen ›“, „Zerschneiden“, „Mit anderer Fläche ›“ und „Kopieren …“ wie an der Landschaft
 * (`landscape-editor.ts`, dieselben Operationen und Rechnungen, `apps/server/src/editor/flaechen-rechnung.ts`), mit den Teilflächen einer Sprache statt
 * Landschaften. Jede schreibt sofort EINE Operation (Ausnahme von EDIT-0003 G4 wie an der Landschaft), deren Fachprotokoll JEDE betroffene Teilfläche mit
 * ihrer ganzen Form vorher und nachher trägt (eine neue ohne „vorher“, eine stillgelegte ohne „nachher“), damit sich die Operation als Ganzes zurücknehmen lässt.
 *
 * - **Unterflächen** (`parts`): Eine Unterfläche ist ein Polygon der Teilfläche. „vereinigen“ verschmilzt die Teilfläche mit allen Teilflächen derselben Sprache,
 *   die mit ihr zusammenhängen (sich berühren oder überlappen, auch über andere hinweg), zu EINER: Was sich berührt, wird eins, Getrenntes bleibt getrennt; die
 *   übrigen gehen in ihr auf und werden stillgelegt. „herausloesen“ macht den gewählten Teil zu einer eigenen Teilfläche derselben Sprache, „loeschen“ nimmt ihn
 *   weg. Alle drei erst ab zwei Teilen (vereinigen: insgesamt).
 * - **Zerschneiden** (`split`): wie an der Landschaft; die abgeschnittenen Stücke werden EINE neue Teilfläche derselben Sprache.
 * - **Mit anderer Fläche** (`boolean-preview`, `boolean`): Ziel ist die Teilfläche einer ANDEREN Sprache (Sprachflächen dürfen sich überlappen, E2);
 *   „vereinigen“ und „ausschneiden“ legen sie still, ihre Sprache bleibt (`targetLandscapeGoes` ist immer `false`).
 * - **Kopieren** (`copy`): die Teilfläche als neue Teilfläche einer anderen Sprache, mit `deleteSource` („Originalfläche löschen“) als Umziehen; die Sprache
 *   der Quelle bleibt, auch ohne Teilfläche. Ziel ist eine bestehende Sprache (`targetId`) oder eine neue (`neueSprache`, Betreiber 2026-10-31: „Ja, auch
 *   neue“): Sie entsteht in DERSELBEN Operation wie beim Anlegen (Schlüssel aus dem Namen, eindeutig gemacht; Herkunft `redaktion`; ans Ende der Legende),
 *   braucht keine Sperre und steht im Fachprotokoll als `sprache.created`.
 * - 🔴 **Sperren:** die Sprache der Quelle immer; die andere Sprache, wenn die Operation an ihr etwas ändert (stilllegen, eine Kopie anlegen), sonst darf nur kein
 *   anderer sie halten. Neue Teilflächen und jede Quelle, deren Form sich ändert, sind danach Flächen der Redaktion (T-1). Der Auftrag `sprache_treffer` geht an
 *   jede berührte Sprache.
 */
export const editorSpracheFlaecheTeileUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/parts`;
export const editorSpracheFlaecheSchneidenUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/split`;
export const editorSpracheFlaecheBooleanVorschauUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/boolean-preview`;
export const editorSpracheFlaecheBooleanUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/boolean`;
export const editorSpracheFlaecheKopierenUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/copy`;
export const editorSpracheFlaecheStilllegenUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/retire`;
export const editorSpracheFlaecheZurueckholenUrl = (id: string, flaeche: string): string =>
    `${editorSpracheFlaecheUrl(id, flaeche)}/restore`;

/** Der Schlüssel einer Sprache: dieselbe Form wie die Bedingung der Tafel (`sprache_schluessel_format`, Migration 0254). */
export const SPRACHE_SCHLUESSEL_MUSTER = "^[a-z][a-z0-9_-]*$";
/** Die Farbe als `#rrggbb`; der Server speichert sie klein (`sprache_farbe_format`). */
export const SPRACHE_FARBE_MUSTER = "^#[0-9a-fA-F]{6}$";
export const SPRACHE_NAME_MAX = 120;
/** Die Farbe einer neuen Sprache, wenn keine gewählt ist (das Blatt „Neue Sprache“ beginnt mit ihr, „Kopieren …“ in eine neue Sprache nimmt sie). */
export const SPRACHE_NEUE_FARBE = "#8f6fb3";
export const SPRACHE_LEGENDE_MAX = 200;
/** So viele Wiki-Artikel (Pillen) trägt eine Sprache höchstens. */
export const SPRACHE_WIKI_MAX = 50;
/** Die höchste Stelle in der Legende. */
export const SPRACHE_REIHENFOLGE_MAX = 10_000;
/** So viele Ecken hat ein Ring höchstens: genug für die größte Teilfläche der Sprachenkarte (rund 27 000 Stützpunkte auf 527 Teilflächen). */
export const SPRACHE_RING_MAX = 20_000;
/** So viele Polygone trägt eine Teilfläche höchstens (die Sprachenkarte schreibt je Teilfläche eines). */
export const SPRACHE_POLYGONE_MAX = 64;
/** So viele Artikel nennt die Artikelsuche höchstens. */
export const SPRACHE_ARTIKEL_MAX = 50;

/** Woher eine Sprache oder Teilfläche stammt (T-1): aus der Sprachenkarte eingespielt oder von der Redaktion. */
export const SPRACHE_HERKUENFTE = ["sprachenkarte", "redaktion"] as const;
export type SpracheHerkunftArt = (typeof SPRACHE_HERKUENFTE)[number];
/** Woher eine Zuordnung Artikel → Sprache stammt: beim Einspielen (S6) oder von der Redaktion. */
export const SPRACHE_WIKI_HERKUENFTE = ["import", "redaktion"] as const;

/**
 * Die vier Zustände der Liste (Bauvorlage, wie in allen Editor-Listen: links dem Wiki zugewiesen, rechts mit Fläche auf der Karte):
 * `platziert_wiki` „platziert und dem Wiki zugewiesen“, `nur_wiki` „nur im Wiki, nicht platziert“, `platziert_ohne_wiki` „platziert, ohne Wiki-Artikel“,
 * `leer` „nicht platziert, ohne Wiki-Artikel“. Ein Wiki-Artikel ohne Sprache steht als `nur_wiki` da (O1).
 */
export const SPRACHE_EDITOR_ZUSTAENDE = ["platziert_wiki", "nur_wiki", "platziert_ohne_wiki", "leer"] as const;
export type SpracheEditorZustand = (typeof SPRACHE_EDITOR_ZUSTAENDE)[number];

const Ecke = () => Type.Tuple([Type.Number(), Type.Number()]);
/** Ringe ohne Schlusspunkt, je Polygon zuerst außen, dann die Löcher (wie `EditorTerritoryFormArea.polygons`). */
export const SprachePolygone = Type.Array(
    Type.Array(Type.Array(Ecke(), { minItems: 3, maxItems: SPRACHE_RING_MAX }), { minItems: 1 }),
    { minItems: 1, maxItems: SPRACHE_POLYGONE_MAX },
);
export type SprachePolygone = Static<typeof SprachePolygone>;

const Name = () => Type.String({ minLength: 1, maxLength: SPRACHE_NAME_MAX });
const Legende = () => nullable(Type.String({ maxLength: SPRACHE_LEGENDE_MAX }));
const Farbe = () => Type.String({ pattern: SPRACHE_FARBE_MUSTER });
const Revision = () => Type.Integer({ minimum: 1 });

// ---------------------------------------------------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------------------------------------------------

/** Eine Zeile der Liste: eine Sprache. `aktiv: false` nur mit `?stillgelegt=true`; stillgelegte zählen in keinem Zustand. */
export const SpracheEditorSpracheZeile = Type.Object(
    {
        art: Type.Literal("sprache"),
        id: Uuid(),
        schluessel: Type.String(),
        name: Type.String(),
        legende: nullable(Type.String()),
        farbe: Type.String(),
        reihenfolge: Type.Integer(),
        herkunft: oneOf(SPRACHE_HERKUENFTE),
        revision: Revision(),
        aktiv: Type.Boolean(),
        /** Zahl der aktiven Teilflächen und ihre Summe in Karteneinheiten² (zwei Stellen). */
        teilflaechen: Type.Integer({ minimum: 0 }),
        flaeche: Type.Number(),
        /** Zahl der zugeordneten Wiki-Artikel und der Titel des ersten (Pille 1), für „✓ Wiki: …“. */
        wikiArtikel: Type.Integer({ minimum: 0 }),
        ersterArtikel: nullable(Type.String()),
        zustand: oneOf(SPRACHE_EDITOR_ZUSTAENDE),
    },
    strict,
);
export type SpracheEditorSpracheZeile = Static<typeof SpracheEditorSpracheZeile>;

/** Eine Zeile der Liste: ein aktiver Wiki-Artikel, der keiner Sprache gehört („nur im Wiki, nicht platziert“, O1). */
export const SpracheEditorArtikelZeile = Type.Object(
    {
        art: Type.Literal("artikel"),
        /** `wiki_sprache_artikel.public_id` */
        id: Uuid(),
        titel: Type.String(),
        name: nullable(Type.String()),
        kurzbeschreibung: nullable(Type.String()),
        sprachfamilie: nullable(Type.String()),
        zustand: Type.Literal("nur_wiki"),
    },
    strict,
);
export type SpracheEditorArtikelZeile = Static<typeof SpracheEditorArtikelZeile>;

/** Je Zustand die Zahl der Zeilen (aktive Sprachen und freie Artikel), für die Kachel „Sprachen“ im Editorpanel. */
export const SpracheEditorZahlen = Type.Object(
    {
        platziertWiki: Type.Integer({ minimum: 0 }),
        nurWiki: Type.Integer({ minimum: 0 }),
        platziertOhneWiki: Type.Integer({ minimum: 0 }),
        leer: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type SpracheEditorZahlen = Static<typeof SpracheEditorZahlen>;

/** Die Liste: Sprachen nach Reihenfolge der Legende, dann Name; danach die freien Artikel nach Titel. */
export const SpracheEditorListe = Type.Object(
    {
        zeilen: Type.Array(Type.Union([SpracheEditorSpracheZeile, SpracheEditorArtikelZeile])),
        zahlen: SpracheEditorZahlen,
    },
    strict,
);
export type SpracheEditorListe = Static<typeof SpracheEditorListe>;

export const SpracheEditorListeAnfrage = Type.Object(
    {
        /** Auch stillgelegte Sprachen (`aktiv: false`), etwa für „Zurückholen“. */
        stillgelegt: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type SpracheEditorListeAnfrage = Static<typeof SpracheEditorListeAnfrage>;

/** Eine Wiki-Pille der Sprache, in der Reihenfolge der Pillen. Die Felder der Infobox liest nur der WikiSync. */
export const SpracheEditorPille = Type.Object(
    {
        /** `wiki_sprache_artikel.public_id` */
        id: Uuid(),
        titel: Type.String(),
        name: nullable(Type.String()),
        kurzbeschreibung: nullable(Type.String()),
        sprachfamilie: nullable(Type.String()),
        vorstufen: nullable(Type.String()),
        schrift: nullable(Type.String()),
        /** Steht der Artikel noch im Wiki? `false`: verschwunden (der WikiSync legte ihn still); die Zuordnung bleibt, bis die Redaktion sie löst. */
        imWiki: Type.Boolean(),
        herkunft: oneOf(SPRACHE_WIKI_HERKUENFTE),
    },
    strict,
);
export type SpracheEditorPille = Static<typeof SpracheEditorPille>;

/** Eine aktive Teilfläche, die größte zuerst. Die Geometrie selbst kommt als Kachel oder über die Form der Teilfläche. */
export const SpracheEditorTeilflaeche = Type.Object(
    {
        /** `sprache_flaeche.public_id` */
        id: Uuid(),
        herkunft: oneOf(SPRACHE_HERKUENFTE),
        /** SHA-256 der eingespielten Sprachenkarte; leer bei der Redaktion (T-1). */
        quelleRevision: nullable(Type.String()),
        revision: Revision(),
        /** Fläche in Karteneinheiten², zwei Stellen. */
        flaeche: Type.Number(),
        /** `[minX, minY, maxX, maxY]` in Kartenkoordinaten (SRID 0). */
        bbox: Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]),
        stuetzpunkte: Type.Integer({ minimum: 0 }),
        loecher: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type SpracheEditorTeilflaeche = Static<typeof SpracheEditorTeilflaeche>;

/** Eine andere aktive Sprache, mit der sich diese überlappt (aus den Mischgebieten, `sprache_misch`), die größte Überlappung zuerst. */
export const SpracheEditorUeberlappung = Type.Object(
    {
        id: Uuid(),
        schluessel: Type.String(),
        name: Type.String(),
        farbe: Type.String(),
        /** Gemeinsame Fläche in Karteneinheiten², zwei Stellen. */
        flaeche: Type.Number(),
        /** Anteil an der Fläche dieser Sprache (0 bis 1). */
        anteil: Type.Number(),
    },
    strict,
);
export type SpracheEditorUeberlappung = Static<typeof SpracheEditorUeberlappung>;

/** Die Zahlen der Treffer je Art ab dem Mindestanteil (Reiter „Kollisionen“) und ihr Stand. */
export const SpracheEditorTreffer = Type.Object(
    {
        orte: Type.Integer({ minimum: 0 }),
        gebiete: Type.Integer({ minimum: 0 }),
        regionen: Type.Integer({ minimum: 0 }),
        wege: Type.Integer({ minimum: 0 }),
        /** Wann der Auftrag zuletzt Treffer dieser Sprache schrieb (ISO); `null`: nie. */
        berechnetAt: nullable(Type.String()),
        /** Wartet oder läuft ein Auftrag `sprache_treffer`, der diese Sprache rechnet? Dann sind die Zahlen alt. */
        ausstehend: Type.Boolean(),
    },
    strict,
);
export type SpracheEditorTreffer = Static<typeof SpracheEditorTreffer>;

/** Eine Sprache im Spracheditor, auch stillgelegt (`aktiv: false`, für „Zurückholen“). */
export const SpracheEditorDetail = Type.Object(
    {
        id: Uuid(),
        schluessel: Type.String(),
        name: Type.String(),
        legende: nullable(Type.String()),
        farbe: Type.String(),
        reihenfolge: Type.Integer(),
        herkunft: oneOf(SPRACHE_HERKUENFTE),
        revision: Revision(),
        aktiv: Type.Boolean(),
        /** Summe der aktiven Teilflächen in Karteneinheiten². */
        flaeche: Type.Number(),
        wiki: Type.Array(SpracheEditorPille),
        teilflaechen: Type.Array(SpracheEditorTeilflaeche),
        treffer: SpracheEditorTreffer,
        ueberlappungen: Type.Array(SpracheEditorUeberlappung),
        /** Die geltende Sperre der Sprache (`own` mit `?run=`), oder `null`. */
        sperre: nullable(EditorLock),
    },
    strict,
);
export type SpracheEditorDetail = Static<typeof SpracheEditorDetail>;

export const SpracheEditorDetailAnfrage = Type.Object({ run: Type.Optional(Uuid()) }, strict);
export type SpracheEditorDetailAnfrage = Static<typeof SpracheEditorDetailAnfrage>;

/** Die Form einer Teilfläche für „✎ Fläche bearbeiten“: eckig wie gespeichert, mit Revision (gespeichert wird gegen sie). */
export const SpracheEditorFlaecheForm = Type.Object(
    {
        id: Uuid(),
        sprache: Uuid(),
        revision: Revision(),
        herkunft: oneOf(SPRACHE_HERKUENFTE),
        quelleRevision: nullable(Type.String()),
        aktiv: Type.Boolean(),
        polygons: Type.Array(Type.Array(Type.Array(Ecke()))),
    },
    strict,
);
export type SpracheEditorFlaecheForm = Static<typeof SpracheEditorFlaecheForm>;

export const SpracheEditorArtikelAnfrage = Type.Object(
    {
        /** Teil des Titels oder Namens, ohne Groß und Klein; leer: alle. */
        q: Type.Optional(Type.String({ maxLength: 100 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SPRACHE_ARTIKEL_MAX })),
        /** Nur Artikel ohne Sprache. */
        frei: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type SpracheEditorArtikelAnfrage = Static<typeof SpracheEditorArtikelAnfrage>;

/** Ein aktiver Wiki-Artikel für das Zuordnen; `besitzer`: die Sprache, der er heute gehört (Zuordnen nimmt ihn ihr weg), oder `null`. */
export const SpracheEditorArtikel = Type.Object(
    {
        id: Uuid(),
        titel: Type.String(),
        name: nullable(Type.String()),
        kurzbeschreibung: nullable(Type.String()),
        sprachfamilie: nullable(Type.String()),
        besitzer: nullable(
            Type.Object({ id: Uuid(), schluessel: Type.String(), name: Type.String(), aktiv: Type.Boolean() }, strict),
        ),
    },
    strict,
);
export type SpracheEditorArtikel = Static<typeof SpracheEditorArtikel>;

export const SpracheEditorArtikelListe = Type.Object({ artikel: Type.Array(SpracheEditorArtikel) }, strict);
export type SpracheEditorArtikelListe = Static<typeof SpracheEditorArtikelListe>;

// ---------------------------------------------------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `sprache.create`: eine Sprache der Redaktion. Der Schlüssel entsteht aus dem Namen (klein, Umlaute ausgeschrieben, sonst `-`), eindeutig gemacht mit
 * `-2`, `-3` …; er bleibt danach fest (T-2). Neu steht sie am Ende der Legende. `wiki`: Artikel, die sie gleich trägt (wie `sprache.wiki`).
 */
export const SpracheAnlegenBody = Type.Object(
    {
        operationId: OperationId,
        name: Name(),
        farbe: Farbe(),
        legende: Type.Optional(Legende()),
        wiki: Type.Optional(Type.Array(Uuid(), { maxItems: SPRACHE_WIKI_MAX, uniqueItems: true })),
    },
    strict,
);
export type SpracheAnlegenBody = Static<typeof SpracheAnlegenBody>;

export const SpracheAngelegt = Type.Object(
    { ...OperationReceipt.properties, publicId: Uuid(), schluessel: Type.String() },
    strict,
);
export type SpracheAngelegt = Static<typeof SpracheAngelegt>;

/** `sprache.update`: nur die genannten Felder; `legende` leer oder `null` nimmt sie weg (die Legende zeigt dann den Namen). */
export const SpracheAendernBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision(),
        name: Type.Optional(Name()),
        legende: Type.Optional(Legende()),
        farbe: Type.Optional(Farbe()),
        reihenfolge: Type.Optional(Type.Integer({ minimum: 0, maximum: SPRACHE_REIHENFOLGE_MAX })),
    },
    strict,
);
export type SpracheAendernBody = Static<typeof SpracheAendernBody>;

/** `sprache.retire`, `sprache.restore`, `sprache_flaeche.retire`, `sprache_flaeche.restore`: gegen die Revision der Sprache oder der Teilfläche. */
export const SpracheStandBody = Type.Object({ operationId: OperationId, baseRevision: Revision() }, strict);
export type SpracheStandBody = Static<typeof SpracheStandBody>;

/**
 * `sprache.wiki`: die Pillen in ihrer neuen Reihenfolge, ganz. Was fehlt, wird gelöst; was neu ist, zugeordnet; gehört ein Artikel einer anderen Sprache, wird er
 * dort gelöst und hier zugeordnet (im Protokoll beider Sprachen). Ein verschwundener Artikel (nicht mehr im Wiki) darf bleiben, aber nicht neu dazukommen.
 */
export const SpracheWikiBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision(),
        artikel: Type.Array(Uuid(), { maxItems: SPRACHE_WIKI_MAX, uniqueItems: true }),
    },
    strict,
);
export type SpracheWikiBody = Static<typeof SpracheWikiBody>;

/** `sprache_flaeche.create`: eine gezeichnete Teilfläche gegen die Revision der Sprache. */
export const SpracheFlaecheAnlegenBody = Type.Object(
    { operationId: OperationId, baseRevision: Revision(), polygons: SprachePolygone },
    strict,
);
export type SpracheFlaecheAnlegenBody = Static<typeof SpracheFlaecheAnlegenBody>;

export const SpracheFlaecheAngelegt = Type.Object({ ...OperationReceipt.properties, flaecheId: Uuid() }, strict);
export type SpracheFlaecheAngelegt = Static<typeof SpracheFlaecheAngelegt>;

/** `sprache_flaeche.reshape`: die neue Form, ganz, gegen die Revision der Teilfläche. */
export const SpracheFlaecheUmformenBody = Type.Object(
    { operationId: OperationId, baseRevision: Revision(), polygons: SprachePolygone },
    strict,
);
export type SpracheFlaecheUmformenBody = Static<typeof SpracheFlaecheUmformenBody>;

/** `sprache_flaeche.parts` (Stufe 3): gegen die Revision der Teilfläche; `part` (ab 0, in der Folge ihrer Polygone) nur beim Herauslösen und Löschen. */
export const SpracheFlaecheTeileBody = Type.Object(
    {
        operationId: OperationId,
        operation: oneOf(LANDSCAPE_PARTS_OPERATIONS),
        baseRevision: Revision(),
        part: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type SpracheFlaecheTeileBody = Static<typeof SpracheFlaecheTeileBody>;

/** Die Quittung: die Zahl der Teile vorher und nachher, beim Herauslösen die neue Teilfläche. */
export const SpracheFlaecheTeileQuittung = Type.Object(
    {
        ...OperationReceipt.properties,
        partsBefore: Type.Optional(Type.Integer({ minimum: 0 })),
        partsAfter: Type.Optional(Type.Integer({ minimum: 0 })),
        flaecheId: Type.Optional(Uuid()),
    },
    strict,
);
export type SpracheFlaecheTeileQuittung = Static<typeof SpracheFlaecheTeileQuittung>;

/** `sprache_flaeche.split` (Stufe 3): die Schnittlinie in Kartenkoordinaten, nicht verlängert, gegen die Revision der Teilfläche. */
export const SpracheFlaecheSchneidenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision(),
        line: Type.Array(Ecke(), { minItems: 2, maxItems: LANDSCAPE_CREATE_POINTS_MAX }),
    },
    strict,
);
export type SpracheFlaecheSchneidenBody = Static<typeof SpracheFlaecheSchneidenBody>;

/** Die Quittung von Zerschneiden und Kopieren: dazu die neue Teilfläche (die abgeschnittenen Stücke, die Kopie). */
export const SpracheFlaecheNeuQuittung = Type.Object(
    {
        ...OperationReceipt.properties,
        flaecheId: Type.Optional(Uuid()),
        /** Beim Kopieren: die Sprache, in der die Kopie liegt (auch eine eben angelegte). */
        spracheId: Type.Optional(Uuid()),
    },
    strict,
);
export type SpracheFlaecheNeuQuittung = Static<typeof SpracheFlaecheNeuQuittung>;

/** „Mit anderer Fläche“ rechnen (Stufe 3): die Teilfläche einer anderen Sprache als Ziel. */
export const SpracheFlaecheBooleanVorschauBody = Type.Object(
    { operation: oneOf(LANDSCAPE_BOOLEAN_OPERATIONS), targetAreaId: Uuid() },
    strict,
);
export type SpracheFlaecheBooleanVorschauBody = Static<typeof SpracheFlaecheBooleanVorschauBody>;

/** Die Vorschau wie an der Landschaft (`targetName` ist der Name der anderen Sprache, `targetLandscapeGoes` immer `false`). */
export const SpracheFlaecheBooleanVorschau = LandscapeBooleanPreview;
export type SpracheFlaecheBooleanVorschau = Static<typeof SpracheFlaecheBooleanVorschau>;

/** `sprache_flaeche.boolean` (Stufe 3): gegen die Revisionen beider Teilflächen. */
export const SpracheFlaecheBooleanBody = Type.Object(
    {
        operationId: OperationId,
        operation: oneOf(LANDSCAPE_BOOLEAN_OPERATIONS),
        baseRevision: Revision(),
        targetAreaId: Uuid(),
        targetBaseRevision: Revision(),
    },
    strict,
);
export type SpracheFlaecheBooleanBody = Static<typeof SpracheFlaecheBooleanBody>;

/**
 * `sprache_flaeche.copy` (Stufe 3): die Zielsprache und „Originalfläche löschen“, gegen die Revision der Teilfläche. Ziel ist GENAU EINES von `targetId` (eine
 * bestehende Sprache) und `neueSprache` (eine neue, Name wie beim Anlegen, ohne Farbe `SPRACHE_NEUE_FARBE`). 🪤 Kein `Type.Union` zweier strikter Objekte:
 * Fastifys ajv streift fremde Felder im ersten Zweig ab und verfälschte so den zweiten; „genau eines“ prüft `oneOf` über `required`.
 */
export const SpracheFlaecheKopierenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Revision(),
        targetId: Type.Optional(Uuid()),
        neueSprache: Type.Optional(Type.Object({ name: Name(), farbe: Type.Optional(Farbe()) }, strict)),
        deleteSource: Type.Boolean(),
    },
    { ...strict, oneOf: [{ required: ["targetId"] }, { required: ["neueSprache"] }] },
);
export type SpracheFlaecheKopierenBody = Static<typeof SpracheFlaecheKopierenBody>;

/**
 * `sprache.flaeche_aus_landschaft` (`POST /api/editor/sprachen/aus-landschaft`; WI-0261, Betreiber 2026-10-31: „Ja, bauen“): EINE Teilfläche der Derographie
 * (`regionId`, `areaId`; dieselbe Einheit wie „Kopieren …“ dort, `landscape.copy`) als KOPIE in eine Sprache, ganz als EINE neue Teilfläche der Redaktion.
 * Ziel ist GENAU EINES von `targetId` (eine bestehende Sprache, mit ihrer Sperre) und `neueSprache` (angelegt wie beim Anlegen, in derselben Operation, ohne
 * Sperre); dasselbe Schema-Muster wie `SpracheFlaecheKopierenBody` (`oneOf` über `required`, kein `Type.Union`: ajv streift im ersten Zweig ab). Die
 * Landschaft bleibt unberührt: Es gibt kein „Originalfläche löschen“, und in `region_area` wird nie geschrieben. Die Quittung ist `SpracheFlaecheNeuQuittung`
 * (die neue Teilfläche und ihre Sprache). Vorerst nicht zurücknehmbar (kein Weg der Rücknahme kennt die Aktion).
 */
export const SpracheAusLandschaftBody = Type.Object(
    {
        operationId: OperationId,
        regionId: Uuid(),
        areaId: Uuid(),
        targetId: Type.Optional(Uuid()),
        neueSprache: Type.Optional(Type.Object({ name: Name(), farbe: Type.Optional(Farbe()) }, strict)),
    },
    { ...strict, oneOf: [{ required: ["targetId"] }, { required: ["neueSprache"] }] },
);
export type SpracheAusLandschaftBody = Static<typeof SpracheAusLandschaftBody>;

/** Die Antwort auf „↻ Jetzt neu berechnen“: der wartende Auftrag `sprache_treffer`, der die Sprache mitnimmt. */
export const SpracheTrefferAuftrag = Type.Object({ jobId: Uuid() }, strict);
export type SpracheTrefferAuftrag = Static<typeof SpracheTrefferAuftrag>;
