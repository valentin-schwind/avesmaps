-- 0221: Der tägliche Discord-Bericht (WI-0255; Betreiberauftrag 2026-10-25, `project-control/work-items/discord-community-bericht-auftrag-2026-10-25.md`).
--
--   1. `discord_zustellung`: die Zustelltafel. 🔴 Genau eine Zeile je Art, Berichtstag und Kanal (eindeutiger Schlüssel): Ein zweiter Lauf am
--      selben Tag findet sie und sendet nicht noch einmal. Sie hält, was hinausging (`inhalt`, `text`), woraus es entstand (`fakten`, der Nachweis)
--      und wie es ausging (`status`, `message_id`, `fehler`). `zugestellt` hat immer eine Message-ID, nichts anderes hat eine.
--   2. `discord_routine`: der Schalter der täglichen Routine (Vorgabe AUS: erst der Betreiber schaltet sie im Reiter „Discord“ ein) und was der
--      letzte Lauf ergab, für den Betriebsstand.
--
-- 🔴 Keine Geheimnisse hier: Bot-Schlüssel und Kanal stehen in der geschützten Konfiguration auf dem VPS (Claudio), nie in der Datenbank.
-- 🔴 Beide Tafeln gehören der Umgebung: Der Production-Zug behält sie auf der Stage (`ops/production/production-to-stage.sh`, `KEEP_RE`), der
--    Abzug für lokal nimmt sie nicht mit (`config/abzug/regeln.json`).
-- ADDITIV: zwei neue Tafeln, nichts Bestehendes ändert sich; das vorige Release kennt sie nicht und braucht sie nicht. Die App-Rolle bekommt
-- ihre Rechte über die Default-Privilegien in public.

CREATE TABLE IF NOT EXISTS public.discord_zustellung (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    art TEXT NOT NULL DEFAULT 'tagesbericht',
    berichtstag DATE NOT NULL,
    kanal TEXT NOT NULL,
    kanal_art TEXT NOT NULL,
    status TEXT NOT NULL,
    -- Discords `nonce` (höchstens 25 Zeichen) mit `enforce_nonce`: Wiederholt ein Lauf binnen Minuten, legt Discord keine zweite Nachricht an.
    nonce TEXT NOT NULL,
    inhalt JSONB NOT NULL,
    text TEXT NOT NULL,
    fakten JSONB NOT NULL,
    formulierung TEXT NOT NULL DEFAULT 'vorlage',
    message_id TEXT,
    versuche INTEGER NOT NULL DEFAULT 0,
    fehler TEXT,
    ausgeloest TEXT NOT NULL,
    ausgeloest_von UUID,
    erstellt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    versucht_at TIMESTAMPTZ,
    zugestellt_at TIMESTAMPTZ,
    geaendert_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT discord_zustellung_einmal UNIQUE (art, berichtstag, kanal),
    CONSTRAINT discord_zustellung_art_bekannt CHECK (art IN ('tagesbericht')),
    CONSTRAINT discord_zustellung_kanal_kennung CHECK (kanal ~ '^[0-9]{17,20}$'),
    CONSTRAINT discord_zustellung_kanal_art_bekannt CHECK (kanal_art IN ('bericht', 'test')),
    CONSTRAINT discord_zustellung_status_bekannt CHECK (status IN ('sendet', 'zugestellt', 'fehlgeschlagen', 'unklar')),
    CONSTRAINT discord_zustellung_nonce_kurz CHECK (char_length(nonce) BETWEEN 1 AND 25),
    CONSTRAINT discord_zustellung_formulierung_bekannt CHECK (formulierung IN ('vorlage', 'modell')),
    CONSTRAINT discord_zustellung_message_kennung CHECK (message_id IS NULL OR message_id ~ '^[0-9]{17,20}$'),
    CONSTRAINT discord_zustellung_zugestellt_mit_id CHECK ((status = 'zugestellt') = (message_id IS NOT NULL)),
    CONSTRAINT discord_zustellung_text_grenze CHECK (char_length(text) BETWEEN 1 AND 2000),
    CONSTRAINT discord_zustellung_ausgeloest_bekannt CHECK (ausgeloest IN ('zeitplan', 'hand')),
    CONSTRAINT discord_zustellung_versuche_positiv CHECK (versuche >= 0)
);

CREATE INDEX IF NOT EXISTS discord_zustellung_neueste ON public.discord_zustellung (berichtstag DESC, id DESC);

COMMENT ON TABLE public.discord_zustellung IS
    'Discord-Tagesbericht (WI-0255): eine Zeile je Art, Berichtstag und Kanal, mit Inhalt, Faktennachweis, Status und Message-ID. Bleibt je Umgebung.';

CREATE TABLE IF NOT EXISTS public.discord_routine (
    art TEXT PRIMARY KEY,
    aktiv BOOLEAN NOT NULL DEFAULT false,
    geaendert_at TIMESTAMPTZ,
    geaendert_von UUID,
    letzter_lauf_at TIMESTAMPTZ,
    letzter_lauf TEXT,
    CONSTRAINT discord_routine_art_bekannt CHECK (art IN ('tagesbericht')),
    CONSTRAINT discord_routine_lauf_kurz CHECK (letzter_lauf IS NULL OR char_length(letzter_lauf) <= 300)
);

INSERT INTO public.discord_routine (art) VALUES ('tagesbericht') ON CONFLICT (art) DO NOTHING;

COMMENT ON TABLE public.discord_routine IS
    'Schalter der täglichen Discord-Routine (WI-0255; Vorgabe aus) und Ergebnis des letzten Laufs. Bleibt je Umgebung.';
