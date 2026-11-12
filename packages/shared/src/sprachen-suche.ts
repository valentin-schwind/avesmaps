import { Type, type Static } from "@sinclair/typebox";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Die Sprachen in der Spotlight-Suche (WI-0261 S5c; Betreiber 2026-10-30: „sprachen sollen in der suche auftauchen und leuchten“, O1: „Die Suche findet eine Gruppe auch über die
 * Namen ihrer Wiki-Artikel“). Hier steht nur der Vertrag; gerechnet wird in `apps/server/src/search/sprachen-index.ts`.
 *
 * 🪤 Die Sprachen stehen in einer eigenen Sektion neben `hits`, nicht als fünfte Art in `SearchHitKind` (wie die Herrschaftsgebiete, `SearchGebietSektion`): Sonst belegten sie den gemeinsamen
 * Deckel der Trefferliste, und jede Oberfläche, die die Arten ausschöpfend behandelt, brächte sie ungewollt mit.
 *
 * Eine Sprache ist EIN Treffer, auch wenn mehrere ihrer Namen zur Anfrage passen: Es zählt der beste (Name vor Wiki-Artikel vor Legende vor Dialekt). Gefunden wird über
 *
 * - `name`: der Name der Sprache auf der Karte („Thorwalsch“),
 * - `wiki`: der Titel oder Name eines zugeordneten Wiki-Artikels („Gjalskisch“),
 * - `legende`: der Name in der Legende („Thorwalsch / Gjalskisch / Fjarningsch“),
 * - `dialekt`: der Titel eines Dialekts (ein Wiki-Artikel derselben Sprachfamilie, der keiner Sprache zugeordnet ist, „Horathi“). Der Treffer heißt dann wie der Dialekt, `dialektVon` nennt die Sprache,
 *   deren Infobox er öffnet.
 */

const strict = { additionalProperties: false } as const;

/** Wodurch eine Sprache gefunden wurde. */
export const SEARCH_SPRACHE_FUNDE = ["name", "wiki", "legende", "dialekt"] as const;
export type SearchSpracheFund = (typeof SEARCH_SPRACHE_FUNDE)[number];

/**
 * Eine Sprache als Suchtreffer.
 *
 * - `id`: `sprache.public_id`, die Kennung des Subjects (`/api/subjects/sprache/:id`); `schluessel` der Gruppenschlüssel (T-2), an dem die Karte die Flächen leuchten lässt.
 * - `name`: der Name der Zeile. Bei `gefundenIn: "dialekt"` ist es der Titel des Dialekts, sonst der Name der Sprache.
 * - `ueber`: der Text, über den die Sprache gefunden wurde, wo er nicht der Name ist (Legende, Titel des Wiki-Artikels); fehlt bei `name` und `dialekt`.
 * - `dialektVon`: nur bei `dialekt`: der Name der Sprache, zu der der Dialekt gehört.
 * - `gruppe`: Die Sprache führt mehr als einen Wiki-Artikel (O1, „Sprachgruppe“ statt „Sprache“).
 * - `gegenden`: die Zahl ihrer aktiven Teilflächen; 0 heißt „noch keine Fläche“, dann leuchtet nichts.
 */
export const SearchSpracheHit = Type.Object(
    {
        id: Type.String({ pattern: UUID_PATTERN }),
        schluessel: Type.String({ minLength: 1 }),
        name: Type.String({ minLength: 1 }),
        farbe: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        gefundenIn: Type.Union(SEARCH_SPRACHE_FUNDE.map((fund) => Type.Literal(fund))),
        ueber: Type.Optional(Type.String({ minLength: 1 })),
        dialektVon: Type.Optional(Type.String({ minLength: 1 })),
        gruppe: Type.Boolean(),
        gegenden: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type SearchSpracheHit = Static<typeof SearchSpracheHit>;

/** Höchstens `SEARCH_VORKOMMEN_SICHTBAR` Treffer; `total` ist die Zahl aller („… und N weitere“). */
export const SearchSpracheSektion = Type.Object(
    { hits: Type.Array(SearchSpracheHit), total: Type.Integer({ minimum: 0 }) },
    strict,
);
export type SearchSpracheSektion = Static<typeof SearchSpracheSektion>;
