-- 0333: `/offen` zeigt dem Melder die letzte Antwort der Redaktion (WI-0297; Vali wählte am 2026-11-09 Option B: die letzte Antwort oder Rückfrage der Redaktion in
-- `/offen`, nur für den Melder sichtbar). Wer über Discord meldet, hat weder Statuslink noch Adresse; ohne diesen Weg läse er eine Antwort nirgends.
--
-- `community_discord_offen_antworten(kennung)`: wie `community_discord_offen` (0283) die Vorgänge DIESER Kennung, dazu
--   - die letzte Nachricht an den Melder (`richtung = 'aus'`, mit Text): Antwort, Rückfrage oder Abschlussnachricht. Dieselben Nachrichten zeigt seine Statusseite
--     (`community_status_lesen`); interne Notizen liegen in einer eigenen Tafel und kommen hier nie vor;
--   - abgeschlossene Vorgänge noch 30 Tage (`COMMUNITY_DISCORD_ANTWORT_TAGE`), wenn sie eine solche Nachricht haben: Eine Anfrage, die die Redaktion mit der Antwort gleich ins
--     Archiv legt, wäre sonst aus `/offen` verschwunden, bevor er die Antwort liest.
-- 🔴 Nie Meldetext, Name, Adresse oder Kennung; die Kennung bestimmt nur, WESSEN Vorgänge es sind. Eine fremde Kennung sieht nichts davon.
--
-- 🔴 REIN ADDITIV: eine neue Funktion. `community_discord_offen` bleibt für das vorige Release. EXECUTE vergibt `community-grants.psql` an die App-Rolle.

CREATE OR REPLACE FUNCTION avesmaps_community.community_discord_offen_antworten(p_discord_id TEXT)
    RETURNS TABLE (nummer TEXT, zustand TEXT, kategorie TEXT, bezug_name TEXT, antwort TEXT, antwort_at TIMESTAMPTZ)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT avesmaps_community._com(v.id), v.zustand, v.kategorie,
           (SELECT COALESCE(b.name, b.naechster_ort) FROM avesmaps_community.bezug b WHERE b.vorgang_id = v.id ORDER BY b.id LIMIT 1),
           a.text, a.at
      FROM avesmaps_community.melder m
      JOIN avesmaps_community.vorgang v ON v.id = m.vorgang_id
      LEFT JOIN LATERAL (
          SELECT n.text, n.at FROM avesmaps_community.nachricht n
           WHERE n.vorgang_id = v.id AND n.richtung = 'aus' AND n.text IS NOT NULL
           ORDER BY n.at DESC, n.id DESC
           LIMIT 1
      ) a ON true
     WHERE p_discord_id IS NOT NULL AND m.discord_id = p_discord_id AND m.entfernt_at IS NULL AND v.papierkorb_at IS NULL
       AND (v.zustand <> 'abgeschlossen' OR (a.text IS NOT NULL AND v.abgeschlossen_at > now() - interval '30 days'))
     ORDER BY (v.zustand = 'abgeschlossen'), v.eingegangen_at DESC, v.id DESC
     LIMIT 20;
$$;

REVOKE ALL ON FUNCTION avesmaps_community.community_discord_offen_antworten(TEXT) FROM PUBLIC;
