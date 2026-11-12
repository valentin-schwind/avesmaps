"""Der echte Adapter für die Optimierung: Grenzen aus den Verträgen des Generators und eine Überlagerung „19 (Test)“, die der Generator annimmt. Übersprungen ohne Node."""

import shutil

import numpy as np
import pytest

from terrainlab.lauf.adapter import Adapter, AdapterFehler
from terrainlab.lauf.umgebung import adapter_skript, grenzen_skript, repo_wurzel
from terrainlab.optimierung.raum import GANZ, Raum
from terrainlab.raster import lies

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not adapter_skript().exists() or not grenzen_skript().exists() or not (repo_wurzel() / "apps" / "server" / "test" / "fixtures" / "rueckennetz").exists(),
    reason="Node oder Repository nicht vorhanden",
)


@pytest.fixture(scope="module")
def adapter(tmp_path_factory):
    return Adapter(labor=tmp_path_factory.mktemp("labor"))


@pytest.fixture(scope="module")
def grenzen(adapter):
    return adapter.grenzen(None, 19)


def test_grenzen_stehen_im_vertrag_des_generators(grenzen):
    assert grenzen["format"] == "avesmaps-terrainlab-grenzen" and grenzen["fassung"] == 19 and grenzen["fassung_hat_presets"] is True
    assert len(grenzen["typen"]) == 11 and "kettengebirge" in grenzen["typen"] and grenzen["muster"] == ["rauschen", "zellen"]
    assert grenzen["v12"]["werte"] == ["hypsometrie", "plateau", "rauschen", "einschnitt", "erosion", "talbreite", "koernung", "stufen", "bergform", "sattel"]
    assert grenzen["v12"]["grenzen"]["erosion"] == {"min": 0, "max": 5, "schritt": 1, "gruppe": "form"}
    # Die Typwerte des Rückennetzes sind der Vertrag des Generators: 15 bis WI-0249 P1, mit P2 kommen `form.kopf` und `form.kammMuster` hinzu (17); das Lab liest sie, ohne dass hier etwas nachzuziehen ist.
    ids = {t["id"] for t in grenzen["rueckennetz"]}
    assert len(ids) in (15, 17) and ids >= {"form.breite", "band.ziel", "gratMin", "struktur.welle"} and (len(ids) == 17) == ("form.kopf" in ids and "form.kammMuster" in ids)
    for typ in grenzen["typen"]:
        r = Raum.aus_grenzen(grenzen, typ)
        assert len(r) == len(grenzen["v12"]["werte"]) + len(ids) + 1 and r["muster"].basis in ("rauschen", "zellen")
        for p in r.parameter[:-1]:
            assert p.min <= float(p.basis) <= p.max, (typ, p.name, p.basis)
            assert (p.art == GANZ) == (p.schritt == 1)
    assert Raum.aus_grenzen(grenzen, "karst")["v12.hypsometrie"].basis == 0, "die Vorgabe des Karsts: Legacys Wert"
    assert grenzen["basis"]["kettengebirge"]["quelle"] == "fassung" and grenzen["basis"]["kettengebirge"]["rueckennetz_quelle"] == "fassung"


def test_fassung_ohne_presets_wird_gemeldet(adapter):
    g = adapter.grenzen(None, 18)
    assert g["fassung"] == 18 and g["fassung_hat_presets"] is False
    with pytest.raises(AdapterFehler):
        adapter.grenzen(None, 9999)


def test_ueberlagerung_wird_angenommen_und_wirkt(adapter, grenzen, tmp_path):
    raum = Raum.aus_grenzen(grenzen, "bergland")
    basis = {"name": "nw", "gebirge": {"fixture": "nordwalser-hoehen"}, "typ": "bergland", "reglerQuelle": "preset", "stufe": "vorschau", "vorschau": {"aufloesung": 1}, "rezept": {"fassung": 19}}
    kand = {"v12.rauschen": 0.2, "netz.form.breite": 2.5, "muster": "rauschen"}  # Bergland rechnet mit Zellen: das Muster wechseln
    mit = {**basis, "name": "nw2", "rezept": {"fassung": 19, "ueberlagerung": raum.ueberlagerung(kand)}}
    m0 = adapter.rechne(basis, tmp_path / "a", schmutzig_erlauben=True)
    m1 = adapter.rechne(mit, tmp_path / "b", schmutzig_erlauben=True)
    assert m0["rezept"]["ueberlagert"] is False and m1["rezept"]["ueberlagert"] is True
    assert m0["raster"]["ergebnis_fingerprint"] != m1["raster"]["ergebnis_fingerprint"]
    a, b = lies(tmp_path / "a" / "vorschau-1x.json"), lies(tmp_path / "b" / "vorschau-1x.json")
    assert a.hoehen.shape == b.hoehen.shape and np.nanmax(np.abs(a.hoehen - b.hoehen)) > 1.0
    assert m1["parameter"]["regler"]["rauschen"] == 0.2 and m0["parameter"]["regler"]["rauschen"] == raum["v12.rauschen"].basis
    # Georeferenz für den Formerhalt steht im Raster.
    assert {"grenzen_e", "zellweite_e"} <= set(a.herkunft)


def test_die_vorgabe_ist_keine_ueberlagerung_und_teilt_den_fingerabdruck(adapter, grenzen):
    raum = Raum.aus_grenzen(grenzen, "kettengebirge")
    basis = {"name": "x", "gebirge": {"fixture": "nordwalser-hoehen"}, "typ": "kettengebirge", "reglerQuelle": "preset", "stufe": "vorschau", "vorschau": {"aufloesung": 1}, "rezept": {"fassung": 19}}
    gleich = {**basis, "name": "y", "rezept": {"fassung": 19, **({"ueberlagerung": raum.ueberlagerung(raum.kandidat(raum.vorgabe_einheiten()))} if raum.ueberlagerung({}) else {})}}
    assert raum.ueberlagerung({}) is None
    assert adapter.fingerprint(basis, None).auftrag_fingerprint == adapter.fingerprint(gleich, None).auftrag_fingerprint
