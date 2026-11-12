"""Vergleich zweier Commits (WI-0250 Phase B): dieselben Fälle an Commit A und B, je Kennzahl Verbesserung oder Regression.

Beide Commits laufen über ``laufe_qualitaet`` (Zwischenspeicher: was schon gerechnet ist, wird nicht wiederholt). Verglichen wird je Fall:

- **Einzelwerte** (``Metrik``): Differenz und relative Änderung B gegen A.
- **Verteilungen**: normierter Wasserstein-Abstand zwischen A und B (wie stark hat sich die Verteilung verschoben).
- **Reihen** (Spektrum, Querprofile): mittlerer Abstand zwischen A und B.

**Bewertung.** Ob eine Änderung besser oder schlechter ist, sagt nicht die Zahl, sondern ein Maßstab, und den gibt es nur, wo er benannt ist:

1. ``ziele`` der Konfiguration (je Metrikname oder -familie): ``{"richtung": "hoeher"|"niedriger"}`` oder ``{"ziel": x}``, optional mit ``toleranz``.
2. Die Referenz des Falls (``referenz``, ein Referenzraster gleicher Zellgröße): Näher an der Referenz ist besser (Einzelwert, Wasserstein-Abstand
   der Verteilung, Reihenabstand).
3. Sonst ``unbewertet``: Die Änderung wird gemeldet, aber nicht als gut oder schlecht gedeutet.

Ein Gesamtwert wird nicht gebildet; die Zusammenfassung zählt je Urteil.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from terrainlab.deskriptoren import MassstabFehler, Metrikvektor, familie, vergleiche

from . import FORMAT_VERGLEICH, VERSION

TOLERANZ_RELATIV = 0.01
URTEILE = ("besser", "schlechter", "gleich", "unbewertet")


def _endlich(x: float | None) -> bool:
    return x is not None and math.isfinite(x)


def _urteil_zahl(a: float, b: float, ziel: dict[str, Any] | None, referenz: float | None, toleranz_rel: float) -> tuple[str, str]:
    """(Urteil, Grund) für zwei Einzelwerte; Maßstab: ``ziel`` der Konfiguration, sonst der Referenzwert, sonst keiner."""
    if not (_endlich(a) and _endlich(b)):
        return "unbewertet", "Wert fehlt"
    skala = max(abs(a), abs(b), abs(referenz) if _endlich(referenz) else 0.0)
    tol = max(float((ziel or {}).get("toleranz", 0.0)), toleranz_rel * skala, 1e-12)
    richtung = (ziel or {}).get("richtung")
    sollwert = (ziel or {}).get("ziel")
    if richtung in ("hoeher", "niedriger"):
        d = (b - a) if richtung == "hoeher" else (a - b)
        grund = f"Ziel: {richtung}"
    elif sollwert is not None or _endlich(referenz):
        x = float(sollwert) if sollwert is not None else float(referenz)  # type: ignore[arg-type]
        d = abs(a - x) - abs(b - x)
        grund = f"Ziel {x:.4g}" if sollwert is not None else f"Referenz {x:.4g}"
    else:
        return "unbewertet", "kein Maßstab (weder Ziel noch Referenz)"
    if d > tol:
        return "besser", grund
    if d < -tol:
        return "schlechter", grund
    return "gleich", grund


def _urteil_abstand(abstand_a: float | None, abstand_b: float | None, toleranz_rel: float) -> str:
    """Abstand zur Referenz: kleiner ist besser."""
    if not (_endlich(abstand_a) and _endlich(abstand_b)):
        return "unbewertet"
    tol = max(toleranz_rel * max(abstand_a, abstand_b), 1e-12)  # type: ignore[type-var]
    if abstand_a - abstand_b > tol:  # type: ignore[operator]
        return "besser"
    if abstand_b - abstand_a > tol:  # type: ignore[operator]
        return "schlechter"
    return "gleich"


def _ziel(ziele: dict[str, dict[str, Any]], name: str) -> dict[str, Any] | None:
    return ziele.get(name) or ziele.get(familie(name))


def vergleiche_fall(
    a: Metrikvektor, b: Metrikvektor, referenz: Metrikvektor | None, ziele: dict[str, dict[str, Any]], toleranz_rel: float = TOLERANZ_RELATIV
) -> dict[str, Any]:
    """Alle Kennzahlen eines Falls, B gegen A."""
    ab = vergleiche(a, b)
    ref_a = vergleiche(referenz, a) if referenz is not None else None
    ref_b = vergleiche(referenz, b) if referenz is not None else None
    ref_wert = {m.name: m.wert for m in referenz.metriken} if referenz is not None else {}
    skalare = []
    for name, s in ab.skalare.items():
        urteil, grund = _urteil_zahl(s.a, s.b, _ziel(ziele, name), ref_wert.get(name), toleranz_rel)
        skalare.append(
            {
                "name": name, "gruppe": s.gruppe, "einheit": s.einheit, "art": s.art, "a": _zahl(s.a), "b": _zahl(s.b),
                "differenz": _zahl(s.differenz), "relativ": _zahl(s.relativ), "urteil": urteil, "grund": grund,
            }
        )
    verteilungen = []
    for name, v in ab.verteilungen.items():
        wa = ref_a.verteilungen[name].w1_norm if ref_a and name in ref_a.verteilungen else None
        wb = ref_b.verteilungen[name].w1_norm if ref_b and name in ref_b.verteilungen else None
        verteilungen.append(
            {
                "name": name, "gruppe": v.gruppe, "einheit": v.einheit, "w1": _zahl(v.w1), "w1_norm": _zahl(v.w1_norm),
                "abstand_referenz_a": _zahl(wa) if wa is not None else None, "abstand_referenz_b": _zahl(wb) if wb is not None else None,
                "urteil": _urteil_abstand(wa, wb, toleranz_rel) if referenz is not None else "unbewertet",
            }
        )
    reihen = []
    for name, r in ab.reihen.items():
        ra = ref_a.reihen[name].abstand if ref_a and name in ref_a.reihen else None
        rb = ref_b.reihen[name].abstand if ref_b and name in ref_b.reihen else None
        reihen.append(
            {
                "name": name, "gruppe": r.gruppe, "abstand": _zahl(r.abstand),
                "abstand_referenz_a": _zahl(ra) if ra is not None else None, "abstand_referenz_b": _zahl(rb) if rb is not None else None,
                "urteil": _urteil_abstand(ra, rb, toleranz_rel) if referenz is not None else "unbewertet",
            }
        )
    geaendert = sum(1 for s in skalare if s["relativ"] is not None and abs(s["relativ"]) > toleranz_rel)
    zaehlung = {u: 0 for u in URTEILE}
    for liste in (skalare, verteilungen, reihen):
        for e in liste:
            zaehlung[e["urteil"]] += 1
    return {
        "skalare": skalare, "verteilungen": verteilungen, "reihen": reihen, "urteile": zaehlung, "geaendert": geaendert,
        "gruppenabstand_a_b": ab.gruppenabstand(), "nur_in_a": ab.nur_in_a, "nur_in_b": ab.nur_in_b,
    }


def _zahl(x: float | None) -> float | None:
    return float(x) if x is not None and math.isfinite(x) else None


def vergleiche_ergebnisse(
    qa: dict[str, Any], dir_a: Path, qb: dict[str, Any], dir_b: Path, ziele: dict[str, dict[str, Any]], toleranz_rel: float = TOLERANZ_RELATIV
) -> dict[str, Any]:
    """Vergleicht zwei Qualitätsergebnisse (``laufe_qualitaet``) Fall für Fall (gleicher Name)."""
    if qa["deskriptoren"]["parameter"] != qb["deskriptoren"]["parameter"]:
        raise MassstabFehler("Die Deskriptoren-Parameter beider Läufe unterscheiden sich; Läufe mit denselben Einstellungen vergleichen")
    fa = {f["name"]: f for f in qa["faelle"]}
    fb = {f["name"]: f for f in qb["faelle"]}
    faelle = []
    for name in fa:
        if name not in fb:
            continue
        a_vektor = Metrikvektor.lies(dir_a / fa[name]["vektor"])
        b_vektor = Metrikvektor.lies(dir_b / fb[name]["vektor"])
        ref = fb[name].get("referenz") or fa[name].get("referenz")
        referenz = Metrikvektor.lies(dir_b / ref["vektor"]) if ref and ref.get("vektor") else None
        try:
            e = vergleiche_fall(a_vektor, b_vektor, referenz, ziele, toleranz_rel)
        except MassstabFehler as fehler:
            faelle.append({"name": name, "fehler": str(fehler)})
            continue
        e.update(
            name=name,
            stufe=fa[name]["stufe"],
            raster_gleich=fa[name]["raster"]["ergebnis_fingerprint"] == fb[name]["raster"]["ergebnis_fingerprint"],
            auftrag_gleich=fa[name]["auftrag_fingerprint"] == fb[name]["auftrag_fingerprint"],
            referenz=bool(referenz is not None),
        )
        faelle.append(e)
    summe = {u: sum(f.get("urteile", {}).get(u, 0) for f in faelle) for u in URTEILE}
    return {
        "format": FORMAT_VERGLEICH,
        "version": VERSION,
        "commit_a": qa["commit"],
        "commit_b": qb["commit"],
        "ziele": ziele,
        "toleranz_relativ": toleranz_rel,
        "nur_in_a": sorted(set(fa) - set(fb)),
        "nur_in_b": sorted(set(fb) - set(fa)),
        "urteile": summe,
        "faelle": faelle,
    }


def tabelle(v: dict[str, Any], top: int = 8) -> str:
    """Zusammenfassung je Fall, die größten Regressionen und Verbesserungen und, wo kein Maßstab urteilt, die größten Änderungen."""
    zeilen = [f"Vergleich {v['commit_a'][:12]} → {v['commit_b'][:12]}   " + "  ".join(f"{u} {v['urteile'][u]}" for u in URTEILE)]
    for f in v["faelle"]:
        if "fehler" in f:
            zeilen.append(f"  {f['name']:<34} FEHLER {f['fehler']}")
            continue
        raster = "Raster gleich" if f["raster_gleich"] else "Raster verschieden"
        zeilen.append(
            f"  {f['name']:<34} {raster:<18} geändert {f['geaendert']:>3}  "
            + "  ".join(f"{u} {f['urteile'][u]}" for u in URTEILE)
            + ("" if f["referenz"] else "  (ohne Referenz)")
        )
    ohne_urteil = v["urteile"]["schlechter"] + v["urteile"]["besser"] == 0
    for urteil, titel in (("schlechter", "Regressionen"), ("besser", "Verbesserungen"), (None, "Größte Änderungen")):
        if urteil is None and not ohne_urteil:
            continue
        alle = [
            (f["name"], s)
            for f in v["faelle"]
            if "skalare" in f
            for s in f["skalare"]
            if (urteil is None or s["urteil"] == urteil) and s["relativ"] is not None and s["a"] is not None and s["b"] is not None
        ]
        alle.sort(key=lambda t: -abs(t[1]["relativ"]))
        if alle:
            zeilen.append(f"== {titel} (Einzelwerte, größte relative Änderung zuerst, Top {top}) ==")
            for name, s in alle[:top]:
                zeilen.append(
                    f"  {name:<28} {s['name']:<44} {s['a']:>11.5g} → {s['b']:>11.5g} {100 * s['relativ']:+8.1f} %  ({s['urteil']}: {s['grund']})"
                )
    return "\n".join(zeilen)


def schreibe(v: dict[str, Any], pfad: Path) -> Path:
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding="utf-8")
    return pfad
