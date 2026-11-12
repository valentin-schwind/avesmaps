"""Tests der Gelände-Deskriptoren an synthetischen Flächen mit bekannten Eigenschaften (WI-0250 Phase A2)."""

import math

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter

from terrainlab.deskriptoren import Metrikvektor, Parameter, berechne
from terrainlab.deskriptoren import synthetisch as syn
from terrainlab.deskriptoren.fliess import fliessnetz
from terrainlab.deskriptoren.regionen import prominenz_berechnen
from terrainlab.raster import Hoehenraster

# Jede Warnung (Division durch null, leere Mittel) ist ein Fehler: Randfälle müssen sauber NaN liefern.
pytestmark = pytest.mark.filterwarnings("error")


def _ok(v: Metrikvektor, name: str) -> float:
    wert = v[name]
    assert math.isfinite(wert), f"{name} ist nicht endlich"
    return wert


# ---------------------------------------------------------------- Ebene


def test_ebene_ist_in_allen_gruppen_neutral():
    v = berechne(syn.ebene((64, 64), 30.0, 100.0))
    assert v["hoehe_relief"] == 0
    assert v["hang_neigung_mittel"] == 0 and v["hang_neigung_max"] == 0
    assert v["hang_tri_mittel"] == 0
    assert v["gipfel_anzahl"] == 0  # eine Fläche ohne Relief hat keinen Gipfel mit Prominenz
    assert v["hydro_senken_anteil"] == 0
    assert "hoehe_hypsometrisches_integral" not in v.namen()  # undefiniert bei Spanne 0, nicht 0/0
    assert "frequenz_spektrum_beta" not in v.namen()  # keine Varianz nach Ebenenabzug
    assert any("Reliefspanne 0" in h for h in v.kopf["hinweise"])


# ---------------------------------------------------------------- schiefe Ebene


@pytest.mark.parametrize("neigung,richtung", [(10.0, 0.0), (25.0, 33.0), (40.0, 150.0)])
def test_schiefe_ebene_liefert_die_gesetzte_neigung(neigung, richtung):
    dx = 30.0
    v = berechne(syn.schiefe_ebene((96, 96), dx, neigung, richtung, z0=0.0))
    assert v["hang_neigung_mittel"] == pytest.approx(neigung, abs=2e-3)
    assert v["hang_neigung_std"] < 2e-3
    assert v["hang_neigung_max"] == pytest.approx(neigung, abs=2e-3)
    # Krümmung einer Ebene ist null
    assert v["hang_kruemmung_profil_abs_mittel"] < 1e-6
    assert v["hang_kruemmung_plan_abs_mittel"] < 1e-6
    # TRI einer Ebene: g * sqrt(6) mit g = Höhenunterschied je Zellkante
    g = math.tan(math.radians(neigung)) * dx
    assert v["hang_tri_mittel"] == pytest.approx(g * math.sqrt(6.0), rel=1e-3)
    # hypsometrisches Integral einer Ebene: genau 0,5
    assert v["hoehe_hypsometrisches_integral"] == pytest.approx(0.5, abs=1e-4)
    # Gradientenrichtung (modulo 180°) und volle Kohärenz
    assert v["frequenz_orientierung_kohaerenz"] == pytest.approx(1.0, abs=1e-6)
    erwartet = richtung % 180.0
    assert abs(((v["frequenz_orientierung_richtung"] - erwartet + 90) % 180) - 90) < 0.05
    # Reliefenergie im vollen Fenster: Spanne über die Fensterdiagonale
    r = round(250.0 / dx)
    c, s = abs(math.cos(math.radians(richtung))), abs(math.sin(math.radians(richtung)))
    assert v["hang_reliefenergie_max_r250m"] == pytest.approx(g * 2 * r * (c + s), rel=1e-3)
    # genau ein Gipfel (die höchste Ecke) mit der gesamten Reliefspanne als Prominenz
    assert v["gipfel_anzahl"] == 1
    assert v["gipfel_prominenz_max"] == pytest.approx(v["hoehe_relief"], rel=1e-6)


def test_neigung_ist_physikalisch_und_nicht_normiert():
    # dasselbe Höhenfeld in doppelter Zellgröße ist halb so steil (Meter, nicht Zellen)
    z = syn.schiefe_ebene((64, 64), 30.0, 30.0).hoehen
    a = berechne(Hoehenraster(z, 30.0))["hang_neigung_mittel"]
    b = berechne(Hoehenraster(z, 60.0))["hang_neigung_mittel"]
    assert a == pytest.approx(30.0, abs=1e-3)
    assert b == pytest.approx(math.degrees(math.atan(math.tan(math.radians(30.0)) / 2)), abs=1e-3)


# ---------------------------------------------------------------- Kegel und Prominenz


def test_kegel_hat_einen_gipfel_mit_voller_prominenz():
    r = syn.kegel((101, 101), 50.0, hoehe=800.0, radius_m=2000.0)
    v = berechne(r)
    assert v["gipfel_anzahl"] == 1
    assert v["gipfel_prominenz_max"] == pytest.approx(800.0, abs=1e-3)
    flanke = math.degrees(math.atan(800.0 / 2000.0))
    assert v["hang_neigung_p90"] == pytest.approx(flanke, abs=0.2)
    assert v["hang_neigung_max"] == pytest.approx(flanke, abs=0.3)
    assert v["hydro_senken_anteil"] == 0  # Kegel auf ebenem Boden: nichts staut sich


def test_prominenz_ist_die_hoehe_ueber_dem_schluesselsattel():
    # zwei Kegel gleicher Hangneigung; Sattel = (hA + hB - m D) / 2 = 440 m, Prominenz des kleineren = 680 - 440 = 240 m
    hang = 0.4
    r = syn.zwei_kegel((101, 101), 50.0, ((50, 30, 1000.0), (50, 70, 680.0)), hang=hang)
    z = r.hoehen.astype(np.float64)
    gl = prominenz_berechnen(z, np.isfinite(z))
    b = z.shape[1]
    nach_zelle = {int(c): (p, s) for c, p, s in zip(gl.zelle, gl.prominenz, gl.sattel_hoehe)}
    prom_a, _ = nach_zelle[50 * b + 30]
    prom_b, sattel_b = nach_zelle[50 * b + 70]
    assert prom_a == pytest.approx(1000.0, abs=1e-6)  # Hauptgipfel: Höhe über dem Rastertiefpunkt (0)
    assert prom_b == pytest.approx(240.0, abs=1e-6)
    assert sattel_b == pytest.approx(440.0, abs=1e-6)
    v = berechne(r)
    assert v["gipfel_anzahl"] == 2
    assert v["gipfel_abstand_nn_median"] == pytest.approx(2000.0)
    assert v["gipfel_isolation_median"] == pytest.approx(2000.0)  # nur der kleinere hat einen höheren Nachbarn
    assert v["gipfel_baum_kinder_max"] == 1


def test_prominenz_ist_kein_nachbarschaftsmaximum():
    # ein schmaler Höcker auf einem langen Anstieg: lokales Maximum, aber nur wenige Meter über dem Schlüsselsattel
    z = np.linspace(0, 1000, 80)[None, :].repeat(16, axis=0)
    z[:, 41] += 30.0
    z = z.astype(np.float64)
    gl = prominenz_berechnen(z, np.isfinite(z))
    proms = np.sort(gl.prominenz)[::-1]
    assert len(proms) == 2  # Höckerlinie und Rand am oberen Ende
    assert proms[0] == pytest.approx(z.max() - z.min())
    assert proms[1] == pytest.approx(z[0, 41] - z[0, 42])  # Sattel = der nächste Wert den Anstieg hinauf, nicht 1000 m


# ---------------------------------------------------------------- Kamm


def test_gerader_kamm_hat_das_bekannte_querprofil():
    dx = 50.0
    flanke = 35.0
    r = syn.kamm((160, 121), dx, hoehe=1500.0, flanke_neigung_grad=flanke, laengs_neigung_grad=0.3)
    v = berechne(r)
    m = math.tan(math.radians(flanke))
    for d in (250.0, 500.0, 1000.0, 2000.0):
        assert v[f"kamm_profil_d{d:g}m"] == pytest.approx(m * d, rel=0.03), d
    # Kammlänge: Achse über fast alle Zeilen (die ersten Zeilen sammeln noch zu wenig Fläche)
    flaeche_km2 = 160 * 121 * dx * dx / 1e6
    erwartet = (160 - 4) * dx / 1000.0 / flaeche_km2
    assert v["kamm_dichte_a1km2"] == pytest.approx(erwartet, rel=0.15)
    assert v["kamm_achse_anteil"] == pytest.approx(156 / (160 * 121), rel=0.2)
    assert v["kamm_tpi_r1000m"] > 0  # die Achse liegt über ihrer Umgebung


# ---------------------------------------------------------------- Senken


def test_kuenstliche_senken_haben_bekannte_tiefe_und_fuellung():
    senken = [(20, 20, 10, 10, 12.0), (70, 60, 20, 15, 5.0)]
    r = syn.plateau_mit_senken((120, 120), 30.0, 500.0, senken)
    v = berechne(r)
    n = 120 * 120
    assert v["hydro_senken_anzahl"] == 2
    assert v["hydro_senken_anteil"] == pytest.approx(400 / n)
    assert v["hydro_senken_tiefe_max"] == pytest.approx(12.0)
    assert v["hydro_senken_fuelltiefe_mittel"] == pytest.approx((100 * 12.0 + 300 * 5.0) / n)
    assert v["hydro_senken_flaeche_median"] == pytest.approx(0.5 * (100 + 300) * 900.0)
    assert v["hydro_senken_dichte"] == pytest.approx(2 / (n * 900.0 / 1e6))


def test_fliessnetz_bilanziert_vollstaendig_auch_mit_senken_und_nodata():
    rng = np.random.default_rng(3)
    z = gaussian_filter(rng.random((90, 110)), 2.0) * 50.0
    z[30:50, 40:70] = np.nan  # NoData-Loch: sein Rand ist Auslass
    z[0:10, 0:10] = np.nan
    maske = np.isfinite(z)
    fn = fliessnetz(z, maske)
    auslass = fn.gueltig & (fn.ziel < 0)
    assert fn.akkumulation[auslass].sum() == maske.sum()
    assert (fn.akkumulation[~fn.gueltig] == 0).all()
    ohne_sprung = fliessnetz(z, maske, konditioniert=False)
    assert ohne_sprung.akkumulation[ohne_sprung.gueltig & (ohne_sprung.ziel < 0)].sum() == maske.sum()


def test_nodata_wird_toleriert():
    r = syn.fbm((128, 128), 30.0, seed=2)
    z = r.hoehen.copy()
    z[40:60, 50:90] = np.nan
    z[:, :4] = np.nan
    v = berechne(Hoehenraster(z, 30.0))
    n_nan = int(np.isnan(z).sum())
    assert v["hoehe_nodata_anteil"] == pytest.approx(n_nan / z.size)
    for m in v.metriken:
        assert not math.isinf(m.wert), m.name
    assert _ok(v, "hang_neigung_mittel") > 0
    assert _ok(v, "frequenz_spektrum_beta") > 0


# ---------------------------------------------------------------- Frequenz


def test_spektrum_misst_den_exponenten_der_synthese():
    for beta in (2.0, 3.0):
        v = berechne(syn.fbm((256, 256), 30.0, beta=beta, seed=5), gruppen=("frequenz",))
        assert v["frequenz_spektrum_beta"] == pytest.approx(beta, abs=0.25)
    # Isotropie des Rauschens
    assert v["frequenz_achsenverhaeltnis"] == pytest.approx(1.0, abs=0.4)
    assert v["frequenz_spitzen_anzahl"] == 0


@pytest.mark.parametrize("achse", ["x", "y"])
def test_gitterartefakt_erzeugt_eine_spektralspitze_auf_der_achse(achse):
    basis = syn.fbm((256, 256), 30.0, beta=2.6, relief_m=800.0, seed=7)
    sauber = berechne(basis, gruppen=("frequenz",))
    gestoert = berechne(syn.gitterartefakt(basis, periode_zellen=8, amplitude_m=12.0, achse=achse), gruppen=("frequenz",))
    assert sauber["frequenz_spitzen_anzahl"] == 0
    assert sauber["frequenz_spitzen_anteil"] == 0
    assert gestoert["frequenz_spitzen_anzahl"] >= 1
    assert gestoert["frequenz_spitzen_max"] > 3 * sauber["frequenz_spitzen_max"]
    assert gestoert["frequenz_spitzen_anteil"] > 0


@pytest.mark.parametrize("achse", ["x", "y"])
def test_streifenartefakt_erhoeht_das_achsenverhaeltnis(achse):
    basis = syn.fbm((256, 256), 30.0, beta=2.6, relief_m=800.0, seed=7)
    sauber = berechne(basis, gruppen=("frequenz",))
    gestoert = berechne(syn.streifenartefakt(basis, amplitude_m=6.0, achse=achse), gruppen=("frequenz",))
    assert sauber["frequenz_achsenverhaeltnis"] < 1.3
    assert gestoert["frequenz_achsenverhaeltnis"] > 2.5 * sauber["frequenz_achsenverhaeltnis"]
    assert gestoert["frequenz_anisotropie"] > 2 * sauber["frequenz_anisotropie"]


def test_wellenlaengenbaender_summieren_sich_zu_eins():
    v = berechne(syn.fbm((256, 256), 30.0, seed=1), gruppen=("frequenz",))
    summe = sum(m.wert for m in v.metriken if m.name.startswith("frequenz_anteil_"))
    assert summe == pytest.approx(1.0, abs=1e-9)


def test_autokorrelation_glatt_gegen_rauh():
    glatt = berechne(syn.fbm((256, 256), 30.0, beta=3.2, seed=1), gruppen=("frequenz",))
    rauh = berechne(syn.fbm((256, 256), 30.0, beta=2.0, seed=1), gruppen=("frequenz",))
    assert glatt["frequenz_autokorrelation_l500m"] > rauh["frequenz_autokorrelation_l500m"]
    assert glatt["frequenz_moran_hang"] > 0  # Steilheit tritt in zusammenhängenden Flächen auf


# ---------------------------------------------------------------- Netz und Hang auf Gelände


def test_gelaende_hat_plausible_netzmasse():
    # Hang- und Netzmaße einer glatten Spektralsynthese: Gerinne und Kämme sind spiegelbildlich (Inversion ändert die Statistik nicht)
    r = syn.fbm((256, 256), 30.0, beta=3.0, relief_m=900.0, seed=11)
    v = berechne(r, gruppen=("hang", "gipfel", "hydrologie"), teuer=False)
    assert v["hang_neigung_mittel"] < 40
    assert v["gerinne_strahler_max_a0.1km2"] >= 3
    assert v["gerinne_dichte_a0.1km2"] > v["gerinne_dichte_a1km2"] > 0
    assert 2.0 < v["gerinne_bifurkation_a0.1km2"] < 8.0  # Horton: natürliche Netze 3–5
    verhaeltnis = v["kamm_dichte_a0.1km2"] / v["gerinne_dichte_a0.1km2"]
    assert 0.6 < verhaeltnis < 1.6


def test_ohne_teure_metriken_entfallen_die_distanztransformationen():
    r = syn.fbm((128, 128), 30.0, seed=2)
    voll = berechne(r)
    schnell = berechne(r, teuer=False)
    assert {m.name for m in schnell.metriken} <= {m.name for m in voll.metriken}
    assert all(m.kosten != "hoch" for m in schnell.metriken)
    assert any(m.kosten == "hoch" for m in voll.metriken)
    assert not any(n.startswith("tal_") for n in schnell.verteilungen)


def test_metrikvektor_ist_nachvollziehbar_und_hin_und_zurueck_lesbar(tmp_path):
    v = berechne(syn.fbm((128, 128), 30.0, seed=2))
    namen = v.namen()
    assert len(namen) == len(set(namen))
    for m in v.metriken:
        assert m.einheit and m.beschreibung, m.name
        assert m.gruppe in ("hoehe", "hang", "gipfel", "hydrologie", "frequenz")
        assert m.art in ("absolut", "relativ", "verteilung", "raeumlich")
    pfad = v.schreibe(tmp_path / "v.json")
    zurueck = Metrikvektor.lies(pfad)
    assert zurueck.namen() == namen
    for a, b in zip(v.metriken, zurueck.metriken):
        assert (math.isnan(a.wert) and math.isnan(b.wert)) or a.wert == pytest.approx(b.wert)
    for name, d in v.verteilungen.items():
        assert np.allclose(d.quantile, zurueck.verteilungen[name].quantile, equal_nan=True)
    assert zurueck.parameter == Parameter()


def test_parameter_in_metern_gelten_fuer_jede_zellgroesse():
    # gleiches Gelände (analytisch), einmal mit 30 m und einmal mit 15 m Zellkante: die Fenstermaße in Metern stimmen überein
    def flaeche(dx: float) -> Hoehenraster:
        n = int(6000 / dx)
        y, x = np.mgrid[0:n, 0:n] * dx
        z = 300.0 * np.sin(x / 700.0) * np.cos(y / 900.0) + 0.05 * x
        return Hoehenraster(z.astype(np.float32), dx)

    a = berechne(flaeche(30.0), gruppen=("hang",), teuer=False)
    b = berechne(flaeche(15.0), gruppen=("hang",), teuer=False)
    assert a["hang_neigung_mittel"] == pytest.approx(b["hang_neigung_mittel"], rel=0.02)
    assert a["hang_reliefenergie_mittel_r1000m"] == pytest.approx(b["hang_reliefenergie_mittel_r1000m"], rel=0.03)


# ---------------------------------------------------------------- Krümmung, Rauheit, Skalen


def test_kruemmung_einer_parabelkuppel_stimmt_mit_der_formel_ueberein():
    from terrainlab.deskriptoren.kern import Sammler
    from terrainlab.deskriptoren.kontext import Kontext

    dx, a = 20.0, 2e-4
    n = 201
    y, x = np.mgrid[0:n, 0:n]
    xm, ym = (x - 100) * dx, (y - 100) * dx
    z = 800.0 - a * (xm**2 + ym**2)
    p = Parameter()
    ctx = Kontext(Hoehenraster(z.astype(np.float64).astype(np.float32), dx), p, Sammler(p))
    profil, plan = ctx.kruemmung
    r = 1000.0  # 50 Zellen östlich des Scheitels
    erwartet_profil = 2 * a / (1 + 4 * a * a * r * r) ** 1.5
    assert profil[100, 150] == pytest.approx(erwartet_profil, rel=2e-3)
    assert plan[100, 150] == pytest.approx(1.0 / r, rel=2e-3)  # Höhenlinie ist ein Kreis vom Radius r: konvex = positiv
    # dieselbe Form als Mulde (Doline) hat das umgekehrte Vorzeichen
    ctx2 = Kontext(Hoehenraster((1600.0 - z).astype(np.float32), dx), p, Sammler(p))
    assert ctx2.kruemmung[0][100, 150] == pytest.approx(-erwartet_profil, rel=2e-3)
    assert ctx2.kruemmung[1][100, 150] == pytest.approx(-1.0 / r, rel=2e-3)


def test_skalenexponent_und_rauheit_unterscheiden_ebene_und_gelaende():
    ebene = berechne(syn.schiefe_ebene((128, 128), 30.0, 20.0, 40.0), gruppen=("hang",), teuer=False)
    rauh = berechne(syn.fbm((128, 128), 30.0, beta=2.2, relief_m=500.0, seed=3), gruppen=("hang",), teuer=False)
    assert ebene["hang_skalenexponent"] == pytest.approx(0.0, abs=1e-3)
    assert ebene["hang_vrm_mittel_r100m"] < 1e-9
    assert rauh["hang_skalenexponent"] < -0.2  # Hänge werden bei Vergröberung flacher
    assert rauh["hang_vrm_mittel_r100m"] > 1e-4
    assert rauh["hang_neigung_mittel"] > rauh["hang_neigung_mittel_f4"]
