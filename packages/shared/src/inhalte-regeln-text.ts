import { Type, type Static, type TLiteral, type TUnion } from "@sinclair/typebox";
import {
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    INHALTE_VORKOMMEN_URL,
    InhalteVorkommenBedingung,
} from "./inhalte-vorkommen.ts";
import { MutationEnvelope, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * „Regeln als Text“ im Reiter „Vorkommen“ (WI-0254 §13 und §14; Bauauftrag Vali 2026-10-31, Knopfwahl „Jetzt bauen“). Regeln für viele Einträge auf
 * einmal in der Wiki-Kurzschrift schreiben, prüfen und anlegen; dazu der Rückweg „Als Text“ für die Regeln eines Eintrags.
 *
 *     POST /api/editor/inhalte/vorkommen-text/pruefen       den Text lesen und gegen den Katalog auflösen, nur lesend              use_editor_menu
 *     POST /api/editor/inhalte/vorkommen-text/uebernehmen   lore.rules_text: was „neu“ ist anlegen, in EINER Operation             manage_sources
 *     GET  /api/editor/inhalte/vorkommen/:id/als-text       die aktiven Regeln eines Eintrags in der Kurzschrift                   use_editor_menu
 *
 * - 🔴 **Der Text ist die einzige Quelle.** Lesen und Auflösen geschehen auf dem Server (er kennt Flächen, Orte, Einträge und Quellen); die Oberfläche hält nur den Text.
 *   Jede Antwort auf eine Rückfrage ist ein Ersatz im Text (`ersatz`: Zeile, von, bis, neuer Text), danach wird neu geprüft.
 * - 🔴 **„Übernehmen“ liest den Text auf dem Server noch einmal** und legt nur an, was dann „neu“ ist: die Regeln (`lore_rule`, Herkunft `manual`), die Quelle der
 *   `Quelle:`-Zeile an Einträgen, denen sie fehlt, und Einträge mit `(Kategorie, neu)`. Was „gibt es schon“, eine Rückfrage oder ein Fehler ist, bleibt im Text
 *   (`rest`). Ergänzt nur: Stammdaten, Ortszeilen, Ersetzen und Stilllegen schreibt der Text nie.
 * - **EINE Operation über alle Einträge** (wie das Durchschreiben eines Korpus, `corpus.update`): eine `mapOperation` mit Protokoll, eine Transaktion, die Revision
 *   jedes berührten Eintrags zählt. Ein offener Entwurf desselben Eintrags im Fenster bekommt danach beim Speichern 409. Das Fenster hält weiter EINEN Entwurf je Eintrag;
 *   die Textansicht hat darum ihren eigenen Schritt „Übernehmen“ statt „Speichern“ im Fuß.
 * - Die Schreibweise steht in `C:\avesmaps3d-data\work\wi0257-vorkommen-finden\notation-wiki.md` (Entwurf 2026-10-28) und im Kopf von
 *   `apps/server/src/inhalte/regeln-text/lies.ts`. Die Meldungen des Lesers sind deutsch wie die Schreibweise selbst (`außer`, `Klima`, `nördlich von`).
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const INHALTE_REGELTEXT_PRUEFEN_URL = "/api/editor/inhalte/vorkommen-text/pruefen";
export const INHALTE_REGELTEXT_UEBERNEHMEN_URL = "/api/editor/inhalte/vorkommen-text/uebernehmen";
export const inhalteVorkommenAlsTextUrl = (id: string): string => `${INHALTE_VORKOMMEN_URL}/${id}/als-text`;

/** Höchstens so viele Zeichen und Zeilen je Text (ein Stapel aus einem Buch; mehr ist ein 400). */
export const INHALTE_REGELTEXT_ZEICHEN_MAX = 200_000;
export const INHALTE_REGELTEXT_ZEILEN_MAX = 5_000;

export const InhalteRegelTextPruefenBody = Type.Object(
    { text: Type.String({ maxLength: INHALTE_REGELTEXT_ZEICHEN_MAX }) },
    strict,
);
export type InhalteRegelTextPruefenBody = Static<typeof InhalteRegelTextPruefenBody>;

/** Ohne `baseRevision`: Der Server liest den Text in der Transaktion neu und legt nur an, was dann „neu“ ist (eine Regel gibt es nach ihrem Fingerabdruck nie doppelt). */
export const InhalteRegelTextUebernehmenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        text: Type.String({ maxLength: INHALTE_REGELTEXT_ZEICHEN_MAX }),
    },
    strict,
);
export type InhalteRegelTextUebernehmenBody = Static<typeof InhalteRegelTextUebernehmenBody>;

/** Eine Stelle im Text: Zeile (ab 0) und Spalten von, bis (bis ausschließlich) in dieser Zeile. */
const Stelle = {
    zeile: Type.Integer({ minimum: 0 }),
    von: Type.Integer({ minimum: 0 }),
    bis: Type.Integer({ minimum: 0 }),
};

/** Eine Antwort auf eine Rückfrage oder ein Fehler mit Vorschlag: ersetzt die Stelle durch `text`. */
export const InhalteRegelTextOption = Type.Object(
    {
        label: Type.String(),
        /** Eine Zeile Zusatz (Ebene, Art, Wiki-Titel, Kennungsanfang), leer, wo es keine gibt. */
        meta: Type.String(),
        ersatz: Type.Object({ ...Stelle, text: Type.String() }, strict),
    },
    strict,
);
export type InhalteRegelTextOption = Static<typeof InhalteRegelTextOption>;

/** Ein Befund an einer Stelle: `fehler` (so nicht anlegbar) oder `rueckfrage` (mehrdeutig, eine Wahl schreibt den Text um). */
export const InhalteRegelTextProblem = Type.Object(
    {
        art: oneOf(["fehler", "rueckfrage"] as const),
        ...Stelle,
        text: Type.String(),
        optionen: Type.Array(InhalteRegelTextOption),
    },
    strict,
);
export type InhalteRegelTextProblem = Static<typeof InhalteRegelTextProblem>;

export const INHALTE_REGELTEXT_REGEL_STATUS = ["neu", "schon", "rueckfrage", "fehler"] as const;
export type InhalteRegelTextRegelStatus = (typeof INHALTE_REGELTEXT_REGEL_STATUS)[number];

/**
 * Eine Regel des Texts. `bedingungen` hat die Form des Lesemodells (`InhalteVorkommenBedingung`), damit die Oberfläche denselben Satz baut wie an der Regelkarte; sie
 * fehlen bei einem Fehler, der die Kette nicht lesen ließ. `schon` sagt, woher „gibt es schon“ kommt: eine aktive Regel des Eintrags (`bestehend`) oder eine Zeile weiter
 * oben im selben Text (`stapel`, mit deren Zeile).
 */
export const InhalteRegelTextRegel = Type.Object(
    {
        zeile: Type.Integer({ minimum: 0 }),
        zeileBis: Type.Integer({ minimum: 0 }),
        relation: Type.Optional(oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN)),
        status: oneOf(INHALTE_REGELTEXT_REGEL_STATUS),
        schon: Type.Optional(
            Type.Object(
                { grund: oneOf(["bestehend", "stapel"] as const), zeile: Type.Optional(Type.Integer({ minimum: 0 })) },
                strict,
            ),
        ),
        /** Der Ausdruck dieser Regel, wie er im Text steht. */
        text: Type.String(),
        bedingungen: Type.Optional(Type.Array(InhalteVorkommenBedingung)),
        probleme: Type.Array(InhalteRegelTextProblem),
    },
    strict,
);
export type InhalteRegelTextRegel = Static<typeof InhalteRegelTextRegel>;

/** Die `Quelle:`-Zeile, unter der ein Eintrag steht. `kennung` ist `feature_source.public_id`, wo sie eindeutig gefunden ist. */
export const InhalteRegelTextQuelle = Type.Object(
    {
        zeile: Type.Integer({ minimum: 0 }),
        titel: Type.String(),
        seiten: Type.Optional(Type.String()),
        status: oneOf(["ok", "rueckfrage", "fehler"] as const),
        kennung: Type.Optional(Uuid()),
        /** Der Eintrag nennt diese Quelle schon (dann hängt „Übernehmen“ sie nicht noch einmal an). */
        vorhanden: Type.Boolean(),
    },
    strict,
);
export type InhalteRegelTextQuelle = Static<typeof InhalteRegelTextQuelle>;

/**
 * Ein Eintrag des Texts (eine Kopfzeile `Name (Kategorie)`). `kennung` ist `lore_entry.public_id`, wo er eindeutig gefunden ist; `neuAnlegen`, wo der Kopf `(Kategorie, neu)`
 * sagt und es ihn so noch nicht gibt. Ein Eintrag mit Status ungleich `ok` legt nichts an, auch nicht seine Regeln.
 */
export const InhalteRegelTextEintrag = Type.Object(
    {
        zeile: Type.Integer({ minimum: 0 }),
        name: Type.String(),
        kategorie: Type.Optional(oneOf(INHALTE_VORKOMMEN_ARTEN)),
        kennung: Type.Optional(Uuid()),
        neuAnlegen: Type.Boolean(),
        status: oneOf(["ok", "rueckfrage", "fehler"] as const),
        quelle: Type.Optional(InhalteRegelTextQuelle),
        probleme: Type.Array(InhalteRegelTextProblem),
        regeln: Type.Array(InhalteRegelTextRegel),
    },
    strict,
);
export type InhalteRegelTextEintrag = Static<typeof InhalteRegelTextEintrag>;

/**
 * Das Ergebnis des Prüfens. `zahlen` für die Pillen der Vorschau (Rückfragen und Fehler zählen Befunde, nicht Regeln); `plan` sagt, was „Übernehmen“ jetzt täte;
 * `lose` sind Befunde außerhalb eines Eintrags (eine `Quelle:`-Zeile, eine Regel ohne Kopf, eine Fortsetzung ohne Zeile davor). `rest` ist der Text, der nach dem
 * Übernehmen stehen bliebe (übernommene und vorhandene Regeln, fertige Köpfe und Quellen ohne offene Einträge entfallen; Leerzeilen zusammengezogen).
 */
export const InhalteRegelTextErgebnis = Type.Object(
    {
        zahlen: Type.Object(
            {
                eintraege: Type.Integer({ minimum: 0 }),
                neu: Type.Integer({ minimum: 0 }),
                schon: Type.Integer({ minimum: 0 }),
                rueckfragen: Type.Integer({ minimum: 0 }),
                fehler: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
        plan: Type.Object(
            {
                regeln: Type.Integer({ minimum: 0 }),
                eintraege: Type.Integer({ minimum: 0 }),
                quellen: Type.Integer({ minimum: 0 }),
                anlegen: Type.Integer({ minimum: 0 }),
            },
            strict,
        ),
        eintraege: Type.Array(InhalteRegelTextEintrag),
        lose: Type.Array(InhalteRegelTextProblem),
        rest: Type.String(),
    },
    strict,
);
export type InhalteRegelTextErgebnis = Static<typeof InhalteRegelTextErgebnis>;

/** Die Quittung des Übernehmens: was angelegt wurde und der Text, der stehen bleibt (`rest`). */
export const InhalteRegelTextUebernommen = Type.Object(
    {
        ...OperationReceipt.properties,
        regeln: Type.Integer({ minimum: 0 }),
        eintraege: Type.Integer({ minimum: 0 }),
        quellen: Type.Integer({ minimum: 0 }),
        angelegt: Type.Integer({ minimum: 0 }),
        schon: Type.Integer({ minimum: 0 }),
        rest: Type.String(),
    },
    strict,
);
export type InhalteRegelTextUebernommen = Static<typeof InhalteRegelTextUebernommen>;

/** Der Rückweg: die aktiven Regeln eines Eintrags als Block der Kurzschrift (Kopf und eine Zeile `| Beziehung = …` je Regel). */
export const InhalteRegelTextAlsText = Type.Object({ text: Type.String() }, strict);
export type InhalteRegelTextAlsText = Static<typeof InhalteRegelTextAlsText>;
