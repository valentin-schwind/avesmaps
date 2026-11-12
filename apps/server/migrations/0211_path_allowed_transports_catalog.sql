-- 0211: Der Prüfwert von `path.allowed_transports` kennt den ganzen Katalog der Reisemittel (WI-0177; Stage-Fund Claudio
-- 2026-10-19 23:41, `project-control/handovers/2026-10-19-stage-fehler-wege-reisemittel-und-gelaende-jsonb-an-claudia.md` §1).
--
-- 0033 ließ nur Legacys elf Mittel zu. Seit WI-0069 kennt das Reisemodell (`packages/shared/src/travel-model/aventuria.json`,
-- `transportmittel`) auch Karren, Fuhrwerk, Schlitten, Flussgaleere, Ruderboot und Kurierdromone. Seit 0208 schreibt das Wege-Fenster
-- die Liste aus, wie die Wegfindung sie rechnet, also samt geerbter Karren und Fuhrwerk: „Fertig“ scheiterte mit 23514 (500).
--
-- 🔴 ADDITIV: Die Regel wird nur weiter; jede gespeicherte Liste besteht sie, und das vorige Release schreibt nur die alten Mittel.
-- Der Name bleibt (`path_allowed_transports_check`). Ein neues Reisemittel im Modell braucht hier eine neue Migration; der Prüffall
-- in `apps/server/test/editor-path-update.test.ts` vergleicht die Regel mit dem Katalog.

ALTER TABLE path DROP CONSTRAINT IF EXISTS path_allowed_transports_check;

ALTER TABLE path ADD CONSTRAINT path_allowed_transports_check CHECK (
    allowed_transports IS NULL OR allowed_transports <@ ARRAY[
        'caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider',
        'riverSailer', 'riverBarge', 'cargoShip', 'fastShip', 'galley',
        'cart', 'wagon', 'sleigh', 'riverGalley', 'rowboat', 'courierDromone'
    ]::TEXT[]
);
