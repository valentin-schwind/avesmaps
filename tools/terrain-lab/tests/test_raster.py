import numpy as np
import pytest

from terrainlab.raster import Hoehenraster, lies, schreibe


def test_hin_und_zurueck(tmp_path):
    h = np.arange(12, dtype=np.float32).reshape(3, 4)
    h[1, 2] = np.nan
    schreibe(Hoehenraster(h, 30.0, {"quelle": "test"}), tmp_path / "a")
    r = lies(tmp_path / "a.json")
    assert r.form == (3, 4)
    assert r.zellgroesse_m == 30.0
    assert r.herkunft == {"quelle": "test"}
    assert np.isnan(r.hoehen[1, 2])
    assert np.array_equal(np.nan_to_num(r.hoehen, nan=-1), np.nan_to_num(h, nan=-1))


def test_pruefsumme_erkennt_veraenderung(tmp_path):
    schreibe(Hoehenraster(np.zeros((2, 2), np.float32), 1.0), tmp_path / "b")
    (tmp_path / "b.f32").write_bytes(np.ones((2, 2), "<f4").tobytes())
    with pytest.raises(ValueError, match="Prüfsumme"):
        lies(tmp_path / "b")
