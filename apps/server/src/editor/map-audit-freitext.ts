/**
 * Freitext im Fachprotokoll der Karte (`map_audit_event.changes`, Positivliste `MAP_AUDIT_FIELDS` in `map-operation.ts`), den eine Person als BEGRÜNDUNG
 * ihrer Handlung schrieb und der deshalb einen Namen, eine Mail oder eine Beschwerde tragen kann (WI-0265 B7; Fachvertrag F.3).
 *
 * Beim Auflösen eines Kontos schwärzt `public.redact_person_map_operation()` (Migration 0273) genau diese Schlüssel in den Operationen der Person
 * (`map_operation.actor_person_id`); der Schlüssel bleibt, sein Wert (`after`) wird "[geschwärzt]". Der Reiter „Änderungen“ zeigt die Marke dann als Grund.
 *
 * Nicht darunter, weil Inhalt der Karte und nicht Begründung der Person über ihre Handlung: jeder andere Schlüssel der Positivliste, auch `editorNote`
 * (Redaktionsnotiz am Datensatz einer Quelle, eines Werks, eines Korpus, eines Lore-Eintrags) und die `note` einer Quellenverwendung. Ihr `before` schreibt die
 * Rücknahme zurück; schwärzte man sie, verlöre die Karte Geschichte. `map_operation.summary` nennt nur den Gegenstand, nie einen Grund.
 *
 * 🔴 Dieselbe Liste steht in Migration 0273 (`map-redact-person.test.ts` hält beide gleich). Wer einen neuen Schlüssel mit Begründung der Person in
 * `MAP_AUDIT_FIELDS` aufnimmt (etwa den Grund einer anderen Handlung), ergänzt ihn hier UND in einer neuen Migration, die die Funktion ersetzt; der Test
 * fällt, wenn ein Schlüssel nach Grund aussieht und hier fehlt.
 */
export const MAP_AUDIT_FREE_TEXT_KEYS = ["restoreReason"] as const;
