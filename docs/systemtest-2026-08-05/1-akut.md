# Bericht 1 — AKUT: was behoben werden muss

28 Befunde. 27 davon haben eine feindliche Gegenprüfung überstanden, deren Auftrag ausdrücklich
war, sie zu widerlegen; 20 weitere ursprünglich als AKUT gemeldete wurden dabei abgestuft,
2 widerlegt, 4 als Doppelungen erkannt — die stehen hier nicht mehr.

Der 28. Befund (A28) kam erst beim Nachzählen der eigenen Testspuren dazu. Er ist damit der
einzige, den nicht das Prüfen, sondern das **Aufräumen** gefunden hat — und ein Beleg dafür,
dass sich der Aufräumteil dieses Tests gelohnt hat.

Die Reihenfolge ist eine Empfehlung: oben steht, was Inhalt verliert oder Daten falsch macht;
unten, was ärgerlich, aber folgenlos ist.

---

## 1. Eine Community-Meldung kann verlorengehen, ohne dass es jemand merkt

Das ist der schwerwiegendste Zusammenhang des ganzen Tests, weil er **gezielt den guten
Mitwirkenden trifft** und von keiner Seite aus sichtbar ist — weder für den, der meldet, noch
für den, der die Meldungen bearbeitet.

### A1 · Eine verworfene Meldung wird dem Menschen als Erfolg gemeldet
`api/app/report-location.php:83` und `:98` gegen `:184`

Honigtopf, Spamwort, „zu schnell" und die Stundengrenze antworten alle mit
`{"ok":true,"message":"Karteneintrag wurde gemeldet."}` — **wortgleich** mit dem echten Erfolg.
Der einzige Unterschied ist der Statuscode: **200 = weggeworfen, 201 = gespeichert**. Der Client
wertet ihn nicht aus, zeigt einen grünen Hinweis und leert das Formular.

Damit ist es genau verkehrt herum: Ein **Mensch** liest „ist angekommen", freut sich und hat
nichts mehr in der Hand. Ein **Bot** liest den Statuscode und weiß nach einem Versuch, welcher
seiner Tricks funktioniert hat. Beim Kontaktformular unterscheiden sich sogar die Sätze.

*Beleg:* über die echte Oberfläche reproduziert (vollständiges Formular, grüner Hinweis, keine
Zeile in der Datenbank) und im Code nachgelesen. *Aufwand:* klein.

### A2 · Die Stundengrenze zählt Änderungsvorschläge mit
`api/app/report-location.php:97`

Fünf Meldungen je IP und Stunde. Änderungsvorschläge werden von der Grenze zwar **nicht
blockiert**, zählen aber **auf das Kontingent an**. Wer fünf Korrekturen schickt, kann in
derselben Stunde keinen neuen Ort mehr melden — und erfährt es wegen A1 nicht.

*Beleg:* reproduziert, die sechste Meldung verschwand. *Aufwand:* klein.

### A3 · Eine bearbeitete Meldung ist danach unauffindbar
`api/edit/reports/locations.php`

Der Endpunkt liefert nur Meldungen mit Status `neu`. Es gibt keine Liste erledigter Meldungen.
Während des Tests sind der Redaktion zwei eigene Meldungen unter der Hand verschwunden, ohne
dass sich nachvollziehen ließ, was mit ihnen passiert war.

*Aufwand:* mittel.

### A4 · Die Moderation hinterlässt keinen Eintrag im Änderungsprotokoll
Annehmen, Ablehnen und Zurückstellen einer Meldung erzeugen keine Protokollzeile. Wer eine
Meldung bearbeitet hat und mit welcher Begründung, ist nachträglich nicht feststellbar — bei
einer Karte, die 11.500 Objekte aus Community-Beiträgen führt.

*Aufwand:* mittel.

### A5 · Der Wunschtext des Melders landet in der öffentlichen Beschreibung
Was ein Melder als Erläuterung schreibt, wird beim Annehmen in das öffentlich sichtbare
Beschreibungsfeld übernommen — ohne dass die Redaktion darauf hingewiesen wird, dass dieser Text
gleich für alle sichtbar ist.

*Aufwand:* klein.

---

## 2. Löschen räumt nicht auf

Fünf Befunde, drei Agenten unabhängig darauf gestoßen. Der Kern ist immer derselbe: die
Hauptzeile verschwindet, ihre Anhängsel bleiben — und bleiben **öffentlich abrufbar**.

### A6 · Ein gelöschtes Kartenobjekt lässt seine Quellenverweise für immer zurück
Verwaiste Einträge in `feature_sources`: **284** bei Karten, **123** bei Regionen (mit 3.471
Verweisen), **84** bei Wegen, **9** bei Siedlungen. Ein `DELETE FROM sources` existiert nirgends
im Projekt — **132 Katalogzeilen** zeigt nichts mehr an, sie tauchen aber weiter in der
Quellen-Vervollständigung aller Redakteure auf.

💡 **Die Lösung ist im Haus.** Dieselbe Funktion macht es in ihrem Legacy-Zweig richtig
(`… AND is_active = 1`, Zeile 126) — nur am Katalog-Zweig fehlt die Bedingung. Ein JOIN.

*Beleg:* in den Momentaufnahmen ausgezählt und an einer echten Siedlung im Editor nachgewiesen.
*Aufwand:* klein.

### A7 · Auch „Rückgängig" lässt den Quellenverweis stehen
Derselbe Mechanismus, eine Stufe schlimmer: Wer eine Änderung zurücknimmt, bekommt den alten
Zustand — bis auf die Quellen, die öffentlich abrufbar bleiben. Betroffen ist auch
`undo_create_point`.

*Aufwand:* klein (dieselbe Bedingung wie A6).

### A8 · Der Karten-Sync löscht anders als die Hand
Der Sync-Löschpfad vergisst `citymap_related` und `citymap_link`, die der Handlöschpfad räumt.
Zwei Wege, zwei Ergebnisse, für dieselbe Aktion.

*Aufwand:* klein.

### A9 · 14 Kraftlinien-Segmente hängen an Endpunkten, die es nicht mehr gibt
*Beleg:* in der Momentaufnahme ausgezählt. *Aufwand:* klein (Datenbereinigung).

### A10 · 516 Abenteuer-Zuordnungen zeigen auf gelöschte Label
Der Wiki-Schlüssel-Rückfall des Clients rettet 491 davon; **25 sind unrettbar unsichtbar** —
ein Abenteuer, das einem Ort zugeordnet ist, erscheint dort nicht.

*Aufwand:* mittel.

---

## 3. Offene Türen

### A11 · Ein Schreibpfad ohne jede Anmeldung
`api/app/adventures.php:94`

`POST /api/app/adventures.php {"action":"resolve"}` prüft **keinerlei Berechtigung**, schreibt
in die Datenbank und läuft über den gesamten Bestand. Der Kopfkommentar der Datei nennt es eine
„guarded one-shot BOOTSTRAP surface", die „Phase 3 … can tighten/remove" — Phase 3 ist längst
ausgeliefert, das Aufräumen ist nie passiert.

Der eigentliche Schaden ist weniger das Schreiben als der Hebel: **jeder Fremde kann den Server
wiederholt in einen vollständigen Auflösungslauf schicken.** Bei einem PHP-Pool, der schon
dreimal an Last erstickt ist, ist das der billigste denkbare Ausschaltknopf.

*Beleg:* ausschließlich gelesen, **bewusst nicht ausprobiert**. *Aufwand:* klein.

### A12 · `PDOException` leckt an jeden anonymen Aufrufer — im stabilen Vertrag
`api/locations/index.php:38` und `api/route/index.php:359`

Beide fangen `RuntimeException $exception` und reichen `$exception->getMessage()` mit einem 500
an den Aufrufer durch. In PHP **ist `PDOException` eine `RuntimeException`** — ein
Datenbankfehler schickt also die Treibermeldung mit Tabellen-, Spalten- und SQL-Fragmenten
nach draußen. Der `Throwable`-Zweig direkt darunter macht es richtig; der Autor kannte das
Muster. Fünf Nachbarendpunkte fangen `PDOException` ausdrücklich zuerst.

Erschwerend: es sind ausgerechnet die zwei Endpunkte, die als **stabil** zugesagt sind.

*Beleg:* wörtlich gelesen. *Aufwand:* klein — zwei Zeilen, größter Radius.

> ✅ **Bereits behoben und ausgeliefert** (Commit `7b8dfc4b`, 05.08.2026): Das Verzeichnis
> `scripts/` lag im Web und führte PHP aus. Vier der acht Wartungsskripte hatten keinen
> Riegel und öffneten beim ersten `require` die Produktivdatenbank — darunter eines für
> Massenschreibvorgänge am Politik-Bestand und der Linkchecker, dessen eigener Kommentar sagt,
> er laufe „the whole backlog to completion". Jetzt greifen zwei Ebenen: ein `.htaccess` wie
> in den sieben anderen geschützten Verzeichnissen, und derselbe CLI-Riegel, den die
> `wikidump-`Skripte schon tragen. Live gegengeprüft.

---

## 4. Der stabile Vertrag hält nicht, was er zusagt

`POST /api/route/` und `GET /api/locations/` sind ausdrücklich als **stabil** zugesagt.

### A13 · Kreuzungsnamen sind Positionsnummern, keine Kennungen
`api/_internal/routing/network-data.php:131`

```php
if (strncmp($name, 'Kreuzung', ...) === 0) {
    $name = 'Kreuzung-' . $clientCrossingIndex;
}
```

Der gespeicherte Name wird beim Lesen durch einen **laufenden Zähler** ersetzt. In der echten
Antwort sind das `Kreuzung-1` bis `Kreuzung-2079`, lückenlos — **43 % aller 4.854 Objekte**.
Weil Ortsnamen zugleich Graph-Schlüssel sind und geteilte Routen den Namen mitnehmen, benennt
**eine einzige gelöschte oder eingefügte Kreuzung bis zu 2.078 Knoten um**. Dieselben Objekte
heißen in `map-features` anders.

Das ist der einzige Befund des Tests, der **falsche Daten ohne jede Fehlermeldung** erzeugt.

*Beleg:* Code gelesen, in der Momentaufnahme ausgezählt, gegen `map-features` verglichen.
*Aufwand:* mittel.

### A14 · `GET /api/locations/` ist der ungeschützte Zwilling eines 152-MB-Pfades
Der Endpunkt lädt die ganze `map_features`-Tabelle und baut das Routennetz auf — genau den
Pfad, den `api/route/index.php:26` selbst mit „62 MB resident, peak 152 MB per call" beziffert
und für den sechs Diagnose-Endpunkte hinter Rechte gelegt wurden. Der öffentliche Zwilling ist
offen: **ohne Cache, ohne ETag, ohne Limit**. `?limit=25` wird ignoriert — die Antwort enthält
immer alle 4.854 Objekte (938 KB).

*Beleg:* Code gelesen, `?limit=25` live gegengeprüft. *Aufwand:* mittel.

### A15 · Die öffentlich widerrufene DIN-33466-Behauptung steht weiter in der kanonischen Referenz
`api/README.md:101`

> „**The model is the Leistungskilometer** (DIN 33466, the marching-time arithmetic of the
> German and Swiss alpine clubs)"

Genau diese Behauptung haben am 31.07.2026 zwei Spieler unabhängig als falsch erkannt; sie wurde
aus der Oberfläche entfernt und ein Wächter-Test dagegen gebaut. Der Test kennt aber nur zwei
JS-Dateien — `api/README.md` ist nicht darunter, obwohl AGENTS.md §4 sie als „canonical
reference" für Fremdnutzer der stabilen Schnittstelle benennt.

**Warum es niemandem auffiel:** derselbe Test ist seit Monaten **dauerhaft rot**, weil er über
seine eigenen Warnkommentare stolpert (`js/routing/transport-speed-info.js:177` und `:186`
erklären, warum das Etikett nie wiederkommen darf — `str_contains` kann Kommentar nicht von
Oberflächentext unterscheiden). Ein dauerhaft roter Test bringt allen bei, wegzuschauen.

*Feinheit für die Reparatur:* in der README steht zwischen „DIN" und „33466" ein **geschütztes
Leerzeichen**, ein einfaches `grep "DIN 33466"` findet es nicht. Der Test hat für genau diesen
Fall bereits eine Normalisierung eingebaut — nimmt man die Datei in die Prüfliste auf, greift
sie doppelt (über `alpine clubs` schon roh, über `DIN 33466` nach der Normalisierung).

*Aufwand:* klein.

---

## 5. Im Editor gibt es für drei Objektarten keinen Weg zurück

### A16 · Karten, Abenteuer und Vorkommen haben kein Änderungsprotokoll und kein Rückgängig
Sieben schreibende Vorgänge, **null Protokollzeilen**, in allen drei Bibliotheken null
Audit-Aufrufe. Abenteuer und Karten werden **hart** gelöscht; Vorkommen speichern beim
Fokusverlust, ohne Speichern-Knopf. Das sind **5.104 + 1.352 + 457 Zeilen ohne Weg zurück** —
während ein um drei Pixel verschobenes Label sauber protokolliert wird.

*Beleg:* gegen Zeitstempel nachgezählt. *Aufwand:* groß.

### A17 · Ein frisch angelegtes Abenteuer fehlt in der Liste des Editors, der es angelegt hat
Die Oberfläche zeigt „0 von 1352", der Endpunkt liefert 1353. Erst ein vollständiger
Seitenneuaufbau bringt den Eintrag. Das Formular sagt „Erst speichern, dann Orte zuordnen" —
genau das ist damit unmöglich.

*Aufwand:* klein.

### A18 · Editorfenster stapeln sich als lebende iframes
Jeder geöffnete Editor bleibt liegen. Schließt man den neuen, taucht der alte in seinem alten
Zustand wieder auf. Am Ende des Testlaufs: **drei tote Editoren bei null sichtbaren Fenstern** —
jeder mit eigenem Zustand, eigenen Timern und eigenen Anfragen an den Server.

*Aufwand:* mittel.

---

## 6. Zwei echte Lasttreiber

### A19 · `ecosystem-areas.php` führt 64 SQL-Anweisungen aus, bevor es ein 304 zurückgibt
13 `CREATE TABLE`, 16 `information_schema`-Proben, 34 `INSERT IGNORE`. Ein Client mit gültigem
ETag — also der Normalfall — zahlt sie vollständig.

*Aufwand:* mittel.

### A20 · Der N+1 im abgeleiteten Politik-Layer lebt noch
Milestone M6 hat nur den Volltabellen-Scan entfernt. `territories-derived-layer.php:66-67`
feuert weiter **2 Abfragen je abgeleitetem Objekt** — bei Zoom 3 sind das **244 Abfragen** je
Cache-Fehlschlag, auf dem schwersten Endpunkt des Projekts (gemessen: 2,82 s, 3,0 MB).

*Aufwand:* mittel.

### A21 · Drei Wiki-Abgleicher schreiben über 4–6 Tabellen ohne jede Transaktion
Ein Abbruch mitten im Lauf hinterlässt halbe Objekte. *Aufwand:* mittel.

---

## 7. Wo die Seite etwas zusagt, das sie nicht einhält

### A22 · Bewertungen erscheinen sofort öffentlich, obwohl eine Prüfung zugesagt ist
Der Hinweistext verspricht eine redaktionelle Prüfung; die Bewertung ist unmittelbar für alle
sichtbar. Während dieses Tests ist genau das passiert (die Testbewertung stand live und wurde
entfernt). Es gibt außerdem keinen Weg, eine Bewertung zu melden.

*Aufwand:* mittel.

### A23 · Der Besucher-Hash-Salt steht im Quelltext und ist technisch nicht überschreibbar
Die Datenschutzerklärung sagt, die Besucherkennung sei nicht rückführbar. Mit einem bekannten
Salt ist ein IP-Hash aber in Sekunden rückrechenbar — der Adressraum ist winzig. Entweder der
Salt wird konfigurierbar, oder die Zusage muss anders formuliert werden.

*Aufwand:* klein.

### A24 · Das Impressum nennt keine E-Mail-Adresse und hat keine eigene Adresse
Es ist nur über einen JavaScript-Dialog erreichbar, also nicht verlinkbar und für einen
Rechteinhaber, der Kontakt sucht, praktisch nicht auffindbar.

*Aufwand:* klein.

### A25 · Das vollständige Kartenmaterial ist als Archiv verlinkt
**1,86 GB PNG plus 169 MB Kacheln.** Das steht in Spannung zur eigenen Fanregel-Zusage in
`NOTICE.md`, keine Bereitstellung „als reines Bilderarchiv" zu betreiben. Es ist der Punkt, an
dem das Projekt am ehesten angreifbar ist.

*Aufwand:* klein (Verlinkung), die Entscheidung gehört dem Owner.

---

## 8. Zwei Einzelstücke

### A26 · Kein Test läuft beim Deploy — und einer ist rot
**205 Testdateien** im Projekt, davon laufen bei einem Deploy **null**. Der Deploy ist reiner
Datei-Upload. Genau deshalb konnte der Wächter-Test aus A15 monatelang rot bleiben, ohne dass
es jemandem auffiel.

*Aufwand:* klein (die Tests laufen ohne Aufbau; sie brauchen nur die richtigen PHP-Erweiterungen:
`mbstring`, `curl`, `pdo_sqlite`, `sqlite3`, `gd`).

### A27 · Ein ungenauer Rechtsklick aufs Meer kostet die ganze Reise
`resetRoutePresentation()` läuft **vor** der Berechnung; der Absage-Zweig nimmt nichts zurück.
Der abgelehnte Punkt bleibt außerdem in der Liste stehen, sodass jede weitere Berechnung erneut
absagt, bis man die Zeile von Hand löscht.

Der Fix ist ein Rückbau, kein Bau. *Aufwand:* klein.

---

### A28 · Ein erzeugter Kurzlink lässt sich nirgends wieder löschen
`api/app/share-link.php`

`map_share_links` hat im **ganzen Projekt keinen Löschpfad** — weder eine Oberfläche noch einen
Endpunkt (`grep map_share_links` in `api/` und `js/` mit `delete`/`remove`: **0 Treffer**). Jeder
je erzeugte Kurzlink bleibt für immer, samt `ip_hash` und der vollständigen Zielabfrage. Eine
versehentlich geteilte Ansicht ist damit nicht zurückholbar.

Die Tabelle wächst außerdem unbegrenzt: es gibt kein Ablaufdatum und keine Bereinigung.

*Beleg:* im Test selbst gestolpert — zwei erzeugte Kurzlinks ließen sich nicht entfernen.
*Aufwand:* klein.

---

## Was der Test hinterlassen hat

12 Zeilen in 4 Tabellen. Sie sind Folge des Tests **und zugleich Befund** — dass es für keine
davon einen Löschweg gibt, ist der eigentliche Punkt. Fertiges SQL mit Sicherheitsabfragen:
[`aufraeumen.sql`](aufraeumen.sql).

| Was | Anzahl | Warum nicht entfernbar |
|---|---|---|
| `map_reports` id 273–280, Status ≠ `neu`, mit IP-Hash | 8 | keine Ansicht zeigt bearbeitete Meldungen (→ A3) |
| `map_share_links`, Route Gareth→Ferdok, einer davon Code `HUGCPFhv` | 2 | kein Löschpfad im Projekt (→ A28) |
| `contact_message` + die zugehörige Mail | 1 | das Postfach kann nicht löschen |
| `sources` id 1224935 (`uses 0`) | 1 | kein Löschpfad für Katalogquellen (→ A6) |

⚠️ Beim Löschen der Kurzlinks aufpassen: am selben Tag können **echte** Kurzlinks von Besuchern
entstanden sein. Ein gelöschter fremder Kurzlink ist ein toter Link in freier Wildbahn. Das SQL
zeigt sie deshalb erst an, statt sie nach Datum wegzuräumen.
