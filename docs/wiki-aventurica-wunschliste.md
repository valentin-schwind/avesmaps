# Wünsche an Wiki Aventurica

**Von:** Avesmaps (https://avesmaps.de) — nicht-kommerzielles Fanprojekt, interaktive
Aventurien-Karte mit Routenplaner
**Stand:** 23. August 2026

Wir beziehen unsere Wiki-Daten so weit wie möglich aus dem XML-Dump und nur dort über die
API, wo der Dump die Information prinzipiell nicht enthalten kann. Diese Liste sammelt, was
uns helfen würde — sortiert danach, wie viele Anfragen an das Wiki es **einspart**.

Alle genannten Zahlen sind eigene Messungen mit Datum, keine Schätzungen.

---

## Bilanz in drei Zahlen

| | |
|---|---|
| **~180 → 0** | gedrosselte API-Anfragen je Dump-Lauf allein für die Kontinent-Zuordnung — mit einem `categorylinks`-Export |
| **50 → 500** | Titel je Anfrage — mit `apihighlimits` für ein benanntes Bot-Konto (Faktor 10 auf allen Titel-Abfragen) |
| **0** | Bilddatei-Anfragen seit dem 23.08.2026, im Code verriegelt — und das bleibt so, bis es einen abgesegneten Weg gibt |

---

## Vorab: was am 20. August passiert ist

Am 20.08. hat euer Server unsere Ausgangsadresse abgewiesen. **Die Ursache lag bei uns.**

Acht von zwölf Wappen-Ausgaben in unserer Oberfläche hängten die Bildadresse direkt ins
`<img src>` — aus dem Browser jedes Editors, an unserem eigenen Cache vorbei, und zwar auf
`Spezial:Dateipfad/…`. Drei dieser Ausgaben sind Listen mit einem Wappen **je Zeile**; ein
einziger Listenaufbau waren damit hunderte Anfragen auf eine Spezialseite, die eure
robots.txt Bots verbietet.

Was wir daraufhin geändert haben:

- **21.08.** — alle zwölf Ausgaben laufen über unseren eigenen Cache. Ein geteilter Helfer,
  dazu ein Test, der das ganze Repo nach Umgehungen absucht.
- **23.08.** — harter Riegel: es geht **keine Bilddatei mehr** an das Wiki. Es gibt genau zwei
  ausgehende Datei-Abrufe im Code, beide fragen den Riegel; ein Scanner über das Repo
  verhindert einen dritten.

Nicht betroffen und bewusst weiter in Betrieb: der eine Dump-Abruf je Lauf und die
gedrosselte API (0,6 s Abstand, 50 Titel je Anfrage). Nach unserer eigenen Messung waren sie
nicht der Verursacher.

Wir bitten im Folgenden also nicht um Nachsicht für Verkehr, den wir weiter erzeugen wollen,
sondern um Wege, die **weniger** Anfragen erzeugen als heute.

---

## Die Wünsche

### 1. Ein `categorylinks`-Export neben dem Dump

**Warum.** Vorlagen-*gesetzte* Kategorien — Siedlungsart, Kontinent — stehen nicht im
Artikel-Wikitext; sie entstehen erst beim Rendern der Infobox. Genau deshalb kann unser
Dump-Lauf nicht offline sein: mehrere Online-Phasen holen sie über
`action=query&prop=categories` nach. Allein die Kontinent-Zuordnung sind rund **180**
gedrosselte Anfragen über etwa 9.000 Titel — bei jedem Lauf.

**Kostet euch.** Einen Export neben den vorhandenen Dumps. (Bei uns wäre das ein
SQL-Einzeiler; wie es bei euch aussieht, wisst ihr besser.)

**Spart euch.** Diese Anfragen fallen vollständig weg. Es ist mit Abstand der größte Hebel
auf dieser Liste.

### 2. Der Datei-Namensraum (ns 6) im Dump

**Warum.** Der Dump trägt fünf Namensräume — gemessen am 04.08.2026: ns 0 = 203.266,
ns 4 = 294, ns 10 = 4.025, ns 12 = 260, ns 14 = 16.144 Seiten. `Datei:`-Seiten fehlen, damit
auch die Lizenzvorlagen. Wir spiegeln nur gemeinfreie Wappen — die Lizenz müssen wir deshalb
online nachschlagen, Datei für Datei.

**Kostet euch.** Einen weiteren Namensraum im Dump-Job.

**Spart euch.** Die gesamte Lizenz-Nachfrage. Die Bilddateien selbst brauchen wir im Dump
ausdrücklich **nicht** — nur die Seiten mit den Lizenzangaben.

### 3. Ein benanntes Bot-Konto mit `apihighlimits`

**Warum.** Ohne Bot-Recht liegt unser Titel-Limit bei exakt 50 je Anfrage (per `paraminfo`
geprüft), mit Bot-Recht bei 500.

**Kostet euch.** Ein Konto und ein Recht.

**Spart euch.** Faktor zehn auf allen Titel-Abfragen. Und ihr bekommt eine benannte,
drosselbare, im Zweifel einzeln sperrbare Identität statt einer anonymen
Shared-Hosting-Adresse.

### 4. Eine erlaubte Route zu Bilddateien — `prop=imageinfo` statt `Spezial:Dateipfad`

**Warum.** Wir wollen die gemeinfreien Wappen und Cover **einmal** lokal ziehen und danach nie
wieder anfragen. Der kanonische Weg vom Dateinamen zum Bild ist heute eine Spezialseite, und
die verbietet uns eure robots.txt zu Recht.
`action=query&titles=…&prop=imageinfo&iiprop=url|extmetadata` liefert 50 Dateien je Anfrage
über die reguläre API — keine Spezialseite, keine Redirect-Kette, und die Lizenz gleich mit.

**Unsere Frage.** Ist das erlaubt, und in welchem Tempo? Alternativ ein einmaliges Paket der
gemeinfreien Dateien — dann brauchen wir von eurer Seite gar nichts mehr.

### 5. Dump-Takt und ein verlässliches `Last-Modified`

**Warum.** Unser Code ging von täglicher Erzeugung aus. Am 27.07.2026 standen alle sechs
Sprachdumps auf „Last modified 01.07.2026", waren also 26 Tage alt. Das kostet zweierlei: ein
„fehlt bei uns" ist manchmal nur Dump-Alter, und wir laden 40 MB, die sich nicht geändert
haben.

**Kostet euch.** Eine Auskunft: in welchem Takt entsteht der Dump, und können wir uns auf das
`Last-Modified` verlassen?

**Spart euch.** Wir bauen daraufhin conditional GET ein (`If-Modified-Since`). Das fehlt bei
uns heute — das ist unser Versäumnis, nicht eures.

### 6. Cargo, wenn 1.45 kommt

**Warum.** Auf `test.wiki-aventurica.de` liegt Cargo 3.9 bereit. Für uns ersetzt
`action=cargoquery` das Wikitext-Parsen an 177 Stellen in 20 Dateien und liefert **berechnete**
statt literaler Infoboxwerte — also Wunsch 1 an der Wurzel, und dieselbe Antwort für alles,
was heute per DPL entsteht.

**Unser Angebot.** Wenn ihr euch dafür entscheidet, helfen wir bei der Modellierung der Felder
gern mit. Wir haben die Infoboxen in einer Breite gelesen, die beim Pflegen einzelner Artikel
nicht anfällt.

### 7. Vorwarnung beim Umstieg auf 1.45 — und ein Lesekonto im Testwiki

**Warum.** DPL3 → DPL4 ist ein Hauptversionssprung. 23 Seiten, die wir als Einstieg benutzen
(`Staat/Liste` und ihre Geschwister), sind DPL-generiert. Fällt DPL4 dort anders aus, sehen
wir **nichts** — der Ausfall ist bei uns lautlos, die Liste ist dann einfach leer. Im Testwiki
ist der anonyme API-Lesezugriff gesperrt (`readapidenied`), wir können es also nicht vorher
prüfen.

**Kostet euch.** Ein Lesekonto im Testwiki und eine kurze Nachricht vor dem Umstieg.

**Spart euch.** Eine gemeinsame Fehlersuche danach.

### 8. Freistellung statt Entsperrung — und ein kurzer Draht

**Warum.** Unsere ausgehende Adresse ist **81.169.144.135**. Sie ist **nicht** die der Website
(81.169.145.156) — wer die nennt, nennt die falsche. Sie liegt hinter dem NAT unseres
Shared-Hostings, wir teilen sie also mit fremden Mietern: eine Sperre kann jemand anders
verdient haben, und sie kann nach dem Entsperren erneut zuschlagen.

**Unsere Bitte.** Eine Freistellung für unser Bot-Konto beziehungsweise unseren User-Agent
statt einer reinen IP-Entsperrung. Und einen Weg, auf dem ihr uns in Minuten erreicht — beim
letzten Mal stand die Sperre drei Tage.

### 9. Kleinkram, falls ihr ohnehin an den Vorlagen arbeitet

- Apostrophe und Anführungszeichen stehen in den **Klartextfeldern** der Infoboxen als
  HTML-Entity (`&#39;`), in den Wikilinks derselben Infobox aber als echtes Zeichen. Wir
  dekodieren das inzwischen; es ist nur ein Hinweis auf eine uneinheitliche Stelle.
- Ein Hinweis, wenn Infobox-Felder oder Vorlagen umbenannt werden. Jede Umbenennung ist bei
  uns ein stiller Datenverlust.
- Niedrige Priorität: der Namensraum „Inoffiziell" (ns 222) fehlt im Dump vollständig — das
  sind 589 inoffizielle Abenteuer und 407 Spielhilfen. Wir kommen ohne aus.

---

## Was wir im Gegenzug tun

- **Fehlerlisten aus dem Massenabgleich.** Wir laufen den Dump ohnehin durch und sehen die
  Daten dabei in einer Breite, die beim Lesen einzelner Artikel nie auffällt. Ein Beispiel:
  eine Auswertung über alle 3.060 Publikationsseiten hat uns gezeigt, welche `Art`-Werte
  tatsächlich in Gebrauch sind — 1.161 Seiten trugen Werte, die unsere Tabelle nicht kannte.
  Solche Bestandsaufnahmen (leere Pflichtfelder, widersprüchliche Kategorien, tote
  Redirect-Ketten, doppelte Artikel zum selben Objekt) kosten uns fast nichts und liefern wir
  gern regelmäßig.
- **Null Dateianfragen**, bis es einen abgesegneten Weg gibt. Steht heute schon so im Code.
- **Kein Auto-Sync.** Jeder Lauf wird von Hand ausgelöst, ist gedrosselt und läuft genau
  einmal.
- **User-Agent mit Kontaktadresse** — heute steht dort nur `Avesmaps WikiSync/1.0` — und auf
  Wunsch eine Wiki-Seite, die unseren Bot beschreibt.
- **Conditional GET** auf den Dump, sobald wir uns auf das `Last-Modified` verlassen können.

---

## Technische Eckdaten

| | |
|---|---|
| Projekt | avesmaps.de — nicht-kommerzielles DSA-Fanprojekt, keine Werbung, keine Einnahmen |
| Ausgehende Adresse | `81.169.144.135` (STRATO, geteilt — **nicht** die Adresse der Website) |
| User-Agent | `Avesmaps WikiSync/1.0` (bekommt eine Kontaktadresse) |
| API-Endpunkt | `de.wiki-aventurica.de/de/api.php` |
| Genutzte Module | `action=query` (`prop=categories`, `prop=revisions`, `list=categorymembers`, `list=embeddedin`) und `action=parse` |
| Drossel | 0,6 s + Jitter zwischen Anfragen, 50 Titel je Anfrage, 30 s Timeout, höchstens 3 Wiederholungen |
| Dump | `offline.wiki-aventurica.de/dump/dewa_dump_small.xml.bz2` — ein Abruf je Lauf, nur auf Knopfdruck |
| Bilddateien | seit 23.08.2026: keine |

---

## Wenn es nur drei sein können

**Der `categorylinks`-Export, der Datei-Namensraum im Dump und das Bot-Konto mit
`apihighlimits`.** Die drei zusammen senken unsere Anfragen an das Wiki um mehr als eine
Größenordnung — und kosten euch zusammengenommen vermutlich eine Stunde Arbeit.
