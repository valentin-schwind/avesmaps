-- Bewusst stillgelegte Regionen: eine namentliche Liste, keine Regel.
--
-- Betreiberentscheidung vom 2026-09-20, nach der Abnahme von WI-0003. Zwoelf Legacy-Reste sollen
-- im Ziel nicht aktiv sein, aber auch nicht verschwinden: Identitaet und Herkunft bleiben erhalten,
-- damit ein Audit sie noch findet.
--
-- 💣 AUSDRUECKLICH KEINE REGEL "Region ohne Flaeche ist inaktiv". Das Domainmodell erlaubt
-- Regionen mit null Flaechen und null Labels weiterhin - eine Region entsteht im redaktionellen
-- Ablauf, bevor jemand ihre erste Flaeche zeichnet. Wer aus diesen zwoelf eine Bedingung macht,
-- legt kuenftig jede halbfertige Redaktionsarbeit still.
--
-- Die Liste ist der Grund, warum das hier eine Tabelle ist und kein einmaliges UPDATE: der Import
-- spiegelt Legacy, und Legacy fuehrt diese zwoelf als aktiv. Ohne eine dauerhafte Ablage haette
-- der naechste Lauf sie wieder eingeschaltet.

CREATE TABLE IF NOT EXISTS region_retirement (
    -- Die oeffentliche Identitaet der Region. Ausgewaehlt wurde ueber genau diese IDs, nie ueber
    -- den Namen und nie ueber area_count.
    public_id UUID PRIMARY KEY,
    reason TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decided_at DATE NOT NULL,
    -- Woran der Befund haengt, damit er nachvollziehbar bleibt, wenn der Snapshot laengst weg ist.
    evidence TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE region_retirement IS
    'Namentlich stillgelegte Regionen (Betreiberentscheidung). Keine Regel, eine Liste. Der Import setzt diese Regionen auf is_active = false, statt sie aus Legacy wieder einzuschalten.';

-- Die zwoelf aus dem Snapshot vom 2026-09-20 belegten Legacy-Reste. Jede traegt null aktive
-- Flaechen, null gebundene Labels und einen Primaerlabel-Zeiger, der ins Leere geht - die Signatur
-- eines halb abgeschlossenen Loeschvorgangs, den Legacy stehen laesst, weil der Zeiger sein
-- Rueckweg beim Rueckgaengigmachen ist.
INSERT INTO region_retirement (public_id, reason, decided_by, decided_at, evidence)
VALUES
    ('4bb52a21-9fd8-4859-80ea-356b36834cf1', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('0bde9092-979d-4bb0-b4ef-11c3fb2442b7', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('301d0c61-b773-4174-a74e-d271483d7bfc', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('d7bf47c7-348b-45f8-8304-9da11938aa8a', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('573207aa-7fd4-4d3a-a705-b149d3e92364', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('6c5a35c2-df90-40d8-8cac-93892420b290', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('f8d0df41-9bea-4ed9-a28e-c2aabe885cff', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('a5ce14e5-7de7-4212-8c1e-2a9cf40f141c', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('cf98112d-2096-425e-9d21-73740e2b4605', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('5ad7951a-94ba-468e-aa09-fdbeb32f20fb', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('171407c7-6e58-4153-91cc-9bdf40930497', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237'),
    ('4136b1df-b080-4b21-8dad-bb5acc392d8f', 'Legacy-Rest ohne Flaeche, ohne Label, toter Primaerzeiger', 'operator', DATE '2026-09-20', 'list_regions 2026-09-20, sha256 113D5E80...F237')
ON CONFLICT (public_id) DO NOTHING;

-- Die Renderansicht zeigt ohnehin nur aktive Regionen; hier steht nur, dass das kein Zufall ist.
COMMENT ON VIEW region_area_render IS
    'Abgeleitete Renderansicht der Landschaftsflaechen fuer Martin. Niemals Source of Truth (Kapitel 4.17.4). Zeigt nur aktive Regionen, also auch keine namentlich stillgelegte.';
