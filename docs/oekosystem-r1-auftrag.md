# Ökosystem R1 — Arbeitsauftrag für eine frische Sitzung

> **R1 ist die kleinste sinnvolle Stufe: die Ebene existiert, sonst nichts.**
> Umschalten in den Modus „Ökosystem" zeigt die Karte mit einer leeren
> Ökosystem-Ebene. Keine Tabellen, kein Zeichnen, keine Daten, kein Routing.
>
> Der Zuschnitt ist Absicht — der Moduseintrag muss an fünf Stellen übereinstimmen
> und fällt bei einer Lücke **stumm** zurück. Das will man isoliert gesehen haben,
> bevor Daten im Spiel sind.

## Der Prompt

Alles zwischen den Linien in eine neue Sitzung kopieren.

---

```
Baue Stufe R1 des Ökosystem-Features in Avesmaps.

LIES ZUERST, in dieser Reihenfolge:
  docs/oekosystem-editor-leitfaden.md   (§1 Modell, §3 Modus, §9 Fallen, §10 R1)
  docs/oekosystem-feature-design.md     (Gesamtbild, nur überfliegen)
Der dritte Doc (oekosystem-instruction.md) beschreibt das ROUTING und ist für R1
ausdrücklich NICHT relevant.

ZIEL VON R1, vollständig:
Ein neuer Kartenmodus "Ökosystem" im Edit-Mode. Wer umschaltet, sieht die Karte
wie gewohnt — Kacheln, Wege, Orte — plus eine leere Ökosystem-Ebene. Der Modus
lässt sich hin und zurück schalten, ohne dass etwas kaputtgeht.

AUSDRÜCKLICH NICHT TEIL VON R1:
  - keine Tabellen, kein Endpoint, kein Repository
  - kein Zeichnen, keine Geometrie, keine Daten
  - kein Routing, keine Höhen, keine Faktoren
  - keine öffentliche Sichtbarkeit (Edit-Mode only)
Wer davon etwas anfängt, ist über das Ziel hinaus.

WAS ZU TUN IST:
1. Moduseintrag an FÜNF Stellen, die übereinstimmen müssen. Fehlt eine, fällt der
   Modus stumm auf "deregraphic" zurück — kein Fehler, keine Meldung:
     index.html:1253                                  <option>
     js/map-features/map-features-display-mode.js:155 Whitelist der erlaubten Modi
     js/config.js:507                                 Icon
     js/config.js:481                                 Standardmodus (NICHT ändern)
     js/app/i18n-en.js:80                             Übersetzung
   Das Auswahlfeld baut sich aus den <option>-Elementen selbst
   (js/ui/ui-controls.js:449) — es ist KEIN Menü-Code zu schreiben.
2. Der Eintrag hängt an IS_EDIT_MODE (js/config.js:197). Normale Nutzer sehen ihn
   nicht.
3. Eine EIGENE Leaflet-Pane, z-index zwischen 201 und 299 (regionsPane liegt bei
   200, Anlage in js/app/bootstrap.js:16/29). Nicht 350 nehmen, dort liegen schon
   zwei.
4. Ein leerer Loader/Sichtbarkeits-Umschalter für diese Pane, der auf den
   Moduswechsel reagiert.

DREI FALLEN, die zuverlässig zuschlagen:
  - regionPolygons NICHT mitbenutzen. clearRenderedRegionLayers leert das Array
    bei jedem politischen Reload, und der läuft bei jedem moveend — eine fremde
    Ebene stirbt bei jedem Kartenschwenk. Eigene Registry anlegen.
  - syncRegionVisibility ist ZWEIMAL definiert (map-features-political-region-
    visibility.js:1 und map-features-political-territory-loader.js:473; der Loader
    gewinnt). Nicht erweitern, eigene Funktion schreiben.
  - Wenn ein Editor-Panel dazukommt: ASSET_VERSION in
    js/territory/territory-editor-inline-host.js:23 bumpen. Für R1 vermutlich
    nicht nötig.

FERTIG, WENN:
  - Umschalten auf "Ökosystem" zeigt die Karte vollständig (Kacheln, Wege, Orte)
  - die eigene Pane existiert und ist leer
  - hin- und zurückschalten lässt die politische Ebene unbeschädigt
  - normale Nutzer (ohne ?edit=1) sehen den Eintrag nicht
  - VERIFIZIERT durch tatsächliches Umschalten im Browser, nicht durch Codelesen

RANDBEDINGUNGEN:
  - Windows + PowerShell; Bash-Werkzeug für git vorhanden
  - Geteilter Arbeitsbaum: NIE git add -A. Nur eigene Pfade einzeln stagen.
  - Kleine Commits direkt auf master, Push löst ~1-2 min Auto-Deploy aus
  - Deutsche UI-Strings bleiben deutsch; Code, Kommentare und Commits englisch
```

---

## Warum genau dieser Zuschnitt

**R1 hat keinen Datenanteil.** Damit ist der einzige Fehlermodus die
Modus-Verdrahtung, und die ist heimtückisch: fünf Stellen, stummer Rückfall, keine
Fehlermeldung. Wer das zusammen mit Tabellen und Zeichenwerkzeug baut, sucht den
Fehler später im Datenmodell.

**R1 ist in einer Sitzung schaffbar.** Das ist der eigentliche Grund für den
Schnitt — die Stufe passt in einen frischen Kontext, ohne den ganzen Entwurfstag
mitzuschleppen.

## Danach

| | |
|---|---|
| **R2** | Tabellen, Endpoint, Repository, Deskriptor, die acht Nahtstellen, Zeichnen — der große Brocken |
| **R3** | Owner zeichnet einen Wald. Kein Code, Abnahme. |
| **R4** | Wiki-Zuweisung per Drag'n'drop, Rechtsklick öffnet den Regioneneditor |
| **R5** | Regioneneditor gestalten |

Details in `oekosystem-editor-leitfaden.md` §10.

## Eine Entscheidung, die vor R2 fällt

`activeRegionGeometryEdit` (`js/app/runtime-state.js:166`) ist der Singleton, den
der gesamte Vertex-Editor liest: **ein Singleton mit `entity`-Feld oder zwei
Instanzen?** Empfehlung im Leitfaden §11. Für R1 irrelevant, für R2 die
folgenreichste Weiche.
