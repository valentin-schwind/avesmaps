import json
import os

import pytest

from terrainlab.lauf import cache as cache_modul
from terrainlab.lauf.cache import Zwischenspeicher, deskriptoren_quellhash
from terrainlab.lauf.sperre import Gesperrt, Sperre, Vorpruefung, pruefe_ressourcen, prozess_lebt

COMMIT = "0123456789abcdef0123456789abcdef01234567"
FP = "f" * 64


def test_raster_ordner_und_atomares_veroeffentlichen(tmp_path):
    c = Zwischenspeicher(tmp_path)
    assert c.hole_raster(COMMIT, FP) is None
    tmp = c.neuer_ordner(COMMIT, FP)
    assert tmp.name.endswith(".tmp")
    (tmp / "meta.json").write_text(json.dumps({"zwischenstaende": None, "x": 1}), encoding="utf-8")
    # Solange der Ordner nicht veröffentlicht ist, trifft der Schlüssel nichts: ein halber Lauf zählt nicht.
    assert c.hole_raster(COMMIT, FP) is None
    ziel = c.veroeffentliche(tmp, COMMIT, FP)
    assert ziel == c.raster_ordner(COMMIT, FP) and not tmp.exists()
    assert c.hole_raster(COMMIT, FP)["x"] == 1


def test_zwischenstaende_werden_bei_bedarf_verlangt(tmp_path):
    c = Zwischenspeicher(tmp_path)
    tmp = c.neuer_ordner(COMMIT, FP)
    (tmp / "meta.json").write_text(json.dumps({"zwischenstaende": None}), encoding="utf-8")
    c.veroeffentliche(tmp, COMMIT, FP)
    assert c.hole_raster(COMMIT, FP, zwischenstaende=False) is not None
    assert c.hole_raster(COMMIT, FP, zwischenstaende=True) is None, "ein Eintrag ohne Zwischenstände genügt nicht, wenn sie verlangt sind"


def test_commit_und_auftrag_trennen_eintraege(tmp_path):
    c = Zwischenspeicher(tmp_path)
    assert c.raster_ordner(COMMIT, FP) != c.raster_ordner("1" + COMMIT[1:], FP)
    assert c.raster_ordner(COMMIT, FP) != c.raster_ordner(COMMIT, "e" * 64)


def test_metrik_schluessel_haengt_an_raster_parameter_und_quellen(tmp_path, monkeypatch):
    p = {"min_prominenz_m": 100.0}
    basis = Zwischenspeicher.metrik_schluessel("a" * 64, p, None, True)
    assert Zwischenspeicher.metrik_schluessel("a" * 64, p, None, True) == basis
    assert Zwischenspeicher.metrik_schluessel("b" * 64, p, None, True) != basis, "anderes Raster"
    assert Zwischenspeicher.metrik_schluessel("a" * 64, {"min_prominenz_m": 50.0}, None, True) != basis, "andere Parameter"
    assert Zwischenspeicher.metrik_schluessel("a" * 64, p, ["hang"], True) != basis, "andere Gruppen"
    assert Zwischenspeicher.metrik_schluessel("a" * 64, p, None, False) != basis, "ohne teure Metriken"
    # Ändert sich der Quelltext der Deskriptoren, ändert sich der Schlüssel.
    monkeypatch.setattr(cache_modul, "deskriptoren_quellhash", lambda: "anderer-quelltext")
    assert Zwischenspeicher.metrik_schluessel("a" * 64, p, None, True) != basis
    assert len(deskriptoren_quellhash()) == 64


def test_sperre_haelt_und_gibt_frei(tmp_path):
    pfad = tmp_path / "x.sperre"
    with Sperre(pfad, "erster"):
        assert pfad.exists()
        with pytest.raises(Gesperrt, match="erster"):
            Sperre(pfad, "zweiter").__enter__()
    assert not pfad.exists()
    with Sperre(pfad, "danach"):
        pass


def test_sperre_toter_prozess_wird_abgeraeumt(tmp_path):
    pfad = tmp_path / "x.sperre"
    # Prozesskennung weit außerhalb des Üblichen: kein lebender Prozess.
    pfad.write_text(json.dumps({"pid": 2**30, "was": "toter Lauf", "seit": "gestern"}), encoding="utf-8")
    with Sperre(pfad, "neu"):
        assert json.loads(pfad.read_text(encoding="utf-8"))["pid"] == os.getpid()
    pfad.write_text("kein json", encoding="utf-8")
    with Sperre(pfad, "nach Müll"):
        pass


def test_prozess_lebt():
    assert prozess_lebt(os.getpid())
    assert not prozess_lebt(0)
    assert not prozess_lebt(2**30)


def test_ressourcenpruefung(tmp_path):
    gemessen = pruefe_ressourcen(tmp_path, mindest_ram_mib=1, mindest_platz_gib=0.001)
    assert gemessen["ram_frei_mib"] > 1 and gemessen["platz_frei_gib"] > 0
    with pytest.raises(Vorpruefung, match="Arbeitsspeicher"):
        pruefe_ressourcen(tmp_path, mindest_ram_mib=10**9)
    with pytest.raises(Vorpruefung, match="Platz"):
        pruefe_ressourcen(tmp_path, mindest_ram_mib=1, mindest_platz_gib=10**9)
