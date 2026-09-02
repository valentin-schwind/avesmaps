# Innerorts einfügen — ein Objekt gehört zu einer Stadt, nicht auf die Karte

**Stand:** 02.09.2026 · **Mockup:** `docs/innerorts-import-mockup.html`
**Anlass:** Owner, wörtlich: „ob wir gebäude, die innerorts in einer stadt liegen, ebenso falten
können wie wir das jetzt tun … dinge, die in die kategorie ‚gebäude' fallen, nicht räumlich
importieren und sie als innerorts taggen können, sodass sie bei uns gelistet aber nicht gleich auf
der karte platziert werden müssen" — und zur Bedienung: „ich hole und rechne und der importer sieht
‚ah das ist ein objekt, das könnte innerorts liegen' und bietet neben dem Button ‚Neu einfügen' die
alternative ein ‚Innerorts einfügen (Punin)'."

---

## 1 · Was es schon gibt

Avesmaps kennt das Innerorts-Objekt seit dem 27.07.2026, aber **nur aus Wiki Aventurica**.

- **Der Begriff** steht in `api/_internal/wiki/place-scope.php`: drei Werte, `inside` · `outside` ·
  `ambiguous`. Das Signal ist die Standortkette der Infobox (`|Standort= [[Gareth]]:
  [[Arenaviertel]]`) — nennt ein Glied eine Siedlung, **die wir schon auf der Karte haben**, liegt
  das Objekt darin. 🔴 Ein Nachschlagen gegen echte Daten, keine Namensregel: über Titel geht es
  nicht, „X von \<Stadt\>" trifft rund 2100 Artikel, überwiegend Personen und Belagerungen.
- **Die Anzeige** ist die Infobox-Zeile „N besondere Stätten verzeichnet"
  (`js/map-features/map-features-settlement-places.js`) — nach Art gruppiert, Gruppen klappen ab 25
  zu.
- **Die Liste** ist `in_settlement_places` in der Kartennutzlast.

💣 **Und die ist ABGELEITET, nicht gespeichert.** `avesmapsFetchInSettlementSearchRows`
(`api/_internal/app/in-settlement-search.php`) liest bei jedem Kartenabruf `wiki_sync_pages.standort`
(Bauwerke), `wiki_path_staging.lage_raw` (Wege) und die Sitze aus `organisation-sync.php`. Es gibt
**keine Tabelle** „Objekt ohne Kartenposition, gehört zu Stadt X" — es gibt nur drei Ableitungen aus
der Wiki-Aventurica-Registry.

Live gemessen 02.09.2026 aus der Kartennutzlast:

| | |
|---|---|
| Einträge in `in_settlement_places` | **3561** |
| verteilt auf | **383 Städte** |
| Median je Stadt · p90 · Maximum | 2 · 21 · **Gareth 383** |
| Städte mit genau einem Eintrag | 150 |
| verschiedene Arten | 383 (Tempel 593, Gasthaus 156, Taverne 127, Festung 95 …) |

---

## 2 · Das Kriterium — drei Kandidaten sind gemessen ausgeschieden

Die eigentliche Frage des Owners war: **welches Kriterium wenden wir an?** Vier Kandidaten, alle am
Livebestand geprüft.

### (a) „Keine Koordinate" — NEIN

Der Export markiert 359 Zeilen mit `2000000 2000000` („noch nicht auf der Karte"), und
`avesmapsGaretienUeberspringGrund` überspringt sie.

🚩 **Sie stammen ALLE aus dem Kosch-Wiki**, 358 davon von einer einzigen Seite
(`kosch/Ortschaften_1`), eine von `kosch/Wege`. Aus garetien.de: **null**. Das ist VolkoVs
Verortungs-Rückstand, keine Aussage über innerorts. Wer die Marke als Innerorts-Signal liest,
importiert einen Arbeitsstand als Sachaussage.

### (b) Die Standortkette des Artikels — NEIN, es gibt sie nicht

Die Hausregel `avesmapsPlaceScopeDecide` ist rein und getestet und würde sich sofort füttern lassen
— aber garetien.de liefert das Feld nicht. Zehn echte Bauwerksartikel aus dem Export geprüft
(Tempel, Kloster, Gebäude, Akademie, Burg): **10 von 10 ohne Standort-Feld**. Die Lage steht im
Fließtext:

> „**liegt** am Schattenbachpass und ist ein Wachturm mit Signalfeuer." (Turm Dohlentrutz)
> „**steht** auf dem Platz der Sonne, direkt gegenüber der Neuen Residenz." (Praiostempel Scraan)

Der zweite Satz ist ein Innerorts-Satz und der erste nicht — aber das aus Fließtext zu entscheiden
ist Textverstehen, nicht ein Nachschlagen. Ausgeschieden.

### (c) Abstand allein — NEIN, die Gegenprobe widerlegt es

Für jedes ggp-Bauwerk mit Position der Abstand zur nächsten Ortschaft, **und dieselbe Messung für
die Ortschaften des Exports als Kontrollgruppe**:

| | unter 1 Meile | Median |
|---|---|---|
| Bauwerke (1048) | 4,5 % | 12,4 Meilen |
| **Ortschaften (957), Kontrolle** | **4,5 %** | 14,3 Meilen |

Identisch. Ein Dorf 800 Schritt neben einer Stadt ist ein Nachbardorf. ⚠️ **Ohne die Kontrollgruppe
hätte die Zahl „4,5 % liegen dicht an einer Stadt" wie ein Befund ausgesehen** — sie ist keiner.

### (d) 🔴 Abstand UND Name — DAS Kriterium

| ggp-Bauwerke | in Reichweite | Ortsname steckt im Namen |
|---|---|---|
| unter 0,5 Meilen | 27 | **11 (40,7 %)** |
| unter 1,0 Meilen | 72 | 16 (22,2 %) |
| **über 5 Meilen** | 698 | **4 (0,6 %)** |

68-fache Anreicherung gegenüber dem Hintergrund. Das Signal ist echt.

**Der Name wird gefaltet, nicht verglichen:** Kleinschreibung, Umlaute auf ihren Grundbuchstaben,
alles Nicht-Buchstabige weg, und der Ortsname verliert ein Schluss-`e` — so trifft `Wandleth` auch
„**Wandleth**er Baumeisterzunft". Dieselbe Faltungsidee wie `avesmapsStaettenSchluessel`.

### 💣 Und der wichtigste Befund: die Menge ist klein

Von 1048 ggp-Bauwerken liegen **27** näher als eine halbe Meile an einer Ortschaft; der Median ist
12,4 Meilen. **VolkoV verortet seine Bauwerke.** Es sind Burgen, Klöster und Wachtürme im Land —
echte Außerorts-Objekte. Das gemeldete Muster gibt es (Wandleth trägt Armbrustmanufaktur, Brauerei,
Baumeisterzunft und Rondra-Tempel im Umkreis von 0,2 Meilen), aber es ist ein Dutzend Fälle, kein
Hunderter.

⭐ **Das ist die Rechtfertigung für „Angebot statt Automatik".** Bei einem Dutzend Fällen kostet ein
Fehlgriff wenig, und der Editor sieht den Ortsnamen im Knopf.

---

## 3 · Der Speicher — die eigentliche Entscheidung

Ein innerorts eingefügtes Objekt hat **keine Kartenposition** und kann deshalb nicht in
`map_features`: dort ist die Geometrie Pflicht, und alles darunter zeichnet sie.

`in_settlement_places` wäre der richtige Platz, ist aber eine **Ableitung** aus der
Wiki-Aventurica-Registry. 💣 Ein garetien-Objekt nach `wiki_sync_pages` zu schreiben verbietet der
Abbau-Vertrag des Importers (`docs/…/garetien-importer-abbau`): kein Modul ausserhalb von
`api/_internal/import/` darf seine Tabellen kennen — und umgekehrt darf er sich nicht in fremde
setzen.

🔴 **Also eine eigene, kleine Tabelle — und sie gehört NICHT dem Importer.**

```sql
CREATE TABLE IF NOT EXISTS settlement_place (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    public_id     CHAR(36)     NOT NULL,          -- wie jedes Kartenobjekt
    name          VARCHAR(190) NOT NULL,
    place_type    VARCHAR(80)  NULL,              -- „Tempel", „Gasthaus" -- das Vokabular des Wikis
    settlement_public_id VARCHAR(64) NOT NULL,    -- der ORT, nicht sein Name
    settlement_name      VARCHAR(190) NOT NULL,   -- der Name zum Zeitpunkt der Aufnahme
    wiki_url      VARCHAR(500) NULL,
    origin        VARCHAR(20)  NOT NULL,          -- 'garetien' | 'manual' | …
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_by    INT          NULL,
    created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_settlement_place (settlement_public_id, name),
    KEY idx_settlement (settlement_public_id, is_active)
);
```

💣 **Die Bindung ist die `public_id` des Ortes, nicht sein Name.** `in_settlement_places` reist heute
mit dem NAMEN der Stadt und der Index im Browser fällt Namen aufeinander
(`avesmapsStaettenSchluessel`) — das ist für eine Ableitung aus dem Wiki richtig, weil es dort keine
id gibt. Ein gespeichertes Objekt darf sich darauf nicht verlassen: eine umbenannte Stadt verlöre
sonst alle ihre Stätten, lautlos. ⚠️ Der Name reist trotzdem mit — er ist die Anzeige und der
Schlüssel, unter dem der bestehende Index sie einsortiert.

🔴 **`is_active` statt `DELETE`**, wie überall im Haus: eine Rücknahme muss umkehrbar sein.

**Der Leser bekommt einen zweiten Erzeuger.** `avesmapsFetchInSettlementSearchRows` liest heute drei
Quellen; die vierte ist diese Tabelle. ⚠️ Sie liefert Zeilen in **derselben Form** wie die drei
anderen (`title`, `raw`/Ort, `type_label`, `wiki_url`) — genau so, wie die Organisationssitze schon
heute dazukommen, ohne dass der reine Teil einen Sonderfall braucht.

💣 **Und der Kartenstempel.** Die Nutzlast hängt am ETag über `map_revision`, und eine neue Zeile in
`settlement_place` bewegt kein Kartenobjekt. Ohne einen eigenen Stempel bekäme jeder warme Browser
sein 304 und sähe die neue Stätte nie — dieselbe Falle, die Klimazonen, Tempowerte und der
Wappen-Notaus schon bezahlt haben. Also `avesmapsSettlementPlaceReadStamp()` in den Seed des ETags,
wie `avesmapsClimateReadStamp()`.

---

## 4 · Die Bedienung

Im Kasten „Eingefügt wird" steht neben **„Neu einfügen"** ein zweiter Knopf:

> **Innerorts einfügen (Wandleth)**

🔴 **Er erscheint nur, wenn beide Signale zusammentreffen** — unter `AVESMAPS_GARETIEN_INNERORTS_MEILEN`
(0,5) *und* der Ortsname steckt im Objektnamen. Sonst steht er gar nicht da; ein dauerhaft
ausgegrauter Knopf behauptet eine Möglichkeit, die es nicht gibt (dieselbe Owner-Regel wie bei
„Zurücknehmen", 30.08.2026).

⚠️ **Der Ortsname steht IM Knopf**, nicht im Hilfetext: der Editor entscheidet nicht „innerorts
ja/nein", sondern „innerorts **in Wandleth**" — und wenn der Ort falsch ist, sieht er es, bevor er
drückt.

🔴 **Die Zielwahl bleibt unberührt.** Die zwei Auswahlfelder (Form/Art) beschreiben, was auf der
Karte entstünde; ein innerorts eingefügtes Objekt entsteht dort nicht. Der Kasten darunter wird
deshalb beim Überfahren des Knopfes **abgeblendet**, statt zu verschwinden — verschwände er, spränge
die Spalte, und der Editor verlöre den Bezug.

**Danach:** das Objekt steht in der Infobox seines Ortes unter „N besondere Stätten verzeichnet",
in der Kartensuche mit „… in Wandleth · nicht auf der Karte", und im Importer als
**„Übernommen · innerorts"**.

⚠️ **Die Rücknahme muss es auch geben**, und sie ist einfacher als die gewöhnliche: kein
Kartenobjekt wurde angelegt, also genügt `is_active = 0` plus der dauerhafte Vermerk.

---

## 5 · Was NICHT gebaut wird

🔴 **Keine Automatik.** Der Importer schlägt vor, er entscheidet nicht. 27 Kandidaten bei 8348
Zeilen rechtfertigen keinen stillen Pfad, und ein falsch einsortiertes Objekt ist von aussen nicht
von einem fehlenden zu unterscheiden.

🔴 **Keine Textanalyse.** „liegt am Schattenbachpass" gegen „steht auf dem Platz der Sonne" zu
unterscheiden ist Textverstehen; wir haben ein Nachschlagen und bleiben dabei.

🔴 **Keine zweite Faltung.** Die Anzeige ist die vorhandene Stätten-Zeile mit ihren Lore-Klassen.
Eine dritte Rezeptur für „Liste von Namen in einer Infobox-Klappzeile" ist genau die Divergenz, vor
der AGENTS.md §11 warnt.

⚠️ **Der Kosch-Rückstand bleibt übersprungen.** Die 359 Zeilen ohne Position sind kein
Innerorts-Fall, und sie ohne Ort einzusortieren hiesse, sie unter einer geratenen Stadt abzulegen.

---

## 6 · Offene Punkte

🔧 **Die Schwelle 0,5 Meilen ist gemessen, aber an 27 Fällen.** Sie trennt heute sauber (11 mit
Namenstreffer gegen 0,6 % Hintergrund); ob sie bei einem gewachsenen Export noch trennt, wird man
neu messen müssen.

🔧 **Ein Objekt, das später doch verortet wird**, hätte dann zwei Existenzen — die Stätte und den
Kartenpunkt. Der Importer müsste das beim nächsten Lauf erkennen. Für Stufe 1 nicht gebaut; die
Menge ist klein genug, dass ein Editor es von Hand auflöst.

🔧 **Andere Quellen als der Importer.** `origin` ist von Anfang an dabei, damit später ein Editor
eine Stätte von Hand anlegen kann — gebaut wird dafür in Stufe 1 nichts.
