"""Kandidaten bewerten und ordnen (WI-0250 Phase A4): Saaten zusammenfassen, Formtor prüfen, nach Pareto-Rang ordnen.

Die Ordnung ist **kein Gesamtwert**: Wer das Formtor verfehlt, steht hinter allen, die es halten. Unter diesen zählt der Pareto-Rang über
(Abstand zur Referenz, Formverlust); Unterschiede unter dem Messrauschen (``TOLERANZ``) gelten als gleich. Zuletzt entscheidet der Abstand.
Die Zeit ist ein drittes Ziel der Auswertung (``front``), nicht der Ordnung der Suche: Bei gleicher Auflösung unterscheidet sie sich kaum.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

from terrainlab.bewertung import fasse_saaten, pareto_raenge, pruefe_tor
from terrainlab.bewertung.formerhalt import KOMPONENTEN

from .auswerter import Auswerter
from .raum import Raum

#: Unterschiede darunter gelten als gleich: Abstand (Leitwert 0 bis 1), Formverlust (1 − Leitwert), Zeit (Sekunden).
TOLERANZ = (0.002, 0.01, 0.5)


@dataclass
class Bewertet:
    kandidat: dict[str, Any]
    schluessel: str
    saaten: list[int | None]
    fasse: dict[str, Any]
    tor_ok: bool
    verstoesse: list[str]
    d1: float | None
    form_verlust: float | None
    zeit_s: float | None
    rang: int = 0
    herkunft: str = ""
    fehlend: int = 0
    extra: dict[str, Any] = field(default_factory=dict)

    def ziele(self) -> tuple[float, float, float]:
        nan = math.nan
        return (self.d1 if self.d1 is not None else nan, self.form_verlust if self.form_verlust is not None else nan, self.zeit_s if self.zeit_s is not None else nan)

    def als_dict(self) -> dict[str, Any]:
        return {"kandidat": self.kandidat, "schluessel": self.schluessel, "saaten": self.saaten, "d1": self.d1, "form_verlust": self.form_verlust, "zeit_s": self.zeit_s,
                "tor_ok": self.tor_ok, "verstoesse": self.verstoesse, "rang": self.rang, "herkunft": self.herkunft, "fehlend": self.fehlend,
                "fasse": {k: self.fasse[k] for k in ("saaten", "d1", "d1_arten", "form", "komponenten", "wall_ms", "rss_mib", "zellen")}}


def messungen(aus: Auswerter, typ: str, kandidat: dict[str, Any], saaten: Sequence[int | None], aufloesung: int = 1, rolle: str = "optimierung", variante: str = "gezeichnet",
              herkunft: str = "") -> list[dict[str, Any]]:
    """Die gelungenen Messungen eines Kandidaten über die Saaten (eine fehlgeschlagene Rechnung fehlt)."""
    aus_liste = [aus.messe(typ, kandidat, aufloesung, s, rolle=rolle, variante=variante, herkunft=herkunft) for s in saaten]
    return [m for m in aus_liste if m is not None]


def bewerte(
    aus: Auswerter, typ: str, kandidat: dict[str, Any], saaten: Sequence[int | None], basis: dict[str, Any] | None, tor_faktor: float, *, aufloesung: int = 1,
    rolle: str = "optimierung", variante: str = "gezeichnet", herkunft: str = "",
) -> Bewertet:
    """Ein Kandidat über mehrere Saaten, geprüft gegen die Vorgabe (``basis``, deren Zusammenfassung am selben Maßstab und denselben Saaten)."""
    ms = messungen(aus, typ, kandidat, saaten, aufloesung, rolle, variante, herkunft)
    schluessel = Raum.schluessel(kandidat, variante)
    if not ms:
        return Bewertet(kandidat, schluessel, list(saaten), {}, False, ["keine gelungene Messung"], None, None, None, herkunft=herkunft, fehlend=len(saaten))
    f = fasse_saaten(ms)
    d1 = f["d1"]["mittel"]
    form = f["form"]["mittel"]
    verstoesse: list[str] = []
    ok = True
    if len(ms) < len(saaten):
        ok, verstoesse = False, [f"{len(saaten) - len(ms)} von {len(saaten)} Saaten ohne Ergebnis"]
    if d1 is None:
        ok = False
        verstoesse.append("kein Abstand zur Referenz (Maßstab oder Fläche)")
    if basis is not None:
        tor, v = pruefe_tor(f["komponenten"], basis["komponenten"], tor_faktor)
        ok = ok and tor
        verstoesse += v
    zeit = f["wall_ms"]["mittel"]
    return Bewertet(kandidat, schluessel, list(saaten), f, ok, verstoesse, d1, None if form is None else 1.0 - form, None if zeit is None else zeit / 1000.0, herkunft=herkunft,
                    fehlend=len(saaten) - len(ms))


def ordne(liste: Sequence[Bewertet], mit_zeit: bool = False) -> list[Bewertet]:
    """Besten zuerst: erst wer das Formtor hält, darunter Pareto-Rang über (Abstand, Formverlust[, Zeit]), dann der Abstand. Setzt ``rang``."""
    gut = [b for b in liste if b.tor_ok and b.d1 is not None]
    schlecht = [b for b in liste if not (b.tor_ok and b.d1 is not None)]
    n = 3 if mit_zeit else 2
    raenge = pareto_raenge([b.ziele()[:n] for b in gut], TOLERANZ[:n]) if gut else []
    for b, r in zip(gut, raenge):
        b.rang = r
    gut.sort(key=lambda b: (b.rang, b.d1 if b.d1 is not None else math.inf, b.form_verlust if b.form_verlust is not None else math.inf))
    # Wer das Tor verfehlt, hat keinen Rang: hinten, nach Abstand.
    for b in schlecht:
        b.rang = 10_000
    schlecht.sort(key=lambda b: (b.d1 if b.d1 is not None else math.inf, len(b.verstoesse)))
    return gut + schlecht


def vorgabe_zusammenfassung(aus: Auswerter, typ: str, saaten: Sequence[int | None], aufloesung: int = 1, rolle: str = "optimierung", variante: str = "gezeichnet") -> dict[str, Any]:
    """Die Vorgabe des Typs (kein Kandidat verändert etwas) als Bezug für das Formtor."""
    ms = messungen(aus, typ, {}, saaten, aufloesung, rolle, variante, "vorgabe")
    if not ms:
        raise RuntimeError(f"Die Vorgabe von {typ} lässt sich nicht rechnen ({aufloesung}x, {rolle})")
    f = fasse_saaten(ms)
    f["komponenten"] = {k: f["komponenten"].get(k) for k in KOMPONENTEN}
    return f
