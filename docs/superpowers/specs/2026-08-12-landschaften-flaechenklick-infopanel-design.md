# Klick auf eine Landschaftsfläche öffnet das Infopanel

**Stand:** 2026-08-12 · **Owner-Auftrag:** „In Landschaften soll ein Klick auf die Regionen auch das
Infopanel öffnen (insbesondere im Frontend)."

## 1. Warum

Im Frontend beantwortet ein Klick auf ein Landschafts-**Label** schon alles: das Infopanel geht auf
(`buildRegionLabelViewPopupHtml`), die Fläche leuchtet, die Karte zentriert. Ein Klick auf die
**Fläche** selbst leuchtet nur und wirft einen Toast — „Eisenwald (Gebirge)" und sonst nichts.

Das ist dieselbe Frage mit zwei verschiedenen Antworten, und die schlechtere trifft den größeren
Anfasser: eine Fläche ist tausendmal größer als ihr Schriftzug.

## 2. Die Regel in einem Satz

**Ein Klick auf eine Landschaftsfläche beantwortet dasselbe wie ein Klick auf ihr Label — im Frontend.**

🔴 **Seit dem 09.09.2026 nicht mehr nur im Frontend — siehe §8.**

## 3. Der Weg

Die Fläche bringt ihr **primäres** Label schon mit: `label_public_id` reist seit jeher in der
Flächenantwort mit (`api/_internal/app/ecosystem.php`, `avesmapsEcosystemReadAreas`). Es muss also
nichts geraten und nichts nachgeladen werden.

1. `area.label_public_id` → Label in `labelData` suchen (über `label.publicId`).
2. **Gefunden** → `buildRegionLabelViewPopupHtml(label)` ins Panel. Identisches Markup, kein zweiter
   Bauplan.
3. **Nicht gefunden** → Minimal-Panel aus der Fläche: Name, Art und Ebene, in derselben
   `locationPopupMarkup`-Hülle und mit demselben `regionHeaderImageBasename()`. Der Untertitel liest
   sich „Gebirge · Topographie" — dieselbe Bauart wie bei einer Siedlung („Metropole · Hauptstadt von X").

   💣 **Kein Wort zweimal, und keines, das schon in der Überschrift steht.** Die Landschaftsdaten
   lassen **beide** Wiederholungen zu, und beide standen live auf dem Schirm:
   - **Name = Art** — „Gemäßigte Zone" *heisst* so und *ist* von dieser Art. Ungefiltert las sich das
     Panel „Gemäßigte Zone / Gemäßigte Zone · Klimazonen".
   - **Art = Ebene** — eine Fläche ohne eigene Art trägt die Ebene bereits als ihre Art
     (`ecosystemAreaTypeLabel` fällt darauf zurück), und daraus wurde „Klimazonen · Klimazonen".

   Deshalb eine Liste, die sich selbst bereinigt, statt zweier Sonderfragen: die Regel heisst „sag
   nichts zweimal", nicht „prüfe diese beiden Paare".

   ⚠️ **Gefunden erst im echten Durchlauf auf der Karte** — die Unit-Tests waren dabei sämtlich grün,
   und die zweite der beiden Wiederholungen hatte ich sogar ausdrücklich abgefangen. Genau der Beleg
   für „Abnahme heisst Ablauf, nicht Maß".

   ⚠️ **Das Kopfbild kommt aus der ART, nie aus der Ebene.** `regionHeaderImageBasename` ist dieselbe
   Tabelle, die das Label befragt; ihr Rückfall („region") ist ein gültiges Bild. Kein zweiter Katalog.

💣 **Fall 3 ist nicht nur „ohne Label".** Ein Zeiger ist kein Label — `ecosystem_region.label_public_id`
überlebt ein handgelöschtes Label ([[landschaften-flaeche-label-kopplung]]). Derselbe Zweig fängt
deshalb drei Zustände auf einmal: kein primäres Label, toter Zeiger, Label nicht in `labelData`. Kein
Sonderfall, keine Vorabprüfung — wer nicht gefunden wird, bekommt das Flächen-Panel.

## 4. Die Wahl ist die Regel, das Markup ist nur ihre Ausgabe

Getrennt in zwei Funktionen, damit die Entscheidung **ohne Leaflet, ohne DOM und ohne Markup-Stubs**
prüfbar ist:

- `ecosystemAreaInfoSource(area, labels)` → `{ kind: "label", label }` | `{ kind: "area", area }` | `null`
- `ecosystemAreaInfoMarkup(source)` → der HTML-String; ruft die beiden Builder per `typeof`-Wache.

💣 Ohne diese Trennung prüfte der Test einen Stub gegen sich selbst — er bewiese „es kam Markup", nicht
„es kam das RICHTIGE" ([[vm-sandbox-stub-swallows-rule]], [[test-muss-beissen-mutation]]).

## 5. Vier Festlegungen

### 5.1 💣 Kein `panTo`
Der Label-Klick zentriert die Karte ([map-features-labels.js:547](../../../js/map-features/map-features-labels.js)).
Hier wäre das falsch: der Nutzer klickt auf das, was er schon sieht, und ein Sprung unter dem Zeiger
ist Lärm. **Der Unterschied ist gewollt und darf nicht „vereinheitlicht" werden.**

### 5.2 💣 Derselbe Riegel wie die Hervorhebung, nicht ein zweiter daneben
🔴 **Zur Hälfte umgedreht am 09.09.2026: gilt fürs LEUCHTEN, nicht mehr fürs PANEL — siehe §8.**

Panel und Leuchten hängen an **einer** Bedingung — der schon vorhandenen in
`buildEcosystemAreaLayer` (`typeof canOperateEcosystemLayers === "function" && !canOperateEcosystemLayers()`).
Zwei Bedingungen für eine Geste sind die Divergenz von morgen: eine ließe sich ändern, die andere
bliebe stehen, und der Klick täte plötzlich die Hälfte.

⚠️ Zusätzlich `IS_INFOPANEL_MODE` — ohne Panel-Modus gibt es kein Ziel, und dann bleibt alles wie heute
(so wie der Label-Klick es auch hält).

### 5.3 Der Toast entfällt, wo das Panel aufgeht
🔴 **Überholt am 09.09.2026: er entfällt jetzt auch im Editor — siehe §8.**

Er sagt denselben Satz, den das Panel als Überschrift trägt. Im Editor bleibt er — dort geht kein
Panel auf, und dort ist er die einzige Rückmeldung.

### 5.4 Der Klimazonen-Name am Kartenrand zieht mit
Er ist „der Griff, mit dem man sein Band hervorhebt"
([map-features-ecosystem-climate.js:357](../../../js/map-features/map-features-ecosystem-climate.js)).
Ohne diese Zeile wäre er das einzige Ding, das **weniger** tut als die Fläche unter ihm.

⚠️ Er kennt seine Fläche bereits (`area`), also derselbe Aufruf — keine zweite Auflösung.

## 6. Nicht angefasst

Die drei Riegel am Kopf des Klick-Handlers bleiben Wort für Wort: Zeichnen (`isEcosystemDrawing`),
Verschieben/Zerschneiden (`claimsMapClick`), Zwei-Flächen-Operationen (`handleAreaClick`). Ebenso die
Editor-Auswahl, der Doppelklick und `setSelectedEcosystemArea`.

Der Klick auf ein **Label** bleibt exakt, wie er ist — inklusive seines `panTo`.

## 7. Abnahme

**Unit** (`js/map-features/__tests__/ecosystem-area-infopanel.test.js`, vm-Bauart der Nachbartests):
Label da → `kind: "label"` · toter Zeiger → `kind: "area"` · kein `label_public_id` → `kind: "area"` ·
leere Flächenangabe → `null` · das gefundene Label ist das **richtige** (drei Kandidaten im Register) ·
Ebene im Untertitel, und nicht doppelt · Editor schweigt, Leser spricht.

⭐ **Mutationsprobe bestanden (6/6).** Sechs Regelbrüche einzeln in den Quelltext gesetzt — Wahl
ignoriert das Label · Riegel geht immer auf · Rückfall schweigt statt zu antworten · das erste Label
statt des eigenen · Ebene wiederholt sich · Kopfbild aus der Ebene — **jeder** wurde rot. Ohne diesen
Nachweis wäre „grün" nur die Aussage, dass der Test läuft.

⭐ **Der Rückfall mit den ECHTEN Bauern gebaut**, nicht nur mit Stubs: `js/app/utils.js` +
`js/ui/popups.js` in denselben vm-Kontext geladen und das Markup ausgegeben. Ergebnis geprüft für
Gebirge (Kopfbild `gebirge`), Klimazone (kein doppeltes Wort) und Sümpfe/Moore.

**Ablauf, live und von Hand** ([[working-discipline]]: Abnahme heißt Ablauf, nicht Maß):
1. Fläche im Frontend anklicken → Panel geht auf und liest sich richtig.
2. Die Fläche leuchtet dabei (beides oder keins, §5.2).
3. Zweite Fläche anklicken → Inhalt tauscht, kein Sprung der Karte (§5.1).
4. Klimaband + sein Randname → beide öffnen dasselbe Panel (§5.4).
5. Leerklick auf die Karte → Panel klappt ein.
6. Fläche ohne Label → Minimal-Panel statt Leere (§3, Fall 3).
7. ~~Im Editor: Klick wählt aus wie bisher, **kein** Panel, Toast steht noch (§5.3).~~ 🔴 **Überholt am
   09.09.2026 — im Editor geht das Panel auf und der Toast entfällt; siehe §8.**

## 8. Nachtrag 09.09.2026 — 🔴 §5.2 ist zur Hälfte umgedreht

**Owner:** „der linksklick auf ein gebirge löst im editor nicht die infobox aus"

**§5.2 gilt weiter fürs LEUCHTEN und NICHT MEHR fürs PANEL.** Die Begründung von damals — zwei
Bedingungen für eine Geste sind die Divergenz von morgen — trifft die Hervorhebung: sie und die weisse
Auswahlkontur liegen auf derselben Fläche und bedeuten Verschiedenes, übereinander sagen sie nichts.
Das Panel liegt rechts, ist keine Kontur und nimmt der Arbeit nichts weg.

**§5.3 und §7 Punkt 7 sind damit überholt:** im Editor geht das Panel jetzt auf, und der Toast entfällt
dort ebenfalls (die Bedingung `!zeigtPanel` stand schon da und erledigt es von selbst).

💣 **Die alte Regel war im Editor ohnehin nur halb wahr, und das war der eigentliche Befund.** Der Klick
auf das **Label** füllt das Panel dort seit jeher (`popupopen` → `avesmapsShowInfopanel`,
`map-features-labels.js`) — **älter als dieser Entwurf**. Dasselbe Gebirge gab die Auskunft also über
einen Weg und über den anderen nicht; §5.2 hat eine Divergenz beschrieben, die es schon gab, statt sie
zu verhindern.

📏 **Gemessen am Dump vom 08.09.2026** (aktive `kind=topographie` / `region_type=gebirge`): 71 Flächen.
**47** tragen einen Namen mit eingeschalteter Kurvenschrift, und ein Kurvenname hat im Bearbeiten-Modus
weder Marker (Kurvenriegel in `shouldShowLabelMarker`) noch Klick-Schiedsrichter (der steigt bei
`IS_EDIT_MODE` aus, damit der Klick die **Fläche darunter** trifft). Zwei weitere haben gar keinen
Namen. **Für 49 von 71 Gebirgen gab es im Editor keinen Linksklick, der die Infobox öffnet** — und der
Klick auf die Fläche war der einzige, der es hätte können.

⭐ Deshalb hängt das Panel an der **Fläche** und an nichts sonst: damit antwortet auch der Klick, der
durch einen Kurvennamen hindurch auf ihr landet. Ein zweiter Weg über den Kurvennamen wäre die zweite
Bedingung gewesen, vor der §5.2 zu Recht warnt.

⭐ **Mutationsprobe bestanden (5/5):** alter Riegel zurück · Leuchten für alle · Panel-Aufruf entfernt ·
Leuchten invertiert · Toast immer — jeder rot.

💣 **Und die NAHT wird jetzt geprüft, was sie vorher nicht wurde.** Die zwei Hälften (`…InfoSource`,
`…InfoMarkup`) waren grün, während die Trennung von Leuchten und Panel ungeprüft blieb: eine Mutation,
die dem Leuchten seinen Riegel nimmt, überlebte. Der Test fährt seither den **echten Klick-Handler**
auf einer Leaflet-Attrappe (Bauart von `ecosystem-alle-gesperrt.test.js`).

🪤 **Testfalle dabei:** eine Attrappe für `setHighlightedEcosystemRegion` wirkt NICHT — die Datei
deklariert die Funktion selbst, und eine Funktionsdeklaration überschreibt im `vm`-Kontext lautlos, was
der Test hineinlegt. Die Spur blieb leer und sah wie „wurde nicht gerufen" aus. Gemessen wird deshalb
ihre **Wirkung** (`clickedEcosystemRegionId` per `runInContext`) — die bessere Zusicherung ohnehin. Nur
Nachbarn, die diese Datei nicht selbst definiert, dürfen Attrappen sein.

🔧 **Offen:** der Ablauf im angemeldeten Editor ist nicht gefahren worden (kein Login) — Handler, Regel
und Naht sind zur Laufzeit gemessen, der Klick auf der echten Karte nicht.
