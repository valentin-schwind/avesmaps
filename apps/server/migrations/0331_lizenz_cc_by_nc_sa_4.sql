-- CC BY-NC-SA 4.0 im Lizenzkatalog (OPS-000102, Nottel im Media Inspector: „Ich brauche als weitere Lizenz bei Bildern "CC BY-NC-SA 4.0".
-- Wir haben nur Version 3.0 davon zur Auswahl.“; Betreiber 2026-11-09 wählte auf die Frage „Soll CC BY-NC-SA 4.0 in den
-- Lizenzkatalog?“ die Option „Ja, aufnehmen“, Knopftext von Claudia, kein Zitat).
--
-- Dieselben Pflichten wie 3.0: Namensnennung, Weitergabe unter gleichen Bedingungen, nicht kommerziell. Dieselbe Familie `cc-by-nc-sa`:
-- Bezeichnung in allen Sprachen und Inhaltsschalter `media.license.cc-by-nc-sa` gelten schon, und eine Veröffentlichungsregel kennt die
-- Version nicht (`media/policy.ts` liest nur die Pflichten). 0331 statt 0330: Die 0330 hat WI-0295 belegt.
--
-- Erweitern, nicht umstellen: Das vorige Release liest den Katalog als Liste und kennt keine festen Schlüssel.
INSERT INTO license_catalog (key, display_name, canonical_uri, requires_attribution, share_alike, non_commercial, family)
VALUES ('cc-by-nc-sa-4.0', 'CC BY-NC-SA 4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/', TRUE, TRUE, TRUE, 'cc-by-nc-sa')
ON CONFLICT (key) DO NOTHING;
