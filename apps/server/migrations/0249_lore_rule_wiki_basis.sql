-- 0249: Eine Regel von Hand merkt sich die Wiki-Fassung, von der sie ausging (WI-0254 `--weiter`, Regeleditor im Reiter „Vorkommen“, Bezug WI-0253 §26).
--
--   Wer im Fenster „Inhalte bearbeiten“ eine Regel ändert, legt eine neue Regel von Hand an und legt die alte still (die App darf an `lore_rule` nur anlegen und still legen, `map-grants.psql`).
--   Ging die alte aus dem Wiki hervor (Herkunft `wiki_verbreitung`), soll die neue wissen, welche Wiki-Fassung sie ersetzt: für „↺ Wiki-Fassung“ und für den Hinweis „Das Wiki sagt seitdem …“,
--   wenn der WikiSync später etwas anderes ableitet. Dafür gibt es eine Spalte:
--
--   - `lore_rule.wiki_basis_key`: der Fingerabdruck (`rule_key`) der Wiki-Fassung, von der die Regel von Hand ausging. Gesetzt nur an einer Regel von Hand (Herkunft `manual`), die aus einer
--     Wiki-Regel oder einem Vorschlag des WikiSync entstand; sonst NULL. Er verweist auf keine Zeile (die Wiki-Fassung kann nie angelegt worden sein, wenn die Regel aus einem Vorschlag
--     entstand), darum ohne Fremdschlüssel und ohne Prüfung.
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue, nullbare Spalte, die das vorige Release nie liest und nie schreibt; keine Datenänderung, keine Prüfung, keine neue Tafel. Die Rechte ändern
-- sich nicht (`apps/server/src/db/map-grants.psql`): Die App legt Regeln mit INSERT an, die neue Spalte schreibt sie nur dabei, UPDATE bleibt auf die fünf Spalten des Zustands beschränkt.

ALTER TABLE lore_rule ADD COLUMN IF NOT EXISTS wiki_basis_key TEXT;

COMMENT ON COLUMN lore_rule.wiki_basis_key IS
    'Der rule_key der Wiki-Fassung, von der diese Regel von Hand ausging (WI-0254, 0249); gesetzt nur bei legacy_origin manual, wenn sie eine Wiki-Regel oder einen Vorschlag des WikiSync ersetzt, sonst NULL. Ohne Fremdschlüssel: die Fassung kann nie angelegt worden sein.';
