"""Läufe des Terrain-Labs (WI-0250 Phase B): Generatoradapter, Performance- und Qualitätsbenchmark, Commit-Vergleich.

Der Generator (TypeScript) rechnet, der Adapter ``scripts/dev/terrain-lab/rechne.ts`` misst und schreibt Raster im Austauschformat
(``terrainlab/raster.py``) samt ``meta.json``. Dieses Paket startet den Adapter, wiederholt, fasst zusammen, bewertet die Raster mit den
Deskriptoren und vergleicht Commits. Dokumentation: ``docs/lauf.md``.

Befehle: ``python -m terrainlab lauf perf|qualitaet|vergleiche|stand``.
"""

from __future__ import annotations

FORMAT_PERF = "avesmaps-terrainlab-perf"
FORMAT_QUALITAET = "avesmaps-terrainlab-qualitaet"
FORMAT_VERGLEICH = "avesmaps-terrainlab-vergleich"
VERSION = 1
