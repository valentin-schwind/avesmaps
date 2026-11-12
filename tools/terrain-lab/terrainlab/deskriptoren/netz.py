"""Gemeinsame Netzmaße für Kamm- und Gerinnenetze sowie Querprofile zur nächsten Netzzelle."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from .fliess import Fliessnetz, strahler
from .kern import zahl
from .kontext import Kontext


def schwellen_name(schwelle_m2: float) -> str:
    return f"a{zahl(schwelle_m2 / 1e6)}km2"


def netz_maske(ctx: Kontext, fn: Fliessnetz, schwelle_m2: float) -> np.ndarray:
    """Zellen, deren Einzugsfläche die Schwelle erreicht. Flussabwärts abgeschlossen, weil die Fläche nach unten nur wächst."""
    return fn.gueltig & (fn.akkumulation >= ctx.netz_zellen(schwelle_m2))


def netz_metriken(ctx: Kontext, fn: Fliessnetz, praefix: str, titel: str, gruppe: str, kosten: str) -> None:
    """Dichte, Quellen, Zusammenflüsse, Strahler-Ordnung und Bifurkationsverhältnis für jede Netzschwelle."""
    s = ctx.sammler
    flaeche = ctx.flaeche_km2
    for schwelle in ctx.parameter.netz_schwellen_m2:
        netz = netz_maske(ctx, fn, schwelle)
        n = schwellen_name(schwelle)
        zusatz = f"Einzugsfläche ≥ {zahl(schwelle / 1e6)} km² (mindestens {ctx.parameter.min_netz_zellen} Zellen)"
        laenge_km = float(fn.schritt[netz].sum()) * ctx.dx / 1000.0
        s.skalar(f"{praefix}_dichte_{n}", laenge_km / flaeche, "km/km²", gruppe, "raeumlich", kosten, f"Länge des {titel}netzes je Fläche ({zusatz}); Länge aus D8-Schritten, Senkensprünge zählen nicht")
        if not netz.any():
            s.uebersprungen(f"{praefix}_{n}: kein Netz über der Schwelle")
            continue
        ziel = fn.ziel
        ein = np.bincount(ziel[netz & (ziel >= 0)], minlength=ziel.size)
        quellen = int((netz & (ein == 0)).sum())
        zuflusse = int(np.maximum(ein[netz] - 1, 0).sum())
        s.skalar(f"{praefix}_quellen_dichte_{n}", quellen / flaeche, "1/km²", gruppe, "raeumlich", kosten, f"Quellen des {titel}netzes je Fläche ({zusatz})")
        s.skalar(f"{praefix}_zusammenfluesse_dichte_{n}", zuflusse / flaeche, "1/km²", gruppe, "raeumlich", kosten, f"Zusammenflüsse (Zuflüsse minus 1) des {titel}netzes je Fläche ({zusatz})")
        ordnung, hoechste, _ = strahler(ziel, fn.ebenen, netz)
        o = ordnung[netz]
        o_max = int(o.max())
        s.skalar(f"{praefix}_strahler_max_{n}", o_max, "1", gruppe, "raeumlich", kosten, f"höchste Strahler-Ordnung des {titel}netzes ({zusatz})")
        kopf = netz & (hoechste != ordnung)  # Kopf eines Abschnitts: Quelle oder Zusammenfluss, der die Ordnung erhöht
        zahlen = np.bincount(ordnung[kopf], minlength=o_max + 1)[1:]
        pos = np.flatnonzero(zahlen > 0)
        if pos.size >= 2:
            steigung = np.polyfit(pos + 1.0, np.log(zahlen[pos].astype(np.float64)), 1)[0]
            s.skalar(f"{praefix}_bifurkation_{n}", float(np.exp(-steigung)), "1", gruppe, "relativ", kosten, f"Bifurkationsverhältnis des {titel}netzes (Abnahme der Abschnittszahl je Ordnung, Regression; {zusatz})")
        else:
            s.uebersprungen(f"{praefix}_bifurkation_{n}: weniger als zwei Ordnungen")


@dataclass
class Achsenabstand:
    abstand_m: np.ndarray  # (h, b) Abstand zur nächsten Achsenzelle in Metern
    z_achse: np.ndarray  # (h, b) Höhe dieser Achsenzelle


def achsenabstand(ctx: Kontext, achse: np.ndarray) -> Achsenabstand | None:
    """Euklidischer Abstand jeder Zelle zur nächsten Zelle von ``achse`` und deren Höhe (Distanztransformation)."""
    if not achse.any():
        return None
    abstand, idx = ndimage.distance_transform_edt(~achse, sampling=ctx.dx, return_indices=True)
    return Achsenabstand(abstand, ctx.z[idx[0], idx[1]])


def querprofil(ctx: Kontext, a: Achsenabstand, abstaende_m: tuple[float, ...], vorzeichen: int) -> tuple[np.ndarray, np.ndarray]:
    """Mittlerer Höhenunterschied ``vorzeichen * (z_achse - z)`` für Zellen im Abstandsband 0,8 d bis 1,2 d. Kamm: vorzeichen +1
    (Achse liegt höher), Gerinne: -1 (Achse liegt tiefer, Ergebnis = Anstieg). Gibt (mittlerer Abstand, mittlerer Unterschied) je d zurück."""
    diff = vorzeichen * (a.z_achse - ctx.z)
    xs, ys = [], []
    for d in abstaende_m:
        sel = (a.abstand_m >= 0.8 * d) & (a.abstand_m <= 1.2 * d) & np.isfinite(diff)
        if sel.sum() < 10:
            xs.append(np.nan)
            ys.append(np.nan)
        else:
            xs.append(float(a.abstand_m[sel].mean()))
            ys.append(float(diff[sel].mean()))
    return np.array(xs), np.array(ys)
