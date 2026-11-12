-- Die Kenngrößen der Wegfindung in der Systemsteuerung (WI-0153, Bauplan §9 Schnitt 2; Betreiber 2026-10-15: „die konstanten
-- sollten ebenfalls änderbar sein (gerne mit passkey)“).
--
-- 🔴 REIN ADDITIV: zwei neue Tafeln, eine neue Funktion, ihr Trigger. Keine bestehende Spalte, kein bestehender Trigger wird
-- angefasst, und das vorige Release liest keine der beiden Tafeln: Ohne Zeile gilt die Zahl aus dem Quelltext wie bisher. Rechte:
-- `apps/server/src/db/system-grants.psql` (hinter JEDE Migration).

-- 1. DIE ABWEICHUNGEN -----------------------------------------------------------------------------------------------------------
--
-- 🔴 Nur was verstellt ist. Alles andere ist die Vorgabe aus dem Register `packages/shared/src/wegfindung.ts`, und das Register
-- ist mit den Konstanten im Routing geprüft (`apps/server/test/wegfindung-vorgaben.test.ts`). Zurücksetzen LÖSCHT die Zeile; eine
-- gespeicherte Zahl, die heute zufällig der Vorgabe gleicht, verdeckte sonst eine spätere Änderung im Code — anders als bei den
-- Inhaltsschaltern (0102), wo „an“ ein Zustand ist und die Zeile mit Zeit und Person stehen bleiben darf.
--
-- Die Kennung ist der Name der Konstante in der Schreibweise des Registers (`endSnap`, `seaCellUnits`), nicht der Name im Code.
-- Ein Schlüssel, den das Register nicht kennt, wird beim Lesen übergangen und gemeldet (`unknownKeys`), wie bei 0102.
CREATE TABLE IF NOT EXISTS routing_setting (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9]{0,59}$'),
    -- Doppelte Genauigkeit, weil die Werte von 0,0005 Karteneinheiten bis 1.500.000 Rasterzellen reichen. Die Grenzen je Wert
    -- leitet der Schreibweg aus der Vorgabe ab (ein Zehntel bis das Zehnfache, `wegfindungGrenzen`); endlich und positiv steht
    -- hier als Zusicherung der Tafel, damit auch die Kommandozeile oder eine Hand am SQL keinen Unsinn ablegen kann.
    value DOUBLE PRECISION NOT NULL CHECK (value > 0 AND value < 'Infinity'::double precision),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Die Person (`avesmaps_auth.person.id`), ohne Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
    changed_by UUID,
    changed_by_label TEXT
);
COMMENT ON TABLE routing_setting IS
    'Verstellte Kenngrößen der Wegfindung je Umgebung (WI-0153): nur Abweichungen; der Rest ist die Vorgabe im Register.';

-- 2. DIE REVISION ---------------------------------------------------------------------------------------------------------------
--
-- Eine Zeile, ein Zähler: die Revision der GANZEN Tafel. Sie ist die `baseRevision` des Schreibwegs — wer einen veralteten Stand
-- vor sich hat, bekommt 409 `edit_conflict`, wie beim Betriebszustand und den Inhaltsschaltern.
--
-- 🔴 Eigene Tafel, NICHT `system_state.routing_revision`. Der Bauplan nennt `system_state.content_revision` als Vorbild, und das
-- ist sie der Form nach auch; eine Spalte dort hätte aber drei Nachteile: Sie verlangte eine neue Fassung des Triggers
-- `system_state_revision` (0087, erweitert in 0102) mitten in einem Release, in dem eine zweite Migration an derselben Zeile
-- arbeitet; ein Verstellen der Wegfindung ist keine Umschaltung des Betriebszustands und soll dessen `revision` nicht anfassen;
-- und der Weckruf `avesmaps_system_changed` trägt einen Wert, den heute niemand im Speicher hält. Der Routing-Worker liest seine
-- Datenrevision ohnehin im Takt (Schnitt 5, `routing/revision.ts`), nicht über ein NOTIFY.
CREATE TABLE IF NOT EXISTS routing_setting_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE routing_setting_state IS
    'Revision der Wegfindungseinstellungen (WI-0153): Grundlage für baseRevision; hebt sich bei jeder Änderung an routing_setting.';

-- Die Zeile legt allein die Migration an; ein zweiter Lauf ändert nichts.
INSERT INTO routing_setting_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Jede geänderte Zeile hebt die Revision einmal (ein UPDATE ohne Treffer hebt nichts). Als Besitzerin mit festem `search_path`,
-- wie jede Funktion, die eine Basistabelle schreibt (`render-grants.test.ts`); aufrufen kann sie nur der Trigger. Fehlt die
-- Zustandszeile, legt der Trigger sie an, statt still nichts zu tun — eine Revision, die stehen bleibt, machte jeden weiteren
-- Schreibweg zum stillen Konflikt.
CREATE OR REPLACE FUNCTION public.routing_setting_bump() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO routing_setting_state (id, revision, updated_at) VALUES (1, 2, now())
    ON CONFLICT (id) DO UPDATE SET revision = routing_setting_state.revision + 1, updated_at = now();
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.routing_setting_bump() IS
    'WI-0153: hebt routing_setting_state.revision bei jeder Änderung an routing_setting.';

CREATE OR REPLACE TRIGGER routing_setting_bump AFTER INSERT OR UPDATE OR DELETE ON routing_setting
    FOR EACH ROW EXECUTE FUNCTION public.routing_setting_bump();
