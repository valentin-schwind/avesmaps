-- Social Hub im Community-Modul (WI-0270 C11; Fachkonzept project-control/planning/community-fachkonzept.md §15, Bedienkonzept §6.4 bis §6.6):
-- Die Redaktion verfasst Beiträge (SOC-Nummer wie COM-), legt sie zur Freigabe vor, gibt sie frei und veröffentlicht sie. Im ersten Schnitt sendet nur der
-- Kanal „Neuigkeiten“: Er schreibt in die vorhandene Tafel `public.news_entry` (Migration 0119) und trägt dort den Verweis `beitrag_id`; es gibt keinen
-- zweiten Speicher der Neuigkeiten. Fremde Kanäle (Mastodon, Bluesky, Instagram, Facebook, Discord) stehen in der Zählung, senden aber nicht (C12).
--
-- 🔴 REIN ERWEITERND (docs/regeln/entwicklung.md „Migrationen: erst erweitern, dann umstellen, dann entfernen“; `migration-compat.test.ts`):
--   - Neue Tafeln im Schema `avesmaps_community`; an `news_entry` kommt EINE nullable Spalte ohne Vorgabe dazu. Das vorige Release liest und schreibt
--     `news_entry` weiter wie bisher und kennt `beitrag_id` nicht.
--   - `news_add` und `redact_person_community` behalten ihre Argumentliste und ihren Rückgabetyp; sie tun nur mehr (siehe unten).
--
-- Schreiben NUR über die Funktionen des Schemas `avesmaps_community` (SECURITY DEFINER, Muster 0265 und 0266): Revision, Idempotenz je `operation_id`,
-- Fehler der Klasse `KC` (KC404 nicht gefunden, KC409 Übergang oder Revision, KC422 ungültige Angabe). Die Rechte der App-Rolle stehen in
-- `apps/server/src/db/community-grants.psql`: SELECT an den Tafeln, EXECUTE an den Funktionen, nichts anderes.
--
-- Wer was darf, prüft die ROUTE (Rechte `social_communication` und `manage_news`); die Datenbank prüft die Übergänge, die Revision und die Inhalte.
-- Einzige Ausnahme von „keine Person in der Funktion“: Die Datenbank erkennt am Verfasser, ob ein Betreiber den EIGENEN Beitrag allein freigibt
-- (Entscheidung E10), und schreibt den Vermerk in den Verlauf.
--
-- Datensparsam: Der Verlauf trägt nie den Text eines Beitrags, nur Art, Person, Zeit und einen kurzen Vermerk. Der Verfasser ist intern und verlässt die
-- Redaktion nie (die Neuigkeiten zeigen ihn nicht).

-- --- Tafeln -------------------------------------------------------------------------------------------------------------------------

-- Ein Beitrag (Fachkonzept §15.2): einmal geschrieben, je Kanal veröffentlicht. `titel` ist die Titelzeile nur für die Neuigkeiten.
-- `vorgang_id` ist die Nummer des Vorgangs (COM-…), aus dem der Beitrag stammt: weich, ohne Fremdschlüssel (ein Vorgang verschwindet mit dem Papierkorb,
-- der Beitrag nicht). `bild_id` ist `media_asset.public_id`: ebenfalls weich, denn `media_asset` wandert mit dem Abzug, das Community-Schema nie.
CREATE TABLE IF NOT EXISTS avesmaps_community.beitrag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    herkunft TEXT NOT NULL,
    vorgang_id BIGINT,
    verfasser UUID REFERENCES avesmaps_auth.person (id),
    titel TEXT,
    text TEXT NOT NULL DEFAULT '',
    hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    rubrik TEXT NOT NULL DEFAULT 'community',
    bild_id UUID,
    bild_beschreibung TEXT,
    ki BOOLEAN NOT NULL DEFAULT false,
    kanaele TEXT[] NOT NULL DEFAULT ARRAY['neuigkeiten']::TEXT[],
    zustand TEXT NOT NULL DEFAULT 'entwurf',
    -- Nach der Veröffentlichung geändert und noch nicht veröffentlicht („Änderung veröffentlichen“).
    geaendert BOOLEAN NOT NULL DEFAULT false,
    papierkorb_at TIMESTAMPTZ,
    papierkorb_art TEXT,
    angelegt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    aktiv_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    vorgelegt_at TIMESTAMPTZ,
    veroeffentlicht_at TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 1,
    operation_id UUID NOT NULL UNIQUE,
    CONSTRAINT beitrag_herkunft CHECK (herkunft IN ('redaktion', 'routine', 'vorgang')),
    CONSTRAINT beitrag_vorgang CHECK ((herkunft = 'vorgang') = (vorgang_id IS NOT NULL)),
    -- Ein Beitrag der Routine hat keinen Verfasser; nach einer Kontoauflösung darf er auch bei den anderen fehlen.
    CONSTRAINT beitrag_routine CHECK (herkunft <> 'routine' OR verfasser IS NULL),
    CONSTRAINT beitrag_titel CHECK (titel IS NULL OR char_length(titel) BETWEEN 1 AND 200),
    CONSTRAINT beitrag_text CHECK (char_length(text) <= 10000),
    CONSTRAINT beitrag_hashtags CHECK (cardinality(hashtags) <= 10),
    CONSTRAINT beitrag_rubrik CHECK (char_length(btrim(rubrik)) BETWEEN 1 AND 40),
    CONSTRAINT beitrag_beschreibung CHECK (bild_beschreibung IS NULL OR char_length(bild_beschreibung) <= 1000),
    CONSTRAINT beitrag_kanaele CHECK (
        cardinality(kanaele) >= 1 AND kanaele <@ ARRAY['neuigkeiten', 'discord', 'mastodon', 'bluesky', 'instagram', 'facebook']::TEXT[]
    ),
    CONSTRAINT beitrag_zustand CHECK (zustand IN ('entwurf', 'vorgelegt', 'veroeffentlicht')),
    CONSTRAINT beitrag_vorgelegt CHECK ((zustand = 'entwurf') = (vorgelegt_at IS NULL)),
    CONSTRAINT beitrag_veroeffentlicht CHECK ((zustand = 'veroeffentlicht') = (veroeffentlicht_at IS NOT NULL)),
    CONSTRAINT beitrag_geaendert CHECK (NOT geaendert OR zustand = 'veroeffentlicht'),
    -- Veröffentlichte Beiträge werden nie in den Papierkorb gelegt, nur zurückgenommen (Fachkonzept §15.4).
    CONSTRAINT beitrag_papierkorb CHECK (
        (papierkorb_at IS NULL) = (papierkorb_art IS NULL)
        AND (papierkorb_art IS NULL OR papierkorb_art IN ('verworfen', 'verfallen'))
        AND (papierkorb_at IS NULL OR zustand <> 'veroeffentlicht')
    ),
    CONSTRAINT beitrag_revision CHECK (revision >= 1)
);
COMMENT ON TABLE avesmaps_community.beitrag IS 'Beiträge des Social Hubs (WI-0270); die Nummer ist SOC- und die id mit sechs Stellen.';
COMMENT ON COLUMN avesmaps_community.beitrag.verfasser IS 'INTERN: wer den Beitrag schrieb. Verlässt die Redaktion nie; fehlt bei der Routine.';
COMMENT ON COLUMN avesmaps_community.beitrag.vorgang_id IS 'Nummer des Vorgangs (COM-…), aus dem der Beitrag stammt; weich, ohne Fremdschlüssel. Nie Daten des Melders.';
COMMENT ON COLUMN avesmaps_community.beitrag.bild_id IS 'media_asset.public_id; weich, ohne Fremdschlüssel. Lizenz und Quelle kommen aus dem Medienkern.';
CREATE INDEX IF NOT EXISTS beitrag_offen ON avesmaps_community.beitrag (zustand, angelegt_at DESC) WHERE papierkorb_at IS NULL;
CREATE INDEX IF NOT EXISTS beitrag_papierkorb ON avesmaps_community.beitrag (papierkorb_at) WHERE papierkorb_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS beitrag_routine ON avesmaps_community.beitrag (angelegt_at) WHERE herkunft = 'routine';

-- Das Ziel eines Beitrags an einem Kanal (Fachkonzept §15.2): Der Sendestand gehört dem Ziel, nicht dem Beitrag. `adresse` ist bei den Neuigkeiten
-- `news:<id>` (der Eintrag in `news_entry`), bei fremden Kanälen später die Adresse des Beitrags dort.
CREATE TABLE IF NOT EXISTS avesmaps_community.beitrag_ziel (
    beitrag_id BIGINT NOT NULL REFERENCES avesmaps_community.beitrag (id) ON DELETE CASCADE,
    kanal TEXT NOT NULL,
    zustand TEXT NOT NULL DEFAULT 'wartet',
    adresse TEXT,
    fehler TEXT,
    versuche INTEGER NOT NULL DEFAULT 0,
    gesendet_at TIMESTAMPTZ,
    PRIMARY KEY (beitrag_id, kanal),
    CONSTRAINT beitrag_ziel_kanal CHECK (kanal IN ('neuigkeiten', 'discord', 'mastodon', 'bluesky', 'instagram', 'facebook')),
    CONSTRAINT beitrag_ziel_zustand CHECK (zustand IN ('wartet', 'ok', 'fehler', 'zurueck')),
    CONSTRAINT beitrag_ziel_fehler CHECK (fehler IS NULL OR char_length(fehler) <= 500),
    CONSTRAINT beitrag_ziel_versuche CHECK (versuche >= 0)
);

-- Wer wann was mit einem Beitrag tat. Nur anhängen; nie der Text des Beitrags.
CREATE TABLE IF NOT EXISTS avesmaps_community.beitrag_ereignis (
    beitrag_id BIGINT NOT NULL REFERENCES avesmaps_community.beitrag (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    art TEXT NOT NULL,
    von_person UUID REFERENCES avesmaps_auth.person (id),
    text TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_id UUID UNIQUE,
    PRIMARY KEY (beitrag_id, seq),
    CONSTRAINT beitrag_ereignis_art CHECK (art IN (
        'angelegt', 'geaendert', 'vorgelegt', 'zurueckgezogen', 'zurueckgegeben', 'freigegeben', 'gesendet', 'aenderung_veroeffentlicht',
        'zurueckgenommen', 'erneut_gesendet', 'verworfen', 'verfallen', 'wiederhergestellt', 'in_systemsteuerung'
    )),
    CONSTRAINT beitrag_ereignis_text CHECK (text IS NULL OR char_length(text) <= 500)
);
COMMENT ON TABLE avesmaps_community.beitrag_ereignis IS 'Verlauf eines Beitrags (Fachkonzept §15.9). Nie der Text des Beitrags.';

-- Der Verweis der Neuigkeit auf ihren Beitrag (Fachkonzept §15.3, Entscheidung E9): additiv, nullable, weich. Der Eintrag zeigt „aus SOC-…“ nur, wenn das
-- Ziel des Beitrags auf genau diesen Eintrag zeigt (die Stage bekommt `news_entry` mit dem Production-Zug, das Community-Schema nie).
ALTER TABLE public.news_entry ADD COLUMN IF NOT EXISTS beitrag_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS news_entry_beitrag ON public.news_entry (beitrag_id) WHERE beitrag_id IS NOT NULL;
COMMENT ON COLUMN public.news_entry.beitrag_id IS
    'Der Beitrag des Social Hubs (avesmaps_community.beitrag.id), aus dem der Eintrag stammt (WI-0270); NULL bei den Einträgen von Hand und aus Legacy. Weich, ohne Fremdschlüssel.';

-- --- Hilfen (nur intern; kein EXECUTE für irgendeine Rolle) --------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION avesmaps_community._soc(p_id BIGINT) RETURNS TEXT
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT 'SOC-' || lpad(p_id::text, 6, '0');
$$;

-- Den Beitrag sperren und lesen; nicht gefunden → KC404.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_sperre(p_id BIGINT) RETURNS avesmaps_community.beitrag
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    SELECT * INTO v FROM avesmaps_community.beitrag WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diesen Beitrag gibt es nicht');
    END IF;
    RETURN v;
END;
$$;

-- Sperren und die Revision prüfen (Konflikt wie bei den Vorgängen).
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_pruefe(p_id BIGINT, p_revision INTEGER) RETURNS avesmaps_community.beitrag
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    v := avesmaps_community._beitrag_sperre(p_id);
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_conflict: der Beitrag hat sich inzwischen geändert');
    END IF;
    RETURN v;
END;
$$;

-- Ein Ereignis anhängen; zählt die Revision des Beitrags hoch.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_ereignis(p_id BIGINT, p_art TEXT, p_person UUID, p_text TEXT, p_operation UUID)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_seq INTEGER;
    v_revision INTEGER;
BEGIN
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM avesmaps_community.beitrag_ereignis WHERE beitrag_id = p_id;
    INSERT INTO avesmaps_community.beitrag_ereignis (beitrag_id, seq, art, von_person, text, operation_id)
    VALUES (p_id, v_seq, p_art, p_person, NULLIF(btrim(p_text), ''), p_operation);
    UPDATE avesmaps_community.beitrag SET revision = revision + 1, aktiv_at = now() WHERE id = p_id RETURNING revision INTO v_revision;
    RETURN v_revision;
END;
$$;

-- Schon geschehen? Jede schreibende Funktion trägt eine `operation_id`; dieselbe noch einmal ist kein Fehler, sondern nichts.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_schon(p_operation UUID) RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT EXISTS (SELECT 1 FROM avesmaps_community.beitrag_ereignis WHERE operation_id = p_operation)
        OR EXISTS (SELECT 1 FROM avesmaps_community.beitrag WHERE operation_id = p_operation);
$$;

-- Der Inhalt: nur prüfen (die App hat Zählung und Hashtags schon bereinigt; hier stehen die harten Grenzen der Tafel).
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_inhalt(
    p_titel TEXT, p_text TEXT, p_hashtags TEXT[], p_rubrik TEXT, p_alt TEXT, p_kanaele TEXT[]
) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    h TEXT;
BEGIN
    IF char_length(COALESCE(btrim(p_titel), '')) > 200 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Titelzeile darf höchstens 200 Zeichen haben');
    END IF;
    IF char_length(COALESCE(p_text, '')) > 10000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text darf höchstens 10000 Zeichen haben');
    END IF;
    IF COALESCE(cardinality(p_hashtags), 0) > 10 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: höchstens 10 Hashtags');
    END IF;
    FOREACH h IN ARRAY COALESCE(p_hashtags, ARRAY[]::TEXT[])
    LOOP
        IF h IS NULL OR h !~ '^#[^[:space:]#]{1,63}$' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: ein Hashtag beginnt mit # und hat keine Leerzeichen');
        END IF;
    END LOOP;
    IF char_length(COALESCE(btrim(p_rubrik), '')) NOT BETWEEN 1 AND 40 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Rubrik fehlt');
    END IF;
    IF char_length(COALESCE(p_alt, '')) > 1000 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildbeschreibung darf höchstens 1000 Zeichen haben');
    END IF;
    IF p_kanaele IS NULL OR cardinality(p_kanaele) = 0
       OR NOT (p_kanaele <@ ARRAY['neuigkeiten', 'discord', 'mastodon', 'bluesky', 'instagram', 'facebook']::TEXT[]) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: es fehlt ein gültiger Kanal');
    END IF;
END;
$$;

-- Das Gate vor Vorlegen und Freigeben für das Bild: eine Bildbeschreibung (Pflicht, sobald ein Bild gewählt ist) und ein Medium, dessen Rechte geklärt sind
-- (Medienkern: `cleared`, oder `legacy_asserted`, die beide die automatische Freigabe tragen). Ohne Bild nichts zu prüfen.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_bild_pruefen(p_bild UUID, p_alt TEXT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF p_bild IS NULL THEN
        RETURN;
    END IF;
    IF btrim(COALESCE(p_alt, '')) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Bildbeschreibung fehlt');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.media_asset a JOIN public.media_rights r ON r.media_asset_id = a.id
         WHERE a.public_id = p_bild AND r.clearance_state IN ('cleared', 'legacy_asserted')
    ) THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Rechte des Bildes sind nicht geklärt');
    END IF;
END;
$$;

-- Die Ziele eines Beitrags auf die gewählten Kanäle bringen: neue Kanäle warten, abgewählte entfallen (nur vor dem Veröffentlichen).
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_ziele(p_id BIGINT, p_kanaele TEXT[]) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    DELETE FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_id AND NOT (kanal = ANY (p_kanaele));
    INSERT INTO avesmaps_community.beitrag_ziel (beitrag_id, kanal)
    SELECT p_id, k FROM unnest(p_kanaele) AS k
    ON CONFLICT (beitrag_id, kanal) DO NOTHING;
END;
$$;

-- Der Name zum Eintrag in der Neuigkeit (`herkunft`): der Anzeigename der Person, sonst „Redaktion“.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_name(p_person UUID) RETURNS TEXT
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT COALESCE((SELECT NULLIF(left(btrim(display_name), 80), '') FROM avesmaps_auth.person WHERE id = p_person), 'Redaktion');
$$;

-- --- Neuigkeiten: der eine Speicher --------------------------------------------------------------------------------------------------------

-- Den Beitrag in die Neuigkeiten schreiben und sichtbar machen: legt den Eintrag an (an die Spitze seines Tages, wie von Hand) oder bessert den
-- vorhandenen (Entwurf der Routine, zurückgenommener, im Papierkorb der Seite). Gibt die Kennung des Eintrags zurück. Die Zeitmarke `geaendert_at` setzt
-- die Stage gegen den Production-Zug (Migration 0146). Die Sperre `avesmaps.social_hub` hält den Spiegel (unten) aus dem eigenen Schreiben heraus.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_neuigkeit_schreiben(b avesmaps_community.beitrag, p_person UUID) RETURNS BIGINT
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_tag DATE := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
    IF btrim(COALESCE(b.titel, '')) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Neuigkeit braucht eine Titelzeile');
    END IF;
    IF btrim(b.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: die Neuigkeit braucht einen Text');
    END IF;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '1', true);
    SELECT id INTO v_id FROM public.news_entry WHERE beitrag_id = b.id FOR UPDATE;
    IF v_id IS NULL THEN
        INSERT INTO public.news_entry (
            datum, titel, text, rubrik, reihe, zustand, herkunft, von_person, freigegeben_at, freigegeben_von, geaendert_at, beitrag_id
        ) VALUES (
            v_tag, btrim(b.titel), btrim(b.text), btrim(b.rubrik),
            (SELECT COALESCE(max(reihe) + 1, 0) FROM public.news_entry WHERE datum = v_tag),
            'sichtbar', avesmaps_community._beitrag_name(p_person), p_person, now(), p_person, now(), b.id
        ) RETURNING id INTO v_id;
    ELSE
        UPDATE public.news_entry
           SET titel = btrim(b.titel), text = btrim(b.text), rubrik = btrim(b.rubrik), zustand = 'sichtbar',
               freigegeben_at = COALESCE(freigegeben_at, now()), freigegeben_von = COALESCE(freigegeben_von, p_person),
               geloescht_at = NULL, geloescht_von = NULL, geloescht_aus = NULL, geaendert_at = now()
         WHERE id = v_id;
    END IF;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '', true);
    RETURN v_id;
END;
$$;

-- Die Neuigkeit verstecken (zurückgenommen): sichtbar → versteckt, nie gelöscht.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_neuigkeit_verstecken(p_beitrag BIGINT) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '1', true);
    UPDATE public.news_entry SET zustand = 'versteckt', geaendert_at = now() WHERE beitrag_id = p_beitrag AND zustand = 'sichtbar';
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '', true);
END;
$$;

-- Den Entwurf der Routine (oder den Eintrag eines verworfenen Beitrags) in den Papierkorb der Seite legen und zurückholen. `p_ein` legt hinein.
CREATE OR REPLACE FUNCTION avesmaps_community._beitrag_neuigkeit_korb(p_beitrag BIGINT, p_ein BOOLEAN, p_person UUID) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '1', true);
    IF p_ein THEN
        UPDATE public.news_entry
           SET geloescht_at = now(), geloescht_von = p_person, geloescht_aus = zustand,
               zustand = CASE WHEN zustand = 'sichtbar' THEN 'versteckt' ELSE zustand END, geaendert_at = now()
         WHERE beitrag_id = p_beitrag AND geloescht_at IS NULL;
    ELSE
        UPDATE public.news_entry
           SET zustand = COALESCE(geloescht_aus, zustand), geloescht_at = NULL, geloescht_von = NULL, geloescht_aus = NULL, geaendert_at = now()
         WHERE beitrag_id = p_beitrag AND geloescht_at IS NOT NULL;
    END IF;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '', true);
END;
$$;

-- --- Redaktion: verfassen -------------------------------------------------------------------------------------------------------------

-- Einen Beitrag anlegen (Entwurf). `p_vorgang` ist die Nummer des Vorgangs bei „Als Beitrag vorschlagen“ (Herkunft `vorgang`, Fachkonzept §15.8): der
-- Beitrag trägt nie Daten des Melders, die Funktion kennt sie gar nicht. Antwort: Kennung, Revision, Zustand.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_anlegen(
    p_operation UUID, p_person UUID, p_vorgang BIGINT, p_titel TEXT, p_text TEXT, p_hashtags TEXT[], p_rubrik TEXT, p_bild UUID, p_alt TEXT,
    p_ki BOOLEAN, p_kanaele TEXT[]
) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    v_id BIGINT;
    v_revision INTEGER;
BEGIN
    SELECT * INTO v FROM avesmaps_community.beitrag WHERE operation_id = p_operation;
    IF FOUND THEN
        RETURN jsonb_build_object('id', v.id, 'revision', v.revision, 'zustand', v.zustand);
    END IF;
    PERFORM avesmaps_community._beitrag_inhalt(p_titel, p_text, p_hashtags, p_rubrik, p_alt, p_kanaele);
    IF p_vorgang IS NOT NULL AND NOT EXISTS (SELECT 1 FROM avesmaps_community.vorgang WHERE id = p_vorgang) THEN
        PERFORM avesmaps_community._fehler('KC404', 'community_not_found: diesen Vorgang gibt es nicht');
    END IF;
    INSERT INTO avesmaps_community.beitrag (
        herkunft, vorgang_id, verfasser, titel, text, hashtags, rubrik, bild_id, bild_beschreibung, ki, kanaele, operation_id
    ) VALUES (
        CASE WHEN p_vorgang IS NULL THEN 'redaktion' ELSE 'vorgang' END, p_vorgang, p_person, NULLIF(btrim(p_titel), ''),
        regexp_replace(btrim(COALESCE(p_text, ''), E' \t\r\n'), E'\r\n?', E'\n', 'g'), COALESCE(p_hashtags, ARRAY[]::TEXT[]),
        btrim(p_rubrik), p_bild, NULLIF(btrim(COALESCE(p_alt, '')), ''), COALESCE(p_ki, false), p_kanaele, p_operation
    ) RETURNING id INTO v_id;
    PERFORM avesmaps_community._beitrag_ziele(v_id, p_kanaele);
    v_revision := avesmaps_community._beitrag_ereignis(
        v_id, 'angelegt', p_person, CASE WHEN p_vorgang IS NULL THEN NULL ELSE avesmaps_community._com(p_vorgang) END, NULL
    );
    RETURN jsonb_build_object('id', v_id, 'revision', v_revision, 'zustand', 'entwurf');
END;
$$;

-- Den Beitrag ändern: das Formular als Ganzes. Dieselbe Fassung noch einmal ist nichts (auch nach einem Netzfehler). Im Papierkorb wird nichts geändert; die
-- Kanäle nur vor dem Veröffentlichen. Nach dem Veröffentlichen merkt sich der Beitrag „geändert“ (Fuß: „Änderung veröffentlichen“). Bis zum Vorlegen schreibt eine
-- Änderung keinen Eintrag in den Verlauf (nur die Revision zählt hoch), danach einen.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_aendern(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_titel TEXT, p_text TEXT, p_hashtags TEXT[], p_rubrik TEXT, p_bild UUID,
    p_alt TEXT, p_ki BOOLEAN, p_kanaele TEXT[]
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    v_titel TEXT := NULLIF(btrim(COALESCE(p_titel, '')), '');
    v_text TEXT := regexp_replace(btrim(COALESCE(p_text, ''), E' \t\r\n'), E'\r\n?', E'\n', 'g');
    v_hashtags TEXT[] := COALESCE(p_hashtags, ARRAY[]::TEXT[]);
    v_alt TEXT := NULLIF(btrim(COALESCE(p_alt, '')), '');
    v_inhalt_gleich BOOLEAN;
    v_kanaele_gleich BOOLEAN;
    v_revision INTEGER;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    PERFORM avesmaps_community._beitrag_inhalt(p_titel, p_text, p_hashtags, p_rubrik, p_alt, p_kanaele);
    v := avesmaps_community._beitrag_sperre(p_id);
    v_inhalt_gleich := v.titel IS NOT DISTINCT FROM v_titel AND v.text = v_text AND v.hashtags = v_hashtags AND v.rubrik = btrim(p_rubrik)
        AND v.bild_id IS NOT DISTINCT FROM p_bild AND v.bild_beschreibung IS NOT DISTINCT FROM v_alt AND v.ki = COALESCE(p_ki, false);
    v_kanaele_gleich := v.kanaele @> p_kanaele AND v.kanaele <@ p_kanaele;
    -- Dieselbe Fassung noch einmal (ein wiederholtes Senden): nichts zu tun, auch wenn die Revision inzwischen weitergezählt hat.
    IF v_inhalt_gleich AND v_kanaele_gleich THEN
        RETURN v.revision;
    END IF;
    IF v.revision <> p_revision THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_conflict: der Beitrag hat sich inzwischen geändert');
    END IF;
    IF v.papierkorb_at IS NOT NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ein Beitrag im Papierkorb wird nicht geändert');
    END IF;
    IF NOT v_kanaele_gleich AND v.zustand = 'veroeffentlicht' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: die Kanäle ändern sich nur vor dem Veröffentlichen');
    END IF;
    UPDATE avesmaps_community.beitrag
       SET titel = v_titel, text = v_text, hashtags = v_hashtags, rubrik = btrim(p_rubrik), bild_id = p_bild, bild_beschreibung = v_alt,
           ki = COALESCE(p_ki, false), kanaele = p_kanaele,
           geaendert = (zustand = 'veroeffentlicht')
     WHERE id = p_id;
    IF NOT v_kanaele_gleich THEN
        PERFORM avesmaps_community._beitrag_ziele(p_id, p_kanaele);
    END IF;
    IF v.zustand = 'entwurf' THEN
        UPDATE avesmaps_community.beitrag SET revision = revision + 1, aktiv_at = now() WHERE id = p_id RETURNING revision INTO v_revision;
        RETURN v_revision;
    END IF;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'geaendert', p_person, NULL, p_operation);
END;
$$;

-- --- Redaktion: vorlegen, zurückgeben, freigeben -------------------------------------------------------------------------------------------

-- Zur Freigabe vorlegen: Entwurf → vorgelegt. Text und Bild müssen stehen; die Zählung je Kanal prüft die App mit demselben Modul wie das Fenster.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_vorlegen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand <> 'entwurf' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein Entwurf wird zur Freigabe vorgelegt');
    END IF;
    IF btrim(v.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text fehlt');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    UPDATE avesmaps_community.beitrag SET zustand = 'vorgelegt', vorgelegt_at = now() WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'vorgelegt', p_person, NULL, p_operation);
END;
$$;

-- Die Vorlage zurückziehen: vorgelegt → Entwurf (der Verfasser).
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_zurueckziehen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand <> 'vorgelegt' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine Vorlage wird zurückgezogen');
    END IF;
    UPDATE avesmaps_community.beitrag SET zustand = 'entwurf', vorgelegt_at = NULL WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'zurueckgezogen', p_person, NULL, p_operation);
END;
$$;

-- Zurück an den Verfasser (Freigebende): vorgelegt → Entwurf, mit einem freiwilligen Grund im Verlauf. Ein Vorschlag der Routine hat keinen Verfasser: Ihn
-- verwirft man oder gibt ihn frei.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_zurueckgeben(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_grund TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    IF char_length(COALESCE(p_grund, '')) > 500 THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Grund darf höchstens 500 Zeichen haben');
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand <> 'vorgelegt' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur eine Vorlage geht zurück an den Verfasser');
    END IF;
    IF v.verfasser IS NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: dieser Beitrag hat keinen Verfasser, an den er zurückgehen kann');
    END IF;
    UPDATE avesmaps_community.beitrag SET zustand = 'entwurf', vorgelegt_at = NULL WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'zurueckgegeben', p_person, p_grund, p_operation);
END;
$$;

-- Freigeben und veröffentlichen (Freigebende, `manage_news`): vorgelegt → veröffentlicht; den EIGENEN Entwurf gibt ein Betreiber allein frei (E10), mit
-- Vermerk „allein freigegeben“ im Verlauf. Einen fremden Entwurf nicht. Im ersten Schnitt sendet nur der Kanal „Neuigkeiten“: Er schreibt den Eintrag in
-- `news_entry` und sagt dem Ziel die Adresse. Jeder andere Kanal ist (noch) nicht verbunden.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_freigeben(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    v_allein BOOLEAN;
    v_news BIGINT;
    k TEXT;
    v_revision INTEGER;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand = 'veroeffentlicht' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: dieser Beitrag wird nicht (mehr) freigegeben');
    END IF;
    v_allein := v.verfasser IS NOT NULL AND v.verfasser = p_person;
    IF v.zustand = 'entwurf' AND NOT v_allein THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Beitrag ist noch nicht zur Freigabe vorgelegt');
    END IF;
    IF btrim(v.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: der Text fehlt');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    FOREACH k IN ARRAY v.kanaele
    LOOP
        IF k <> 'neuigkeiten' THEN
            PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal ist noch nicht verbunden');
        END IF;
    END LOOP;
    -- Die Neuigkeit wird geschrieben, bevor der Beitrag als veröffentlicht gilt: Scheitert sie, scheitert die ganze Handlung (eine Transaktion).
    v_news := avesmaps_community._beitrag_neuigkeit_schreiben(v, p_person);
    UPDATE avesmaps_community.beitrag_ziel
       SET zustand = 'ok', adresse = 'news:' || v_news, fehler = NULL, versuche = versuche + 1, gesendet_at = now()
     WHERE beitrag_id = p_id AND kanal = 'neuigkeiten';
    UPDATE avesmaps_community.beitrag
       SET zustand = 'veroeffentlicht', vorgelegt_at = COALESCE(vorgelegt_at, now()), veroeffentlicht_at = now(), geaendert = false
     WHERE id = p_id;
    PERFORM avesmaps_community._beitrag_ereignis(
        p_id, 'freigegeben', p_person, CASE WHEN v_allein THEN 'allein freigegeben' ELSE NULL END, p_operation
    );
    v_revision := avesmaps_community._beitrag_ereignis(p_id, 'gesendet', p_person, 'Neuigkeiten', NULL);
    RETURN v_revision;
END;
$$;

-- Änderung veröffentlichen (Freigebende): Der Eintrag in den Neuigkeiten folgt dem Beitrag (Titel, Text, Rubrik); ändern im Hub ändert den Eintrag.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_aenderung_veroeffentlichen(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.zustand <> 'veroeffentlicht' OR NOT v.geaendert THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein geänderter, veröffentlichter Beitrag hat eine Änderung zu veröffentlichen');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    IF btrim(COALESCE(v.titel, '')) = '' OR btrim(v.text) = '' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: Titelzeile und Text müssen stehen');
    END IF;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '1', true);
    UPDATE public.news_entry SET titel = btrim(v.titel), text = btrim(v.text), rubrik = btrim(v.rubrik), geaendert_at = now() WHERE beitrag_id = p_id;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '', true);
    UPDATE avesmaps_community.beitrag SET geaendert = false WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'aenderung_veroeffentlicht', p_person, NULL, p_operation);
END;
$$;

-- Zurücknehmen (Freigebende): Die Neuigkeit wird versteckt, nicht gelöscht. Der Beitrag bleibt „veröffentlicht“, das Ziel steht auf „zurückgenommen“.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_zuruecknehmen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.zustand <> 'veroeffentlicht' OR NOT EXISTS (
        SELECT 1 FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_id AND zustand = 'ok'
    ) THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: nur ein veröffentlichter Beitrag wird zurückgenommen');
    END IF;
    PERFORM avesmaps_community._beitrag_neuigkeit_verstecken(p_id);
    UPDATE avesmaps_community.beitrag_ziel SET zustand = 'zurueck' WHERE beitrag_id = p_id AND kanal = 'neuigkeiten' AND zustand = 'ok';
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'zurueckgenommen', p_person, 'Neuigkeiten', p_operation);
END;
$$;

-- Erneut senden, für diesen einen Kanal: bei einem Fehler oder nach dem Zurücknehmen. Dieselbe Neuigkeit, kein zweiter Eintrag (der Verweis `beitrag_id`
-- ist eindeutig).
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_erneut_senden(
    p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER, p_kanal TEXT
) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
    z avesmaps_community.beitrag_ziel;
    v_news BIGINT;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel WHERE beitrag_id = p_id AND kanal = p_kanal FOR UPDATE;
    IF v.zustand <> 'veroeffentlicht' OR NOT FOUND OR z.zustand NOT IN ('fehler', 'zurueck') THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: erneut senden geht nur bei einem Fehler oder nach dem Zurücknehmen');
    END IF;
    IF p_kanal <> 'neuigkeiten' THEN
        PERFORM avesmaps_community._fehler('KC422', 'community_invalid: dieser Kanal ist noch nicht verbunden');
    END IF;
    PERFORM avesmaps_community._beitrag_bild_pruefen(v.bild_id, v.bild_beschreibung);
    v_news := avesmaps_community._beitrag_neuigkeit_schreiben(v, p_person);
    UPDATE avesmaps_community.beitrag_ziel
       SET zustand = 'ok', adresse = 'news:' || v_news, fehler = NULL, versuche = versuche + 1, gesendet_at = now()
     WHERE beitrag_id = p_id AND kanal = p_kanal;
    UPDATE avesmaps_community.beitrag SET geaendert = false WHERE id = p_id;
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'erneut_gesendet', p_person, 'Neuigkeiten', p_operation);
END;
$$;

-- --- Redaktion: Papierkorb ------------------------------------------------------------------------------------------------------------

-- In den Papierkorb (Verfasser oder Freigebende): nur offene Beiträge. Ein Entwurf der Routine liegt als Entwurf auch in den Neuigkeiten; er geht dort mit.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_papierkorb(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NOT NULL OR v.zustand = 'veroeffentlicht' THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: ein veröffentlichter Beitrag wird zurückgenommen, nicht verworfen');
    END IF;
    UPDATE avesmaps_community.beitrag SET papierkorb_at = now(), papierkorb_art = 'verworfen' WHERE id = p_id;
    PERFORM avesmaps_community._beitrag_neuigkeit_korb(p_id, true, p_person);
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'verworfen', p_person, NULL, p_operation);
END;
$$;

-- Aus dem Papierkorb holen: derselbe Zustand wie davor; ein vorgelegter Beitrag der Routine beginnt seine sieben Tage von vorn.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_zurueckholen(p_operation UUID, p_id BIGINT, p_person UUID, p_revision INTEGER)
    RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v avesmaps_community.beitrag;
BEGIN
    IF avesmaps_community._beitrag_schon(p_operation) THEN
        RETURN (SELECT revision FROM avesmaps_community.beitrag WHERE id = p_id);
    END IF;
    v := avesmaps_community._beitrag_pruefe(p_id, p_revision);
    IF v.papierkorb_at IS NULL THEN
        PERFORM avesmaps_community._fehler('KC409', 'community_transition: der Beitrag liegt nicht im Papierkorb');
    END IF;
    UPDATE avesmaps_community.beitrag
       SET papierkorb_at = NULL, papierkorb_art = NULL,
           vorgelegt_at = CASE WHEN zustand = 'vorgelegt' THEN now() ELSE vorgelegt_at END
     WHERE id = p_id;
    PERFORM avesmaps_community._beitrag_neuigkeit_korb(p_id, false, p_person);
    RETURN avesmaps_community._beitrag_ereignis(p_id, 'wiederhergestellt', p_person, NULL, p_operation);
END;
$$;

-- --- Die Routine: Beitrag statt Entwurf allein ----------------------------------------------------------------------------------------------

-- Wie viele Beiträge die Routine je Tag und Kanal anlegen darf (Notbremse, Fachkonzept §15.3). Eine Stelle, die ein späterer Schritt ändert.
CREATE OR REPLACE FUNCTION avesmaps_community._routine_je_tag() RETURNS INTEGER
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT 1;
$$;

-- Zum frisch angelegten Entwurf der Routine (`news_add`) den Beitrag anlegen: Herkunft „Routine“, vorgelegt („Vorschlag der Routine: wartet auf Freigabe“),
-- mit dem Verweis `news_entry.beitrag_id`. Notbremse: Gab es heute (Berliner Tag) schon so viele Beiträge der Routine für den Kanal, bleibt der Eintrag
-- ein Entwurf allein in der Systemsteuerung, wie bisher; es entsteht kein weiterer Vorschlag. Gezählt wird, was heute ANGELEGT wurde, gleich in welchem
-- Zustand (ein verworfener Vorschlag macht keinen Platz für einen neuen).
CREATE OR REPLACE FUNCTION avesmaps_community._routine_beitrag(p_news BIGINT, p_titel TEXT, p_text TEXT, p_rubrik TEXT) RETURNS BIGINT
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_heute DATE := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
    -- Zwei Läufe zugleich zählen sonst beide „noch keiner“.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social_routine', 0));
    IF (
        SELECT count(*) FROM avesmaps_community.beitrag
         WHERE herkunft = 'routine' AND 'neuigkeiten' = ANY (kanaele) AND (angelegt_at AT TIME ZONE 'Europe/Berlin')::date = v_heute
    ) >= avesmaps_community._routine_je_tag() THEN
        RETURN NULL;
    END IF;
    INSERT INTO avesmaps_community.beitrag (
        herkunft, titel, text, rubrik, ki, kanaele, zustand, vorgelegt_at, operation_id
    ) VALUES (
        'routine', btrim(p_titel), btrim(p_text), btrim(p_rubrik), true, ARRAY['neuigkeiten']::TEXT[], 'vorgelegt', now(), gen_random_uuid()
    ) RETURNING id INTO v_id;
    INSERT INTO avesmaps_community.beitrag_ziel (beitrag_id, kanal, adresse) VALUES (v_id, 'neuigkeiten', 'news:' || p_news);
    PERFORM avesmaps_community._beitrag_ereignis(v_id, 'angelegt', NULL, 'Routine', NULL);
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '1', true);
    UPDATE public.news_entry SET beitrag_id = v_id WHERE id = p_news;
    PERFORM pg_catalog.set_config('avesmaps.social_hub', '', true);
    RETURN v_id;
END;
$$;

-- 🔴 `news_add` behält Namen, Argumentliste und Rückgabetyp (Rechte der Rolle `avesmaps3d_<env>_news` bleiben, `CREATE OR REPLACE` ändert sie nicht): Die
-- Routine ruft weiter genau diese Funktion und bekommt weiter die Kennung des Eintrags oder NULL. NEU: Zum neuen Entwurf legt sie den Beitrag der Routine an.
CREATE OR REPLACE FUNCTION public.news_add(
    p_datum DATE, p_titel TEXT, p_text TEXT, p_rubrik TEXT, p_quelle TEXT
) RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_reihe INTEGER;
BEGIN
    IF p_quelle IS NULL OR btrim(p_quelle) = '' THEN
        RAISE EXCEPTION 'news_add: quelle ist Pflicht (der Stand, aus dem der Eintrag kommt)' USING ERRCODE = '22023';
    END IF;
    -- Die Reihe innerhalb des Tages: hinter das, was schon da ist.
    SELECT COALESCE(max(reihe) + 1, 0) INTO v_reihe FROM public.news_entry WHERE datum = p_datum;
    INSERT INTO public.news_entry (datum, titel, text, rubrik, reihe, zustand, herkunft, quelle)
    VALUES (p_datum, btrim(p_titel), btrim(p_text), btrim(p_rubrik), v_reihe, 'entwurf', 'routine', btrim(p_quelle))
    ON CONFLICT (quelle, titel) DO NOTHING
    RETURNING id INTO v_id;
    -- WI-0270: Der Entwurf wird zugleich ein Vorschlag im Social Hub (mit Notbremse je Tag und Kanal).
    IF v_id IS NOT NULL THEN
        PERFORM avesmaps_community._routine_beitrag(v_id, p_titel, p_text, p_rubrik);
    END IF;
    RETURN v_id;
END;
$$;

-- --- Spiegel: die Systemsteuerung ändert einen Eintrag aus dem Hub ---------------------------------------------------------------------------

-- Die Seite „Neuigkeiten“ in der Systemsteuerung darf einen Eintrag weiter freigeben, verstecken, in den Papierkorb legen und bessern (Entscheidung E9: Rubriken,
-- Reihenfolge und Papierkorb der Seite bleiben dort). Damit der Hub nie etwas anderes behauptet als die Seite, zieht dieser Auslöser den Beitrag nach:
-- Wird ein Eintrag mit Beitrag sichtbar, gilt der Beitrag als veröffentlicht; wird er versteckt oder in den Papierkorb gelegt, ist das Ziel zurückgenommen (ein
-- noch offener Beitrag geht mit in den Papierkorb); Titel, Text und Rubrik gleichen den Beitrag an. Die Handlungen des Hubs setzen `avesmaps.social_hub`
-- und bleiben unberührt. Gespiegelt wird nur, wenn das Ziel des Beitrags auf GENAU diesen Eintrag zeigt (die Stage bekommt `news_entry` ohne das Schema).
CREATE OR REPLACE FUNCTION avesmaps_community._news_spiegeln() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    b avesmaps_community.beitrag;
    z avesmaps_community.beitrag_ziel;
    v_sichtbar_neu BOOLEAN := NEW.zustand = 'sichtbar' AND NEW.geloescht_at IS NULL;
    v_sichtbar_alt BOOLEAN := OLD.zustand = 'sichtbar' AND OLD.geloescht_at IS NULL;
BEGIN
    IF pg_catalog.current_setting('avesmaps.social_hub', true) = '1' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO z FROM avesmaps_community.beitrag_ziel
     WHERE beitrag_id = NEW.beitrag_id AND kanal = 'neuigkeiten' AND adresse = 'news:' || NEW.id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO b FROM avesmaps_community.beitrag WHERE id = NEW.beitrag_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_sichtbar_neu AND NOT v_sichtbar_alt THEN
        IF b.zustand <> 'veroeffentlicht' THEN
            UPDATE avesmaps_community.beitrag
               SET zustand = 'veroeffentlicht', vorgelegt_at = COALESCE(vorgelegt_at, now()), veroeffentlicht_at = now(), geaendert = false,
                   papierkorb_at = NULL, papierkorb_art = NULL
             WHERE id = b.id;
        END IF;
        UPDATE avesmaps_community.beitrag_ziel SET zustand = 'ok', fehler = NULL, gesendet_at = now() WHERE beitrag_id = b.id AND kanal = 'neuigkeiten';
        PERFORM avesmaps_community._beitrag_ereignis(b.id, 'in_systemsteuerung', NULL, 'veröffentlicht', NULL);
    ELSIF v_sichtbar_alt AND NOT v_sichtbar_neu THEN
        IF b.zustand = 'veroeffentlicht' THEN
            UPDATE avesmaps_community.beitrag_ziel SET zustand = 'zurueck' WHERE beitrag_id = b.id AND kanal = 'neuigkeiten' AND zustand = 'ok';
        END IF;
        PERFORM avesmaps_community._beitrag_ereignis(b.id, 'in_systemsteuerung', NULL, 'versteckt', NULL);
    ELSIF NEW.geloescht_at IS NOT NULL AND OLD.geloescht_at IS NULL AND b.zustand <> 'veroeffentlicht' AND b.papierkorb_at IS NULL THEN
        UPDATE avesmaps_community.beitrag SET papierkorb_at = now(), papierkorb_art = 'verworfen' WHERE id = b.id;
        PERFORM avesmaps_community._beitrag_ereignis(b.id, 'in_systemsteuerung', NULL, 'in den Papierkorb gelegt', NULL);
    ELSIF NEW.geloescht_at IS NULL AND OLD.geloescht_at IS NOT NULL AND b.zustand <> 'veroeffentlicht' AND b.papierkorb_at IS NOT NULL THEN
        UPDATE avesmaps_community.beitrag SET papierkorb_at = NULL, papierkorb_art = NULL WHERE id = b.id;
        PERFORM avesmaps_community._beitrag_ereignis(b.id, 'in_systemsteuerung', NULL, 'aus dem Papierkorb geholt', NULL);
    END IF;
    IF (NEW.titel, NEW.text, NEW.rubrik) IS DISTINCT FROM (OLD.titel, OLD.text, OLD.rubrik) THEN
        UPDATE avesmaps_community.beitrag SET titel = NEW.titel, text = NEW.text, rubrik = NEW.rubrik WHERE id = b.id;
        PERFORM avesmaps_community._beitrag_ereignis(b.id, 'in_systemsteuerung', NULL, 'Text geändert', NULL);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS news_entry_spiegeln ON public.news_entry;
CREATE TRIGGER news_entry_spiegeln AFTER UPDATE ON public.news_entry
    FOR EACH ROW WHEN (NEW.beitrag_id IS NOT NULL) EXECUTE FUNCTION avesmaps_community._news_spiegeln();

-- --- Aufbewahrung: Frischeprüfung und Papierkorb -------------------------------------------------------------------------------------------

-- Läuft täglich mit der Aufbewahrung der Community (Jobs-Rolle). Eine eigene Funktion, damit `community_purge_expired` (0265) unverändert bleibt.
-- (1) Frischeprüfung (Fachkonzept §15.3): Ein Vorschlag der Routine, der sieben Tage vorgelegt liegt, ohne dass jemand ihn freigab, verfällt in den
-- Papierkorb (samt dem Entwurf in den Neuigkeiten). (2) Der Papierkorb der Beiträge ist nach 30 Tagen endgültig leer (Ziele und Verlauf gehen mit; die
-- Einträge in den Neuigkeiten bleiben im Papierkorb der Seite). Veröffentlichte Beiträge fasst nichts davon an.
CREATE OR REPLACE FUNCTION avesmaps_community.beitrag_purge_expired() RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_id BIGINT;
    v_verfallen INTEGER := 0;
    v_geloescht INTEGER;
BEGIN
    FOR v_id IN
        SELECT id FROM avesmaps_community.beitrag
         WHERE herkunft = 'routine' AND zustand = 'vorgelegt' AND papierkorb_at IS NULL AND vorgelegt_at < now() - interval '7 days'
         ORDER BY id
           FOR UPDATE
    LOOP
        UPDATE avesmaps_community.beitrag SET papierkorb_at = now(), papierkorb_art = 'verfallen' WHERE id = v_id;
        PERFORM avesmaps_community._beitrag_neuigkeit_korb(v_id, true, NULL);
        PERFORM avesmaps_community._beitrag_ereignis(v_id, 'verfallen', NULL, 'nach sieben Tagen ohne Freigabe', NULL);
        v_verfallen := v_verfallen + 1;
    END LOOP;
    DELETE FROM avesmaps_community.beitrag WHERE papierkorb_at < now() - interval '30 days';
    GET DIAGNOSTICS v_geloescht = ROW_COUNT;
    RETURN jsonb_build_object('beitraegeVerfallen', v_verfallen, 'beitraegeGeloescht', v_geloescht);
END;
$$;

-- Konto auflösen (WI-0120 A15): jetzt auch Verfasser und Verlauf der Beiträge. Gleiche Argumentliste wie in 0265 und 0266.
CREATE OR REPLACE FUNCTION avesmaps_community.redact_person_community(p_person UUID) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_n INTEGER;
    v_summe INTEGER := 0;
BEGIN
    UPDATE avesmaps_community.vorgang SET zustaendig = NULL WHERE zustaendig = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.vorgang SET angelegt_von = NULL WHERE angelegt_von = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.melder SET person_id = NULL WHERE person_id = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.nachricht SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.notiz SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.verknuepfung SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.bewertung_ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.beitrag SET verfasser = NULL WHERE verfasser = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    UPDATE avesmaps_community.beitrag_ereignis SET von_person = NULL WHERE von_person = p_person;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_summe := v_summe + v_n;
    RETURN v_summe;
END;
$$;

-- Keine Funktion des Schemas darf zunächst jeder aufrufen; wer was darf, steht in `community-grants.psql`.
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'avesmaps_community'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    END LOOP;
END;
$$;
