-- 0251: Der Lauf legt ab, was das Wiki je Quelle und Objekt zitiert (WI-0254 §12, Quellen-Klappbox in den Editoren; Bezug WI-0253 §21, Bereich `quelle`; Vali: „ist egal, wo er sie her hat,
-- vergleich mit dem wiki, alles andere ist manuell“).
--
--   Der Lauf der Vorschau vergleicht schon die Publikationen jedes Artikels mit den Verknüpfungen seines Trägers (`wiki/abgleich/quellen.ts`), legt aber nur die ABWEICHUNGEN als Planzeilen ab: Was
--   gleich ist, steht nirgends. Die Klappbox der Editoren (Ort, Gebiet, Landschaft, Weg) braucht für „Im Wiki: …“ und den Kreis (○ ◐ ●) aber GENAU diesen Stand für jede Verknüpfung: Was zitiert
--   der Artikel dieses Objekts zu dieser Quelle, mit welcher Art, welchen Seiten und welcher Notiz.
--
--   `wikisync_quelle_zitat`: eine Zeile je Lauf, Träger und Quelle, die STÄRKSTE Nennung der Quelle im Artikel des Trägers (ausführlich vor ergänzend vor erwähnt, bei gleicher Stärke die erste), so
--   gekürzt, wie der Vergleich sie liest (Seiten 120, Notiz 200 Zeichen, die Spalten der Quellen in Legacy). Der Schlüssel der Quelle (`quelle_key`) ist `feature_source.source_key`: der der Quelle, die
--   die Karte schon hat (auch die alte Kennung `wikipub:<Slug>`, wenn die Produktseite inzwischen eine Shop-Adresse hat), sonst der, unter dem der Lauf sie anlegen würde. Der Träger ist über
--   `traeger_art` und `traeger_id` (die öffentliche Kennung, `<träger>.public_id`) benannt, nie über seinen Namen; ein Weg ist ein Abschnitt, die Straße besteht aus mehreren. `lore` ist für die
--   Quellen eines Vorkommens vorgesehen (`lore_entry.public_id`); den Lauf, der sie ablegt, gibt es noch nicht.
--
--   Die Zeilen gehören zum Lauf (`ON DELETE CASCADE`): Der Lauf schreibt sie in derselben Transaktion wie seine Planzeilen, und sie fallen mit ihm, wenn `raeumeAb` ältere Läufe entfernt (die zwei
--   jüngsten je Bereich bleiben). Gelesen wird aus dem jüngsten fertigen Lauf mit dem Bereich `quelle`; in dessen `zahlen` steht unter `quelle`, ob er seine Zitate ablegte (`zitate`, die Zahl der
--   Zeilen) oder übersprang, weil der Jobs-Rolle das Recht noch fehlte (`zitateUebersprungen`).
--
-- 🔴 ADDITIV (AGENTS.md, „erst erweitern“): eine neue Tafel, die das vorige Release nie liest und nie schreibt; keine Datenänderung, keine bestehende Tafel berührt. Keine Fachtafel: Der Lauf schreibt in
-- keine, die Zitate sind ein Protokoll des Wiki-Stands wie `wikisync_lauf_zeile`. Die Rechte (die App liest nur, die Jobs-Rolle legt an, nie UPDATE oder DELETE) stehen in
-- `apps/server/src/db/system-grants.psql` (hinter JEDE Migration). 🪤 Eine neue Tafel braucht auf Stage und Production einen Rechte-Lauf durch Claudio; bis dahin prüft der Lauf das Recht und überspringt
-- die Zitate mit einer Zahl, statt zu scheitern.

CREATE TABLE IF NOT EXISTS wikisync_quelle_zitat (
    lauf_id BIGINT NOT NULL REFERENCES wikisync_lauf (id) ON DELETE CASCADE,
    -- Die Art des Trägers, wie das Fenster „Inhalte bearbeiten“ sie nennt (`inhalte-quellen.ts`): Ort, Weg (Abschnitt), Herrschaftsgebiet, Landschaft, Gipfel; `lore`: ein Vorkommen.
    traeger_art TEXT NOT NULL CHECK (traeger_art IN ('place', 'path', 'territory', 'area', 'peak', 'lore')),
    -- Die öffentliche Kennung des Trägers (`<träger>.public_id`), nie seine Nummer.
    traeger_id UUID NOT NULL,
    -- `feature_source.source_key` der Quelle (`url:<sha256>` der Shop-Adresse oder `wikipub:<Slug>`).
    quelle_key TEXT NOT NULL CHECK (btrim(quelle_key) <> ''),
    -- Wie der Artikel die Quelle nennt (die Art der Verknüpfung, `reference_kind`).
    art TEXT NOT NULL CHECK (art IN ('ausfuehrlich', 'ergaenzend', 'erwaehnung')),
    seiten TEXT CHECK (seiten IS NULL OR (btrim(seiten) <> '' AND char_length(seiten) <= 120)),
    notiz TEXT CHECK (notiz IS NULL OR (btrim(notiz) <> '' AND char_length(notiz) <= 200)),
    -- Der Titel des Wiki-Artikels, aus dem die Nennung stammt.
    artikel TEXT NOT NULL CHECK (btrim(artikel) <> ''),
    PRIMARY KEY (lauf_id, traeger_art, traeger_id, quelle_key)
);

COMMENT ON TABLE wikisync_quelle_zitat IS
    'Was das Wiki je Quelle und Objekt zitiert (0251, WI-0254 §12): die stärkste Nennung einer Publikation im Artikel eines Trägers, gekürzt wie der Vergleich (Seiten 120, Notiz 200). Eine Zeile je Lauf, Träger und Quelle; fällt mit dem Lauf (ON DELETE CASCADE). Gelesen wird aus dem jüngsten fertigen Lauf mit dem Bereich quelle; die Quellen-Klappbox der Editoren vergleicht damit (Kreis, „Im Wiki: …“). Geschrieben nur vom Lauf der Vorschau (Jobs-Rolle).';
COMMENT ON COLUMN wikisync_quelle_zitat.traeger_id IS
    'Die öffentliche Kennung des Trägers (<träger>.public_id) zu traeger_art; bei einem Weg die des Abschnitts.';
COMMENT ON COLUMN wikisync_quelle_zitat.quelle_key IS
    'feature_source.source_key der Quelle: die der Karte (auch die alte Kennung wikipub:<Slug> bei neuer Shop-Adresse), sonst die, unter der der Lauf sie anlegen würde. Der Leser verbindet über traeger_art, traeger_id und diesen Schlüssel.';
