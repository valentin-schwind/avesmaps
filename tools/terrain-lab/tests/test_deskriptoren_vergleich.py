"""Vergleichsfunktionen: Wasserstein-Abstand je Verteilung, Abweichung je Einzelwert, Pflicht zum gleichen Maßstab."""

import math

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter

from terrainlab.deskriptoren import MassstabFehler, Parameter, berechne, vergleiche, vergleiche_raster, wasserstein_exakt, wasserstein_quantile
from terrainlab.deskriptoren import synthetisch as syn
from terrainlab.raster import Hoehenraster

pytestmark = pytest.mark.filterwarnings("error")


def test_wasserstein_exakt_bekannte_faelle():
    rng = np.random.default_rng(0)
    u = rng.random(20000)
    assert wasserstein_exakt(u, u) == 0
    assert wasserstein_exakt(u, u + 0.3) == pytest.approx(0.3, abs=1e-12)  # reine Verschiebung: Betrag der Verschiebung
    # zwei Normalverteilungen gleichen Mittels: W1 = |s2 - s1| * sqrt(2/pi)
    a, b = rng.normal(0, 1, 40000), rng.normal(0, 2, 25000)  # auch verschiedene Stichprobengrößen
    assert wasserstein_exakt(a, b) == pytest.approx(math.sqrt(2 / math.pi), abs=0.03)
    assert wasserstein_exakt([0.0, 1.0], [2.0, 3.0, np.nan]) == pytest.approx(2.0)
    assert math.isnan(wasserstein_exakt([], [1.0]))


def test_wasserstein_aus_quantilen_entspricht_dem_exakten_wert():
    rng = np.random.default_rng(1)
    a, b = rng.normal(0, 1, 50000), rng.normal(1, 1.5, 50000)
    n = 512
    u = (np.arange(n) + 0.5) / n
    assert wasserstein_quantile(np.quantile(a, u), np.quantile(b, u)) == pytest.approx(wasserstein_exakt(a, b), rel=0.03)
    with pytest.raises(ValueError):
        wasserstein_quantile(np.zeros(3), np.zeros(4))


def test_gleiche_raster_haben_abstand_null_und_eine_verschiebung_genau_den_betrag():
    r = syn.fbm((128, 128), 30.0, seed=4)
    a = berechne(r, teuer=False)
    gleich = vergleiche(a, berechne(r, teuer=False))
    assert all(v.w1 == 0 for v in gleich.verteilungen.values())
    assert all(s.differenz == 0 or math.isnan(s.differenz) for s in gleich.skalare.values())
    hoeher = Hoehenraster((r.hoehen + 250.0).astype(np.float32), 30.0)
    verschoben = vergleiche(a, berechne(hoeher, teuer=False))
    assert verschoben.verteilungen["hoehe"].w1 == pytest.approx(250.0, abs=1e-3)
    assert verschoben.verteilungen["hoehe_rel"].w1 < 1e-5  # die normierte Höhe ändert sich nicht
    assert verschoben.verteilungen["hang_neigung"].w1 < 1e-4
    assert verschoben.skalare["hoehe_mittel"].differenz == pytest.approx(250.0, abs=1e-3)
    assert verschoben.skalare["hoehe_mittel"].relativ == pytest.approx(250.0 / a["hoehe_mittel"], rel=1e-3)


def test_verschiedener_massstab_ist_ein_fehler():
    r = syn.fbm((128, 128), 30.0, seed=4)
    a = berechne(r, teuer=False)
    grob = berechne(Hoehenraster(r.hoehen, 60.0), teuer=False)
    with pytest.raises(MassstabFehler, match="Zellgr"):
        vergleiche(a, grob)
    with pytest.raises(MassstabFehler):
        vergleiche_raster(r, Hoehenraster(r.hoehen, 60.0))
    anders = berechne(r, Parameter(fenster_radien_m=(300.0, 900.0)), teuer=False)
    with pytest.raises(MassstabFehler, match="Parameter"):
        vergleiche(a, anders)


def test_andere_rasterkante_ist_zulaessig():
    a = berechne(syn.fbm((128, 128), 30.0, seed=1), teuer=False)
    b = berechne(syn.fbm((192, 160), 30.0, seed=2), teuer=False)
    v = vergleiche(a, b)
    assert "hang_neigung" in v.verteilungen and "frequenz_spektrum_radial" in v.reihen


def test_vergleich_trennt_aehnliches_von_unaehnlichem_gelaende():
    # zwei Realisierungen derselben Synthese sind sich näher als die Synthese und ihre geglättete Fassung
    a = syn.fbm((192, 192), 30.0, beta=2.4, relief_m=900.0, seed=1)
    b = syn.fbm((192, 192), 30.0, beta=2.4, relief_m=900.0, seed=2)
    glatt = Hoehenraster(gaussian_filter(a.hoehen.astype(np.float64), 3.0).astype(np.float32), 30.0)
    p = Parameter()
    va, vb, vg = (berechne(r, p, teuer=False) for r in (a, b, glatt))
    ab, ag = vergleiche(va, vb), vergleiche(va, vg)
    for name in ("hang_neigung", "hang_tri", "hang_vrm_r100m"):
        assert ag.verteilungen[name].w1_norm > 3 * ab.verteilungen[name].w1_norm, name
    assert ag.reihen["frequenz_spektrum_radial"].abstand > 3 * ab.reihen["frequenz_spektrum_radial"].abstand
    assert ag.gruppenabstand()["hang"] > 3 * ab.gruppenabstand()["hang"]
    assert "hang" in ag.tabelle() or "Hang" in ag.tabelle()
    # Ausgabe ist JSON-fähig
    import json

    json.dumps(ag.als_dict())
