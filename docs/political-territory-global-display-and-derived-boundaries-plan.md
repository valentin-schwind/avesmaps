# Plan: Globale Herrschaftsgebiet-Eigenschaften und Außengrenzensystematik

Stand: 2026-05-29

Dieses Dokument beschreibt den Zielzustand, die Historie, die Risiken und den Umsetzungsplan fuer den Umbau der Herrschaftsgebiet-Eigenschaften und der abgeleiteten Außengrenzen in Avesmaps.

Der Plan ist bewusst nicht als sofortige Loesch- oder Migrationsaktion formuliert. Bestehende echte Karten-Geometrien, bestehende Territorien und bestehende Territorien-Hierarchien duerfen nicht zerstoert oder umgeschrieben werden. Der Umbau soll die bisherige Mehrdeutigkeit zwischen angeklickter Geometrie, lokalem Override, Breadcrumb-Knoten und abgeleiteter Außengrenze aufloesen.

## 1. Ausgangslage

Avesmaps verwaltet politische Herrschaftsgebiete auf einer Fantasy-Karte. Nutzer koennen eine Kartenflaeche anklicken, dadurch einen Eigenschaften-Editor oeffnen und dort eine Breadcrumb-Kette bearbeiten, zum Beispiel:

```text
Bergkoenigreich Lorgolosch
- Bergfreischaft Kibrom
- Bergfreischaft Olrong
- Bergfreischaft Ilderasch
```

Spaeter kann die Hierarchie tiefer sein:

```text
Bergkoenigreich Lorgolosch
- Bergfreischaft Kibrom
  - Bergfreischaft Kibrom-Asch
  - Bergfreischaft Kibrom-Bosch
  - Bergfreischaft Kibrom-Cosch
- Bergfreischaft Olrong
- Bergfreischaft Ilderasch
```

Der Editor hatte bislang mehrere Ebenen, die sich teilweise ueberlappen:

- echte Karten-Geometrien, also konkrete Polygone auf der Karte
- Territorien als fachliche Herrschaftsgebiet-Knoten
- Breadcrumb-Darstellungen im Editor
- lokale/geometriebezogene Overrides
- globale Territoriumswerte
- abgeleitete Außengrenzen

Diese Ebenen fuehren zu Mehrdeutigkeiten. Das beobachtete Symptom war: Eine Außengrenze fuer `Bergkoenigreich Lorgolosch` konnte nach dem Speichern je nach Klick-Kontext bei `Olrong`, aber nicht bei `Kibrom` oder `Ilderasch` wieder sichtbar sein. Das deutet darauf hin, dass der Editor nicht durchgehend den aktiven Breadcrumb-Knoten als Identitaet verwendet, sondern teilweise die angeklickte Geometrie oder den niedrigsten Knoten der Kette.

## 2. Zentrale Produktentscheidung

Lokale Eigenschaften sollen entfallen. Es soll nur noch globale Eigenschaften pro Herrschaftsgebiet/Breadcrumb-Knoten geben.

Der zentrale Satz lautet:

```text
Der aktive Breadcrumb-Knoten ist die alleinige Wahrheit fuer Eigenschaften und Außengrenzen.
```

Nicht die angeklickte Geometrie, nicht eine transparente Quellflaeche, nicht eine alte `geometry_public_id`, nicht ein lokaler Override.

Ein Klick auf eine Karte dient nur als Einstieg in den Editor. Danach entscheidet der im Breadcrumb aktive Knoten, welches Herrschaftsgebiet bearbeitet wird.

Beispiel:

```text
Klick auf Olrong-Flaeche
-> Editor oeffnet Breadcrumb Lorgolosch > Olrong
-> Nutzer klickt im Breadcrumb auf Lorgolosch
-> Alle Eigenschaften und Außengrenzen betreffen Lorgolosch, nicht Olrong.
```

Diese Regel gilt immer, unabhaengig von Zoomstufe und unabhaengig davon, ob der angeklickte Layer sichtbar, transparent, original oder abgeleitet ist.

## 3. Zielmodell

Das Zielmodell trennt fachliche Territorien, echte Geometrien und abgeleitete Geometrien klar.

```text
political_territory
= fachlicher Herrschaftsgebiet-Knoten, z. B. Lorgolosch, Kibrom, Olrong

political_territory_geometry
= echte Karten-Geometrie / Quellpolygon

political_territory_display_global
= globale Darstellungseigenschaften eines Territoriums, falls als eigene Tabelle eingefuehrt wird

political_territory_derived_geometry
= globale abgeleitete Außengrenze eines Territoriums
```

Wichtig: In der bestehenden Implementierung werden viele Eigenschaften bereits direkt in `political_territory` gespeichert. Das ist nah am Zielmodell. Eine neue Display-Tabelle ist optional und nur dann sinnvoll, wenn Darstellungseigenschaften fachlich von den Stammdaten getrennt werden sollen.

Die minimal-invasive Variante waere:

- `political_territory` bleibt Wahrheit fuer globale Eigenschaften wie Farbe, Transparenz, Zoom, Wappen, Gültigkeit.
- `political_territory_geometry` bleibt Wahrheit fuer echte Polygone.
- `political_territory_derived_geometry` bleibt Wahrheit fuer abgeleitete Außengrenzen.
- `style_json.assignmentDisplays` wird nur noch als alter Snapshot/Fallback behandelt, nicht als aktive Wahrheit.
- lokale Override-UI und lokale Override-Flows werden entfernt oder deaktiviert.

## 4. Außengrenzensystematik

Die Außengrenzen haben drei UI-Schalter:

```text
Außengrenzen darstellen
Innengrenzen darstellen
Für alle Unterregionen übernehmen
```

### 4.1 Außengrenzen darstellen

Wenn aktiv, wird fuer den aktiven Breadcrumb-Knoten eine abgeleitete Außengrenze erzeugt und gespeichert.

Wenn inaktiv und gespeichert, wird die aktive abgeleitete Außengrenze dieses Territoriums deaktiviert. Es darf keine alte abgeleitete Außengrenze als Restzustand uebrig bleiben.

### 4.2 Innengrenzen darstellen

Wenn aktiv, werden innerhalb der Außengrenze die relevanten Untergrenzen angezeigt.

Bei untersten Knoten ohne Unterregionen wird diese Option automatisch deaktiviert, abgehakt und ausgegraut. Ein Blattknoten kann keine Innengrenzen haben.

Die Option darf keine echten Unter-Geometrien loeschen. Sie steuert nur die Anzeige der Innenlinien.

### 4.3 Für alle Unterregionen übernehmen

Dieser Schalter ist fachlich wichtig und darf nicht entfernt werden. Er entscheidet zwischen flacher und hierarchischer Außengrenzen-Erzeugung.

#### Modus aus: flach

Es wird genau eine Außengrenze fuer den aktiven Breadcrumb-Knoten erzeugt. Quelle sind alle darunterliegenden Blatt-/Quellgeometrien.

Beispiel:

```text
Bergkoenigreich Lorgolosch <- Außengrenze aus 1-5
- Bergfreischaft Kibrom
  - Bergfreischaft Kibrom-Asch <- 1
  - Bergfreischaft Kibrom-Bosch <- 2
  - Bergfreischaft Kibrom-Cosch <- 3
- Bergfreischaft Olrong <- 4
- Bergfreischaft Ilderasch <- 5
```

`Kibrom` bekommt in diesem Modus keine eigene abgeleitete Außengrenze.

#### Modus an: hierarchisch

Es werden Außengrenzen rekursiv fuer den aktiven Knoten und alle aggregierbaren Unterknoten erzeugt.

Jeder Knoten vereinigt seine direkte sinnvolle Kindebene.

Beispiel:

```text
Bergkoenigreich Lorgolosch <- Außengrenze aus 1-3
- Bergfreischaft Kibrom 1 <- Außengrenze aus 4-6
  - Bergfreischaft Kibrom-Asch <- 4
  - Bergfreischaft Kibrom-Bosch <- 5
  - Bergfreischaft Kibrom-Cosch <- 6
- Bergfreischaft Olrong 2
- Bergfreischaft Ilderasch 3
```

Das bedeutet: Wenn fuer `Kibrom` eine eigene abgeleitete Außengrenze erzeugt wird, verwendet `Lorgolosch` in seiner hierarchischen Aggregation `Kibrom` als direktes Aggregat, nicht mehr die drei Kibrom-Blattgeometrien einzeln.

## 5. Lokale Eigenschaften: Entscheidung und Konsequenzen

Lokale Eigenschaften werden weggelassen. Dadurch entfallen konzeptionell:

- lokale/geometriebezogene Darstellung als aktive Wahrheit
- `Zurücksetzen zu global`
- `Zu global machen`
- lokale Override-Hinweise im Editor

Diese vorhandenen Funktionen sollten nicht sofort aus der Datenbank geloescht werden. Sie sollen zuerst aus der aktiven UI entfernt oder deaktiviert werden. Backend-Code und alte Daten koennen als Sicherheitsnetz bestehen bleiben, bis der globale Pfad stabil ist.

Konsequenz:

```text
Alle Eigenschaften gehoeren zum Territorium des aktiven Breadcrumb-Knotens.
```

Wenn der Nutzer auf eine Geometrie klickt, dient diese nur zum Oeffnen der passenden Breadcrumb-Kette. Danach wird mit `territory_public_id` oder `territory_id` des aktiven Breadcrumb-Knotens gearbeitet.

## 6. Historie und technische Befunde

### 6.1 Bestehende Speicherung normaler Eigenschaften

Die aktuelle Assignment-Speicherung schreibt bei bestehenden zugewiesenen Geometrien viele Werte bereits direkt in `political_territory`, insbesondere:

- Farbe
- Transparenz
- Wappen
- Zoom von/bis
- Gültigkeit von/bis

Das ist gut fuer das globale Zielmodell.

Problematisch ist, dass gleichzeitig `assignmentDisplays` in `style_json` der konkreten Geometrie gespeichert werden. Diese Snapshots koennen von der globalen Territoriumswahrheit abweichen und muessen entmachtet werden.

### 6.2 Aktiver Breadcrumb

Der aktive Breadcrumb-Knoten ist derzeit nicht hart genug als Datenwahrheit abgesichert.

Wenn `activeDisplayNode` fehlt oder nicht sauber aktualisiert ist, faellt die Display-State-Logik auf das letzte Element des Breadcrumb-Pfads zurueck. Das ist fuer Blattbearbeitung praktisch, aber fuer die Außengrenzensystematik falsch.

Pflicht fuer den Umbau:

```text
Jeder Breadcrumb-Klick muss den aktiven Knoten explizit im Editorzustand setzen.
Alle abhängigen Module muessen danach gegen diesen aktiven Knoten neu laden.
```

### 6.3 Lokaler Override-Footer

Der Override-Footer arbeitet auf `geometry_public_id` und ist daher geometriereferenziert. Das widerspricht dem global-only-Ziel.

Er muss aus der aktiven UI entfernt oder deaktiviert werden.

### 6.4 Derived Geometry Backend

`political_territory_derived_geometry` haengt bereits an `territory_id`. Das passt zum globalen Modell.

Beim Speichern einer Derived Geometry wird die alte aktive Geometrie dieses Territoriums deaktiviert und eine neue eingefuegt. Beim Loeschen wird die aktive Derived Geometry fuer das Territorium deaktiviert.

Das ist die richtige Grundlogik.

Was fehlt:

- expliziter flat/hierarchical-Modus
- rekursive Erzeugung fuer Unterregionen
- optional: Quellenprotokoll fuer Debugging und Reproduktion

## 7. Risiken

### Risiko 1: Doppelte Wahrheit durch `style_json.assignmentDisplays`

Wenn `assignmentDisplays` weiter als aktive Datenquelle verwendet werden, bleibt das alte Problem erhalten: Je nach angeklickter Geometrie koennen andere Eigenschaften auftauchen.

Gegenmaßnahme:

- `assignmentDisplays` nur noch als Legacy-Fallback lesen.
- Neu speichern nur noch in die globale Territoriumswahrheit.
- Spaeter Diagnose/Archivierung dieser Snapshots.

### Risiko 2: Falscher Zielschluessel im Geometrie-Panel

Wenn `getTargetKey()` weiterhin aus der angeklickten Geometrie oder aus einem alten Assignment-Wert ableitet, koennen Derived-Geometrien am falschen Territorium landen.

Gegenmaßnahme:

- Aktiven Breadcrumb-Knoten als explizite Editorwahrheit einfuehren.
- Geometrie-Panel nur noch gegen diesen aktiven Knoten laden/speichern.

### Risiko 3: Lokale Override-UI bleibt aktiv

Wenn `Zurücksetzen zu global` oder `Zu global machen` sichtbar bleiben, koennen Nutzer weiterhin geometriereferenzierte lokale Zustaende erzeugen oder loeschen.

Gegenmaßnahme:

- Override-Footer ausblenden/deaktivieren.
- API zunaechst behalten, aber nicht mehr aus normaler UI aufrufen.

### Risiko 4: Hierarchischer Modus erzeugt falsche Quellen

Wenn der hierarchische Modus alle Blattgeometrien statt direkter Aggregationsknoten verwendet, ist er fachlich identisch mit dem flachen Modus.

Gegenmaßnahme:

- Eigene rekursive Source-Planung fuer Derived-Geometrien.
- Erst die untergeordneten aggregierbaren Knoten berechnen, dann den Elternknoten aus diesen direkten Kindern bilden.

### Risiko 5: Bestehende Geometrien werden unbeabsichtigt veraendert

Das darf nicht passieren.

Gegenmaßnahme:

- Echte Geometrien nie durch Derived-Operationen loeschen oder ueberschreiben.
- Nur aktive Derived-Geometrien deaktivieren/neu erzeugen.
- Vor jeder groesseren Operation Diagnose- und Zaehlschritte ausfuehren.

### Risiko 6: Datenmigration entscheidet Konflikte automatisch falsch

Alte Geometrie-Snapshots koennen unterschiedliche Farben/Zoomwerte fuer dasselbe Territorium enthalten.

Gegenmaßnahme:

- Konflikte diagnostizieren und listen.
- Nicht automatisch loeschen.
- Wenn noetig redaktionell entscheiden.

## 8. Umsetzungsphasen

### Phase 0: Keine weiteren ad-hoc Patches

Vor dem Umbau keine weiteren kleinen Workarounds an Derived Geometry oder Override-Footer, außer zur Fehlerbehebung, die den Umbau nicht erschwert.

### Phase 1: Diagnose

Erstellen eines Diagnose-Skripts oder Admin-Endpoints:

- Anzahl Territorien
- Anzahl echter Geometrien
- Anzahl aktiver Derived-Geometrien
- Territorien mit mehr als einer aktiven Derived-Geometrie
- Geometrien mit `style_json.assignmentDisplays`
- Konflikte zwischen `political_territory`-Werten und Geometrie-Snapshots
- lokale Overrides, falls vorhanden

Keine Daten veraendern.

### Phase 2: Aktiver Breadcrumb als harte Wahrheit

- Beim Breadcrumb-Klick `activeDisplayNode` bzw. eine aequivalente aktive Territory-Identitaet explizit setzen.
- `readRootSelection()` muss den aktiven Breadcrumb-Knoten stabil liefern.
- Nach Breadcrumb-Wechsel muessen alle Panels neu synchronisiert werden.

### Phase 3: Lokale Override-UI deaktivieren

- Override-Footer aus der UI entfernen oder immer verstecken.
- Buttons `Zurücksetzen zu global` und `Zu global machen` entfernen.
- Kein aktiver UI-Pfad darf `reset_local` oder Promote-Logik mehr ausloesen.

### Phase 4: Eigenschaften global lesen/schreiben

- Editor liest Eigenschaften vom aktiven Territorium.
- Editor schreibt Eigenschaften auf das aktive Territorium.
- `geometry_public_id` bleibt nur Einstiegspunkt zum Oeffnen des Editors.
- `assignmentDisplays` werden nicht mehr als aktive Wahrheit erzeugt.

### Phase 5: Geometrie-Panel auf aktiven Breadcrumb fixieren

- `getTargetKey()` im Derived-Geometry-Editor muss den aktiven Breadcrumb-Knoten verwenden.
- Speichern/Loeschen/Preview darf nicht von angeklickter Geometrie abhaengen.
- Preview und Status laden bei jedem Breadcrumb-Wechsel neu.

### Phase 6: Außengrenzen-UI wieder vollstaendig machen

Geometrie-Panel enthaelt:

- `Außengrenzen darstellen`
- `Innengrenzen darstellen`
- `Für alle Unterregionen übernehmen`

Zoomfelder im Geometrie-Panel bleiben entfernt. Zoom kommt aus Kartensichtbarkeit.

### Phase 7: Backend-Modi fuer Außengrenzen

Ergaenzen eines Modusparameters, etwa:

```text
generation_mode = flat | hierarchical
```

Oder boolesch:

```text
apply_to_descendants = true | false
```

Backend muss:

- flat: eine Derived Geometry fuer aktives Territorium erzeugen
- hierarchical: rekursiv Derived Geometries fuer aktive Territorium-Unterstruktur erzeugen

### Phase 8: Optionales Quellenprotokoll

Optional, aber empfohlen:

```text
political_territory_derived_geometry_source
```

Zur Nachvollziehbarkeit, welche Quellgeometrien oder Kind-Derived-Geometrien eine Außengrenze erzeugt haben.

### Phase 9: Tests und manuelle Pruefung

Testfaelle:

1. Lorgolosch mit Kibrom, Olrong, Ilderasch, flacher Modus.
2. Lorgolosch mit Kibrom-Unterregionen, hierarchischer Modus.
3. Klick auf Olrong, Breadcrumb Lorgolosch, Eigenschaften muessen Lorgolosch sein.
4. Klick auf Kibrom-Asch, Breadcrumb Kibrom, Eigenschaften muessen Kibrom sein.
5. Innengrenzen fuer Blattknoten deaktiviert.
6. Außengrenze abhaekeln und speichern deaktiviert nur Derived Geometry, keine echte Geometrie.
7. Lokale Override-UI erscheint nicht mehr.
8. Bestehende echte Polygone bleiben unveraendert.

### Phase 10: Legacy-Aufraeumung erst spaeter

Erst nach erfolgreicher Testphase:

- Legacy-Snapshots exportieren
- Konfliktliste pruefen
- alte lokale Override-Daten archivieren
- erst ganz am Ende loeschen, wenn ueberhaupt

## 9. Nicht-Ziele

Diese Dinge gehoeren nicht zum ersten Umbau:

- echte Geometrien neu zeichnen
- politische Hierarchie neu generieren
- alte Geometrie-Assignments hart loeschen
- lokale Override-Tabellen sofort loeschen
- alle Legacy-Snapshots automatisch bereinigen
- neue Branches verwenden, sofern der Nutzer nichts anderes sagt

## 10. Arbeitsregeln fuer die Umsetzung

- Immer erst das Repository einlesen.
- Keine grossen Patches ohne vorherige Analyse.
- Bestehende Geometrien und Hierarchien nicht anfassen.
- Bei Unsicherheit zuerst Diagnose statt Migration.
- Kleine, nachvollziehbare Commits auf `master`, sofern der Nutzer das freigibt.
- Nach jedem Commit den Commit verifizieren.
- Nie behaupten, ein Commit sei erfolgt, bevor GitHub den Commit-SHA bestaetigt.
- Keine lokalen Override-Daten loeschen, solange keine explizite Freigabe vorliegt.
- UI/Backend schrittweise entkoppeln.

## 11. Startprompt fuer eine neue Konversation

Der folgende Prompt soll in einer neuen ChatGPT-Konversation verwendet werden:

```text
Du arbeitest am Repository https://github.com/valentin-schwind/avesmaps/ im Projekt Avesmaps.

Lies zuerst das Repository und besonders diese Datei:

docs/political-territory-global-display-and-derived-boundaries-plan.md

Halte dich strikt an diesen Plan. Ziel ist die Umstellung der politischen Herrschaftsgebiet-Eigenschaften und der abgeleiteten Außengrenzen auf ein globales, territory-basiertes Modell.

Wichtige Grundregeln:

1. Bestehende echte Karten-Geometrien duerfen nicht geloescht, umgeschrieben oder neu zugeordnet werden.
2. Bestehende Territorien und Territorien-Hierarchien duerfen nicht veraendert werden.
3. Lokale Eigenschaften/Overrides sollen aus der aktiven UI entfernt werden. Alte Daten duerfen zunaechst nur stillgelegt, nicht geloescht werden.
4. Der aktive Breadcrumb-Knoten ist die einzige Wahrheit fuer Eigenschaften und Außengrenzen.
5. Ein Kartenklick ist nur Einstiegspunkt. Nach Auswahl eines Breadcrumb-Knotens wird ausschliesslich dessen territory_public_id/territory_id bearbeitet.
6. Normale Eigenschaften wie Farbe, Transparenz, Wappen, Zoom und Gültigkeit sollen global am Territorium haengen.
7. Außengrenzen haengen global an territory_id in political_territory_derived_geometry.
8. Das Geometrie-Panel braucht die Häkchen: Außengrenzen darstellen, Innengrenzen darstellen, Für alle Unterregionen übernehmen.
9. Für alle Unterregionen übernehmen aus = flache Außengrenze aus allen Blatt-/Quellgeometrien unterhalb des aktiven Knotens.
10. Für alle Unterregionen übernehmen an = rekursive/hierarchische Außengrenzen fuer den aktiven Knoten und aggregierbare Unterknoten.
11. Innengrenzen darstellen ist fuer Blattknoten ohne Unterregionen deaktiviert, abgehakt und ausgegraut.
12. Keine Migration oder Loeschung ohne Diagnose und explizite Freigabe.
13. Arbeite in kleinen, verifizierten Commits auf master, sofern nichts anderes gesagt wird.
14. Erklaere vor jeder Code-Aenderung knapp, welche Datei du warum aenderst.
15. Nach jeder Aenderung: Commit verifizieren und klar sagen, was geaendert wurde.

Beginne nicht mit Code. Beginne mit einer Repo-Analyse und formuliere dann einen konkreten ersten Schritt. Warte auf Freigabe, bevor du schreibst.
```

## 12. Kurzfassung fuer Entwickler

Das neue Modell lautet:

```text
Karte klickt Geometrie -> Editor oeffnet Breadcrumb -> aktiver Breadcrumb bestimmt Territorium -> Eigenschaften und Außengrenzen werden global an diesem Territorium gelesen/geschrieben.
```

Die Hauptaufgabe ist keine Geometrie-Migration, sondern eine Entflechtung:

```text
Geometrie = raeumliche Quelle
Territorium = fachliche Identitaet
Display = globale Territoriumseigenschaft
Derived Geometry = globale, berechnete Außengrenze eines Territoriums
```
