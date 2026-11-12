"""Befehl ``python -m terrainlab deskriptoren`` und die Dokumentation der Metriken."""

import json
import re
from pathlib import Path

import pytest

from terrainlab.__main__ import main
from terrainlab.deskriptoren import Metrikvektor, berechne
from terrainlab.deskriptoren import synthetisch as syn
from terrainlab.deskriptoren.kern import familie
from terrainlab.raster import schreibe

pytestmark = pytest.mark.filterwarnings("error")

DOKU = Path(__file__).resolve().parents[1] / "docs" / "deskriptoren.md"


def test_cli_schreibt_json_und_vergleich(tmp_path, capsys):
    schreibe(syn.fbm((128, 128), 30.0, seed=1), tmp_path / "a")
    schreibe(syn.fbm((128, 128), 30.0, seed=2), tmp_path / "b")
    aus, vgl = tmp_path / "out" / "a.json", tmp_path / "out" / "vgl.json"
    code = main(["deskriptoren", str(tmp_path / "a.json"), "--json", str(aus), "--vergleich", str(tmp_path / "b.json"), "--json-vergleich", str(vgl), "--ohne-teuer", "--zeiten"])
    assert code == 0
    ausgabe = capsys.readouterr().out
    assert "Hangneigung" in ausgabe or "hang_neigung_mittel" in ausgabe
    assert "Laufzeit gesamt" in ausgabe
    v = Metrikvektor.lies(aus)
    assert v.kopf["teuer"] is False and v["hoehe_relief"] > 0
    assert not any(m.kosten == "hoch" for m in v.metriken)
    assert v.kopf["zellgroesse_m"] == 30.0
    vergleich = json.loads(vgl.read_text(encoding="utf-8"))
    assert "hang_neigung" in vergleich["verteilungen"] and vergleich["kopf"]["zellgroesse_m"] == 30.0


def test_cli_gruppenauswahl_und_ruhig(tmp_path, capsys):
    schreibe(syn.fbm((64, 64), 30.0, seed=1), tmp_path / "a")
    aus = tmp_path / "v.json"
    assert main(["deskriptoren", str(tmp_path / "a"), "--json", str(aus), "--gruppen", "hoehe,hang", "--ruhig"]) == 0
    assert capsys.readouterr().out == ""
    v = Metrikvektor.lies(aus)
    assert {m.gruppe for m in v.metriken} == {"hoehe", "hang"}
    with pytest.raises(ValueError, match="unbekannte Gruppen"):
        main(["deskriptoren", str(tmp_path / "a"), "--gruppen", "quatsch", "--ruhig"])


def test_jede_metrikfamilie_ist_dokumentiert():
    text = DOKU.read_text(encoding="utf-8")
    vorhanden = set(re.findall(r"`([A-Za-z0-9_{}]+)`", text))
    v = berechne(syn.fbm((192, 192), 30.0, seed=3))
    fehlend = sorted({m.familie for m in v.metriken} - vorhanden)
    assert not fehlend, f"nicht in docs/deskriptoren.md: {fehlend}"
    verteilungen = sorted({familie(n) for n in v.verteilungen} - vorhanden)
    assert not verteilungen, f"Verteilungen nicht dokumentiert: {verteilungen}"
    reihen = sorted(set(v.reihen) - vorhanden)
    assert not reihen, f"Reihen nicht dokumentiert: {reihen}"
