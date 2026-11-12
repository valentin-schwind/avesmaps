"""GDAL aus der projektlokalen Umgebung bereitstellen.

Die Umgebung (`C:/avesmaps3d-data/terrain-lab/env`, micromamba) wird nicht aktiviert, sondern ihr `python.exe` direkt mit `-s`
aufgerufen. Damit GDAL trotzdem seine eigenen DLLs (z. B. libcurl), Datendateien (GDAL_DATA, PROJ) und Zertifikate findet, setzt dieses
Modul vor dem ersten `import osgeo` Pfad und Umgebungsvariablen aus `sys.prefix`. Ohne das lädt Windows eine fremde `libcurl.dll` aus dem
PATH (Git, Systemordner) und der Netzbezug scheitert mit „SSL certificate problem“.

`osgeo` wird bewusst erst beim Aufruf von `gdal_osr()` geladen: Manifest, Prüfsummen und Raster-Austausch brauchen kein GDAL.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

_bereit = False


def _vorbereiten() -> None:
    global _bereit
    if _bereit:
        return
    wurzel = Path(sys.prefix)
    ordner = [
        wurzel / "Library" / "bin",
        wurzel / "Library" / "mingw-w64" / "bin",
        wurzel / "Library" / "usr" / "bin",
        wurzel / "Scripts",
        wurzel / "bin",
    ]
    vorhanden = [str(o) for o in ordner if o.is_dir()]
    if vorhanden:
        os.environ["PATH"] = os.pathsep.join(vorhanden + [os.environ.get("PATH", "")])
    for name, unterpfad in (
        ("GDAL_DATA", Path("Library") / "share" / "gdal"),
        ("PROJ_DATA", Path("Library") / "share" / "proj"),
        ("PROJ_LIB", Path("Library") / "share" / "proj"),
    ):
        ziel = wurzel / unterpfad
        if name not in os.environ and ziel.is_dir():
            os.environ[name] = str(ziel)
    zertifikate = wurzel / "Library" / "ssl" / "cacert.pem"
    if zertifikate.is_file():
        os.environ.setdefault("GDAL_HTTP_CAINFO", str(zertifikate))
        os.environ.setdefault("CURL_CA_BUNDLE", str(zertifikate))
    _bereit = True


def gdal_osr() -> tuple[Any, Any]:
    """Liefert `(gdal, osr)` mit Ausnahmen statt Rückgabecodes und sinnvollen Netzeinstellungen für Remote-Rasterfenster."""
    _vorbereiten()
    try:
        from osgeo import gdal, osr
    except ImportError as fehler:  # pragma: no cover - nur ohne Laborumgebung
        raise RuntimeError(
            "GDAL (osgeo) fehlt. Dieser Befehl braucht die projektlokale Umgebung aus tools/terrain-lab/environment.yml "
            "(Aufruf mit C:/avesmaps3d-data/terrain-lab/env/python.exe -s)."
        ) from fehler
    gdal.UseExceptions()
    osr.UseExceptions()
    # Remote-Rasterfenster: HTTP/2 mit Multiplexing, nur .tif-Anfragen (keine Verzeichnissuche), Wiederholungen bei Netzfehlern.
    for schluessel, wert in (
        ("GDAL_HTTP_MULTIPLEX", "YES"),
        ("GDAL_HTTP_VERSION", "2"),
        ("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif"),
        ("GDAL_HTTP_MAX_RETRY", "5"),
        ("GDAL_HTTP_RETRY_DELAY", "2"),
        ("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR"),
    ):
        gdal.SetConfigOption(schluessel, wert)
    return gdal, osr


def versionen() -> dict[str, str]:
    """Versionen der beteiligten Werkzeuge für Manifest und Rasterkopf."""
    import numpy

    ergebnis = {"python": sys.version.split()[0], "numpy": numpy.__version__}
    try:
        gdal, _ = gdal_osr()
        ergebnis["gdal"] = gdal.__version__
    except RuntimeError:
        pass
    return ergebnis
