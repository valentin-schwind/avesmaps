-- Der Merker „gleichnamig“ an den Landschaftsnamen (WI-0135, Betreiber 2026-10-11).
--
-- Betreiber wörtlich: „nur bei landschaften, alle: oft hat man flächen gleicher art übereinander liegen. schön wärs wenn bei
-- 2 flächen, die gleich heißen, in einer 2. zeile "steppe" oder "tiefebene" (klein, zentriert) unter dem name drunterstehen
-- könnte. das brauchen wir nur bei vegetation und topographie“. Auf das Blatt hin: „ok, mach das empfohlene“, also die Regel
-- über den NAMEN, ohne Lageprüfung.
--
-- `name_twin` ist wahr, wenn die Region des Namens in der Vegetation oder der Topographie liegt und es dort eine ANDERE aktive
-- Region mit genau demselben Namen und mindestens einer aktiven Fläche gibt. Am Entwicklungssatz trifft das 170 Regionen, 65
-- davon tragen einen eigenen Namen. Ob die Art als zweite Zeile erscheint, entscheidet der Stil (nur in der Ebene „Alle“).
--
-- 🪤 Bewusst ohne Lageprüfung: Die Abfrage läuft je Kachel für jeden Namen; ein Vergleich über den Namen kostet über den Index
-- fast nichts, ein Schnitt der Flächen je Name nicht. Gemessen: 103 gleichnamige Paare, 79 davon überschneiden sich.
--
-- Additiv: Die Sicht wächst nur hinten (`CREATE OR REPLACE VIEW`, Spalten in derselben Reihenfolge), Rechte bleiben; das vorige
-- Release liest die neue Spalte nicht. Danach Martin neu starten, sonst fehlt sie in der Kachel.

CREATE INDEX IF NOT EXISTS region_name_landscape_idx
    ON region (name)
    WHERE is_active AND region_layer IN ('vegetation', 'topographie');

CREATE OR REPLACE VIEW map_label_render AS
SELECT l.public_id,
    l.name,
    e.label_size,
    e.label_min_zoom,
    e.label_max_zoom,
    e.label_priority,
    reg.public_id AS region_public_id,
    reg.region_layer,
    (EXISTS ( SELECT 1
           FROM landscape_label_run r
          WHERE r.region_id = l.region_id)) AS has_curve_run,
    map_domain_to_render(l.map_domain_id, l.geom)::geometry(Point,3857) AS geom,
    label_collision_rank(NULL::smallint, e.label_priority, e.label_min_zoom) AS collision_rank,
    reg.region_type,
    l.subtype AS label_type,
    (reg.region_layer IN ('vegetation', 'topographie') AND EXISTS ( SELECT 1
           FROM region zwilling
          WHERE zwilling.is_active
            AND zwilling.region_layer IN ('vegetation', 'topographie')
            AND zwilling.name = reg.name
            AND zwilling.id <> reg.id
            AND EXISTS ( SELECT 1
                   FROM region_area a
                  WHERE a.region_id = zwilling.id AND a.is_active))) IS TRUE AS name_twin
   FROM map_label l
     JOIN map_label_effective e ON e.label_id = l.id
     LEFT JOIN region reg ON reg.id = l.region_id AND reg.is_active
  WHERE l.is_active AND l.show_name IS DISTINCT FROM false
  ORDER BY l.public_id;
