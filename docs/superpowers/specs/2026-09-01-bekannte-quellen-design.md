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
| zitiert von | Median 14, bis 1.549 Objekten | genau **einem** |
| die Adresse ist | Beiwerk (Shop-Link) | die Sache selbst |
| der Titel ist | die Sache selbst | Beiwerk — und wird 26-mal wiederholt |

💣 **KORREKTUR MEINER EIGENEN MESSUNG (01.09.2026).** Die erste Fassung dieses Entwurfs nannte
durchweg um das **3,4-fache zu hohe** Zahlen. Die Kartennutzlast mischt zwei Dinge: echte
Katalogzeilen und `os:`-Einträge — das alte Einzelfeld `properties.other_source`, das der Server
nur **zur Anzeige** synthetisiert (`avesmapsReadFeatureSources`). Ich hatte beide gezählt. Wer aus
`map-features.php` Katalogzahlen zieht, muss `os:`-Kennungen ausschliessen.

Richtig ist: **1.374** echte Katalogzeilen, davon 1.240 zitiert. Median **14** Objekte je Zeile,
p95 171, Maximum 1.549. **17 %** hängen an genau einem Objekt (nicht 34 %).

Auf den Korpus-Domains:

| Domain | echte Zeilen | Titel | Objekte | `os:` wartend |
|---|---|---|---|---|
| herzogtum-weiden.net | 32 | 3 | 118 | **168** |
| wiki.punin.de | 33 | 5 | 76 | 82 |
| westlande.de | 39 | 4 | 49 | 38 |
| kahet-ni-kemi.de | 16 | 2 | 20 | 0 |
| garetien.de | 2 | 2 | 2 | 6 |
| liebliches-feld.net | 1 | 1 | 32 | 1 |
| **Summe** | **123** | **17** | **297** | **295** |

⚠️ **Der neue Befund steht in der letzten Spalte.** 295 `os:`-Einträge warten darauf,
Katalogzeilen zu werden — `avesmapsFeatureSourcesTakeoverOtherSource` wandelt einen davon um,
sobald ein Editor genau dieses Objekt öffnet. Bei Weiden allein 168. **Das Problem ist kleiner als
behauptet, aber es wächst**: jede dieser 295 wird eine weitere Zeile namens „Briefspiel".

Die Namensdopplung selbst, auf echten Zeilen: **187 Zeilen in 44 Titeln** — davon 26× „Briefspiel"
(Weiden), 27× „Albernisches Briefspiel", 24× „AlmadaWiki". Dazu 16 Zeilen ganz ohne Titel.

🚩 **Auch der TYP ist inkonsistent, nicht nur der Name.** Dieselbe Domain trägt `briefspiel` und
`sonstiges` nebeneinander. Wer nur die Namen vereinheitlicht, hat die halbe Arbeit gemacht.

🚩 **Ein Diakritikum spaltet ein Korpus:** „Briefspiel Káhet Ni Kemi" (9) gegen „Kâhet" (7). Bei
9:7 entscheidet nicht einmal die Mehrheit.

🚩 **Ein ANKER erzeugt eine zweite Zeile.** `?title=Gräflich_Abagund` und
`…#Siedlungen_im_Land` sind für `url_hash` zwei Quellen — dieselbe Seite, zweimal im Katalog.
Dasselbe gilt für `http`/`https`, `www.` und einen Schrägstrich am Ende.

🚩 **Vier Zeilen zeigen schon auf die STARTSEITE** (`wiki.punin.de/`) — sie sind faktisch
Korpus-Zeilen mit falschem Namen, und einige zeigen auf Bilddateien statt auf Artikel.

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

- **Präziser Link, unbrauchbarer Name:** 26 Zeilen „Briefspiel" für Weiden, dazu 5 ganz ohne Titel
  und 168 wartende `os:`-Einträge. Der Link stimmt, die Auswahlliste ist unbenutzbar.
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

**Wirkung:** 123 Katalogzeilen → **6** (eine je Domain), 297 Verknüpfungen bleiben unverändert —
und die 295 wartenden `os:`-Einträge landen gleich richtig, statt 295 neue Zeilen zu erzeugen.
Die Mehrdeutigkeit verschwindet **von selbst** — es gibt nur noch eine Zeile zum Auswählen.
Lizenz und Namensnennung stehen einmal statt 26-mal (die Lehre aus dem Lore-Rückbau, AGENTS.md §5).

### 3.1 Das Register

Eine Zuordnung **Domain → Quelle**, plus was die Domain festlegt:

| Feld | Beispiel |
|---|---|
| `host` | `herzogtum-weiden.net` |
| `label` | Briefspiel (Weiden) |
| `source_type` | `briefspiel` |
| `is_official` | nein |
| `license` / `attribution` | (wie heute an der Quelle) |

🔴 **Sechs Domains decken 123 von 132 externen Zeilen.** Der Rest bleibt der freie Weg.

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

### 3.3 Wie das Register lernt — die EINE zusätzliche Frage

🔴 **Das Register ist keine gepflegte Liste.** Es entsteht beim ersten Eintrag und heißt danach nie
wieder jemanden etwas fragen. Der Owner hat die Lücke gefunden (01.09.2026): *„ich komme aber mit
einer anderen Stadt — muss ich alles neu ausfüllen, und die Leute geben wieder einen anderen
Quellennamen an?"* Ohne Antwort darauf ist der ganze Entwurf wirkungslos.

**Erster Eintrag auf einer unbekannten Domain** — die Zeile ist die von heute, plus eine Frage:

> ☐ Aus **herzogtum-weiden.net** kommt noch mehr — beim nächsten Objekt genügt der Link.

- **Angehakt** → diese Quelle wird die Quelle der Domain. Jede spätere Adresse dort löst auf sie
  auf; der Editor füllt nur noch die Fundstelle.
- **Nicht angehakt** → wie heute. Das ist der Fall „ein Werk, das zufällig dort liegt" (ein
  Wiki-Aventurica-Artikel, eine einzelne PDF-Seite).

⚠️ **Die Frage stellt sich GENAU EINMAL je Domain.** Beim zweiten Ort auf derselben Domain gibt es
sie nicht mehr — dort ist der Name schon entschieden, und das ist der ganze Zweck.

💣 **Ohne das Häkchen darf die Auflösung NICHT automatisch sein.** `f-shop.de` trägt 637
Katalogzeilen mit 623 verschiedenen Titeln, `ulisses-ebooks.de` 245 mit 243 — dort ist jede Adresse
ein eigenes Werk. Eine Regel „eine Domain, eine Quelle" machte daraus 2 Quellen für 866 Werke.

⭐ **Das Verhältnis Zeilen/Titel trennt beide Fälle messbar** und taugt als *Vorschlag*, nie als
Entscheidung: f-shop 637/623 ≈ 1, herzogtum-weiden 200/3 ≈ 67. Beim ersten Eintrag auf einer
Domain, die schon viele gleichnamige Zeilen trägt, kann das Häkchen also vorgeschlagen werden —
angehakt wird es von einem Menschen.

⚠️ **Und es beantwortet die Frage „Tabelle oder Konstante" von selbst:** weder. Die Zuordnung ist
eine Spalte an der Quelle (die Domain, für die sie steht) plus die Möglichkeit, mehrere Domains
darauf zeigen zu lassen (`horaswiki.de` und `wiki.horaswiki.de`). Keine zweite Liste, die
auseinanderlaufen kann.

**Der Ablauf, den der Owner beschrieben hat:**

| | heute | nachher |
|---|---|---|
| Trallop eintragen | Adresse + Name + Art + Lizenz + Nennung + Haken | dasselbe, plus **ein Häkchen** |
| **Baliho** eintragen | **alles noch einmal** — und der Name wird „Baliho bei Weiden" | **nur die Adresse.** Name, Art, Lizenz, Nennung, Kanon stehen fest |


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

🔴 **Der zweite Schritt ist der riskante.** Das Zusammenlegen fasst **117 Katalogzeilen** an. Es
gibt dafür `avesmapsMergeSourceInto` samt `source_merge_log` — es ist der einzige Schreibweg mit
Protokoll, und er ist genau dafür gebaut. Trotzdem: erst Register und Fundstelle live, damit alles
NEUE richtig entsteht; das Aufräumen danach, domainweise, mit Vorschau.

---

## 5 · Reihenfolge

1. **Fundstelle** (`feature_sources.ref_url`) + Feld in der Eingabezeile + Anzeige.
   Wirkt sofort, ändert nichts am Bestand.
2. **Register bekannter Quellen** — Auflösung beim Einfügen, gesperrte Felder, Rückmeldung.
   Ab hier entsteht nichts Falsches mehr.
3. **Zusammenlegen je Domain**, mit Vorschau und Protokoll. 117 Zeilen, sechs Läufe.

### 5.1 Die Namensnennung macht ZWEI Jobs — und das ist ein eigener Befund

Owner, 01.09.2026: *„Namensnennung ist, wenn ein bestimmter Typ im Wiki uns was genehmigt hat."*

🔴 **Das ist `permission`, nicht `attribution`.** Der Kanon-Etikett-Entwurf vom 27.08.2026 (§4.4)
trennt beides bereits ausdrücklich:

| Spalte | Frage | Beispiel |
|---|---|---|
| `license` | Was gilt rechtlich? | CC BY-NC-SA 3.0 |
| `attribution` | **Wen muss man nennen?** | VolkoV / garetien.de |
| `permission` *(nie gebaut)* | **Wer hat es erlaubt, und wann?** | Freundeskreis …, 12.08.2026 |

Die dritte Spalte gibt es bis heute nicht — deshalb trägt `attribution` beides, und das sieht man
den drei Livewerten an: **„herzogtum-weiden.net"** (eine Domain), **„Jens: Meister"** (eine Person),
**„VolkoV / garetien.de"** (Person und Domain). Drei Werte, drei verschiedene Bedeutungen.

⚠️ **Für dieses Vorhaben ist die Frage: gilt die Erlaubnis dem KORPUS oder der SEITE?** „Ein
bestimmter Typ hat uns etwas genehmigt" klingt nach dem Korpus — eine Person gibt ihr Briefspiel
frei, nicht einzelne Artikel. Dann bleibt sie an der Quelle und dieser Entwurf trägt unverändert.
Gilt sie je Artikel, muss sie an die VERKNÜPFUNG, und dann ist sie das zweite Feld neben der
Fundstelle. 🔧 Das entscheidet der Owner; gemessen werden kann es nicht, weil es heute nur drei
Werte gibt.

🔧 **Offene Fragen für den Owner:**
- **Gilt die Erlaubnis dem Korpus oder der Seite?** (§5.1 — die wichtigste der drei)
- Wie heißen die sechs Quellen? Vorschlag aus dem Bestand: *Briefspiel (Weiden)*, *AlmadaWiki*,
  *Albernisches Briefspiel*, *Briefspiel Káhet Ni Kemi*, *Greifenfurt-Briefspiel*, *Briefspiel
  Liebliches Feld*, *Briefspiel Liebliches Feld*. Bei Káhet/Kâhet steht 9:7 — hier entscheidest du.
- ~~Register als Tabelle oder Konstante?~~ **Beantwortet von §3.3: weder.** Es ist eine Spalte an
  der Quelle, gesetzt durch ein Häkchen beim ersten Eintrag.
- Bleibt der freie Weg (eigener Name, eigene Adresse) für unbekannte Domains offen? Der Entwurf sagt
  ja — sonst kann niemand ein neues Briefspiel eintragen.
