-- Bewertungen von Orten (WI-0063 P3, Vertrag `project-control/migration/contracts/reviews.yaml`, D4, Legacy-Export E3).
--
-- 🔴 Eine Bewertung gehört genau einem Ort (typisierter Fremdschlüssel, nie `entity_type` plus Kennung) und hat keine Teile. Sie ist
-- eine Aussage Dritter und kein redaktionelles Kartendatum: der Import ist eine KOPIE DES ÖFFENTLICH SICHTBAREN. Zusammenfassung
-- (Anzahl, Durchschnitt) ist abgeleitet und wird gelesen, nie gespeichert.
--
-- 🔴 DATENSCHUTZ ZUERST (technische Entscheidung der Discovery, kein Betreibergate):
--   - Hier gibt es KEINE Personenspalte: weder `ip_hash` (ein HMAC mit dem Datenbanknamen als Salz, für jeden rückrechenbar, der den
--     Namen kennt) noch `user_agent`, `request_origin` oder eine Konto-Kennung. Legacys Export liefert sie nicht; der Importer liest
--     sie auch dann nicht, wenn eine Antwort sie fälschlich trüge. Ein Test und der Prüfer sehen nach, dass die Tabelle sie nicht hat.
--   - Verborgene und Spam-Zeilen (möglicher rechtswidriger Inhalt, von Legacys Moderation weggenommen) werden NIE gespeichert, auch
--     nicht als Tombstone. Eine Bewertung, die in Legacy verborgen, gelöscht oder als Spam gesetzt wird, wird beim nächsten Zug hier
--     HART GELÖSCHT (`lifecycle derived` im gemeinsamen Abgleich): es gibt kein `is_active`, kein `retired_at` und nichts, was einen
--     Inhalt über die Moderation hinaus aufbewahrt. Die Kennung der Zeile steht danach nur noch im Bericht, nie ihr Text.
--   - `author_name` ist ein FREIER Name bis 80 Zeichen und kann einen Klarnamen tragen, `body` freier Text bis 200 Zeichen. Beides ist
--     in Legacy öffentlich und wird nur an der Ortsbewertung gezeigt, nie einem Konto zugeordnet, nie nach Autor gruppiert oder gesucht.
--     Kein Index und keine Abfrage über den Autor.
--   - Der Namensschnappschuss `location_name` der Antwort wird NICHT gespeichert (nur für Befunde, nie zur Auflösung).
--
-- 🔴 Ein Schreibpfad für neue Bewertungen entsteht hier nicht (Abgabe, Moderation, Meldeknopf, Spam-Filter, Ratenbegrenzung gehören zu
-- WI-0068 und dem Community-Pfad mit M10). Geschrieben wird die Tabelle vorerst nur vom Import (`migrate:reviews`); Zeilen mit
-- `source_system` ungleich `legacy` (kein heutiger Pfad legt welche an) fasst der Import nie an.
--
-- Identität: `legacy_review_id` ist Legacys laufende Nummer (INT). Sie kann nach einem harten Löschen der letzten Zeile wiederkehren,
-- darum ist sie nur mit Anlagezeit und Ort Identität (der Import legt bei Abweichung eine NEUE Zeile an und räumt die alte weg).
--
-- Die Anlagezeit ist die NAIVE Zeit, wie der Export sie liefert (`YYYY-MM-DD HH:MM:SS`); die Zone des Legacy-Servers ist nicht belegt.
-- Aventurisches Datum und Texte stehen wörtlich da (nie als Datum geparst); ein leerer Wert ist NULL, nie ein leerer String.
-- Längen: Legacys Obergrenzen (Autor 80, Text 200, Datum 60) stehen hier NICHT als CHECK, aus demselben Grund wie in 0065 bis 0069 (ein
-- längerer Quelltext hielte den Import an, Betreiber 2026-10-03); der Import meldet ihn als Befund und speichert ihn unverändert.

CREATE TABLE IF NOT EXISTS place_review (
    id BIGSERIAL PRIMARY KEY,
    legacy_review_id INTEGER NOT NULL,
    place_id BIGINT NOT NULL REFERENCES place (id),
    stars SMALLINT NOT NULL,
    author_name TEXT,
    body TEXT,
    dsa_date TEXT,
    legacy_created_at TIMESTAMP NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'legacy',
    migration_run_id UUID REFERENCES migration_run (id),
    imported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_review_legacy_id_unique UNIQUE (legacy_review_id),
    CONSTRAINT place_review_stars_range CHECK (stars BETWEEN 1 AND 5),
    CONSTRAINT place_review_text_not_blank CHECK (
        (author_name IS NULL OR btrim(author_name) <> '')
        AND (body IS NULL OR btrim(body) <> '')
        AND (dsa_date IS NULL OR btrim(dsa_date) <> '')
    ),
    CONSTRAINT place_review_source_not_blank CHECK (btrim(source_system) <> '')
);

-- Liste, Anzahl und Durchschnitt je Ort, neueste zuerst (Legacy: `created_at DESC, id DESC`; die Kennung ist hier Legacys, nicht die
-- laufende Zeilennummer, damit gleiche Anlagezeiten in Legacys Reihenfolge bleiben).
CREATE INDEX IF NOT EXISTS place_review_place_created ON place_review (place_id, legacy_created_at DESC, legacy_review_id DESC);

COMMENT ON TABLE place_review IS
    'Sichtbare Sternebewertung eines Ortes (D4, E3). Kopie des öffentlich Sichtbaren, ohne Personenspalte; Verborgenes und Spam wird nie gespeichert und beim nächsten Zug gelöscht.';
COMMENT ON COLUMN place_review.legacy_review_id IS
    'Legacys laufende Nummer; nur mit Anlagezeit und Ort Identität (Nummern können nach einem harten Löschen wiederkehren).';
COMMENT ON COLUMN place_review.author_name IS
    'Freier Anzeigename des Verfassers (bis 80 Zeichen, kann einen Klarnamen tragen); nie einem Konto zugeordnet, nie nach Autor gesucht. NULL = leer (der Leser zeigt „Anonym“ über die Sprachtafel).';
COMMENT ON COLUMN place_review.body IS 'Freitext bis 200 Zeichen, wörtlich; NULL = kein Text.';
COMMENT ON COLUMN place_review.dsa_date IS 'Aventurisches Datum als Text („3. Praios 1047 BF“), wörtlich, nie als Datum geparst.';
COMMENT ON COLUMN place_review.legacy_created_at IS
    'Anlagezeit wie der Export sie liefert, OHNE Zeitzone (die Zone des Legacy-Servers ist nicht belegt).';
