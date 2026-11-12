import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import {
    INHALTE_HERKUENFTE,
    INHALTE_KOMMENTAR_MAX,
    INHALTE_KORPUS_VORGABEN,
    INHALTE_LIZENZ_AUSSAGEN,
    INHALTE_NENNUNG_MAX,
    InhalteLizenz,
} from "./inhalte-quellen.ts";
import { MutationEnvelope, OperationReceipt, UUID_PATTERN } from "./operation.ts";
import { SOURCE_TYPES } from "./subject.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Korpora“ (WI-0254, Runde 4; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`).
 *
 *     GET  /api/editor/inhalte/korpora                    die Korpora (Domains), seitenweise, mit Suche und Anzeigeform           use_editor_menu
 *     GET  /api/editor/inhalte/korpora/:id                ein Korpus: Angaben, Vorgabe, Quellen der Domain                       use_editor_menu
 *     POST /api/editor/inhalte/korpora                    corpus.create: einen Korpus für eine Domain anlegen                     manage_sources
 *     POST /api/editor/inhalte/korpora/:id/wirkung        „Wirkung prüfen“: was eine Änderung bei den Quellen täte (nur lesend)    manage_sources
 *     POST /api/editor/inhalte/korpora/:id/update         corpus.update: Angaben und Vorgabe in EINER Operation                    manage_sources
 *
 * - 🔴 **Ein Korpus ist das Angebot hinter den Quellen EINER registrierbaren Domain**, keine Quelle und kein Kartenobjekt. Die Identität ist der
 *   Schlüssel, die Domain (`corpus_key`), und lässt sich nach dem Anlegen nicht ändern; `id` (`public_id`, Migration 0236) ist nur die Kennung der
 *   Schnittstelle und des Protokolls. Die Zugehörigkeit einer Quelle kommt allein aus ihrer Adresse, nie aus einem Häkchen oder einem Namen. Der
 *   Name des Angebots (`label`) ersetzt nie den Titel einer Seite; die Anzeigeform (`form`) sagt nur, welcher von beiden vorn steht.
 * - 🔴 **Wirkung (Vali, WI-0254 §5):** Bei der Anzeigeform `belegstelle` schreibt eine Änderung an Art, „offiziell“, Lizenz oder Namensnennung auf ALLE
 *   Quellen der Domain durch; Ausnahmen je Quelle gibt es nicht („überall heißt überall“). Bei `werk` und unentschiedener Form schreibt nichts durch: Die
 *   Felder bleiben an der Quelle und sind am Korpus gesperrt. Eine Vorgabe „nicht erfasst“ (Lizenz) oder leer (Art, offiziell, Namensnennung) gibt es
 *   nicht: Sie schreibt nie durch und nimmt nichts zurück. Das Durchschreiben ist EINE Operation mit Revision, 409 und Protokoll in einer Transaktion;
 *   der Legacy-Zug rechnet die Vorgabe nach dem Abgleich erneut auf die Quellen.
 * - **„Wirkung prüfen“** rechnet vor dem Speichern je Feld, wie viele Quellen sich ändern und wie viele davon heute einen anderen Wert tragen, der
 *   überschrieben wird. Ab `INHALTE_KORPUS_BESTAETIGUNG_AB` Quellen, die sich ändern, verlangt `update` die Bestätigung (`bestaetigt`), sonst 409
 *   `corpus_confirm_required`.
 * - Jede Schreibroute trägt `MutationEnvelope` und antwortet mit `OperationReceipt`; 409 `edit_conflict` bei veraltetem Stand, 423 `map_locked` und
 *   `map_editing_off`, 503 `map_import_running`.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const INHALTE_KORPORA_URL = "/api/editor/inhalte/korpora";
export const inhalteKorpusUrl = (id: string): string => `${INHALTE_KORPORA_URL}/${id}`;
export const inhalteKorpusAendernUrl = (id: string): string => `${INHALTE_KORPORA_URL}/${id}/update`;
export const inhalteKorpusWirkungUrl = (id: string): string => `${INHALTE_KORPORA_URL}/${id}/wirkung`;

/** Die Anzeigeform eines Korpus (`source_corpus.form`): leer heißt unentschieden und verhält sich wie `werk`. */
export const INHALTE_KORPUS_FORMEN = ["", "werk", "belegstelle"] as const;
export type InhalteKorpusForm = (typeof INHALTE_KORPUS_FORMEN)[number];

/** Der Filter der Liste nach Anzeigeform („Unentschieden“ ist die leere Form). */
export const INHALTE_KORPUS_ANZEIGEFORMEN = ["belegstelle", "werk", "unentschieden"] as const;
export type InhalteKorpusAnzeigeform = (typeof INHALTE_KORPUS_ANZEIGEFORMEN)[number];

export const INHALTE_KORPORA_SORTIERUNGEN = ["title", "title_desc"] as const;
export type InhalteKorporaSortierung = (typeof INHALTE_KORPORA_SORTIERUNGEN)[number];

/** Ab so vielen Quellen, die sich ändern würden, fragt das Fenster nach (Legacy: ab 10 Objekten; Vali 2026-10-26: ab 10 Quellen). */
export const INHALTE_KORPUS_BESTAETIGUNG_AB = 10;
/** So viele Quellen trägt eine Antwort höchstens; `quellenGesamt` nennt die ganze Zahl (f-shop.de hat über 600). */
export const INHALTE_KORPUS_QUELLEN_MAX = 300;
/** Die Längen, die Legacy kennt (`source-corpus.php`: Name 200, Schlüssel 190). */
export const INHALTE_KORPUS_LABEL_MAX = 200;
export const INHALTE_KORPUS_SCHLUESSEL_MAX = 190;

export const InhalteKorporaAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        sort: Type.Optional(oneOf(INHALTE_KORPORA_SORTIERUNGEN)),
        form: Type.Optional(oneOf(INHALTE_KORPUS_ANZEIGEFORMEN)),
        herkunft: Type.Optional(oneOf(INHALTE_HERKUENFTE)),
    },
    strict,
);
export type InhalteKorporaAnfrage = Static<typeof InhalteKorporaAnfrage>;

/** Eine Zeile der Liste links. */
export const InhalteKorpusZeile = Type.Object(
    {
        id: Uuid(),
        /** Der Schlüssel: die registrierbare Domain. */
        key: Type.String(),
        /** Der Name des Angebots; die Domain, wo noch keiner vergeben ist. */
        title: Type.String(),
        form: oneOf(INHALTE_KORPUS_FORMEN),
        /** Wie viele aktive Quellen die Domain hat. */
        quellen: Type.Integer({ minimum: 0 }),
        herkunft: oneOf(INHALTE_HERKUENFTE),
    },
    strict,
);
export type InhalteKorpusZeile = Static<typeof InhalteKorpusZeile>;

export const InhalteKorporaListe = Type.Object(
    {
        total: Type.Integer({ minimum: 0 }),
        items: Type.Array(InhalteKorpusZeile),
        /** Für den Reiter und die Legende: alle aktiven Korpora und davon die von der Redaktion angelegten oder geänderten. */
        zahlen: Type.Object({ aktiv: Type.Integer({ minimum: 0 }), editor: Type.Integer({ minimum: 0 }) }, strict),
    },
    strict,
);
export type InhalteKorporaListe = Static<typeof InhalteKorporaListe>;

/** Eine Quelle der Domain (rechte Spalte): was sie heute trägt und wo sie von der Vorgabe abweicht. */
export const InhalteKorpusQuelle = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        url: nullable(Type.String()),
        sourceType: oneOf(SOURCE_TYPES),
        isOfficial: Type.Boolean(),
        /** Wie viele Träger die Quelle zitieren (nur aktive Verknüpfungen). */
        uses: Type.Integer({ minimum: 0 }),
        /** Die Felder, in denen die Quelle heute von der Vorgabe des Korpus abweicht (nur bei einer Belegstelle mit Vorgabe). */
        abweichend: Type.Array(oneOf(INHALTE_KORPUS_VORGABEN)),
    },
    strict,
);
export type InhalteKorpusQuelle = Static<typeof InhalteKorpusQuelle>;

export const InhalteKorpusEintrag = Type.Object(
    {
        id: Uuid(),
        revision: Type.Integer({ minimum: 1 }),
        /** Die registrierbare Domain; unveränderlich. */
        key: Type.String(),
        /** Der Name des Angebots; leer, wo noch keiner vergeben ist. */
        label: Type.String(),
        form: oneOf(INHALTE_KORPUS_FORMEN),
        /** Die Vorgabe für die Art der Quellen; `null`: keine Vorgabe. */
        sourceType: nullable(oneOf(SOURCE_TYPES)),
        /** Die Vorgabe für „offiziell“; `null`: nicht eingestuft. */
        isOfficial: nullable(Type.Boolean()),
        /** „Nicht erfasst“ ist keine Vorgabe und heißt nie „keine Lizenz“. */
        lizenzAussage: oneOf(INHALTE_LIZENZ_AUSSAGEN),
        lizenzKey: nullable(Type.String()),
        attribution: nullable(Type.String()),
        editorNote: nullable(Type.String()),
        herkunft: oneOf(INHALTE_HERKUENFTE),
        /** Schreibt eine Änderung an Art, „offiziell“, Lizenz und Namensnennung auf die Quellen durch? Nur bei der Anzeigeform Belegstelle. */
        schreibtDurch: Type.Boolean(),
        /** Höchstens `INHALTE_KORPUS_QUELLEN_MAX` Quellen der Domain, nach Titel; `quellenGesamt` zählt alle aktiven. */
        quellen: Type.Array(InhalteKorpusQuelle),
        quellenGesamt: Type.Integer({ minimum: 0 }),
        /** Wie viele verschiedene Träger die Quellen der Domain zitieren (gerechnet, nie gespeichert). */
        traegerGesamt: Type.Integer({ minimum: 0 }),
        /** Wie viele Quellen heute in einem Feld von der Vorgabe abweichen (nur bei Belegstelle). */
        abweichendGesamt: Type.Integer({ minimum: 0 }),
        /** Die Lizenzen des gemeinsamen Katalogs für die Auswahl. */
        lizenzen: Type.Array(InhalteLizenz),
    },
    strict,
);
export type InhalteKorpusEintrag = Static<typeof InhalteKorpusEintrag>;

/** Die Felder des Korpus selbst; was fehlt, bleibt. Der Schlüssel ist nicht dabei: Er ist die Identität. */
export const InhalteKorpusFelder = Type.Object(
    {
        label: Type.Optional(Type.String({ maxLength: INHALTE_KORPUS_LABEL_MAX })),
        form: Type.Optional(oneOf(INHALTE_KORPUS_FORMEN)),
        sourceType: Type.Optional(nullable(oneOf(SOURCE_TYPES))),
        isOfficial: Type.Optional(nullable(Type.Boolean())),
        lizenzAussage: Type.Optional(oneOf(INHALTE_LIZENZ_AUSSAGEN)),
        lizenzKey: Type.Optional(nullable(Type.String({ maxLength: 120 }))),
        attribution: Type.Optional(nullable(Type.String({ maxLength: INHALTE_NENNUNG_MAX }))),
        editorNote: Type.Optional(nullable(Type.String({ maxLength: INHALTE_KOMMENTAR_MAX }))),
    },
    strict,
);
export type InhalteKorpusFelder = Static<typeof InhalteKorpusFelder>;

/** `corpus.update`: Angaben und Vorgabe gegen den gesehenen Stand (`baseRevision`), mindestens ein Feld. */
export const InhalteKorpusAendernBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        fields: InhalteKorpusFelder,
        /** Die Bestätigung, wenn die Änderung ab `INHALTE_KORPUS_BESTAETIGUNG_AB` Quellen trifft (sonst 409 `corpus_confirm_required`). */
        bestaetigt: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type InhalteKorpusAendernBody = Static<typeof InhalteKorpusAendernBody>;

/**
 * `corpus.create`: ein Korpus für eine registrierbare Domain. Der Schlüssel wird gegen dieselbe Regel geprüft, die ihn aus einer Adresse rechnet (kein
 * `www`, kein Pfad); ein vorhandener ist 409 `corpus_exists`. Er ist danach unveränderlich.
 */
export const InhalteKorpusAnlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        key: Type.String({ minLength: 1, maxLength: INHALTE_KORPUS_SCHLUESSEL_MAX }),
        label: Type.Optional(Type.String({ maxLength: INHALTE_KORPUS_LABEL_MAX })),
    },
    strict,
);
export type InhalteKorpusAnlegenBody = Static<typeof InhalteKorpusAnlegenBody>;

/** Die Antwort auf `corpus.create`: die gewöhnliche Quittung, dazu die Kennung des neuen Korpus. */
export const InhalteKorpusAngelegt = Type.Object({ ...OperationReceipt.properties, publicId: Uuid() }, strict);
export type InhalteKorpusAngelegt = Static<typeof InhalteKorpusAngelegt>;

/** „Wirkung prüfen“: die Felder, die der Entwurf ändern würde. Rechnet nur, schreibt nichts. */
export const InhalteKorpusWirkungBody = Type.Object({ fields: InhalteKorpusFelder }, strict);
export type InhalteKorpusWirkungBody = Static<typeof InhalteKorpusWirkungBody>;

export const InhalteKorpusWirkungFeld = Type.Object(
    {
        feld: oneOf(INHALTE_KORPUS_VORGABEN),
        /** Die Vorgabe, die danach gilt (Text für die Anzeige; die Art als Schlüssel, die Lizenz als Schlüssel oder Aussage). */
        wert: Type.String(),
        /** Wie viele Quellen sich in diesem Feld ändern. */
        aendern: Type.Integer({ minimum: 0 }),
        /** Wie viele davon heute einen anderen Wert tragen, der überschrieben wird (nicht den leeren oder „nicht erfassten“). */
        ueberschreibt: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type InhalteKorpusWirkungFeld = Static<typeof InhalteKorpusWirkungFeld>;

export const InhalteKorpusWirkung = Type.Object(
    {
        /** Die Anzeigeform nach der Änderung. */
        form: oneOf(INHALTE_KORPUS_FORMEN),
        /** Schreibt die Änderung auf die Quellen durch (Belegstelle)? Sonst ist `felder` leer. */
        schreibtDurch: Type.Boolean(),
        quellenGesamt: Type.Integer({ minimum: 0 }),
        traegerGesamt: Type.Integer({ minimum: 0 }),
        /** Wie viele verschiedene Quellen sich in mindestens einem Feld ändern. */
        aendernGesamt: Type.Integer({ minimum: 0 }),
        felder: Type.Array(InhalteKorpusWirkungFeld),
        bestaetigungAb: Type.Integer({ minimum: 1 }),
        /** Verlangt das Speichern die Bestätigung (`aendernGesamt` ab der Schwelle)? */
        bestaetigungNoetig: Type.Boolean(),
    },
    strict,
);
export type InhalteKorpusWirkung = Static<typeof InhalteKorpusWirkung>;
