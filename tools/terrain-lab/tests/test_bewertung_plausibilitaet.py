"""Plausibilität (Dimension 1) und Pareto-Ordnung: Abstände, Randband, Reliefangleichung, Rollen der Referenzen."""

import math

import numpy as np
import pytest

from terrainlab.bewertung import Einstellungen, ReferenzSatz, bewerte_plausibilitaet, dominiert, front, pareto_raenge, stufe_fuer_zellgroesse
from terrainlab.bewertung import plausibilitaet as pl
from terrainlab.deskriptoren import MassstabFehler
from terrainlab.deskriptoren.synthetisch import fbm
from terrainlab.raster import Hoehenraster

pytestmark = pytest.mark.filterwarnings("error")

KLEIN = Einstellungen(gruppen=("hoehe", "hang", "hydrologie"), ohne_teuer=True, rand_m=0.0, min_zellen=50)


def test_abstaende_sind_beschraenkt_und_symmetrisch():
    assert pl.sra(3.0, 3.0) == 0.0 and pl.sra(0.0, 0.0) == 0.0
    assert pl.sra(1.0, 3.0) == pytest.approx(0.5) and pl.sra(3.0, 1.0) == pl.sra(1.0, 3.0)
    assert pl.sra(1.0, -1.0) == pytest.approx(1.0)
    assert pl.sra(math.nan, 1.0) == 1.0
    # Rauschboden: 0,02 % gegen 0 % ist kein Maximalabstand.
    assert pl.sra(0.0, 0.0002, pl.BODEN["1"]) < 0.03
    assert pl.sra(0.0, 0.5, pl.BODEN["1"]) > 0.9
    assert pl.verteilungsabstand(0.0, 5.0) == 0.0
    assert pl.verteilungsabstand(5.0, 5.0) == pytest.approx(0.5)
    assert pl.verteilungsabstand(1.0, 0.0) == 1.0 and pl.verteilungsabstand(0.0, 0.0) == 0.0
    assert pl.verteilungsabstand(math.nan, 1.0) == 1.0


def test_stufe_zur_zellweite():
    assert stufe_fuer_zellgroesse(750.0) == "750m" and stufe_fuer_zellgroesse(187.5) == "187_5m" and stufe_fuer_zellgroesse(375.0) == "375m"
    with pytest.raises(MassstabFehler):
        stufe_fuer_zellgroesse(900.0)


def test_randband_nimmt_zellen_am_umriss():
    h = np.full((20, 20), 100.0, dtype=np.float32)
    h[:, :3] = np.nan  # NoData im Westen
    r = Hoehenraster(h, 750.0, {})
    b = pl.beschneide_rand(r, 1500.0)  # 2 Zellen
    gueltig = np.isfinite(b.hoehen)
    assert not gueltig[:, :5].any() and gueltig[5:15, 6:18].all()
    assert not gueltig[0].any() and not gueltig[-1].any(), "auch der Rasterrand zählt als Umriss"
    assert pl.beschneide_rand(r, 0.0) is r


def test_reliefangleichung_streckt_senkrecht():
    r = fbm((64, 64), 750.0, relief_m=200.0, seed=1)
    g, faktor = pl.strecke_relief(r, 2000.0)
    h = g.hoehen
    assert faktor == pytest.approx(2000.0 / float(np.nanmax(r.hoehen) - np.nanmin(r.hoehen)), rel=1e-5)
    assert float(np.nanmax(h) - np.nanmin(h)) == pytest.approx(2000.0, rel=1e-4) and float(np.nanmin(h)) == pytest.approx(0.0, abs=1e-3)
    flach, f1 = pl.strecke_relief(Hoehenraster(np.full((8, 8), 5.0, dtype=np.float32), 750.0, {}), 100.0)
    assert f1 == 1.0


class _Satz(ReferenzSatz):
    """Ein Referenzsatz ohne Manifest: zwei künstliche Ausschnitte desselben Typs, je einer je Rolle."""

    def __init__(self, einst, rasters, tmp_path):
        super().__init__(einst, cache=tmp_path / "rm")
        self._r = rasters

    def ausschnitte(self, typ, rolle):
        return [{"id": f"{typ}-{rolle}", "typ": typ, "rolle": rolle, "raster": {"750m": {"sha256": "x"}}}]

    def fall(self, eintrag, stufe, relief_ziel_m):
        from terrainlab.deskriptoren import berechne

        roh = self._r[eintrag["rolle"]]
        faktor = 1.0
        if self.einst.relief_angleichen and relief_ziel_m:
            roh, faktor = pl.strecke_relief(roh, relief_ziel_m)
        return pl.ReferenzFall(eintrag["id"], eintrag["typ"], eintrag["rolle"], stufe, faktor, berechne(roh, self.einst.deskriptor_parameter(), self.einst.gruppen, not self.einst.ohne_teuer))


def test_gleiches_gelaende_hat_abstand_null_anderes_einen_positiven(tmp_path):
    a = fbm((96, 96), 750.0, relief_m=1500.0, seed=3)
    satz = _Satz(KLEIN, {"optimierung": a, "validierung": fbm((96, 96), 750.0, relief_m=1500.0, seed=4)}, tmp_path)
    refs = satz.faelle("kettengebirge", "optimierung", "750m")
    gleich = bewerte_plausibilitaet(a, refs, KLEIN)
    assert gleich["leitwert"] == pytest.approx(0.0, abs=1e-9) and gleich["stufe"] == "750m"
    rauer = fbm((96, 96), 750.0, relief_m=1500.0, seed=3, beta=1.6)
    glatter = fbm((96, 96), 750.0, relief_m=1500.0, seed=3, beta=3.4)
    r1, r2 = bewerte_plausibilitaet(rauer, refs, KLEIN), bewerte_plausibilitaet(glatter, refs, KLEIN)
    assert r1["leitwert"] > 0.02 and r2["leitwert"] > 0.02
    # Die Referenzstreuung (zwei echte Gebirge desselben Typs gegeneinander) liegt dazwischen: klein, aber nicht null.
    s = satz.streuung("kettengebirge", "750m")
    assert s["leitwert"] is not None and 0.0 < s["leitwert"] < 0.5 and s["paare"] == [{"optimierung": "kettengebirge-optimierung", "validierung": "kettengebirge-validierung"}]


def test_arten_getrennt_und_leitwert_nach_gewaehlten_arten(tmp_path):
    a = fbm((96, 96), 750.0, relief_m=1500.0, seed=3)
    satz = _Satz(KLEIN, {"optimierung": a, "validierung": a}, tmp_path)
    refs = satz.faelle("karst", "optimierung", "750m")
    e = bewerte_plausibilitaet(fbm((96, 96), 750.0, relief_m=700.0, seed=9, beta=1.8), refs, KLEIN)
    assert set(e["arten"]) == {"absolut", "relativ", "verteilung", "raeumlich"}
    fall = e["faelle"][0]
    medians = [fall["arten"][art]["median"] for art in ("relativ", "verteilung", "raeumlich") if fall["arten"][art]["median"] is not None]
    assert fall["leitwert"] == pytest.approx(sum(medians) / len(medians))
    nur_absolut = Einstellungen(gruppen=KLEIN.gruppen, ohne_teuer=True, rand_m=0.0, min_zellen=50, leitwert_arten=("absolut",))
    refs2 = _Satz(nur_absolut, {"optimierung": a, "validierung": a}, tmp_path).faelle("karst", "optimierung", "750m")
    e2 = bewerte_plausibilitaet(fbm((96, 96), 750.0, relief_m=700.0, seed=9, beta=1.8), refs2, nur_absolut)
    assert e2["faelle"][0]["leitwert"] == pytest.approx(e2["faelle"][0]["arten"]["absolut"]["median"])
    assert all(p["name"] not in ("hoehe_mittel", "hoehe_min", "hoehe_q50") for p in fall["schlechteste"]), "Höhenlage ist ohne Aussage und außerhalb der Wertung"


def test_zu_kleine_flaeche_und_falscher_massstab(tmp_path):
    a = fbm((96, 96), 750.0, relief_m=1500.0, seed=3)
    satz = _Satz(KLEIN, {"optimierung": a, "validierung": a}, tmp_path)
    refs = satz.faelle("karst", "optimierung", "750m")
    winzig = Hoehenraster(np.where(np.arange(96 * 96).reshape(96, 96) < 20, a.hoehen, np.nan).astype(np.float32), 750.0, {})
    assert bewerte_plausibilitaet(winzig, refs, KLEIN)["leitwert"] is None
    with pytest.raises(MassstabFehler):
        bewerte_plausibilitaet(fbm((40, 40), 900.0, seed=1), refs, KLEIN)
    with pytest.raises(MassstabFehler):
        bewerte_plausibilitaet(fbm((40, 40), 375.0, seed=1), refs, KLEIN)


def test_einstellungen_runde_und_unbekannte_schluessel():
    e = Einstellungen(gruppen=("hoehe",), leitwert_arten=("relativ",))
    assert Einstellungen.aus_dict(e.als_dict()) == e
    with pytest.raises(ValueError):
        Einstellungen.aus_dict({"unsinn": 1})


# --- Pareto ---------------------------------------------------------------------------------------------------------------


def test_dominanz_und_raenge():
    assert dominiert([1, 1], [2, 2]) and not dominiert([1, 3], [2, 2]) and not dominiert([1, 1], [1, 1])
    assert not dominiert([math.nan, 1], [5, 5]) and dominiert([5, 5], [math.nan, 1]) is False
    punkte = [(1.0, 5.0), (2.0, 2.0), (5.0, 1.0), (3.0, 3.0), (6.0, 6.0)]
    assert pareto_raenge(punkte) == [0, 0, 0, 1, 2]
    assert front(punkte) == [0, 1, 2]


def test_toleranz_macht_rauschen_gleich():
    assert not dominiert([1.0, 1.0], [1.001, 1.001], toleranz=[0.01, 0.01])
    assert dominiert([1.0, 1.0], [1.5, 1.0], toleranz=[0.01, 0.01])
    assert pareto_raenge([(1.0, 1.0), (1.001, 1.001)], [0.01, 0.01]) == [0, 0]
    with pytest.raises(ValueError):
        dominiert([1], [1, 2])
