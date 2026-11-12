"""Formerhalt (Dimension 2): gezeichnete Gipfel, Nebengipfel, Kämme und Täler gegen ein Raster mit bekannter Form."""

import json
import math

import numpy as np
import pytest

from terrainlab.bewertung.formerhalt import (
    FormFehler,
    Feld,
    Geometrie,
    KOMPONENTEN,
    Punkt,
    bewerte_form,
    finde_kopf,
    fluss_anstieg,
    lade_geometrie,
    mittel_komponenten,
    prominenz,
    pruefe_tor,
)
from terrainlab.raster import Hoehenraster

pytestmark = pytest.mark.filterwarnings("error")

ZELLE_E = 0.25
MIN_X, MIN_Y = 100.0, 200.0
N = 48  # 12 E Kantenlänge


def herkunft() -> dict:
    return {"grenzen_e": {"min_x": MIN_X, "min_y": MIN_Y, "max_x": MIN_X + (N - 1) * ZELLE_E, "max_y": MIN_Y + (N - 1) * ZELLE_E}, "zellweite_e": ZELLE_E}


def koordinaten() -> tuple[np.ndarray, np.ndarray]:
    """x und y (Karteneinheiten) je Zelle; Zeile 0 = Nord."""
    zeile, spalte = np.mgrid[0:N, 0:N]
    return MIN_X + spalte * ZELLE_E, MIN_Y + (N - 1 - zeile) * ZELLE_E


def dachkamm(versatz_e: float = 0.0, flanke: float = 0.2) -> np.ndarray:
    """Dachkamm in Ost-West-Richtung bei y = 206 (+ Versatz): z = 1500 − Flanke · |Abstand in m|; Flanke 0,2 heißt 900 m Abfall auf 1,5 E."""
    x, y = koordinaten()
    return 1500.0 - flanke * np.abs(y - (206.0 + versatz_e)) * 3000.0


def raster(h: np.ndarray) -> Hoehenraster:
    return Hoehenraster(h.astype(np.float32), ZELLE_E * 3000.0, herkunft())


def geometrie(**ueberschreibung) -> Geometrie:
    g = Geometrie(name="Probe", kammhoehe=2000.0, gipfel=[], nebengipfel=[], kaemme=[], flusse=[], mulden=[])
    for k, v in ueberschreibung.items():
        setattr(g, k, v)
    return g


def zelle_von(x: float, y: float) -> tuple[int, int]:
    return N - 1 - int(round((y - MIN_Y) / ZELLE_E)), int(round((x - MIN_X) / ZELLE_E))


def test_feld_georeferenz_und_zeilenrichtung():
    h = np.zeros((N, N))
    h[zelle_von(105.0, 206.0)] = 7.0
    f = Feld(raster(h))
    assert f.lies(105.0, 206.0)[()] == pytest.approx(7.0)
    assert f.lies(105.0, 206.25)[()] == pytest.approx(0.0)  # eine Zelle nördlicher: andere Zeile
    # Zelle (0, 0) liegt im Nordwesten: x = min_x, y = max_y.
    assert f.lies(MIN_X, MIN_Y + (N - 1) * ZELLE_E)[()] == pytest.approx(h[0, 0])
    assert math.isnan(f.lies(MIN_X - 5, MIN_Y)[()])
    with pytest.raises(FormFehler):
        Feld(Hoehenraster(h.astype(np.float32), 750.0, {}))


def test_feld_aus_fenster_des_endgelaendes():
    h = np.zeros((10, 20), dtype=np.float32)
    f = Feld(Hoehenraster(h, 375.0, {"fenster_e": {"gitter": 8192, "gx0": 100, "gy0_nord": 200, "breite": 20, "hoehe": 10}}))
    assert f.cell == pytest.approx(0.125)
    assert f.min_x == pytest.approx(100.5 * 0.125)
    # Zeile 0 liegt bei y = 1024 − (200 + ½) · Zellweite
    assert 1024 - (200.5 * 0.125) == pytest.approx(f.min_y + (10 - 1) * f.cell)


def test_prominenz_ueber_den_schluesselsattel():
    h = np.zeros((N, N))
    # Zwei Kegel: Gipfel A 100 m, Gipfel B 60 m, Sattel dazwischen 40 m.
    h[10, 10] = 100.0
    h[10, 11] = h[10, 12] = 40.0
    h[10, 13] = 60.0
    h[:, :] = np.maximum(h, 0.0)
    f = Feld(raster(h))
    assert prominenz(f, 10, 10) == pytest.approx(100.0)  # der höchste Punkt: bis zur tiefsten erreichbaren Zelle
    assert prominenz(f, 10, 13) == pytest.approx(20.0)  # 60 − Sattel 40


def test_kopf_strenge_gipfelzelle_gegen_schulter():
    x, y = koordinaten()
    kegel = np.maximum(0.0, 600.0 - 40.0 * np.hypot(x - 105.0, y - 206.0) * 3000.0 / 750.0)
    f = Feld(raster(kegel))
    kopf = finde_kopf(f, *zelle_von(105.0, 206.0))
    assert kopf is not None and kopf["eigene_zelle"] == 1.0 and kopf["prominenz"] > 100
    # Eine Rampe hat keinen Kopf.
    rampe = Feld(raster(np.tile(np.arange(N, dtype=float) * 10.0, (N, 1))))
    assert finde_kopf(rampe, 20, 20) is None
    # Ein Punkt neben dem Gipfel (im Umkreis von 0,5 E) findet ihn.
    assert finde_kopf(f, *zelle_von(105.5, 206.0)) is not None


def test_gipfel_exakt_und_kopf_und_nebengipfel(tmp_path):
    h = dachkamm()
    spitze = zelle_von(105.0, 206.0)
    h[spitze] = 2000.0
    neben = zelle_von(108.0, 206.0)
    h[neben] = 1700.0  # Spitze auf dem Dach: strikte Gipfelzelle
    fehl = zelle_von(102.0, 206.0)
    h[fehl] = 1500.0  # auf der Kammlinie ohne Erhebung: Schulter
    g = geometrie(gipfel=[Punkt(105.0, 206.0, 2000.0)], nebengipfel=[Punkt(108.0, 206.0, 1700.0), Punkt(102.0, 206.0, 1500.0), Punkt(300.0, 300.0, 1000.0)])
    e = bewerte_form(raster(h), g)
    assert e["komponenten"]["gipfel_exakt"] == 1.0 and e["komponenten"]["gipfel_kopf"] == 1.0
    assert len(e["nebengipfel"]) == 2, "ein Punkt außerhalb der Fläche zählt nicht"
    assert e["komponenten"]["neben_exakt"] == 1.0
    assert e["komponenten"]["neben_kopf"] == 0.5
    # Ein falsch gesetzter Gipfel verfehlt exakt.
    h2 = h.copy()
    h2[spitze] = 1900.0
    assert bewerte_form(raster(h2), g)["komponenten"]["gipfel_exakt"] == 0.0


def test_nebengipfel_ohne_hoehe_hat_keine_sollhoehe():
    h = dachkamm()
    h[zelle_von(105.0, 206.0)] = 1650.0
    e = bewerte_form(raster(h), geometrie(nebengipfel=[Punkt(105.0, 206.0, None)]))
    assert e["nebengipfel"][0]["exakt"] is None and e["komponenten"]["neben_exakt"] is None
    assert e["komponenten"]["neben_kopf"] == 1.0


def test_kammrelief_quer_und_lage_der_kammachse():
    kante = [[(102.0, 206.0), (110.0, 206.0)]]
    g = geometrie(kaemme=kante)
    e = bewerte_form(raster(dachkamm()), g, grat_min=0.3)
    k = e["kamm"]
    assert k["proben"] >= MIN_PROBEN_FUER_TEST
    # 0,2 · 4500 m = 900 m Abfall auf 1,5 E
    assert k["grat_median_m"] == pytest.approx(900.0, abs=1.0)
    assert k["grat_anteil"] == pytest.approx(900.0 / 1500.0, abs=0.01)
    assert k["grat_erhalt"] == 1.0  # 0,6 gegen das Soll 0,3
    assert k["kammlage_median_e"] == pytest.approx(0.0, abs=0.13) and e["komponenten"]["kammlage"] == 1.0
    # Ein breiter, flacher Rücken verfehlt den Mindestgrat.
    flach = bewerte_form(raster(dachkamm(flanke=0.02)), g, grat_min=0.3)["kamm"]
    assert flach["grat_median_m"] == pytest.approx(90.0, abs=1.0) and flach["grat_erhalt"] == pytest.approx(0.06 / 0.3, abs=0.01)
    # Liegt die Kammachse 0,5 E neben der gezeichneten Kante, meldet das die Lage.
    versetzt = bewerte_form(raster(dachkamm(versatz_e=0.5)), g, grat_min=0.3)["kamm"]
    assert versetzt["kammlage_median_e"] == pytest.approx(0.5, abs=0.13)
    # Die Toleranz hängt nicht von der Auflösung ab: 0,25 E neben der Linie gilt bei 1× (Zelle 0,25 E) wie bei feinerem Raster als genau.
    from terrainlab.bewertung.formerhalt import komponenten

    leer = {"gipfel": [], "nebengipfel": [], "mulden": []}
    assert komponenten(leer, {"kammlage_median_e": 0.25, "zelle_e": 0.125}, {})["kammlage"] == 1.0
    assert komponenten(leer, {"kammlage_median_e": 0.25, "zelle_e": 0.25}, {})["kammlage"] == 1.0
    assert komponenten(leer, {"kammlage_median_e": 0.5, "zelle_e": 0.0625}, {})["kammlage"] == pytest.approx(0.5)


MIN_PROBEN_FUER_TEST = 4


def test_kanten_naher_nachbar_zaehlen_nicht_als_seite():
    # Zwei Kanten 1 E auseinander: ihre Seiten (1,5 E) liegen näher als 1,5 E an der anderen Kante und fallen weg.
    g = geometrie(kaemme=[[(102.0, 206.0), (110.0, 206.0)], [(102.0, 207.0), (110.0, 207.0)]])
    e = bewerte_form(raster(dachkamm()), g, grat_min=0.2)
    assert e["kamm"]["proben"] == 0 and e["kamm"]["grat_median_m"] is None and e["komponenten"]["grat"] is None


def test_fluesse_faellen_und_liegen_im_tal():
    x, y = koordinaten()
    # Ein Tal in Nord-Süd-Richtung bei x = 105, das nach Süden (kleineres y) um 3 m je Zelle fällt.
    tal = 800.0 + 0.1 * np.abs(x - 105.0) * 3000.0 + 3.0 * (y - MIN_Y) / ZELLE_E
    fluss = {"n": "Probe", "dir": "forward", "p": [(105.0, 210.0), (105.0, 203.0)]}
    gut = bewerte_form(raster(tal), geometrie(flusse=[fluss]))
    assert gut["taeler"]["faellt_anteil"] == 1.0 and gut["taeler"]["tal_anteil"] == 1.0
    assert gut["taeler"]["fluesse"][0]["tiefe_median_m"] == pytest.approx(0.1 * 3000.0, abs=1.0)
    # Gegen die Fließrichtung gezeichnet (dir reverse): derselbe Lauf steigt jetzt.
    bergauf = {"n": "Rück", "dir": "reverse", "p": [(105.0, 210.0), (105.0, 203.0)]}
    f = Feld(raster(tal))
    assert fluss_anstieg(f, fluss) == pytest.approx(0.0)
    assert fluss_anstieg(f, bergauf) == pytest.approx(3.0)
    assert bewerte_form(raster(tal), geometrie(flusse=[bergauf]))["taeler"]["faellt_anteil"] == 0.0


def test_mulde_liegt_tiefer_als_ihr_ring():
    x, y = koordinaten()
    h = 1000.0 + 0.0 * x
    h[zelle_von(105.0, 206.0)] = 900.0
    e = bewerte_form(raster(h), geometrie(mulden=[Punkt(105.0, 206.0, None)]))
    assert e["komponenten"]["mulde_tief"] == 1.0
    assert e["mulden"][0]["tiefe_m"] == pytest.approx(100.0, abs=0.5)


def test_leitwert_ist_das_mittel_der_komponenten():
    h = dachkamm()
    h[zelle_von(105.0, 206.0)] = 2000.0
    e = bewerte_form(raster(h), geometrie(gipfel=[Punkt(105.0, 206.0, 2000.0)], kaemme=[[(102.0, 206.0), (110.0, 206.0)]]), grat_min=0.2)
    werte = [v for v in e["komponenten"].values() if v is not None]
    assert e["leitwert"] == pytest.approx(sum(werte) / len(werte))
    assert set(e["komponenten"]) == set(KOMPONENTEN)


def test_geometrie_aus_fixture(tmp_path):
    datei = tmp_path / "x.json"
    datei.write_text(
        json.dumps({"name": "X", "input": {"bounds": {}, "regler": {"maximalhoehe": 2300}, "peaks": [{"x": 1, "y": 2, "h": 2300}], "nebengipfel": [{"x": 3, "y": 4, "h": None}],
                                           "kaemme": [{"punkte": [[0, 0], [1, 1]], "rang": "haupt"}], "fluesse": [{"n": "F", "dir": "forward", "p": [[0, 0], [1, 1]]}]}}),
        encoding="utf-8",
    )
    g = lade_geometrie(datei)
    assert g.zaehlung() == {"gipfel": 1, "nebengipfel": 1, "kaemme": 1, "fluesse": 1, "mulden": 0}
    assert g.kammhoehe == 2300.0 and g.nebengipfel[0].h is None and len(g.sha256) == 64
    datei.write_text(json.dumps({"input": {}}), encoding="utf-8")
    with pytest.raises(FormFehler):
        lade_geometrie(datei)


def test_formtor_gipfel_exakt_und_anteil_der_vorgabe():
    basis = {k: None for k in KOMPONENTEN} | {"gipfel_exakt": 1.0, "neben_kopf": 0.6, "grat": 1.0}
    ok, v = pruefe_tor({**basis}, basis)
    assert ok and v == []
    # 0,48 = 80 % von 0,6: gerade noch gehalten; darunter nicht.
    assert pruefe_tor({**basis, "neben_kopf": 0.48}, basis)[0]
    ok, v = pruefe_tor({**basis, "neben_kopf": 0.4}, basis)
    assert not ok and "neben_kopf" in v[0]
    # Ein Gipfel, der nicht exakt steht, scheitert immer, auch wenn die Vorgabe ihn nicht hielt.
    ok, v = pruefe_tor({**basis, "gipfel_exakt": 0.5}, {**basis, "gipfel_exakt": 0.0})
    assert not ok and "gipfel_exakt" in v[0]
    # Nicht mehr messbar, was die Vorgabe maß: verfehlt.
    assert not pruefe_tor({**basis, "grat": None}, basis)[0]
    # Fehlt die Messung in der Vorgabe, zählt sie nicht.
    assert pruefe_tor({**basis, "grat": 0.1}, {**basis, "grat": None})[0]


def test_komponenten_ueber_saaten_gipfel_exakt_als_minimum():
    a = {k: None for k in KOMPONENTEN} | {"gipfel_exakt": 1.0, "grat": 0.8}
    b = {k: None for k in KOMPONENTEN} | {"gipfel_exakt": 0.5, "grat": 0.4}
    m = mittel_komponenten([a, b])
    assert m["gipfel_exakt"] == 0.5 and m["grat"] == pytest.approx(0.6) and m["neben_kopf"] is None
