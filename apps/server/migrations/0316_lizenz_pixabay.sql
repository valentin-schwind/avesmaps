-- Die Pixabay Content License im Lizenzkatalog (WI-0282, Betreiber 2026-11-06 auf die Frage „Soll ich die Pixabay-Lizenz in den
-- Lizenzkatalog aufnehmen?“: „Ja, aufnehmen“). Anlass: Ein Editor trug ein Bild von Pixabay als „Public Domain“ ein, weil es die eigene
-- Lizenz nicht zur Wahl gab. Pixabay vergibt sie seit Januar 2019 statt CC0.
--
-- Keine Pflicht zur Namensnennung, keine Weitergabe unter gleichen Bedingungen, kommerzielle Nutzung erlaubt. Eine eigene Familie: Der
-- Inhaltsschalter `media.license.pixabay` schaltet sie für sich ab, ohne CC0 oder Public Domain zu berühren. Die Verbote der Lizenz
-- (vor allem keine Weitergabe der unveränderten Datei als eigenes Produkt) regelt kein Feld im Katalog.
--
-- Erweitern, nicht umstellen: Das vorige Release liest den Katalog als Liste und kennt keine festen Schlüssel.
INSERT INTO license_catalog (key, display_name, canonical_uri, requires_attribution, share_alike, non_commercial, family)
VALUES ('pixabay', 'Pixabay Content License', 'https://pixabay.com/service/license-summary/', FALSE, FALSE, FALSE, 'pixabay')
ON CONFLICT (key) DO NOTHING;
