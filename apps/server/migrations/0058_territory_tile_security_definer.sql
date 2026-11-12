-- Hotfix Stage (Befund von Claudio, Handover 2026-09-30-territory-tile-recht.md): die Gebietskacheln antworteten mit 500,
-- „permission denied for function territory_band_for_zoom“ (WI-0062, Nachtrag „Rechte der Kachelfunktionen“).
--
-- 💣 Ursache. `territory_tile` und `territory_border_tile` rufen in PL/pgSQL die Hilfsfunktion `territory_band_for_zoom` auf. Eine
-- Kachelfunktion läuft mit den Rechten des AUFRUFERS, also der Kachel-Rolle (`avesmaps3d_<env>_tiles`). Das Rechtewerkzeug
-- (`avesmaps3d-db-grants`) gibt ihr EXECUTE nur auf Funktionen mit Martin-Signatur und auf Funktionen, die eine `*_render`-SICHT
-- aufruft (über `pg_depend`). Ein Aufruf INNERHALB einer PL/pgSQL-Funktion steht in keiner Abhängigkeit und wird nie gefunden. Lokal
-- fällt das nicht auf, weil Martin hier als Eigentümer verbindet.
--
-- 🪤 GEMESSEN, nicht angenommen (`tile-function-grants.test.ts`, Wegwerf-Cluster mit den Rollen des VPS): SECURITY DEFINER an der
-- HILFSFUNKTION hilft NICHT. Das Attribut ändert, mit wessen Rechten der Rumpf läuft, nicht, wer die Funktion aufrufen darf; der
-- Aufruf selbst wird gegen die Kachel-Rolle geprüft. Deshalb tragen die KACHELFUNKTIONEN das Attribut: Ihr Rumpf läuft mit den Rechten
-- der Migrations-Rolle, der Aufruf der Hilfsfunktion kommt von dort, und jede künftige Hilfsfunktion braucht kein eigenes Recht mehr.
-- (`territory_band_for_zoom` bleibt unverändert: sie liest nichts und braucht das Attribut nicht.)
--
-- Der Umfang bleibt klein: Unter den sieben Kachelfunktionen rufen nur diese beiden eine eigene Funktion auf. Die übrigen lesen
-- ausschließlich `*_render`-Relationen und PostGIS und laufen als Aufrufer weiter (Prinzip der geringsten Rechte). Dass sie nur aus
-- `*_render`-Relationen lesen, hält `render-grants.test.ts` fest; ohne diese Zusicherung wäre das Attribut nicht vertretbar.
--
-- `search_path` ist fest: eine Funktion mit den Rechten der Besitzerin darf ihre Namen nicht aus dem Pfad des Aufrufers auflösen
-- (Muster `map_domain_to_render`, Migration 0014). Additiv und wiederholbar: `ALTER FUNCTION` behält das EXECUTE-Recht der Kachel-Rolle
-- und ändert weder Rumpf noch Signatur. Keine Rolle, kein GRANT (Migrationen bleiben rollenneutral).
--
-- 🪤 Martin liest Katalog UND Kacheln beim Start: nach dem Deploy Martin neu starten, sonst liefert er bis dahin Kacheln aus dem Cache.

ALTER FUNCTION territory_tile(integer, integer, integer, json)
    SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION territory_border_tile(integer, integer, integer, json)
    SECURITY DEFINER SET search_path = public, pg_temp;
