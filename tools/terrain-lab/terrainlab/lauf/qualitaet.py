"""Qualitätsbenchmark (WI-0250 Phase B): Adapter rechnet die Raster, die Deskriptoren (``terrainlab.deskriptoren``) messen sie.

Je Fall:

1. Schlüssel (Commit, Auftrag) beim Adapter erfragen (``--fingerprint``, ohne zu rechnen).
2. Raster im Zwischenspeicher suchen, sonst vom Adapter rechnen lassen und ablegen (``cache.py``).
3. Metrikvektor im Zwischenspeicher suchen (Schlüssel enthält Raster, Parameter und den Quelltext der Deskriptoren), sonst berechnen.
4. Mit ``referenz`` zusätzlich der Vektor des Referenzrasters und der Abstand zu ihm (``deskriptoren.vergleiche``).

Das Ergebnis ist je Fall ein Metrikvektor (Datei ``metriken/<fall>.json``, Format der Deskriptoren) und eine kompakte Liste der Einzelwerte in
``ergebnis.json``. Ein Gesamtwert wird nicht gebildet.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any, Callable

from terrainlab.deskriptoren import MassstabFehler, Metrikvektor, Parameter, berechne, vergleiche
from terrainlab.raster import lies

from . import FORMAT_QUALITAET, VERSION
from .adapter import Adapter, AuftragsInfo, Unsauber
from .cache import Zwischenspeicher, deskriptoren_quellhash
from .konfig import Fall, Konfig
from .umgebung import rechnerangaben


def _zahl(x: float) -> float | None:
    return x if math.isfinite(x) else None


def _deskriptor_einstellungen(konfig: Konfig) -> tuple[Parameter, list[str] | None, bool]:
    q = konfig.qualitaet
    gruppen = q.get("gruppen")
    return Parameter.aus_dict(q.get("parameter", {})), (list(gruppen) if gruppen else None), not bool(q.get("ohne_teuer", False))


def sichere_raster(
    adapter: Adapter,
    cache: Zwischenspeicher,
    fall: Fall,
    info: AuftragsInfo,
    *,
    commit: str | None,
    cache_neu: bool,
    schmutzig_erlauben: bool,
    arbeitsordner: Path,
    zwischenstaende: bool = False,
    timeout: float | None = None,
) -> tuple[dict[str, Any], Path, bool]:
    """Die ``meta.json`` und der Ordner des Rasters zu (Commit, Auftrag); dritter Wert: aus dem Zwischenspeicher?"""
    if not info.baum_sauber and not schmutzig_erlauben:
        raise Unsauber(
            f"Die Generator-Verzeichnisse weichen von {info.commit[:12]} ab ({', '.join(info.geaendert[:3])} …); mit --commit <sha> messen "
            "oder --schmutzig-erlauben (nur Entwicklung, ohne Zwischenspeicher)",
            3,
        )
    zwischenspeichern = info.baum_sauber
    if zwischenspeichern and not cache_neu:
        meta = cache.hole_raster(info.commit, info.auftrag_fingerprint, zwischenstaende)
        if meta is not None:
            return meta, cache.raster_ordner(info.commit, info.auftrag_fingerprint), True
    ziel = cache.neuer_ordner(info.commit, info.auftrag_fingerprint) if zwischenspeichern else arbeitsordner
    meta = adapter.rechne(fall.auftrag, ziel, commit=commit, schmutzig_erlauben=schmutzig_erlauben, timeout=timeout)
    if zwischenspeichern:
        ziel = cache.veroeffentliche(ziel, info.commit, info.auftrag_fingerprint)
    return meta, ziel, False


def _vektor(
    cache: Zwischenspeicher,
    info: AuftragsInfo,
    raster_ordner: Path,
    meta: dict[str, Any],
    einstellungen: tuple[Parameter, list[str] | None, bool],
    cache_neu: bool,
    zwischenspeichern: bool,
    datei: dict[str, Any] | None = None,
) -> tuple[Metrikvektor, bool, float]:
    parameter, gruppen, teuer = einstellungen
    d = datei or meta["raster"]["dateien"][0]
    schluessel = cache.metrik_schluessel(d["sha256"], parameter.als_dict(), gruppen, teuer)
    pfad = cache.metrik_pfad(info.commit, info.auftrag_fingerprint, schluessel)
    if zwischenspeichern and not cache_neu and pfad.exists():
        return Metrikvektor.lies(pfad), True, 0.0
    t0 = time.perf_counter()
    vektor = berechne(lies(raster_ordner / d["datei"]), parameter, tuple(gruppen) if gruppen else None, teuer)
    dauer = time.perf_counter() - t0
    if zwischenspeichern:
        vektor.schreibe(pfad)
    return vektor, False, dauer


def laufe_qualitaet(
    konfig: Konfig,
    adapter: Adapter,
    ausgabe: Path,
    *,
    commit: str | None = None,
    cache: Zwischenspeicher | None = None,
    cache_neu: bool = False,
    schmutzig_erlauben: bool = False,
    melde: Callable[[str], None] = lambda text: None,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Berechnet den Metrikvektor jedes Falls und schreibt ``ergebnis.json`` und ``metriken/<fall>.json`` in ``ausgabe``."""
    cache = cache or Zwischenspeicher()
    ausgabe = Path(ausgabe)
    (ausgabe / "metriken").mkdir(parents=True, exist_ok=True)
    einstellungen = _deskriptor_einstellungen(konfig)
    start = time.time()
    faelle = []
    for fall in konfig.faelle:
        info = adapter.fingerprint(fall.auftrag, commit)
        meta, ordner, aus_cache = sichere_raster(
            adapter, cache, fall, info, commit=commit, cache_neu=cache_neu, schmutzig_erlauben=schmutzig_erlauben,
            arbeitsordner=ausgabe / "raster" / fall.name, timeout=timeout,
        )
        vektor, metrik_aus_cache, dauer = _vektor(cache, info, ordner, meta, einstellungen, cache_neu, info.baum_sauber)
        vektor.schreibe(ausgabe / "metriken" / f"{fall.name}.json")
        eintrag: dict[str, Any] = {
            "name": fall.name,
            "stufe": fall.stufe,
            "auftrag_fingerprint": info.auftrag_fingerprint,
            "commit": info.commit,
            "raster_aus_cache": aus_cache,
            "metrik_aus_cache": metrik_aus_cache,
            "metrik_berechnet_s": round(dauer, 2),
            "rezept_fassung": meta["rezept"]["fassung"],
            "rezept_fingerprint": meta["rezept"]["fingerprint"],
            "raster": {**{k: meta["raster"][k] for k in ("breite", "hoehe", "zellgroesse_m", "zellen", "eigene_zellen", "ergebnis_fingerprint")},
                       "sha256": meta["raster"]["dateien"][0]["sha256"]},
            "metriken": {m.name: _zahl(m.wert) for m in vektor.metriken},
            "vektor": f"metriken/{fall.name}.json",
            "hinweise": vektor.kopf.get("hinweise", []),
            "referenz": None,
        }
        if fall.referenz:
            eintrag["referenz"] = _referenz(fall, vektor, einstellungen, ausgabe)
        melde(f"{fall.name}: Raster {'aus Zwischenspeicher' if aus_cache else 'gerechnet'}, Metriken {'aus Zwischenspeicher' if metrik_aus_cache else f'{dauer:.1f} s'}")
        faelle.append(eintrag)
    parameter, gruppen, teuer = einstellungen
    ergebnis = {
        "format": FORMAT_QUALITAET,
        "version": VERSION,
        "konfig": {"name": konfig.name, "beschreibung": konfig.beschreibung, "roh": konfig.roh},
        "commit": faelle[0]["commit"],
        "deskriptoren": {"quellhash": deskriptoren_quellhash(), "parameter": parameter.als_dict(), "gruppen": gruppen, "teuer": teuer},
        "umgebung": rechnerangaben(),
        "begonnen": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(start)),
        "dauer_s": round(time.time() - start, 1),
        "faelle": faelle,
    }
    (ausgabe / "ergebnis.json").write_text(json.dumps(ergebnis, ensure_ascii=False, indent=1), encoding="utf-8")
    return ergebnis


def _referenz(fall: Fall, vektor: Metrikvektor, einstellungen: tuple[Parameter, list[str] | None, bool], ausgabe: Path) -> dict[str, Any]:
    """Der Vektor des Referenzrasters (neben dem des Falls abgelegt) und der Abstand des Falls zu ihm."""
    parameter, gruppen, teuer = einstellungen
    try:
        referenz = berechne(lies(fall.referenz), parameter, tuple(gruppen) if gruppen else None, teuer)  # type: ignore[arg-type]
        referenz.schreibe(ausgabe / "metriken" / f"{fall.name}.referenz.json")
        abstand = vergleiche(referenz, vektor)
    except (MassstabFehler, FileNotFoundError, ValueError) as fehler:
        return {"pfad": str(fall.referenz), "fehler": str(fehler)}
    return {"pfad": str(fall.referenz), "vektor": f"metriken/{fall.name}.referenz.json", "gruppenabstand": abstand.gruppenabstand()}


def tabelle(ergebnis: dict[str, Any], schluessel: tuple[str, ...] = ("hoehe_mittel", "hang_neigung_mittel", "hoehe_hypsometrisches_integral")) -> str:
    zeilen = [f"Qualität {ergebnis['konfig']['name']}  Commit {ergebnis['commit'][:12]}  {len(ergebnis['faelle'])} Fälle  {ergebnis['dauer_s']:.0f} s"]
    for f in ergebnis["faelle"]:
        wahl = ", ".join(f"{k} {f['metriken'][k]:.4g}" for k in schluessel if f["metriken"].get(k) is not None)
        herkunft = ("Raster Cache" if f["raster_aus_cache"] else "Raster neu") + (", Metrik Cache" if f["metrik_aus_cache"] else f", Metrik {f['metrik_berechnet_s']:.1f} s")
        zeilen.append(f"  {f['name']:<34} {len(f['metriken']):>4} Metriken  ({herkunft})  {wahl}")
    return "\n".join(zeilen)
