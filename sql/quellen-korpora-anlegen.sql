-- Die Korpora — Namen vom Owner (02.09.2026), Lizenzen aus den Wikis selbst gelesen.
--
-- 🔴 Der SCHLÜSSEL ist die registrierbare Domain und wird NIE getippt — er entsteht aus
-- `sources.url` (avesmapsSourceCorpusKey). Diese Datei setzt nur, was sich NICHT ableiten lässt:
-- den Namen, die Form und die Vorgaben.
--
-- ⚠️ Die Lizenzen stammen aus `api.php?meta=siteinfo&siprop=rightsinfo` der Wikis, also aus ihrer
-- eigenen Konfiguration — nicht aus einem Fusstext und nicht geraten. Wo dort nichts steht, bleibt
-- die Spalte LEER: das ist die Aussage „nicht erfasst" und rechtlich etwas anderes als eine freie
-- Lizenz (avesmapsNormalizeSourceLicense).
--
-- 💣 `form = 'belegstelle'` heisst: der KORPUSNAME steht dem Besucher vorn, der Seitentitel wandert
-- ins ⓘ. Das ist bei allen sechs richtig — es sind Fanwikis und Briefspiele, deren einzelne Seite
-- der Beleg ist, nicht ein Werk mit eigenem Titel.
-- ⚠️ Der gerechnete Vorschlag traegt das NICHT allein: horaswiki.de hat 3 Zeilen mit 3 Titeln
-- (Verhaeltnis 1,0 — sieht aus wie ein Werk). Bei so wenigen Zeilen sagt die Zahl nichts, und
-- deshalb entscheidet sie hier ein Mensch.
--
-- 🔴 DAS DURCHSCHREIBEN PASSIERT HIER NICHT. `avesmapsSourceCorpusSave` traegt Art, Lizenz und
-- Nennung auf alle Quellen des Wirts weiter; dieses SQL setzt nur die Korpuszeile. Wer das
-- Durchschreiben will, fasst danach im Editor EIN Feld des Korpus an — oder wir bauen dafuer
-- einen eigenen Lauf.
--
-- Ausführen: phpMyAdmin → SQL, oder  mysql < sql/quellen-korpora-anlegen.sql

CREATE TABLE IF NOT EXISTS source_corpus (
    corpus_key VARCHAR(190) NOT NULL PRIMARY KEY,
    label VARCHAR(200) NOT NULL DEFAULT '',
    form VARCHAR(16) NOT NULL DEFAULT '',
    source_type VARCHAR(32) NOT NULL DEFAULT '',
    license VARCHAR(32) NOT NULL DEFAULT '',
    attribution VARCHAR(200) NOT NULL DEFAULT '',
    is_official TINYINT(1) NOT NULL DEFAULT 0,
    updated_by INT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- corpus_key, label, form, source_type, license
INSERT INTO source_corpus (corpus_key, label, form, source_type, license) VALUES
  ('punin.de',             'Almada-Wiki',        'belegstelle', 'briefspiel', ''),
  ('westlande.de',         'Albernia-Wiki',      'belegstelle', 'briefspiel', 'cc-by-sa-4.0'),
  ('herzogtum-weiden.net', 'Herzogtum Weiden',   'belegstelle', 'briefspiel', ''),
  ('kahet-ni-kemi.de',     'Káhet Ni Kemi!',     'belegstelle', 'briefspiel', ''),
  ('horaswiki.de',         'LieblichesFeld-Wiki','belegstelle', 'briefspiel', 'cc-by-sa-4.0'),
  ('liebliches-feld.net',  'LieblichesFeld-Wiki','belegstelle', 'briefspiel', 'cc-by-sa-4.0'),
  ('garetien.de',          'Garetien-Wiki',      'belegstelle', 'briefspiel', 'cc-by-nc-sa-3.0')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), form = VALUES(form),
  source_type = VALUES(source_type), license = VALUES(license);

-- Gegenprobe: sieben Zeilen, zwei davon mit demselben Namen (horaswiki.de + liebliches-feld.net).
SELECT corpus_key, label, form, source_type, license FROM source_corpus ORDER BY label, corpus_key;

-- ── Was hier FEHLT und warum ─────────────────────────────────────────────────────────────────
--
-- 🔧 rommilyser-mark.de (1 Zeile, 1 Objekt) hat KEINEN Namen aus deiner Liste. Die Seite nennt
--    sich „Rommilyser Mark - Mark Rommilys". „Nordmarken-Wiki" wäre geraten — Rommilys liegt zwar
--    in den Nordmarken, aber das Angebot ist ein eigenes. Bleibt vorerst ohne Korpuszeile und
--    zeigt damit seinen Schlüssel als Namen.
--
-- 🔧 Drei deiner Namen haben (noch) KEIN Korpus im Katalog:
--      Káhet-Ni-Kemi-Projekt  — die Seiten von kahet-ni-kemi.de nennen sich „… - Káhet Ni Kemi",
--                               also ist „Káhet Ni Kemi!" dort der Sitzende. Wofür steht das
--                               „Projekt"? Eine zweite Adresse gibt es im Katalog nicht.
--      Nordmarken-Wiki        — keine passende Domain im Katalog.
--      Kosch-Wiki             — keine passende Domain im Katalog. ⭐ koschwiki.de ist im
--                               Garetien-Import vorgesehen (AGENTS.md); der Name wird dort fällig,
--                               nicht hier.
--
-- ⚠️ horaswiki.de und liebliches-feld.net tragen bewusst DENSELBEN Namen (Owner-Entscheid). Sie
--    sind belegt dasselbe Wiki — beide Domains antworten auf `wiki.horaswiki.de/w/api.php` und
--    melden denselben Sitename. 💣 Es bleiben trotzdem ZWEI Korpuszeilen mit zwei Schlüsseln:
--    wer eine ändert, ändert die andere NICHT. Das ist die Grenze des Domain-Schlüssels, und sie
--    steht hier, damit sie beim ersten Auseinanderlaufen nicht überrascht.
