"""Stufe 2 der Optimierung: günstige Suche bei 1× (WI-0250 Phase A4): quasizufällige Stichprobe, Successive Halving, lokale Verfeinerung.

Derivatefrei und aus SciPy gebaut (``scipy.stats.qmc``, kein Optuna):

1. **Stichprobe.** ``kandidaten`` Punkte einer verwürfelten Sobol-Folge im Raum der wirksamen Parameter (Stufe 1), dazu die Vorgabe des Typs.
2. **Successive Halving** mit Faktor ``eta``: Erste Runde alle Kandidaten mit der ersten Saat, danach nur das beste Drittel mit einer weiteren Saat, und
   so weiter, bis die letzten Überlebenden alle ``saaten`` der Suche gerechnet haben. Wer das Formtor verfehlt, scheidet zuerst aus.
3. **Verfeinerung** (1 + λ)-Evolutionsstrategie um den Besten: ``nachkommen`` Nachbarn mit normalverteilter Störung im Einheitsraum (Schritt halbiert je
   Runde), Wahlparameter kippen selten; ein Nachkomme ersetzt den Besten nur, wenn er das Formtor hält und den Abstand um mehr als das Rauschen senkt.

Alles ist **deterministisch** (Seeds aus dem Profil); ein Abbruch kostet nur die laufende Rechnung, weil jede Messung gespeichert ist und ``fortsetzen``
dieselben Messungen noch einmal plant und die gespeicherten überspringt.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Sequence

import numpy as np

from .auswerter import Auswerter
from .raum import WAHL, Raum, sobol
from .ranking import TOLERANZ, Bewertet, bewerte, ordne


def sobol_kandidaten(raum: Raum, aktiv: Sequence[str], anzahl: int, seed: int, fest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Die Kandidaten einer Sobol-Stichprobe im Raum der ``aktiv``en Parameter (ohne doppelte); ``fest`` setzt weitere Parameter fest."""
    punkte = sobol(len(aktiv), anzahl, seed)
    gesehen: set[str] = set()
    aus: list[dict[str, Any]] = []
    for p in punkte:
        k = raum.kandidat(p, list(aktiv), fest)
        s = Raum.schluessel(k)
        if s not in gesehen:
            gesehen.add(s)
            aus.append(k)
    return aus


def halbiere(
    aus: Auswerter, typ: str, kandidaten: Sequence[dict[str, Any]], saaten: Sequence[int | None], basis_je_saaten: Callable[[Sequence[int | None]], dict[str, Any]], eta: int,
    tor_faktor: float, *, variante: str = "gezeichnet", herkunft: str = "sobol", melde: Callable[[str], None] = lambda t: None,
) -> list[Bewertet]:
    """Successive Halving über die Saaten. Gibt die Überlebenden der letzten Runde geordnet zurück (mit allen ``saaten`` gerechnet)."""
    lebend = list(kandidaten)
    ergebnis: list[Bewertet] = []
    for runde in range(len(saaten)):
        benutzt = list(saaten[: runde + 1])
        basis = basis_je_saaten(benutzt)
        bewertet = [bewerte(aus, typ, k, benutzt, basis, tor_faktor, variante=variante, herkunft=herkunft) for k in lebend]
        ergebnis = ordne(bewertet)
        melde(f"  Runde {runde + 1}/{len(saaten)}: {len(lebend)} Kandidaten mit {len(benutzt)} Saat(en); Formtor gehalten {sum(b.tor_ok for b in ergebnis)}, "
              f"bester Abstand {ergebnis[0].d1 if ergebnis and ergebnis[0].d1 is not None else float('nan'):.4f}")
        if runde == len(saaten) - 1:
            break
        behalten = max(2, int(math.ceil(len(lebend) / eta)))
        lebend = [b.kandidat for b in ergebnis[:behalten]]
    return ergebnis


def verfeinere(
    aus: Auswerter, typ: str, raum: Raum, aktiv: Sequence[str], start: Bewertet, saaten: Sequence[int | None], basis: dict[str, Any], tor_faktor: float, runden: int,
    nachkommen: int, schritt: float, seed: int, *, fest: dict[str, Any] | None = None, variante: str = "gezeichnet", melde: Callable[[str], None] = lambda t: None,
) -> tuple[Bewertet, list[Bewertet]]:
    """(1 + λ)-Evolutionsstrategie um ``start``. Gibt den besten und alle bewerteten Nachkommen zurück."""
    rng = np.random.default_rng(seed)
    bester = start
    alle: list[Bewertet] = []
    sigma = schritt
    namen = list(aktiv)
    for runde in range(runden):
        eltern = np.asarray(raum.einheiten_von(bester.kandidat, namen), dtype=np.float64)
        neue: list[Bewertet] = []
        gesehen = {bester.schluessel}
        for _ in range(nachkommen):
            u = np.clip(eltern + rng.normal(0.0, sigma, size=len(namen)), 0.0, 1.0)
            for i, n in enumerate(namen):
                if raum[n].art == WAHL and rng.random() < 0.15:
                    u[i] = 1.0 - eltern[i]  # Wahl kippen
            kand = raum.kandidat(u, namen, fest)
            s = Raum.schluessel(kand, variante)
            if s in gesehen:
                continue
            gesehen.add(s)
            neue.append(bewerte(aus, typ, kand, saaten, basis, tor_faktor, variante=variante, herkunft="verfeinerung"))
        alle += neue
        gut = [b for b in neue if b.tor_ok and b.d1 is not None]
        if gut:
            kandidat = min(gut, key=lambda b: b.d1 if b.d1 is not None else math.inf)
            if bester.d1 is None or not bester.tor_ok or (kandidat.d1 is not None and kandidat.d1 < bester.d1 - TOLERANZ[0]):
                melde(f"  Verfeinerung {runde + 1}/{runden}: Abstand {bester.d1} → {kandidat.d1}")
                bester = kandidat
            else:
                melde(f"  Verfeinerung {runde + 1}/{runden}: kein Nachkomme besser als {bester.d1:.4f}")
        sigma = max(sigma / 2.0, 0.02)
    return bester, alle
