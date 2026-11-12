import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import notices from "../../../config/legal/notices.json" with { type: "json" };

/**
 * The notices Avesmaps3D has to show (chapter 5.5). The licence of the Ulisses map package demands
 * that its URI accompanies every distribution, and the fan guidelines demand a visible disclaimer -
 * so this is not decoration, it is a condition of being allowed to show the map at all.
 *
 * The licence itself belongs to the material and therefore lives in the map series catalog; what
 * stands here is true for the whole project.
 */
export const FontNotice = Type.Object(
    {
        name: Type.String(),
        license: Type.String(),
        copyright: Type.String(),
        uri: Type.String(),
    },
    { $id: "FontNotice", additionalProperties: false },
);

export type FontNotice = Static<typeof FontNotice>;

/**
 * The imprint under § 5 DDG. The address is kept in two halves on purpose, so the shipped bundle
 * carries no complete mail address with an `@` for a harvester to find; the browser joins them.
 * Legacy does the same with character entities and `legal-mail.js`.
 */
export const Imprint = Type.Object(
    {
        operator: Type.String({ minLength: 1 }),
        mailUser: Type.String({ minLength: 1 }),
        mailDomain: Type.String({ minLength: 1 }),
        discordUri: Type.String({ minLength: 1 }),
    },
    { $id: "Imprint", additionalProperties: true },
);

export type Imprint = Static<typeof Imprint>;

/**
 * The notices window as one document (operator 2026-11-04, the approved mock-up): eleven sections of blocks, German only until the translation step.
 * This is the single source of the window's text; the older keys above stay until that step removes them, because tests and other places still read them.
 *
 * Every text field may carry a small inline notation, parsed by `apps/web/src/legal/hinweise-inline.ts`, never as HTML: `[text](https://…)`,
 * `[text](mailto:…)`, `[text](#kennung)` and `**text**` for the brighter text tone. Non-breaking spaces, en dashes, German dates and the term links stand finished
 * in the text. `{mail}` stands for the imprint address, which is only joined in the browser (see `Imprint`).
 *
 * `id` is a stable address: `?hinweis=<id>` opens the window at that place, so an id never changes once it is out in the world. The section "bedienung" is the
 * component `hinweise-bedienung.vue` and has no blocks of its own; its title and hint stand here.
 */
const HinweisKennung = Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });
const HinweisText = Type.String({ minLength: 1 });

const NUR_DIESE_FELDER = { additionalProperties: false } as const;

/** One value of a fact row: a paragraph, or a list when it is an array. */
export const HinweisFaktWert = Type.Union([HinweisText, Type.Array(HinweisText, { minItems: 1 })]);

export type HinweisFaktWert = Static<typeof HinweisFaktWert>;

export const HinweisBlock = Type.Union(
    [
        Type.Object({ art: Type.Literal("lead"), text: HinweisText }, NUR_DIESE_FELDER),
        Type.Object({ art: Type.Literal("absatz"), text: HinweisText }, NUR_DIESE_FELDER),
        Type.Object({ art: Type.Literal("h3"), id: HinweisKennung, text: HinweisText }, NUR_DIESE_FELDER),
        Type.Object({ art: Type.Literal("h4"), id: HinweisKennung, text: HinweisText }, NUR_DIESE_FELDER),
        Type.Object(
            {
                art: Type.Literal("fakten"),
                zeilen: Type.Array(
                    Type.Object(
                        {
                            id: HinweisKennung,
                            begriff: HinweisText,
                            werte: Type.Array(HinweisFaktWert, { minItems: 1 }),
                        },
                        NUR_DIESE_FELDER,
                    ),
                    { minItems: 1 },
                ),
            },
            NUR_DIESE_FELDER,
        ),
        Type.Object(
            {
                art: Type.Literal("tafel"),
                kopf: Type.Array(HinweisText, { minItems: 1 }),
                /** How many leading columns name a row: its `id` was derived from them, and they name the row for screen readers. */
                schluesselSpalten: Type.Integer({ minimum: 1 }),
                zeilen: Type.Array(
                    Type.Object(
                        { id: HinweisKennung, zellen: Type.Array(Type.String(), { minItems: 1 }) },
                        NUR_DIESE_FELDER,
                    ),
                    { minItems: 1 },
                ),
            },
            NUR_DIESE_FELDER,
        ),
        Type.Object({ art: Type.Literal("liste"), punkte: Type.Array(HinweisText, { minItems: 1 }) }, NUR_DIESE_FELDER),
        Type.Object(
            { art: Type.Literal("kasten"), titel: HinweisText, absaetze: Type.Array(HinweisText, { minItems: 1 }) },
            NUR_DIESE_FELDER,
        ),
        Type.Object(
            { art: Type.Literal("frage"), id: HinweisKennung, frage: HinweisText, antwort: HinweisText },
            NUR_DIESE_FELDER,
        ),
        /** "In diesem Abschnitt:" with the places to jump to. */
        Type.Object(
            {
                art: Type.Literal("sprungliste"),
                wort: HinweisText,
                ziele: Type.Array(Type.Object({ text: HinweisText, ziel: HinweisText }, NUR_DIESE_FELDER), {
                    minItems: 1,
                }),
            },
            NUR_DIESE_FELDER,
        ),
        Type.Object(
            {
                art: Type.Literal("bild"),
                src: HinweisText,
                alt: HinweisText,
                breite: Type.Integer({ minimum: 1 }),
                hoehe: Type.Integer({ minimum: 1 }),
            },
            NUR_DIESE_FELDER,
        ),
        /** "Zur Community" and "Nachricht schreiben": buttons, their labels come from the message table. */
        Type.Object({ art: Type.Literal("kontaktknoepfe") }, NUR_DIESE_FELDER),
    ],
    { $id: "HinweisBlock" },
);

export type HinweisBlock = Static<typeof HinweisBlock>;

export const HinweisAbschnitt = Type.Object(
    { id: HinweisKennung, titel: HinweisText, hinweis: HinweisText, bloecke: Type.Array(HinweisBlock) },
    { $id: "HinweisAbschnitt", additionalProperties: false },
);

export type HinweisAbschnitt = Static<typeof HinweisAbschnitt>;

export const HinweiseDokument = Type.Object(
    { abschnitte: Type.Array(HinweisAbschnitt, { minItems: 1 }), schluss: HinweisText },
    { $id: "HinweiseDokument", additionalProperties: false },
);

export type HinweiseDokument = Static<typeof HinweiseDokument>;

export const LegalNotices = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        project: Type.Object(
            {
                name: Type.String(),
                fanGuidelinesUri: Type.String(),
            },
            { additionalProperties: false },
        ),
        imprint: Imprint,
        fonts: Type.Array(FontNotice),
        hinweise: HinweiseDokument,
    },
    { $id: "LegalNotices", additionalProperties: true },
);

export type LegalNotices = Static<typeof LegalNotices>;

function parseNotices(candidate: unknown): LegalNotices {
    if (!Value.Check(LegalNotices, candidate)) {
        const [firstError] = [...Value.Errors(LegalNotices, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid legal notices in notices.json (${detail})`);
    }
    return candidate;
}

export const LEGAL_NOTICES: LegalNotices = parseNotices(notices);
