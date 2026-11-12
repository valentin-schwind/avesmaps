-- Systemzustand in der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §3.7, Claudio `handovers/2026-10-10-wi0119-systemzustand-antwort.md` Nr. 2).
--
-- 🔴 REIN ADDITIV: eine neue Tafel und eine neue Funktion; das vorige Release liest keins von beiden. Rechte:
-- `apps/server/src/db/system-grants.psql` (die App darf `system_sample` lesen, anhängen und löschen, nie ändern; Claudio überträgt den
-- Besitz von `connection_counts()` an die Rolle `avesmaps3d_stats`).

-- Der Verlauf über 24 h: jede Instanz schreibt alle 5 min eine Stichprobe (`INSERT … ON CONFLICT DO NOTHING`, zwei Instanzen im
-- Blue/Green schreiben eine Zeile) und löscht im selben Zug, was älter als 25 h ist. 288 Zeilen je Tag. `NULL` heißt „nicht messbar“
-- (Last unter Windows, Auslagerung ohne /proc), nie 0. DOUBLE PRECISION, nicht REAL (vierbyteig).
CREATE TABLE IF NOT EXISTS system_sample (
    bucket TIMESTAMPTZ PRIMARY KEY,
    load1 DOUBLE PRECISION,
    mem_used_bytes BIGINT CHECK (mem_used_bytes IS NULL OR mem_used_bytes >= 0),
    mem_total_bytes BIGINT CHECK (mem_total_bytes IS NULL OR mem_total_bytes >= 0),
    swap_used_bytes BIGINT CHECK (swap_used_bytes IS NULL OR swap_used_bytes >= 0)
);
COMMENT ON TABLE system_sample IS
    'Stichproben des Systemzustands je 5 min (WI-0127 SYS-8); älter als 25 h löscht die Anwendung.';

-- Die Verbindungen als Zahlen, ohne dass die App-Rolle `pg_read_all_stats` bekommt (Claudio Nr. 2: die zeigt Abfragetexte und
-- Anwendungsnamen ALLER Sitzungen). Nur Zahlen: je `state` die Verbindungen der eigenen Datenbank, alle Verbindungen, `max_connections`,
-- `superuser_reserved_connections`. Keine Texte, Benutzer, Adressen, Anwendungsnamen.
--
-- Wirksam erst, wenn die Besitzerin `pg_read_all_stats` hat (Claudio: Rolle `avesmaps3d_stats`, Besitzübertragung in
-- `avesmaps3d-db-grants`); sonst sähe sie die `state` fremder Sitzungen nicht und zählte falsch. Dann antwortet sie `NULL`, und die
-- Anzeige sagt „unbekannt“. 🔴 Nie per `CREATE OR REPLACE` ändern: Gehört sie `avesmaps3d_stats`, darf die Migrationsrolle das nicht; eine
-- neue Fassung bekommt einen neuen Namen.
CREATE OR REPLACE FUNCTION connection_counts()
    RETURNS JSONB
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $$
BEGIN
    IF NOT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
        'own', COALESCE((
            SELECT jsonb_object_agg(s.state, s.n)
              FROM (SELECT COALESCE(a.state, 'unknown') AS state, count(*)::int AS n
                      FROM pg_stat_activity a
                     WHERE a.datname = current_database() AND a.backend_type = 'client backend'
                     GROUP BY 1) s
        ), '{}'::jsonb),
        'total', (SELECT count(*)::int FROM pg_stat_activity a WHERE a.backend_type = 'client backend'),
        'max', current_setting('max_connections')::int,
        'reserved', current_setting('superuser_reserved_connections')::int
    );
END;
$$;
COMMENT ON FUNCTION connection_counts() IS
    'WI-0127 SYS-8: Verbindungen als Zahlen (eigene Datenbank je state, alle, max, reserviert); NULL ohne pg_read_all_stats der Besitzerin. SECURITY DEFINER, nie per CREATE OR REPLACE ändern.';
REVOKE ALL ON FUNCTION connection_counts() FROM PUBLIC;
