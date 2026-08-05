# Usability- und Systemtest, 5. August 2026

Ein Rundum-Test von Avesmaps durch zwölf Prüfer plus zwei Gegenprüfer. Ziel war ausdrücklich
auch das, was im täglichen Gebrauch unsichtbar bleibt: Bedienung, Konsistenz, der Weg einer
Community-Meldung, das Rückgängigmachen, die Datenlage, die Maschinenlesbarkeit des Codes und
die rechtliche Situation.

## Die drei Berichte

| Bericht | Inhalt | Umfang |
|---|---|---|
| **[1 — AKUT](1-akut.md)** | kaputt, falsch oder riskant. Muss behoben werden. | 27 Befunde |
| **[2 — KANN](2-kann.md)** | Refactoring, toter Code, Konsistenz, Maschinenlesbarkeit | 169 Befunde |
| **[3 — ZUKUNFT](3-zukunft.md)** | Features und Komfort, die niemand vermisst, aber alle wollen | 14 Befunde |

Die vollständigen Einzelberichte mit allen Belegen liegen unter [`befunde/`](befunde/).

## Wer geprüft hat

**Drei Endnutzer** (DSA-Fans): ein Schnelldurchlauf durch alle Funktionen, ein Tiefendurchlauf
über alle Ansichten, ein Melder, der Community-Meldungen abgesetzt hat.
**Drei aus dem Betrieb:** die Redaktion, die diese Meldungen entgegennahm, die tägliche
Datenpflege durch alle acht Editoren, und eine Bewertung der rechtlichen Lage.
**Drei zu Daten und Leistung:** Performance, Integrität der Datenlage, Sackgassen im Modell.
**Drei Code-Analysten:** Lesbarkeit für KI-Agenten, Konsistenz von Instruktionen und Gedächtnis,
der API-Vertrag und die Frage, ob API und Oberfläche dasselbe sagen.

## Wie geprüft wurde

**Die Last blieb klein.** avesmaps.de läuft auf STRATO Shared Hosting und ist dreimal an
eigener Testlast zusammengebrochen. Deshalb: die sieben Code-Prüfer haben **keine einzige**
Anfrage an den Server gestellt — die echten Nutzdaten wurden einmal heruntergeladen (28 MB in
acht Momentaufnahmen) und lagen als Dateien bereit. Die fünf Bedien-Prüfer arbeiteten **streng
nacheinander**, nie gleichzeitig. Keine schwere Aktion (Dump, Sync, Autoget, Massenlauf,
Backup, Linkchecker) wurde ausgelöst. Der Server war während des gesamten Tests gesund; die
letzte Messung lag mit 423 ms unter der Grundlinie von 500 ms.

**Jeder AKUT-Befund wurde angegriffen.** Zwei Gegenprüfer bekamen den Auftrag, die 53 als AKUT
gemeldeten Befunde zu **widerlegen**, nicht zu bestätigen. Ergebnis: 27 hielten stand, 20 wurden
auf KANN abgestuft, 2 widerlegt, 4 waren Doppelungen. Die Berichte enthalten nur, was diesen
Durchgang überstanden hat. Die Urteile im Einzelnen: [V1](befunde/V1-widerlegung-technik.md),
[V2](befunde/V2-widerlegung-nutzer.md).

**Belegt statt behauptet.** 208 von 216 Befunden tragen einen eigenen Beleg — eine Fundstelle
mit Zeilennummer, eine Grep-Abfrage mit Trefferzahl, eine nachgerechnete Zahl oder eine
reproduzierte Bedienung. Die 8 nur hergeleiteten sind als solche gekennzeichnet.

## Was verändert und wieder aufgeräumt wurde

Der Test hat echte Daten angelegt, um die Wege zu prüfen, die man sonst nicht prüfen kann.
Jede Änderung steht im [Spurenbuch](befunde/SPURENBUCH.md).

**Nachweislich wieder weg:** die öffentlich gestellte Testbewertung an Angbar (Bestand
114 → 113), zwei aus Meldungen angelegte Orte, ein Testabenteuer, eine Testkarte, ein
Quellenverweis, alle Testmeldungen. Gegenprobe nach dem Test: `map-search.php` findet zu
`ZZ-Systemtest`, `Ambosshain` und `Ratenprobe` **nichts**, und die Antworten von
`adventures.php` und `citymaps.php` sind **byteweise identisch** mit der Momentaufnahme von
vor dem Test.

**Drei Reste ließen sich über keine Oberfläche entfernen** — das ist selbst ein Befund und
steht als solcher im AKUT-Bericht. Das fertige SQL dafür liegt in
[`aufraeumen.sql`](aufraeumen.sql).

## Eine Zahl zum Einordnen

Von 216 Befunden sind **173 mit weniger als einer Stunde Aufwand** zu beheben. Das ist die
eigentliche Nachricht dieses Tests: Avesmaps hat kein strukturelles Problem. Es hat eine lange
Liste vergessener Haken.
