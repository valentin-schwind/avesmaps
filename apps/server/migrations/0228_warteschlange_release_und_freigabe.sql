-- 0228: Release-Test und Production-Freigabe in der gemeinsamen Warteschlange (WI-0248; Vali 2026-10-26 auf die Frage, ob der Release-Test ein
-- Auftrag der lokalen Warteschlange wird oder die Freigabe mit der Person eingereiht wird: beides, mit dem Fortschritt beider im Kopf). Anlass: Nach
-- dem Klick war nicht klar, ob er angekommen ist, und schwere lokale Aufträge (Gelände) liefen neben dem Test und machten ihn wacklig.
--
-- 1. `job.eta_at`: das erwartete Ende, wie ein laufender Auftrag es selbst meldet (der Release-Test die Restzeit seines Runners). Nur Aufträge, die
--    eine Restzeit kennen, schreiben die Spalte; alle anderen lassen sie leer, und die Oberfläche rechnet dann wie bisher aus der Schätzung.
-- 2. `release_test_einreihen`: „Release-Test starten“ und „Rote Teile wiederholen“ der lokalen Systemsteuerung reihen einen SCHWEREN Auftrag
--    `release_test` mit der Person ein, statt den Starter sofort zu rufen. Höchstens einer wartet oder läuft (`external_ref = 'release-test'`, der
--    eindeutige Index `job_external_ref_active`); ein zweiter Druck bekommt den vorhandenen mit `created = false` zurück.
-- 3. `release_test_abbrechen`: bricht den wartenden Auftrag ab oder fordert beim laufenden den Abbruch an (der Ausführer beendet dann den Lauf).
-- 4. `freigabe_auftrag_einreihen`: Der Knopf der Freigabe reiht in DERSELBEN Transaktion wie der Vorgang einen aufgezeichneten Auftrag
--    `production_freigabe` mit der Person ein (Ref `freigabe-<OPS>`, Zustand `QUEUED`, Grund `waits_pickup`). Er belegt keinen Platz: Der Dirigent
--    plant nur Aufträge der Herkunft `queued`. Claudios Abholer übernimmt ihn mit seinem gewohnten `record start --ref freigabe-<OPS>`
--    (`store-record.ts`, `uebernimmAngekuendigt`): Der Lauf hat dann die Person, und die Kopfleiste zeigt ihn mit Phase.
-- 5. Auslöser `freigabe_auftrag` an `avesmaps_kanal.vorgang`: Erlischt ein Freigabe-Vorgang (`abgelehnt`, `abgenommen`), solange sein Auftrag noch
--    wartet (Abbrechen der Nacht-Freigabe, Ablösen durch einen neuen Druck, rote Prüfung), endet der Auftrag als `CANCELLED`. Ein Fehler hier hält
--    den Kanal nie an: Er wird als WARNUNG gemeldet, und der Vorgang wechselt trotzdem.
--
-- 🔴 ADDITIV: eine neue Spalte ohne Vorgabe, neue Funktionen, ein neuer Auslöser. Keine bestehende Funktion ändert ihre Fassung, auch `job_enqueue`
-- nicht (die Release-Test-Art braucht sie nicht). Das vorige Release liest `eta_at` nicht, ruft die Funktionen nie, und eine aufgezeichnete Freigabe
-- legt es wie bisher selbst an (findet es einen wartenden Auftrag mit dem Ref, gibt `job_insert` ihn zurück, und die Phasen bleiben aus, bis der neue
-- Stand läuft). Rechte: Die App-Rolle bekommt EXECUTE auf die drei Funktionen über das Rechtewerkzeug (jede Funktion der Migrationsrolle in `public`);
-- PUBLIC verliert es hier.

ALTER TABLE job ADD COLUMN IF NOT EXISTS eta_at TIMESTAMPTZ;

COMMENT ON COLUMN job.eta_at IS
    'Erwartetes Ende laut Auftrag selbst (WI-0248: Restzeit des Release-Test-Runners). NULL: der Auftrag meldet keine; die Oberfläche rechnet dann aus der Schätzung.';

-- 2. Release-Test einreihen ------------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION release_test_einreihen(
    p_actor_ref TEXT,
    p_commit TEXT,
    p_wiederholen BOOLEAN,
    p_erwartet_s INTEGER,
    p_map_domain_id TEXT
) RETURNS TABLE (id BIGINT, public_id UUID, created BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
BEGIN
    IF p_commit IS NULL OR p_commit !~ '^[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'release_test_einreihen: % ist kein vollständiger Stand', COALESCE(p_commit, '(leer)') USING ERRCODE = '22023';
    END IF;
    -- Nur eine Person reiht ein: Die Kopfleiste zeigt den Auftrag der Person, die gedrückt hat.
    IF p_actor_ref IS NULL OR p_actor_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'release_test_einreihen: der Auslöser ist keine Person' USING ERRCODE = '22023';
    END IF;
    IF p_erwartet_s IS NOT NULL AND (p_erwartet_s < 0 OR p_erwartet_s > 172800) THEN
        RAISE EXCEPTION 'release_test_einreihen: erwartete Dauer % s außerhalb 0 bis 172800', p_erwartet_s USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT i.id, i.public_id, i.created FROM job_insert(
        'release_test', 1::smallint, p_map_domain_id, 'queued', p_actor_ref, 'release-test',
        'Release-Test ' || left(p_commit, 8) || CASE WHEN COALESCE(p_wiederholen, false) THEN ' (rote Teile)' ELSE '' END,
        jsonb_build_object(
            'commit', p_commit, 'wiederholen', COALESCE(p_wiederholen, false), 'erwartetS', p_erwartet_s, 'seit', now()
        ),
        50::smallint, NULL, 'domain', '{}'::smallint[], '{}'::bigint[]
    ) i;
END;
$$;

COMMENT ON FUNCTION release_test_einreihen(TEXT, TEXT, BOOLEAN, INTEGER, TEXT) IS
    'WI-0248: reiht den Release-Test des Entwicklungsrechners als schweren Auftrag release_test mit der Person ein (Ref release-test, höchstens einer aktiv; created = false: es wartet oder läuft schon einer). SECURITY DEFINER: die App-Rolle braucht kein Schreibrecht auf job.';

REVOKE EXECUTE ON FUNCTION release_test_einreihen(TEXT, TEXT, BOOLEAN, INTEGER, TEXT) FROM PUBLIC;

-- 3. Release-Test abbrechen ------------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION release_test_abbrechen()
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_job RECORD;
BEGIN
    SELECT j.id, j.public_id, j.state, j.map_domain_id, j.cancel_requested_at INTO v_job
      FROM job j
     WHERE j.kind = 'release_test' AND j.external_ref = 'release-test' AND j.state IN ('QUEUED', 'RUNNING')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'keiner';
    END IF;
    IF v_job.state = 'QUEUED' THEN
        UPDATE job SET state = 'CANCELLED', cancel_reason = 'operator', finished_at = now(), wait_reason = NULL WHERE job.id = v_job.id;
        PERFORM job_event_add(
            'job.cancelled', v_job.id, v_job.map_domain_id,
            jsonb_build_object('jobId', v_job.public_id, 'jobKind', 'release_test', 'state', 'CANCELLED', 'reason', 'operator')
        );
        RETURN 'abgebrochen';
    END IF;
    IF v_job.cancel_requested_at IS NULL THEN
        UPDATE job SET cancel_requested_at = now(), cancel_reason = 'operator' WHERE job.id = v_job.id;
        PERFORM job_event_add(
            'job.cancel_requested', v_job.id, v_job.map_domain_id,
            jsonb_build_object('jobId', v_job.public_id, 'jobKind', 'release_test', 'state', 'RUNNING', 'reason', 'operator')
        );
    END IF;
    RETURN 'angefordert';
END;
$$;

COMMENT ON FUNCTION release_test_abbrechen() IS
    'WI-0248: bricht den wartenden Release-Test-Auftrag ab (abgebrochen) oder fordert beim laufenden den Abbruch an (angefordert; der Ausführer beendet den Lauf); keiner: es gibt keinen. SECURITY DEFINER für die App-Rolle.';

REVOKE EXECUTE ON FUNCTION release_test_abbrechen() FROM PUBLIC;

-- 4. Die Freigabe ankündigen -----------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION freigabe_auftrag_einreihen(
    p_ops TEXT,
    p_actor_ref TEXT,
    p_label TEXT,
    p_map_domain_id TEXT
) RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_ref TEXT;
    v_id BIGINT;
    v_public UUID;
    v_label TEXT;
BEGIN
    IF p_ops IS NULL OR p_ops !~ '^OPS-[0-9]{6,12}$' THEN
        RAISE EXCEPTION 'freigabe_auftrag_einreihen: % ist keine OPS-Kennung', COALESCE(p_ops, '(leer)') USING ERRCODE = '22023';
    END IF;
    IF p_actor_ref IS NULL OR p_actor_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'freigabe_auftrag_einreihen: der Auslöser ist keine Person' USING ERRCODE = '22023';
    END IF;
    v_ref := 'freigabe-' || p_ops;
    -- Derselbe Vorgang zweimal: derselbe Auftrag.
    SELECT j.public_id INTO v_public FROM job j WHERE j.external_ref = v_ref AND j.state IN ('QUEUED', 'RUNNING');
    IF FOUND THEN
        RETURN v_public;
    END IF;
    v_label := NULLIF(left(btrim(regexp_replace(COALESCE(p_label, ''), '[[:cntrl:]]', '', 'g')), 300), '');
    INSERT INTO job (
        kind, kind_version, map_domain_id, origin, actor_ref, external_ref, label, input_ref, priority, scope_kind, state, wait_reason
    ) VALUES (
        'production_freigabe', 1, p_map_domain_id, 'recorded', p_actor_ref, v_ref, v_label, jsonb_build_object('ops', p_ops), 50, 'domain',
        'QUEUED', 'waits_pickup'
    ) RETURNING job.id, job.public_id INTO v_id, v_public;
    PERFORM job_event_add(
        'job.queued', v_id, p_map_domain_id,
        jsonb_build_object('jobId', v_public, 'jobKind', 'production_freigabe', 'state', 'QUEUED', 'origin', 'recorded')
    );
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION freigabe_auftrag_einreihen(TEXT, TEXT, TEXT, TEXT) IS
    'WI-0248: kündigt die Production-Freigabe eines Vorgangs als aufgezeichneten Auftrag production_freigabe mit der Person an (QUEUED, Ref freigabe-<OPS>, Grund waits_pickup; zurück kommt die öffentliche Kennung); Claudios record start übernimmt ihn. SECURITY DEFINER für die App-Rolle.';

REVOKE EXECUTE ON FUNCTION freigabe_auftrag_einreihen(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

-- 5. Erlischt der Vorgang, endet der wartende Auftrag ----------------------------------------------------------------------------------------------

-- 🔴 `search_path = public`: `job_event_add` nennt seine Tafeln ohne Schema und erbt den Pfad des Aufrufers (mit `pg_catalog` allein, wie in den
-- Funktionen des Kanals, fände es `job_event` nicht, und der Auftrag bliebe stehen).
CREATE OR REPLACE FUNCTION avesmaps_kanal._freigabe_auftrag_beenden() RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
DECLARE
    v_ref TEXT;
    v_job RECORD;
BEGIN
    IF NEW.art <> 'freigabe' OR NEW.status NOT IN ('abgenommen', 'abgelehnt') OR OLD.status IN ('abgenommen', 'abgelehnt') THEN
        RETURN NULL;
    END IF;
    -- Dieselbe Kennung wie `opsId` (shared) und `printf 'OPS-%06d'` im Abholer: mindestens sechs Stellen, längere unverkürzt.
    v_ref := 'freigabe-OPS-' || CASE WHEN NEW.id < 1000000 THEN lpad(NEW.id::text, 6, '0') ELSE NEW.id::text END;
    BEGIN
        UPDATE public.job SET state = 'CANCELLED', cancel_reason = 'operator', finished_at = now(), wait_reason = NULL
         WHERE external_ref = v_ref AND kind = 'production_freigabe' AND origin = 'recorded' AND state = 'QUEUED'
        RETURNING id, public_id, map_domain_id INTO v_job;
        IF FOUND THEN
            PERFORM public.job_event_add(
                'job.cancelled', v_job.id, v_job.map_domain_id,
                jsonb_build_object('jobId', v_job.public_id, 'jobKind', 'production_freigabe', 'state', 'CANCELLED', 'reason', 'operator')
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Der Kanal hält nie wegen der Warteschlange an: Der Vorgang wechselt, der Auftrag bleibt höchstens bis zum nächsten Druck stehen.
        RAISE WARNING 'freigabe_auftrag: Auftrag zu % nicht beendet: %', v_ref, SQLERRM;
    END;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION avesmaps_kanal._freigabe_auftrag_beenden() FROM PUBLIC;

DROP TRIGGER IF EXISTS freigabe_auftrag ON avesmaps_kanal.vorgang;
CREATE TRIGGER freigabe_auftrag AFTER UPDATE OF status ON avesmaps_kanal.vorgang
    FOR EACH ROW EXECUTE FUNCTION avesmaps_kanal._freigabe_auftrag_beenden();
