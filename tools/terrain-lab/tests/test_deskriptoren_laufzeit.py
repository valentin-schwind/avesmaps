"""Laufzeitmessung auf einem 1024x1024-Raster. Mit ``pytest -s tests/test_deskriptoren_laufzeit.py`` erscheint die Aufschlüsselung."""

import time

import pytest

from terrainlab.deskriptoren import berechne
from terrainlab.deskriptoren import synthetisch as syn

pytestmark = pytest.mark.filterwarnings("error")

# Großzügige Obergrenzen, damit der Test auf langsamen oder ausgelasteten Rechnern nicht flackert; Richtwert auf dem Entwicklungsrechner: 5 s.
OBERGRENZE_VOLL_S = 90.0
OBERGRENZE_SCHNELL_S = 60.0


def test_laufzeit_1024(capsys):
    r = syn.fbm((1024, 1024), 30.0, beta=2.6, relief_m=1500.0, seed=1)
    t0 = time.perf_counter()
    voll = berechne(r)
    t_voll = time.perf_counter() - t0
    t0 = time.perf_counter()
    schnell = berechne(r, teuer=False)
    t_schnell = time.perf_counter() - t0
    with capsys.disabled():
        print(f"\nLaufzeit 1024x1024: voll {t_voll:.2f} s ({len(voll.metriken)} Metriken), ohne teure {t_schnell:.2f} s ({len(schnell.metriken)} Metriken)")
        for name, s in sorted(voll.kopf["laufzeit_s"].items(), key=lambda t: -t[1]):
            print(f"  {name:<26} {s:7.3f} s")
    assert t_voll < OBERGRENZE_VOLL_S
    assert t_schnell < OBERGRENZE_SCHNELL_S
    assert t_schnell < t_voll
    assert len(voll.metriken) > len(schnell.metriken) > 100
