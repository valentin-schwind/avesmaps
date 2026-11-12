"""Aufbereitung des Referenzkorpus mit synthetischen GeoTIFFs: Bezug, NoData, Resampling, Reprojektion, Prüfsummen. Ohne Netz."""

from __future__ import annotations

import numpy as np
import pytest

from terrainlab.raster import lies
from terrainlab.referenz import quellen, rezept as rz
from terrainlab.referenz.aufbereiten import blockmittel
from terrainlab.referenz.gdal_umgebung import gdal_osr

from test_referenz_hilfen import NODATA_TEST, Werkstatt, ebene, eintrag_dict, rezept_dict, schreibe_geotiff

X0, Y_OBEN = 500000.0, 5200000.0  # synthetisches Quellraster in EPSG:32632, 12 km × 9 km, 10 m
FENSTER = [X0 + 1500.0, Y_OBEN - 1500.0 - 2250.0, X0 + 1500.0 + 3000.0, Y_OBEN - 1500.0]  # 3000 × 2250 m, Kanten auf 750-m-Vielfachen


def _werkstatt(tmp_path, werte, nodata=None, crs="EPSG:32632"):
    w = Werkstatt(tmp_path)
    quelle = schreibe_geotiff(w.quellen / "quelle.tif", werte, X0, Y_OBEN, 10.0, 10.0, 32632, nodata)
    eintrag = eintrag_dict("test-ebene")
    rezept = rezept_dict("test-ebene", [str(quelle)], crs, FENSTER, nodata=None)
    w.lege_an([eintrag], {"test-ebene": rezept})
    return w


def test_blockmittel_mittelt_gueltige_zellen_und_setzt_luecken_auf_nan():
    werte = np.array([[1, 3, 5, 7], [1, 3, np.nan, np.nan], [2, 2, np.nan, np.nan], [4, 4, np.nan, np.nan]], dtype=np.float32)
    ergebnis = blockmittel(werte, 2, 0.5)
    assert ergebnis.shape == (2, 2)
    assert ergebnis[0, 0] == pytest.approx(2.0)
    assert ergebnis[0, 1] == pytest.approx(6.0)  # zwei von vier Zellen gültig = Mindestanteil 0,5
    assert ergebnis[1, 0] == pytest.approx(3.0)
    assert np.isnan(ergebnis[1, 1])  # keine gültige Zelle
    assert np.isnan(blockmittel(werte, 2, 0.75)[0, 1])  # über dem Mindestanteil nicht mehr genug gültig


def test_blockmittel_verlangt_teilbare_masse():
    with pytest.raises(ValueError, match="teilbar"):
        blockmittel(np.zeros((5, 4), np.float32), 2, 0.5)


def test_fenster_um_mitte_liegt_auf_750_m_vielfachen():
    fenster = quellen.fenster_um_mitte("EPSG:32632", 9.0, 47.0, 60000.0, 48000.0)
    assert all(v % 750.0 == 0 for v in fenster)
    assert fenster[2] - fenster[0] == 60000.0 and fenster[3] - fenster[1] == 48000.0
    _, osr = gdal_osr()
    wgs, utm = quellen.srs_aus(osr, "EPSG:4326"), quellen.srs_aus(osr, "EPSG:32632")
    x, y, _ = osr.CoordinateTransformation(wgs, utm).TransformPoint(9.0, 47.0)
    assert fenster[0] < x < fenster[2] and fenster[1] < y < fenster[3]
    with pytest.raises(ValueError, match="Vielfaches"):
        quellen.fenster_um_mitte("EPSG:32632", 9.0, 47.0, 1000.0, 48000.0)


def test_utm_kennung_nach_zone_und_datum():
    assert quellen.utm_crs(-86.0, 37.0, "nad83") == "EPSG:26916"
    assert quellen.utm_crs(9.0, 47.0, "wgs84") == "EPSG:32632"
    assert quellen.utm_crs(150.0, -33.0, "wgs84") == "EPSG:32756"


def test_rezept_lehnt_fenster_ab_dessen_zellen_nicht_aufgehen():
    daten = rezept_dict("t", ["x.tif"], "EPSG:32632", [0, 0, 3010, 2250])
    with pytest.raises(rz.RezeptFehler, match="Vielfaches der Zellgröße"):
        rz.parse(daten)
    daten = rezept_dict("t", ["x.tif"], "EPSG:32632", [0, 0, 3000, 2250])
    daten["stufen"][2]["faktor"] = 3
    with pytest.raises(rz.RezeptFehler, match="faktor"):
        rz.parse(daten)


def test_ebene_bleibt_in_allen_stufen_exakt_und_die_stufen_sind_deckungsgleich(tmp_path):
    werte = ebene(1200, 900, 10.0)
    w = _werkstatt(tmp_path, werte)
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    pfade, manifest = w.pfade(), w.lade_manifest()
    eintrag = manifest["ausschnitte"][0]
    erwartet = {"30m": (100, 75), "187_5m": (16, 12), "375m": (8, 6), "750m": (4, 3)}
    raster = {}
    for name, (breite, hoehe) in erwartet.items():
        r = lies(pfade.absolut(eintrag["raster"][name]["pfad"]).with_suffix(".json"))
        assert r.form == (hoehe, breite)
        assert r.zellgroesse_m == float({"30m": 30, "187_5m": 187.5, "375m": 375, "750m": 750}[name])
        assert not np.isnan(r.hoehen).any()
        raster[name] = r
        # Flächenmittel einer Ebene = Wert in der Zellmitte (Fenster beginnt 1500 m östlich und 1500 m südlich der Nordwestecke)
        zg = r.zellgroesse_m
        xs = 1500.0 + (np.arange(breite) + 0.5) * zg
        ys = 1500.0 + (np.arange(hoehe) + 0.5) * zg
        soll = 100.0 + 0.05 * xs[None, :] + 0.02 * ys[:, None]
        assert np.abs(r.hoehen - soll).max() < 0.01, name
    # 375 m und 750 m sind exakte Blockmittel der 187,5-m-Stufe
    assert np.allclose(raster["375m"].hoehen, blockmittel(raster["187_5m"].hoehen, 2, 0.5), atol=1e-4)
    assert np.allclose(raster["750m"].hoehen, blockmittel(raster["187_5m"].hoehen, 4, 0.5), atol=1e-4)
    assert w.befehl("pruefen") == 0


def test_nodata_der_quelle_wird_nan_und_der_anteil_stimmt(tmp_path):
    werte = ebene(1200, 900, 10.0)
    # 30-m-Zellen 20..39 × 10..19 des Fensters = Quellpixel (150 + 60 .. 150 + 120) × (150 + 30 .. 150 + 60)
    werte[180:210, 210:270] = NODATA_TEST
    w = _werkstatt(tmp_path, werte, nodata=NODATA_TEST)
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    manifest = w.lade_manifest()["ausschnitte"][0]
    r30 = lies(w.pfade().absolut(manifest["raster"]["30m"]["pfad"]).with_suffix(".json"))
    assert np.isnan(r30.hoehen).sum() == 10 * 20
    assert manifest["raster"]["30m"]["nodata_anteil"] == pytest.approx(200 / (100 * 75), abs=1e-6)
    assert np.isnan(r30.hoehen[10:20, 20:40]).all()
    assert not np.isnan(r30.hoehen[:10]).any()
    # Die Lücke ist zu groß für die Grenze des Korpus (1 %): die Prüfung meldet es.
    assert w.befehl("pruefen") == 1


def test_reprojektion_aus_geografischen_koordinaten_trifft_die_zellmitte(tmp_path):
    # Quelle in Länge/Breite (wie 3DEP), Höhe linear in Länge und Breite; Ziel UTM 32N auf einem 750-m-Fenster
    gdal, osr = gdal_osr()
    pixel = 0.0001  # ≈ 8 m × 11 m
    breite, hoehe = 1600, 1200
    lon0, lat_oben = 8.90, 47.10
    lons = lon0 + (np.arange(breite) + 0.5) * pixel
    lats = lat_oben - (np.arange(hoehe) + 0.5) * pixel
    werte = (500.0 + 20000.0 * (lons[None, :] - lon0) + 30000.0 * (lat_oben - lats[:, None])).astype(np.float32)
    w = Werkstatt(tmp_path)
    quelle = schreibe_geotiff(w.quellen / "geo.tif", werte, lon0, lat_oben, pixel, pixel, 4326)
    fenster = quellen.fenster_um_mitte("EPSG:32632", 8.98, 47.04, 6000.0, 4500.0)
    rezept = rezept_dict("test-geo", [str(quelle)], "EPSG:32632", fenster, rand_zellen=4)
    w.lege_an([eintrag_dict("test-geo")], {"test-geo": rezept})
    assert w.befehl("holen", "test-geo", "--manifest-aktualisieren") == 0
    assert w.befehl("aufbereiten", "test-geo", "--manifest-aktualisieren") == 0
    eintrag = w.lade_manifest()["ausschnitte"][0]
    assert eintrag["quelle"]["raster_info"]["einheit"] == "grad"
    assert eintrag["quelle"]["raster_info"]["crs"] == "EPSG:4326"
    r = lies(w.pfade().absolut(eintrag["raster"]["187_5m"]["pfad"]).with_suffix(".json"))
    assert r.form == (24, 32)
    assert not np.isnan(r.hoehen).any()
    utm, wgs = quellen.srs_aus(osr, "EPSG:32632"), quellen.srs_aus(osr, "EPSG:4326")
    ct = osr.CoordinateTransformation(utm, wgs)
    xs = fenster[0] + (np.arange(32) + 0.5) * 187.5
    ys = fenster[3] - (np.arange(24) + 0.5) * 187.5
    for zeile, spalte in ((0, 0), (5, 20), (23, 31), (12, 16)):
        lon, lat, _ = ct.TransformPoint(float(xs[spalte]), float(ys[zeile]))
        soll = 500.0 + 20000.0 * (lon - lon0) + 30000.0 * (lat_oben - lat)
        assert abs(float(r.hoehen[zeile, spalte]) - soll) < 0.3


def test_fenster_ausserhalb_der_quelle_wird_abgelehnt(tmp_path):
    w = _werkstatt(tmp_path, ebene(1200, 900, 10.0))
    rezept = rezept_dict("test-ebene", [str(w.quellen / "quelle.tif")], "EPSG:32632", [X0 + 9000.0, Y_OBEN - 9000.0, X0 + 12000.0, Y_OBEN - 6750.0])
    (w.rezepte / "test-ebene.json").write_text(__import__("json").dumps(rezept), encoding="utf-8")
    with pytest.raises(ValueError, match="nicht vollständig im Quellraster"):
        w.befehl("holen", "test-ebene", "--manifest-aktualisieren")


def test_holen_ist_idempotent_und_meldet_geaenderte_quelle(tmp_path, capsys):
    w = _werkstatt(tmp_path, ebene(1200, 900, 10.0))
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    vorher = w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]
    assert w.befehl("holen", "test-ebene") == 0  # nichts zu tun, kein Netz/kein Schreiben
    assert "schon da" in capsys.readouterr().out
    # Quelle ändert sich: ein neuer Bezug erkennt es am Inhalt und ändert das Manifest ohne --manifest-aktualisieren nicht.
    schreibe_geotiff(tmp_path / "quellen" / "quelle.tif", ebene(1200, 900, 10.0, a=250.0), X0, Y_OBEN, 10.0, 10.0, 32632)
    assert w.befehl("holen", "test-ebene", "--erneut") == 1
    assert w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0] == vorher
    assert w.befehl("holen", "test-ebene", "--erneut", "--manifest-aktualisieren") == 0
    assert w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]["sha256_inhalt"] != vorher["sha256_inhalt"]


def test_aufbereiten_ist_reproduzierbar_und_bemerkt_geaenderte_rohdaten(tmp_path):
    w = _werkstatt(tmp_path, ebene(1200, 900, 10.0))
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    erster = w.lade_manifest()["ausschnitte"][0]["raster"]
    assert w.befehl("aufbereiten", "test-ebene") == 0  # gleiche Prüfsummen, nichts geändert
    assert w.lade_manifest()["ausschnitte"][0]["raster"] == erster
    roh = w.pfade().absolut(w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]["pfad"])
    roh.write_bytes(roh.read_bytes() + b"x")  # Rohdatei verändert
    assert w.befehl("aufbereiten", "test-ebene") == 1
