"""Die Rechenkerne der Deskriptoren (Prominenz, Senkenfüllung, Fließnetz, Strahler) gegen langsame Referenzverfahren auf kleinen Rastern."""

import heapq

import numpy as np
import pytest
from scipy.ndimage import binary_erosion, gaussian_filter

from terrainlab.deskriptoren.fliess import akkumuliere, fliessnetz, strahler
from terrainlab.deskriptoren.regionen import prominenz_berechnen

pytestmark = pytest.mark.filterwarnings("error")

_NACHBARN = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0)]


def _gelaende(seed: int, form=(45, 55), loecher: bool = False) -> np.ndarray:
    rng = np.random.default_rng(seed)
    z = gaussian_filter(rng.random(form), 1.6) * 100.0
    if loecher:
        z[10:18, 12:30] = np.nan
        z[30:34, 0:6] = np.nan
    return z


def _prominenz_referenz(z: np.ndarray) -> dict[int, float]:
    """Zellweise Persistenz: absteigend sortieren, Union-Find über die 8er-Nachbarn; bei einer Vereinigung stirbt der niedrigere Gipfel."""
    h, b = z.shape
    gueltig = np.isfinite(z)
    reihenfolge = sorted((i for i in range(h * b) if gueltig.flat[i]), key=lambda i: (-z.flat[i], i))
    elter: dict[int, int] = {}
    spitze: dict[int, int] = {}
    tief: dict[int, float] = {}
    prom: dict[int, float] = {}

    def finde(a: int) -> int:
        while elter[a] != a:
            elter[a] = elter[elter[a]]
            a = elter[a]
        return a

    for i in reihenfolge:
        elter[i], spitze[i], tief[i] = i, i, z.flat[i]
        y, x = divmod(i, b)
        for dy, dx in _NACHBARN:
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < b and (yy * b + xx) in elter:
                ra, rb = finde(i), finde(yy * b + xx)
                if ra == rb:
                    continue
                pa, pb = spitze[ra], spitze[rb]
                if (z.flat[pa], -pa) > (z.flat[pb], -pb):
                    tot, rtot, rlebt = pb, rb, ra
                else:
                    tot, rtot, rlebt = pa, ra, rb
                prom[tot] = z.flat[tot] - z.flat[i]
                elter[rtot] = rlebt
                tief[rlebt] = min(tief[rlebt], tief[rtot])
    for r in [r for r in elter if finde(r) == r]:
        prom[spitze[r]] = z.flat[spitze[r]] - tief[r]
    return prom


def _fuellung_referenz(z: np.ndarray) -> np.ndarray:
    """Prioritätswarteschlange (Priority-Flood) von den Randzellen aus; Randzellen = am Rasterrand oder neben ungültigen Zellen."""
    h, b = z.shape
    gueltig = np.isfinite(z)
    innen = binary_erosion(gueltig, structure=np.ones((3, 3)), border_value=0)
    fuell = np.full((h, b), np.inf)
    pq: list[tuple[float, int, int]] = []
    for y in range(h):
        for x in range(b):
            if gueltig[y, x] and not innen[y, x]:
                fuell[y, x] = z[y, x]
                heapq.heappush(pq, (z[y, x], y, x))
    fertig = np.zeros((h, b), dtype=bool)
    while pq:
        v, y, x = heapq.heappop(pq)
        if fertig[y, x]:
            continue
        fertig[y, x] = True
        for dy, dx in _NACHBARN:
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < b and gueltig[yy, xx] and not fertig[yy, xx]:
                nv = max(z[yy, xx], v)
                if nv < fuell[yy, xx]:
                    fuell[yy, xx] = nv
                    heapq.heappush(pq, (nv, yy, xx))
    return fuell


@pytest.mark.parametrize("seed", [0, 1, 2])
@pytest.mark.parametrize("loecher", [False, True])
def test_prominenz_stimmt_mit_der_zellweisen_persistenz_ueberein(seed, loecher):
    z = _gelaende(seed, loecher=loecher)
    maske = np.isfinite(z)
    gl = prominenz_berechnen(z, maske)
    referenz = _prominenz_referenz(z)
    assert len(gl.zelle) > 5
    for zelle, p in zip(gl.zelle, gl.prominenz):
        assert p == pytest.approx(referenz[int(zelle)], abs=1e-9), int(zelle)
    # jedes Referenzmaximum mit positiver Prominenz kommt auch vor
    gefunden = {int(c) for c in gl.zelle}
    assert {c for c, p in referenz.items() if p > 0} <= gefunden


@pytest.mark.parametrize("seed", [0, 1, 2])
@pytest.mark.parametrize("loecher", [False, True])
def test_senkenfuellung_stimmt_mit_priority_flood_ueberein(seed, loecher):
    z = _gelaende(seed, loecher=loecher)
    maske = np.isfinite(z)
    fn = fliessnetz(z, maske)
    erwartet = np.where(maske, _fuellung_referenz(z) - np.where(maske, z, 0.0), 0.0)
    assert np.allclose(fn.senkentiefe, erwartet)
    assert (erwartet > 0).sum() > 20  # der Test hat etwas zu füllen
    auslass = fn.gueltig & (fn.ziel < 0)
    assert fn.akkumulation[auslass].sum() == maske.sum()


def test_strahler_ordnung_an_einem_handgebauten_baum():
    # Quellen a b c d -> e (a,b) und f (c,d) -> g -> Auslass; dazu eine kurze Nebenquelle h -> g
    namen = "abcdefgh"
    i = {n: k for k, n in enumerate(namen)}
    ziel = np.full(len(namen), -1, dtype=np.intp)
    for von, nach in [("a", "e"), ("b", "e"), ("c", "f"), ("d", "f"), ("e", "g"), ("f", "g"), ("h", "g")]:
        ziel[i[von]] = i[nach]
    gueltig = np.ones(len(namen), dtype=bool)
    akk, ebenen = akkumuliere(ziel, gueltig)
    assert akk[i["g"]] == 8 and akk[i["e"]] == 3
    ordnung, hoechste, _ = strahler(ziel, ebenen, gueltig)
    assert [int(ordnung[i[n]]) for n in "abcdh"] == [1, 1, 1, 1, 1]
    assert ordnung[i["e"]] == 2 and ordnung[i["f"]] == 2
    assert ordnung[i["g"]] == 3  # zwei Zuflüsse der Ordnung 2 -> 3 (der Zufluss h der Ordnung 1 ändert nichts)
    # Zyklen werden erkannt, nicht endlos gerechnet
    zyklus = np.array([1, 2, 0], dtype=np.intp)
    with pytest.raises(RuntimeError, match="Zyklus"):
        akkumuliere(zyklus, np.ones(3, dtype=bool))


def test_plateau_und_gleichstand_zerfallen_nicht():
    # ein flaches Dach mit zwei gleich hohen Hälften und einem Sattel: ein Gipfel pro Plateau, deterministisch
    z = np.zeros((20, 40))
    z[5:15, 4:14] = 50.0
    z[5:15, 26:36] = 50.0
    z[8:12, 14:26] = 30.0
    gl = prominenz_berechnen(z, np.isfinite(z))
    gross = np.sort(gl.prominenz)[::-1]
    assert gross[0] == 50.0 and gross[1] == pytest.approx(20.0)  # zweites Plateau: 50 - Sattel 30
    assert (gross[2:] == 0).all()


@pytest.mark.parametrize("seed", [0, 1])
def test_gestuftes_gelaende_mit_vielen_plateaus(seed):
    # auf ganze Meter gerundete Höhen erzeugen große Gleichstände (Plateaus, Stufen): Prominenz, Füllung und Bilanz müssen weiter stimmen
    z = np.round(_gelaende(seed, loecher=True) / 8.0) * 8.0
    maske = np.isfinite(z)
    gl = prominenz_berechnen(z, maske)
    referenz = _prominenz_referenz(z)
    for zelle, p in zip(gl.zelle, gl.prominenz):
        assert p == pytest.approx(referenz[int(zelle)], abs=1e-9), int(zelle)
    fn = fliessnetz(z, maske)
    erwartet = np.where(maske, _fuellung_referenz(z) - np.where(maske, z, 0.0), 0.0)
    assert np.allclose(fn.senkentiefe, erwartet)
    assert fn.akkumulation[fn.gueltig & (fn.ziel < 0)].sum() == maske.sum()
