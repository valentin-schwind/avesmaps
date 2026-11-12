import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import {
    INHALTE_HERKUENFTE,
    INHALTE_KOMMENTAR_MAX,
    INHALTE_NOTIZ_MAX,
    INHALTE_SEITEN_MAX,
    INHALTE_TITEL_MAX,
    INHALTE_TRAEGER,
} from "./inhalte-quellen.ts";
import { InhalteQuellenWiki, InhalteTraegerWikiStand } from "./inhalte-traeger-quellen.ts";
import { MutationEnvelope, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { SOURCE_REFERENCE_KINDS, SOURCE_TYPES, SubjectCanon } from "./subject.ts";
import { WIKISYNC_ORTSROLLEN } from "./system/wikisync.ts";
import {
    WIKISYNC_LAGE_ORTSARTEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_REGEL_STATUS,
    WIKISYNC_REGEL_TYPEN,
    WikisyncRegelBedingung,
    WikisyncRegelLage,
    WikisyncRegelOriginal,
    WikisyncRegelTeil,
} from "./system/wikisync-regeln.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Vorkommen“ (WI-0254, Runde 3; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`).
 *
 *     GET  /api/editor/inhalte/vorkommen              die Einträge (Fauna, Flora, Waren, Spezies), seitenweise, mit Suche und Filter   use_editor_menu
 *     GET  /api/editor/inhalte/vorkommen/:id          ein Eintrag: Stammdaten, Ortszeilen mit Treffern, Regeln, Quellen              use_editor_menu
 *     GET  /api/editor/inhalte/vorkommen-ziele        Ziele für eine Ortszeile: Kartenobjekte MIT Wiki-Schlüssel und Kontinentbegriffe use_editor_menu
 *     GET  /api/editor/inhalte/vorkommen-flaechen     Flächen für eine Bedingung einer Regel (Paket R, WI-0254 `--weiter`)               use_editor_menu
 *     GET  /api/editor/inhalte/vorkommen-orte         Orte (Siedlungen) für die Lage zu einer Linie in einer Bedingung                   use_editor_menu
 *     GET  /api/editor/inhalte/vorkommen-umriss       der Umriss Aventuriens für die Skizze der Lage (mit ETag)                           use_editor_menu
 *     POST /api/editor/inhalte/vorkommen              lore.create: ein Eintrag OHNE Wiki-Artikel (eigene Avesmaps-Kennung)             manage_sources
 *     POST /api/editor/inhalte/vorkommen/:id/update   lore.update: Stammdaten, Ortszeilen, Quellen und Regeln in EINER Operation       manage_sources
 *
 * - 🔴 **Die Identität eines Eintrags** ist sein Wiki-Schlüssel (`lore_entry.wiki_key`, Migration 0074), wo er einen hat; `id` (`public_id`, 0234) ist die
 *   Kennung der Schnittstelle und des Protokolls. Der Schlüssel ist nur lesbar, und es wird nie einer erfunden. Vali wählte B am Betreiber-Gate „Vorkommen
 *   ohne Wiki-Artikel“ (WI-0254 §10, Migration 0235): Die Redaktion darf Einträge OHNE Wiki-Artikel anlegen (`wikiKey` ist dann `null`, die Identität ist
 *   `id`); sie tragen die Pille INOFFIZIELL | Avesmaps (Rang 4 der Kanon-Regel, `kanon`).
 * - 🔴 **Das Ziel einer Ortszeile ist ein Wiki-Artikel ODER ein Name.** Gewählt wird ein Kartenobjekt, dem ein Wiki-Schlüssel zugewiesen ist (Zuordnung
 *   `wiki_key_assignment`), oder ein Kontinentbegriff („gilt überall“); der Server schreibt den Schlüssel und rechnet die Treffer (`lore_place_target`) mit
 *   demselben Lookup wie der Import. Ein Objekt ohne Schlüssel ist kein Ziel. Daneben darf eine Zeile einen ungeklärten Namen tragen („ungeklärt
 *   übernehmen“): Ihr `wikiKey` ist `null`, sie hat nie Treffer, und ein Name wird nie zu einem Schlüssel.
 * - **Regeln** (`lore_rule`) stehen mit Herkunft und ihren Bedingungen da. Sie werden nicht ausgewertet (die Regelauswertung fehlt, WI-0253); ein Treffer für
 *   eine Regel gibt es hier nicht, nur die getroffenen Kartenobjekte der Ortszeilen. 🔴 **Der Vertrag zum Ändern** (`InhalteVorkommenAendernBody.regeln`, Paket R
 *   des Regeleditors, WI-0254 `--weiter`, Bezug WI-0253 §26) steht hier, damit Server und Oberfläche denselben Körper bauen; der Server schreibt ihn in derselben Operation wie Stammdaten, Ortszeilen und Quellen
 *   (`apps/server/src/inhalte/vorkommen-regeln-schreiben.ts`). Er prüft alles selbst (400 `validation_failed` mit `details.issues[].path` und `.rule`; 400 `regel_besteht`, wo es die Regel schon gibt) und
 *   macht den Eintrag NICHT zu einem der Redaktion: Nur die Regel gehört dann der Redaktion. Das Lesemodell dazu: der Fingerabdruck der Regel (`ruleKey`), ihre Wiki-Fassung (`wikiBasis`, `wikiJetzt`) und der
 *   Vorschlag des WikiSync am Eintrag (`wikiVorschlag`).
 * - 🔴 **Herkunft der Quellen ist der Vergleich mit dem Wiki** (WI-0254 §12; Vali: „ist egal, wo er sie her hat, vergleich mit dem wiki, alles andere ist manuell“), wie in den Karteneditoren
 *   (`inhalte-traeger-quellen.ts`): `quellen[].wiki` ist das Zitat des Artikels des Eintrags (Art, Seiten, Notiz), `quellenWiki` der Lauf, aus dem es stammt. Der Lauf legt die Zitate ab; die Quellen
 *   eines Eintrags (`lore_entry_source`) legt, ändert und löst er NIE (sie gehören Legacy-Zug und Redaktion). Beide Felder fehlen, wo es keinen Lauf mit Zitaten der Vorkommen gibt.
 * - **Entfernen legt still, es löscht nie:** eine Zeile aus Legacy oder dem Wiki wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine eigene
 *   gelöst (`retired`), beides mit `retired_origin = editor`.
 * - Jede Schreibroute trägt `MutationEnvelope` (`operationId`, `baseRevision` des Eintrags) und antwortet mit `OperationReceipt`; 409 `edit_conflict`
 *   bei veraltetem Stand, 423 `map_locked` und `map_editing_off`, 503 `map_import_running`.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const INHALTE_VORKOMMEN_URL = "/api/editor/inhalte/vorkommen";
export const INHALTE_VORKOMMEN_ZIELE_URL = "/api/editor/inhalte/vorkommen-ziele";
/** Die Suche nach Flächen für die Bedingung einer Regel (`GET …/vorkommen-flaechen?q&limit`, Paket R). */
export const INHALTE_VORKOMMEN_FLAECHEN_URL = "/api/editor/inhalte/vorkommen-flaechen";
/** Die Suche nach Orten für die Lage zu einer Linie (`GET …/vorkommen-orte?q&limit`, Regeleditor). */
export const INHALTE_VORKOMMEN_ORTE_URL = "/api/editor/inhalte/vorkommen-orte";
/** Der Umriss Aventuriens für die Skizze der Lage (`GET …/vorkommen-umriss`, mit ETag; ändert sich nur mit der Karte). */
export const INHALTE_VORKOMMEN_UMRISS_URL = "/api/editor/inhalte/vorkommen-umriss";
export const inhalteVorkommenUrl = (id: string): string => `${INHALTE_VORKOMMEN_URL}/${id}`;
export const inhalteVorkommenAendernUrl = (id: string): string => `${INHALTE_VORKOMMEN_URL}/${id}/update`;

/** Die Arten eines Eintrags, in der Folge des Mockups (Fauna, Flora, Waren, Spezies); in der Datenbank `lore_entry.kind`. */
export const INHALTE_VORKOMMEN_ARTEN = ["fauna", "flora", "ware", "spezies"] as const;
export type InhalteVorkommenArt = (typeof INHALTE_VORKOMMEN_ARTEN)[number];

/** Die Beziehung einer Ortszeile (`lore_place.relation`), in der Folge der Auswahl im Mockup. */
export const INHALTE_VORKOMMEN_BEZIEHUNGEN = ["verbreitung", "herkunft", "regionen", "vorkommen"] as const;
export type InhalteVorkommenBeziehung = (typeof INHALTE_VORKOMMEN_BEZIEHUNGEN)[number];

/** Die Kontinentbegriffe, die „überall“ gelten (Legacys feste Liste `AVESMAPS_LORE_CONTINENT_KEYS`; dieselbe Liste wie `CONTINENT_KEYS` im Import). */
export const INHALTE_KONTINENTE = [
    "aventurien",
    "myranor",
    "uthuria",
    "rakshazar",
    "tharun",
    "riesland",
    "guldenland",
    "gueldenland",
    "ehernes-schwert-kontinent",
] as const;
export type InhalteKontinent = (typeof INHALTE_KONTINENTE)[number];

export const INHALTE_VORKOMMEN_SORTIERUNGEN = ["title", "title_desc"] as const;
export type InhalteVorkommenSortierung = (typeof INHALTE_VORKOMMEN_SORTIERUNGEN)[number];

export const INHALTE_VORKOMMEN_STAENDE = ["aktiv", "stillgelegt", "alle"] as const;
export type InhalteVorkommenStand = (typeof INHALTE_VORKOMMEN_STAENDE)[number];

/** Die Längen, die Legacy kennt (`lore.yaml`: Name 300, Lebensraum 500; Gruppe und Synonyme nach unserer Grenze); die Anmerkung ist unsere. */
export const INHALTE_VORKOMMEN_GRUPPE_MAX = 200;
export const INHALTE_VORKOMMEN_LEBENSRAUM_MAX = 500;
export const INHALTE_VORKOMMEN_SYNONYME_MAX = 500;
export const INHALTE_VORKOMMEN_ORTE_MAX = 200;
/** Wie viele Regeländerungen ein Körper trägt und wie viele Bedingungen EINE Regel (Paket R; ein Eintrag hat höchstens vier Beziehungen, die Spanne lässt Platz zum Umbauen). */
export const INHALTE_VORKOMMEN_REGELN_MAX = 50;
export const INHALTE_VORKOMMEN_BEDINGUNGEN_MAX = 25;
/** Der Fingerabdruck einer Regel (`lore_rule.rule_key`, SHA-256 hex über Eintrag, Beziehung und die geordnete Kette der Bedingungen). */
const SCHLUESSEL_MUSTER = "^[0-9a-f]{64}$";
const REGEL_ID_MUSTER = "^[0-9]{1,18}$";

export const InhalteVorkommenAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        sort: Type.Optional(oneOf(INHALTE_VORKOMMEN_SORTIERUNGEN)),
        herkunft: Type.Optional(oneOf(INHALTE_HERKUENFTE)),
        stand: Type.Optional(oneOf(INHALTE_VORKOMMEN_STAENDE)),
        /** Nur diese Art (die Unterreiter Fauna, Flora, Waren, Spezies); ohne Angabe alle. */
        art: Type.Optional(oneOf(INHALTE_VORKOMMEN_ARTEN)),
    },
    strict,
);
export type InhalteVorkommenAnfrage = Static<typeof InhalteVorkommenAnfrage>;

/** Eine Zeile der Liste links. */
export const InhalteVorkommenZeile = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        art: oneOf(INHALTE_VORKOMMEN_ARTEN),
        gruppe: Type.Optional(Type.String()),
        /** Wie viele aktive Ortszeilen der Eintrag hat („Verknüpfungen“). */
        verknuepfungen: Type.Integer({ minimum: 0 }),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Von der Redaktion unterdrückt: Der Kreis ist leer. */
        stillgelegt: Type.Boolean(),
    },
    strict,
);
export type InhalteVorkommenZeile = Static<typeof InhalteVorkommenZeile>;

export const InhalteVorkommenListe = Type.Object(
    {
        total: Type.Integer({ minimum: 0 }),
        items: Type.Array(InhalteVorkommenZeile),
        /** Für den Reiter und die Legende: alle aktiven Einträge, davon von Hand angelegt oder geändert, und die unterdrückten. */
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
export type InhalteVorkommenListe = Static<typeof InhalteVorkommenListe>;

export const InhalteVorkommenZustand = oneOf(["active", "retired", "suppressed"] as const);
export type InhalteVorkommenZustand = Static<typeof InhalteVorkommenZustand>;

/** Woher eine Angabe stammt: das Wiki, die Hand (Legacy-Redaktion oder dieses Fenster) oder Legacy ohne Auskunft. */
export const INHALTE_VORKOMMEN_URSPRUENGE = ["wiki", "manual", "legacy"] as const;
export type InhalteVorkommenUrsprung = (typeof INHALTE_VORKOMMEN_URSPRUENGE)[number];

/** Ein Kartenobjekt, das eine Ortszeile trifft (abgeleitet aus `lore_place_target`, nie von Hand gesetzt). */
export const InhalteVorkommenTreffer = Type.Object(
    {
        kind: oneOf(INHALTE_TRAEGER),
        carrierId: Uuid(),
        name: Type.String(),
        subtype: Type.Optional(Type.String()),
    },
    strict,
);
export type InhalteVorkommenTreffer = Static<typeof InhalteVorkommenTreffer>;

/** Eine Ortszeile: „dieser Artikel kommt in … vor“. Die Identität einer Zeile ist `rowId`; das Ziel ist der Wiki-Schlüssel, bei einem ungeklärten Namen `null` mit dem Namen. */
export const InhalteVorkommenOrt = Type.Object(
    {
        rowId: Type.String({ pattern: "^[0-9]{1,18}$" }),
        relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        /** Der Schlüssel des Zielartikels; `null` bei einem ungeklärten Namen (siehe Kopf). */
        wikiKey: nullable(Type.String()),
        /** Der Anzeigename: der Titel des Zielartikels, sonst der Name des einen Treffers, sonst der Schlüssel. */
        name: Type.String(),
        /** `continent` heißt „gilt überall“ (ein Kontinentbegriff), `other` ein Kartenobjekt oder ein ungeklärter Artikel. */
        keyClass: oneOf(["continent", "other"] as const),
        /** `resolved` (ein Treffer), `ambiguous` (mehrere), `unresolved` (Kontinentbegriff ohne Träger), `unmatched` (kein aktiver Träger). */
        targetState: oneOf(["resolved", "ambiguous", "unresolved", "unmatched"] as const),
        /**
         * Die Rolle der Zeile (`lore_place.role`, Migration 0247, WI-0253 §23): Nur `ort` trifft Kartenobjekte; jede andere Rolle (Bezugspunkt, ausgenommen, Teil, Landschaftsart, Volk, früher, andere Welt) bleibt
         * als Link gespeichert, trifft aber nie. Eine Zeile ohne Rolle (der Bestand aus Legacys Zug, `NULL`) gilt als `ort`; hier steht immer ein Wort. Nur lesend: Der Editor vergibt keine Rolle.
         */
        rolle: oneOf(WIKISYNC_ORTSROLLEN),
        /** Die getroffenen Kartenobjekte, höchstens `INHALTE_VORKOMMEN_TREFFER_MAX`; `trefferGesamt` nennt die ganze Zahl. */
        treffer: Type.Array(InhalteVorkommenTreffer),
        trefferGesamt: Type.Integer({ minimum: 0 }),
        state: InhalteVorkommenZustand,
        ursprung: oneOf(INHALTE_VORKOMMEN_URSPRUENGE),
        herkunft: oneOf(INHALTE_HERKUENFTE),
    },
    strict,
);
export type InhalteVorkommenOrt = Static<typeof InhalteVorkommenOrt>;
export const INHALTE_VORKOMMEN_TREFFER_MAX = 8;

/**
 * Eine Bedingung einer Regel: die Fläche, die Landschaftsarten, die Klimaspanne und die Lage zu einer Linie; die Verknüpfung mit der vorigen steht in `joinOp` (`ohne` seit WI-0253 §24: "bisheriges Ergebnis minus diese Bedingung", streng von
 * links nach rechts). `wartetAuf` nennt den Wiki-Artikel einer Fläche, die es noch nicht gibt (Regel aus den Vorschlägen des WikiSync, F4): Eine solche Bedingung zählt nirgends.
 */
export const InhalteVorkommenBedingung = Type.Object(
    {
        joinOp: oneOf(["und", "oder", "ohne"] as const),
        /** Die Fläche, wenn die Bedingung eine nennt; `name` fehlt, wo es sie nicht (mehr) gibt (die Kennung aus Legacy bleibt). */
        flaeche: Type.Optional(Type.Object({ kennung: Type.String(), name: Type.Optional(Type.String()) }, strict)),
        /** Die Landschaftsarten (Ebene und Art, untereinander ODER). */
        arten: Type.Array(Type.Object({ ebene: Type.String(), art: Type.String() }, strict)),
        klima: Type.Optional(Type.Object({ von: Type.String(), bis: Type.String() }, strict)),
        wartetAuf: Type.Optional(Type.String()),
        /** Die Lage zu einer Linie (Richtung und ein oder zwei Orte der Karte mit Namen und Stelle); fehlt, wo die Bedingung keine hat. */
        lage: Type.Optional(WikisyncRegelLage),
    },
    strict,
);
export type InhalteVorkommenBedingung = Static<typeof InhalteVorkommenBedingung>;

/**
 * Eine Regel; nicht ausgewertet. Geändert wird sie nie an Ort und Stelle (die App darf an `lore_rule` nur anlegen und still legen): Wer sie ändert, legt eine neue an und legt die
 * alte still (`InhalteVorkommenRegelAenderung`).
 *
 * - `ruleKey` ist ihr Fingerabdruck. Er steht für „dasselbe sagen“: Derselbe Fingerabdruck in derselben Beziehung ist dieselbe Regel, auch wenn sie still liegt.
 * - `wikiBasis` und `wikiJetzt` gibt es nur an einer Regel von Hand (Herkunft `manual`), die einmal aus einer Wiki-Regel entstand: `wikiBasis` ist die Wiki-Fassung, von der sie
 *   ausging (Schlüssel und, wo sie noch bekannt ist, ihre Bedingungen), `wikiJetzt` die, die das Wiki seitdem sagt (`geaendert`: es sagt etwas anderes als die Basis). Beides
 *   braucht die Oberfläche zum „↺ Wiki-Fassung“ und zum Hinweis „Das Wiki sagt seitdem …“.
 */
export const InhalteVorkommenRegel = Type.Object(
    {
        ruleId: Type.String({ pattern: REGEL_ID_MUSTER }),
        relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        /** `manual` (von Hand gespeichert), `wiki` (aus dem Wiki-Text abgeleitet, Legacys „Regeln ableiten“) oder `legacy` ohne Auskunft. */
        ursprung: oneOf(INHALTE_VORKOMMEN_URSPRUENGE),
        state: InhalteVorkommenZustand,
        bedingungen: Type.Array(InhalteVorkommenBedingung),
        ruleKey: Type.String({ pattern: SCHLUESSEL_MUSTER }),
        wikiBasis: Type.Optional(
            Type.Object(
                {
                    schluessel: Type.String({ pattern: SCHLUESSEL_MUSTER }),
                    bedingungen: Type.Optional(Type.Array(WikisyncRegelBedingung)),
                },
                strict,
            ),
        ),
        wikiJetzt: Type.Optional(
            Type.Object(
                {
                    schluessel: Type.String({ pattern: SCHLUESSEL_MUSTER }),
                    bedingungen: Type.Array(WikisyncRegelBedingung),
                    geaendert: Type.Boolean(),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type InhalteVorkommenRegel = Static<typeof InhalteVorkommenRegel>;

/**
 * Der Vorschlag des WikiSync für diesen Eintrag (das Protokoll des jüngsten fertigen Laufs, `wikisync_regel_vorschlag`), wie ihn die Liste der Regelvorschläge im Admin-Fenster
 * kennt (`WikisyncRegelVorschlag`), aber am Eintrag selbst und ohne die Felder der Liste. Er schreibt nichts: Erst „Übernehmen“ im Reiter legt über den Entwurf und `lore.update` eine Regel an.
 *
 * - `veraltet`: Die Begriffstafel oder die Flächen haben sich seit dem Lauf geändert; der Vorschlag ist nach einem älteren Stand gerechnet.
 * - Je Beziehung: `schluessel` der vorgeschlagenen Regel (`null` bei `entfaellt`), `bisherIds` die Regeln des Eintrags, die der Vorschlag ersetzt, und `aktuell`, ob er noch gilt
 *   (die bisherigen Regeln sind noch die heutigen Wiki-Regeln und der Schlüssel ist keine, die die Redaktion unterdrückt hat).
 */
export const InhalteVorkommenWikiVorschlag = Type.Object(
    {
        lauf: Type.Integer(),
        am: nullable(Type.String()),
        veraltet: Type.Boolean(),
        typ: oneOf(WIKISYNC_REGEL_TYPEN),
        vorgewaehlt: Type.Boolean(),
        /** Warum der Vorschlag nicht wählbar ist (`manuell`, `redaktion`, `nichts`); `null`, wo er es ist. */
        sperre: nullable(Type.String()),
        original: Type.Array(WikisyncRegelOriginal),
        regeln: Type.Array(
            Type.Object(
                {
                    beziehung: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
                    status: oneOf(WIKISYNC_REGEL_STATUS),
                    schluessel: nullable(Type.String({ pattern: SCHLUESSEL_MUSTER })),
                    bedingungen: Type.Array(WikisyncRegelBedingung),
                    teile: Type.Array(WikisyncRegelTeil),
                    bisherIds: Type.Array(Type.String({ pattern: REGEL_ID_MUSTER })),
                    aktuell: Type.Boolean(),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type InhalteVorkommenWikiVorschlag = Static<typeof InhalteVorkommenWikiVorschlag>;

/**
 * Eine Quellenverknüpfung des Eintrags („Quellen des Eintrags“): Katalogreferenz, keine zweite Quellenliste. Titel, Typ, Rechte und Adresse gehören der Quelle im Katalog und
 * gelten für jeden Eintrag, der sie nennt; die Verknüpfung trägt nur Art des Belegs, Fundstelle und Notiz. Typ, „offiziell“ und Adresse stehen hier nur zum Lesen (Klappbox der
 * Quellen, WI-0254 `--weiter`): `sourceType` und `offiziell` kommen aus `feature_source`, `url` fehlt bei einer URL-losen Buchquelle.
 */
export const InhalteVorkommenQuelle = Type.Object(
    {
        sourceId: Uuid(),
        title: Type.String(),
        sourceType: oneOf(SOURCE_TYPES),
        offiziell: Type.Boolean(),
        url: Type.Optional(Type.String()),
        referenceKind: nullable(oneOf(SOURCE_REFERENCE_KINDS)),
        pages: nullable(Type.String()),
        note: nullable(Type.String()),
        state: InhalteVorkommenZustand,
        ursprung: oneOf(INHALTE_VORKOMMEN_URSPRUENGE),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /**
         * Was das Wiki an diesem Eintrag zu der Quelle zitiert (WI-0254 §12; derselbe Vergleich wie in den Karteneditoren, `gleichDemWiki`): `null`, wenn der Artikel des Eintrags sie nicht zitiert. Das Feld FEHLT, wo
         * es keinen Lauf mit Zitaten der Vorkommen gibt (`InhalteVorkommen.quellenWiki` fehlt dann auch): Dort ist die Herkunft unbekannt, die Oberfläche zeigt keinen Kreis.
         */
        wiki: Type.Optional(nullable(InhalteQuellenWiki)),
    },
    strict,
);
export type InhalteVorkommenQuelle = Static<typeof InhalteVorkommenQuelle>;

export const InhalteVorkommen = Type.Object(
    {
        id: Uuid(),
        revision: Type.Integer({ minimum: 1 }),
        /** Der Wiki-Schlüssel des Eintrags; nur lesbar. `null`: ein Eintrag der Redaktion ohne Wiki-Artikel, seine Identität ist `id`. */
        wikiKey: nullable(Type.String()),
        wikiUrl: Type.Optional(Type.String()),
        name: Type.String(),
        art: oneOf(INHALTE_VORKOMMEN_ARTEN),
        gruppe: nullable(Type.String()),
        lebensraum: nullable(Type.String()),
        synonyme: nullable(Type.String()),
        editorNote: nullable(Type.String()),
        ursprung: oneOf(INHALTE_VORKOMMEN_URSPRUENGE),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** `false`: von der Redaktion unterdrückt. */
        aktiv: Type.Boolean(),
        /** Die Pille nach der Kanon-Regel (`kanon.raenge`): der Namensraum der Wiki-Adresse, sonst die Quellen, sonst bei einem Eintrag ohne Artikel INOFFIZIELL | Avesmaps. */
        kanon: Type.Optional(SubjectCanon),
        /** Je Feld, woher der Wert kam (`lore_entry_field_origin`); was fehlt, ist nicht bekannt. Schlüssel sind die Namen des Vertrags. */
        feldUrsprung: Type.Record(Type.String(), oneOf(["wiki", "manual"] as const)),
        /** Alle Ortszeilen, aktive und stille. */
        orte: Type.Array(InhalteVorkommenOrt),
        regeln: Type.Array(InhalteVorkommenRegel),
        /** Der Vorschlag des WikiSync für diesen Eintrag; fehlt, wo es keinen Lauf, keine Tafel oder keine Aussage zum Eintrag gibt. */
        wikiVorschlag: Type.Optional(InhalteVorkommenWikiVorschlag),
        quellen: Type.Array(InhalteVorkommenQuelle),
        /**
         * Der Lauf des WikiSync, aus dem die Zitate zu `quellen[].wiki` stammen: der jüngste fertige mit dem Bereich „Quellen“, der Zitate der Vorkommen abgelegt hat. Fehlt, wo es keinen gibt (oder die Tafel noch
         * nicht lesbar ist, Migration 0251 und ihr Recht): Dann steht der Eintrag ohne Kreis nach dem Wiki da.
         */
        quellenWiki: Type.Optional(InhalteTraegerWikiStand),
    },
    strict,
);
export type InhalteVorkommen = Static<typeof InhalteVorkommen>;

/** Die Felder des Eintrags selbst; was fehlt, bleibt. Der Wiki-Schlüssel ist nicht dabei: Er ist die Identität. */
export const InhalteVorkommenFelder = Type.Object(
    {
        name: Type.Optional(Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX })),
        art: Type.Optional(oneOf(INHALTE_VORKOMMEN_ARTEN)),
        gruppe: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_GRUPPE_MAX }))),
        lebensraum: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_LEBENSRAUM_MAX }))),
        synonyme: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_SYNONYME_MAX }))),
        editorNote: Type.Optional(nullable(Type.String({ maxLength: INHALTE_KOMMENTAR_MAX }))),
        /** `false` unterdrückt den Eintrag, `true` holt ihn zurück. */
        aktiv: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteVorkommenFelder = Static<typeof InhalteVorkommenFelder>;

/**
 * Eine Änderung an den Ortszeilen. `add` nennt ein Kartenobjekt (`kind` + `carrierId`), einen Kontinentbegriff (`kontinent`) oder einen ungeklärten Namen
 * (`name`) und die Beziehung; eine unterdrückte oder gelöste Zeile desselben Ziels in derselben Beziehung kommt dabei zurück. `remove` und `restore`
 * nennen die Zeile.
 */
export const InhalteVorkommenOrtAenderung = Type.Union([
    Type.Object(
        {
            op: Type.Literal("add"),
            kind: oneOf(INHALTE_TRAEGER),
            carrierId: Uuid(),
            relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        },
        strict,
    ),
    Type.Object(
        {
            op: Type.Literal("add"),
            kontinent: oneOf(INHALTE_KONTINENTE),
            relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        },
        strict,
    ),
    // Ein ungeklärter Name (WI-0254, Migration 0235): kein Schlüssel, keine Treffer, nie gegen Kartenobjekte verglichen.
    Type.Object(
        {
            op: Type.Literal("add"),
            name: Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX }),
            relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        },
        strict,
    ),
    Type.Object({ op: Type.Literal("remove"), rowId: Type.String({ pattern: "^[0-9]{1,18}$" }) }, strict),
    Type.Object({ op: Type.Literal("restore"), rowId: Type.String({ pattern: "^[0-9]{1,18}$" }) }, strict),
]);
export type InhalteVorkommenOrtAenderung = Static<typeof InhalteVorkommenOrtAenderung>;

const QuelleAngaben = {
    referenceKind: Type.Optional(nullable(oneOf(SOURCE_REFERENCE_KINDS))),
    pages: Type.Optional(nullable(Type.String({ maxLength: INHALTE_SEITEN_MAX }))),
    note: Type.Optional(nullable(Type.String({ maxLength: INHALTE_NOTIZ_MAX }))),
};

/** Eine Änderung an den Quellenverknüpfungen; `add` holt eine gelöste oder unterdrückte Verknüpfung derselben Quelle zurück. */
export const InhalteVorkommenQuelleAenderung = Type.Union([
    Type.Object({ op: Type.Literal("add"), sourceId: Uuid(), ...QuelleAngaben }, strict),
    Type.Object({ op: Type.Literal("update"), sourceId: Uuid(), ...QuelleAngaben }, strict),
    Type.Object({ op: Type.Literal("remove"), sourceId: Uuid() }, strict),
    Type.Object({ op: Type.Literal("restore"), sourceId: Uuid() }, strict),
]);
export type InhalteVorkommenQuelleAenderung = Static<typeof InhalteVorkommenQuelleAenderung>;

/**
 * `lore.create`: ein Eintrag OHNE Wiki-Artikel (WI-0254, Vali wählte B). Name und Art sind Pflicht; ein gleichlautender Name ist kein Beweis für denselben
 * Eintrag und wird nie zusammengelegt oder abgelehnt. Der Eintrag bekommt eine eigene Kennung, keinen Wiki-Schlüssel und gehört danach der Redaktion
 * (Importschutz).
 */
export const InhalteVorkommenAnlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        name: Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX }),
        art: oneOf(INHALTE_VORKOMMEN_ARTEN),
        gruppe: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_GRUPPE_MAX }))),
        lebensraum: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_LEBENSRAUM_MAX }))),
        synonyme: Type.Optional(nullable(Type.String({ maxLength: INHALTE_VORKOMMEN_SYNONYME_MAX }))),
        editorNote: Type.Optional(nullable(Type.String({ maxLength: INHALTE_KOMMENTAR_MAX }))),
    },
    strict,
);
export type InhalteVorkommenAnlegenBody = Static<typeof InhalteVorkommenAnlegenBody>;

/** Die Antwort auf `lore.create`: die gewöhnliche Quittung, dazu die Kennung des neuen Eintrags. */
export const InhalteVorkommenAngelegt = Type.Object({ ...OperationReceipt.properties, publicId: Uuid() }, strict);
export type InhalteVorkommenAngelegt = Static<typeof InhalteVorkommenAngelegt>;

/**
 * Eine Bedingung im Körper (Paket R): die Verknüpfung mit dem bisherigen Ergebnis (streng von links nach rechts, bei der ersten bedeutungslos), die Landschaftsarten (Ebene und Art,
 * untereinander ODER; der Server prüft gegen `WIKISYNC_LANDSCHAFTSARTEN`), eine Fläche (`region.public_id`) oder der Wiki-Artikel einer Fläche, die es noch nicht gibt (`wartetAuf`),
 * und die Klimaspanne (beide Enden aus `WIKISYNC_KLIMAZONEN`). 🪤 **Leere Felder fehlen, sie sind nie `null`:** Fastifys ajv machte aus `null` im Körper 0 oder `""`
 * (`docs/regeln/entwicklung.md`). `flaeche` und `wartetAuf` schließen sich aus.
 *
 * `lage` (WI-0254, Lage zu einer Linie): die Richtung (`WIKISYNC_LAGE_RICHTUNGEN`) und ein oder zwei Orte als `place.public_id` (A–B ist B–A); der Server prüft, dass jeder Ort eine aktive Siedlung ist
 * (`WIKISYNC_LAGE_ORTSARTEN`) und dass nicht derselbe Ort zweimal steht. Eine Bedingung nur mit Lage ist gültig (sie trifft „alles südlich von …“). Fehlt die Lage, fehlt das Feld, nie `null`.
 */
export const InhalteVorkommenRegelBedingung = Type.Object(
    {
        verknuepfung: oneOf(["und", "oder", "ohne"] as const),
        arten: Type.Array(
            Type.Object({ ebene: Type.String({ maxLength: 40 }), art: Type.String({ maxLength: 80 }) }, strict),
            {
                maxItems: 64,
            },
        ),
        flaeche: Type.Optional(Uuid()),
        wartetAuf: Type.Optional(Type.String({ minLength: 1, maxLength: INHALTE_TITEL_MAX })),
        klima: Type.Optional(
            Type.Object({ von: Type.String({ maxLength: 40 }), bis: Type.String({ maxLength: 40 }) }, strict),
        ),
        lage: Type.Optional(
            Type.Object(
                {
                    richtung: oneOf(WIKISYNC_LAGE_RICHTUNGEN),
                    orte: Type.Array(Uuid(), { minItems: 1, maxItems: 2 }),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type InhalteVorkommenRegelBedingung = Static<typeof InhalteVorkommenRegelBedingung>;

/**
 * Eine Änderung an den Regeln (Paket R). `add` legt eine Regel von Hand an (Beziehung und 1 bis `INHALTE_VORKOMMEN_BEDINGUNGEN_MAX` Bedingungen); `ersetzt` nennt die Regel, die sie
 * ablöst (sie wird still gelegt: ändern heißt neu anlegen), `wikiBasis` den Schlüssel der Wiki-Fassung, von der die neue ausgeht. `remove` legt eine Regel still (eine aus Legacy oder
 * dem Wiki wird unterdrückt, eine eigene gelöst); gelöscht wird nie.
 */
export const InhalteVorkommenRegelAenderung = Type.Union([
    Type.Object(
        {
            op: Type.Literal("add"),
            relation: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
            bedingungen: Type.Array(InhalteVorkommenRegelBedingung, {
                minItems: 1,
                maxItems: INHALTE_VORKOMMEN_BEDINGUNGEN_MAX,
            }),
            ersetzt: Type.Optional(Type.String({ pattern: REGEL_ID_MUSTER })),
            wikiBasis: Type.Optional(Type.String({ pattern: SCHLUESSEL_MUSTER })),
        },
        strict,
    ),
    Type.Object({ op: Type.Literal("remove"), ruleId: Type.String({ pattern: REGEL_ID_MUSTER }) }, strict),
]);
export type InhalteVorkommenRegelAenderung = Static<typeof InhalteVorkommenRegelAenderung>;

/**
 * `lore.update`: Stammdaten, Ortszeilen, Quellen und Regeln gegen den gesehenen Stand (`baseRevision`), mindestens eines davon. Eine Regeländerung macht den Eintrag NICHT zu einem der
 * Redaktion (`source_system` bleibt): Nur die Regel gehört dann der Redaktion (WI-0254 `--weiter`, Entscheidung Claudia zu WI-0253 §26).
 */
export const InhalteVorkommenAendernBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        fields: Type.Optional(InhalteVorkommenFelder),
        orte: Type.Optional(Type.Array(InhalteVorkommenOrtAenderung, { maxItems: INHALTE_VORKOMMEN_ORTE_MAX })),
        quellen: Type.Optional(Type.Array(InhalteVorkommenQuelleAenderung, { maxItems: 200 })),
        regeln: Type.Optional(Type.Array(InhalteVorkommenRegelAenderung, { maxItems: INHALTE_VORKOMMEN_REGELN_MAX })),
    },
    strict,
);
export type InhalteVorkommenAendernBody = Static<typeof InhalteVorkommenAendernBody>;

/** Ein Ziel für eine Ortszeile: ein Kartenobjekt MIT Wiki-Schlüssel oder ein Kontinentbegriff. */
export const InhalteVorkommenZiel = Type.Union([
    Type.Object(
        {
            kind: oneOf(INHALTE_TRAEGER),
            carrierId: Uuid(),
            name: Type.String(),
            subtype: Type.Optional(Type.String()),
            wikiKey: Type.String(),
        },
        strict,
    ),
    Type.Object({ kontinent: oneOf(INHALTE_KONTINENTE), name: Type.String(), wikiKey: Type.String() }, strict),
]);
export type InhalteVorkommenZiel = Static<typeof InhalteVorkommenZiel>;

export const InhalteVorkommenZiele = Type.Object({ items: Type.Array(InhalteVorkommenZiel) }, strict);
export type InhalteVorkommenZiele = Static<typeof InhalteVorkommenZiele>;

/** Die Suche nach Zielen (`q` mindestens zwei Zeichen). */
export const InhalteVorkommenZieleAnfrage = Type.Object(
    {
        q: Type.String({ minLength: 1, maxLength: 120 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    strict,
);
export type InhalteVorkommenZieleAnfrage = Static<typeof InhalteVorkommenZieleAnfrage>;

/** Die Suche nach Flächen für eine Bedingung (`q` darf fehlen: dann die ersten, nach Name). */
export const InhalteVorkommenFlaechenAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 120 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    strict,
);
export type InhalteVorkommenFlaechenAnfrage = Static<typeof InhalteVorkommenFlaechenAnfrage>;

/**
 * Eine Fläche zur Wahl in einer Bedingung: eine aktive Landschaft (`region`) außerhalb der Klima-Ebene. `kennung` ist `region.public_id`, `ebene` und `art` sagen, was sie ist,
 * `wikiTitel` der Wiki-Artikel, der ihr zugewiesen ist (fehlt, wo keiner ist).
 */
export const InhalteVorkommenFlaeche = Type.Object(
    {
        kennung: Uuid(),
        name: Type.String(),
        ebene: Type.String(),
        art: Type.Optional(Type.String()),
        wikiTitel: Type.Optional(Type.String()),
    },
    strict,
);
export type InhalteVorkommenFlaeche = Static<typeof InhalteVorkommenFlaeche>;

export const InhalteVorkommenFlaechen = Type.Object({ items: Type.Array(InhalteVorkommenFlaeche) }, strict);
export type InhalteVorkommenFlaechen = Static<typeof InhalteVorkommenFlaechen>;

/** Die Suche nach Orten für die Lage zu einer Linie (`q` darf fehlen: dann die Metropolen und Großstädte, nach Größe und Name). */
export const InhalteVorkommenLageOrteAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 120 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    strict,
);
export type InhalteVorkommenLageOrteAnfrage = Static<typeof InhalteVorkommenLageOrteAnfrage>;

/**
 * Ein Ort zur Wahl in der Lage einer Bedingung: eine aktive Siedlung der Karte (`WIKISYNC_LAGE_ORTSARTEN`). `kennung` ist `place.public_id`, `art` die Ortsgröße (`place.subtype`), `x` und `y` die Stelle in
 * Kartenkoordinaten (`y` nach Norden, wie `ST_Y`), mit der die Oberfläche die Skizze zeichnet.
 */
export const InhalteVorkommenLageOrt = Type.Object(
    {
        kennung: Uuid(),
        name: Type.String(),
        art: oneOf(WIKISYNC_LAGE_ORTSARTEN),
        x: Type.Number(),
        y: Type.Number(),
    },
    strict,
);
export type InhalteVorkommenLageOrt = Static<typeof InhalteVorkommenLageOrt>;

export const InhalteVorkommenLageOrte = Type.Object({ items: Type.Array(InhalteVorkommenLageOrt) }, strict);
export type InhalteVorkommenLageOrte = Static<typeof InhalteVorkommenLageOrte>;

/**
 * Der Umriss Aventuriens für die Skizze der Lage: `pfad` ist ein SVG-Pfad (`ST_AsSVG`, die Fläche der Region „Aventurien“ vereinfacht; `ST_AsSVG` dreht `y` schon um, wer die Orte dazulegt, nimmt `-y`), `rahmen`
 * die Grenzen der Fläche in Kartenkoordinaten. Er ändert sich nur mit der Karte; die Route antwortet mit ETag und `private, max-age=3600`.
 */
export const InhalteVorkommenUmriss = Type.Object(
    {
        pfad: Type.String(),
        rahmen: Type.Object({ x0: Type.Number(), x1: Type.Number(), y0: Type.Number(), y1: Type.Number() }, strict),
    },
    strict,
);
export type InhalteVorkommenUmriss = Static<typeof InhalteVorkommenUmriss>;
