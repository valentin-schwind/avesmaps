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

Verfahren: je eine Anfrage an `/api/app/ecosystem-areas.php` und `/api/app/map-features.php`, danach offline ausgezählt. Keine Schleife gegen die API.

**Hinweis zur Messung:** Der Bestand ist stabil. Abweichungen liegen alle unter 10 % und reflektieren Wachstum der Karte seit ecosystem_revision 3983. Die Gebirgsflächen-Anzahl ist um 1 gestiegen (15 → 16), alle anderen Kennzahlen bleiben im Plan. `peaks_with_height` wurde mit korrigiertem Lesepfad (`properties.height_schritt` statt `properties.properties.height_schritt`) ermittelt.

---

## 1a. 🔴 Die Grundlinie, gegen die Abnahmeschritt 1 vergleicht

Gemessen am **2026-07-29 am Livebestand, VOR dem Deploy dieses Zweigs** — eine Sonde, keine Schleife:

```
POST https://avesmaps.de/api/route/   {"from":"Gareth","to":"Thorwal"}
cost     = 65.60202533378045
segments = 45
```

**Mit Schalter AUS muss dieselbe Anfrage nach dem Deploy exakt diese Zahl liefern.** Nicht „ungefähr" —
bit-genau. Weicht sie ab, hat V11 in seinem Ruhezustand etwas angefasst, und das ist ein Grund
anzuhalten, kein Rundungsproblem.

Was diese Zusicherung im Code trägt: bei leerer Terrain-Karte greift der Vor-V11-Zweig mit dem
**geteilten** Verbindungsobjekt, und am Wegpunkt-Anker ist der Elternfaktor exakt `1.0`, sodass
`$originalTime / 1.0` in IEEE 754 verlustfrei ist. Die Prüfung hat das zusätzlich empirisch belegt:
`client-graph.php` aus dem Stand vor der Faktor-Anwendung neu gebaut und den **vollständigen
serialisierten Graphen** (16 Kanteneinträge, Land + Fluss + Anker) gegen den neuen verglichen —
byte-identisch.

---

## 1b. 🔴 Was NIE ausgeführt wurde — die Reihenfolge für die Abnahme

💣 **Die Entwicklungsumgebung hat PDO, aber NULL Treiber** (`PDO::getAvailableDrivers()` liefert `[]`;
weder `pdo_mysql` noch `pdo_sqlite` sind einkompiliert). **Keine einzige datenbankberührende Zeile
dieses Zweigs wurde je ausgeführt** — auch nicht gegen eine Speicherdatenbank. Ebenso wenig wurde eine
Editor-Oberfläche je angeklickt (Overlay-iframe mit Anmeldung).

Die Abnahme ist deshalb **kein Nachweis, sondern der erste Lauf.** Nach Risiko geordnet:

| # | Pfad | Worauf achten |
|---|---|---|
| 1 | **Profillauf (`terrain_profile_step`)** | 💣 `rows_with_profile` **> 0**. Steht es auf 0, *obwohl* Raster da sind, verfehlt der Verbund die Wege — **nicht** die Kurve. Genau dieser Fehler kostete V10 einen Totalausfall. |
| 2 | **`heightmap_put` für eine echte Fläche** | Base64 → Wächter → `gzdeflate` → LONGBLOB → `gzinflate` → `unpack('v')`. Bytereihenfolge, die Invariante `w·h·2`, und das DECIMAL-Hin-und-Zurück von `origin_x`/`cell_size` treffen hier zum ersten Mal auf die Wirklichkeit. **Ein abgeschnittenes Blob sieht aus wie ein ganzes.** |
| 3 | **Rasterlauf bei ~1,4 Mio Pixeln** | Das 32-Zeilen-Band ist das Einzige zwischen dir und einem eingefrorenen Tab. Die Kachel muss sichtbar hochzählen. |
| 4 | **Eine Route mit Schalter AN, zeitlich gemessen** | ~5.657 Zeilen plus `json_decode` je Besucheranfrage — nie gemessen. Einmal vorher, einmal nachher. |
| 5 | **`avesmapsHeightmapLoadAll` je Schritt** | Der ganze Rasterbestand wird pro Schritt neu entpackt. Bei 16 Flächen unkritisch, eine Zahl wert. |
| 6 | **Wegpunkt-Anker an echter Geometrie** | Unit-getestet (absolute Werte, drei Mutationen rot gesehen), aber nie live. `via` wird abgewiesen, es erreicht ihn also nur ein gestrandeter Start/Zielort. |
| 7 | **Veraltungs-Meldung** | `debug.context.terrain.stale` nach einer geänderten Gipfelhöhe. Kachel und Route sind **zwei unabhängige Vergleiche**, die noch nie gemeinsam gesehen wurden. |

⚠️ **Und die neue DDL läuft bei jedem Ökosystem-Lesen mit.** Drei `CREATE TABLE` plus ein `ALTER`
stehen in `avesmapsEcosystemEnsureTables`. Ist eine davon auf diesem MySQL fehlerhaft, bricht der
Landschaften-Editor sofort nach dem Deploy — laut, nicht still. Die generierten Spalten brauchen
MySQL ≥ 5.7; dieselbe Untergrenze gilt für die `JSON`-Spalten, die dort längst stehen.

**Der Schalter bleibt AUS**, bis Abschnitt 2 vorliegt und die obere Klemme entschieden ist.
