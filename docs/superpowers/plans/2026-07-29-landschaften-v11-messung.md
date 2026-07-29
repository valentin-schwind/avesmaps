# Landschaften V11 — Messungen

**Diese Datei sammelt, was gemessen wurde — sie ist kein Entwurf.** Sie wächst in drei Schritten:
Aufgabe 1 (Bestand), Aufgabe 11 (Verteilung und Kurve), Aufgabe 12 (Abnahme).

## 1. Bestand, nachgezählt am 2026-07-29

| | Spec (ecosystem_revision 3983) | heute | Abweichung |
|---|---|---|---|
| Gebirgsflächen | 15 | 16 | +6,7% |
| Gipfel gesamt | 67 | 67 | — |
| **Gipfel mit Höhe** | **16** | **16** | **—** |
| Wege | 5.655 | 5.657 | +0,04% |
| Wegstücke | 36.139 | 36.153 | +0,04% |
| mittlere Wegstücklänge | 1,436 E | 1,4355 E | −0,03% |
| Raster roh, alle | 1,01 MB | 1,0157 MB | +0,67% |
| größtes Raster roh | 286 KB | 285,4 KB | −0,21% |

Verfahren: je eine Anfrage an `/api/app/ecosystem-areas.php` und `/api/app/map-features.json`, danach offline ausgezählt. Keine Schleife gegen die API.

**Hinweis zur Messung:** Der Bestand ist stabil. Abweichungen liegen alle unter 10 % und reflektieren Wachstum der Karte seit ecosystem_revision 3983. Die Gebirgsflächen-Anzahl ist um 1 gestiegen (15 → 16), alle anderen Kennzahlen bleiben im Plan. `peaks_with_height` wurde mit korrigiertem Lesepfad (`properties.height_schritt` statt `properties.properties.height_schritt`) ermittelt.
