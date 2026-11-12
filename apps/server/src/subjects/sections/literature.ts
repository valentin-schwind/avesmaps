import { catalogLinks, compareRecency, dnbSearchUrl, editionSortKey } from "@avesmaps3d/shared";
import type { LiteratureEntry, LiteratureRole, MediaPublicView, SubjectDetailKind } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { resolveLiteratureCovers } from "../../media/resolver.ts";
import { CARRIER_TABLES } from "../carrier-tables.ts";

/**
 * Die Sektion „Literatur“ eines Subjects (WI-0063 P8, Vertrag `literature.yaml`, D3; Legacy
 * `buildGameLiteratureSectionMarkup`/`buildGameLiteratureCardMarkup`, Mirror `04a85a54f`): die Werke der Spielliteratur, die GENAU
 * diesen Gegenstand nennen - nie vererbt, nie über einen Namen gefunden. Eine Gruppe (Weg, Landschaft) liest die VEREINIGUNG ihrer
 * Mitglieder, jedes Werk einmal.
 *
 * 🔴 Die Reihenfolge ist Legacys (`avesmapsCompareGameLiteratureRecency`): Edition absteigend (DSA5 vor DSA4.1 vor DSA4 … vor DSA1,
 * ein Nicht-DSA-Regelwerk danach, ohne Edition zuletzt), dann Jahr absteigend, dann Titel. Die ROLLE geht NICHT ein - ein Spoiler
 * steht verschleiert an seinem Sortierplatz, nicht als Block am Ende (Owner 2026-07-19). Sortiert wird nach dem JAHR (`bf_year`),
 * angezeigt die Jahresangabe (`bf_label`, sonst das Jahr): „1047 BF“ ist keine Zahl.
 *
 * 🔴 Die Rolle entscheidet über den Spoiler-Deckel, und `play` IST er. Trägt ein Werk denselben Träger zweimal mit verschiedenen
 * Rollen (gemessen: 2 Fälle im Satz), gewinnt die OFFENSTE: Was schon offen dasteht, wird nicht nachträglich verdeckt. Ein unbekannter
 * Rollenwert kann hier nicht stehen (CHECK der Tabelle); käme er, zählte er als `play` (Legacy: lieber verschleiern als verraten).
 *
 * 🔴 Der Umschlag kommt über den Media Core (MEDIA-M14), nicht über eine eigene Abfrage mit eigener Liste: EINE Frage für alle Werke der
 * Sektion, und was öffentlich sein darf, hat die Policy beim Import entschieden. Ein Werk OHNE veröffentlichte Datei bekommt kein Feld
 * `cover` - und das ist kein Fehler, sondern der Normalfall an einem Teil des Bestands.
 *
 * Das Fenster „Literatur zu …“ und sein vergrößerter Eintrag (WI-0118) brauchen mehr als die Kachel: die Kennung, die Schlagworte
 * (`genre`, am Komma getrennt), die Schwierigkeit (`complexity_gm`, sonst `complexity_pl`, wie Legacy), das Jahr als Zahl, `official`
 * und ALLE Links in Legacys Klickreihenfolge (Ulisses eBook, F-Shop, Wiki Aventurica, Dt. Nationalbibliothek; `avesmapsGameLiteratureLinks`).
 * 🔴 Der Wiki-Link entsteht nur aus einer gespeicherten Adresse, nie aus dem Titel geraten (Legacy rät `de.wiki-aventurica.de/wiki/<Titel>`;
 * `literature.yaml` -> `url_regel`: ohne Adresse bleibt der Titel Text). Die Nationalbibliothek ist eine Titelsuche (der Bestand führt keine
 * ISBN), also immer da. Ein Prüfzustand der Links (online, offline) gehört nicht dazu.
 */

/** 0 `start`, 1 `covers`, 2 `play`: die Rangfolge „wie offen“, mit der die Rollen eines Werks zu einer werden. */
const BY_OPENNESS: readonly LiteratureRole[] = ["start", "covers", "play"];

interface WorkRow {
    public_id: string;
    genre: string | null;
    complexity_gm: string | null;
    complexity_pl: string | null;
    is_official: boolean | null;
    title: string;
    wiki_url: string | null;
    product_type: string;
    edition: string | null;
    year_label: string | null;
    sort_year: number | null;
    contained_in: string | null;
    role_rank: number;
    link_ulisses: string | null;
    link_fshop: string | null;
}

/**
 * Legacys Sortierschlüssel der Edition steht in `@avesmaps3d/shared` (`literature-order.ts`): Der Server ordnet die Sektion damit, das
 * Fenster „Literatur zu …“ sortiert mit demselben Schlüssel - EINE Definition. Hier bleibt der Name, unter dem die Tests ihn kennen.
 */
export { editionSortKey };

const httpUrl = (value: string | null): string | undefined =>
    value !== null && /^https?:\/\//i.test(value) ? value : undefined;

/** Der Laden, in den der Umschlag führt (Legacy `advBestLink`): Ulisses eBook vor F-Shop; ohne beides führt er auf den Wiki-Artikel. */
function shopOf(row: WorkRow): LiteratureEntry["shop"] {
    const ulisses = httpUrl(row.link_ulisses);
    if (ulisses !== undefined) return { kind: "ulisses", url: ulisses };
    const fshop = httpUrl(row.link_fshop);
    return fshop === undefined ? undefined : { kind: "fshop", url: fshop };
}

/** Die Schlagworte: am Komma getrennt, jedes getrimmt, ohne Leere und ohne Dopplung - „Stadt, Stadt“ ist ein Wort. */
export function genresOf(genre: string | null): string[] {
    const words = (genre ?? "")
        .split(",")
        .map((word) => word.trim())
        .filter((word) => word !== "");
    return [...new Set(words)];
}

/** Die Schwierigkeit wie Legacy (`complexity_gm || complexity_pl`): die der Spielleitung, sonst die der Spielenden. */
export function complexityOf(row: Pick<WorkRow, "complexity_gm" | "complexity_pl">): string | undefined {
    const gm = (row.complexity_gm ?? "").trim();
    if (gm !== "") return gm;
    const pl = (row.complexity_pl ?? "").trim();
    return pl === "" ? undefined : pl;
}

/** ALLE Links in Legacys Klickreihenfolge; Wiki und Nationalbibliothek sind bekannt frei, die Läden verkaufen (`catalogLinkMeta`). */
function linksOf(row: WorkRow): NonNullable<LiteratureEntry["links"]> {
    return catalogLinks([
        ...(row.link_ulisses === null ? [] : [{ url: row.link_ulisses }]),
        ...(row.link_fshop === null ? [] : [{ url: row.link_fshop }]),
        ...(row.wiki_url === null ? [] : [{ url: row.wiki_url, paid: false }]),
        { url: dnbSearchUrl(row.title), paid: false },
    ]);
}

function entryOf(row: WorkRow, covers: ReadonlyMap<string, MediaPublicView>): LiteratureEntry {
    const url = httpUrl(row.wiki_url);
    const shop = shopOf(row);
    const cover = covers.get(row.public_id);
    const genres = genresOf(row.genre);
    const complexity = complexityOf(row);
    return {
        id: row.public_id,
        title: row.title,
        ...(url === undefined ? {} : { url }),
        ...(cover === undefined ? {} : { cover }),
        productType: row.product_type,
        ...(row.edition === null ? {} : { edition: row.edition }),
        ...(row.year_label === null ? {} : { year: row.year_label }),
        ...(row.sort_year === null ? {} : { bfYear: row.sort_year }),
        ...(row.contained_in === null ? {} : { containedIn: row.contained_in }),
        role: BY_OPENNESS[row.role_rank] ?? "play",
        ...(shop === undefined ? {} : { shop }),
        ...(genres.length === 0 ? {} : { genres }),
        ...(complexity === undefined ? {} : { complexity }),
        ...(row.is_official === null ? {} : { official: row.is_official }),
        links: linksOf(row),
    };
}

/** Die Werke der Träger `publicIds` (ein Träger oder alle Mitglieder einer Gruppe), jedes Werk einmal, in Legacys Reihenfolge. */
export async function listLiterature(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
): Promise<LiteratureEntry[]> {
    const tables = CARRIER_TABLES[kind];
    if (tables.catalogKey === null) return [];
    const rows = await database.unsafe<WorkRow[]>(
        `SELECT a.public_id::text AS public_id, a.title, a.wiki_url, a.product_type, a.edition,
                coalesce(a.bf_label, a.bf_year::text) AS year_label, a.bf_year AS sort_year, a.contained_in,
                a.link_ulisses, a.link_fshop, a.genre, a.complexity_gm, a.complexity_pl, a.is_official,
                min(CASE p.role WHEN 'start' THEN 0 WHEN 'covers' THEN 1 ELSE 2 END)::int AS role_rank
         FROM adventure_place p
         JOIN adventure a ON a.id = p.adventure_id AND a.is_active
         JOIN ${tables.carrier} c ON c.id = p.${tables.catalogKey}
         WHERE c.public_id = ANY($1::uuid[]) AND p.is_active
         GROUP BY a.id, a.public_id, a.title, a.wiki_url, a.product_type, a.edition, a.bf_label, a.bf_year, a.contained_in,
                  a.link_ulisses, a.link_fshop, a.genre, a.complexity_gm, a.complexity_pl, a.is_official`,
        [[...publicIds]],
    );
    // EINE Frage für alle Werke der Sektion, erst nachdem die Liste steht - kein N+1.
    const covers = await resolveLiteratureCovers(
        database,
        rows.map((row) => row.public_id),
    );
    return [...rows]
        .sort((left, right) =>
            compareRecency(
                { edition: left.edition, year: left.sort_year, title: left.title },
                { edition: right.edition, year: right.sort_year, title: right.title },
            ),
        )
        .map((row) => entryOf(row, covers));
}
