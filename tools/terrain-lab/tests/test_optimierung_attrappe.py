"""Hilfsmittel der Optimierungstests: ein Adapter, der aus den Parametern eines Auftrags ein kleines Gebirge mit bekannter Form baut (ohne Node, ohne Generator).

Das „Gebirge“ ist ein Dachkamm in Ost-West-Richtung mit einem Gipfel und zwei Nebengipfeln; Rauschen und Körnung lassen es rau werden. Zwei Regeln erlauben, das
Formtor und den Strategievergleich zu prüfen: Ein sehr hohes ``plateau`` ebnet den Kamm ein (der Grat verfehlt das Soll), und eine Gebirgsdatei ohne Kämme verschiebt den
Kamm um 1,2 E (so wie ein Modell, das die gezeichnete Linie nicht kennt).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from terrainlab.deskriptoren.synthetisch import fbm
from terrainlab.lauf.adapter import AuftragsInfo
from terrainlab.lauf.cache import kanonisch
from terrainlab.raster import Hoehenraster, schreibe

COMMIT = "c" * 40
MIN_X, MIN_Y, KANTE_E = 100.0, 200.0, 12.0

FIXTURE = {
    "name": "Probe",
    "area": "probe",
    "input": {
        "bounds": {"min_x": MIN_X, "min_y": MIN_Y, "max_x": MIN_X + KANTE_E, "max_y": MIN_Y + KANTE_E},
        "regler": {"maximalhoehe": 2000, "rauschen": 0.5},
        "saat": 7,
        "peaks": [{"x": 105.0, "y": 206.0, "h": 2000}],
        "nebengipfel": [{"x": 108.0, "y": 206.0, "h": 1700}, {"x": 102.0, "y": 206.0, "h": 1500}],
        "kaemme": [{"punkte": [[102.0, 206.0], [110.0, 206.0]], "rang": "haupt"}],
        "fluesse": [],
    },
}

GRENZEN = {
    "format": "avesmaps-terrainlab-grenzen",
    "version": 1,
    "stand": {"art": "stand", "commit": COMMIT, "baum_sauber": True},
    "fassung": 19,
    "fassung_hat_presets": True,
    "typen": ["kettengebirge", "karst"],
    "muster": ["rauschen", "zellen"],
    "v12": {
        "werte": ["plateau", "rauschen", "koernung", "bergform"],
        "grenzen": {
            "plateau": {"min": 0, "max": 1, "schritt": 0.05, "gruppe": "form"},
            "rauschen": {"min": 0, "max": 1, "schritt": 0.01, "gruppe": "form"},
            "koernung": {"min": 1, "max": 100, "schritt": 0.1, "gruppe": "fein"},
            "bergform": {"min": 0, "max": 12, "schritt": 0.1, "gruppe": "fein"},
        },
        "kammhoehe": {"min": 0, "max": 20000, "schritt": 50},
    },
    "modell": {},
    "rueckennetz": [{"id": "form.breite", "gruppe": "form", "min": 0.3, "max": 4, "schritt": 0.05}, {"id": "gratMin", "gruppe": "ziel", "min": 0, "max": 0.4, "schritt": 0.01}],
    "basis": {
        "kettengebirge": {"werte": {"plateau": 0.5, "rauschen": 0.5, "koernung": 9, "bergform": 2.5}, "muster": "rauschen", "rueckennetz": {"form.breite": 1.2, "gratMin": 0.2}},
        "karst": {"werte": {"plateau": 0.85, "rauschen": 0.9, "koernung": 18, "bergform": 10.5}, "muster": "rauschen", "rueckennetz": {"form.breite": 1.4, "gratMin": 0.12}},
    },
}


def schreibe_stand(ordner: Path) -> Path:
    ziel = ordner / "apps" / "server" / "test" / "fixtures" / "rueckennetz"
    ziel.mkdir(parents=True, exist_ok=True)
    (ziel / "probe.json").write_text(json.dumps(FIXTURE), encoding="utf-8")
    return ordner


def baue_raster(auftrag: dict[str, Any], aufloesung: int) -> Hoehenraster:
    """Das Probegebirge zu den Parametern des Auftrags; Zeile 0 = Nord, außerhalb einer Ellipse NoData."""
    typ = auftrag["typ"]
    basis = GRENZEN["basis"][typ]
    preset = (((auftrag["rezept"].get("ueberlagerung") or {}).get("presets") or {}).get("typen") or {}).get(typ, {})
    werte = {**basis["werte"], **preset.get("werte", {})}
    gebirge = auftrag["gebirge"]
    ohne_kamm = "datei" in gebirge
    zelle_e = 0.25 / aufloesung
    n = int(round(KANTE_E / zelle_e)) + 1
    zeile, spalte = np.mgrid[0:n, 0:n]
    x, y = MIN_X + spalte * zelle_e, MIN_Y + (n - 1 - zeile) * zelle_e
    achse = 206.0 + (1.2 if ohne_kamm else 0.0)
    flanke = 0.2 * (0.15 if werte["plateau"] > 0.9 else 1.0)
    h = 1500.0 - flanke * np.abs(y - achse) * 3000.0
    saat = auftrag["saat"] if auftrag["saat"] is not None else FIXTURE["input"]["saat"]
    rauschen = fbm((n, n), zelle_e * 3000.0, relief_m=1.0, seed=int(saat), zentrum_m=0.0).hoehen.astype(np.float64)
    amplitude = 600.0 * werte["rauschen"] * (werte["koernung"] / 9.0) ** 0.5
    h = h + (rauschen - 0.5) * amplitude
    # Die Bergform wirkt nur bei einer Kammschärfe (plateau) über 0,45: eine Wechselwirkung, die wenige Morris-Trajektorien verfehlen können.
    h = h + 4.0 * werte["bergform"] * (1.0 if werte["plateau"] > 0.45 else 0.0)
    if not ohne_kamm:
        for p in [*FIXTURE["input"]["peaks"], *FIXTURE["input"]["nebengipfel"]]:
            i, j = int(round((p["x"] - MIN_X) / zelle_e)), int(round((p["y"] - MIN_Y) / zelle_e))
            h[n - 1 - j, i] = p["h"]
    else:
        p = FIXTURE["input"]["peaks"][0]
        i, j = int(round((p["x"] - MIN_X) / zelle_e)), int(round((p["y"] - MIN_Y) / zelle_e))
        h[n - 1 - j, i] = p["h"]
    maske = ((x - (MIN_X + KANTE_E / 2)) / (KANTE_E / 2)) ** 2 + ((y - (MIN_Y + KANTE_E / 2)) / (KANTE_E / 2)) ** 2 <= 1.0
    h = np.where(maske, h, np.nan)
    herkunft = {"grenzen_e": {"min_x": MIN_X, "min_y": MIN_Y, "max_x": MIN_X + (n - 1) * zelle_e, "max_y": MIN_Y + (n - 1) * zelle_e}, "zellweite_e": zelle_e}
    return Hoehenraster(h.astype(np.float32), zelle_e * 3000.0, herkunft)


class OptAttrappe:
    """Schreibt, was ``rechne.ts`` schriebe. ``nach_rechnungen``: nach so vielen Rechnungen legt sie die Datei STOP in ``stop_ordner`` an."""

    def __init__(self, ordner: Path, nach_rechnungen: int | None = None, stop_ordner: Path | None = None) -> None:
        self.stand = schreibe_stand(Path(ordner) / "stand")
        self.rechnungen = 0
        self.aufrufe: list[dict[str, Any]] = []
        self.grenzen_aufrufe = 0
        self.nach_rechnungen, self.stop_ordner = nach_rechnungen, stop_ordner

    def grenzen(self, commit: str | None = None, fassung: int | None = None, timeout: float | None = None) -> dict[str, Any]:
        self.grenzen_aufrufe += 1
        return json.loads(json.dumps(GRENZEN))

    def stand_vorbereiten(self, commit: str, timeout: float | None = None) -> Path:
        return self.stand

    def fingerprint(self, auftrag: dict[str, Any], commit: str | None = None, timeout: float | None = None) -> AuftragsInfo:
        rest = {k: v for k, v in auftrag.items() if k != "name"}
        if "datei" in rest["gebirge"]:  # der Inhalt zählt, nicht der Pfad
            rest["gebirge"] = {"datei": hashlib.sha256(Path(rest["gebirge"]["datei"]).read_bytes()).hexdigest()}
        fp = hashlib.sha256(kanonisch(rest).encode()).hexdigest()
        return AuftragsInfo(fp, commit or COMMIT, True, (), auftrag.get("name", "a"), auftrag["stufe"])

    def rechne(self, auftrag: dict[str, Any], ausgabe: Path, *, commit: str | None = None, warm: int = 0, phasen: bool = False, phasen_wiederholungen: int = 3,
               arbeiter: int | None = None, ohne_raster: bool = False, schmutzig_erlauben: bool = False, timeout: float | None = None) -> dict[str, Any]:
        ausgabe = Path(ausgabe)
        ausgabe.mkdir(parents=True, exist_ok=True)
        self.aufrufe.append(auftrag)
        self.rechnungen += 1
        endgelaende = auftrag["stufe"] == "endgelaende-lokal"
        a = 2 if endgelaende else auftrag["vorschau"]["aufloesung"]  # das feine Gitter des Endgeländes hat 375 m je Zelle
        name = "endgelaende" if endgelaende else f"vorschau-{a}x"
        r = baue_raster(auftrag, a)
        pfad = schreibe(r, ausgabe / name)
        zeit = 100.0 * a * a
        meta = {
            "format": "avesmaps-terrainlab-lauf", "version": 1, "stufe": auftrag["stufe"], "auftrag": auftrag,
            "stand": {"art": "stand", "commit": commit or COMMIT, "baum_sauber": True, "reproduzierbar": True},
            "rezept": {"fassung": 19, "fingerprint": "r" * 64},
            "raster": {"breite": r.form[1], "hoehe": r.form[0], "zellgroesse_m": r.zellgroesse_m, "zellen": r.form[0] * r.form[1], "eigene_zellen": int(np.isfinite(r.hoehen).sum()),
                       "ergebnis_fingerprint": hashlib.sha256(r.hoehen.tobytes()).hexdigest(),
                       "dateien": [{"name": name, "datei": f"{name}.json", "sha256": json.loads(pfad.read_text(encoding="utf-8"))["sha256"], "breite": r.form[1],
                                    "hoehe": r.form[0], "zellgroesse_m": r.zellgroesse_m}]},
            "umgebung": {"node": "24.0.0", "kerne": 24},
            "laeufe": [{"art": "kalt", "wall_ms": zeit, "cpu_ms": zeit * 1.2, "rss_spitze_mib": 150.0 + a, "rss_ende_mib": 120.0, "fremdlast_kerne": 0.5, "maschine_prozent": 5.0}],
            "deterministisch": True, "zusatz": {"talboden": 0.2},
        }
        (ausgabe / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        if self.nach_rechnungen is not None and self.rechnungen == self.nach_rechnungen and self.stop_ordner is not None:
            (Path(self.stop_ordner) / "STOP").write_text("STOP\n", encoding="utf-8")
        return meta


def referenzen(monkeypatch: Any) -> None:
    """Zwei künstliche Referenzausschnitte je Typ und Rolle in allen drei Maßstäben (rauer als das Probegebirge)."""
    from terrainlab.referenz import korpus

    zellen = {"750m": 750.0, "375m": 375.0, "187_5m": 187.5}

    def ausschnitte(typ=None, rolle=None, manifest=None):
        return [{"id": f"{t}-{r}", "typ": t, "rolle": r, "raster": {s: {"sha256": "x"} for s in zellen}} for t in ("kettengebirge", "karst") for r in ("optimierung", "validierung")
                if (typ is None or t == typ) and (rolle is None or r == rolle)]

    def lade_raster(ausschnitt_id, stufe, manifest=None, daten=None, pruefen=True):
        nr = {"optimierung": 1, "validierung": 2}[ausschnitt_id.split("-")[1]]
        kante = {"750m": 64, "375m": 96, "187_5m": 128}[stufe]
        return fbm((kante, kante), zellen[stufe], beta=2.2, relief_m=1500.0, seed=nr * 11, zentrum_m=500.0)

    monkeypatch.setattr(korpus, "ausschnitte", ausschnitte)
    monkeypatch.setattr(korpus, "lade_raster", lade_raster)
