-- 0272: Herkunft einer Kartenoperation aus einem Community-Vorgang (WI-0268 C7; Fachkonzept WI-0263 §6: „Wer aus dem Vorgang mit ⚙ den Editor
-- öffnet, trägt den Vorgang als Herkunft mit … Die Operation merkt sich den Verweis“).
--
-- Die Nummer des Vorgangs (COM-…, `avesmaps_community.vorgang.id`) ohne Fremdschlüssel: Die Operation ist ein Protokoll, das nur anhängt, und
-- darf weder an den Fristen des Community-Moduls (Papierkorb, Löschung) noch an dessen Rechten hängen. Ob es den Vorgang gibt, prüft der
-- Schreiber vor der Transaktion (`apps/server/src/community/herkunft.ts`); eine unbekannte Nummer bleibt leer.
--
-- Additiv: eine neue Spalte ohne Vorgabe; das vorige Release schreibt sie nicht und liest sie nicht. Die Rechte der App-Rolle gelten für die
-- ganze Tafel (`map-grants.psql`).

ALTER TABLE map_operation ADD COLUMN IF NOT EXISTS community_vorgang BIGINT;

CREATE INDEX IF NOT EXISTS map_operation_community ON map_operation (community_vorgang) WHERE community_vorgang IS NOT NULL;

COMMENT ON COLUMN map_operation.community_vorgang IS
    'Herkunft (WI-0268 C7): der Community-Vorgang (COM-Nummer), aus dem der Editor geöffnet wurde; ohne Fremdschlüssel, nur bei Personen.';
