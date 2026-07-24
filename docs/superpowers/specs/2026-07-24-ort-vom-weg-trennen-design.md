# Ort vom Weg trennen — Strg beim Ziehen (Discord-Idee #43)

**Stand:** 2026-07-24 · **Melder:** Drachenschuppe (Discord) · **Status:** entworfen, freigegeben

## 1. Der Befund

Im Editiermodus schiebt ein Zug am Ortsmarker **immer** alle angeschlossenen Wegenden mit.
`saveMovedLocationMarker` ruft `moveConnectedPathEndpointsForLocation` bedingungslos auf
(`js/map-features/map-features-location-editing.js`), und das trifft jeden Weg, dessen erste oder
letzte Koordinate im Toleranzradius `THRESHOLD` (0,5 Karteneinheiten) der **alten** Position liegt.

Folge laut Meldung: bei einem weiten Sprung zieht sich ein Weg quer über die Karte, oder sein Ende
landet am Ziel auf etwas, mit dem es gar nichts zu tun hat.

Bei den politischen Grenzen gibt es das Gegenmittel längst: `Strg` beim Ziehen eines Eckpunktes
löst ihn aus der geteilten Grenze (`map-features-region-vertex-detach-edit.js`). Diese Idee
überträgt das auf Orte und Kreuzungen.

## 2. Zweck (Owner)

Redakteure sollen einen Ort **kurzfristig** vom Weg trennen können, *während* sie editieren. Der
getrennte Zustand ist ausdrücklich ein **Arbeitszustand auf Zeit**, kein Endzustand — am Ende darf
keine Lücke stehenbleiben.

Daraus folgt die eine Entwurfsregel, die alles andere bestimmt:
**die Trennung muss sichtbar sein, nicht still.**

## 3. Verhalten

### 3.1 Der Zug

- **Ohne Strg:** unverändert. Ort und angeschlossene Wegenden wandern gemeinsam.
- **Mit Strg** (Mac: Cmd): der Ort wandert, **die Wege bleiben genau liegen**.
- **Klebrig:** es genügt, Strg *irgendwann während* des Ziehens gedrückt zu haben — beim Beginn
  oder mittendrin. Das ist die Mechanik, die der Regionen-Editor schon benutzt
  (`_regionDetachDrag`), und sie verzeiht ein zu frühes Loslassen der Taste.
- Kraftlinien sind nicht betroffen: `pathData` filtert `feature_type === "powerline"` heraus, der
  Verschiebe-Code hat sie nie gesehen.

### 3.2 Sichtbarkeit — drei Stufen

1. **Vor dem Loslassen.** Solange Strg gedrückt ist, trägt der gerade bearbeitete Marker einen
   goldenen Trenn-Ring (`--color-accent`). Man sieht, *dass* getrennt wird, bevor es passiert.
2. **Nach dem Loslassen.** An jedem liegengebliebenen Wegende steht ein **Offen-Ring** (bernstein,
   mit Lücke) mit Tooltip „Offenes Wegende — &lt;Wegname&gt;". Ein Klick darauf öffnet die
   Geometrie-Bearbeitung genau dieses Weges; das Ende auf den Ort ziehen lässt es einrasten
   (`finishPathNodeDrag` erzwingt das Einrasten auf Orte oder Kreuzungen ohnehin).
   Dazu eine Meldung im Warnton: „&lt;Ort&gt; verschoben — 2 Wegenden blieben liegen (Strg)."
3. **Als Erinnerung.** Solange etwas offen ist, steht unten auf der Karte ein Zähler
   („2 offene Wegenden") mit einem Sprung zum nächsten. Bei 0 verschwindet er.

### 3.3 Der Zustand ist berechnet, nicht gespeichert

Gespeichert wird nur die **Beobachtungsliste**: welche Wegenden *diese* Redakteurin getrennt hat
(`localStorage`, Schlüssel `avesmaps.openPathEnds.v1`, je Eintrag `{publicId, end}`).

Ob ein beobachtetes Ende **noch offen ist**, wird jedes Mal frisch aus `pathData`/`locationData`
berechnet: liegt an der aktuellen End-Koordinate ein Ort oder eine Kreuzung im Radius `THRESHOLD`,
gilt es als wieder angeschlossen und fällt aus der Liste. Nichts wird je „als erledigt" markiert.

Damit gilt dasselbe Prinzip wie im Konfliktzentrum (`docs/konfliktmanagement-design.md`): ein
repariertes Ende verschwindet von selbst, und keine gespeicherte Wahrheit kann veralten.

Die Liste liegt im `localStorage`, damit ein F5 die Lücke nicht unsichtbar macht — sie ist der
Arbeitszustand *einer* Person, nicht ein Zustand der Karte, deshalb bewusst kein Serverfeld.

**Fallstrick, bewusst behandelt:** solange `pathData` noch leer ist (früh nach dem Laden), wird die
Liste **nicht** ausgewertet. Sonst sähe jedes beobachtete Ende „unauffindbar" aus und die Liste
würde sich beim Start selbst leeren.

## 4. Architektur

| Datei | Rolle |
|---|---|
| `js/map-features/map-features-location-detach-edit.js` (neu) | Strg-Erkennung, Trenn-Absicht je Zug, Beobachtungsliste, Offen-Ring-Ebene, Zähler-Chip |
| `js/map-features/map-features-location-editing.js` | fragt die Absicht ab, überspringt das Mitziehen, meldet die liegengebliebenen Enden |
| `js/routing/route-render.js` | `refreshPlannerAfterFeatureChange` stößt die Neuberechnung an — der zentrale Punkt nach *jeder* Feature-Änderung |
| `css/features/location-popups-markers.css` | Trenn-Ring, Offen-Ring, Chip |
| `index.html` | Skript-Tag + Chip-Markup |

Schnittstelle (globale Funktionen, wie im Rest der Anwendung; alle Aufrufe `typeof`-geschützt, damit
das Editieren auch ohne das Modul funktioniert):

- `avesmapsArmLocationDetachTracking(markerEntry)` / `avesmapsDisarmLocationDetachTracking()`
- `avesmapsConsumeLocationDetachIntent()` → `boolean`, einmalig je Zug
- `avesmapsRegisterDetachedPathEnds(previousCoordinates)` → Anzahl liegengebliebener Enden
- `avesmapsRefreshOpenPathEnds()`

## 5. Nicht-Ziele

- **Kein serverseitiger Zustand.** Kein Feld, keine Tabelle, kein Endpunkt.
- **Keine Prüfung der Altlasten.** In den Livedaten hängen heute schon **35 Wegenden** an keinem Ort
  (Stand 2026-07-24, ohne Kraftlinien; überwiegend Flusswege und Pfade). Der Zähler zeigt sie
  *nicht* — er ist der Arbeitszustand der Redakteurin, kein Datenqualitäts-Audit. Das Altlasten-Thema
  gehört ins Konfliktzentrum und ist eine eigene Sitzung.
- **Kein Auto-Reparieren.** Das Wiederanschließen bleibt ein bewusster Zug der Redakteurin.
