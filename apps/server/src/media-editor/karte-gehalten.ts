/**
 * Wann der Legacy-Zug eine Karte der Kartensammlung stehen lässt (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“): sobald ein Mensch sie in
 * der Medienverwaltung geändert hat, also eine Zeile `citymap.updated` im Fachprotokoll der Medien an ihr steht (Migration 0197). Ebenso eine
 * Karte, die die Redaktion aus einem Besucher-Vorschlag angelegt hat (`citymap.created`, `kartenvorschlag/annehmen.ts`, WI-0275): Legacy kennt sie
 * nicht, der Zug darf sie nie stilllegen. Dieselbe Zeile, dieselbe Mechanik. Ebenso Entfernen und Zurückholen
 * (`citymap.retired`, `citymap.restored`, WI-0287): Ein zurückgeholter Eintrag soll der Zug nicht erneut stilllegen.
 *
 * 🔴 Dieselbe Regel wie bei den Bildern (`migration/media-import.ts`: Rechte und Entstehung, die ein Mensch gesetzt hat, bleiben), keine
 * zweite Mechanik: Der Zug liest das Fachprotokoll und meldet, was Legacy anders hat, als Befund `row_vs_decision` (Kapitel 9.37), statt
 * zu überschreiben. Der Schutz gilt der Karte als Ganzes (0069: „kein Herkunftsvermerk je Feld“): mit ihr bleiben ihre Typen, Bezüge,
 * Orte, Fundstellen und Quellen stehen (`PARENT_PROTECTED` in `citymaps-import.ts`).
 *
 * Ohne Abhängigkeiten, weil der Zug (`migration/`) und die Leseansicht dieselbe Bedingung brauchen.
 */
export function karteGehalten(alias: string): string {
    return `EXISTS (SELECT 1 FROM media_audit_event g WHERE g.citymap_public_id = ${alias}.public_id AND g.action IN ('citymap.updated', 'citymap.created', 'citymap.retired', 'citymap.restored'))`;
}
