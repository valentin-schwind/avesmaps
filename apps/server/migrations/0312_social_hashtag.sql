-- Die Hashtags des Social Hubs (WI-0270, Vali 2026-11-04: „in der systemsteuerung bei social media ein panel hinzufügen hashtags, wo #hashtags definiert werden können, die dann im social-media hub standardmäßig
-- ausgewählt werden können, füge gleich hinzu: #dasschwarzeauge #pnpde“). Bis hierher standen fünf feste Hashtags im Fenster des Beitrags; sie ziehen mit um, damit keiner still verschwindet.
--
-- 🔴 REIN ADDITIV: eine neue Tafel, das vorige Release liest sie nicht. Sie liegt in `public`: Die Rechte der App-Rolle kommen über das Default-Privileg der Migrationsrolle (`test/support/public-rechte.ts`), die
-- Vorlagen unter `src/db/` und ihre Abschrift in `ops/` bleiben, wie sie sind.

CREATE TABLE IF NOT EXISTS social_hashtag (
    -- Die Form prüft die Route (`HASHTAG_MUSTER`, `bereinigeHashtags`); hier steht nur die harte Grenze.
    tag TEXT PRIMARY KEY CHECK (char_length(tag) BETWEEN 2 AND 64 AND left(tag, 1) = '#'),
    -- Steht in einem neuen Beitrag schon drin und lässt sich dort abwählen.
    vorausgewaehlt BOOLEAN NOT NULL DEFAULT false,
    reihe SMALLINT NOT NULL
);
COMMENT ON TABLE social_hashtag IS
    'Die Hashtags, die der Social Hub in jedem Beitrag anbietet (WI-0270); gepflegt in der Systemsteuerung, Panel „Hashtags“. Ein Beitrag darf daneben eigene tragen.';

INSERT INTO social_hashtag (tag, vorausgewaehlt, reihe) VALUES
    ('#dasschwarzeauge', true, 1),
    ('#pnpde', true, 2),
    ('#Aventurien', false, 3),
    ('#DSA', false, 4),
    ('#Avesmaps', false, 5),
    ('#Karte', false, 6),
    ('#Rollenspiel', false, 7)
ON CONFLICT (tag) DO NOTHING;
