-- Die Freigabe der Kenngrößen der Wegfindung (WI-0153 Schnitt 6; Betreiber 2026-10-15: „dann weiß ich dass ich das
-- wegenetz neu berechnen muss fertig - schau dass es in der warteschlange landet").
--
-- 🔴 **In die Routing-Revision geht nicht, was gespeichert ist, sondern was FREIGEGEBEN ist.** Vorher las der achte
-- Revisionsteil (0132) die Tafel der verstellten Werte selbst. Das wirkte: Jeder Routing-Worker prüft die Revision alle
-- 5 s und lud von allein nach — die Leiste behauptete „noch nicht gerechnet", während längst gerechnet war, und der
-- Knopf war Zierde. Seit dieser Migration hält `routing_setting_applied` den freigegebenen Stand, und nur der Knopf
-- schreibt ihn fort. „Gilt erst nach dem Neuberechnen" heißt damit genau das.
--
-- 🪤 Der Trigger auf `routing_setting` (0132) bleibt, wie er ist: Er hebt `routing_setting_state.revision`, und die ist
-- die `baseRevision` der Oberfläche gegen gleichzeitiges Verstellen (409 `edit_conflict`). Mit der Routing-Revision hat
-- sie seit hier nichts mehr zu tun.
--
-- 🔴 REIN ADDITIV: eine neue Tafel, vier neue Spalten (alle nullbar). Das vorige Release liest die Tafel nicht; sein
-- Revisionsteil liest `routing_setting` und sieht denselben Stand wie bisher. Rechte: `system-grants.psql`.

-- 1. DER FREIGEGEBENE STAND ------------------------------------------------------------------------------------------
--
-- Eine Kopie der verstellten Werte zum Zeitpunkt der Freigabe. Nur was hier steht, rechnet das Routing; alles andere ist
-- die Vorgabe aus dem Register. Leer heißt: Es gilt jede Vorgabe — der Zustand, in dem sich nichts geändert hat.
CREATE TABLE IF NOT EXISTS routing_setting_applied (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][A-Za-z0-9]{0,59}$'),
    value DOUBLE PRECISION NOT NULL CHECK (value > 0 AND value < 'Infinity'::double precision),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE routing_setting_applied IS
    'Freigegebene Kenngrößen der Wegfindung (WI-0153 Schnitt 6): der Stand, mit dem das Routing rechnet; nur der Knopf schreibt ihn.';

-- 2. WER WANN FREIGEGEBEN HAT ----------------------------------------------------------------------------------------
--
-- Für die Leiste über den Panelen: „Zuletzt gerechnet: … · Auftrag OPS-…“. Die Person steht wie überall ohne
-- Fremdschlüssel ins geschützte Schema; die Kommandozeile trägt nur ihr Etikett.
ALTER TABLE routing_setting_state ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE routing_setting_state ADD COLUMN IF NOT EXISTS applied_by UUID;
ALTER TABLE routing_setting_state ADD COLUMN IF NOT EXISTS applied_by_label TEXT;
-- Der eingereihte `routing_reload` (`job.public_id`): Die Leiste zeigt seinen Zustand, statt einen eigenen zu erfinden.
ALTER TABLE routing_setting_state ADD COLUMN IF NOT EXISTS applied_job UUID;
COMMENT ON COLUMN routing_setting_state.applied_job IS
    'Der zuletzt eingereihte routing_reload (WI-0153): die Leiste liest seinen Zustand aus der Warteschlange.';
