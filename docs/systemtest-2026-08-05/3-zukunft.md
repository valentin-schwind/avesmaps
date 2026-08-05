# Bericht 3 — ZUKUNFT: was man vielleicht noch will

14 Vorschläge. Nichts davon ist kaputt. Es sind Dinge, die niemand vermisst, bis er sie einmal
gesehen hat — und ein paar, die aus dem Test selbst entstanden sind, weil die Prüfer über ihr
Fehlen gestolpert sind.

---

## Für die Leute, die die Karte benutzen

### Z1 · Eine Legende
In der ganzen Anwendung gibt es **keine einzige**. Am schmerzlichsten in der politischen Ansicht:
Farben, Schraffuren und Randstärken tragen Bedeutung, und nichts erklärt sie. Wer die Karte zum
ersten Mal in dieser Ansicht sieht, sieht Muster ohne Schlüssel.

Dasselbe gilt für die Klimazonen: im Ausschnitt sieht man **Farbe ohne Namen** — man erkennt,
dass da etwas ist, aber nicht was.

*Der teuerste Vorschlag dieser Liste und vermutlich der wertvollste.*

### Z2 · Ein Entwurfszustand
Mit dem ersten Speichern ist alles öffentlich. Es gibt keinen Zustand „ich arbeite noch daran".
Für ein Projekt, das aus Community-Beiträgen wächst, wäre das ein spürbarer Unterschied — und
es würde nebenbei mehrere AKUT-Befunde entschärfen (eine falsch angenommene Meldung wäre nicht
sofort für alle sichtbar).

### Z3 · Ein Rückkanal zum Melder
Das Meldeformular fragt **nie** nach einer Adresse. Wer etwas meldet, erfährt nie, was daraus
wurde — und die Redaktion kann nicht nachfragen, wenn eine Angabe unklar ist. Freiwillig,
optional, mit klarem Hinweis: das würde die Qualität der Meldungen mehr heben als jede
Formularverbesserung.

### Z4 · Der Zurück-Knopf des Browsers sollte die Reise nicht verwerfen
Er tut es, ohne dass sich die Adresse ändert — für den Benutzer sieht es aus wie ein Absturz.

### Z5 · Ein Suchtreffer sollte zeigen, was er getroffen hat
Ein Abenteuer oder ein Stadtplan aus der Suche landet beim zugehörigen **Ort**, ohne den
eigentlichen Treffer anzuzeigen. Man sucht ein Abenteuer, bekommt eine Stadt und muss selbst
herausfinden, warum.

### Z6 · „Hierher reisen" sollte den Ort benennen, nicht die Koordinate
Im Reiseplan steht dann eine rohe Kartenkoordinate. Ein „bei Gareth, 3 Meilen nordwestlich"
wäre für einen Spielleiter am Tisch brauchbar; `x: 512.4, y: 331.8` ist es nicht.

### Z7 · Eine Reichsstraße sollte ihre Länge nennen
Ein Fluss tut es bereits. Warum der Weg nicht?

### Z8 · Eine Etappe von 795 Meilen neben acht von 13 bis 57
Das ist keine falsche Rechnung, sondern eine unbrauchbare Aufteilung: eine Seefahrt am Stück
neben kleinteiligen Landetappen. Ein Vorschlag zum Nachdenken, keine Fehlermeldung.

---

## Für den Betrieb

### Z9 · Brotli statt gzip für den Kartenpayload
Nachgerechnet bringt Brotli **0,88 MB mehr** als gzip — das ist **4,5-mal so viel wie das
gesamte Aufräumen toter Payload-Felder** und kostet ungleich weniger Arbeit. Sinnvoll erst,
nachdem gzip überhaupt eingeschaltet ist (siehe Bericht 2).

### Z10 · `GET /api/locations/` braucht `limit`, `bbox` und `q`
Der Testlauf ist selbst darüber gestolpert: `?limit=25` wird angenommen und ignoriert, die
Antwort enthält immer alle 4.854 Objekte. Wer die stabile Schnittstelle benutzt, hat keine
Möglichkeit, weniger zu holen.

### Z11 · Ein Rückweg für Bilder in `uploads/`
Der Löschpfad kennt keinen. Ein gelöschtes Objekt lässt seine Datei liegen — unsichtbar, aber
dauerhaft und öffentlich abrufbar.

### Z12 · Ein eigener Melde- und Löschweg für Rechteinhaber
Die kleinste sinnvolle Ergänzung zur rechtlichen Lage: eine benannte Adresse und ein
beschriebener Weg, wie ein Rechteinhaber die Entfernung eines Inhalts erreichen kann. Für ein
Fanprojekt ist das kein Formalismus, sondern der Unterschied zwischen einer freundlichen Mail
und einer unfreundlichen.

### Z13 · Der Rechtstext existiert doppelt ohne Kopplung
Deutsch im Markup, Englisch in der i18n-Tabelle. Zwei Fassungen, die getrennt altern — und bei
einem Rechtstext ist genau das das Problem.

---

## Für die, die hier mitarbeiten

### Z14 · Der Wächter-Test-Gedanke, angewendet auf AGENTS.md selbst
`terrain-text-claims-test.php` bindet einen **Text** an das **Verhalten**, das er beschreibt:
ändert sich das eine ohne das andere, wird der Test rot. Genau dieses Muster fehlt AGENTS.md —
dessen falsche Zahlen (217 statt „~117" Skript-Tags, `maxZoom: 7` statt „0..5", 47 statt „~14"
Inline-DDL-Tabellen) wären von einem solchen Test am Tag ihres Entstehens gemeldet worden.

Ein kleiner Test, der die überprüfbaren Zahlen aus AGENTS.md nachzählt und vergleicht, wäre
vermutlich der wirksamste einzelne Beitrag zur Qualität der KI-Zusammenarbeit in diesem Projekt.

*Voraussetzung: dass Tests beim Deploy überhaupt laufen — siehe AKUT A26.*
