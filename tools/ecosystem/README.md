# Landschaften V5 — Kachel-Ableitung Land/Wasser

Leitet aus den ausgelieferten Kartenkacheln Seen- und Inselflächen ab und spielt sie über den
**bestehenden** Schreibendpunkt in `ecosystem_region` / `ecosystem_area` ein.

Plan: `docs/superpowers/plans/2026-07-26-landschaften-v5-kachel-ableitung.md`.
Alle Grenzwerte sind an gemessenen Daten geankert; die Begründungen stehen dort und im Code.

## Der Ablauf in vier Befehlen

```bash
# 1) Die Nutzlast EINMAL holen -- kein Schleifenbetrieb gegen STRATO.
curl -s -o map-features.json https://avesmaps.de/api/app/map-features.php

# 2) Die y-Spiegelung gegen die Wirklichkeit prüfen. Muss "orientation OK" sagen.
python verify_orientation.py --payload map-features.json --zoom 2

# 3) Ableiten. Schreibt nichts in die Datenbank und braucht keine Anmeldung.
python derive_areas.py --payload map-features.json --out manifest.json --report report.md

# 4) Einspielen. Ohne --commit passiert nichts.
python import_areas.py --manifest manifest.json --cookie-file cookie.txt --commit --limit 3
```

Erwartet bei Schritt 3 (Stand 2026-07-27, Nutzlast-Revision 40455): **124 Flächen**
(82 `insel`, 42 `see`), 6 umstritten, 5 ohne Komponente. Weicht das um mehr als ±5 ab, stimmt
eine Annahme nicht — dann **nicht** importieren, sondern nachsehen.

## Die drei Grenzwerte und warum sie so stehen

| Argument | Vorgabe | Warum genau dieser Wert |
|---|---|---|
| `--zoom` | `3` (8192 px, 8 px je Karteneinheit) | Zoom 5 wäre 3,2 GB im Speicher und trägt nur dort noch etwas bei, wo die Schwelle schon sitzt. |
| `--simplify-ratio` | `0.002` | ε als Anteil am **eigenen Umfang** der Form, nicht absolut — sonst behält Maraskan 126 Ecken, während die Insel Sigorast auf 4 zusammenfällt. 0,002 ist die feinste Stufe, die die Baronie-Dichte (Median 49 / p90 85 / max 147) auf allen drei Maßen einhält. Vom Owner am 2026-07-27 am Bild abgenommen. |
| `--blue-over-green` | `-20` | Die Produktionsschwelle (`13_make_landmass_rgba.py`) verlangt `B ≥ G+10`. Der Flachwassersaum der ausgelieferten Kacheln ist **grün**dominantes Türkis, fällt dort als Land an und **verschweißt Nachbarinseln**: Archipel A wird aus 4 Inseln eine, selbst bei Zoom 5. Bei −20 trennen sich beide Testarchipele bei Zoom 3. |
| `--min-hole-area` | `2.0` Karteneinheiten² | Ohne Untergrenze bekam Maraskan 172 Löcher — jeder Tümpel. Geankert an den echten Seen: die 42 benannten reichen von 0,08 bis 498, und 2,0 behält Löcher in der Größe der kleinsten benannten. |
| `--holes` | `water` | Ein See schließt die Inseln in ihm aus. Eine **benannte Insel** deckt ihre eigenen Seen mit ab — sonst fällt eine Route quer über Maraskan an jedem Bach aus der Insel, und ein Loch ohne zugehörige Seefläche ließe sie in gar keinem Gebiet. |

## 🔧 Der scharfe Lauf (Owner)

`import_areas.py` schreibt **nur** mit `--commit` und braucht eine Editor-Sitzung. Die
Cookie-Datei schreibt der Owner selbst; das Skript fragt nie nach Zugangsdaten, gibt den Wert
nie aus und enthält keinen:

```bash
# In Chrome, angemeldet auf avesmaps.de:
#   DevTools -> Application -> Cookies -> PHPSESSID kopieren
echo "PHPSESSID=<wert>" > cookie.txt
```

Danach **erst drei Flächen**, im Editor unter `?landschaften=1` ansehen, dann der Rest:

```bash
python import_areas.py --manifest manifest.json --cookie-file cookie.txt --commit --limit 3
python import_areas.py --manifest manifest.json --cookie-file cookie.txt --commit
```

Der Lauf ist wiederaufsetzbar: `import-state.json` hält je Label fest, was schon existiert.
Ein Abbruch wird beim nächsten Aufruf fortgesetzt, nichts wird doppelt angelegt.
**`cookie.txt` danach löschen.**

Zum Schluss prüfen, dass `map_revision` unberührt blieb (ein einzelner Aufruf, keine Schleife):

```bash
curl -s -o /dev/null -D - -H 'If-None-Match: <aktueller ETag>' -w "http=%{http_code}\n" "https://avesmaps.de/api/app/map-features.php"
```

**304 = Regel 3 hält.**

## Tests

```bash
python test_ecosystem_v5.py
```

34 Tests, alle auf **synthetischen** Rastern — keine Kachel, kein Netz, kein Zufall. Was echte
Daten braucht, steht in `verify_orientation.py` und im Ableitungsbericht.

## Was V5 **nicht** kann

`kueste` (2 Label), `wueste` (4) und `kontinent` (2) sind mit einer Land/Wasser-Schwelle nicht
ableitbar und bleiben Handarbeit: Küstenlabel liegen **im Wasser** und eine Küste ist eine Linie;
Wüsten sind Land und keine Farbe trennt sie (»Gorische Steppe« sieht sandiger aus als zwei der
vier Wüsten); Aventurien und Riesland treffen dieselbe Komponente. Wälder und Gebirge sind
trennbar, aber nur mit einem Klassifikator über Farbe **und** Textur bei ~90 % je Bildfenster —
das reicht für einen Startumriss (V7/V8), nicht für »ableiten und ungesehen importieren«.
