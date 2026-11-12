-- Ein Name je Kette, nicht je Abschnitt (WI-0010, P5).
--
-- 💣 GEMESSEN, nachdem ich die Ursache zweimal falsch vermutet hatte. Von 473 beschriftbaren
-- Wegen im Bild wurde EINER gezeichnet. Meine erste Vermutung war die Kollision mit den
-- Ortsnamen — falsch: bei z7 stehen nur 14 Ortsnamen im Weg und trotzdem erscheinen bloß drei
-- Wegnamen. Meine zweite war die Segmentlänge — auch falsch: bei z5 sind 56 % der Abschnitte lang
-- genug für ihren Namen.
--
-- Die Messung sagt: **die Wegnamen blockieren einander.** Mit `text-allow-overlap` stiegen sie von
-- 1 auf 13, mit zusätzlich offenem Winkel auf 41. 473 Abschnitte wollen 149 Namen setzen, und
-- 3,7 Abschnitte desselben Namens konkurrieren um dieselbe Stelle.
--
-- ⭐ Deshalb die Kette: gleichnamige, zusammenhängende Abschnitte werden EIN Feature. Statt dass
-- „Reichsstraße 2" siebenundsiebzig Mal um Platz bittet, tut es ihre Kette — und setzt ihren Namen
-- entlang ihrer Länge in Abständen, statt an 77 Stellen gleichzeitig.
--
-- 🪤 Diese Sicht ersetzt `path_render` NICHT. Die Linien werden weiter je Abschnitt gezeichnet:
-- sie tragen Art, Merkmale und Identität, und eine Kette aus acht Abschnitten hätte keine
-- `public_id`, die auf etwas zeigt. Nur die BESCHRIFTUNG braucht die Zusammenfassung.

CREATE OR REPLACE VIEW path_label_render AS
SELECT
    -- 🔴 Der Schlüssel ist Name plus Art, nicht eine Nummer. Legacys teuerste Identitätslektion
    -- steht genau hier: sein Kreuzungs-Zähler machte aus einem Namen eine Position und benannte
    -- bei jeder Änderung bis zu 2083 Knoten um. Eine Kette heißt, wie sie heißt.
    p.name,
    p.subtype,
    -- Wie viele Abschnitte in dieser Kette stecken. Nicht für die Darstellung, sondern damit eine
    -- Prüfung sagen kann, ob die Zusammenfassung überhaupt gegriffen hat.
    count(*)::integer AS segment_count,
    ST_LineMerge(ST_Collect(map_domain_to_render(p.map_domain_id, p.geom)))::geometry(Geometry, 3857) AS geom,
    label_collision_rank(NULL::smallint, NULL::smallint, NULL::smallint) AS collision_rank
FROM path p
WHERE p.is_active
  -- Nur was ein Editor eingeschaltet hat. Die übrigen heißen überwiegend `Pfad-1` und hätten
  -- nichts zu sagen.
  AND p.label_visible
GROUP BY p.name, p.subtype, p.map_domain_id
-- Feste Reihenfolge wie in 0016. Name plus Art ist der stabile Schlüssel dieser Relation.
ORDER BY p.name, p.subtype;

COMMENT ON VIEW path_label_render IS
    'Wegnamen je KETTE gleichnamiger Abschnitte (WI-0010 P5). ST_LineMerge fuegt zusammen, was zusammenhaengt; was Luecken hat, bleibt mehrteilig - Legacy gruppiert ebenso ueber Luecken. Die LINIEN kommen weiter aus path_render: eine Kette hat keine public_id, die auf etwas zeigt.';
