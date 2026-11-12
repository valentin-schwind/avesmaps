-- 0294: Die Spalte `discord_routine.test_kanal` fällt (WI-0255, Testkanal abgeschafft, Vali 2026-10-26).
--
-- Das Umstellen (e2f4114ea) liest und schreibt die Spalte nicht mehr und ist auf Stage und Production; jetzt wird sie entfernt. Die Prüfung
-- `discord_routine_test_kanal_kennung` fällt mit der Spalte. `kanal_art` bleibt bestehen.

ALTER TABLE public.discord_routine DROP COLUMN IF EXISTS test_kanal;
