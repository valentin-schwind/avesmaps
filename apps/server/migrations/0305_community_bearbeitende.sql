-- 0305: Die Empfänger der Community-Glocke über eine Funktion der Migrationsrolle (WI-0268; Befund aus WI-0278, 2026-11-03).
--
-- Aufträge laufen in der Jobs-Rolle, und die hat an `avesmaps_auth` kein Recht. `bearbeitende()` in `community/glocke.ts` las `person` und `person_access` direkt; im Abrufjob warf das 42501: Die Mail lag im Eingang,
-- die Glocke blieb still. Dasselbe traf die Fristen ohne Zuständigkeit und die nicht zugestellte Mail ohne bekannte Person. Die Lösung folgt `benachrichtige` und `benachrichtigung_einreihen`: Die Jobs-Rolle bekommt
-- kein Tafelrecht, sondern genau diese eine Frage. Die Funktion liest auch die Sonderrollen, ohne dass `auth-grants.psql` (nur über den Betreiber) etwas braucht.
--
-- Rollen und Sonderrollen kommen als Liste, denn der Katalog der Rechte steht in `packages/shared`, nicht in der Datenbank. 🔴 Die Funktion gibt nur Kennungen heraus, nie Namen, Adressen oder Rollen.
--
-- 🔴 ADDITIV: eine neue Funktion, das vorige Release ruft sie nie. EXECUTE vergibt `community-grants.psql` an App und Jobs; bis dahin liest `bearbeitende()` wie bisher direkt (`has_function_privilege`).

CREATE OR REPLACE FUNCTION avesmaps_community.community_bearbeitende(p_environment TEXT, p_rollen TEXT[], p_sonderrollen TEXT[])
    RETURNS SETOF UUID
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
    SELECT p.id
      FROM avesmaps_auth.person p
      JOIN avesmaps_auth.person_access a ON a.person_id = p.id AND a.environment = p_environment
     WHERE p.status = 'active' AND a.status = 'active'
       AND (a.role = ANY(p_rollen)
            OR EXISTS (SELECT 1 FROM avesmaps_auth.sonderrolle_zuteilung z
                        WHERE z.person_id = p.id AND z.environment = a.environment AND z.revoked_at IS NULL
                          AND z.sonderrolle = ANY(p_sonderrollen)))
     ORDER BY p.id;
$$;

COMMENT ON FUNCTION avesmaps_community.community_bearbeitende(TEXT, TEXT[], TEXT[]) IS
    'Empfaenger der Community-Glocke (WI-0268): aktive Personen dieser Umgebung mit einer der Rollen oder einer aktiven der Sonderrollen. Nur Kennungen; EXECUTE nur App und Jobs (community-grants.psql).';

REVOKE ALL ON FUNCTION avesmaps_community.community_bearbeitende(TEXT, TEXT[], TEXT[]) FROM PUBLIC;
