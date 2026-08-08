# Auftrag: Ansicht und Karteneinstellungen überleben den Reload (Edit-Modus)

**Stand:** 2026-07-25 · **Status:** Auftrag für eine eigene Sitzung. Nichts davon ist gebaut.
**Vorgeschichte:** `docs/superpowers/specs/2026-07-25-landschaften-planpruefung-2.md` §G4
(dort die volle Beweisführung).

## Ziel

> „Im Edit-Modus sollen Bildausschnitt, Zoomstufe und die letzten Karteneinstellungen
> erhalten bleiben, wenn ich Strg+Shift+F5 drücke."

Zwei Hälften mit völlig verschiedenem Charakter — **erst A, dann B, getrennt abnehmen**:

| | | Art | Umfang |
|---|---|---|---|
| **A** | Karteneinstellungen (Modus + Filter) | **Regression seit 2026-07-10** | ~1 Zeile |
| **B** | Bildausschnitt + Zoomstufe | **Neubau, gab es nie** | ~60–100 Z. |

> **Strg+Shift+F5 ist der einfache Fall, nicht der schwere.** Ein Hard-Reload umgeht den
> HTTP-Cache, **löscht aber `localStorage` nicht**. Der Speicher ist also das richtige
> Medium und trägt genau den Fall, um den es geht.

---

## Teil A — die Regression

**Was existiert:** Der Edit-Modus speichert seine Filter seit 2026-05-06 in
`localStorage["avesmaps.edit.plannerState"]` (`js/config.js:310`) und stellt sie beim
Laden wieder her.

| | |
|---|---|
| Schreiben | `syncPlannerStateToUrl()`, `js/map-features/map-features-layer-state.js:325–336` — steigt bei `!IS_EDIT_MODE` sofort aus |
| Lesen | `getInitialPlannerSearchParams()`, `:155–175` |
| **Das Tor** | `hasPlannerStateSearchParams()`, **`:177–186`** |

Das Tor lautet: *steht außer `edit`/`debugMap` **irgendein** Parameter in der URL, dann
hat der Nutzer seinen Zustand mitgebracht — Restore überspringen.*

**Was es kaputtgemacht hat:** `694f9929` (2026-07-10, *„fix(edit): cache-bust the editor
map iframe so deploys land without a hard reload"*) hängt seither **bedingungslos**
`&_v=filemtime(index.html)` an die iframe-URL (`edit/index.php:53–58`). Damit sieht das
Tor **immer** einen Fremdparameter, und der Restore wird bei **jedem** Laden über
`/edit/` übersprungen — für jeden Editor, seit dem 10.07.

> Der Cache-Bust ist richtig und bleibt. Der Denkfehler ist die Gleichsetzung
> „Parameter vorhanden" = „Zustand mitgebracht". `_v` ist **Infrastruktur**, kein Zustand.

- [ ] **Schritt 1:** In `hasPlannerStateSearchParams()` (`:178`) `ignoredParams` von
      `{"edit", "debugMap"}` auf `{"edit", "debugMap", "_v"}` erweitern. Kommentar dazu,
      **warum** — sonst fällt derselbe Fehler beim nächsten Infrastruktur-Parameter wieder an.
- [ ] **Schritt 2:** Abnahme im Browser: `/edit/` öffnen, Kartenmodus und ein paar Filter
      umstellen, **Strg+Shift+F5**. Modus und Filter müssen stehen. Danach dasselbe mit
      `index.html?edit=1&debugMap=1` direkt (der Weg war nie kaputt — er darf sich nicht
      ändern). Und mit `?edit=1&mapLayerMode=political`: der **URL-Parameter muss
      weiterhin gewinnen**, nicht der Speicher.
- [ ] **Schritt 3: Commit** — `fix(edit): the cache-bust token no longer wipes the remembered editor filters`

> **Später, nicht jetzt:** sobald `?landschaften=1` existiert, gehört es aus demselben
> Grund in dieselbe Liste (Landschaften-Plan V1.1). Nicht vorwegnehmen — das Flag gibt es
> noch nicht.

---

## Teil B — Bildausschnitt und Zoomstufe

**Was es dazu heute gibt: nichts.** Über die volle Historie (4.072 Commits) speichert
**kein** Commit je Kartenmitte oder Zoomstufe — geprüft mit `flyTo`, `getCenter`,
`getZoom`, `viewState`, `mapView`/`lastView`/`savedView`/`restoreView`, `mapCenter`,
`zoom=`/`lat=`/`lng=`/`center=`, `#map=`, `L.Hash`, `onhashchange`. Der Start-Aufruf war
seit `0c5a0f1b` (2025-06-12) **immer** fest verdrahtet; heute
`js/app/bootstrap.js:13` — `.setView([478.0, 539.0], 2)`.

### Der Entwurf: den Startwert **säen**, nicht nachträglich zurückspringen

Die Ladereihenfolge erlaubt den einfachen Weg:

```
index.html:1644   js/config.js                     → IS_EDIT_MODE, Speicherschlüssel
index.html:1728   …/map-features-layer-state.js
index.html:1796   js/app/bootstrap.js              → hier entsteht `map` (:13)
```

`IS_EDIT_MODE` und der Speicherschlüssel stehen also bereits bereit, wenn die Karte
angelegt wird. Deshalb: **die gespeicherte Position direkt als Argument von `setView`
verwenden**, statt nach dem Laden dorthin zu springen.

Das erspart zwei Dinge auf einmal — den sichtbaren Sprung **und** die gesamte
Vorrangfrage. Alles, was heute beim Start navigiert, läuft **nach** der Kartenerzeugung
und überschreibt den Startwert bereits so, wie es den Vorgabewert überschreibt:

| Navigator | Fundstelle |
|---|---|
| `?s=` Kurzlink | `js/app/share-link.js:11–20` |
| Wiki-Deeplinks `?siedlung/?staat/?region/?strasse/?fluss` | `js/app/wiki-deeplink.js:24–33` |
| `?place=` | `js/map-features/map-features-layer-state.js:202–208` |
| `?route=` (fliegt auf die Route) | `25284f81`, `flyToBounds` |
| Spotlight-Fokus, Infopanel-Reiter, Review-/Konfliktlisten | diverse `flyTo` |

**Kein einziger davon braucht eine Sonderbehandlung**, solange der Startwert nur der
Startwert ist. Genau das ist der Grund für diesen Entwurf.

### Schritte

- [ ] **Schritt 1: Eigener Speicherschlüssel.** `avesmaps.edit.mapView`, Inhalt
      `{"lat":…, "lng":…, "zoom":…}`.

      💣 **Nicht** in `avesmaps.edit.plannerState` mit hineinschreiben. Dieser Satz wird
      von `buildPlannerSearchParams()` erzeugt — und **dieselbe Funktion baut die
      geteilten Links** (`js/app/share-link.js:58–59`). Ein `lat`/`lng`/`zoom` dort landet
      in jedem `?s=`-Link, den ein Editor je erzeugt.

- [ ] **Schritt 2: Schreiben.** An `moveend` und `zoomend`, gedrosselt (~400 ms), nur bei
      `IS_EDIT_MODE`, in `try/catch` (Muster: `syncPlannerStateToUrl`, `:328–335`).
      `map.getCenter()` und `map.getZoom()`.

      Werte vor dem Schreiben auf Endlichkeit prüfen — `Number.isFinite` für beide
      Koordinaten und den Zoom. *(Es gibt eine Narbe dazu: ein `NaN`-Pan hat den
      Routing-Pfad schon einmal zum Absturz gebracht.)*

- [ ] **Schritt 3: Lesen und säen.** In `js/app/bootstrap.js` **vor** `:13` den Satz lesen
      und als `setView`-Argumente verwenden. Streng validieren, bei jedem Zweifel auf
      `[478.0, 539.0], 2` zurückfallen:
      - beide Koordinaten endlich und innerhalb `0…1024` (Bildgrenzen, `L.CRS.Simple`),
      - Zoom endlich und innerhalb `0…7` (die Karte geht bis 7, siehe den Kommentar bei
        `js/map-features/map-features-labels.js:496–499`),
      - kaputtes JSON → Vorgabewert, kein Fehler in der Konsole.

- [ ] **Schritt 4: Kein Zustand ohne Ausweg.** Ein gespeicherter Ausschnitt darf einen
      Editor nicht einsperren. `?edit=1` **ohne** gespeicherten Satz und ein leerer
      Speicher müssen zum Vorgabewert führen. Sinnvoll: dieselbe Stelle setzt zurück, an
      der auch die Filter zurückgesetzt werden — falls es keine gibt, ist der Ausweg
      `localStorage.removeItem`, und das gehört in den Commit-Text.

- [ ] **Schritt 5: 🔧 DU (Owner): Abnahme im Browser.**
      1. `/edit/`, irgendwohin schwenken und auf Zoom 4 gehen, **Strg+Shift+F5** →
         derselbe Ausschnitt, dieselbe Zoomstufe, **ohne sichtbaren Sprung**.
      2. Nochmal mit normalem F5 → gleich.
      3. `avesmaps.de/?strasse=Reichsstraße%201` **ohne** `?edit=1` → unverändert wie
         heute (kein Edit-Modus, kein Speicher, kein Einfluss).
      4. Im Edit-Modus einen `?s=`-Kurzlink öffnen → die **Route** gewinnt, nicht der
         gespeicherte Ausschnitt.
      5. Einen `?s=`-Link **erzeugen** und seinen Inhalt ansehen → **kein** `lat`/`lng`/
         `zoom` darin (die Falle aus Schritt 1).

- [ ] **Schritt 6: Commit** — `feat(edit): the map view and zoom survive a reload in edit mode`

---

## 💣 Fallen

1. **Die Adresszeile wird nicht angefasst.** `syncPlannerStateToUrl` sagt es in seinem
   eigenen Kommentar (`js/map-features/map-features-layer-state.js:318–324`): die Funktion
   *„no longer touches window.history/location at all"*. Teilen läuft ausschließlich über
   die ausdrücklichen Kanäle. **Der Ausschnitt gehört nicht in die URL** — auch nicht „nur
   kurz zum Testen".
2. **`buildPlannerSearchParams()` ist doppelt belegt** — Speicher *und* Kurzlink. Siehe
   Schritt 1.
3. **`map` entsteht zuletzt.** Wer den Schreib-Listener in eine Datei hängt, die vor
   `bootstrap.js` lädt, greift ins Leere. Entweder in `bootstrap.js` nach `:13`, oder in
   einer neuen Datei **nach** `index.html:1796`.
4. **Neuer Top-Level-Name = `grep` vor dem Commit.** 164 klassische `<script>`-Tags teilen
   einen globalen Scope; ein doppelter `const` killt eine Datei still, und Node-Tests
   sehen das prinzipiell nie (Präzedenzfall `cb082ab5`).
5. **Geteilter Arbeitsbaum.** `index.html` trägt gerade fremde unkommittierte Arbeit.
   Nie `git add -A`; nur eigene Pfade einzeln stagen. Falls eine neue JS-Datei nötig wird,
   ist der `<script>`-Eintrag in `index.html` die einzige Berührung — **mit Anker
   arbeiten, nicht mit Zeilennummer.**
6. **Kein `?v=` von Hand.** Der Deploy stempelt alles von `index.html` Erreichbare selbst.

---

## Was NICHT dazugehört

- **Kein Frontend.** Ausdrücklich nur Edit-Modus (`IS_EDIT_MODE`). Für anonyme Besucher
  ändert sich **nichts** — das ist Teil der Abnahme (Schritt 5.3).
- **Nicht das Fliegen.** Am selben 2026-07-10 ersetzte `d1e7c79c` auf mehreren Wegen
  `flyTo` durch harte `setView`-Sprünge, im Code als **„Owner-Regel"** vermerkt
  (`js/map-features/map-features-location-lookup.js:291`,
  `js/map-features/map-features-infopanel.js:358`). Das ist der zweite Grund, warum sich
  der Editor seit jenem Tag anders anfühlt — aber es ist eine **eigene Entscheidung mit
  eigener Sitzung**, und niemand hat aufgeschrieben, was sie ursprünglich reparieren sollte.
- **Nicht die Landschaften.** `?landschaften=1` gehört später in dieselbe `ignoredParams`-
  Liste; das Flag existiert noch nicht.
