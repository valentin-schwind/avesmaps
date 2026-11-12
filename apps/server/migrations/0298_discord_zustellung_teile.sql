-- 0298: Der Discord-Bericht in mehreren Nachrichten (WI-0255, Vali 2026-11-02: „wenn A geht“): `discord_zustellung.teile`.
--
-- Passen die Punkte nicht in eine Nachricht, schickt der Bericht mehrere hintereinander. Die Zeile des Tages (einmal je Berichtstag und Kanal) bleibt EINE; sie
-- hält in `teile` jede Nachricht mit ihrer eigenen `nonce` und, sobald sie hinausging, ihrer Message-ID: `[{"inhalt": {…}, "messageId": null | "…"}, …]`.
-- Daran setzt ein Lauf nach einem Fehlschlag in der Mitte genau dort fort, wo der vorige aufhörte, statt die erste Nachricht ein zweites Mal zu senden.
-- `NULL` heißt: ein Bericht in einer Nachricht, wie bisher (`inhalt`, `nonce`, `message_id`); `inhalt` und `text` tragen weiter die erste Nachricht.
--
-- ERWEITERN: eine neue, wahlfreie Spalte ohne NOT NULL und ohne Prüfbedingung. Das vorige Release kennt sie nicht und braucht sie nicht; sein Rückweg liest
-- und schreibt die Zeile wie vorher. Die Spalte gehört der Umgebung wie die Tafel (`ops/production/production-to-stage.sh`, `KEEP_RE`).
-- Reihenfolge: erst diese Migration (Claudio, `migrate`), dann das Release, das `teile` schreibt.

ALTER TABLE public.discord_zustellung ADD COLUMN IF NOT EXISTS teile JSONB;

COMMENT ON COLUMN public.discord_zustellung.teile IS
    'Discord-Tagesbericht in mehreren Nachrichten (WI-0255): [{inhalt, messageId}] in der Reihenfolge des Versands; NULL bei einer Nachricht. Bleibt je Umgebung.';
