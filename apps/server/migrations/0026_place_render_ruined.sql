-- Ruinen stehen kursiv (WI-0014, Finding MCS-015) - dafür muss die Kachel wissen, welcher Ort eine
-- ist.
--
-- ⭐ HIER ENTSTEHT KEIN DATUM. `place.is_ruined` liegt seit WI-0002 in der Datenbank, migriert und
-- gegen Legacy geprüft; es hat bisher nur nie die Renderansicht erreicht. Diese Migration ist
-- deshalb eine reine DARSTELLUNGSänderung: kein neues Feld, keine neue Semantik, keine Geometrie,
-- keine Kollisionsregel, keine Sichtbarkeitsregel. Ein Ort, der heute auf der Karte steht, steht
-- danach an derselben Stelle in derselben Größe - nur schräg, wenn er eine Ruine ist.
--
-- 🪤 DIE SPALTE WÄCHST AM ENDE, und das ist kein Schönheitsfehler. PostgreSQL lässt eine Sicht nur
-- am Ende wachsen (`42P16: cannot change name of view column`); eine Spalte in der Mitte erzwingt
-- DROP + CREATE, und ein `DROP VIEW` nimmt der Martin-Rolle ihr Leserecht. Claudio hat genau das
-- auf dem VPS gemessen (Handover `2026-09-20-runtime-foundation.md`), seither wacht
-- `render-grants.test.ts` darüber. Die Sicht ist wortgleich zu 0017, nur um eine letzte Spalte
-- länger.
--
-- 💣 DIE KACHELBYTES ÄNDERN SICH. Jedes Ortsfeature trägt eine Eigenschaft mehr, also weicht jede
-- `place_render`-Kachel von ihrer gepinnten Fassung ab. Das ist erwartet, nicht kaputt - die
-- gepinnten Probekachel-Werte auf Staging müssen nachgezogen werden (Handover an Claudio). Und
-- weil Martin die Kacheln SELBST cacht und nicht nur seinen Katalog, braucht es nach dieser
-- Migration einen Neustart, sonst liefert er weiter Kacheln ohne die Spalte - ohne Fehler, mit
-- Namen, die einfach aufrecht bleiben.

CREATE OR REPLACE VIEW place_render AS
SELECT
    p.public_id,
    p.name,
    p.subtype,
    p.is_hidden,
    p.label_min_zoom_override,
    p.label_max_zoom_override,
    p.label_visible_override,
    p.label_size_override,
    map_domain_to_render(p.map_domain_id, p.geom)::geometry(Point, 3857) AS geom,
    label_collision_rank(cr.rank, p.label_priority, p.label_min_zoom_override) AS collision_rank,
    -- Die neue letzte Spalte. Legacy zeichnet damit `.location-name-label--ruined`, also
    -- `font-style: italic`; bei uns wählt sie den kursiven Glyphenstapel.
    p.is_ruined
FROM place p
LEFT JOIN label_class_rank cr ON cr.scope = 'place' AND cr.class_key = p.subtype
WHERE p.is_active
ORDER BY p.public_id;

COMMENT ON VIEW place_render IS
    'Renderansicht der Orte. `is_ruined` seit 0026: eine Ruine wird kursiv beschriftet (WI-0014, MCS-015) - eine Darstellungseigenschaft, keine neue Redaktionsangabe.';
