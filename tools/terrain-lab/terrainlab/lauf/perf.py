"""Performance-Benchmark (WI-0250 Phase B): je Fall mehrere frische Prozesse (kalt), darin warme Läufe, Phasenproben, Median und Streuung.

Ablauf je Fall: ``wiederholungen``-mal ein Adapter-Prozess mit ``--warm n`` (der erste Lauf im Prozess ist kalt, die folgenden warm); die
Phasenproben des Rückennetzes laufen im ersten Prozess (``phasen: erster``) oder in jedem (``alle``). Zusammengefasst wird je Kennzahl der
Median mit Streuung (``statistik.fasse``). Raster werden nicht geschrieben (``--ohne-raster``); das Ergebnis steht in einer JSON-Datei.

Jede Messung trägt die **Fremdlast** (Kerne, die andere Prozesse im Mittel belegten) und das Urteil ``unruhig``: Auf einem Rechner, an dem
mehrere Sitzungen rechnen, ist eine Zeit ohne diese Angabe kaum zu deuten.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable

from . import FORMAT_PERF, VERSION
from .adapter import Adapter, AuftragsInfo
from .konfig import Fall, Konfig
from .statistik import fasse
from .umgebung import rechnerangaben

# Eine Messreihe gilt als unruhig, wenn die Streuung der kalten Zeiten über der Schwelle liegt oder andere Prozesse im Mittel mehr als
# diesen Anteil der logischen Prozessoren belegten (der Generator rechnet überwiegend auf einem Kern; eine mäßig belegte Maschine
# verfälscht ihn wenig, eine überfüllte schon, über Takt, Speicherbandbreite und Planung). Die Fremdlast steht in jedem Fall dabei.
FREMDLAST_UNRUHIG_ANTEIL = 0.4
STREUUNG_UNRUHIG_PROZENT = 10.0

# Frei sein muss mindestens das Mehrfache dessen, was der Prozess belegt: Vorschau und Saat gemessen bis 270 MiB Spitze (4x der Trollzacken 253,
# Saat des Ehernen Schwerts 271); das Endgelände rechnet die ganze grobe Stufe (gut 1 GB nach compare-terrain-local, die Messskripte geben 6 GB Heap).
MINDEST_RAM_MIB = {"vorschau": 800, "saat": 800, "endgelaende-lokal": 6000}


def mindest_ram_mib(konfig: Konfig) -> int:
    if konfig.mindest_frei_ram_mib is not None:
        return konfig.mindest_frei_ram_mib
    return max(MINDEST_RAM_MIB[f.stufe] for f in konfig.faelle)


def fasse_fall(fall: Fall, info: AuftragsInfo, proben: list[dict[str, Any]], pfade: list[str]) -> dict[str, Any]:
    """Das Ergebnis eines Falls aus den ``meta.json`` seiner Prozesse."""
    kalt = [m["laeufe"][0] for m in proben]
    warm = [lauf for m in proben for lauf in m["laeufe"][1:]]
    erstes = proben[0]
    fremd = fasse([k["fremdlast_kerne"] for k in kalt + warm], 2)
    kalt_wall = fasse([k["wall_ms"] for k in kalt])
    ergebnis: dict[str, Any] = {
        "name": fall.name,
        "stufe": fall.stufe,
        "auftrag_fingerprint": info.auftrag_fingerprint,
        "commit": erstes["stand"]["commit"],
        "rezept_fingerprint": erstes["rezept"]["fingerprint"],
        "rezept_fassung": erstes["rezept"]["fassung"],
        "raster": {k: erstes["raster"][k] for k in ("breite", "hoehe", "zellgroesse_m", "zellen", "eigene_zellen")},
        "kalt": {
            "wall_ms": kalt_wall,
            "cpu_ms": fasse([k["cpu_ms"] for k in kalt]),
            "rss_spitze_mib": fasse([k["rss_spitze_mib"] for k in kalt]),
        },
        "warm": (
            {"wall_ms": fasse([w["wall_ms"] for w in warm]), "cpu_ms": fasse([w["cpu_ms"] for w in warm])} if warm else None
        ),
        "fremdlast_kerne": fremd,
        "unruhig": bool(
            (fremd["median"] or 0) > FREMDLAST_UNRUHIG_ANTEIL * (erstes["umgebung"].get("kerne") or os.cpu_count() or 1)
            or (kalt_wall["streuung_prozent"] or 0) > STREUUNG_UNRUHIG_PROZENT
        ),
        "ergebnis_fingerprint": erstes["raster"]["ergebnis_fingerprint"],
        "fingerprint_stabil": len({m["raster"]["ergebnis_fingerprint"] for m in proben}) == 1,
        "deterministisch": all(m.get("deterministisch", True) for m in proben),
        "prozesse": len(proben),
        "wiederholungen_warm": fall.warm,
        "meta": pfade,
        "talboden": erstes["zusatz"].get("talboden"),
        "phasen": None,
        "domain": None,
    }
    mit_phasen = [m["phasenproben"] for m in proben if m.get("phasenproben")]
    if mit_phasen:
        namen = sorted({n for p in mit_phasen for n in p["phasen_ms"]})
        phasen = {n: fasse([p["phasen_ms"].get(n) for p in mit_phasen]) for n in namen}
        summe = sum(v["median"] or 0 for v in phasen.values())
        ergebnis["phasen"] = {
            "methode": mit_phasen[0]["methode"],
            "proben": len(mit_phasen),
            "wiederholungen_je_probe": mit_phasen[0]["wiederholungen"],
            "phasen_ms": phasen,
            "anteile_prozent": {n: round(100 * (v["median"] or 0) / summe, 1) if summe else None for n, v in phasen.items()},
            "ergebnis_gleich": all(p["ergebnis_gleich"] for p in mit_phasen),
            "hinweise": sorted({h for p in mit_phasen for h in p.get("hinweise", [])}),
        }
    if erstes.get("gruppen_ms"):
        gruppen = {n: fasse([m["gruppen_ms"][n] for m in proben if m.get("gruppen_ms")]) for n in erstes["gruppen_ms"]}
        einzel = erstes.get("phasen_ms") or {}
        ergebnis["domain"] = {
            "gruppen_ms": gruppen,
            "phasen_ms": {n: fasse([m["phasen_ms"].get(n) for m in proben if m.get("phasen_ms")]) for n in einzel},
            "erosion": erstes["zusatz"].get("erosion"),
            "fein_kacheln_gerechnet": erstes["zusatz"].get("fein_kacheln_gerechnet"),
        }
    return ergebnis


def laufe_perf(
    konfig: Konfig,
    adapter: Adapter,
    ausgabe: Path,
    *,
    commit: str | None = None,
    schmutzig_erlauben: bool = False,
    melde: Callable[[str], None] = lambda text: None,
    timeout: float | None = None,
) -> dict[str, Any]:
    """Misst alle Fälle der Konfiguration und schreibt ``ergebnis.json`` in ``ausgabe``."""
    ausgabe = Path(ausgabe)
    ausgabe.mkdir(parents=True, exist_ok=True)
    start = time.time()
    infos = {f.name: adapter.fingerprint(f.auftrag, commit) for f in konfig.faelle}
    commits = {i.commit for i in infos.values()}
    if len(commits) != 1:
        raise RuntimeError(f"Die Fälle würden an verschiedenen Ständen laufen: {sorted(commits)}")
    ergebnisse = []
    for fall in konfig.faelle:
        melde(f"{fall.name}: {fall.wiederholungen} Prozesse, warm {fall.warm}, Phasen {fall.phasen}")
        proben, pfade = [], []
        for i in range(fall.wiederholungen):
            ordner = ausgabe / fall.name / f"p{i + 1}"
            meta = adapter.rechne(
                fall.auftrag,
                ordner,
                commit=commit,
                warm=fall.warm,
                phasen=fall.phasen == "alle" or (fall.phasen == "erster" and i == 0),
                phasen_wiederholungen=fall.phasen_wiederholungen,
                arbeiter=konfig.arbeiter,
                ohne_raster=True,
                schmutzig_erlauben=schmutzig_erlauben,
                timeout=timeout,
            )
            proben.append(meta)
            pfade.append(str((ordner / "meta.json").relative_to(ausgabe)).replace("\\", "/"))
            melde(f"  p{i + 1}: kalt {meta['laeufe'][0]['wall_ms']:.0f} ms, Fremdlast {meta['laeufe'][0]['fremdlast_kerne']:.1f} Kerne")
        ergebnisse.append(fasse_fall(fall, infos[fall.name], proben, pfade))
    erste = json.loads((ausgabe / ergebnisse[0]["meta"][0]).read_text(encoding="utf-8"))
    stand = erste["stand"]
    ergebnis = {
        "format": FORMAT_PERF,
        "version": VERSION,
        "konfig": {"name": konfig.name, "beschreibung": konfig.beschreibung, "roh": konfig.roh},
        "stand": {"commit": stand["commit"], "art": stand["art"], "baum_sauber": stand["baum_sauber"], "reproduzierbar": stand["reproduzierbar"]},
        "umgebung": {
            **rechnerangaben(),
            "node_adapter": erste["umgebung"]["node"],
            "node_optionen": erste["umgebung"]["node_optionen"],
            "abhaengigkeiten": erste["umgebung"]["abhaengigkeiten"],
            "erosion_arbeiter": konfig.arbeiter,
        },
        "begonnen": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(start)),
        "dauer_s": round(time.time() - start, 1),
        "faelle": ergebnisse,
    }
    (ausgabe / "ergebnis.json").write_text(json.dumps(ergebnis, ensure_ascii=False, indent=1), encoding="utf-8")
    return ergebnis


def _ms(f: dict[str, Any] | None) -> str:
    if not f or f["median"] is None:
        return "-"
    return f"{f['median']:.0f}"


def tabelle(ergebnis: dict[str, Any]) -> str:
    """Lesbare Übersicht: eine Zeile je Fall, darunter die Phasenanteile."""
    s = ergebnis["stand"]
    zeilen = [
        f"Performance {ergebnis['konfig']['name']}  Commit {s['commit'][:12]} ({s['art']}{'' if s['baum_sauber'] else ', UNSAUBER'})  "
        f"Node {ergebnis['umgebung']['node_adapter']}  {ergebnis['dauer_s']:.0f} s",
        f"{'Fall':<34} {'Zellen':>8} {'kalt ms':>8} {'±%':>5} {'warm ms':>8} {'CPU ms':>8} {'RSS MiB':>8} {'Fremd':>6}",
    ]
    for f in ergebnis["faelle"]:
        zeilen.append(
            f"{f['name']:<34} {f['raster']['zellen']:>8} {_ms(f['kalt']['wall_ms']):>8} "
            f"{(f['kalt']['wall_ms']['streuung_prozent'] or 0):>5.1f} {_ms(f['warm']['wall_ms'] if f['warm'] else None):>8} "
            f"{_ms(f['kalt']['cpu_ms']):>8} {_ms(f['kalt']['rss_spitze_mib']):>8} {(f['fremdlast_kerne']['median'] or 0):>6.1f}"
            + ("  unruhig" if f["unruhig"] else "")
        )
        if f["phasen"]:
            teile = ", ".join(f"{n} {a:.0f} %" for n, a in f["phasen"]["anteile_prozent"].items() if a is not None)
            zeilen.append(f"    Phasen: {teile}" + ("" if f["phasen"]["ergebnis_gleich"] else "  (Probe weicht ab!)"))
        if f["domain"]:
            teile = ", ".join(f"{n} {_ms(v)} ms" for n, v in f["domain"]["gruppen_ms"].items())
            zeilen.append(f"    Endgelände: {teile}")
    return "\n".join(zeilen)
