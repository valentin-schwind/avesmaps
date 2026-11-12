-- 0257: Die Mischgebiete der Sprachen als abgeleitete Tafel und Kachelsicht (WI-0261 S5a; E2: ein Mischgebiet ist, wo sich zwei Sprachen
-- überlappen; Bauvorlage der Probierseite 2026-10-30: Mischgebiete als 45°-Schraffur in beiden Farben).
--
--   1. `sprache_misch`: je Sprachpaar (A, B mit A < B nach `sprache.id`) und Domäne die Teilflächen, in denen sich die aktiven Flächen beider
--      Sprachen überlappen. Je Sprache werden ihre Flächen vorher vereinigt (sich überlappende Teilflächen derselben Sprache sind kein
--      Mischgebiet), dann je Paar verschnitten; nur Polygonteile, je Teil eine Zeile (`teil` ab 1, der größte zuerst). Kleinstreste unter
--      0,5 E² (Rechenrauschen an gemeinsamen Kanten, Glättungssäume) fallen weg; die Tafel prüft das selbst.
--      Warum eine Tafel: MapLibre kann Flächen nicht verschneiden. Die Karte zeichnet die Schraffur aus dieser Quelle über den Füllungen.
--      🔴 ABGELEITET, KEIN FACHBESTAND: Geschrieben nur vom Auftrag `sprache_treffer` (Jobs-Rolle, `apps/server/src/jobs/sprachen-misch.ts`), wenn
--      sein Umfang Sprachen oder „alle“ nennt: Er löscht die Paare mit einer dieser Sprachen und bestimmt sie neu. Ein Lauf nur über Objekte
--      fasst sie nicht an. Die Revision einer Sprache oder Fläche ändert sich dadurch nie.
--   2. `sprache_misch_render`: die Kachelquelle für Martin (Muster `sprache_flaeche_render`, 0254): Schlüssel und Farbe beider Sprachen, Fläche,
--      Geometrie in SRID 3857. Nur Paare zweier aktiver Sprachen: Eine gerade stillgelegte Sprache verschwindet sofort, auch bevor der Auftrag
--      ihre Paare gelöscht hat. Die Farben kommen aus `sprache`, eine neue Farbe braucht deshalb keinen Lauf, nur neue Kacheln.
--
-- 🔴 REIN ADDITIV („erst erweitern“): eine neue Tafel und eine neue Sicht, die das vorige Release nicht kennt; nichts am Bestand. Die Sicht ruft
-- nur Funktionen, die es schon gibt (`map_domain_to_render`).
--
-- Rechte: In public gibt die Default-Privilegie der Migrationsrolle der App-Rolle SELECT, INSERT, UPDATE, DELETE an der Tafel;
-- `apps/server/src/db/system-grants.psql` nimmt ihr alles außer SELECT und gibt der Jobs-Rolle INSERT und DELETE (wie `sprache_treffer`, 0256:
-- abgeleiteter Zwischenspeicher). Die Kachelrolle liest jede `*_render`-Sicht nach `db-grants` von selbst. Die Einordnung steht in
-- `apps/server/test/support/public-rechte.ts`.

-- 1. MISCHGEBIETE -----------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sprache_misch (
    map_domain_id TEXT NOT NULL REFERENCES map_domain (id),
    sprache_a_id BIGINT NOT NULL REFERENCES sprache (id),
    sprache_b_id BIGINT NOT NULL REFERENCES sprache (id),
    teil INTEGER NOT NULL,
    geom geometry(Polygon, 0) NOT NULL,
    berechnet_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sprache_misch_pkey PRIMARY KEY (map_domain_id, sprache_a_id, sprache_b_id, teil),
    CONSTRAINT sprache_misch_paar_geordnet CHECK (sprache_a_id < sprache_b_id),
    CONSTRAINT sprache_misch_teil_positiv CHECK (teil >= 1),
    CONSTRAINT sprache_misch_kein_kleinstrest CHECK (ST_Area(geom) >= 0.5)
);

-- Die Kacheln lesen über die Fläche; der Lauf je Sprache löscht über A (Primärschlüssel) und B.
CREATE INDEX IF NOT EXISTS sprache_misch_geom_gist ON sprache_misch USING GIST (geom);
CREATE INDEX IF NOT EXISTS sprache_misch_sprache_b ON sprache_misch (sprache_b_id);

COMMENT ON TABLE sprache_misch IS
    'Mischgebiete der Sprachen (WI-0261 S5a, E2): je Sprachpaar A < B die Teilflaechen, in denen sich ihre aktiven, je Sprache vereinigten Flaechen ueberlappen. Abgeleiteter Zwischenspeicher des Auftrags sprache_treffer, kein Fachbestand.';
COMMENT ON COLUMN sprache_misch.sprache_a_id IS 'Die Sprache mit der kleineren internen Kennung des Paars.';
COMMENT ON COLUMN sprache_misch.sprache_b_id IS 'Die Sprache mit der groesseren internen Kennung des Paars.';
COMMENT ON COLUMN sprache_misch.teil IS 'Nummer der Teilflaeche im Paar, ab 1, die groesste zuerst; je Lauf neu vergeben.';
COMMENT ON COLUMN sprache_misch.geom IS
    'Ueberlappung in Kartenkoordinaten, SRID 0 (aventuria), ein Polygon je Zeile, mindestens 0,5 E2. Niemals eine Renderprojektion.';
COMMENT ON COLUMN sprache_misch.berechnet_at IS 'Wann der Auftrag diese Zeile geschrieben hat.';

-- 2. KACHELSICHT ------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE VIEW sprache_misch_render AS
SELECT a.schluessel AS schluessel_a,
    b.schluessel AS schluessel_b,
    a.farbe AS farbe_a,
    b.farbe AS farbe_b,
    m.teil,
    round(st_area(m.geom)::numeric, 2)::double precision AS area,
    map_domain_to_render(m.map_domain_id, m.geom)::geometry(Geometry,3857) AS geom
   FROM sprache_misch m
     JOIN sprache a ON a.id = m.sprache_a_id
     JOIN sprache b ON b.id = m.sprache_b_id
  WHERE a.is_active AND b.is_active
  ORDER BY a.schluessel, b.schluessel, m.teil;

COMMENT ON VIEW sprache_misch_render IS
    'Mischgebiete fuer die Kachel (WI-0261 S5a): Paare zweier aktiver Sprachen in SRID 3857, mit Schluessel und Farbe beider Sprachen. Niemals Source of Truth.';
