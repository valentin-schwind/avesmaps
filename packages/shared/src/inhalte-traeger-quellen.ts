import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import {
    INHALTE_NOTIZ_MAX,
    INHALTE_SEITEN_MAX,
    InhalteVerwendungState,
    InhalteVerwendungVorher,
} from "./inhalte-quellen.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";
import { SOURCE_REFERENCE_KINDS, SOURCE_TYPES } from "./subject.ts";

/**
 * Die Quellen eines Kartenobjekts in den Editoren der Karte (WI-0254 §12; Vali: „genau das bräuchten wir in den anderen editoren“): die Klappbox im Ortseditor, im Gebietseditor,
 * im Landschaftseditor („Derographie“) und im Wegeditor, bearbeitet wie der Reiter „Vorkommen“; dazu der Gipfel und jede Landmarke (WI-0271 L4, Reiter „Quellen“ im Fenster der Landmarke). Die Verknüpfungen hängen am Objekt (`<träger>_source`, Migration 0066); dieser Weg
 * liest und schreibt sie von dort her, `source.update` (`inhalte-quellen.ts`) von der Quelle her. Beide Wege teilen EINEN Schreibkern (`inhalte/verknuepfung-schreiben.ts`).
 *
 *     GET  /api/editor/inhalte/traeger/:kind/:id/quellen   die Quellen des Objekts mit dem Stand des Wikis        use_editor_menu
 *     POST /api/editor/inhalte/traeger/:kind/:id/quellen   traeger.sources: anhängen, ändern, lösen, holen        manage_sources
 *
 * - `kind` ist `place`, `territory`, `area` (die Landschaft, Tafel `region`), `peak` (Gipfel und Landmarken, Tafel `terrain_peak`) oder `path`. `id` ist die öffentliche Kennung des Objekts; beim Weg die eines Abschnitts der Straße
 *   (jeder Abschnitt derselben Straße führt zu derselben Antwort, die Straße ist die Gruppe des Wege-Fensters).
 * - 🔴 **Ein Weg hat seine Quellen als Ganzes** (Betreiber 2026-10-28: „wege sind in den quellen oder im wiki als ganzes beschrieben, einzelne abschnitte sind technische details von uns“).
 *   Die Verknüpfungen hängen technisch je Abschnitt (`path_source`); die Oberfläche kennt nur die Straße. Gelesen werden sie über die Abschnitte zusammengefasst (`abschnitte` bleibt für
 *   den Kreis: voll nur, wenn JEDER Abschnitt dem Zitat des Wikis gleicht; die Oberfläche zeigt es nicht). Geschrieben wird immer auf der GANZEN Straße: Jede Änderung macht die Quelle auf
 *   allen Abschnitten einheitlich (anhängen und holen: jeder Abschnitt trägt sie danach aktiv, mit denselben Angaben; ändern: die Angaben gelten allen, wer sie noch nicht trug, bekommt
 *   sie dazu; lösen: auf allen Abschnitten, die sie tragen). `vorher` ist die zusammengefasste Sicht, die die Oberfläche las.
 * - **Herkunft ist der Vergleich mit dem Wiki.** Ob eine Angabe aus Legacy, aus dem Wiki oder von Hand stammt, ist egal: Das Wiki zitiert dieselbe Quelle am selben Objekt mit Art, Seiten
 *   und Notiz, oder es tut es nicht. `wiki` je Quelle ist dieses Zitat (`null`: nicht zitiert oder nicht bekannt), `wiki` oben der Lauf, aus dem es stammt (`null`: es gibt keinen Lauf
 *   mit Zitaten, dann ist jede Quelle „unbekannt“). Der Vergleich ist `gleichDemWiki` (`quellen-wiki.ts`). Kein Satz „Nicht im Wiki“: Der Kreis genügt.
 * - **Alle Zustände**, die aktiven zuerst, dann nach der Reihenfolge am Objekt (`position`). Eine Quelle, die die Redaktion stillgelegt hat (`aktiv: false` am Katalog), fehlt, wie im
 *   Infopanel. Gelöst wird nie gelöscht: Eine Verknüpfung aus Legacy oder dem Wiki wird unterdrückt (`suppressed`), eine eigene gelöst (`retired`); beide lassen sich holen.
 * - **Schreiben:** je Änderung `vorher`, was die Oberfläche von der Verknüpfung sah (`null`: es gab keine). Stimmt es nicht mehr mit dem Stand überein, ist die ganze Operation 409
 *   `edit_conflict` (mit wer und wann, wenn das Fachprotokoll es weiß); nichts wird halb geschrieben. Die Revision des Objekts steigt nicht (eine Quelle ändert weder Linie noch Fläche
 *   noch Namen); das Etikett des Objekts (Kanon, Rang 1 bis 3) wird in derselben Transaktion neu gerechnet (beim Weg das jedes Abschnitts). An ein stilles Objekt oder eine stillgelegte Quelle hängt nichts an (400).
 * - Fehler wie bei jeder Schreibroute der Karte: 400 `validation_failed` (mit `details.issues`), 403, 404, 409, 423 `map_locked` und `map_editing_off`, 503 `map_import_running`.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

/** Die Arten von Objekten, deren Quellen dieser Weg liest und schreibt. Der Gipfel (`peak`) ist jede Zeile von `terrain_peak`, also auch jede Landmarke ohne Gelände (WI-0271 L4); er hat keine Klappbox, sondern den Reiter „Quellen“ seines Fensters. */
export const INHALTE_TRAEGER_QUELLEN_ARTEN = ["place", "territory", "area", "peak", "path"] as const;
export type InhalteTraegerQuellenArt = (typeof INHALTE_TRAEGER_QUELLEN_ARTEN)[number];
/** Die höchste Zahl an Änderungen in einer Operation. */
export const INHALTE_TRAEGER_QUELLEN_MAX = 50;

/** Warum die Quellen eines Objekts sich nicht ändern lassen: das Objekt ist still (von der Karte genommen, gelöscht oder stillgelegt). */
export const INHALTE_TRAEGER_QUELLEN_GRUENDE = ["still"] as const;
export type InhalteTraegerQuellenGrund = (typeof INHALTE_TRAEGER_QUELLEN_GRUENDE)[number];

export const inhalteTraegerQuellenUrl = (kind: string, id: string): string =>
    `/api/editor/inhalte/traeger/${kind}/${id}/quellen`;

export const InhalteTraegerQuellenParams = Type.Object(
    { kind: oneOf(INHALTE_TRAEGER_QUELLEN_ARTEN), id: Uuid() },
    strict,
);
export type InhalteTraegerQuellenParams = Static<typeof InhalteTraegerQuellenParams>;

/** Der Lauf des WikiSync, aus dem die Zitate stammen: der jüngste fertige mit dem Bereich „Quellen“ und mit abgelegten Zitaten. */
export const InhalteTraegerWikiStand = Type.Object(
    {
        laufId: Type.Integer(),
        /** Der Stand des Wikis, aus dem gerechnet wurde (Datum oder Zeit des Dumps); `null`: unbekannt. */
        dumpStand: nullable(Type.String()),
        beendetAm: nullable(Type.String()),
    },
    strict,
);
export type InhalteTraegerWikiStand = Static<typeof InhalteTraegerWikiStand>;

/** Was das Wiki zu einer Quelle an diesem Objekt zitiert: Art des Belegs, Seiten, Notiz. */
export const InhalteQuellenWiki = Type.Object(
    {
        art: nullable(oneOf(SOURCE_REFERENCE_KINDS)),
        seiten: nullable(Type.String()),
        notiz: nullable(Type.String()),
    },
    strict,
);
export type InhalteQuellenWiki = Static<typeof InhalteQuellenWiki>;

/** Beim Weg: wie viele Abschnitte der Straße die Quelle tragen und ob sie überall dasselbe sagen. Die Oberfläche zeigt es nicht (Abschnitte sind ein technisches Detail); der Kreis braucht `gleichDemWiki`. */
export const InhalteTraegerAbschnitte = Type.Object(
    {
        /** Abschnitte mit aktiver Verknüpfung. */
        mit: Type.Integer({ minimum: 0 }),
        /** Abschnitte der Straße. */
        von: Type.Integer({ minimum: 1 }),
        /** Alle Abschnitte mit aktiver Verknüpfung tragen dieselbe Art, dieselben Seiten und dieselbe Notiz. Sonst stehen oben die Angaben des ersten Abschnitts. */
        einheitlich: Type.Boolean(),
        /** Jeder Abschnitt mit aktiver Verknüpfung gleicht dem Zitat des Wikis zu seinem Artikel (nur dann ist der Kreis voll). */
        gleichDemWiki: Type.Boolean(),
    },
    strict,
);
export type InhalteTraegerAbschnitte = Static<typeof InhalteTraegerAbschnitte>;

/** Eine Quelle an diesem Objekt: ihre Angaben dort, ihr Zustand und das Zitat des Wikis. */
export const InhalteTraegerQuelle = Type.Object(
    {
        sourceId: Uuid(),
        title: Type.String(),
        sourceType: oneOf(SOURCE_TYPES),
        offiziell: Type.Boolean(),
        url: nullable(Type.String()),
        referenceKind: nullable(oneOf(SOURCE_REFERENCE_KINDS)),
        pages: nullable(Type.String()),
        note: nullable(Type.String()),
        /** Beim Weg: `active`, wenn ein Abschnitt sie aktiv trägt, sonst `retired`, wenn einer sie gelöst hat, sonst `suppressed`. */
        state: InhalteVerwendungState,
        /** Wann die Verknüpfung zuletzt geändert wurde (beim Weg die jüngste). */
        updatedAt: Type.String(),
        wiki: nullable(InhalteQuellenWiki),
        abschnitte: Type.Optional(InhalteTraegerAbschnitte),
        /** Der Korpus der Quelle (Name, wie das Frontend ihn nennt); `null` oder fehlend, wo sie keinen hat oder er keinen Namen trägt. */
        korpus: Type.Optional(nullable(Type.Object({ label: Type.String() }, strict))),
    },
    strict,
);
export type InhalteTraegerQuelle = Static<typeof InhalteTraegerQuelle>;

export const InhalteTraegerQuellen = Type.Object(
    {
        traeger: Type.Object(
            {
                kind: oneOf(INHALTE_TRAEGER_QUELLEN_ARTEN),
                id: Uuid(),
                name: Type.String(),
                /** Das Objekt steht auf der Karte beziehungsweise ist aktiv. Beim Weg: die Straße ist auf der Karte. */
                aktiv: Type.Boolean(),
            },
            strict,
        ),
        /** Lässt sich hier schreiben? Nicht bei einem stillen Objekt (beim Weg: eine Straße, die nicht auf der Karte ist). Das Recht des Editors prüft der Server an der Schreibroute; die Antwort fragt es nicht. */
        aenderbar: Type.Boolean(),
        grund: Type.Optional(oneOf(INHALTE_TRAEGER_QUELLEN_GRUENDE)),
        /** Der Lauf, aus dem die Zitate stammen; `null`, wo es keinen gibt (dann ist `wiki` je Quelle immer `null`). */
        wiki: nullable(InhalteTraegerWikiStand),
        quellen: Type.Array(InhalteTraegerQuelle),
    },
    strict,
);
export type InhalteTraegerQuellen = Static<typeof InhalteTraegerQuellen>;

/**
 * Was die Oberfläche von der Verknüpfung sah, als sie die Änderung entwarf. `pages` und `note` ohne Leerraum an den Rändern; leer ist `null`. Dieselbe Form trägt `source.update` für einen
 * Weg (`InhalteVerwendungVorher`, `inhalte-quellen.ts`): EIN Schema für beide Wege.
 */
export const InhalteTraegerQuellenVorher = InhalteVerwendungVorher;
export type InhalteTraegerQuellenVorher = InhalteVerwendungVorher;

const Angaben = {
    referenceKind: Type.Optional(nullable(oneOf(SOURCE_REFERENCE_KINDS))),
    pages: Type.Optional(nullable(Type.String({ maxLength: INHALTE_SEITEN_MAX }))),
    note: Type.Optional(nullable(Type.String({ maxLength: INHALTE_NOTIZ_MAX }))),
};
const Bezug = { sourceId: Uuid(), vorher: nullable(InhalteTraegerQuellenVorher) };

/**
 * Eine Änderung an einer Verknüpfung. `add` hängt an oder holt eine gelöste oder unterdrückte zurück (mit den Angaben); `update` ändert Art, Seiten, Notiz einer aktiven; `remove`
 * löst; `restore` holt zurück und behält die Angaben. Fehlt eine Angabe, bleibt sie; `null` leert sie.
 */
export const InhalteTraegerQuellenAenderung = Type.Union([
    Type.Object({ op: Type.Literal("add"), ...Bezug, ...Angaben }, strict),
    Type.Object({ op: Type.Literal("update"), ...Bezug, ...Angaben }, strict),
    Type.Object({ op: Type.Literal("remove"), ...Bezug }, strict),
    Type.Object({ op: Type.Literal("restore"), ...Bezug }, strict),
]);
export type InhalteTraegerQuellenAenderung = Static<typeof InhalteTraegerQuellenAenderung>;

/** `traeger.sources`: die Änderungen eines Objekts in EINER Operation, gegen den gesehenen Stand je Verknüpfung (`vorher`). */
export const InhalteTraegerQuellenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        aenderungen: Type.Array(InhalteTraegerQuellenAenderung, {
            minItems: 1,
            maxItems: INHALTE_TRAEGER_QUELLEN_MAX,
        }),
    },
    strict,
);
export type InhalteTraegerQuellenBody = Static<typeof InhalteTraegerQuellenBody>;
