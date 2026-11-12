import type { Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { corpusKeyOfUrl } from "./subject-details.ts";

/**
 * Die Befunde von D6, die die Datenbank brauchen (Vertrag `subject-details.yaml`, `befundcodes`). Import und Prüfer lesen sie
 * mit denselben Abfragen, damit beide dieselben Zahlen nennen. Alle melden nur.
 */

/**
 * `region_wiki_without_snapshot` (41 im Satz 161832): Regionen mit Wiki-Adresse, aber ohne eigenes Beschriftungsnest; Legacy hat
 * dort keinen Text. Ein Teil davon findet den Text eines anderen Nests mit demselben Schlüssel (Regionen teilen Adressen):
 * `ohneSchnappschuss` zählt die, die auch den nicht finden. `label_nest_without_region_wiki` (2: Weydenauer See, Erlensee
 * (Kosch)): eine Beschriftung trägt ein Nest, aber die gebundene Region keine Zuordnung. Nicht korrigiert (Cutoff-Regel).
 */
export async function regionLinkFindings(
    database: Queryable,
    boundLabelNestIds: readonly string[],
): Promise<Finding[]> {
    const findings: Finding[] = [];
    const withoutNest = await database<{ public_id: string; name: string; has_snapshot: boolean }[]>`
        SELECT r.public_id::text, r.name,
               EXISTS (
                   SELECT 1 FROM wiki_region_snapshot s WHERE s.is_active AND s.wiki_key = r.wiki_region_key
               ) AS has_snapshot
        FROM region r
        WHERE r.is_active
          AND r.wiki_url IS NOT NULL AND btrim(r.wiki_url) <> ''
          AND NOT EXISTS (
                SELECT 1 FROM map_label l
                WHERE l.region_id = r.id AND l.public_id::text = ANY(${boundLabelNestIds as string[]}::text[])
              )
        ORDER BY r.name, r.public_id
    `;
    if (withoutNest.length > 0) {
        const withoutSnapshot = withoutNest.filter((row) => !row.has_snapshot).length;
        findings.push(
            createFinding(
                "region_wiki_without_snapshot",
                `${String(withoutNest.length)} Regionen tragen eine Wiki-Zuordnung ohne eigenes Beschriftungsnest (${String(withoutSnapshot)} davon finden auch über den Schlüssel keinen Schnappschuss); sie bleiben bei Adresse und Schlüssel (Legacy hat dort keinen Text)`,
                { regionen: withoutNest.length, ohneSchnappschuss: withoutSnapshot },
                withoutNest.map((row) => ({ table: "region", publicId: row.public_id, name: row.name })),
            ),
        );
    }
    const nestWithoutRegionWiki = await database<{ public_id: string; name: string }[]>`
        SELECT l.public_id::text, l.name
        FROM map_label l
        JOIN region r ON r.id = l.region_id
        WHERE l.public_id::text = ANY(${boundLabelNestIds as string[]}::text[])
          AND (r.wiki_url IS NULL OR btrim(r.wiki_url) = '')
        ORDER BY l.name, l.public_id
    `;
    if (nestWithoutRegionWiki.length > 0) {
        findings.push(
            createFinding(
                "label_nest_without_region_wiki",
                `${String(nestWithoutRegionWiki.length)} Beschriftungen tragen ein Wiki-Nest, die gebundene Region aber keine Zuordnung; nicht korrigiert (Cutoff-Regel)`,
                { beschriftungen: nestWithoutRegionWiki.length },
                nestWithoutRegionWiki.map((row) => ({ table: "map_label", publicId: row.public_id, name: row.name })),
            ),
        );
    }
    return findings;
}

/**
 * `wiki_text_license_unrecorded`: Wiki-Text steht unter einer Fremdlizenz; deren Erfassung liegt im Korpus (D1, `source_corpus`).
 * Seit der Betreiberentscheidung 2026-10-04 trägt der Korpus der Wiki Aventurica CC BY-SA 3.0 (Migration 0066); der Befund war
 * der Stand vor der Entscheidung und bleibt nur für einen Korpus, dessen Lizenz weiter fehlt (Zeile fehlt oder `unrecorded`).
 * Leer heißt nie „keine Lizenz“. Gibt es die Korpustafel noch nicht, meldet dieser Schritt nichts.
 */
export async function wikiTextLicenseFinding(
    database: Queryable,
    wikiUrls: readonly string[],
): Promise<Finding | undefined> {
    const perCorpus = new Map<string, number>();
    for (const url of wikiUrls) {
        const key = corpusKeyOfUrl(url);
        if (key !== "") perCorpus.set(key, (perCorpus.get(key) ?? 0) + 1);
    }
    if (perCorpus.size === 0) return undefined;
    const [table] = await database<{ present: string | null }[]>`SELECT to_regclass('source_corpus')::text AS present`;
    // Ohne Korpustafel (Migration 0066) weiß dieser Schritt nichts über die Lizenzen: kein Befund.
    if (!table?.present) return undefined;
    const recorded = new Set<string>();
    const rows = await database<{ corpus_key: string }[]>`
        SELECT corpus_key FROM source_corpus WHERE is_active AND license_statement <> 'unrecorded'
    `;
    for (const row of rows) recorded.add(row.corpus_key);
    const unrecorded = [...perCorpus].filter(([key]) => !recorded.has(key)).sort((a, b) => b[1] - a[1]);
    if (unrecorded.length === 0) return undefined;
    const numbers: Record<string, number> = {};
    for (const [key, count] of unrecorded) numbers[key] = count;
    const objects: FindingObject[] = unrecorded.map(([key, count]) => ({
        table: "source_corpus",
        publicId: key,
        name: `${String(count)} Schnappschüsse`,
    }));
    return createFinding(
        "wiki_text_license_unrecorded",
        `Wiki-Text ohne erfasste Lizenz: ${unrecorded.map(([key, count]) => `${key} (${String(count)} Schnappschüsse)`).join(", ")}. Leer heißt nie „keine Lizenz“; Lizenz und Namensnennung eines Korpus kommen aus source_corpus (D1)`,
        numbers,
        objects,
    );
}
