# Zoomübergänge — Übergabe an die nächste Sitzung

> Stand 26.08.2026, abends. Vorgänger: `docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md`
> (Entwurf) und `docs/superpowers/plans/2026-08-26-zoom-uebergang-konsistenz.md` (Bauplan).
> **Vorwissen zwingend:** `docs/kartenflaechen-und-zoomblenden.md` §5a, §5.2 und §8a — dort stehen
> die drei Fallen, die diese Sitzung je einmal bezahlt hat.

## §1 Der eine offene Befund

🔴 **Owner, zuletzt: „straßen und flüsse sind wieder kaputt — die gingen doch gerade."**

Davor, zum selben Bauteil: *„flussnamen sind jetzt scheisse (zuerst stabil, dann plötzlich sprung
auf neues) — das war bei `?zoomlupe=20` richtig."*

💣 **Beide Befunde traten im NORMALTEMPO auf und in der ZEITLUPE nicht.** Das ist die Signatur eines
**Wettlaufs mit Leaflets Aufräumen**: am Ende der Zoomdauer feuert `_onZoomTransitionEnd`, daran
hängen die `moveend`/`zoomend`-Handler der Overlays, und die löschen Transitions und setzen die
Flächen neu. Was dann noch läuft, wird abgeschnitten und springt in einem Bild. `?zoomlupe` dehnt
das Aufräumen mit — deshalb ist dort alles heil.

⚠️ **Der Versuch, das mit einer Reserve zu lösen, hat nicht gereicht.** `54e705e7` gibt den
Deckkraft-Blenden nur noch 75 % der Zoomdauer (62 ms Reserve bei Vorgabe). Der Befund kam danach
wieder. **Die 75 % sind eine Vermutung über den verspäteten Start, keine Messung — der Startverzug
ist nie gemessen worden.** Das ist die erste Aufgabe.

## §1a Stand der Folgesitzung (26.08., nachts): der Mechanismus ist GEFUNDEN und behoben — die Messung steht noch aus

🔴 **Der Befund hatte zwei Ursachen, nicht eine — und die größere war kein Wettlauf, sondern eine
Doppelanmeldung.** `zeichneJetzt()` rief bei JEDEM Zeichnen `pfadLabelBlendeEin()` — auch beim
Vorabzeichnen im `zoomanim` (der Aufruf stammt vom 24.08., Schritt 4 kam am 26.08. dazu; niemand
hat die beiden je zusammen angesehen). Deren Doppel-rAF feuerte ~2 Bilder nach dem Zoomstart und
überschrieb die eben gesetzten Übergänge:

1. `vorne.style.transition = "opacity …"` **ohne** `transform` — eine laufende Transition, deren
   Eigenschaft aus der Liste fällt, wird vom Browser ABGEBROCHEN (CSS Transitions §3, gilt auch
   ohne neuen Wert). Die neue Schrift sprang auf ihre Endlage und klebte am **Bildschirm**, während
   die Karte darunter weiterzoomte — „straßen und flüsse sind wieder kaputt". Die ganze
   Gegenrechnung (`avesmapsZoomVorabFlaeche`) war damit zur Laufzeit wirkungslos: getestet,
   gesetzt, zwei Bilder später weggeworfen.
2. `hinten` wurde hart auf 0 gesetzt — das gestaffelte Ausblenden der alten Schrift (84 ms) war
   nach ~2 Bildern gekappt.

⚠️ **Nur die Wegenamen.** Die Grenznamen zeichnen im `zoomanim` direkt
(`drawTerritoryBorderLabels`) und rufen ihre Blende dabei nie — deshalb war dort nichts gemeldet.
💣 Der Quelltext-Test daneben war gegen seine Mutationen dicht und konnte das nie sehen; gefunden
hat es Code-Lesen, belegt der neue Prüfstand
`js/map-features/__tests__/wegenamen-parallelblende-ablauf.test.js` (baut die Leaflet-Reihenfolge
nach, arbeitet die rAF-Warteschlange als Bilder ab; war vor dem Fix rot mit exakt dem
Owner-Symptom). **Fix:** das Vorabzeichnen meldet die Blende nicht mehr an
(`if (!fuerZiel) { pfadLabelBlendeEin(); }`) — wirkt nur unter `?parallelfade=1`, die Vorgabe
bleibt unverändert AUS.

🔧 **Was der Fix NICHT beantwortet: die Lupe-Asymmetrie von Befund 1.** Der Abbruch aus der
Doppelanmeldung ist zeitskalen-invariant — er sähe mit und ohne `?zoomlupe` gleich aus. Dass der
Owner den Unterschied sah, spricht weiterhin für einen ZUSÄTZLICHEN festen Zeitanteil: den
**Startverzug** der Blende (Hauptthread beim Zoomstart), gegen den die 63 ms Reserve aus
`54e705e7` geraten sind. **Der ist weiterhin ungemessen** — der Messversuch dieser Sitzung ist an
der Browser-Pane gescheitert (kompositiert nicht, rAF feuert nie, „pane is currently hidden";
dieselbe Falle wie §9 der Flächen-Doku). Der fertige Einzeiler für den Owner steht unten.

⚠️ **Offen ist auch die Frage, was Leaflets Aufräumen wirklich abschneidet:** `transition = ""`
stellt die CSS-Regel wieder her, und ohne Regel gilt `all 0s` — `all` MATCHT weiter, eine laufende
Deckkraft-Blende bräche dadurch möglicherweise gar nicht ab. Was nachweislich abbricht, ist die
Transform (der `setPosition` im redraw ändert ihren Wert). Genau das entscheidet das Protokoll:
eine `cancel`-Zeile für `opacity` um t≈250 = Wettlauf real; nur `end`-Zeilen = die Reserve trägt.

**Der Messblock für den Owner** (Konsole auf `https://avesmaps.de/?parallelfade=1`, dann EIN
Zoomschritt; Startverzug = ms der ersten `run`-Zeile, Wettlauf = `cancel`-Zeile für `opacity`):

```js
(() => {
  const pane = map.getPane("avesmapsPathLabelCanvasPane");
  if (!pane) { console.warn("[mess] Wegenamen-Pane fehlt"); return; }
  const ks = Array.from(pane.children).filter(c => c.tagName === "CANVAS");
  const nam = c => "W" + (ks.indexOf(c) + 1);
  const dauer = (typeof AVESMAPS_ZOOM_DAUER_MS !== "undefined") ? AVESMAPS_ZOOM_DAUER_MS : 250;
  let t0 = 0, zeilen = [], bilder = [], scharf = false;
  let n = 0; const ps = performance.now();
  (function probe() { n++; if (performance.now() - ps < 300) { requestAnimationFrame(probe); } else {
    console.info("[mess] " + n + " Bilder/300ms, Tab: " + document.visibilityState
      + (n < 2 ? " — HINTERGRUNDTAB, Messung ungueltig!" : " — ok. Jetzt EINEN Zoomschritt (Mausrad).")); } })();
  const ev = e => zeilen.push({ ms: +(performance.now() - t0).toFixed(1),
    ereignis: e.type.replace("transition", ""), eigenschaft: e.propertyName,
    flaeche: nam(e.target), deckkraft: getComputedStyle(e.target).opacity });
  ks.forEach(c => ["transitionrun", "transitionstart", "transitionend", "transitioncancel"]
    .forEach(t => c.addEventListener(t, ev)));
  function bild() { if (!scharf) return; const ms = Math.round(performance.now() - t0); const z = { ms };
    ks.forEach(c => { const s = getComputedStyle(c); let sk = 1;
      try { sk = new DOMMatrixReadOnly(s.transform === "none" ? "" : s.transform).a; } catch (e) {}
      z[nam(c)] = s.opacity + " @" + sk.toFixed(2) + "x"; });
    bilder.push(z);
    if (ms < dauer + 500) { requestAnimationFrame(bild); } else { scharf = false;
      console.info("[mess] Ereignisse (ms ab dem Setzen im zoomanim):"); console.table(zeilen);
      console.info("[mess] Bildprotokoll (Deckkraft @Skalierung je Flaeche):"); console.table(bilder); } }
  map.on("zoomanim", e => { t0 = performance.now();
    zeilen = [{ ms: 0, ereignis: "zoomanim (Setzen)", eigenschaft: "-> z" + e.zoom,
      flaeche: ks.map(c => nam(c) + ": " + (c.style.transition || "leer")).join(" | "), deckkraft: "" }];
    bilder = []; scharf = true; requestAnimationFrame(bild); });
  map.on("zoomend", () => zeilen.push({ ms: +(performance.now() - t0).toFixed(1),
    ereignis: "zoomend (Leaflets Aufraeumen)", eigenschaft: "", flaeche: "", deckkraft: "" }));
  console.info("[mess] Zuhoerer stehen.");
})();
```

## §2 Was JETZT live ist

Der riskante Teil ist seit `c468ef1c` **in der Vorgabe abgeschaltet**:

| | Stand |
|---|---|
| Eine Kurve, eine Dauer für alle Zoomanimationen (`ease-in-out`, 250 ms) | ✅ live |
| Ortsmarker landen ohne Sprung (Größe je Klasse gegengerechnet) | ✅ live |
| **Ausblenden** aller vier Beschriftungsebenen ab `zoomanim` t = 0 | ✅ live, vom Owner gelobt |
| Der DOM-Klon klebt an der KARTE statt am Bildschirm | ✅ live, vom Owner bestätigt |
| Doppelte Schrift (drei verschiedene Ursachen) | ✅ behoben |
| Zeitlupe `?zoomlupe=<1..60>` | ✅ live |
| **Einblenden** der neuen Schrift während des Zooms (Schritt 3+4) | 🔴 **Vorgabe AUS**, `?parallelfade=1` |

⭐ **Der Code für Schritt 3+4 steht vollständig und getestet da** — er ist nur nicht der Vorgabeweg.
`?parallelfade=1` schaltet ihn in beiden Overlays ein.

## §3 Die drei Fallen, die diese Sitzung bezahlt hat

Sie gehören zusammen: **was man über den Zeitpunkt einer Animation zu wissen glaubt, ist meist eine
Annahme.** Alle drei stehen ausführlich in `docs/kartenflaechen-und-zoomblenden.md`.

1. **§8a — Leaflet steht während der Animation schon auf der Zielstufe.** `_animateZoom` feuert
   `zoomanim` und setzt unmittelbar danach `map._zoom` und `_pixelOrigin` aufs Ziel. Alles, was ein
   Bild später projiziert, transformiert **doppelt**. Kostete den Rückbau `b1bd8df7` („ortsmarkierungen
   springen wild umher", „ortschaften, die es zwischen den levels nicht geben dürfte").
2. **§5a — „Blende gesetzt" heißt nicht „Blende läuft ab jetzt".** Sie beginnt beim nächsten
   Stilabgleich, und der Hauptthread ist beim Zoomstart mit dem Zeichnen aller Ebenen belegt.
3. **§5a — `style.transition = ""` ist keine Abschaltung**, sondern eine Rückgabe der Kontrolle an
   die CSS-Regel. Fiel fünf Monate nicht auf, weil die Regel `100ms` sagte; die Vereinheitlichung
   auf die gemeinsame Dauer machte daraus die volle Zoomdauer — und damit doppelte Beschriftungen.
   ⭐ Was sofort weg muss, wird hart gesetzt:
   `el.style.transition = "none"; el.style.opacity = "0"; void el.offsetWidth; el.style.transition = "";`

## §4 Zwei Werkzeuge, die es jetzt gibt

- **`?zoomlupe=<faktor>`** dehnt den ganzen Zoomschritt (Faktor 1–60). ⚠️ **Erwartete Nebenwirkung:**
  die Kacheln laden erst am Ende der gedehnten Zeit nach, deshalb steht rund um die alte Ansicht ein
  grauer Rahmen. `_onZoomTransitionEnd` stößt beides an. Owner: bei kleinen Faktoren tolerierbar.
- **`avesmapsZoomVorabFlaeche` / `avesmapsZoomZielProjektion`** in `js/map-features/zoom-uebergang.js`
  — die Gegenrechnung für eine Fläche, die schon für die Zielstufe gezeichnet wurde. **Einmal
  vorhanden, an einem Leaflet-Ersatz nachgerechnet** (`__tests__/zoom-vorab-flaeche.test.js`),
  gegen fünf Mutationen geprüft. Sie war der Grund für den Rückbau des Vorgängerversuchs `ed1e2e93`,
  weil sie dort von Hand geschrieben und nie gesehen worden war. **Nicht neu bauen.**

## §5 Was zu tun ist — in dieser Reihenfolge

1. 🔧 **Den Startverzug MESSEN, statt ihn zu schätzen.** `transitionrun`/`transitionstart` auf der
   einblendenden Fläche protokollieren und gegen `performance.now()` beim Setzen halten. Erst dann
   weiß man, wieviel Reserve die Blende wirklich braucht — oder ob die Reserve der falsche Hebel ist.
   ⚠️ Nur in einer **zeichnenden** Ansicht messbar (§9 der Flächen-Doku).
2. 🔧 **Prüfen, ob der Wettlauf überhaupt der richtige Verdacht ist.** Der Owner hat zweimal einen
   Befund im Normaltempo gemeldet, der in der Zeitlupe fehlt — das ist stark, aber nicht bewiesen.
   Ein Protokoll über einen echten Zoomschritt (Deckkraft + Transform beider Flächen über die Zeit)
   entscheidet es. Der Owner hat so ein Protokoll heute schon einmal geliefert und damit eine
   Fehldiagnose gekippt; er macht das mit.
3. Erst danach `?parallelfade=1` wieder zur Vorgabe machen — und **einzeln** live, mit seinem Blick.

## §6 Was sonst noch offen liegt

- 🔧 **Die Ortsmarker skalieren langsamer als die Karte** (Metropole ×1,41 gegen Karte ×2). Das ist
  die Zoombänder-Tafel, kein Fehler; **19 von 42 Stufen sind sogar völlig flach**. Owner-Entscheid
  vom 26.08. war: Tafel nicht anfassen, während der Animation gegenrechnen. Er hat danach gesagt,
  es sehe „nicht wirklich mitskaliert" aus, besonders beim Rauszoomen. **Ein dritter Weg liegt
  vorgeschlagen und unbeantwortet:** die Marker folgen am Anfang der Bewegung der Karte und
  schwenken zum Ende auf ihre echte Größe ein — sähen mitskaliert aus *und* landen ohne Sprung,
  Preis ist ein sanftes Anwachsen-und-Zurück bei flachen Bändern.
- 🔧 **Die Landesgrenzen springen** — und das ist **Geometrie, keine Schrift**: nach der Owner-Regel
  vom 24.08. blenden sie absichtlich nicht. Was springt, ist die **Strichbreite**
  (`BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM = { 4: 3, 5: 4, 6: 6 }`, also ×1,33 und ×1,50 gegen die Karte
  mit ×2 → −33 %). Drei Wege liegen vorgeschlagen und unbeantwortet: blenden lassen (kehrt seine
  Regel um) · gegenrechnen (der Grenzen-Canvas kostet 52–99 ms je Neuzeichnen, unbezahlbar) ·
  **die Breiten verdoppeln lassen**, z. B. 2/4/8 statt 3/4/6 — dann kein Sprung, ohne Blende und
  ohne Neuzeichnen, Preis ist eine Bildentscheidung.
- 🔧 **Beschriftungen fehlen im SVG-/Karten-Abzug** (Owner: „der screenshot funktioniert nicht mit
  labels"), dazu eine `willReadFrequently`-Warnung aus `js/ui/karten-abzug.js:221`. Nie angesehen.
- 🔧 **215–836 ms Hauptthread-Blockade am `zoomend`** — der größte Einzelposten im ganzen
  Zoomschritt, im Entwurf §8 als offen vermerkt und weiterhin unerklärt.

## §7 Arbeitsweise, die sich in dieser Sitzung bewährt hat

- ⭐ **Der Owner misst mit, wenn man ihm einen fertigen Einzeiler gibt.** Zwei seiner Messungen haben
  je eine Fehldiagnose von mir gekippt — schneller, als ich hätte raten können.
- 💣 **Ein Test, der nur Quelltext liest, kann gegen ein Dutzend Mutationen dicht sein und den
  echten Fehler nie sehen.** Er prüft, DASS gerufen wird, nicht WAS die Funktion vorfindet.
  ⭐ Vorlage für einen echten Prüfstand: `js/map-features/__tests__/marker-zoom-koordinaten.test.js`
  — er baut eine Karte, die sich verhält wie Leaflet (erst `zoomanim` feuern, DANN den Zustand
  umstellen) und meldete die kaputte Fassung mit „gezeichnet bei (1600, 960) statt (800, 480)".
- 💣 **Malkosten sind in einem Hintergrundtab unsichtbar.** Eine Messung dort ergab „0,2 ms je
  redraw" und war wertlos; im zeichnenden Browser lautete die Wahrheit „kostet gar nichts".
  Dort feuert auch `zoomanim` überhaupt nicht.
- ⚠️ **Erst den Deploy abwarten und die AUSGELIEFERTE Datei prüfen, dann den Owner hinschauen
  lassen.** Zweimal in dieser Sitzung hat er einen alten Stand beurteilt, weil ich zu früh gemeldet
  habe — beide Male ging eine Runde verloren.
- ⚠️ **Der Arbeitsbaum ist geteilt.** Mehrere Sitzungen schreiben in denselben Checkout; heute zog
  ein Staging-Rennen fremde Änderungen in einen fremden Commit. Vor jedem Commit `git status`, nur
  eigene Pfade stagen, bei fremder ungespeicherter Arbeit **nicht** rebasen.
