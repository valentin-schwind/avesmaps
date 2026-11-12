"""Daten für den Bericht (WI-0250 Phase A5): Läufe lesen und für die Seite aufbereiten. Nichts wird neu gerechnet, außer was der Bericht zeigt (Schummerung,
Kennlinien der Deskriptoren an den gespeicherten Rastern).

Quellen (je nach Pfad erkannt): ein Laufordner der Optimierung (``lauf.sqlite``), eine Performance- oder Qualitätsmessung (``ergebnis.json``, Formate aus
``terrainlab.lauf``) und ein Commit-Vergleich (``vergleich.json``).
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel
from terrainlab.bewertung import fasse_saaten, pruefe_tor
from terrainlab.lauf import FORMAT_PERF, FORMAT_QUALITAET, FORMAT_VERGLEICH
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.optimierung.lauf import FIXTURE_UNTER_STAND, STUFEN
from terrainlab.optimierung.nachmessung import FORMAT_NACHMESSUNG
from terrainlab.optimierung.profil import Profil, parse_profil
from terrainlab.optimierung.speicher import Speicher


class BerichtFehler(ValueError):
    """Die Eingabe des Berichts ist unlesbar oder gehört zu keinem bekannten Format."""


def erkenne(pfad: Path) -> str:
    """Art einer Eingabe: ``optimierung``, ``nachmessung``, ``perf``, ``qualitaet`` oder ``vergleich``."""
    pfad = Path(pfad)
    if pfad.is_dir():
        if (pfad / "nachmessung.json").exists():  # eine Nachmessung hat auch eine lauf.sqlite, ist aber kein Optimierungslauf
            return "nachmessung"
        if (pfad / "lauf.sqlite").exists():
            return "optimierung"
        for name in ("vergleich.json", "ergebnis.json"):
            if (pfad / name).exists():
                return erkenne(pfad / name)
        raise BerichtFehler(f"{pfad}: weder lauf.sqlite noch ergebnis.json noch vergleich.json")
    if not pfad.exists():
        raise BerichtFehler(f"{pfad} gibt es nicht")
    try:
        j = json.loads(pfad.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as fehler:
        raise BerichtFehler(f"{pfad}: kein JSON ({fehler})") from fehler
    art = {FORMAT_PERF: "perf", FORMAT_QUALITAET: "qualitaet", FORMAT_VERGLEICH: "vergleich", FORMAT_NACHMESSUNG: "nachmessung"}.get(j.get("format") if isinstance(j, dict) else None)
    if art is None:
        raise BerichtFehler(f"{pfad}: unbekanntes Format {j.get('format') if isinstance(j, dict) else type(j).__name__}")
    return art


def lade_json(pfad: Path, name: str) -> dict[str, Any]:
    pfad = Path(pfad)
    datei = pfad if pfad.is_file() else pfad / name
    return json.loads(datei.read_text(encoding="utf-8"))


@dataclass
class TypDaten:
    typ: str
    gebirge: str
    phasen: dict[str, dict[str, Any] | None]
    kandidaten: list[dict[str, Any]] = field(default_factory=list)
    vorschlag: dict[str, Any] | None = None
    messungen_je_aufloesung: dict[int, dict[str, list[dict[str, Any]]]] = field(default_factory=dict)

    def daten(self, stufe: str) -> dict[str, Any] | None:
        p = self.phasen.get(stufe)
        return None if p is None else p.get("daten")


@dataclass
class OptimierungsDaten:
    ordner: Path
    profil: Profil
    commit: str
    status: str
    begonnen: str | None
    stand: dict[str, Any]
    grenzen: dict[str, Any] | None
    typen: dict[str, TypDaten]
    vorschlag: dict[str, Any] | None
    ereignisse: list[dict[str, Any]]
    cache: Zwischenspeicher
    messungen: int
    fehlgeschlagen: int


def fixture_pfad(ordner: Path, commit: str, gebirge: str, labor: Path | None = None) -> Path | None:
    """Die Gebirgsdatei (gezeichnete Form) eines Laufs: Kopie im Laufordner, sonst im Stand des Commits."""
    kopie = Path(ordner) / "gebirge" / f"{gebirge}.json"
    if kopie.exists():
        return kopie
    stand = (labor or daten_wurzel()) / "staende" / commit[:12] / FIXTURE_UNTER_STAND / f"{gebirge}.json"
    return stand if stand.exists() else None


def lade_optimierung(ordner: Path | str, cache: Path | str | None = None, labor: Path | None = None) -> OptimierungsDaten:
    ordner = Path(ordner)
    db = Speicher(ordner / "lauf.sqlite")
    try:
        profil = parse_profil(db.meta("profil"))
        commit = str(db.meta("commit"))
        phasen = {(p["typ"], p["name"]): p for p in db.phasen()}
        typen: dict[str, TypDaten] = {}
        for t in profil.typen:
            td = TypDaten(t.typ, t.gebirge, {n: phasen.get((t.typ, n)) for n in STUFEN})
            td.kandidaten = kandidaten_1x(db, t.typ, profil)
            td.vorschlag = td.daten("vorschlag")
            typen[t.typ] = td
        stand_datei = ordner / "stand.json"
        vorschlaege = sorted(ordner.glob("vorschlag-*.json"))
        return OptimierungsDaten(
            ordner=ordner, profil=profil, commit=commit, status=str(db.meta("status", "?")), begonnen=db.meta("begonnen"),
            stand=json.loads(stand_datei.read_text(encoding="utf-8")) if stand_datei.exists() else {}, grenzen=db.meta("grenzen"), typen=typen,
            vorschlag=json.loads(vorschlaege[-1].read_text(encoding="utf-8")) if vorschlaege else None, ereignisse=db.ereignisse("meldung"),
            cache=Zwischenspeicher(Path(cache) if cache else (labor or daten_wurzel()) / "cache"), messungen=db.zaehle_messungen("ok"), fehlgeschlagen=db.zaehle_messungen("fehler"),
        )
    finally:
        db.schliesse()


def kandidaten_1x(db: Speicher, typ: str, profil: Profil, variante: str = "gezeichnet") -> list[dict[str, Any]]:
    """Alle Kandidaten bei 1× in der Optimierung, je mit den Kennzahlen über ihre gerechneten Saaten und dem Urteil des Formtors gegen die Vorgabe derselben Saaten."""
    kand = {k["id"]: k for k in db.kandidaten(typ, variante)}
    gruppiert: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for m in db.messungen(rolle="optimierung", aufloesung=1):
        if m["kandidat_id"] in kand and m["status"] == "ok" and m["werte"]:
            gruppiert[m["kandidat_id"]].append(m)
    basis_id = next((k["id"] for k in kand.values() if not k["werte"]), None)
    basis = {m["saat"]: m["werte"] for m in gruppiert.get(basis_id, [])} if basis_id is not None else {}
    aus: list[dict[str, Any]] = []
    for kid, ms in gruppiert.items():
        f = fasse_saaten([m["werte"] for m in ms])
        gleiche = [basis[m["saat"]] for m in ms if m["saat"] in basis]
        tor_ok, verstoesse = (True, [])
        if gleiche and f["d1"]["mittel"] is not None:
            tor_ok, verstoesse = pruefe_tor(f["komponenten"], fasse_saaten(gleiche)["komponenten"], profil.tor_faktor)
        aus.append({
            "id": kid, "kandidat": kand[kid]["werte"], "herkunft": kand[kid]["herkunft"], "saaten": sorted(m["saat"] for m in ms), "n_saaten": len(ms),
            "d1": f["d1"]["mittel"], "form_verlust": None if f["form"]["mittel"] is None else 1.0 - f["form"]["mittel"], "zeit_s": None if f["wall_ms"]["mittel"] is None else f["wall_ms"]["mittel"] / 1000.0,
            "tor_ok": bool(tor_ok), "verstoesse": verstoesse, "ist_vorgabe": not kand[kid]["werte"],
        })
    return aus


def messung_der(db_ordner: Path, typ: str, kandidat: dict[str, Any], aufloesung: int, saat: str, rolle: str = "optimierung", variante: str = "gezeichnet") -> dict[str, Any] | None:
    """Eine einzelne gespeicherte Messung (für Bilder und Profile); ``None``, wenn es sie nicht gibt."""
    from terrainlab.optimierung.raum import Raum

    db = Speicher(Path(db_ordner) / "lauf.sqlite")
    try:
        z = db.db.execute("SELECT id FROM kandidat WHERE typ=? AND variante=? AND hash=?", (typ, variante, Raum.schluessel(kandidat, variante))).fetchone()
        return None if z is None else db.messung(int(z["id"]), aufloesung, saat, rolle)
    finally:
        db.schliesse()


def raster_zu(daten: OptimierungsDaten, messung: dict[str, Any]) -> Path | None:
    """Der Rasterordner im Zwischenspeicher zu einer Messung; ``None``, wenn er fehlt (Zwischenspeicher aufgeräumt)."""
    if not messung or not messung.get("commit_sha") or not messung.get("auftrag_fingerprint"):
        return None
    ordner = daten.cache.raster_ordner(messung["commit_sha"], messung["auftrag_fingerprint"])
    return ordner if (ordner / "meta.json").exists() else None
