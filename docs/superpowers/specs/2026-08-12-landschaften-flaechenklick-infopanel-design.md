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

   ⚠️ **Die Ebene nur, wenn sie etwas Neues sagt.** Eine Fläche ohne Art trägt die Ebene bereits *als*
   ihre Art (`ecosystemAreaTypeLabel` fällt darauf zurück); sonst stünde dort „Klimazonen · Klimazonen"
   — das Ergebnis einer Ableitung, die sich selbst nicht wiedererkennt.

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
Panel und Leuchten hängen an **einer** Bedingung — der schon vorhandenen in
`buildEcosystemAreaLayer` (`typeof canOperateEcosystemLayers === "function" && !canOperateEcosystemLayers()`).
Zwei Bedingungen für eine Geste sind die Divergenz von morgen: eine ließe sich ändern, die andere
bliebe stehen, und der Klick täte plötzlich die Hälfte.

⚠️ Zusätzlich `IS_INFOPANEL_MODE` — ohne Panel-Modus gibt es kein Ziel, und dann bleibt alles wie heute
(so wie der Label-Klick es auch hält).

### 5.3 Der Toast entfällt, wo das Panel aufgeht
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
7. Im Editor: Klick wählt aus wie bisher, **kein** Panel, Toast steht noch (§5.3).
