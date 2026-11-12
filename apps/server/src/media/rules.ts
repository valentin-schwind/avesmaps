import type { Queryable } from "../database.ts";
import type { PublicationRuleFacts } from "./policy.ts";

/**
 * Die Freigaberegeln (`publication_rule`), so wie die EINE Entscheidung (`policy.ts`, `decidePublication`) sie braucht, an EINER Stelle
 * gelesen: Resolver, Reverse Usage des MAM, Plätze und Vorschau des Formulars, Abgleich im Worker, Binärimport und Prüfer. Eine zweite
 * Abfrage daneben vergäße die nächste Spalte (Migration 0092: die Entstehung) still.
 */

/** Die Spalten einer Regel als Zeile. */
const RULE_COLUMNS = `rights_basis AS "rightsBasis", license_key AS "licenseKey", creation_method AS "creationMethod", role,
       revoked_on IS NOT NULL AS revoked`;

/** Alle Freigaberegeln, auch widerrufene (die Entscheidung überliest sie); die Tafel ist winzig. */
export function readPublicationRules(db: Queryable): Promise<PublicationRuleFacts[]> {
    return db.unsafe<PublicationRuleFacts[]>(`SELECT ${RULE_COLUMNS} FROM publication_rule ORDER BY id`);
}

/** Dieselben Regeln als EINE JSON-Spalte, für Abfragen, die je Zeile alles mitnehmen (der Resolver fragt einmal je Fachobjekt). */
export const PUBLICATION_RULES_JSON = `
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'rightsBasis', pr.rights_basis, 'licenseKey', pr.license_key, 'creationMethod', pr.creation_method,
                'role', pr.role, 'revoked', pr.revoked_on IS NOT NULL) ORDER BY pr.id), '[]'::jsonb)
     FROM publication_rule pr)
`;
