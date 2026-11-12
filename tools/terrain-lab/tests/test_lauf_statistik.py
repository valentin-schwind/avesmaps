import math

from terrainlab.lauf.statistik import fasse, median


def test_median_und_streuung():
    f = fasse([100, 102, 98, 100, 150])
    assert f["n"] == 5
    assert f["median"] == 100
    assert f["min"] == 98 and f["max"] == 150
    # Die mediane absolute Abweichung ignoriert den Ausreißer (150): |x - 100| = 0, 2, 2, 0, 50 -> Median 2.
    assert f["streuung_prozent"] == 2.0
    assert f["spanne_prozent"] == 52.0


def test_einzelner_wert_hat_keine_streuung():
    f = fasse([42.0])
    assert f["median"] == 42.0 and f["streuung_prozent"] == 0.0 and f["stdev"] == 0.0


def test_leer_und_nicht_endlich():
    assert fasse([])["n"] == 0
    assert fasse([])["median"] is None
    f = fasse([1.0, math.nan, None, math.inf, 3.0])
    assert f["n"] == 2 and f["median"] == 2.0


def test_median_hilfsfunktion():
    assert median([3, 1, 2]) == 2
    assert median([]) is None
