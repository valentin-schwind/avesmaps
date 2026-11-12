-- Eine Warteschlange für Stage und Production (WI-0163 §1, §5; Betreiber 2026-10-15, wörtlich: „Ja, bau die gemeinsame
-- Warteschlange wie vorgeschlagen.“).
--
-- 🔴 Die Tafeln bleiben je Umgebung, die Reihenfolge wird gemeinsam. Ein Dirigent auf dem Host liest alle Schlangen NUR LESEND
--    (Rolle `avesmaps3d_<env>_queue_read`, Vorlage `apps/server/src/db/queue-read-grants.psql`), ordnet sie, hält die Pause und
--    startet den nächsten Auftrag über einen Ausführer mit den Rechten seiner Umgebung. Er schreibt in keine Datenbank.
--
-- Drei Teile:
--
-- 1. `system_state.queue_changed_at`: wann diese Umgebung zuletzt pausiert oder fortgesetzt hat. Gespeichert wird je Umgebung die
--    letzte Anweisung (die Spalten aus WI-0160, 0130); WIRKSAM ist die jüngste über alle Umgebungen (`wirksamePause` in
--    `packages/shared/src/warteschlange-stand.ts`). Dafür braucht jede Anweisung ihren Zeitpunkt, auch das Fortsetzen:
--    `queue_paused_since` sagt „seit wann pausiert“ und reicht dafür nicht.
-- 2. `job_sync_claim_id(p_job_id, p_lease_s)`: übernimmt GENAU DIESEN wartenden Auftrag für den Korridor. Der Dirigent hat schon
--    entschieden, was als Nächstes dran ist; der Ausführer der Umgebung (Claudios Wrapper) nimmt dann nicht „den ältesten dieser
--    Art“, sondern den, den der Dirigent meint.
-- 3. `benachrichtigung_einreihen(p_art, p_an, p_text, p_quelle)`: Meldungen wie „Neu auf Production“ kommen als Auftrag der Art
--    `benachrichtigung` über die Warteschlange in die richtige Umgebung, statt dass Claudio sie direkt einträgt (Betreiber
--    2026-10-15, wörtlich: „A: Meldungen wie „Neu auf Production" sollen über die Warteschlange in die richtige Umgebung gelangen,
--    statt dass Claudio sie direkt einträgt.“). Ausgeführt ruft der Auftrag `benachrichtige()` in der Zielumgebung (Teil A).
--
-- 🔴 `job_sync_claim_id` hat KEINEN Pausen-Riegel. Die wirksame Pause kennt nur der Dirigent (die jüngste Anweisung über alle
--    Umgebungen); eine Prüfung hier sähe nur die eigene Zeile und hielte einen Auftrag an, den die Stage gerade freigegeben hat.
--    `job_sync_claim` (0130) behält seinen Riegel, solange Claudios Abholer im Übergang noch laufen; sie fällt erst in einem
--    späteren Aufräum-Release (erweitern, umstellen, entfernen).
--
-- 🔴 REIN ADDITIV: eine Spalte ohne `NOT NULL`, zwei NEUE Funktionen mit eigenem Namen und eigenem EXECUTE-Recht. Keine Signatur
-- ändert sich, nichts geht. Das vorige Release kennt Spalte und Funktionen nicht und schreibt sie nie; es bleibt vollständig lauffähig.
-- Die neue Jobart braucht keine Migration (`job.kind` trägt keinen CHECK, 0070); ein Release ohne ihren Handler lässt den Auftrag
-- liegen, statt ihn falsch auszuführen.
--
-- Rechte (Claudio, `avesmaps3d-db-grants` nach der Migration): `apps/server/src/db/jobs-grants.psql` nennt `job_sync_claim_id` und
-- `benachrichtigung_einreihen` (EXECUTE nur die Jobs-Rolle, die App-Rolle nicht), `apps/server/src/db/queue-read-grants.psql` ist die
-- Vorlage der neuen Leserolle.

-- 1. DIE LETZTE ANWEISUNG MIT IHREM ZEITPUNKT ----------------------------------------------------------------------------------

ALTER TABLE system_state ADD COLUMN IF NOT EXISTS queue_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN system_state.queue_changed_at IS
    'WI-0163: wann diese Umgebung zuletzt pausiert oder fortgesetzt hat. Wirksam ist die juengste Anweisung ueber alle Umgebungen (der Dirigent rechnet sie); NULL: hier nie geschaltet.';

-- Rückfüllung: Eine schon gesetzte Pause bekommt den Zeitpunkt ihres Pausierens, damit sie im Vergleich der Umgebungen zählt. Ein
-- Fortsetzen vor dieser Migration bleibt ohne Zeitpunkt; es zählt nicht (`wirksamePause` überspringt NULL), und eine Umgebung ohne
-- jede Anweisung läuft. Wiederholbar: Was schon einen Zeitpunkt trägt, bleibt.
UPDATE system_state
   SET queue_changed_at = queue_paused_since
 WHERE queue_paused AND queue_changed_at IS NULL AND queue_paused_since IS NOT NULL;

-- 2. GENAU DIESEN AUFTRAG ÜBERNEHMEN ------------------------------------------------------------------------------------------
--
-- 🔴 Von der GELTENDEN Fassung von `job_sync_claim` (0130) abgeschrieben: dieselbe Rückgabe (die öffentliche Kennung oder NULL),
-- dieselbe Artenliste, dieselben Grenzen der Lease, dasselbe Setzen der Zeile und dasselbe Ereignis `job.started`. Anders sind nur
-- zwei Dinge: gewählt wird über die Kennung statt über die Art, und es gibt keinen Pausen-Riegel (oben begründet).
--
-- Nichts übernommen (NULL) wird, wenn der Auftrag nicht (mehr) wartet, nicht aus der Warteschlange kommt (`origin = 'recorded'`),
-- noch nicht fällig ist (`not_before`), eine Art hat, die nicht über den Korridor läuft, oder gerade von einem anderen Aufrufer
-- gesperrt ist (`SKIP LOCKED`). Ein falscher Aufruf (keine Kennung, Lease außerhalb der Grenzen) bekommt seinen Fehler (22023).

CREATE OR REPLACE FUNCTION job_sync_claim_id(p_job_id BIGINT, p_lease_s INTEGER)
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    v_id BIGINT;
    v_kind TEXT;
    v_public UUID;
    v_domain TEXT;
    v_attempt SMALLINT;
    v_lease_no INTEGER;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'job_sync_claim_id: keine Kennung' USING ERRCODE = '22023';
    END IF;
    IF p_lease_s IS NULL OR p_lease_s < 30 OR p_lease_s > 14400 THEN
        RAISE EXCEPTION 'job_sync_claim_id: Lease % s außerhalb 30 bis 14400', p_lease_s USING ERRCODE = '22023';
    END IF;
    SELECT j.id, j.kind INTO v_id, v_kind
      FROM job j
     WHERE j.id = p_job_id
       AND j.kind IN ('legacy_pull', 'legacy_media', 'legacy_zug', 'production_pull', 'terrain_full')
       AND j.state = 'QUEUED' AND j.origin = 'queued'
       AND (j.not_before IS NULL OR j.not_before <= now())
       FOR UPDATE SKIP LOCKED;
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;
    UPDATE job SET
        state = 'RUNNING', wait_reason = NULL, lease_owner = 'korridor', lease_no = lease_no + 1,
        lease_expires_at = now() + make_interval(secs => p_lease_s), heartbeat_at = now(),
        started_at = now(), attempt = attempt + 1, phase = NULL, progress = NULL, finished_at = NULL
     WHERE id = v_id
    RETURNING public_id, map_domain_id, attempt, lease_no INTO v_public, v_domain, v_attempt, v_lease_no;
    PERFORM job_event_add(
        'job.started', v_id, v_domain,
        jsonb_build_object('jobId', v_public, 'jobKind', v_kind, 'state', 'RUNNING', 'attempt', v_attempt, 'leaseNo', v_lease_no)
    );
    RETURN v_public;
END;
$$;

COMMENT ON FUNCTION job_sync_claim_id(BIGINT, INTEGER) IS
    'Gemeinsame Warteschlange (WI-0163): uebernimmt genau diesen wartenden Auftrag einer Korridor-Art, setzt Lease und RUNNING; NULL, wenn er nicht (mehr) wartet. Ohne Pausen-Riegel: die wirksame Pause haelt der Dirigent. Nur fuer die Jobs-Rolle.';

-- Eine Funktion darf zunächst jeder aufrufen (PUBLIC); diese nur die Jobs-Rolle (`jobs-grants.psql`).
REVOKE ALL ON FUNCTION job_sync_claim_id(BIGINT, INTEGER) FROM PUBLIC;

-- 3. MELDUNGEN ÜBER DIE WARTESCHLANGE ------------------------------------------------------------------------------------------
--
-- Claudios Korridor trug „Neu auf der Stage“ bisher mit der Jobs-Rolle direkt ein (`benachrichtige`, 0118). Künftig reiht er einen
-- Auftrag der Art `benachrichtigung` ein; der Dirigent startet ihn in der Umgebung, zu der die Datenbank gehört, und erst der
-- Ausführer dort ruft `benachrichtige()`. So steht die Meldung sichtbar in der gemeinsamen Reihe, und sie landet dort, wo die
-- Betreiber sie lesen.
--
-- 🔴 Der Vertrag der Jobart (Teil A, `apps/server/src/jobs/`), hier an der Tür geprüft, damit nichts Ungültiges in die Tafel kommt:
--
-- - `kind = 'benachrichtigung'`, Fassung 1, `scope_kind = 'tiles'` mit leerer Kachelliste (kein Bereich), Herkunft `queued`.
-- - `input_ref` ist GENAU `{art, an, text, quelle}`, kein weiteres Feld.
-- - **Art:** nur die Arten der neuen Stände, `stage_neu` und `production_neu` (Katalog `BENACHRICHTIGUNG_ARTEN`). Die Meldungen des
--   Kanals entstehen weiter in seinen eigenen Auslösern.
-- - **Ziel:** `an` ist genau eines von `{person: <uuid>}`, `{rolle: <Rolle>}`, `{alle: true}`, dazu höchstens `ausser: <uuid>`.
-- - **Text:** ohne Ränder 1 bis 300 Zeichen (die Grenze der Tafel `benachrichtigung`).
-- - **Quelle:** `^[a-z][a-z0-9_-]{0,39}:\S{1,159}$`, etwa `stage:<sha>` oder `production:<release>`.
-- - **Einmal je Quelle:** `external_ref` = `benachrichtigung:<quelle>`, eindeutig, solange der Auftrag wartet oder läuft
--   (`job_external_ref_active`, 0070). Wartet schon einer, kommt `NULL` zurück und es entsteht nichts; sonst die `job.id`.
-- - `actor_ref = 'korridor'`, nie eine Personen-Kennung: Sonst gälte der Auftrag als Editor-Job und wartete unter der Kartensperre.
-- - Priorität 50 wie jeder kleine Auftrag (`job_enqueue`); Domäne `aventuria`, die eine, die es gibt (`job.map_domain_id` braucht eine).

CREATE OR REPLACE FUNCTION benachrichtigung_einreihen(p_art TEXT, p_an JSONB, p_text TEXT, p_quelle TEXT)
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
DECLARE
    c_uuid CONSTANT TEXT := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    v_text TEXT := btrim(p_text);
    v_ziele INTEGER;
    v_id BIGINT;
    v_neu BOOLEAN;
BEGIN
    IF p_art IS NULL OR p_art NOT IN ('stage_neu', 'production_neu') THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: % ist keine Art, die über die Warteschlange kommt', COALESCE(p_art, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    -- Das Ziel: genau eines von person, rolle, alle; dazu höchstens ausser; kein anderer Schlüssel.
    IF p_an IS NULL OR jsonb_typeof(p_an) <> 'object' THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: an braucht genau eines von "person", "rolle" oder "alle"' USING ERRCODE = '22023';
    END IF;
    v_ziele := (p_an ? 'person')::int + (p_an ? 'rolle')::int + (p_an ? 'alle')::int;
    IF v_ziele <> 1
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_an) k WHERE k NOT IN ('person', 'rolle', 'alle', 'ausser'))
       OR (p_an ? 'person' AND NOT COALESCE(jsonb_typeof(p_an -> 'person') = 'string' AND p_an ->> 'person' ~ c_uuid, false))
       OR (p_an ? 'rolle' AND NOT COALESCE(jsonb_typeof(p_an -> 'rolle') = 'string' AND p_an ->> 'rolle' ~ '^[a-z_]{1,40}$', false))
       OR (p_an ? 'alle' AND p_an -> 'alle' <> 'true'::jsonb)
       OR (p_an ? 'ausser' AND NOT COALESCE(jsonb_typeof(p_an -> 'ausser') = 'string' AND p_an ->> 'ausser' ~ c_uuid, false)) THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: an braucht genau eines von "person", "rolle" oder "alle" (dazu höchstens "ausser")'
            USING ERRCODE = '22023';
    END IF;
    IF v_text IS NULL OR char_length(v_text) NOT BETWEEN 1 AND 300 THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: Text braucht 1 bis 300 Zeichen' USING ERRCODE = '22023';
    END IF;
    IF p_quelle IS NULL OR p_quelle !~ '^[a-z][a-z0-9_-]{0,39}:\S{1,159}$' THEN
        RAISE EXCEPTION 'benachrichtigung_einreihen: Quelle % hat nicht die Form art:kennung', COALESCE(p_quelle, '(leer)')
            USING ERRCODE = '22023';
    END IF;
    SELECT i.id, i.created INTO v_id, v_neu
      FROM job_insert(
          'benachrichtigung', 1::smallint, 'aventuria', 'queued', 'korridor', 'benachrichtigung:' || p_quelle,
          CASE p_art WHEN 'stage_neu' THEN 'Meldung: Neu auf der Stage' ELSE 'Meldung: Neu auf avesmaps.de' END,
          jsonb_build_object('art', p_art, 'an', p_an, 'text', v_text, 'quelle', p_quelle),
          50::smallint, NULL, 'tiles', '{}'::smallint[], '{}'::bigint[]
      ) i;
    RETURN CASE WHEN v_neu THEN v_id ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) IS
    'Gemeinsame Warteschlange (WI-0163, Betreiber 2026-10-15): reiht eine Meldung der neuen Staende (stage_neu, production_neu) als Auftrag der Art benachrichtigung ein; einmal je Quelle, solange aktiv (NULL: schon eingereiht). Nur fuer die Jobs-Rolle.';

REVOKE ALL ON FUNCTION benachrichtigung_einreihen(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
