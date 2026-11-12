import type { SubjectFact, SubjectFactField, SubjectProvenance } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { EDITORIAL, textFact, wikiProvenance, type ProvenancedValue } from "./facts.ts";

/**
 * Die Staatsinfobox eines Herrschaftsgebiets als Faktenzeilen (WI-0063 27.18, Gebietsexport E4, Migration 0076, Vertrag
 * `territory-details.yaml` → `panelbezug`; Legacy `createRegionWikiInfoBoxMarkup`).
 *
 * 🔴 Eine Zeile nur mit Inhalt (5.3): `NULL` ist kein Wert, und der bewusste Leerwert `''` eines Overrides ist keiner. Er verdeckt nur, was
 * Legacy aus dem Wiki gezeigt hätte, und die Zeile entfällt. Es gibt hier keinen zweiten Wert, auf den sie zurückfiele.
 *
 * Links: X1 führt für Staatsartikel keine Feldlinks (`wiki-link-targets.yaml` → `leser.felder.gebiet`), alle Felder bleiben Text. Die
 * einzigen Verweise sind Hauptstadt und Herrschaftssitz über die Kennung des Ortes (`capital_place_public_id`), nie über einen Namen.
 */

/** Die 17 Felder der Zeile `territory_detail` (Migration 0076). */
const DETAIL_COLUMNS = [
    "continent",
    "founded_text",
    "dissolved_text",
    "form_of_government",
    "capital_name",
    "seat_name",
    "ruler",
    "language",
    "currency",
    "population",
    "founder",
    "political",
    "trade_zone",
    "trade_goods",
    "geographic",
    "blazon",
    "affiliation_raw",
] as const;
type DetailColumn = (typeof DETAIL_COLUMNS)[number];

/** Die wirksame Detailzeile eines Gebiets samt Herkunft je Feld (`override` oder `wiki`; ein Feld ohne Vermerk ist „nicht bekannt“). */
export interface TerritoryDetail {
    values: Readonly<Record<DetailColumn, string | null>>;
    origins: ReadonlyMap<string, "override" | "wiki">;
}

type DetailRow = Record<DetailColumn, string | null> & { id: string };

/**
 * Die aktive Detailzeile des Gebiets, oder nichts. Eine stillgelegte oder (für den Editor reservierte) unterdrückte Zeile ist nicht
 * aktiv (`state = 'active'` ⇔ `is_active`, Migration 0076) und wird nicht gelesen.
 */
export async function readTerritoryDetail(
    transaction: Queryable,
    publicId: string,
): Promise<TerritoryDetail | undefined> {
    const [row] = await transaction<DetailRow[]>`
        SELECT d.id::text AS id, d.continent, d.founded_text, d.dissolved_text, d.form_of_government, d.capital_name, d.seat_name,
               d.ruler, d.language, d.currency, d.population, d.founder, d.political, d.trade_zone, d.trade_goods, d.geographic,
               d.blazon, d.affiliation_raw
        FROM territory_detail d
        JOIN territory t ON t.id = d.territory_id
        WHERE t.public_id = ${publicId}::uuid AND d.is_active
    `;
    if (!row) return undefined;
    const origins = await transaction<{ field: string; origin: string }[]>`
        SELECT field, origin FROM territory_detail_field_origin WHERE territory_detail_id = ${row.id}::bigint
    `;
    return {
        values: Object.fromEntries(DETAIL_COLUMNS.map((column) => [column, row[column]])) as TerritoryDetail["values"],
        origins: new Map(
            origins.flatMap(({ field, origin }): [string, "override" | "wiki"][] =>
                origin === "override" || origin === "wiki" ? [[field, origin]] : [],
            ),
        ),
    };
}

/** Legacy `normalizeRegionParentheticalSpacing`: Vor einer Klammer steht ein Leerzeichen („Mark(Baronie)“ wird „Mark (Baronie)“). */
export const spacedParenthesis = (value: string): string => value.replace(/([^\s])\(/gu, "$1 (");

/** Der Text, wie Legacy ihn zeigt (`createRegionInfoTextRow`): Klammern abgesetzt, Leerraum gekürzt; leer heißt keine Zeile. */
const shown = (value: string | null | undefined): string => spacedParenthesis(value ?? "").trim();

/**
 * Die Provenienz eines Feldes: `wiki` ist Wiki-Text (Adresse des Gebiets; der Abgleichsstempel liegt nicht vor), alles andere ist
 * redaktionell - auch ein Feld ohne Vermerk. „Nie wiki“ gilt dort, wo die Herkunft nicht bekannt ist.
 */
function provenanceOf(detail: TerritoryDetail, column: DetailColumn, wikiUrl: string | null): SubjectProvenance {
    return detail.origins.get(column) === "wiki" ? wikiProvenance(wikiUrl) : EDITORIAL;
}

/** Eine Zeile aus einem Feld der Detailzeile, oder nichts. */
function detailFact(
    detail: TerritoryDetail | undefined,
    column: DetailColumn,
    field: SubjectFactField,
    wikiUrl: string | null,
    hidden = false,
): SubjectFact[] {
    if (detail === undefined) return [];
    const value = shown(detail.values[column]);
    if (value === "") return [];
    return textFact(
        field,
        { value, provenance: provenanceOf(detail, column, wikiUrl) },
        hidden ? { legacyHidden: true } : {},
    );
}

/** Der Ort, den das Gebiet als Hauptstadt oder Sitz verknüpft (nur ein aktiver, nicht verborgener Ort). */
export interface LinkedPlace {
    id: string | null;
    name: string | null;
}

/**
 * Hauptstadt oder Herrschaftssitz. Der Text ist der des Gebietsexports (Legacy `wikiCapitalName || capitalName || f.capital_name`), sonst
 * der Name des verknüpften Ortes. Der Verweis kommt aus der Kennung des Ortes und gilt für den ganzen Text, wie in Legacy.
 */
function placeFact(
    field: "capital" | "seat",
    detail: TerritoryDetail | undefined,
    column: "capital_name" | "seat_name",
    place: LinkedPlace,
    wikiUrl: string | null,
): SubjectFact[] {
    const fromDetail = detail === undefined ? "" : shown(detail.values[column]);
    const value: ProvenancedValue | null =
        fromDetail !== "" && detail !== undefined
            ? { value: fromDetail, provenance: provenanceOf(detail, column, wikiUrl) }
            : place.name !== null && place.name.trim() !== ""
              ? { value: place.name, provenance: EDITORIAL }
              : null;
    return textFact(field, value, place.id === null ? {} : { ref: { kind: "place", id: place.id } });
}

/** Eine Angabe des Gebiets selbst (`territory.status_text`, `valid_label`). */
function ownFact(field: "status" | "validity", value: string | null): SubjectFact[] {
    return value === null || value.trim() === "" ? [] : [{ field, value, provenance: EDITORIAL }];
}

export interface TerritoryFactsInput {
    status: string | null;
    validity: string | null;
    capital: LinkedPlace;
    seat: LinkedPlace;
    wikiUrl: string | null;
    detail: TerritoryDetail | undefined;
}

/**
 * Alle Faktenzeilen des Gebiets in Legacys Reihenfolge (das Panel ordnet nach `legacy-rows.ts`, die Folge hier ist die der Infobox):
 * Status, Herrschaftsform, Oberhaupt, Gründung, Auflösung, Gründer, Hauptstadt, Herrschaftssitz, Sprache, Währung, Einwohnerzahl,
 * Handelszone, Geographisch, Kartenzeitraum, Handelswaren - dahinter die vier Zusatzfelder, die Legacy nicht zeigt (`legacyHidden`).
 */
export function territoryFacts(input: TerritoryFactsInput): SubjectFact[] {
    const { detail, wikiUrl } = input;
    const row = (column: DetailColumn, field: SubjectFactField): SubjectFact[] =>
        detailFact(detail, column, field, wikiUrl);
    return [
        ...ownFact("status", input.status),
        ...row("form_of_government", "herrschaftsform"),
        ...row("ruler", "oberhaupt"),
        ...row("founded_text", "gruendung"),
        ...row("dissolved_text", "aufloesung"),
        ...row("founder", "gruender"),
        ...placeFact("capital", detail, "capital_name", input.capital, wikiUrl),
        ...placeFact("seat", detail, "seat_name", input.seat, wikiUrl),
        ...row("language", "sprache"),
        ...row("currency", "waehrung"),
        ...row("population", "einwohnerzahl"),
        ...row("trade_zone", "handelszone"),
        ...row("geographic", "geographisch"),
        ...ownFact("validity", input.validity),
        ...row("trade_goods", "handelswaren"),
        ...detailFact(detail, "continent", "continent", wikiUrl, true),
        ...detailFact(detail, "political", "politisch", wikiUrl, true),
        ...detailFact(detail, "blazon", "wappenbeschreibung", wikiUrl, true),
        ...detailFact(detail, "affiliation_raw", "zugehoerigkeitRoh", wikiUrl, true),
    ];
}
