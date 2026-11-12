"""Der echte Adapter (Node, Generator) auf kleinen Fällen. Übersprungen, wo Node oder das Repository fehlen."""

import json
import shutil

import numpy as np
import pytest

from terrainlab.deskriptoren import berechne
from terrainlab.lauf.adapter import Adapter, AdapterFehler
from terrainlab.lauf.umgebung import adapter_skript, repo_wurzel
from terrainlab.raster import lies

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not adapter_skript().exists() or not (repo_wurzel() / "apps" / "server" / "test" / "fixtures" / "rueckennetz").exists(),
    reason="Node oder Repository nicht vorhanden",
)

# Klein und schnell (rund 0,3 s bei 1×): die Fixture mit dem kleinsten Rahmen.
AUFTRAG = {"name": "nordwalser-1x", "gebirge": {"fixture": "nordwalser-hoehen"}, "stufe": "vorschau", "vorschau": {"aufloesung": 1}, "rezept": {"fassung": 19}}


@pytest.fixture(scope="module")
def adapter(tmp_path_factory):
    return Adapter(labor=tmp_path_factory.mktemp("labor"))


@pytest.fixture(scope="module")
def lauf(adapter, tmp_path_factory):
    ordner = tmp_path_factory.mktemp("lauf")
    meta = adapter.rechne(AUFTRAG, ordner, warm=1, phasen=True, phasen_wiederholungen=1, schmutzig_erlauben=True)
    return ordner, meta


def test_meta_enthaelt_die_messwerte(lauf):
    ordner, meta = lauf
    assert meta["format"] == "avesmaps-terrainlab-lauf" and meta["stufe"] == "vorschau"
    kalt, warm = meta["laeufe"]
    assert kalt["art"] == "kalt" and warm["art"] == "warm"
    for lauf_ in (kalt, warm):
        assert lauf_["wall_ms"] > 0 and lauf_["cpu_ms"] > 0 and lauf_["rss_spitze_mib"] > 50 and lauf_["fremdlast_kerne"] >= 0
    assert meta["deterministisch"] is True
    assert len(meta["raster"]["ergebnis_fingerprint"]) == 64
    assert meta["stand"]["commit"] and "baum_sauber" in meta["stand"]
    assert meta["rezept"]["fassung"] == 19 and len(meta["rezept"]["fingerprint"]) == 64
    assert meta["umgebung"]["node"].startswith("24") or int(meta["umgebung"]["node"].split(".")[0]) >= 24
    assert meta["umgebung"]["abhaengigkeiten"]["@sinclair/typebox"]
    assert meta["parameter"]["aufloesung"] == 1 and meta["parameter"]["regler"]["maximalhoehe"] == 900


def test_phasenproben_summieren_sich_zur_rechnung(lauf):
    _, meta = lauf
    p = meta["phasenproben"]
    assert p["methode"] == "differenz" and p["ergebnis_gleich"] is True, p["hinweise"]
    assert set(p["phasen_ms"]) == {"netz_hebung", "landschaft"}
    assert p["phasen_ms"]["landschaft"] > p["phasen_ms"]["netz_hebung"] >= 0


def test_raster_im_austauschformat(lauf):
    ordner, meta = lauf
    d = meta["raster"]["dateien"][0]
    r = lies(ordner / d["datei"])  # prüft die Prüfsumme
    assert r.form == (meta["raster"]["hoehe"], meta["raster"]["breite"])
    assert r.zellgroesse_m == 750.0, "0,25 E zu 3000 m"
    gueltig = np.isfinite(r.hoehen)
    assert int(gueltig.sum()) == meta["raster"]["eigene_zellen"], "außerhalb der Fläche NoData"
    assert 0 < r.hoehen[gueltig].max() <= 900 * 1.05, "Meter, höchstens die Kammhöhe der Fixture"
    assert r.herkunft["auftrag_fingerprint"] and r.herkunft["ausrichtung"].startswith("Zeile 0 = Nord")


def test_deskriptoren_lesen_das_raster(lauf):
    ordner, meta = lauf
    v = berechne(lies(ordner / meta["raster"]["dateien"][0]["datei"]), gruppen=("hoehe", "hang"), teuer=False)
    assert v["hoehe_max"] > v["hoehe_mittel"] > 0 and v["hang_neigung_mittel"] > 1


def test_zweiter_prozess_liefert_dieselben_bytes(adapter, lauf, tmp_path):
    _, meta = lauf
    zweiter = adapter.rechne(AUFTRAG, tmp_path, ohne_raster=True, schmutzig_erlauben=True)
    assert zweiter["raster"]["ergebnis_fingerprint"] == meta["raster"]["ergebnis_fingerprint"]
    assert zweiter["laeufe"][0]["art"] == "kalt" and len(zweiter["laeufe"]) == 1
    assert not list(tmp_path.glob("*.f32")), "--ohne-raster schreibt kein Raster"


def test_auftragsfingerprint(adapter):
    a = adapter.fingerprint(AUFTRAG)
    assert a.auftrag_fingerprint == adapter.fingerprint({**AUFTRAG, "name": "anders"}).auftrag_fingerprint, "der Name zählt nicht"
    assert a.auftrag_fingerprint != adapter.fingerprint({**AUFTRAG, "regler": {"erosion": 9}}).auftrag_fingerprint
    assert a.auftrag_fingerprint != adapter.fingerprint({**AUFTRAG, "vorschau": {"aufloesung": 2}}).auftrag_fingerprint
    assert a.auftrag_fingerprint != adapter.fingerprint({**AUFTRAG, "rezept": {"fassung": 18}}).auftrag_fingerprint
    assert len(a.commit) == 40 and a.stufe == "vorschau"


def test_regler_aendern_das_gelaende(adapter, lauf, tmp_path):
    _, meta = lauf
    anders = adapter.rechne({**AUFTRAG, "regler": {"erosion": 9}}, tmp_path, ohne_raster=True, schmutzig_erlauben=True)
    assert anders["raster"]["ergebnis_fingerprint"] != meta["raster"]["ergebnis_fingerprint"]
    assert anders["parameter"]["regler"]["erosion"] == 9
    assert anders["eingabe_fingerprint"] != meta["eingabe_fingerprint"]


def test_fehler_der_eingabe(adapter, tmp_path):
    with pytest.raises(AdapterFehler) as fehler:
        adapter.rechne({**AUFTRAG, "stufe": "unsinn"}, tmp_path, schmutzig_erlauben=True)
    assert fehler.value.code == 2 and "stufe" in str(fehler.value)
    with pytest.raises(AdapterFehler) as fehler:
        adapter.rechne({**AUFTRAG, "gebirge": {"fixture": "gibt-es-nicht"}}, tmp_path, schmutzig_erlauben=True)
    assert fehler.value.code == 1


def test_stand_am_commit_rechnet_dasselbe(adapter, lauf, tmp_path):
    """Der Stand (git archive, eigene Abhängigkeiten) und der Arbeitsbaum geben bei sauberem Baum dieselben Bytes."""
    _, meta = lauf
    commit = adapter.fingerprint(AUFTRAG).commit
    try:
        stand = adapter.stand_vorbereiten(commit)
    except AdapterFehler as fehler:  # npm ohne Zwischenspeicher und ohne Netz
        pytest.skip(f"Stand nicht herstellbar: {fehler}")
    assert json.loads((stand / "STAND.json").read_text(encoding="utf-8"))["commit"] == commit
    im_stand = adapter.rechne(AUFTRAG, tmp_path, commit=commit, ohne_raster=True)
    assert im_stand["stand"]["art"] == "stand" and im_stand["stand"]["commit"] == commit and im_stand["stand"]["reproduzierbar"]
    if meta["stand"]["baum_sauber"]:
        assert im_stand["raster"]["ergebnis_fingerprint"] == meta["raster"]["ergebnis_fingerprint"]


def test_befehle(capsys, monkeypatch, tmp_path):
    """Die Befehlszeile: Profile auflisten, Trockenlauf, fehlender Schnappschuss, unbekanntes Profil."""
    from terrainlab.__main__ import main

    monkeypatch.setenv("AVESMAPS_TERRAIN_LAB", str(tmp_path))
    assert main(["lauf", "profile"]) == 0
    assert "schnell" in capsys.readouterr().out
    assert main(["lauf", "perf", "schnell", "--trocken", "--nur", "nordwalser"]) == 0
    aus = capsys.readouterr().out
    assert "nordwalser-hoehen-vorschau-1x" in aus and "nordwalser-hoehen-vorschau-2x" in aus and "blutzinnen" not in aus
    assert main(["lauf", "perf", "voll", "--nur", "endgelaende", "--ohne-sperre"]) == 2
    assert "Schnappschuss" in capsys.readouterr().err
    assert main(["lauf", "perf", "gibtsnicht"]) == 2
    assert main(["lauf"]) == 2
