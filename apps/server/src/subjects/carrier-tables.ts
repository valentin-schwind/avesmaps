import {
    kanonMitRang4,
    type LoreCounts,
    type SubjectCanon,
    type SubjectCounts,
    type SubjectDetailKind,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { staettenCountSql } from "./sections/staetten.ts";
import { leseObjektartZeile } from "../kanon/tafel.ts";
import { canonOf, type CanonRow } from "./facts.ts";

/**
 * Welche Tabellen zu welcher Art von Träger gehören (Migration 0066, D1): die Verknüpfungen zu den Quellen und der Kanon.
 * Die Namen sind Konstanten dieser Datei, nie Eingaben - sie werden als Text in die Abfragen gesetzt, weil Tabellennamen
 * keine Parameter sind.
 *
 * 🔴 Eine Quelle gehört dem Träger, an dem Legacy sie führt, und wird NIE vererbt (WI-0063 5.5): die Zeilen hier sind genau die
 * Verknüpfungen der übergebenen Träger. Wege, Landschaften und Kraftlinien sind Gruppen: ihre Träger sind alle Mitglieder.
 * Eine Kraftlinie hat in Legacy keine Quellen (im Export 0 Verknüpfungen) und damit keine Verknüpfungstabelle.
 */
interface CarrierTables {
    carrier: string;
    link: string | null;
    foreignKey: string;
    canon: string;
    /**
     * Die Spalte, mit der die Katalogzeilen der Literatur (`adventure_place`, 0068) und der Kartensammlung (`citymap_place`, 0069) auf
     * diesen Träger zeigen; `null`, wo Legacy die Art nicht als Ziel kennt. 🪤 Eine Kraftlinie ist kein Ziel: `target_kind powerline`
     * entstand in Legacy einmal durch einen Fehler im Quellenweg (`literature.yaml` -> `zielarten`) und hat keine Spalte.
     */
    catalogKey: string | null;
}

export const CARRIER_TABLES: Readonly<Record<SubjectDetailKind, CarrierTables>> = {
    place: {
        carrier: "place",
        link: "place_source",
        foreignKey: "place_id",
        canon: "place_canon",
        catalogKey: "place_id",
    },
    path: { carrier: "path", link: "path_source", foreignKey: "path_id", canon: "path_canon", catalogKey: "path_id" },
    territory: {
        carrier: "territory",
        link: "territory_source",
        foreignKey: "territory_id",
        canon: "territory_canon",
        catalogKey: "territory_id",
    },
    area: {
        carrier: "region",
        link: "region_source",
        foreignKey: "region_id",
        canon: "region_canon",
        catalogKey: "region_id",
    },
    peak: {
        carrier: "terrain_peak",
        link: "terrain_peak_source",
        foreignKey: "terrain_peak_id",
        canon: "terrain_peak_canon",
        catalogKey: "terrain_peak_id",
    },
    powerline: {
        carrier: "powerline",
        link: null,
        foreignKey: "powerline_id",
        canon: "powerline_canon",
        catalogKey: null,
    },
};

/**
 * Der Kanon des Subjects (D1, abgeleitet): bei einer Gruppe die Zeile des ersten Mitglieds, das eine trägt.
 *
 * 🔴 Rang 4 (WI-0253 B-2, Vali 2026-10-25): Trägt KEIN Mitglied eine Zeile (weder Wiki-Zuweisung noch Quelle noch Publikation), entscheidet die
 * Tafel je Objektart der Umgebung (`kanon/tafel.ts`): bei „anzeigen“ INOFFIZIELL mit dem Bezeichner der Art, sonst kein Etikett wie bisher. Es
 * wird beim LESEN aufgelöst, die Zeilen bleiben unberührt; eine Tafeländerung hebt die Leser-Revision (`revision.ts`). Eine Zeile `unlabelled`
 * (Verweise, nur Publikationen) gewinnt vor Rang 4. Die Tafel wird nur gelesen, wenn es nichts anderes zu sagen gibt.
 */
export async function readCanon(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
): Promise<SubjectCanon | undefined> {
    const tables = CARRIER_TABLES[kind];
    const [row] = await database.unsafe<CanonRow[]>(
        `SELECT k.canon, k.designator_type, k.designator_count, k.designator_label
         FROM ${tables.canon} k
         JOIN ${tables.carrier} c ON c.id = k.${tables.foreignKey}
         WHERE c.public_id = ANY($1::uuid[])
         ORDER BY c.public_id
         LIMIT 1`,
        [[...publicIds]],
    );
    const kanon = canonOf(row);
    if (kanon !== undefined) return kanon;
    return kanonMitRang4(undefined, await leseObjektartZeile(database, kind));
}

interface CountRow {
    sources: number;
    literature: number;
    literature_hidden: number;
    citymaps: number;
    reviews: number;
    staetten: number;
}

/**
 * Die Zähler aller Sektionen des Subjects in EINER Abfrage (WI-0063 P8): Quellen (D1), Literatur (D3), Kartensammlung (D2) und
 * Bewertungen (D4). Vier Skalar-Unterabfragen statt vier Runden - der Detailabruf soll nicht wegen der Zähler langsamer werden.
 *
 * 🔴 Gezählt wird, was dem Subject SELBST gehört, nie Geerbtes (WI-0063 5.5): bei einer Gruppe (Weg, Landschaft) die Vereinigung ihrer
 * Mitglieder, jedes Werk und jede Karte genau einmal. Ein Werk, das denselben Träger zweimal nennt (Befund `place_duplicate_row`), ist
 * EIN Eintrag; trägt es dabei zwei Rollen, gewinnt die offene - was schon offen dasteht, wird nicht nachträglich verdeckt.
 *
 * 🔴 Die Literatur zählt nur, was OFFEN dasteht (`start`, `covers`); dass es verdeckte Werke gibt, sagt `literatureHidden` als eigene
 * Aussage, nie als Zahl (Legacy, Owner 2026-07-18).
 *
 * 🔴 `undefined`, wo nichts zu zählen ist, und jede Null fällt weg: Eine Sektion ohne Inhalt steht nie als „(0)“ im Panel
 * (WI-0063 5.3). Bewertungen gibt es nur an Orten (`reviews.yaml` -> `anzeige.subjects`), Stätten ebenso
 * (`staetten.yaml` -> `panelbezug.platz`) - und sie hängen am gefalteten NAMEN des Ortes, nicht an seiner Kennung, weil Legacys
 * Export keine Kennung der Siedlung trägt (Begründung in `sections/staetten.ts`).
 */
export async function readCounts(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
    /**
     * Die vier Zähler der Vorkommen (D5, WI-0091), schon gerechnet: sie brauchen mehr als die öffentlichen Kennungen des Trägers
     * (am Ort das tiefste Gebiet an seinem Punkt und dessen Teilbaum) und kommen darum aus `sections/lore.ts`, nicht aus dieser
     * Abfrage. Fehlt sie, trägt das Subject keine Vorkommen - Weg und Kraftlinie sind kein Zielraum.
     */
    lore?: LoreCounts | undefined,
): Promise<SubjectCounts | undefined> {
    const tables = CARRIER_TABLES[kind];
    // Die Träger EINMAL nachschlagen (ein gemeinsamer CTE statt vier gleicher Unterabfragen). 🪤 Er steht auch da, wo keine Sektion ihn
    // braucht (Kraftlinie): Ohne eine Stelle, die `$1` nennt, kennt PostgreSQL den Typ des Parameters nicht und bricht ab.
    const carriers = "SELECT id FROM carrier";
    const sources =
        tables.link === null
            ? "0"
            : `(SELECT count(DISTINCT s.source_id) FROM ${tables.link} s
                JOIN feature_source f ON f.id = s.source_id AND f.is_active
                WHERE s.${tables.foreignKey} IN (${carriers}) AND s.is_active AND s.state = 'active')`;
    /** Die Werke eines Trägers, je Werk eine Zeile mit der offensten seiner Rollen. */
    const works = `SELECT r.adventure_id, bool_or(r.role <> 'play') AS open
                   FROM adventure_place r
                   JOIN adventure w ON w.id = r.adventure_id AND w.is_active
                   WHERE r.${tables.catalogKey ?? "adventure_id"} IN (${carriers}) AND r.is_active
                   GROUP BY r.adventure_id`;
    const literature = (open: boolean): string =>
        tables.catalogKey === null
            ? "0"
            : `(SELECT count(*) FROM (${works}) q WHERE q.open ${open ? "" : "IS NOT TRUE"})`;
    const citymaps =
        tables.catalogKey === null
            ? "0"
            : `(SELECT count(DISTINCT r.citymap_id) FROM citymap_place r
                JOIN citymap w ON w.id = r.citymap_id AND w.is_active
                WHERE r.${tables.catalogKey} IN (${carriers}) AND r.is_active)`;
    const reviews =
        kind === "place"
            ? `(SELECT count(*) FROM place_review v WHERE v.place_id IN (${carriers}) AND v.zustand IN ('neu', 'gesichtet'))`
            : "0";
    // 🪤 Nicht über `carrier` (das führt nur die Id): die Stätten hängen am gefalteten Namen, also braucht die Unterabfrage den NAMEN.
    const staetten = kind === "place" ? staettenCountSql(tables.carrier) : "0";
    const [row] = await database.unsafe<CountRow[]>(
        `WITH carrier AS (SELECT id FROM ${tables.carrier} WHERE public_id = ANY($1::uuid[]))
         SELECT ${sources}::int AS sources,
                ${literature(true)}::int AS literature,
                ${literature(false)}::int AS literature_hidden,
                ${citymaps}::int AS citymaps,
                ${reviews}::int AS reviews,
                ${staetten}::int AS staetten`,
        [[...publicIds]],
    );
    if (!row) return undefined;
    const counts: SubjectCounts = {
        ...(row.sources > 0 ? { sources: row.sources } : {}),
        ...(row.literature > 0 ? { literature: row.literature } : {}),
        ...(row.literature_hidden > 0 ? { literatureHidden: true as const } : {}),
        ...(row.citymaps > 0 ? { citymaps: row.citymaps } : {}),
        ...(row.reviews > 0 ? { reviews: row.reviews } : {}),
        ...(row.staetten > 0 ? { staetten: row.staetten } : {}),
        ...(lore === undefined ? {} : { lore }),
    };
    return Object.keys(counts).length === 0 ? undefined : counts;
}
