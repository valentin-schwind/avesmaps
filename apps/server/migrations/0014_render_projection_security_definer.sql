-- `map_domain_to_render` liest eine Basistabelle und lief mit den Rechten des Aufrufers.
--
-- 💣 Auf Staging gemessen, echter Deploy (Claudio, Handover 2026-09-21): PostgreSQL prüft EXECUTE
-- auf eine Funktion INNERHALB einer Sicht als AUFRUFER, nicht als Sichtbesitzer -- anders als den
-- Lesezugriff auf eine Tabelle. Die Funktion ist `LANGUAGE sql STABLE`, liest `FROM map_domain` und
-- lässt sich nicht inlinen, läuft also im Rumpf ebenfalls als Aufrufer. Die Kachelrolle hat auf
-- Basistabellen bewusst kein SELECT.
--
-- 🪤 Die Falle daran ist die Reihenfolge des Scheiterns: auf einer LEEREN Datenbank läuft der Rumpf
-- nie, der Deploy wird grün, und erst mit echten Daten fallen die Kacheln mit
-- `permission denied for table map_domain` aus. Lokal fällt es nie auf, weil Martin dort als
-- Eigentümer verbindet.
--
-- `SECURITY DEFINER` mit festem `search_path` löst das rechtemodell-neutral: die Funktion liest
-- `map_domain` mit den Rechten der Migrationsrolle, und die Kachelrolle behält kein einziges Recht
-- auf einer Nicht-`_render`-Relation. Die Alternative -- `GRANT SELECT ON map_domain` an die
-- Kachelrolle -- wäre eine Ausweitung dieser Rolle und damit eine Betreiberentscheidung.
--
-- `CREATE OR REPLACE` erhält das bestehende EXECUTE-Recht; ein DROP + CREATE nähme es weg.
--
-- Der Funktionsrumpf ist Zeichen für Zeichen der aus 0004. Wer ihn ändert, ändert die Projektion --
-- dann muss `packages/shared/src/render-projection.ts` mitgehen, und der Vergleichstest wacht darüber.

CREATE OR REPLACE FUNCTION map_domain_to_render(domain_id TEXT, geom geometry)
RETURNS geometry
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ST_SetSRID(
        ST_Translate(
            ST_Scale(
                ST_Translate(geom, -d.min_x, -d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y),
                (2 * 20037508.342789244) / GREATEST(d.max_x - d.min_x, d.max_y - d.min_y)
            ),
            -20037508.342789244,
            -20037508.342789244
        ),
        3857
    )
    FROM map_domain d
    WHERE d.id = domain_id;
$$;

COMMENT ON FUNCTION map_domain_to_render IS
    'Derived render geometry for the tile stack. Never a source of truth (chapter 4.17.4). SECURITY DEFINER: liest map_domain, damit die Kachelrolle dort kein Recht braucht.';

-- 🪤 Dieselbe Bauart, nur noch nicht aufgefallen: `map_domain_contains` liest ebenfalls
-- `map_domain` und läuft mit Aufruferrechten. Heute ruft sie keine Renderrelation auf, also bekommt
-- die Kachelrolle darauf auch kein EXECUTE -- der Fehler ist nicht akut. Er wartet nur darauf, dass
-- jemand sie in eine `*_render`-Sicht schreibt, und schlägt dann wieder erst mit echten Daten zu.
-- Die Falle wird hier geschlossen, solange sie billig ist.
CREATE OR REPLACE FUNCTION map_domain_contains(domain_id TEXT, geom geometry)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ST_Within(
        geom,
        ST_MakeEnvelope(d.min_x, d.min_y, d.max_x, d.max_y, 0)
    )
    FROM map_domain d
    WHERE d.id = domain_id;
$$;
