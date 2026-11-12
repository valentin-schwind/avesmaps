"""Nachmessung (WI-0250 Phase A4): eine Vorschlagsdatei an einem **anderen Generator-Stand** noch einmal messen.

Ein Vorschlag gilt nur für den Commit, an dem er entstand. Ändert sich der Generator (WI-0249 P2: Einbettung, Erosion, Formerhalt), fragt man hier: Was ist aus der Vorgabe
des Typs geworden, wie schneidet der Vorschlag jetzt ab, und besteht er die Validierung am neuen Stand noch? Es wird **nicht neu gesucht**: Der Vorschlag (seine
ausdrücklichen Werte, also die Überlagerung „19 (Test)“) wird über die Vorgabe des neuen Standes gelegt und mit den Einstellungen des ursprünglichen Laufs gemessen
(Saaten, Vorschau, Bewertung, Formtor; Validierung bei 2× und 4× mit dem Vorschlag allein). Bezug von Abstand und Formtor ist die Vorgabe des **neuen** Standes.

Hat ein Typ keinen bestätigten Vorschlag, wird sein bester unbestätigter Kandidat gemessen, wenn die Datei einen nennt.

Ergebnis: ``nachmessung.json`` im Ordner des Laufs und eine Tabelle (alt gegen neu). Ein abgebrochener Aufruf lässt sich mit demselben ``--ausgabe`` fortsetzen:
Gespeicherte Messungen werden nicht wiederholt.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.lauf.umgebung import loese_commit

from .lauf import Lauf, optimierung_wurzel
from .profil import Profil, parse_profil
from .ranking import bewerte, vorgabe_zusammenfassung
from .validierung import validiere

FORMAT_NACHMESSUNG = "avesmaps-terrainlab-nachmessung"
#: Zwei Saaten bei 2×, eine bei 4×, ein Kandidat: das Mindeste, was „bestätigt“ aussagt. Der Gewinn muss wie im Durchstich mindestens 2 % betragen.
VALIDIERUNG = {"beste": 1, "aufloesungen": [2, 4], "vier_x_fuer": 1, "saaten": 2, "gewinn_min": 0.02}


def profil_aus_vorschlag(v: dict[str, Any], commit: str, grenzen: dict[str, Any] | None = None) -> Profil:
    """Das Profil der Nachmessung: Typen, Saaten, Vorschau und Bewertung der Datei, am Stand ``commit``; ohne Suche und ohne Strategievergleich."""
    saaten = [None if str(s) == "fixture" else int(s) for s in v["saaten"]]
    roh: dict[str, Any] = {
        "name": f"nachmessung-{commit[:12]}",
        "beschreibung": f"Nachmessung der Vorschlagsdatei {v.get('lauf', '?')} (Stand {str(v['commit'])[:12]}) am Stand {commit[:12]}",
        "commit": commit,
        "fassung": v["fassung_basis"],
        "typen": [{"typ": t, "gebirge": e["gebirge"]} for t, e in v["typen"].items()],
        "saaten": saaten,
        "vorschau": v["vorschau"],
        "bewertung": v["bewertung"],
        "validierung": {**VALIDIERUNG, "saaten": min(VALIDIERUNG["saaten"], len(saaten))},
        "strategien": {"aktiv": False},
    }
    if grenzen:
        roh["grenzen"] = grenzen
    return parse_profil(roh)


def kandidat_der_datei(eintrag: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Der Kandidat eines Eintrags (Abweichungen von der damaligen Vorgabe) und seine Art: ``vorschlag``, ``unbestaetigt`` oder ``keiner``."""
    if eintrag.get("status") == "bestaetigt" and eintrag.get("kandidat"):
        return dict(eintrag["kandidat"]), "vorschlag"
    rest = eintrag.get("beste_unbestaetigt") or {}
    if rest.get("kandidat"):
        return dict(rest["kandidat"]), "unbestaetigt"
    return {}, "keiner"


def uebertrage(raum: Any, kandidat: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Legt einen Kandidaten über die Vorgabe des **neuen** Standes. Zweiter Wert: was dabei wegfiel, mit Grund
    (``unbekannt``: der Stand kennt den Parameter nicht; ``ausserhalb``: Wert liegt außerhalb der Grenzen des Standes; ``gilt_schon``: die neue Vorgabe hat den Wert bereits)."""
    aus: dict[str, Any] = {}
    weg: dict[str, list[str]] = {"unbekannt": [], "ausserhalb": [], "gilt_schon": []}
    for name, wert in sorted(kandidat.items()):
        if name not in raum.namen:
            weg["unbekannt"].append(name)
            continue
        try:
            raum.pruefe({name: wert})
        except ValueError:
            weg["ausserhalb"].append(name)
            continue
        if raum[name].gleich(wert, raum[name].basis):
            weg["gilt_schon"].append(name)
            continue
        aus[name] = wert
    return aus, weg


def _kurz(b: dict[str, Any] | None) -> dict[str, Any] | None:
    if b is None:
        return None
    return {"d1": b["d1"], "form_verlust": b["form_verlust"], "zeit_s": b["zeit_s"], "tor_ok": b["tor_ok"], "verstoesse": b["verstoesse"], "komponenten": b["fasse"].get("komponenten"),
            "d1_arten": {a: v["mittel"] for a, v in (b["fasse"].get("d1_arten") or {}).items()}}


def nachmessen(
    vorschlag: Path | str, commit: str, adapter: Any, *, ordner: Path | None = None, cache: Zwischenspeicher | None = None, labor: Path | None = None,
    grenzen: dict[str, Any] | None = None, melde: Callable[[str], None] = lambda t: None,
) -> dict[str, Any]:
    """Misst die Vorschläge der Datei am Stand ``commit`` und schreibt ``nachmessung.json`` in den Laufordner.

    Wirft ``Gestoppt`` (Zeit, Versuche, Speicher, STOP-Datei); der Lauf ist dann mit demselben Ordner fortsetzbar.
    """
    v = json.loads(Path(vorschlag).read_text(encoding="utf-8"))
    commit = loese_commit(commit)
    profil = profil_aus_vorschlag(v, commit, grenzen)
    ziel = Path(ordner) if ordner else optimierung_wurzel(labor) / f"{time.strftime('%Y%m%d-%H%M%S')}-{profil.name}"
    if (ziel / "lauf.sqlite").exists():
        lauf = Lauf.oeffne(ziel, adapter, cache=cache, melde=melde)
        lauf.profil = profil
    else:
        lauf = Lauf.neu(profil, adapter, ordner=ziel, cache=cache, melde=melde)
    try:
        lauf._bereite_vor()
        aus = lauf.auswerter
        assert aus is not None
        saaten = list(profil.saaten)
        ergebnis: dict[str, Any] = {
            "format": FORMAT_NACHMESSUNG, "version": 1, "erzeugt": time.strftime("%Y-%m-%dT%H:%M:%S"), "vorschlag": str(vorschlag), "vorschlag_lauf": v.get("lauf"),
            "vorschlag_commit": v["commit"], "commit": commit, "saaten": [profil.saat_name(s) for s in saaten], "tor_faktor": profil.tor_faktor, "validierung": profil.validierung, "typen": {},
        }
        for typ, eintrag in v["typen"].items():
            raum = lauf.raeume[typ]
            alt, art = kandidat_der_datei(eintrag)
            kand, weg = uebertrage(raum, alt)
            lauf.melde(f"[{typ}] Nachmessung: Vorgabe des neuen Standes, dann {art} mit {len(kand)} Abweichungen")
            basis = vorgabe_zusammenfassung(aus, typ, saaten)
            alt_kz = eintrag.get("kennzahlen") or {}
            e: dict[str, Any] = {
                "gebirge": eintrag["gebirge"], "status_alt": eintrag.get("status"), "art": art, "kandidat_alt": alt, "kandidat": kand, "weggefallen": weg,
                "vorgabe_neu": {"d1": basis["d1"]["mittel"], "form_verlust": None if basis["form"]["mittel"] is None else 1.0 - basis["form"]["mittel"], "zeit_s": (basis["wall_ms"]["mittel"] or 0) / 1000.0,
                                "komponenten": basis["komponenten"], "d1_arten": {a: x["mittel"] for a, x in basis["d1_arten"].items()}},
                "vorgabe_alt": (alt_kz.get("1x") or {}).get("vorgabe"), "kandidat_alt_1x": (alt_kz.get("1x") or {}).get("vorschlag"),
                "validierung_alt": {a: {"gewinn": x.get("gewinn_validierung"), "formtor": x.get("tor_ok"), "bestaetigt": x.get("bestaetigt"),
                                           "vorgabe_d1": (x.get("vorgabe_validierung") or {}).get("d1"), "kandidat_d1": (x.get("vorschlag_validierung") or {}).get("d1")}
                                 for a, x in alt_kz.items() if a in ("2x", "4x")},
                "kandidat_neu_1x": None, "validierung": None, "bestaetigt_neu": None,
            }
            if kand:
                b = bewerte(aus, typ, kand, saaten, basis, profil.tor_faktor, herkunft="nachmessung")
                e["kandidat_neu_1x"] = _kurz(b.als_dict())
                e["gewinn_1x"] = None if not basis["d1"]["mittel"] or b.d1 is None else (basis["d1"]["mittel"] - b.d1) / basis["d1"]["mittel"]
                val = validiere(aus, typ, [b], saaten, profil.validierung, profil.tor_faktor, lambda t: lauf.melde(f"[{typ}] {t}"))
                e["validierung"] = {
                    "vorgabe": {a: {r: {"d1": x[r]["d1"]["mittel"], "form": x[r]["form"]["mittel"]} for r in ("optimierung", "validierung")} for a, x in val["vorgabe"].items()},
                    "kandidat": {a: {"d1_optimierung": x["optimierung"]["d1"], "d1_validierung": x["validierung"]["d1"], "gewinn": x["gewinn_validierung"], "formtor": x["tor_ok"], "verstoesse": x["verstoesse"],
                                     "bestaetigt": x["bestaetigt"]} for a, x in val["kandidaten"][0]["aufloesungen"].items()},
                }
                e["bestaetigt_neu"] = val["vorschlag"] is not None
            ergebnis["typen"][typ] = e
        lauf.db.setze_meta("status", "fertig")
        (lauf.ordner / "nachmessung.json").write_text(json.dumps(ergebnis, ensure_ascii=False, indent=1), encoding="utf-8")
        lauf._schreibe_zusammenfassung("fertig")
        return ergebnis
    finally:
        lauf.schliesse()


# --- Ausgabe -------------------------------------------------------------------------------------------------------------------

def _z(x: Any, stellen: int = 3) -> str:
    return "-" if x is None else f"{x:.{stellen}f}".replace(".", ",")


def _p(x: float | None) -> str:
    return "-" if x is None else f"{100 * x:.0f} %"


def _verlust(f: dict[str, Any] | None) -> float | None:
    return None if not f or f.get("form") is None else 1.0 - f["form"]


def tabelle(erg: dict[str, Any]) -> str:
    """Alt gegen neu, je Typ: Abstand und Formverlust von Vorgabe und Kandidat bei 1×, geänderte Formkomponenten der Vorgabe, die Validierung."""
    zeilen = [f"Nachmessung: Vorschlag vom Stand {str(erg['vorschlag_commit'])[:12]} am Stand {erg['commit'][:12]}; Saaten {', '.join(erg['saaten'])}; Formtor {_z(erg['tor_faktor'], 2)} der Vorgabe"]
    for typ, e in erg["typen"].items():
        zeilen.append(f"\n{typ} ({e['gebirge']}): Datei sagt {e['status_alt']}, gemessen wird: {dict(vorschlag='der Vorschlag', unbestaetigt='der beste unbestätigte Kandidat', keiner='nur die Vorgabe')[e['art']]}")
        vn, va = e["vorgabe_neu"], e["vorgabe_alt"]
        zeilen.append(f"  Vorgabe 1×     Abstand {_z((va or {}).get('d1'))} -> {_z(vn['d1'])}    Formverlust {_z(_verlust(va))} -> {_z(vn['form_verlust'])}    Zeit {_z(vn['zeit_s'], 1)} s")
        if va:
            geaendert = [f"{k} {_z(va['komponenten'].get(k), 2)} -> {_z(vn['komponenten'].get(k), 2)}" for k in vn["komponenten"] if va["komponenten"].get(k) != vn["komponenten"].get(k)
                         and not (va["komponenten"].get(k) is None and vn["komponenten"].get(k) is None)]
            if geaendert:
                zeilen.append(f"  Formkomponenten der Vorgabe: {'; '.join(geaendert)}")
        w = e["weggefallen"]
        for grund, text in (("unbekannt", "kennt der neue Stand nicht"), ("ausserhalb", "liegt außerhalb der Grenzen des neuen Standes"), ("gilt_schon", "gilt dort bereits als Vorgabe")):
            if w[grund]:
                zeilen.append(f"  Weggefallen ({text}): {', '.join(w[grund])}")
        k = e["kandidat_neu_1x"]
        if k is None:
            zeilen.append("  Kein Kandidat (die Vorgabe bleibt).")
            continue
        ka = e["kandidat_alt_1x"]
        tor = "gehalten" if k["tor_ok"] else "VERFEHLT: " + "; ".join(k["verstoesse"])
        zeilen.append(f"  Kandidat 1×    Abstand {_z((ka or {}).get('d1'))} -> {_z(k['d1'])}    Formverlust {_z(_verlust(ka))} -> {_z(k['form_verlust'])}    Formtor {tor}")
        if e.get("gewinn_1x") is not None and e["gewinn_1x"] <= 0:
            zeilen.append(f"  Bei 1× liegt der Kandidat nicht mehr unter der Vorgabe des neuen Standes (Abstand {_z(k['d1'])} gegen {_z(vn['d1'])}); sein Vorteil beruht auf der Validierung.")
        for a, x in sorted(e["validierung"]["kandidat"].items()):
            vg = e["validierung"]["vorgabe"][a]["validierung"]["d1"]
            alt = e["validierung_alt"].get(f"{a}x") or {}
            zeilen.append(f"  Validierung {a}× Vorgabe {_z(alt.get('vorgabe_d1'))} -> {_z(vg)}   Kandidat {_z(alt.get('kandidat_d1'))} -> {_z(x['d1_validierung'])}   "
                          f"Gewinn {_p(alt.get('gewinn'))} -> {_p(x['gewinn'])}   Formtor {'gehalten' if x['formtor'] else 'VERFEHLT'}   {'bestätigt' if x['bestaetigt'] else 'nicht bestätigt'}")
        zeilen.append(f"  Am neuen Stand: {'bestätigt' if e['bestaetigt_neu'] else 'NICHT bestätigt'}")
    return "\n".join(zeilen)
