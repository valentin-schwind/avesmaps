"""Bewertung erzeugter Gebirge in drei getrennten Dimensionen (WI-0250 Phase A4). Dokumentation: ``docs/optimierung.md``.

1. **Plausibilität** (``plausibilitaet``): Deskriptoren-Vergleich gegen reale Referenzausschnitte desselben Typs im selben Maßstab, getrennt nach
   absoluten, relativen, verteilungsbasierten und räumlichen Kennzahlen; Rollen Optimierung und Validierung strikt getrennt.
2. **Formerhalt** (``formerhalt``): gezeichnete Gipfel, Nebengipfel, Kämme und Täler der Gebirgsdatei gegen das Ergebnis, mit hartem Formtor.
3. **Effizienz** (``effizienz``): Laufzeit, Arbeitsspeicher, Zellzahl.

Ein Gesamtwert wird nicht gebildet; ``pareto`` ordnet Kandidaten nach mehreren Zielen.
"""

from __future__ import annotations

from .effizienz import effizienz
from .formerhalt import KOMPONENTEN, TOR_FAKTOR, FormFehler, Geometrie, bewerte_form, lade_geometrie, mittel_komponenten, pruefe_tor
from .kandidat import Bewerter, Kontext, fasse_saaten
from .pareto import dominiert, front, pareto_raenge
from .plausibilitaet import ARTEN, Einstellungen, ReferenzSatz, bewerte_plausibilitaet, stufe_fuer_zellgroesse

__all__ = [
    "ARTEN",
    "KOMPONENTEN",
    "TOR_FAKTOR",
    "Bewerter",
    "Einstellungen",
    "FormFehler",
    "Geometrie",
    "Kontext",
    "ReferenzSatz",
    "bewerte_form",
    "bewerte_plausibilitaet",
    "dominiert",
    "effizienz",
    "fasse_saaten",
    "front",
    "lade_geometrie",
    "mittel_komponenten",
    "pareto_raenge",
    "pruefe_tor",
    "stufe_fuer_zellgroesse",
]
