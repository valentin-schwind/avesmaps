import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import { MutationEnvelope, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { SOURCE_REFERENCE_KINDS, SOURCE_TYPES, SubjectCanon } from "./subject.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Quellen“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`).
 *
 *     GET  /api/editor/inhalte/quellen            die Katalogquellen, seitenweise, mit Suche und Filter           use_editor_menu
 *     GET  /api/editor/inhalte/quellen/:id        eine Quelle: Stammdaten, Korpus, Verwendungen mit Kanon-Etikett   use_editor_menu
 *     GET  /api/editor/inhalte/ziele              Träger zum Anhängen (nur echte Kennungen, nie ein Name)           use_editor_menu
 *     GET  /api/editor/inhalte/quellen/adresse    die Auskunft zu einem Link: Katalog, Korpus, Seitentitel (WI-0277) manage_sources
 *     POST /api/editor/inhalte/quellen            source.create: eine Quelle MIT Adresse anlegen                    manage_sources
 *     POST /api/editor/inhalte/quellen/:id/update source.update: Stammdaten und Verwendungen in EINER Operation    manage_sources
 *
 * - 🔴 **Identität:** `source_key` (Hash der Adresse, Wiki-Schlüssel) bleibt die Identität; hier läuft alles über `public_id` (0232).
 *   Die Adresse einer Quelle ist ihre Identität und lässt sich nicht ändern: eine andere Adresse ist eine andere Quelle (`sources.yaml`,
 *   `identitaet`). Eine URL-lose Quelle legt dieser Reiter nicht an: Ob Redakteure das dürfen, ist eine offene Fachentscheidung (WI-0254 §4, §10).
 * - **Verwendungen** sind Verknüpfungen eines Trägers mit der Quelle (`<träger>_source`); ihre Identität ist Träger + Quelle, deshalb
 *   `kind` + `carrierId` (die öffentliche Kennung des Trägers), nie ein Name.
 * - 🔴 **Ein Weg ist immer die ganze Straße** (Betreiber 2026-10-28: „wege sind in den quellen oder im wiki als ganzes beschrieben, einzelne
 *   abschnitte sind technische details von uns“). Legacy führt die Quelle je Abschnitt (`path_source`); hier steht EINE Verwendung je Straße
 *   (die Gruppe des Wege-Fensters: derselbe echte Name über Wegtypen hinweg), `carrierId` ist ihr Anker, die kleinste öffentliche Kennung ihrer
 *   Abschnitte (jede Kennung eines Abschnitts führt zur selben Straße). Art, Fundstelle und Notiz sind die zusammengefasste Sicht (die Angaben
 *   des ersten Abschnitts entlang der Straße, der die Quelle aktiv trägt); jede Änderung macht die Quelle auf allen Abschnitten einheitlich.
 *   Ein Abschnitt kommt in diesem Vertrag nicht vor. Weil die Straße keine eigene Revision hat, trägt jede Änderung an ihr `vorher`, die
 *   Sicht, die die Oberfläche las; weicht der Stand ab, ist die ganze Operation 409.
 * - **Entfernen** legt still, es löscht nie: eine Verknüpfung aus Legacy wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine
 *   eigene gelöst (`retired`, `retired_origin = editor`); beides lässt sich wiederherstellen.
 * - Jede Schreibroute trägt `MutationEnvelope` (`operationId`, `baseRevision` der Quelle) und antwortet mit `OperationReceipt`;
 *   409 `edit_conflict` bei veraltetem Stand, 423 `map_locked` und `map_editing_off`, 503 `map_import_running`.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const INHALTE_QUELLEN_URL = "/api/editor/inhalte/quellen";
export const INHALTE_ZIELE_URL = "/api/editor/inhalte/ziele";
export const INHALTE_QUELLEN_ADRESSE_URL = `${INHALTE_QUELLEN_URL}/adresse`;
export const inhalteQuelleUrl = (id: string): string => `${INHALTE_QUELLEN_URL}/${id}`;
export const inhalteQuelleAendernUrl = (id: string): string => `${INHALTE_QUELLEN_URL}/${id}/update`;

/** Wie die Redaktion die Träger nennt, die ein Werk der Literatur oder ein Vorkommen als Ort führt: Ort, Herrschaftsgebiet, Landschaft, Gipfel. */
export const INHALTE_TRAEGER = ["place", "territory", "area", "peak"] as const;
export type InhalteTraeger = (typeof INHALTE_TRAEGER)[number];
/** Die Träger einer Quelle: dazu der Weg, immer als die ganze Straße (nie ein Abschnitt). */
export const INHALTE_QUELLEN_TRAEGER = [...INHALTE_TRAEGER, "path"] as const;
export type InhalteTraegerArt = (typeof INHALTE_QUELLEN_TRAEGER)[number];

/** Die Längen, die Legacy kennt (`sources.yaml`: Seiten 120, Notiz 200, Namensnennung 200); der Titel ist nur nach oben begrenzt. */
export const INHALTE_SEITEN_MAX = 120;
export const INHALTE_NOTIZ_MAX = 200;
export const INHALTE_NENNUNG_MAX = 200;
export const INHALTE_TITEL_MAX = 300;
/** Das Kommentarfeld der Redaktion zu einer Quelle (`feature_source.editor_note`, Migration 0233): unsere Grenze, keine aus Legacy. */
export const INHALTE_KOMMENTAR_MAX = 2000;
export const INHALTE_URL_MAX = 2000;

export const INHALTE_LIZENZ_AUSSAGEN = ["unrecorded", "license", "public_domain", "unfree"] as const;
export type InhalteLizenzAussage = (typeof INHALTE_LIZENZ_AUSSAGEN)[number];

/**
 * Die vier Felder, die der Korpus bei der Anzeigeform Belegstelle den Quellen seiner Domain aufprägt (WI-0254, Runde 4; `inhalte-korpora.ts`): die Art, „offiziell“,
 * die Lizenz (Aussage und Schlüssel zusammen) und die Namensnennung. Am Korpus gesetzt, sind sie an der Quelle gesperrt.
 */
export const INHALTE_KORPUS_VORGABEN = ["sourceType", "isOfficial", "lizenz", "attribution"] as const;
export type InhalteKorpusVorgabe = (typeof INHALTE_KORPUS_VORGABEN)[number];

export const INHALTE_HERKUENFTE = ["legacy", "editor"] as const;
export type InhalteHerkunft = (typeof INHALTE_HERKUENFTE)[number];

export const INHALTE_QUELLEN_SORTIERUNGEN = ["title", "title_desc", "uses"] as const;
export type InhalteQuellenSortierung = (typeof INHALTE_QUELLEN_SORTIERUNGEN)[number];

/** `aktiv` (Vorgabe), `stillgelegt` (nur die von der Redaktion unterdrückten) oder `alle`. */
export const INHALTE_QUELLEN_STAENDE = ["aktiv", "stillgelegt", "alle"] as const;
export type InhalteQuellenStand = (typeof INHALTE_QUELLEN_STAENDE)[number];

export const InhalteQuellenAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        sort: Type.Optional(oneOf(INHALTE_QUELLEN_SORTIERUNGEN)),
        herkunft: Type.Optional(oneOf(INHALTE_HERKUENFTE)),
        stand: Type.Optional(oneOf(INHALTE_QUELLEN_STAENDE)),
        /** WI-0287: je Zeile das Umschlagbild des Werks mitliefern (`InhalteQuellenZeile.umschlag`); die Suche der Publikationen einer Karte fragt es. */
        umschlag: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteQuellenAnfrage = Static<typeof InhalteQuellenAnfrage>;

/**
 * Das Umschlagbild zu einer Quelle (WI-0287, Publikationen der Kartensammlung): der Umschlag des Werks der Literatur (`adventure_media`, Rolle `literature_cover`), das die Quelle
 * meint. 🔴 Nie über den Namen: Zugeordnet wird über den Schlüssel (`wikipub:<wiki_key>` gleich `adventure.wiki_key`), über die Adresse (gleich `link_fshop`, `link_ulisses`
 * oder `wiki_url`) und über die Nummer des Produkts in der Adresse (F-Shop `sSearch` gleich `fshop_code`, Ulisses `/product/<n>`); meint die Nummer mehrere Werke (Sammelbände), gibt
 * es kein Bild. Nur für Editoren: das öffentliche Bild, sonst die private Vorschau (`oeffentlich: false`).
 */
export const InhalteUmschlag = Type.Object(
    {
        url: Type.String(),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        oeffentlich: Type.Boolean(),
    },
    strict,
);
export type InhalteUmschlag = Static<typeof InhalteUmschlag>;

/** Eine Zeile der Liste links. */
export const InhalteQuellenZeile = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        sourceType: oneOf(SOURCE_TYPES),
        /** Die Adresse; fehlt bei einer URL-losen (Buch-)Quelle. */
        url: Type.Optional(Type.String()),
        corpusKey: Type.Optional(Type.String()),
        /** Wie viele Träger die Quelle zitieren (nur aktive Verknüpfungen). */
        uses: Type.Integer({ minimum: 0 }),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Von der Redaktion stillgelegt (unterdrückt): Der Kreis ist leer. */
        stillgelegt: Type.Boolean(),
        /** Nur mit `umschlag=true` in der Anfrage: das Umschlagbild (`null`: keins gefunden). */
        umschlag: Type.Optional(nullable(InhalteUmschlag)),
    },
    strict,
);
export type InhalteQuellenZeile = Static<typeof InhalteQuellenZeile>;

export const InhalteQuellenListe = Type.Object(
    {
        total: Type.Integer({ minimum: 0 }),
        items: Type.Array(InhalteQuellenZeile),
        /** Die Zahlen für den Reiter und die Legende: alle aktiven Quellen, davon im Editor angelegt oder geändert, und stillgelegte. */
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
export type InhalteQuellenListe = Static<typeof InhalteQuellenListe>;

export const InhalteVerwendungState = oneOf(["active", "retired", "suppressed"] as const);
export type InhalteVerwendungState = Static<typeof InhalteVerwendungState>;

/** Eine Verknüpfung eines Trägers mit der Quelle, mit der Auskunft des Trägers (Kanon-Etikett nach den Rängen aus `sources.yaml`). */
export const InhalteVerwendung = Type.Object(
    {
        kind: oneOf(INHALTE_QUELLEN_TRAEGER),
        /** Beim Weg der Anker der Straße (die kleinste Kennung ihrer Abschnitte). */
        carrierId: Uuid(),
        name: Type.String(),
        /** Die Art des Trägers in Worten der Schlüssel (Ortsklasse, Gebietsart, Landschaftsart, Gipfelart, Wegtyp); fehlt, wo es keine gibt. */
        subtype: Type.Optional(Type.String()),
        referenceKind: nullable(oneOf(SOURCE_REFERENCE_KINDS)),
        pages: nullable(Type.String()),
        note: nullable(Type.String()),
        state: InhalteVerwendungState,
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Der Träger steht noch auf der Karte beziehungsweise ist aktiv; ein stillgelegter steht grau da. */
        traegerAktiv: Type.Boolean(),
        /** Das Etikett des Trägers (Rang 1 bis 4 der Kanon-Regel); fehlt, wo nichts zu sagen ist. */
        canon: Type.Optional(SubjectCanon),
        /** Lässt sich diese Verwendung hier ändern? */
        aenderbar: Type.Boolean(),
    },
    strict,
);
export type InhalteVerwendung = Static<typeof InhalteVerwendung>;

export const InhalteKorpus = Type.Object(
    {
        /** Die Kennung des Korpus in der Schnittstelle (Reiter „Korpora“); die Identität ist der Schlüssel. */
        id: Uuid(),
        key: Type.String(),
        /** Der Name des Angebots; leer, wo noch keiner vergeben ist. */
        label: Type.String(),
        form: oneOf(["", "werk", "belegstelle"] as const),
        /** Die Felder, die dieser Korpus der Quelle vorgibt (Belegstelle mit gesetzter Vorgabe): Sie sind an der Quelle gesperrt und gelten, wie der Korpus sie führt. */
        gibtVor: Type.Optional(Type.Array(oneOf(INHALTE_KORPUS_VORGABEN))),
    },
    strict,
);
export type InhalteKorpus = Static<typeof InhalteKorpus>;

export const InhalteLizenz = Type.Object({ key: Type.String(), name: Type.String() }, strict);
export type InhalteLizenz = Static<typeof InhalteLizenz>;

export const InhalteQuelle = Type.Object(
    {
        id: Uuid(),
        revision: Type.Integer({ minimum: 1 }),
        /** Woran die Identität hängt: die Adresse, ein Wiki-Schlüssel oder (vorläufig) Legacys Nummer. */
        identitaet: oneOf(["url", "wikipub", "legacy-id"] as const),
        /** Der Wiki-Schlüssel einer URL-losen Publikation. */
        wikiKey: Type.Optional(Type.String()),
        title: Type.String(),
        url: nullable(Type.String()),
        sourceType: oneOf(SOURCE_TYPES),
        isOfficial: Type.Boolean(),
        lizenzAussage: oneOf(INHALTE_LIZENZ_AUSSAGEN),
        lizenzKey: nullable(Type.String()),
        attribution: nullable(Type.String()),
        /** Der Korpus der Domain, wenn es einen gibt; sonst fehlt er. */
        korpus: Type.Optional(InhalteKorpus),
        /** Die registrierbare Domain der Adresse, auch wenn es zu ihr noch keinen Korpus gibt (der Vorschlag „neue Domain“). */
        domain: Type.Optional(Type.String()),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        aktiv: Type.Boolean(),
        /** Der Kommentar der Redaktion (Migration 0233): eine Anmerkung für die Redaktion, kein öffentlicher Leser liest sie. */
        editorNote: nullable(Type.String()),
        /** Höchstens 300 Zeilen: erst die aktiven, dann die stillen; `verwendungenGesamt` zählt alle aktiven (Wege je Gruppe). */
        verwendungen: Type.Array(InhalteVerwendung),
        verwendungenGesamt: Type.Integer({ minimum: 0 }),
        /** Die Lizenzen des gemeinsamen Katalogs für die Auswahl. */
        lizenzen: Type.Array(InhalteLizenz),
    },
    strict,
);
export type InhalteQuelle = Static<typeof InhalteQuelle>;

export const InhalteZieleAnfrage = Type.Object(
    {
        q: Type.String({ minLength: 1, maxLength: 120 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        /** Auch Wege (je Straße ein Treffer, mit ihrem Anker) suchen: der Reiter „Quellen“. Ohne sie (Literatur) kommt nie ein Weg zurück. */
        wege: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteZieleAnfrage = Static<typeof InhalteZieleAnfrage>;

export const InhalteZiel = Type.Object(
    {
        /** `path` nur auf Wunsch (`wege`); die Kennung ist dann der Anker der Straße. */
        kind: oneOf(INHALTE_QUELLEN_TRAEGER),
        carrierId: Uuid(),
        name: Type.String(),
        subtype: Type.Optional(Type.String()),
        canon: Type.Optional(SubjectCanon),
    },
    strict,
);
export type InhalteZiel = Static<typeof InhalteZiel>;

export const InhalteZiele = Type.Object({ items: Type.Array(InhalteZiel) }, strict);
export type InhalteZiele = Static<typeof InhalteZiele>;

/** Die Felder der Quelle selbst; was fehlt, bleibt. `licenseKey` gehört zur Aussage `license` und nur zu ihr. */
export const InhalteQuelleFelder = Type.Object(
    {
        title: Type.Optional(Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX })),
        sourceType: Type.Optional(oneOf(SOURCE_TYPES)),
        isOfficial: Type.Optional(Type.Boolean()),
        lizenzAussage: Type.Optional(oneOf(INHALTE_LIZENZ_AUSSAGEN)),
        lizenzKey: Type.Optional(nullable(Type.String({ minLength: 1, maxLength: 80 }))),
        attribution: Type.Optional(nullable(Type.String({ maxLength: INHALTE_NENNUNG_MAX }))),
        editorNote: Type.Optional(nullable(Type.String({ maxLength: INHALTE_KOMMENTAR_MAX }))),
        /** `false` legt die Quelle still („unterdrücken“), `true` holt sie zurück. */
        aktiv: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteQuelleFelder = Static<typeof InhalteQuelleFelder>;

/**
 * Was die Oberfläche von der Verwendung eines WEGES sah, als sie die Änderung entwarf: die zusammengefasste Sicht der Straße (`null`: es gab keine). `pages` und `note` ohne
 * Leerraum an den Rändern, leer ist `null`. Ein Weg hat keine eigene Revision; `vorher` ersetzt sie, so wie in `traeger.sources` (`inhalte-traeger-quellen.ts`, dort unter dem Namen
 * `InhalteTraegerQuellenVorher`).
 */
export const InhalteVerwendungVorher = Type.Object(
    {
        state: InhalteVerwendungState,
        referenceKind: nullable(oneOf(SOURCE_REFERENCE_KINDS)),
        pages: nullable(Type.String({ maxLength: INHALTE_SEITEN_MAX })),
        note: nullable(Type.String({ maxLength: INHALTE_NOTIZ_MAX })),
    },
    strict,
);
export type InhalteVerwendungVorher = Static<typeof InhalteVerwendungVorher>;

const VerwendungAngaben = {
    referenceKind: Type.Optional(nullable(oneOf(SOURCE_REFERENCE_KINDS))),
    pages: Type.Optional(nullable(Type.String({ maxLength: INHALTE_SEITEN_MAX }))),
    note: Type.Optional(nullable(Type.String({ maxLength: INHALTE_NOTIZ_MAX }))),
};
/** `vorher` gehört zum Weg und nur zu ihm (Pflicht dort, 400 bei jedem anderen Träger); die Prüfung steht im Schreibweg, das Schema kennt nur die Form. */
const Traeger = {
    kind: oneOf(INHALTE_QUELLEN_TRAEGER),
    carrierId: Uuid(),
    vorher: Type.Optional(nullable(InhalteVerwendungVorher)),
};

/** Eine Änderung an einer Verwendung. `add` holt eine gelöste oder unterdrückte Verknüpfung desselben Trägers zurück. */
export const InhalteVerwendungAenderung = Type.Union([
    Type.Object({ op: Type.Literal("add"), ...Traeger, ...VerwendungAngaben }, strict),
    Type.Object({ op: Type.Literal("update"), ...Traeger, ...VerwendungAngaben }, strict),
    Type.Object({ op: Type.Literal("remove"), ...Traeger }, strict),
    Type.Object({ op: Type.Literal("restore"), ...Traeger }, strict),
]);
export type InhalteVerwendungAenderung = Static<typeof InhalteVerwendungAenderung>;

/** `source.update`: Stammdaten und Verwendungen gegen den gesehenen Stand (`baseRevision`), mindestens eines von beiden. */
export const InhalteQuelleAendernBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        fields: Type.Optional(InhalteQuelleFelder),
        links: Type.Optional(Type.Array(InhalteVerwendungAenderung, { maxItems: 200 })),
    },
    strict,
);
export type InhalteQuelleAendernBody = Static<typeof InhalteQuelleAendernBody>;

/** `source.create`: eine Quelle mit Adresse (https oder http). Bekannte Adresse: 409 `source_exists` mit der Kennung der vorhandenen. */
export const InhalteQuelleAnlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        url: Type.String({ minLength: 8, maxLength: INHALTE_URL_MAX, pattern: "^https?://\\S+$" }),
        title: Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX }),
        sourceType: Type.Optional(oneOf(SOURCE_TYPES)),
        isOfficial: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteQuelleAnlegenBody = Static<typeof InhalteQuelleAnlegenBody>;

/** Die Antwort auf `source.create`: die gewöhnliche Quittung, dazu die Kennung der neuen Quelle. */
export const InhalteQuelleAngelegt = Type.Object({ ...OperationReceipt.properties, publicId: Uuid() }, strict);
export type InhalteQuelleAngelegt = Static<typeof InhalteQuelleAngelegt>;

/**
 * Die Auskunft zu einem Link (WI-0277, Legacys `inspect_url`): Gibt es die Seite schon, zu welchem Korpus gehört sie, wie heißt sie? Regeln in `apps/server/src/inhalte/quellen-adresse.ts`.
 *
 * - `bekannt`: Die Seite steht im Katalog (`vorhanden`, auch unter einer anderen Schreibweise der Adresse); der fremde Server wurde nicht gefragt.
 * - `gelesen`: erreichbar, Titel gefunden. `erreichbar`: antwortet, aber kein Titel (der Link ist in Ordnung). `unerreichbar`: keine Antwort oder ein Fehlerstatus (`httpStatus`).
 * - `nicht_geprueft`: keine öffentliche Seite, gar nicht gefragt.
 */
export const INHALTE_ADRESS_ZUSTAENDE = ["bekannt", "gelesen", "erreichbar", "unerreichbar", "nicht_geprueft"] as const;
export type InhalteAdressZustand = (typeof INHALTE_ADRESS_ZUSTAENDE)[number];

export const InhalteAdressAnfrage = Type.Object(
    { url: Type.String({ minLength: 8, maxLength: INHALTE_URL_MAX, pattern: "^https?://\\S+$" }) },
    strict,
);
export type InhalteAdressAnfrage = Static<typeof InhalteAdressAnfrage>;

/**
 * Der Korpus der Domain. `sourceType` und `isOfficial`: was er einer neuen Quelle vorgibt (`null`: wählbar); `artVorschlag` und `offiziellVorschlag`: womit das Feld dann vorbelegt ist (was die Quellen der Domain gemeinsam sagen).
 * Lizenz und Namensnennung bekommt jede neue Quelle der Domain, vom Korpus oder aus dem Bestand (`rechteAusBestand`).
 */
export const InhalteAdressKorpus = Type.Object(
    {
        key: Type.String(),
        name: Type.String(),
        sourceType: nullable(oneOf(SOURCE_TYPES)),
        isOfficial: nullable(Type.Boolean()),
        artVorschlag: nullable(oneOf(SOURCE_TYPES)),
        offiziellVorschlag: Type.Boolean(),
        lizenzAussage: oneOf(INHALTE_LIZENZ_AUSSAGEN),
        lizenzName: nullable(Type.String()),
        attribution: nullable(Type.String()),
        rechteAusBestand: Type.Boolean(),
        /** Wie viele aktive Quellen und wie viele Objekte daran hängen. */
        quellen: Type.Integer({ minimum: 0 }),
        objekte: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type InhalteAdressKorpus = Static<typeof InhalteAdressKorpus>;

/** Die Quelle des Katalogs unter dieser Adresse. `gleicheAdresse: false`: dieselbe Seite in einer anderen Schreibweise (http/https, www, Schrägstrich am Schluss). */
export const InhalteAdressVorhanden = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        url: Type.String(),
        sourceType: oneOf(SOURCE_TYPES),
        stillgelegt: Type.Boolean(),
        uses: Type.Integer({ minimum: 0 }),
        gleicheAdresse: Type.Boolean(),
    },
    strict,
);
export type InhalteAdressVorhanden = Static<typeof InhalteAdressVorhanden>;

export const InhalteAdressAuskunft = Type.Object(
    {
        url: Type.String(),
        zustand: oneOf(INHALTE_ADRESS_ZUSTAENDE),
        httpStatus: Type.Optional(Type.Integer()),
        /** Nur bei `gelesen`: der Titel der Seite. Fremder Text, einzeilig und ohne Markup. */
        titel: Type.Optional(Type.String()),
        korpus: nullable(InhalteAdressKorpus),
        vorhanden: nullable(InhalteAdressVorhanden),
    },
    strict,
);
export type InhalteAdressAuskunft = Static<typeof InhalteAdressAuskunft>;
