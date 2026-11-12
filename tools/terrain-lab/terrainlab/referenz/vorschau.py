"""Schummerungsbild einer aufbereiteten Stufe (`referenz vorschau`) zur Sichtprüfung. Liegt neben den Rastern, nie im Repository."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from terrainlab.raster import lies


def schreibe_vorschau(raster_json: Path, ziel_png: Path, ueberhoehung: float = 2.0) -> Path:
    """Schummerung (Licht aus Nordwest) über einer Höhenfarbskala; NaN bleibt weiß."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import cm
    from matplotlib.colors import LightSource, Normalize

    raster = lies(raster_json)
    hoehen = raster.hoehen
    maske = np.isnan(hoehen)
    fuell = float(np.nanmin(hoehen)) if (~maske).any() else 0.0
    gefuellt = np.where(maske, fuell, hoehen)
    licht = LightSource(azdeg=315, altdeg=40)
    bunt = cm.terrain(Normalize(float(np.nanmin(hoehen)), float(np.nanmax(hoehen)))(gefuellt))
    schummerung = licht.shade_rgb(bunt[..., :3], gefuellt, vert_exag=ueberhoehung, dx=raster.zellgroesse_m, dy=raster.zellgroesse_m)
    schummerung[maske] = 1.0
    ziel_png.parent.mkdir(parents=True, exist_ok=True)
    plt.imsave(str(ziel_png), schummerung)
    return ziel_png
