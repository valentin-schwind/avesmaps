# Bekannte Quellen — eine Quelle je Briefspiel, die Seite an der Verknüpfung

**Entwurf, 01.09.2026.** Mockup: `docs/bekannte-quellen-mockup.html`
Anlass: Owner-Frage — „ich bräuchte Ideen, wie ich die Briefspieler dazu bringen kann, genaue
Links zu hinterlegen und konsistente Bezeichner für ihre Quellen zu wählen."

---

## 1 · Der Befund

Der Quellenkatalog trägt zwei verschiedene Dinge, und sie haben gegenläufige Identitäten:

| | **Werk** (Geographia Aventurica) | **Belegseite** (`herzogtum-weiden.net/…/adlerflug`) |
|---|---|---|
| Identität ist | der **Titel** | die **Adresse** |
| zitiert von | Median 6, bis 1.549 Objekten | genau **einem** |
| die Adresse ist | Beiwerk (Shop-Link) | die Sache selbst |
| der Titel ist | die Sache selbst | Beiwerk — und wird 200× wiederholt |

Live gemessen am 01.09.2026 (eine Anfrage an `map-features.php`):

- **455 externe Katalogzeilen, davon 90 % an genau EINEM Objekt.** Über alle Quellen: 34 %.
- **49 Titel tragen mehr als eine Katalogzeile**, zusammen **478 Zeilen**. Davon heißen
  **219 wörtlich „Briefspiel"**, 81 „AlmadaWiki", 52 „Albernisches Briefspiel".
- **35 Katalogzeilen haben gar keinen Titel** und zeigen ihre nackte Adresse.

Je Domain:

| Domain | Katalogzeilen | verschiedene Titel | Objekte | Typen |
|---|---|---|---|---|
| herzogtum-weiden.net | **200** | 4 | 286 | 190 × `sonstiges`, 10 × `briefspiel` |
| wiki.punin.de | 115 | 6 | 158 | 86 × `sonstiges`, 29 × `briefspiel` |
| westlande.de | 77 | 5 | 87 | 39 × `sonstiges`, 38 × `briefspiel` |
| kahet-ni-kemi.de | 16 | 2 | 20 | 16 × `briefspiel` |
| garetien.de | 8 | 4 | 8 | 7 × `sonstiges`, 1 × `briefspiel` |
| liebliches-feld.net | 2 | 1 | 33 | gemischt |
| orkenspalter.de / horaswiki.de / wiki.horaswiki.de | 7 | 5 | 7 | gemischt |

🚩 **Auch der TYP ist inkonsistent, nicht nur der Name.** 95 % der Weiden-Zeilen stehen auf
`sonstiges`, obwohl alle 200 dasselbe Briefspiel sind. Wer nur die Namen vereinheitlicht, hat die
halbe Arbeit gemacht.

🚩 **Ein Diakritikum spaltet ein Korpus:** „Briefspiel Káhet Ni Kemi" (9 Zeilen) gegen
„Briefspiel Kâhet Ni Kemi" (7). Bei 9:7 ist nicht einmal klar, welches gewinnen sollte.

🚩 **Ein Titel ist eine URL:** `https://www.garetien.de/index.php?title=Garetien:Dorf_Sellach`
steht als Quellenname im Katalog.

---

## 2 · Die Ursache

Ein Kommentar in `api/_internal/import/garetien-uebernahme.php` beschreibt das Ziel bereits richtig:

> „die Beschriftung nennt das **Briefspiel**, die Adresse den **Artikel**"

⚠️ Das ist **kein Beleg, sondern eine Beobachtung**: der Kommentar stammt selbst aus einem
Agenten-Commit (`a95bed8fc`, Co-Authored-By: Claude), wie fast alle deutschen Kommentare hier. „Das
Haus macht es so" trägt als Argument nur, solange es auf eine Entscheidung des Owners oder auf eine
Messung zurückgeht — nicht auf früheren Agententext. Was hier trägt, sind die Zahlen aus §1.

Der Satz beschreibt das Ziel dennoch genau. Nur liegt die Artikeladresse in `sources.url` — und `url_hash` **IST** die
Identität der Katalogzeile (UNIQUE). Aus einem Briefspiel mit 200 Artikeln werden damit nicht
*eine* Quelle mit 200 Fundstellen, sondern **200 Quellen**, die alle denselben Namen tragen wollen.

💣 **Das Modell zwingt den Editor zu einer Wahl zwischen zwei Fehlern**, und beide sind live zu
sehen:

- **Präziser Link, unbrauchbarer Name:** 200 Zeilen „Briefspiel" für Weiden. Der Link stimmt, die
  Auswahlliste ist unbenutzbar.
- **Brauchbarer Name, falscher Link:** `liebliches-feld.net` hat EINE Zeile „Briefspiel Liebliches
  Feld" mit **32 Objekten** — und ihre Adresse zeigt auf `wiki/Datei:Ponterra_detail`, eine
  beliebige Bildseite. Der Name stimmt, der Link ist für 31 der 32 Objekte falsch.

🔴 **Die Autocomplete-Mehrdeutigkeit ist deshalb kein Bedienfehler.** Sie ist die direkte Folge des
Modells: wer eine brauchbare Bezeichnung will, MUSS eine neue Zeile anlegen, weil die vorhandene
die falsche Adresse trägt.

---

## 3 · Der Vorschlag

```
sources          = das Briefspiel / das Fanwiki    (EINE Zeile: Name, Typ, Lizenz, Nennung, Kanon)
feature_sources  = welches Objekt + pages + ref_url   ← neu: die Fundstelle
```

⭐ **Das ist keine neue Idee, sondern die vorhandene Analogie.** Beim Buch schreibt man „S. 112",
beim Wiki die Seite. `pages` und `ref_url` beantworten dieselbe Frage: *wo genau in dieser Quelle*.
Eine selbstheilende Spalte am selben Ort, an dem `pages` und `note` schon stehen.

**Wirkung:** 425 Katalogzeilen → **9** (eine je Domain), 599 Verknüpfungen bleiben unverändert.
Die Mehrdeutigkeit verschwindet **von selbst** — es gibt nur noch eine Zeile zum Auswählen.
Lizenz und Namensnennung stehen einmal statt 200-mal (die Lehre aus dem Lore-Rückbau, AGENTS.md §5).

### 3.1 Das Register

Eine Zuordnung **Domain → Quelle**, plus was die Domain festlegt:

| Feld | Beispiel |
|---|---|
| `host` | `herzogtum-weiden.net` |
| `label` | Briefspiel (Weiden) |
| `source_type` | `briefspiel` |
| `is_official` | nein |
| `license` / `attribution` | (wie heute an der Quelle) |

🔴 **Neun Domains decken 425 von 455 externen Zeilen.** Der Rest bleibt der freie Weg.

### 3.2 Was der Editor noch tut

Er fügt eine Adresse ein. Ist ihre Domain bekannt:

- Name, Typ, Kanon, Lizenz und Namensnennung werden **gesetzt und gesperrt** — er wählt gar
  keinen Namen mehr, kann also keinen falschen treffen und hat keinen Grund, einen neuen anzulegen.
- Die Adresse wandert in **Fundstelle**.
- Übrig bleibt genau ein Feld, das er füllt: die Fundstelle. **Damit ist der präzise Link nicht
  mehr die Kür, sondern das Einzige, wonach das Formular fragt.**

⭐ **Die Bauform existiert schon:** `avesmapsResolvePublicationIdentityFromUrl` macht genau das für
Wiki-Publikationen — eine Adresse wird zur bekannten Identität aufgelöst. Dies ist dieselbe Weiche
für den anderen Fall, kein zweites System.

Bei einer **unbekannten** Domain bleibt alles wie heute, mit einer Rückfrage: „Ist das ein neues Briefspiel
oder Wiki? Dann trag es einmal als Quelle ein — danach genügt der Link." So wächst das Register
durch Benutzung, statt gepflegt werden zu müssen.

---

## 4 · Die Fallen

💣 **`de.wiki-aventurica.de` GEHÖRT NICHT INS REGISTER.** 21 Zeilen, 19 verschiedene Titel — und
das sind **Werke**, keine Belegseiten: „Mutterglück", „Das Erbe von Blaustein", „Kosch
(Regionalspielhilfe)", fünf davon offiziell. Ihre Adresse ist zufällig ein Wikiartikel, aber die
Identität ist der Titel. Sie zusammenzulegen zerstörte 19 Werke zu einer Zeile. ⚠️ Die Regel ist
also **nicht** „eine Domain, eine Quelle", sondern „eine Domain, deren Seiten BELEGSTELLEN sind" — und
das entscheidet ein Mensch je Domain, nicht ein Muster.

💣 **Die Domain allein reicht als Schlüssel nicht ewig.** `horaswiki.de` und `wiki.horaswiki.de`
stehen heute als zwei Domains da, sind aber dasselbe Angebot. Das Register muss mehrere Domains auf
dieselbe Quelle zeigen lassen dürfen — sonst entsteht die Doppelung neu, nur eine Ebene höher.

💣 **`is_official` überschreibt der Upsert UNBEDINGT.** Setzt das Register den Kanon, muss es ihn
auch beim Verknüpfen einer bestehenden Zeile setzen — sonst kippt der erste Editor, der den Haken
nicht sieht, den Kanon des ganzen Korpus. Seit dem 01.09.2026 wird das wenigstens gemeldet
(`linked.official_changed`), geheilt ist es nicht.

💣 **Die Fundstelle ist eine ADRESSE, kein Text.** Sie gehört nicht in `pages` — das rendert als
„S. https://…". Eigene Spalte, eigene Prüfung (nur `http(s)`, wie im Bearbeiten-Kasten seit
01.09.2026), und im Markup ein echter Link.

⚠️ **Der Titel-Link zeigt künftig auf die Fundstelle, nicht auf die Quelle.** Ein Leser, der auf
„Briefspiel (Weiden)" klickt, will die Seite über *dieses* Objekt, nicht die Startseite. Die
Quell-Adresse steht dann hinter dem ⓘ — dort, wo seit dem 01.09.2026 auch Nennung und Lizenz
stehen.

⚠️ **35 Zeilen haben keinen Titel.** Sie fallen beim Zusammenlegen von selbst weg, aber solange
sie stehen, zeigen sie ihre nackte Adresse. Kein eigener Schritt, nur ein Hinweis darauf, dass die
Zahl „20 verschiedene Titel" die leeren nicht mitzählt.

🔴 **Der zweite Schritt ist der riskante.** Das Zusammenlegen fasst **416 Katalogzeilen** an. Es
gibt dafür `avesmapsMergeSourceInto` samt `source_merge_log` — es ist der einzige Schreibweg mit
Protokoll, und er ist genau dafür gebaut. Trotzdem: erst Register und Fundstelle live, damit alles
NEUE richtig entsteht; das Aufräumen danach, domainweise, mit Vorschau.

---

## 5 · Reihenfolge

1. **Fundstelle** (`feature_sources.ref_url`) + Feld in der Eingabezeile + Anzeige.
   Wirkt sofort, ändert nichts am Bestand.
2. **Register bekannter Quellen** — Auflösung beim Einfügen, gesperrte Felder, Rückmeldung.
   Ab hier entsteht nichts Falsches mehr.
3. **Zusammenlegen je Domain**, mit Vorschau und Protokoll. 416 Zeilen, neun Läufe.

🔧 **Offene Fragen für den Owner:**
- Wie heißen die neun Quellen? Vorschlag aus dem Bestand: *Briefspiel (Weiden)*, *AlmadaWiki*,
  *Albernisches Briefspiel*, *Briefspiel Káhet Ni Kemi*, *Greifenfurt-Briefspiel*, *Briefspiel
  Liebliches Feld*, *Horas-Wiki*, *Orkenspalter*. Bei Káhet/Kâhet steht 9:7 — hier entscheidest du.
- Soll das Register eine Tabelle sein oder eine Konstante im Code? Neun Zeilen, die sich selten
  ändern — eine Konstante wäre ehrlich; eine Tabelle erlaubt Editoren, sie selbst zu erweitern.
- Bleibt der freie Weg (eigener Name, eigene Adresse) für unbekannte Domains offen? Der Entwurf sagt
  ja — sonst kann niemand ein neues Briefspiel eintragen.
