"""Befehle des Referenzkorpus im Ganzen: liste, fenster, vorschau, lokale Quellen, Tiefprüfung der Rohköpfe. Ohne Netz."""

from __future__ import annotations

import json

import numpy as np
import pytest

from terrainlab.referenz import manifest as mf

from test_referenz_hilfen import Werkstatt, ebene, eintrag_dict, rezept_dict, schreibe_geotiff
from terrainlab.referenz.jsonschreiber import zu_text

X0, Y_OBEN = 500000.0, 5200000.0
FENSTER = [X0 + 1500.0, Y_OBEN - 1500.0 - 2250.0, X0 + 1500.0 + 3000.0, Y_OBEN - 1500.0]


def _bezogen(tmp_path) -> Werkstatt:
    w = Werkstatt(tmp_path)
    quelle = schreibe_geotiff(w.quellen / "quelle.tif", ebene(1200, 900, 10.0), X0, Y_OBEN, 10.0, 10.0, 32632, nodata=-9999.0)
    w.lege_an([eintrag_dict("test-ebene")], {"test-ebene": rezept_dict("test-ebene", [str(quelle)], "EPSG:32632", FENSTER)})
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    return w


def test_liste_zeigt_zustand(tmp_path, capsys):
    w = _bezogen(tmp_path)
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    capsys.readouterr()
    assert w.befehl("liste") == 0
    zeile = [z for z in capsys.readouterr().out.splitlines() if z.startswith("test-ebene")][0]
    assert "kettengebirge" in zeile and "optimierung" in zeile and "ja" in zeile


def test_fenster_befehl_liefert_ein_raster_aufs_750er_netz(capsys):
    from terrainlab.__main__ import main

    assert main(["referenz", "fenster", "--crs", "utm-nad83", "--mitte", "-86.0", "37.1", "--breite-km", "60", "--hoehe-km", "48"]) == 0
    ausgabe = json.loads(capsys.readouterr().out)
    assert ausgabe["crs"] == "EPSG:26916"
    x0, y0, x1, y1 = ausgabe["fenster"]
    assert (x1 - x0, y1 - y0) == (60000.0, 48000.0)
    assert x0 % 750 == 0 and y0 % 750 == 0


def test_vorschau_schreibt_ein_bild(tmp_path):
    w = _bezogen(tmp_path)
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("vorschau", "test-ebene", "--stufe", "187_5m") == 0
    bild = w.pfade().ref_ordner("test-ebene") / "vorschau-187_5m.png"
    assert bild.is_file() and bild.read_bytes()[:4] == b"\x89PNG"
    assert w.befehl("vorschau", "test-ebene", "--stufe", "gibt-es-nicht") == 1


def test_aufbereiten_ohne_bezug_und_holen_ohne_rezept_scheitern_sauber(tmp_path):
    w = Werkstatt(tmp_path)
    w.lege_an([eintrag_dict("test-ebene")], {"test-ebene": rezept_dict("test-ebene", ["x.tif"], "EPSG:32632", FENSTER)})
    assert w.befehl("aufbereiten", "test-ebene") == 1  # keine Quelldateien im Manifest


def test_tiefpruefung_findet_abweichende_rohkoepfe(tmp_path):
    w = _bezogen(tmp_path)
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("pruefen", "--tief") == 0
    manifest = w.lade_manifest()
    manifest["ausschnitte"][0]["quelle"]["raster_info"]["pixel_x"] = 30.0
    w.manifest.write_text(zu_text(manifest), encoding="utf-8")
    assert w.befehl("pruefen") == 0  # ohne --tief liest niemand den Rohkopf
    assert w.befehl("pruefen", "--tief") == 1


def test_lokale_quelle_wird_erfasst_statt_geholt(tmp_path):
    w = Werkstatt(tmp_path)
    roh = w.daten / "referenz-roh" / "test-lokal"
    roh.mkdir(parents=True)
    schreibe_geotiff(roh / "handarbeit.tif", ebene(1200, 900, 10.0), X0, Y_OBEN, 10.0, 10.0, 32632)
    rezept = rezept_dict("test-lokal", [], "EPSG:32632", FENSTER)
    rezept["quelle"] = {"art": "lokal", "dateien": ["handarbeit.tif"]}
    w.lege_an([eintrag_dict("test-lokal")], {"test-lokal": rezept})
    assert w.befehl("holen", "test-lokal", "--manifest-aktualisieren") == 0
    eintrag = w.lade_manifest()["ausschnitte"][0]
    assert eintrag["quelle"]["dateien"][0]["pfad"] == "referenz-roh/test-lokal/handarbeit.tif"
    assert eintrag["quelle"]["remote"] == []
    assert w.befehl("aufbereiten", "test-lokal", "--manifest-aktualisieren") == 0
    assert w.befehl("pruefen") == 0
    # fehlende lokale Datei: klarer Fehler statt Absturz
    (roh / "handarbeit.tif").unlink()
    try:
        w.befehl("holen", "test-lokal", "--erneut")
    except FileNotFoundError as fehler:
        assert "handarbeit.tif" in str(fehler)
    else:  # pragma: no cover
        raise AssertionError("fehlende lokale Quelldatei wurde nicht gemeldet")


def test_korpus_zugriff_filtert_und_laedt_geprueft(tmp_path):
    from terrainlab.referenz import korpus

    w = _bezogen(tmp_path)
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    assert [e["id"] for e in korpus.ausschnitte(manifest=w.manifest)] == ["test-ebene"]
    assert korpus.ausschnitte(typ="karst", manifest=w.manifest) == []
    assert korpus.ausschnitte(rolle="optimierung", manifest=w.manifest)[0]["typ"] == "kettengebirge"
    raster = korpus.lade_raster("test-ebene", "750m", manifest=w.manifest, daten=w.daten)
    assert raster.form == (3, 4) and raster.zellgroesse_m == 750.0
    assert 100.0 < float(raster.hoehen.min()) < float(raster.hoehen.max()) < 400.0
    with pytest.raises(KeyError, match="nicht aufbereitet"):
        korpus.lade_raster("test-ebene", "1000m", manifest=w.manifest, daten=w.daten)
    w.pfade().absolut(w.lade_manifest()["ausschnitte"][0]["raster"]["750m"]["pfad"]).with_suffix(".json").unlink()
    with pytest.raises(FileNotFoundError, match="referenz aufbereiten"):
        korpus.lade_raster("test-ebene", "750m", manifest=w.manifest, daten=w.daten)


def test_standardstufen_sind_im_manifest_und_in_den_hilfen_gleich():
    namen = [s["name"] for s in mf.STUFEN_STANDARD]
    assert namen == ["30m", "187_5m", "375m", "750m"]
    assert np.allclose([s["zellgroesse_m"] for s in mf.STUFEN_STANDARD], [30.0, 187.5, 375.0, 750.0])
