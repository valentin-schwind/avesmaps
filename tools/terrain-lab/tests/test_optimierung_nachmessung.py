"""Nachmessung einer Vorschlagsdatei an einem anderen Generator-Stand (ohne Generator, mit der Attrappe)."""

import json

import pytest

from terrainlab.__main__ import main
from terrainlab.optimierung.nachmessung import FORMAT_NACHMESSUNG, kandidat_der_datei, nachmessen, profil_aus_vorschlag, tabelle, uebertrage
from terrainlab.optimierung.raum import Raum

from test_optimierung_attrappe import GRENZEN
from test_optimierung_lauf import neuer_lauf

pytestmark = pytest.mark.filterwarnings("error")


@pytest.fixture(autouse=True)
def reichlich_speicher(monkeypatch):
    monkeypatch.setattr("terrainlab.optimierung.auswerter.arbeitsspeicher_mib", lambda: (100000.0, 100000.0))


@pytest.fixture()
def vorschlag(tmp_path, monkeypatch):
    """Eine echte (kleine) Vorschlagsdatei, deren Typ einen bekannten Kandidaten trägt, dazu einer mit Altlasten: unbekannter Parameter, Wert außerhalb, Wert wie die neue Vorgabe."""
    lauf, adapter, cache = neuer_lauf(tmp_path, monkeypatch, name="alt")
    assert lauf.laufe() == 0
    lauf.schliesse()
    datei = next((tmp_path / "alt").glob("vorschlag-probe-*.json"))
    v = json.loads(datei.read_text(encoding="utf-8"))
    e = v["typen"]["kettengebirge"]
    e.update(status="bestaetigt", kandidat={"v12.rauschen": 0.3, "v12.koernung": 5.0, "netz.form.breite": 2.0, "muster": "zellen", "v12.gibtsnicht": 1, "v12.bergform": 99, "v12.plateau": 0.5})
    neu = tmp_path / "vorschlag.json"
    neu.write_text(json.dumps(v), encoding="utf-8")
    return neu, adapter, cache


def test_profil_aus_der_datei(vorschlag):
    datei, _, _ = vorschlag
    v = json.loads(datei.read_text(encoding="utf-8"))
    p = profil_aus_vorschlag(v, "a" * 40)
    assert p.commit == "a" * 40 and p.saaten == [None, 11, 22] and [t.typ for t in p.typen] == ["kettengebirge"]
    assert p.strategien["aktiv"] is False and p.validierung["beste"] == 1 and p.validierung["aufloesungen"] == [2, 4] and p.validierung["saaten"] == 2
    assert p.plausibilitaet.als_dict() == v["bewertung"]["plausibilitaet"] and p.tor_faktor == v["bewertung"]["tor_faktor"]


def test_kandidat_der_datei():
    assert kandidat_der_datei({"status": "bestaetigt", "kandidat": {"v12.rauschen": 0.3}}) == ({"v12.rauschen": 0.3}, "vorschlag")
    assert kandidat_der_datei({"status": "vorgabe_bleibt", "beste_unbestaetigt": {"kandidat": {"muster": "zellen"}}}) == ({"muster": "zellen"}, "unbestaetigt")
    assert kandidat_der_datei({"status": "vorgabe_bleibt", "beste_unbestaetigt": None}) == ({}, "keiner")


def test_uebertrage_nennt_was_wegfaellt():
    raum = Raum.aus_grenzen(GRENZEN, "kettengebirge")
    kand, weg = uebertrage(raum, {"v12.rauschen": 0.3, "v12.gibtsnicht": 1, "v12.bergform": 99, "v12.plateau": 0.5, "muster": "zellen", "netz.form.breite": 2.0})
    assert kand == {"v12.rauschen": 0.3, "muster": "zellen", "netz.form.breite": 2.0}
    assert weg == {"unbekannt": ["v12.gibtsnicht"], "ausserhalb": ["v12.bergform"], "gilt_schon": ["v12.plateau"]}


def test_nachmessung_misst_vorgabe_und_kandidat_neu_und_setzt_fort(tmp_path, vorschlag):
    datei, adapter, cache = vorschlag
    ziel = tmp_path / "neu"
    erg = nachmessen(datei, "HEAD", adapter, ordner=ziel, cache=cache)
    assert erg["format"] == FORMAT_NACHMESSUNG and erg["saaten"] == ["fixture", "11", "22"]
    e = erg["typen"]["kettengebirge"]
    assert e["art"] == "vorschlag" and e["kandidat"] == {"muster": "zellen", "netz.form.breite": 2.0, "v12.koernung": 5.0, "v12.rauschen": 0.3}
    assert e["weggefallen"]["unbekannt"] == ["v12.gibtsnicht"] and e["weggefallen"]["ausserhalb"] == ["v12.bergform"] and e["weggefallen"]["gilt_schon"] == ["v12.plateau"]
    assert e["vorgabe_neu"]["d1"] is not None and e["kandidat_neu_1x"]["d1"] is not None and set(e["vorgabe_neu"]["komponenten"]) >= {"gipfel_exakt", "grat", "kammlage"}
    assert set(e["validierung"]["kandidat"]) == {"2", "4"} and e["bestaetigt_neu"] in (True, False)
    assert e["validierung"]["vorgabe"]["2"]["validierung"]["d1"] is not None
    assert json.loads((ziel / "nachmessung.json").read_text(encoding="utf-8"))["typen"]["kettengebirge"]["kandidat"] == e["kandidat"]
    text = tabelle(erg)
    assert "Vorgabe 1×" in text and "Kandidat 1×" in text and "Validierung 2" in text and "Weggefallen (kennt der neue Stand nicht): v12.gibtsnicht" in text and "Am neuen Stand:" in text
    assert "Abstand 0," in text, "Zahlen mit Dezimalkomma"
    # Fortsetzen im selben Ordner: nichts wird noch einmal gerechnet.
    n = adapter.rechnungen
    erneut = nachmessen(datei, "HEAD", adapter, ordner=ziel, cache=cache)
    assert adapter.rechnungen == n and erneut["typen"]["kettengebirge"]["kandidat_neu_1x"]["d1"] == e["kandidat_neu_1x"]["d1"]


def test_ein_typ_ohne_kandidat_misst_nur_die_vorgabe(tmp_path, vorschlag):
    datei, adapter, cache = vorschlag
    v = json.loads(datei.read_text(encoding="utf-8"))
    v["typen"]["kettengebirge"].update(status="vorgabe_bleibt", kandidat=None, beste_unbestaetigt=None)
    leer = tmp_path / "leer.json"
    leer.write_text(json.dumps(v), encoding="utf-8")
    erg = nachmessen(leer, "HEAD", adapter, ordner=tmp_path / "leer", cache=cache)
    e = erg["typen"]["kettengebirge"]
    assert e["art"] == "keiner" and e["kandidat_neu_1x"] is None and e["bestaetigt_neu"] is None and e["vorgabe_neu"]["d1"] is not None
    assert "Kein Kandidat" in tabelle(erg)


def test_befehl_nachmessen(tmp_path, monkeypatch, vorschlag, capsys):
    datei, adapter, _ = vorschlag
    monkeypatch.setenv("AVESMAPS_TERRAIN_LAB", str(tmp_path / "labor"))  # der Zwischenspeicher des Befehls liegt im Prüfordner, nicht im echten Labor
    monkeypatch.setattr("terrainlab.optimierung.cli.Adapter", lambda *a, **k: adapter)
    monkeypatch.setattr("terrainlab.optimierung.cli.pruefe_ressourcen", lambda *a, **k: None)
    assert main(["optimierung", "nachmessen", str(datei), "--commit", "HEAD", "--ausgabe", str(tmp_path / "cli"), "--ohne-sperre"]) == 0
    assert "Nachmessung: Vorschlag vom Stand" in capsys.readouterr().out and (tmp_path / "cli" / "nachmessung.json").exists()
    assert main(["optimierung", "nachmessen", str(tmp_path / "nichts.json"), "--commit", "HEAD"]) == 2
    assert main(["optimierung", "nachmessen", str(tmp_path / "alt"), "--commit", "HEAD", "--ausgabe", str(tmp_path / "cli2"), "--ohne-sperre", "--versuche", "1"]) == 10

