# Übergabe: die Gebirgstypen auf die geomorphologische Systematik

**Stand 04.09.2026, Kontext der Sitzung war voll — nichts davon ist committed.**
Auftrag des Owners, wörtlich:

> „Kannst du dir die settings nochmal anschauen und so anpassen, wie es zu diesen beschreibungen
> passt. benenne unsere jetztigen gebirgstypen entsprechend um (karst und die jetzigen
> einstellungen bleiben als 10. typ, die jetzigen einstellungen von pleateau bleiben auch).
> aktualisiere die grafik fürs handbuch mit den 10 typen."

Dazu hat er die Typenliste der Wikipedia mitgeliefert (Gratgebirge · Kammgebirge · Kettengebirge ·
Kuppengebirge · Massengebirge · Plateaugebirge · Rumpfgebirge · Schild · Inselberg), jeweils mit
Definition und Musterbeispiel.

🔴 **Der Owner gibt in der nächsten Sitzung die KORREKTEN Preset-Werte selbst mit.** Die Zahlen, die
jetzt im Arbeitsbaum stehen, sind meine Herleitung aus den Definitionen — sie sind **nicht
abgenommen und nicht gemessen**. Wo seine Werte von ihnen abweichen, gewinnen seine.

---

## 1. Was im Arbeitsbaum liegt (uncommitted)

Genau **eine** Datei ist geändert:

    js/map-features/map-features-ecosystem-hydrologie.js   (+137 / −74)

Darin:

- `ECOSYSTEM_HYDRO_MORPHOLOGIEN` hat statt neun jetzt **zehn** Einträge, jeder mit Fachdefinition
  und Musterbeispiel im Kommentar.
- neu daneben: `ECOSYSTEM_HYDRO_MORPH_ALTNAMEN` + `avesmapsHydroMorphSchluessel(key)` — die
  Übersetzung alter gespeicherter Schlüssel. **Sie hat noch KEINEN Aufrufer.**
- beide sind in `module.exports` ergänzt.

Die Datei lädt unter Node, die Zeilenenden sind unverändert CRLF.

💣 **NICHT committen, bevor die Werte des Owners drin sind.** Ein Push geht in 1–2 Minuten live, und
diese Vorlagen setzen zehn Regler auf einmal.

---

## 2. Die Zuordnung alt → neu

| alt (9) | neu (10) | was passiert |
|---|---|---|
| `plateau` | `plateaugebirge` | **Werte unverändert** (Owner ausdrücklich) |
| `rumpfgebirge` | `rumpfgebirge` | Werte unverändert, Kommentar auf Böhmische Masse |
| `massiv` | `massengebirge` | Werte unverändert, nur Fachname |
| `haertling` | `inselberg` | Härtling *ist* ein Inselberg (Uluru ist das Musterbeispiel für beides) |
| `kegelberge` | `inselberg` | fällt mit dem Härtling zusammen — unterschied sich nur durch etwas weniger Erosion |
| `kuppengebirge` | `kuppengebirge` | Werte unverändert |
| `gratgebirge` | `gratgebirge` | auf „**verästelte** Kammlinien" geschärft (Taunus), Sattel 0,9 → 0,88 |
| `karst` | `karst` | **Werte unverändert** (Owner-Bestand der Roten Sichel) |
| `karstrelief` | *(entfällt)* | ging im Karst auf; der alte Kommentar warnte selbst, die zwei Namen seien verwirrend ähnlich |
| — | `kammgebirge` | **neu** — EINE Hauptkammlinie (Riesengebirge) |
| — | `kettengebirge` | **neu** — mehrere parallel gestaffelte Kämme (Alpen) |
| — | `schild` | **neu** — alter Rumpf als Tafelland (Baltischer Schild) |

Rechnung: 9 − 2 (kegelberge, karstrelief) + 3 (kamm, kette, schild) = **10**. ✔

**Reihenfolge im Auswahlfeld und in der Grafik** (5 + 5): Kammgebirge · Gratgebirge · Kettengebirge ·
Kuppengebirge · Massengebirge // Plateaugebirge · Rumpfgebirge · Schild · Inselberg · Karst —
erst die fünf Formen *mit* Relief, dann die drei abgetragenen, dann der Einzelberg und der
Sonderfall.

### Die drei neuen Formen im Modell

Es gibt **keinen** Regler für „Linienförmigkeit" oder „parallele Kämme"; die drei linienförmigen
Typen unterscheiden sich über Körnung, Stufen und Sattel:

- **Kammgebirge** — Sattel fast ohne Durchhang, **grobe** Körnung, wenige Stufen: die Flanken
  bleiben glatt, die eine Linie zerfällt nicht in Seitenrippen.
- **Gratgebirge** — **feine** Körnung, viele Stufen, volle Erosion: das Rinnennetz *macht* die
  Verästelung.
- **Kettengebirge** — kräftiges Rauschen bei **mittlerer** Körnung und **wenigen** Stufen: einige
  wenige große Rücken neben dem Hauptkamm. Tiefster Einschnitt aller Formen (glazial übertieft).

**Schild vs. Plateaugebirge** ist das **Alter**: das Plateau trägt eine haltende Deckschicht
(`erosion: 1`) mit Abbruchkante, der Schild ist durcherodiert (`erosion: 5`) und läuft in weiten
Mulden aus. Sein hohes HI sagt genau das: fast alles liegt auf einer Höhe.

---

## 3. Was noch aussteht

1. **Die Werte des Owners einsetzen.** Er bringt sie mit. Danach die Kalibrierprobe fahren (Punkt 2).
2. **Kalibrierprobe** — `js/map-features/__tests__/gelaende-vorlagen.test.js` (ab Zeile ~205) prüft,
   dass **keine zwei Vorlagen dasselbe Bild** ergeben (HI und Plateauanteil dürfen sich nicht
   gleichzeitig um weniger als 0,04 unterscheiden). Bei zehn Formen ist die Wahrscheinlichkeit einer
   Kollision spürbar höher als bei neun — der Test ist die eigentliche Abnahme.
   Das Messskript liegt bereit unter
   `%TEMP%/claude/C--GIT-avesmaps/2c7124c8-.../scratchpad/morphologien.js` (rendert alle zehn auf
   *derselben* Fläche mit *denselben* sieben Gipfeln und misst HI · Gipfelfläche · **Rücken**
   (Zusammenhangskomponenten über 0,55·max — trennt Kamm=1 von Kette=mehrere von Inselberg=isoliert)
   · Rauheit · Feinheit). Es war noch **nie ausgeführt**; das Licht darin kommt bereits von links
   unten wie in der Karte.
3. **Der Übersetzer braucht Aufrufer** — `avesmapsHydroMorphSchluessel` hängt an nichts. Er gehört in
   `js/map-features/map-features-ecosystem-properties.js`, in `vorlagenWerte(area)` (~Z. 1597) und in
   das Füllen des Auswahlfelds (~Z. 1696), damit eine Fläche mit gespeichertem `massiv` weiterhin
   „Massengebirge" anzeigt statt „Eigene Werte".
   ⚠️ **Live ist genau EINE Fläche betroffen** — gemessen am 04.09.2026 über
   `GET /api/app/ecosystem-areas.php?kind=topographie`: 695 Flächen, davon eine mit
   `terrain_preset_morph = 'karst'` + `terrain_preset_hoehe = 'hochgebirge'` (die Rote Sichel), und
   `karst` bleibt. Der Übersetzer ist also Vorsorge, kein Notfall — aber der Owner arbeitet parallel.
4. **Die Grafik** `html/screenshots/20-morphologien.png` neu bauen (heute 9 Bilder, 1037×410, 5+4).
   Bei zehn wird die zweite Reihe voll.
5. **Das Handbuch** `html/editor-handbuch.html` — die Bildunterschrift nennt heute die neun alten
   Namen in Lesereihenfolge; sie muss auf die zehn neuen.
   ⚠️ Das Handbuch gehört sonst der nächtlichen Routine (AGENTS.md §9); hier ist der Owner-Auftrag
   die dort genannte Ausnahme, und er steht wörtlich im letzten Commit `ef3352c49`.
6. **Tests nachziehen** — `gelaende-vorlagen.test.js:91` benutzt `"massiv"` als Beispielschlüssel
   (schlägt sonst fehl). `ecosystem-height-field.test.js`, `gelaenderegler-kette.test.js` und
   `gelaende-vorgabemarken.test.js` fassen die Schlüssel nicht namentlich an, sollten aber im
   Testfeld mitlaufen.
7. **Der Übersetzer braucht einen eigenen Test** — dass jeder alte Schlüssel auf einen existierenden
   neuen zeigt, und dass ein unbekannter unverändert zurückkommt.

Kein PHP ist betroffen: `terrain_preset_morph` ist dort `VARCHAR(40)` und wird nur durchgereicht.

---

## 4. Fallen

- 💣 **CRLF.** Die Datei ist durchgehend CRLF; ein Patch-Skript muss `newline=''` lesen *und*
  schreiben, sonst kippt die ganze Datei auf LF und der Diff ist 1.900 Zeilen groß.
- 💣 **Heredoc.** Ein Python-Skript mit deutschen Anführungszeichen und Emoji über
  `bash <<'EOF'` schlug in dieser Sitzung mit „unexpected EOF" fehl. Skript mit dem Write-Tool
  anlegen, dann `python <datei>` — das lief auf Anhieb.
- 💣 **Eine Vorlage ist ein Ausgangspunkt, kein Zustand.** Gespeichert werden die zehn *Zahlen*; der
  Name ist Herkunftsangabe und Bezugspunkt für Dreiecke und ↺. Eine Umbenennung ändert deshalb an
  keinem Gelände etwas — nur die Anzeige.
- ⚠️ **Der geteilte Baum trägt fremde Arbeit** (Garetien-Importer, `sql/db-speicher-*`,
  `tools/db-recovery/`, `api/app/map-features.php` …). Nur die eigene Datei stagen, nie `git add -A`.
- 🪤 Der Owner hat die Ausführung des Messskripts abgebrochen — es ist ungeprüft, nicht verworfen.

---

## 5. Der Prompt für die nächste Sitzung

> Wir setzen die Umstellung der Gebirgstypen auf die geomorphologische Systematik fort. Lies zuerst
> `docs/superpowers/plans/2026-09-04-gebirgstypen-systematik-uebergabe.md` — dort steht der Stand.
>
> Im Arbeitsbaum liegt **uncommitted** die neue Zehner-Tabelle in
> `js/map-features/map-features-ecosystem-hydrologie.js`. Die Struktur, die Namen und die
> Reihenfolge stehen; die **Zahlen** darin sind meine Herleitung und werden durch die ersetzt, die
> ich dir hier mitgebe:
>
> *(→ hier die korrigierten Preset-Werte einfügen)*
>
> Danach der Reihe nach:
> 1. Werte einsetzen, das Messskript aus dem Handover fahren und mir **die Tabelle** zeigen
>    (HI · Gipfelfläche · Rücken · Rauheit · Feinheit je Form) — keine zwei Formen dürfen dasselbe
>    Bild ergeben.
> 2. `avesmapsHydroMorphSchluessel` in `map-features-ecosystem-properties.js` verdrahten
>    (`vorlagenWerte` + das Füllen des Auswahlfelds) und einen Test dafür schreiben.
> 3. Die Handbuchgrafik `html/screenshots/20-morphologien.png` mit **zehn** Formen neu bauen und die
>    Bildunterschrift im Handbuch auf die neuen Namen ziehen.
> 4. Testfeld ganz durchfahren (beide Workflow-Muster, parallel), dann committen und pushen —
>    **die sichtbare Änderung geht einzeln live**, danach schaue ich sie mir an.
