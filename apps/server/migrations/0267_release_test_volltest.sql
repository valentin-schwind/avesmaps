-- 0267: Der Volltest der lokalen Systemsteuerung in der gemeinsamen Warteschlange (WI-0264; Vali 2026-10-31 auf die Frage nach Namen für einen
-- zweiten Knopf neben „Release-Test starten“: „Schnelltest und Volltest“).
--
-- Der Volltest ist derselbe schwere Auftrag `release_test` wie der Schnelltest (Ref `release-test`, höchstens einer wartet oder läuft, also nie beide
-- zugleich), mit `volltest: true` in der Eingabe: Der Ausführer (`jobs/release-test-job.ts`) startet dann nacheinander den Schnelltest und den vollen
-- Lauf, beide nur als Bericht, ohne Freigabe. Die App-Rolle hat kein Schreibrecht auf `job`; darum eine eigene Funktion neben `release_test_einreihen`
-- aus 0228, die unverändert bleibt (das vorige Release ruft weiter nur sie). Kein `wiederholen`: Rote Teile wiederholen gehört zum Schnelltest.

CREATE OR REPLACE FUNCTION release_test_volltest_einreihen(
    p_actor_ref TEXT,
    p_commit TEXT,
    p_erwartet_s INTEGER,
    p_map_domain_id TEXT
) RETURNS TABLE (id BIGINT, public_id UUID, created BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_commit IS NULL OR p_commit !~ '^[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'release_test_volltest_einreihen: % ist kein vollständiger Stand', COALESCE(p_commit, '(leer)') USING ERRCODE = '22023';
    END IF;
    IF p_actor_ref IS NULL OR p_actor_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'release_test_volltest_einreihen: der Auslöser ist keine Person' USING ERRCODE = '22023';
    END IF;
    IF p_erwartet_s IS NOT NULL AND (p_erwartet_s < 0 OR p_erwartet_s > 172800) THEN
        RAISE EXCEPTION 'release_test_volltest_einreihen: erwartete Dauer % s außerhalb 0 bis 172800', p_erwartet_s USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id, i.created FROM job_insert(
        'release_test', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, 'release-test',
        'Volltest ' || left(p_commit, 8),
        jsonb_build_object(
            'commit', p_commit, 'wiederholen', false, 'volltest', true, 'erwartetS', p_erwartet_s, 'seit', now()
        ),
        50::smallint, NULL, 'domain', '{}'::smallint[], '{}'::bigint[]
    ) i;
END;
$$;

COMMENT ON FUNCTION release_test_volltest_einreihen(TEXT, TEXT, INTEGER, TEXT) IS
    'WI-0264: reiht den Volltest des Entwicklungsrechners als schweren Auftrag release_test mit volltest in der Eingabe ein (Schnelltest und voller Lauf nacheinander, nur Bericht, ohne Freigabe). Derselbe Ref release-test wie release_test_einreihen: höchstens ein Test aktiv. SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

REVOKE EXECUTE ON FUNCTION release_test_volltest_einreihen(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
