"""Gestufte, fortsetzbare Optimierung der Typwerte des Generators (WI-0250 Phase A4). Dokumentation: ``docs/optimierung.md``.

Stufen: Sensitivität (Morris) → günstige Suche bei 1× (Sobol, Successive Halving, lokale Verfeinerung) → Validierung bei 2×/4× gegen andere reale Gebirge →
Strategievergleich → (optional) Endgelände. Dauerhaft in SQLite (``speicher``), Rasterergebnisse im Zwischenspeicher der Läufe, Ergebnis eine Vorschlagsdatei.
"""

from __future__ import annotations

from .lauf import EXIT_GESTOPPT, STUFEN, Lauf
from .profil import Profil, ProfilFehler, lade_profil, parse_profil
from .raum import Raum

__all__ = ["EXIT_GESTOPPT", "STUFEN", "Lauf", "Profil", "ProfilFehler", "Raum", "lade_profil", "parse_profil"]
