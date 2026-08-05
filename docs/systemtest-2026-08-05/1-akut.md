# Bericht 1 — AKUT: was behoben werden muss

28 Befunde. 27 davon haben eine feindliche Gegenprüfung überstanden, deren Auftrag ausdrücklich
war, sie zu widerlegen; 20 weitere ursprünglich als AKUT gemeldete wurden dabei abgestuft,
2 widerlegt, 4 als Doppelungen erkannt — die stehen hier nicht mehr.

Der 28. Befund (A28) kam erst beim Nachzählen der eigenen Testspuren dazu. Er ist damit der
einzige, den nicht das Prüfen, sondern das **Aufräumen** gefunden hat — und ein Beleg dafür,
dass sich der Aufräumteil dieses Tests gelohnt hat.

**Nachtrag vom Abend des 05.08.: sieben weitere (A29–A35), gefunden beim feindlichen Gegenprüfen
der A1–A4-Reparaturen** — siehe Abschnitt 9. Alle drei sind älter als diese Reparaturen und hatte
keiner der zwölf Prüfagenten. Das ist der zweite Beleg für dasselbe: das Prüfen der Fixes findet
mehr als das Prüfen des Bestands.

Die Reihenfolge ist eine Empfehlung: oben steht, was Inhalt verliert oder Daten falsch macht;
unten, was ärgerlich, aber folgenlos ist.

---

## 1. Eine Community-Meldung kann verlorengehen, ohne dass es jemand merkt

Das ist der schwerwiegendste Zusammenhang des ganzen Tests, weil er **gezielt den guten
Mitwirkenden trifft** und von keiner Seite aus sichtbar ist — weder für den, der meldet, noch
für den, der die Meldungen bearbeitet.

### ✅ A1 · Eine verworfene Meldung wird dem Menschen als Erfolg gemeldet
`api/app/report-location.php:83` und `:98` gegen `:184`

> **✅ Erledigt `c6ceb981` (+ `a07348ef`), 05.08.2026.**
> **Owner-Entscheid zur Produktfrage: Bot still, Mensch ehrlich.** Die drei Bot-Fallen antworten
> jetzt zeichen- **und** codegleich wie ein gespeicherter Bericht; die zwei Absagen, in die ein
> Mensch läuft, bekommen eine echte Fehlerantwort. Live gemessen, **ohne eine einzige
> hinterlassene Zeile** (alle fünf Wege kehren vor dem `INSERT` um):
>
> | Probe | vorher | jetzt |
> |---|---|---|
> | Honigtopf gefüllt | `200` + Erfolgstext | **`201`** + zeichengleicher Erfolgstext |
> | unter 3 Sekunden abgeschickt | `200` + Erfolgstext | **`201`** |
> | Spamwort | `200` + Erfolgstext | **`201`** |
> | Kommentar ist nur ein Link | `200` + Erfolgstext | **`400`** „Bitte zur Meldung noch einen Satz schreiben, nicht nur einen Link." |
> | bestehender Ortsname (Gesundheitsprobe) | `409` | **`409`** unverändert |
>
> Der Client brauchte keine Zeile: `apiErrorMessage` versteht die kanonische Hülle schon, und
> `finalizeLocationReportSubmission` leert das Formular nur bei `ok:true` — eine ehrliche Absage
> behält also den getippten Text. Das war die zweite Hälfte des Befunds.
>
> 💣 **Die Annahme-Antwort hat jetzt genau einen Erzeuger** (`avesmapsReportAcceptedResponse`),
> und der Test prüft, dass der Endpunkt weder eine eigene Kopie des Satzes noch überhaupt noch
> eine 200-Antwort enthält. Genau so war die Divergenz entstanden: zwei handgebaute Antworten,
> die gleich aussahen und es nicht waren.
>
> ⚠️ **Nicht live gemessen: die 429-Antwort an der Stundengrenze.** Sie zu erreichen setzt einen
> vollen Eimer voraus, und das kostet fünf unlöschbare Zeilen (A3). Bewacht ist sie vom Test.
>
> **Die Nachbesserung `a07348ef` ebenfalls live geprüft.** Der erste Wurf hatte die 400 **hinter**
> die Spamwörter gelegt und damit ein Orakel gebaut: ein nackter Link antwortete `400`, derselbe
> Link mit Spamwort `201` — beides ohne Zeile und ohne den Eimer zu berühren, also ein
> Gratis-Prüfstand für Spam-Nutzlasten. Nach dem Tausch der Reihenfolge antworten beide Proben
> **zeichengleich `400`**.
>
> Und der Weg von Ende zu Ende, im Browser auf avesmaps.de nachgestellt: Infopanel eines Weges →
> „Änderungen vorschlagen" (Kategorie gesperrt, `data-lock-reason="context"`) → nur ein Link in
> „Was soll geändert werden?" → **Fenster bleibt offen, Satz steht da, getippter Text erhalten,
> Namensfeld wieder bedienbar, Kategorie weiterhin gesperrt.** Ohne die Nachbesserung wäre sie an
> dieser Stelle wieder frei gewesen — und ein Weg-Vorschlag ließe sich als Ort abschicken.
>
> ⚠️ **Was der Umbau NICHT schließt, und was die Fassung vom ersten Wurf zu Unrecht behauptete:**
> ein Bot lernt nichts mehr **aus dem Statuscode** — blind ist er nicht. Die 409-Antwort auf einen
> bestehenden Namen steht **vor** den Filtern, also verrät eine einzige Anfrage mit einem Namen,
> den es gibt, ob gefiltert wurde (`201`) oder nicht (`409`) — ohne Zeile und ohne den Eimer zu
> berühren. Und der stille Weg kehrt vor der Datenbankverbindung um, antwortet also um
> Größenordnungen schneller. Beides ist älter als dieser Fix; die Zusicherung im Code ist
> entsprechend zurückgenommen (`a07348ef`).

Honigtopf, Spamwort, „zu schnell" und die Stundengrenze antworten alle mit
`{"ok":true,"message":"Karteneintrag wurde gemeldet."}` — **wortgleich** mit dem echten Erfolg.
Der einzige Unterschied ist der Statuscode: **200 = weggeworfen, 201 = gespeichert**. Der Client
wertet ihn nicht aus, zeigt einen grünen Hinweis und leert das Formular.

Damit ist es genau verkehrt herum: Ein **Mensch** liest „ist angekommen", freut sich und hat
nichts mehr in der Hand. Ein **Bot** liest den Statuscode und weiß nach einem Versuch, welcher
seiner Tricks funktioniert hat. Beim Kontaktformular unterscheiden sich sogar die Sätze.

*Beleg:* über die echte Oberfläche reproduziert (vollständiges Formular, grüner Hinweis, keine
Zeile in der Datenbank) und im Code nachgelesen. *Aufwand:* klein.

### ✅ A2 · Die Stundengrenze zählt Änderungsvorschläge mit
`api/app/report-location.php:97`

> **✅ Erledigt `776c2b89` (+ `a07348ef`), 05.08.2026.** Die Zählabfrage hat jetzt
> `AND report_mode <> 'change'` — die Ausnahme steht in **beiden** Hälften statt nur in der
> Prüfung. Live-Ausfallprobe mit **einer** echten Meldung: **`201`**, die geänderte Abfrage läuft
> also auf MySQL (bei einem Syntaxfehler bekäme jeder Melder gerade einen 500). Die Zeile steht im
> [Spurenbuch](befunde/SPURENBUCH.md).
>
> ⚠️ **Die Zählsemantik selbst ist nicht live gemessen.** Sie zu belegen kostet sechs unlöschbare
> Zeilen: fünf Änderungsvorschläge, die den Eimer füllen müssten und es nicht mehr tun, plus die
> sechste Meldung, die durchgeht. Nachzuholen, sobald A3 einen Weg zurück gibt.
>
> 💣 **Der Test dazu war zwei Commits lang wertlos, und das ist die Lehre.** Er prüfte, dass die
> Bedingung in einer **Bibliotheks-Zeichenkette** steht — nichts prüfte, dass der Endpunkt diese
> Zeichenkette benutzt. Ein Gegenprüfer hat die alte Abfrage wieder in die Aufrufstelle geklebt,
> den Fehler damit Byte für Byte wiederhergestellt, und der Test lief grün durch. Behoben in
> `a07348ef`, die Mutation bricht jetzt mit Exit 255 ab. **Eine Zusicherung über eine Zeichenkette
> beweist nichts, solange nichts zusichert, dass die Zeichenkette verwendet wird.**
>
> ⚠️ **Und die Grenze selbst ist umgehbar** — siehe A29 unten. A2 repariert, was sie zählt; A29
> sagt, dass ihr Schlüssel vom Gezählten selbst bestimmt wird.

Fünf Meldungen je IP und Stunde. Änderungsvorschläge werden von der Grenze zwar **nicht
blockiert**, zählen aber **auf das Kontingent an**. Wer fünf Korrekturen schickt, kann in
derselben Stunde keinen neuen Ort mehr melden — und erfährt es wegen A1 nicht.

*Beleg:* reproduziert, die sechste Meldung verschwand. *Aufwand:* klein.

### ✅ A3 · Eine bearbeitete Meldung ist danach unauffindbar
`api/edit/reports/locations.php`

> **✅ Erledigt `7a6be1a8` (+ Hotfix `4202973b`), 05.08.2026.** `GET` nimmt jetzt
> `?status=neu|erledigt|alle`; Vorgabe bleibt `neu`, damit sich für jeden bestehenden Aufrufer
> nichts ändert. Im Panel derselbe Filter-Trichter wie in den WikiSync-Listen. Eine bearbeitete
> Meldung wird **schreibgeschützt** gezeigt: Entscheidung, wer, wann, Begründung.
>
> Die beiden Listen lesen sich absichtlich verschieden — offene als Arbeitsschlange (älteste
> zuerst), bearbeitete als Verlauf (neueste zuerst, über `COALESCE(reviewed_at, created_at)`).
> „Alle" ist genau diese zwei Hälften, gebaut durch **zweimaligen Aufruf derselben Funktion**
> statt durch eine Abfrage mit trickreichem `ORDER BY`: eine Sortierung kann nicht beides sein.
>
> ⚠️ **Der Deckel bei 200 wird ausgesprochen** (`truncated`/`limit` in der Antwort, Satz im Panel).
> Die offene Schlange wird **nie** gekürzt.
>
> 💣 **Der Weg dahin kostete einen zweiten selbstverschuldeten Ausfall an einem Tag** — diesmal im
> Client. Die schreibgeschützte Umwandlung leerte den Knopfkasten **mitten im Bauen** des Eintrags,
> und zwei spätere Zeilen beschrifteten genau diesen Knopf noch (Fundort „Ergänzen", Änderung
> „Bearbeiten"). `querySelector(...).textContent` auf einem entfernten Knoten = `TypeError` mitten
> in der Schleife: die „Bearbeitet"-Liste brach beim ersten solchen Eintrag ab **und sah dabei
> vollständig aus**; im 45-Sekunden-Takt schluckte der `catch` denselben Absturz wortlos. Behoben
> in `4202973b` mit zwei Änderungen, weil es zwei Fehler sind: die Umwandlung läuft **zuletzt**,
> und die Beschriftung geht ausschließlich über einen Helfer, der auf `null` prüft. **Die
> Reihenfolge allein hätte dieselbe Falle für den nächsten Meldungstyp stehen lassen.**
>
> **Live gegengeprüft, soweit ohne Anmeldung möglich.** Der Endpunkt antwortet auf alle vier Formen
> (`ohne`, `?status=erledigt`, `?status=alle`, `?status[]=boom`) mit einem sauberen **`401`** und
> korrekter Hülle — kein `500`, keine PHP-Warnung vor dem JSON. Und das Rendern gegen den
> **ausgelieferten** Client, mit untergeschobenen Daten auf avesmaps.de: drei Meldungen, darunter
> genau die zwei Arten, an denen die Liste vorher zerbrach (angenommener Fundort, verworfener
> Änderungsvorschlag) → **kein Absturz, 3 von 3 Einträgen gerendert**; die beiden bearbeiteten ohne
> Knopf, mit „Angenommen von … · 05.08. 15:40" bzw. „Verworfen von … · 15:41" und der Begründung,
> der offene mit Knopf. Vor dem Hotfix hätte derselbe Aufruf nach dem ersten Eintrag abgebrochen.
>
> ⚠️ **Was ohne Anmeldung nicht geht:** ein echter Durchgang mit Datenbank — der Endpunkt verlangt
> die Fähigkeit `review`. Bleibt Owner-Sache.

Der Endpunkt liefert nur Meldungen mit Status `neu`. Es gibt keine Liste erledigter Meldungen.
Während des Tests sind der Redaktion zwei eigene Meldungen unter der Hand verschwunden, ohne
dass sich nachvollziehen ließ, was mit ihnen passiert war.

*Aufwand:* mittel.

### ✅ A4 · Die Moderation hinterlässt keinen Eintrag im Änderungsprotokoll

> **✅ Erledigt `1d2999d6` (+ Hotfix `5eae0a6e`), 05.08.2026.** Jede Entscheidung schreibt eine
> Zeile ins **vorhandene** `map_audit_log` und erscheint damit ohne neue Oberfläche im Reiter
> „Änderungen": `report_approved` / `report_rejected` / `report_in_review`, mit Person, Meldung und
> Status **und** Begründung vorher/nachher.
>
> **Fünf Aufrufstellen, nicht drei.** `create_citymap` und `add_citymap_links` setzen
> `status='approved'` selbst — sie verbrauchen eine Meldung genauso endgültig.
>
> 💣 **Nicht rückgängig machbar, bauartbedingt** (`feature_id` NULL, keine Undo-Spalten). Was eine
> Annahme *erzeugt* hat, trägt seine eigene, rückgängig machbare Zeile. Der Test sichert das für
> alle drei Namen zu — ein künftiger Name, der mit `create` beginnt, würde es still umdrehen.
>
> 💣 **Eine Erlaubnisliste hält die Melderdaten draußen.** Der Moderationspfad hat die **ganze**
> Meldungszeile in der Hand, samt `ip_hash`, `remote_ip` und `user_agent`. `map_audit_log` wird von
> einem anderen Endpunkt gelesen und reist in jedem Datenbank-Backup mit. Acht Felder gehen mit;
> der Test prüft die anderen als Schlüssel **und** als Werte.
>
> 💣 **Der Fix war 25 Minuten lang selbst ein Ausfall — das gehört ins Protokoll.**
> `avesmapsNormalizeReviewNote()` antwortet `null`, wenn keine Begründung getippt wurde, und
> **kein Client schickt das Feld überhaupt**. Meine neue Funktion verlangte `string`. Unter
> `strict_types=1` ist das ein `TypeError` **an der Aufrufstelle** — also außerhalb genau des
> `try/catch`, das verhindern sollte, dass ein Protokollfehler die Entscheidung mitreißt. Folge:
> Annehmen legte den Ort an, nahm die Meldung an und meldete dann „Die Meldungen konnten nicht
> verarbeitet werden."; ein zweiter Versuch bekam wegen `AND status = 'neu'` ein 404. Es ging
> nichts verloren, aber **jede Rückmeldung log**. Behoben in `5eae0a6e`.
>
> ⚠️ **Und der Test war die ganze Zeit grün**, weil er nur Zeichenketten übergab. Er übergibt jetzt
> `null`, prüft beide Signaturen per Reflection und die Rückmutation bricht nachweislich ab.
> **Lehre, zum zweiten Mal an einem Tag: ein Test prüft nur die Fälle, die er einsetzt — und der
> häufigste Fall war hier der ungeprüfte.**
>
> ⚠️ **Live nicht prüfbar ohne Anmeldung** (Fähigkeit `review`); ein echter Durchgang bleibt
> Owner-Sache.

Annehmen, Ablehnen und Zurückstellen einer Meldung erzeugen keine Protokollzeile. Wer eine
Meldung bearbeitet hat und mit welcher Begründung, ist nachträglich nicht feststellbar — bei
einer Karte, die 11.500 Objekte aus Community-Beiträgen führt.

*Aufwand:* mittel.

### ✅ A5 · Der Wunschtext des Melders landet in der öffentlichen Beschreibung

> **✅ Erledigt `f9321c9c` (+ Hotfix `93168488`), 05.08.2026.** Der Befund war schwerer als
> beschrieben: `location-edit-description` war ein **`type="hidden"`**-Feld. Der Melder-Text wurde
> also nicht nur ungefragt veröffentlicht — die Redaktion **konnte** ihn nicht sehen, und die rote
> „geändert"-Markierung saß auf einem unsichtbaren Element. Die zwei Schwesterdialoge führen genau
> dieses Feld seit jeher als sichtbares Textfeld; der Ortsdialog war der Ausreißer.
>
> Ein Änderungs**wunsch** ist außerdem keine Beschreibung. Er steht jetzt in einem eigenen,
> schreibgeschützten Kasten daneben, statt ihr samt der Zeile „— Community-Änderungswunsch von …:"
> vorangestellt zu werden.
>
> **Live gegen den ausgelieferten Client gemessen** (`?edit=1`, echte Ortsdaten):
>
> | Prüfung | Ergebnis |
> |---|---|
> | Feldart | `TEXTAREA`, `maxLength` 1200 |
> | Beschriftung | „Beschreibung — öffentlich sichtbar" |
> | gespeicherte Beschreibung wird geladen | **ja** (vorher `""`) |
> | Wunsch-Kasten beim Änderungsvorschlag | sichtbar, mit Melder und Text |
> | Beschreibung danach | unverändert |
> | nach dem Schließen | Kasten versteckt |
>
> 💣 **Der schwerste Fund des Tages steckte darin und ist älter als der Befund.** Der Dialog **lud
> die Beschreibung nie** (`presetDescription || ""` — und `presetDescription` setzt im ganzen
> Projekt kein Aufrufer). Beim Speichern schickte er sie trotzdem mit, und der Server macht aus
> einer leeren Beschreibung `unset($properties['description'])`
> (`api/_internal/map/features.php:1275`). **Jedes Speichern eines bestehenden Ortes hat seine
> öffentliche Beschreibung gelöscht** — auch wenn nur ein Tippfehler im Namen korrigiert wurde.
> Unsichtbar, weil das Feld versteckt war. Die Nachbarzeile macht es für den Wiki-Link seit jeher
> richtig: das Markup wurde kopiert, das Laden nicht.
> 🔧 **DU:** falls Orte ihre Beschreibung verloren haben, ist das die Ursache — das
> Änderungsprotokoll (`update_point`) zeigt, welche.
>
> 💣 **Und der erste Wurf war selbst zweimal falsch, beide Male von der Gegenprüfung gefunden:**
> der Wunsch-Kasten wurde 44 Zeilen nach dem Anzeigen von `clearChangeReportFieldMarks()` wieder
> geleert — der Wunsch stand damit **nirgends**. (Dieselbe Fehlerklasse wie bei A3: zwei
> Lebensdauern in einer Funktion.) Und `maxlength` machte das Feld bei programmatisch gesetztem
> Wert ungültig, worauf `reportValidity()` das Anlegen **ohne Meldung** abgebrochen hätte.

Was ein Melder als Erläuterung schreibt, wird beim Annehmen in das öffentlich sichtbare
Beschreibungsfeld übernommen — ohne dass die Redaktion darauf hingewiesen wird, dass dieser Text
gleich für alle sichtbar ist.

*Aufwand:* klein.

---

## 2. Löschen räumt nicht auf

Fünf Befunde, drei Agenten unabhängig darauf gestoßen. Der Kern ist immer derselbe: die
Hauptzeile verschwindet, ihre Anhängsel bleiben — und bleiben **öffentlich abrufbar**.

### ✅ A6 · Ein gelöschtes Kartenobjekt lässt seine Quellenverweise für immer zurück
Verwaiste Einträge in `feature_sources`: **284** bei Karten, **123** bei Regionen (mit 3.471
Verweisen), **84** bei Wegen, **9** bei Siedlungen. Ein `DELETE FROM sources` existiert nirgends
im Projekt — **132 Katalogzeilen** zeigt nichts mehr an, sie tauchen aber weiter in der
Quellen-Vervollständigung aller Redakteure auf.

💡 **Die Lösung ist im Haus.** Dieselbe Funktion macht es in ihrem Legacy-Zweig richtig
(`… AND is_active = 1`, Zeile 126) — nur am Katalog-Zweig fehlt die Bedingung. Ein JOIN.

*Beleg:* in den Momentaufnahmen ausgezählt und an einer echten Siedlung im Editor nachgewiesen.
*Aufwand:* klein.

> **✅ Erledigt `18b1e565`, 05.08.2026** (A6 und A7 zusammen — der Riegel sitzt am Lesen, also
> bringt Rückgängig die Quellen von selbst zurück). Live gegen den Kartenpayload gemessen:
> Verweise auf gelöschte Objekte **216 → 0**, Verweise auf Territorien und Karten **1.509 → 1.509**
> (die Gegenrichtung, die man leicht mit wegfiltert). Payload 74 KB kleiner.
>
> ⚠️ **Der Weg dahin kostete zwei selbstverschuldete Ausfälle — beide gehören ins Protokoll:**
> 1. `a1ee182c` reparierte den **falschen Leser**. `GET /api/app/feature-sources.php` hat seit dem
>    Payload-Umbau keinen Aufrufer mehr; das Leck saß in `api/app/map-features.php`, also in der
>    Anfrage, die jeder Besucher stellt. Die 216/4.714 waren **dort** gemessen. Lehre: messen und
>    reparieren müssen denselben Pfad treffen — sonst beweist die Zahl nur, dass es woanders brennt.
> 2. Derselbe Commit verglich zwei Spalten **verschiedener Kollation** → „Illegal mix of collations",
>    zwei öffentliche Endpunkte auf 500. Die Falle steht zweimal im eigenen Code, und eine der
>    Stellen nennt `feature_sources` wörtlich „the house's scar". Der sqlite-Test lief den ganzen
>    Ausfall über grün, weil sqlite keinen Kollationskonflikt kennt. Lehre: ein grüner Lauf auf
>    einer anderen Datenbank ist kein Beweis für die Eigenschaft, die diese Datenbank nicht hat.
> 3. Der Reparaturversuch `6949fd41` brachte `DeflateAlterETag` in die `.htaccess` — dort **nicht
>    erlaubt**, also Apache-500 auf *alles*, die ganze Karte. Zurückgenommen in `fdd4fc42`.
>    Lehre: eine Direktive im falschen Gültigkeitsbereich nimmt die Seite mit, nicht nur sich selbst.

### ✅ A7 · Auch „Rückgängig" lässt den Quellenverweis stehen
Derselbe Mechanismus, eine Stufe schlimmer: Wer eine Änderung zurücknimmt, bekommt den alten
Zustand — bis auf die Quellen, die öffentlich abrufbar bleiben. Betroffen ist auch
`undo_create_point`.

*Aufwand:* klein (dieselbe Bedingung wie A6).

### ✅ A8 · Der Karten-Sync löscht anders als die Hand

> **✅ Erledigt `2664e6ea` (+ Hotfix `d434e658`), 05.08.2026.** Es gibt jetzt **einen** Räumer
> (`avesmapsDeleteCitymapChildRows`), den beide Wege rufen — die zwei fehlenden `DELETE`s
> nachzutragen hätte nur bis zur nächsten Kindtabelle gehalten.
>
> 💣 **Ein zweiter Fehler an derselben Stelle, nicht im Befund:** der Sync löschte die Kinderzeilen
> **vor** der Karte, und die Karte hat einen `origin`-Riegel. Griff der je, blieb die Karte stehen
> — ohne ihre Orte und Arten. Die Sicherung richtete genau den Schaden an, den sie verhindern
> sollte.
>
> 💣 **Ein dritter, den erst die Gegenprüfung fand, und er ist der schlimmste:** der Sync schreibt
> je Karte einen Quellenverweis in `feature_sources` (~631 Zeilen), und **kein Löschweg entfernte
> ihn**. Karten stehen zudem nicht in `AVESMAPS_FEATURE_SOURCE_SOFT_DELETED_ENTITY_TYPES` — der
> Lebend-Riegel aus A6 greift für sie also nie. Ein Verweis auf eine gelöschte Karte wurde damit
> **dauerhaft an jeden Besucher ausgeliefert**. Das ist A6 noch einmal, für die eine Entität, die
> A6 ausgenommen hatte — mit der Begründung, Karten hätten „ihre eigene Löschsemantik". Die hatten
> sie nicht.
> ⚠️ Der Räumer schließt das am Löschweg. Der **Lese**-Riegel nimmt Karten weiterhin aus; wer die
> Karte auf einem anderen Weg entfernt, erzeugt dieselbe Leiche wieder.
>
> 💣 **Und die richtige Reihenfolge allein tauschte nur die Art des Schadens.** Bricht der Lauf
> zwischen Karte und Kindern ab — der Schritt steht unter einem 43-Sekunden-Limit auf einem Host
> mit Abschuss-Geschichte —, ist die Karte weg und ihre Kinder sind **für immer** verwaist: die
> Liste der zu Entfernenden wird aus **lebenden** Zeilen gebildet. Jetzt eine Transaktion je Karte,
> wie im Handpfad seit jeher.
>
> ⚠️ **Nicht live prüfbar:** dafür müsste „Karten syncen" laufen. Belegt sind Code, Tests und
> **sechs nachgestellte Rückmutationen** — die erste Testfassung hatte vier davon überlebt, darunter
> eine, die den Befund selbst wiederherstellte.

Der Sync-Löschpfad vergisst `citymap_related` und `citymap_link`, die der Handlöschpfad räumt.
Zwei Wege, zwei Ergebnisse, für dieselbe Aktion.

*Aufwand:* klein.

### ✅ A9 · 14 Kraftlinien-Segmente hängen an Endpunkten, die es nicht mehr gibt

> **✅ Ursache behoben `47ae9ced` (+ `35e0deb5`), 05.08.2026.** Das Löschen eines Punktes, an dem
> eine **aktive** Kraftlinie hängt, wird jetzt verweigert — serverseitig **und** im Editor, mit
> Nennung der betroffenen Linien. Das ist die Gegenprobe zum Anlegen, das beide Endpunkte seit jeher
> hart prüft.
>
> 💣 **Die Ursache war präziser als der Befund.** Eine Warnung **gab** es im Client — sie stand
> hinter `locationType === CROSSING_LOCATION_TYPE`. Kraftlinien verbinden aber **Nodix-Orte oder
> Kreuzungen** (die Anlege-Prüfung sagt das wörtlich). Das Löschen eines Nodix-Ortes lief also ohne
> ein Wort durch. So sind die Waisen entstanden.
>
> **Live gemessen, an Gareth** — einem Nodix-Ort, also genau dem Fall, für den es vorher keine
> Warnung gab: **5 angebundene Abschnitte**, `deleteLocationMarker` macht **0 Serveraufrufe**,
> stellt **0 Rückfragen**, der Marker bleibt stehen. Die Schreibschicht war während der Probe
> abgeklemmt, es konnte also auch bei einem Fehlschlag nichts gelöscht werden.
>
> ⚠️ **Diese Probe fand gleich noch einen Fehler in meiner eigenen Reparatur:** die Meldung nannte
> **keine** Linie, weil ein Kraftlinien-Objekt seinen Namen in `properties.name` trägt und nicht
> oben. Behoben in `35e0deb5`; jetzt steht dort „Basiliuslinie, Chalwens Griff, Gareth - Reichsabtei
> St. Praiodan und weitere". **Der Test hätte das nie gesehen — er prüft Struktur, keine Daten.**
>
> ⚠️ **Verweigern statt reparieren** ist Absicht: die Abschnitte tragen Namen, Quellen und eine
> Sortierung. Sie still zu löschen oder umzuhängen wäre die größere Überraschung.
>
> 💣 **Der erste Wurf griff nur für ein Drittel — die Gegenprüfung hat es zerlegt (`e6e684b5`).**
> Der Riegel stand auf `feature_type === 'location'`, und das ist die falsche Achse: der Kommentar
> des Hauses sagt, `avesmapsFetchEditablePointFeature` verlange „einen **Punkt**, keinen Ort". Ein
> Endpunkt kann eine Kreuzung (`junction`, dazu **798** Altzeilen `crossing`) oder ein
> **Nodix-Label** sein (Owner-Entscheid 2026-07-28). Die Reparatur ist keine längere Typliste — die
> nächste Art fiele wieder heraus —, sondern **gar keine Typprüfung**.
>
> 💣 **Und der Löschweg war nicht der einzige Weg.** „Rückgängig" auf ein Anlegen setzt
> `is_active = 0`, ohne ihn zu berühren (Ort anlegen, Kraftlinie dranhängen, Anlegen zurücknehmen =
> eine Waise per Knopfdruck), und die Landschafts-Kaskade legt Label-Zeilen mit eigenem `UPDATE` um.
> Im Client wird ein Label über `deleteLabelEntry` gelöscht, nicht über `deleteLocationMarker` —
> dort gab es auf **keiner** Seite einen Riegel. Alle drei prüfen jetzt, und die Absage steht
> **einmal** im Code statt zweimal.
>
> **Nach dem Hotfix live gemessen** — an beiden Arten, die der erste Wurf nicht erfasst hätte:
>
> | Probe | Ergebnis |
> |---|---|
> | Kreuzung-155 | „trägt noch **1 Kraftlinien-Abschnitt (Altoum-Linie)**" — Singular und Name |
> | Gareth (Nodix-Ort) | „5 Kraftlinien-Abschnitte (Basiliuslinie, Chalwens Griff, … und weitere)" |
> | Serveraufrufe / Rückfragen | **0 / 0**, beide Marker stehen noch |
>
> ⚠️ Der Test hatte nur die **Reihenfolge** zweier Aufrufe geprüft; **vier Mutationen überlebten
> ihn**, darunter der ausgelieferte Fehler — sein Datensatz enthielt weder `junction` noch
> `crossing` noch `label`, die Bedingung wurde also nie ausgeführt.
>
> 🔧 **DU: die 14 bestehenden bleiben.** Neue können nicht mehr entstehen, die alten räumt der Fix
> nicht weg. [`sql/kraftlinien-tote-endpunkte.sql`](../../sql/kraftlinien-tote-endpunkte.sql) listet
> sie und trennt den einfachen Fall ab: steht der tote Endpunkt nur auf `is_active = 0`, holt **ein**
> `UPDATE` ihn zurück und repariert alle Abschnitte, die ihn nennen, auf einmal. Ob ein wirklich
> verlorener Abschnitt umgehängt oder stillgelegt wird, ist eine inhaltliche Entscheidung.

*Beleg:* in der Momentaufnahme ausgezählt. *Aufwand:* klein (Datenbereinigung).

### ⚠️ A10 · 516 Abenteuer-Zuordnungen zeigen auf gelöschte Label
**OFFEN — ein Reparaturversuch wurde zurückgenommen.**

> ⚠️ **`ae06f5dc` zerstörte Daten und ist zurückgenommen (`1ad11c54`).** Der Versuch setzte tote
> Zeiger auf `unresolved` zurück, damit die vorhandene Auflösung sie im selben Lauf wieder aufnimmt.
> Eine feindliche Gegenprüfung hat den Verlust an der echten Funktion **reproduziert**, und die
> Änderung war da bereits ausgeliefert.
>
> ✅ **Nachgemessen vom Owner, 05.08.2026: kein Datenverlust.** Beide Abfragen aus
> [`sql/a10-verlorene-ortszeiger.sql`](../../sql/a10-verlorene-ortszeiger.sql) liefern **null Zeilen**
> — weder eine beschädigte Zeile noch überhaupt eine, die im Zeitfenster angefasst wurde. In den
> sechzehn Minuten hat niemand einen Kartenort hinzugefügt und kein Sync lief; der Pass ist also nie
> ausgeführt worden. Der Fehler war ausgeliefert, wurde aber nicht ausgelöst.
>
> 💣 **`target_kind` hat nicht vier Werte, sondern sieben.** Der Quellen-Verknüpfungsweg
> (`adventures.php:1178`) nimmt **jeden** Entitätstyp der feature-sources-Whitelist außer `citymap`
> und schreibt ihn direkt als `target_kind`: dazu gehören **`lore`** (lebt in `lore_entry`, über
> `wiki_key`) und **`ecosystem`** (lebt in `ecosystem_region`). Beide wurden in `map_features`
> gesucht, nie gefunden — und ihr Zeiger gelöscht. Der Pass läuft an
> `avesmapsAddCitymapPlace`, also bei **jedem** „Ort hinzufügen" im Kartensammlungs-Editor.
>
> ⚠️ **Derselbe Fehler steht einen Tag älter im Code, in einer Datei, die diese hier einbindet**
> (`api/_internal/app/feature-sources.php:111`): „NOT every entity type belongs here. territory,
> citymap and lore keep their own tables and their own delete semantics." Jener Fix hat Zeilen nur
> **versteckt**; meiner hat den Zeiger **überschrieben**.
>
> 💣 **Und die Grundannahme trug nicht.** „`raw_name` ist der einzige Weg zurück" gilt für genau
> diese Zeilen nicht: `avesmapsAdventurePlaceNameFor` kennt keinen Zweig für `lore`/`ecosystem`/
> `powerline` und gibt die `public_id` zurück — `raw_name` ist dort ein Wiki-Slug oder eine UUID,
> die der Auflöser nicht zuordnen kann.
>
> 💣 **`is_active = 0` als „verschwunden" zu werten macht aus einer umkehrbaren Handlung eine
> unumkehrbare.** Ein Soft-Delete existiert, damit „Rückgängig" die Zeile unter **derselben**
> `public_id` zurückholt; der Pass hätte in der Zwischenzeit jeden Zeiger darauf gekappt, und
> Rückgängig kann sie nicht wiederherstellen. Das Quellen-System hat dasselbe Problem andersherum
> gelöst und aufgeschrieben, warum: **„THE GUARD BELONGS ON THE READ, NOT ON THE DELETE."**
>
> 🔧 **DU: der Befund steht, der Weg ist offen.** Zwei Möglichkeiten, und die Wahl ist eine
> Abwägung, keine technische Frage:
> **(a) Riegel beim Lesen** — wie im Quellen-System. Kostet nichts, kann nichts verlieren, lässt
> den toten Zeiger aber in der Tabelle stehen.
> **(b) Zurücksetzen** — repariert die Daten wirklich, braucht dafür aber eine Nachschlagetabelle je
> `target_kind` (vier Tabellen, nicht zwei) und muss stillgelegte Ziele **in Ruhe lassen**.

Der Wiki-Schlüssel-Rückfall des Clients rettet 491 davon; **25 sind unrettbar unsichtbar** —
ein Abenteuer, das einem Ort zugeordnet ist, erscheint dort nicht.

*Aufwand:* mittel.

---

## 3. Offene Türen

### ✅ A11 · Ein Schreibpfad ohne jede Anmeldung
`api/app/adventures.php:94`

> **Erledigt `360f8567`, 05.08.2026.** Der POST-Zweig ist entfernt statt bewacht — nichts brauchte ihn. Live gegengeprüft: POST antwortet 405 vor jeder Verbindung, GET liefert weiter 200.

`POST /api/app/adventures.php {"action":"resolve"}` prüft **keinerlei Berechtigung**, schreibt
in die Datenbank und läuft über den gesamten Bestand. Der Kopfkommentar der Datei nennt es eine
„guarded one-shot BOOTSTRAP surface", die „Phase 3 … can tighten/remove" — Phase 3 ist längst
ausgeliefert, das Aufräumen ist nie passiert.

Der eigentliche Schaden ist weniger das Schreiben als der Hebel: **jeder Fremde kann den Server
wiederholt in einen vollständigen Auflösungslauf schicken.** Bei einem PHP-Pool, der schon
dreimal an Last erstickt ist, ist das der billigste denkbare Ausschaltknopf.

*Beleg:* ausschließlich gelesen, **bewusst nicht ausprobiert**. *Aufwand:* klein.

### ✅ A12 · `PDOException` leckt an jeden anonymen Aufrufer — im stabilen Vertrag
`api/locations/index.php:38` und `api/route/index.php:359`

> **Erledigt `360f8567`, 05.08.2026.** Beide Endpunkte fangen `PDOException` jetzt zuerst. Mit totem Datenbankport vorgeführt: statt `SQLSTATE[42S02]: Base table…` kommt „Die Orte konnten nicht aus der Datenbank geladen werden."

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

> ⚠️ **Nachgemessen am 05.08.2026 abends — die Schwere ist geringer als hier steht, die Fragilität
> bleibt.** Ein Abruf der echten Nutzlast (11.523 Features), beide Zählungen wörtlich nachgebaut:
>
> | | |
> |---|---|
> | Kreuzungen laut **Server** (Namenspräfix `Kreuzung…`) | **2.084** |
> | Kreuzungen laut **Client** (`resolveLocationTypeFromFeature`) | **2.084** |
> | Objekte, die nur eine Seite für eine Kreuzung hält | **0** |
> | Objekte mit **abweichendem Namen** | **0** |
>
> Client und Server reden **heute nicht** aneinander vorbei. Beide sortieren gleich
> (`ORDER BY sort_order ASC, id ASC`) und kommen über verschiedene Prädikate zum selben Ergebnis —
> der Client erkennt eine Kreuzung am Subtyp, der Server am Namen, und im Bestand deckt sich das
> Zeichen für Zeichen. Es gibt also **keine** falsch aufgelöste Route.
>
> Und ein Kreuzungsname kann **nicht** in einen Kurzlink geraten: beide Wegpunkt-Wege filtern ihn
> heraus (`map-features-location-lookup.js:155`, `map-features-waypoints.js:133`), und ein Kurzlink
> speichert nur die Abfrage mit den Wegpunktnamen.
>
> **Was bleibt, und es bleibt echt:**
> 1. **Die Namen sind Positionen.** Eine eingefügte oder gelöschte Kreuzung benennt bis zu 2.083
>    Knoten um. Nichts bricht, solange beide Seiten bei jeder Anfrage neu durchzählen — aber jede
>    Stelle, die einen Kreuzungsnamen **über die Zeit aufbewahrt**, zeigt danach woandershin.
> 2. **Der stabile Vertrag sagt zwei Namen für ein Objekt.** `POST /api/route/` nennt es
>    `Kreuzung-549`, `GET /api/locations/` und der Kartenpayload nennen es, wie es gespeichert ist.
> 3. **Die beiden Prädikate sind nur zufällig deckungsgleich.** Eine Kreuzung, die ein Redakteur
>    umbenennt, oder ein Ort, der „Kreuzung…" heißt, kippt es — ab dieser Zeile verschieben sich
>    alle folgenden Nummern gegeneinander. Die Deckung ist ein Messwert von heute, keine Zusicherung.
>
> 🔧 **DU: der Fix ist eine Namensänderung an 2.084 Objekten im stabilen Vertrag — das entscheidest
> du.** Drei Wege:
> **(a) `public_id` als Schlüssel** (richtig, unveränderlich; die Anzeige bräuchte einen zweiten,
> lesbaren Namen daneben);
> **(b) `Kreuzung-<id>`** aus der Datenbank-Id statt aus der Laufnummer (stabil, klein, ändert die
> Zahlen aber einmalig alle);
> **(c) nur die Prädikate angleichen** (billig, macht die Deckung von Punkt 3 verbindlich, lässt die
> Positionsabhängigkeit aber stehen).
> Alle drei ändern, was `POST /api/route/` meldet.

### ⚠️ A14 · `GET /api/locations/` ist der ungeschützte Zwilling eines 152-MB-Pfades
**Repariert (`9f2962e8` + `6bad25be`) — aber auf diesem Host wirkungslos, siehe A34.**

> **Was gebaut wurde.** Der Endpunkt beantwortet bedingte Anfragen, und zwar **zuerst**: die Revision
> kommt aus einer kleinen Abfrage, der ETag daraus, und ein Treffer antwortet `304`, **bevor**
> irgendetwas geladen wird. Ein 304 nach dem Laden spart die Übertragung und nichts von den Kosten.
> Dieselbe Verbindung wird weitergereicht statt eine zweite geöffnet (`max_user_connections`).
>
> 💣 **Der Vergleicher musste geteilt werden, nicht kopiert** — er wohnte in `map-features.php`,
> einem **Skript**. Und die Verschiebung brauchte einen `function_exists`-Riegel: der Deploy schreibt
> Datei für Datei, STRATOs opcache prüft jede einzeln mit 2–4 Minuten Verzug, und PHP bindet
> Funktionen beim Kompilieren. Ohne Riegel hätte die ältere `map-settings.php`-Generation ihre eigene
> Kopie zuerst registriert → `Cannot redeclare` als **E_COMPILE_ERROR**, also vor jedem `try`: eine
> **leere 500 für jeden Besucher** auf dem meistgerufenen Endpunkt. Beide Richtungen nachgestellt.
>
> 💣 **Der ETag stand vor der Arbeit** und ritt damit auf jeder 500 mit, die die 152-MB-Ladung
> auslösen kann. Wer den Fehlerkörper unter dem Tag ablegt, bekommt danach ein `304` darauf — und das
> heilt nicht, weil `map_revision` sich ohne Bearbeitung nicht bewegt. Er geht jetzt nur noch mit der
> Antwort raus.
>
> ⚠️ **Nicht getan: die Antwort begrenzen.** Der Befund merkt an, `?limit=25` werde ignoriert — das
> stimmt, aber `api/README.md` hat nie ein `limit` zugesagt. Es zu erfüllen wäre ein **neuer**
> Vertrag, und der Endpunkt gehört zum stabilen Teil.
> 🔧 **DU:** ob `GET /api/locations/` `limit`/`offset` bekommen soll, ist eine Vertragsentscheidung.


Der Endpunkt lädt die ganze `map_features`-Tabelle und baut das Routennetz auf — genau den
Pfad, den `api/route/index.php:26` selbst mit „62 MB resident, peak 152 MB per call" beziffert
und für den sechs Diagnose-Endpunkte hinter Rechte gelegt wurden. Der öffentliche Zwilling ist
offen: **ohne Cache, ohne ETag, ohne Limit**. `?limit=25` wird ignoriert — die Antwort enthält
immer alle 4.854 Objekte (938 KB).

*Beleg:* Code gelesen, `?limit=25` live gegengeprüft. *Aufwand:* mittel.

### ✅ A15 · Die öffentlich widerrufene DIN-33466-Behauptung steht weiter in der kanonischen Referenz
`api/README.md:101`

> **Erledigt `36ea5f20`, 05.08.2026.** Der Wächter streift Kommentare ab (mit eigener Zusicherung, dass er dabei keinen ausgelieferten Text frisst), `api/README.md` steht in seiner Prüfliste, und der Absatz nennt das falsche Etikett gar nicht mehr.

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

### ⚠️ A17 · Ein frisch angelegtes Abenteuer fehlt in der Liste des Editors, der es angelegt hat
### ⚠️ A18 · Editorfenster stapeln sich als lebende iframes
**BEIDE OFFEN — ein gemeinsamer Reparaturversuch wurde zurückgenommen.**

Die Ursache ist gemeinsam und steht fest: eine Editor-Überlagerung trägt einen iframe, und das
Schließen setzt nur `hidden = true`. Beim Wiederöffnen wird **dieselbe Seiteninstanz** mit ihrer
alten Liste eingeblendet (A17), und geschlossene Editoren laufen unsichtbar weiter (A18). Der Code
sagt es selbst: „The overlay is HIDDEN, not destroyed, on close … **The adventure editor lives with
that.**"

> 💣 **`54aa6907` machte daraus einen Datenverlust und ist zurückgenommen (`28f98f5a`).**
> Der Versuch räumte die Überlagerung beim Schließen ab. Alle **sieben** schließen aber bei einem
> Klick auf den **Hintergrund**, ohne Rückfrage — und die iframes treiben mehrschrittige Jobs vom
> Client aus. Das Entfernen verwirft ihr Dokument und bricht ihre Abrufe mitten in der Schleife ab:
>
> | Job | Was ein Abbruch hinterlässt |
> |---|---|
> | „Zugehörigkeit rechnen" | Zeilen geschrieben, `assignment_commit` nie erreicht — der Lauf zählt als nicht gerechnet |
> | „Syncen" | Staging halb geleert, bis zu 4.000 Schritte, Modellneubau läuft nie |
> | Kraftlinie löschen | Linie mit teils gelöschten, teils lebenden Abschnitten — kaputte Routing-Topologie |
> | Karte/Abenteuer speichern | Datensatz gespeichert, `set_links` fehlt |
>
> **Vorher lief der Job zu Ende** und das Wiederöffnen zeigte das fertige Ergebnis. „Läuft im
> Verborgenen weiter" war **tragend**, und ich habe es ohne Riegel, ohne Rückfrage und ohne einen
> Weg für den iframe, zu widersprechen, entfernt: `busy()` sperrt nur Knöpfe **innerhalb** des
> Rahmens, das ✕ und der Hintergrund gehören dem Elternfenster.
>
> Zwei weitere Funde derselben Prüfung: das Anwesenheits-System **erfährt vom Schließen nichts**
> (es beobachtet das `hidden`-Attribut und hinzugefügte Knoten — ein `remove()` ist keines von
> beidem), und der Wiederverwendungs-Zweig war **nicht tot**: `wiki-sync-monitor.html` blendet die
> Sync-Überlagerung selbst aus, ohne `closeOverlay` zu rufen — auf genau diesem Weg blieben A17 und
> A18 unrepariert.

🔧 **DU: die Bauform ist eine Abwägung.** Die sichere Hälfte macht `review-path-editor-list.js`
bereits vor: **ausblenden lassen und den iframe beim WIEDERÖFFNEN neu laden** — ein bewusster
Handgriff, kein Fehlklick. Das behebt A17, aber **nicht** A18: ein verborgener Editor fragt weiter
den Server ab. Abräumen beim Schließen behebt beides, verlangt aber, dass der Rahmen vorher gefragt
wird — und der Hintergrundklick darf in keinem Fall ein stiller Zerstörer bleiben.

*Aufwand:* A17 klein, A18 mittel.

---

## 6. Zwei echte Lasttreiber

### ⚠️ A19 · `ecosystem-areas.php` führt 64 SQL-Anweisungen aus, bevor es ein 304 zurückgibt
**OFFEN — ein Reparaturversuch wurde zurückgenommen.**

> ⚠️ **`cae7cad9` war falsch und ist zurückgenommen (`927e1abd`).** Der Versuch zog das DDL hinter
> die 304-Prüfung. Meine Grundannahme — „`EnsureTables` hebt die Revision nicht" — ist falsch, und
> die Datei sagt es in Rot: `avesmapsEcosystemEnsureTables` endet mit einer Migration, die
> `avesmapsNextEcosystemRevision()` ruft (`ecosystem.php:901`), mit dem Kommentar „**THE REVISION HAS
> TO BE BUMPED HERE** … ohne diese Zeile bekommt jeder warme Client ein 304 … That exact failure was
> measured on 2026-07-28. **A payload-version bump is NOT the instrument here.**" Ich habe in meiner
> Commit-Nachricht genau diese Payload-Version als Auffangnetz genannt.
>
> 💣 **Und ein zweiter Fehler, der bei jeder Anfrage wirkt:** das Fenster zwischen Revisions- und
> Flächenlesung wuchs von zwei reinen Parse-Aufrufen auf **64 Anweisungen**. Ein Schreibvorgang darin
> lässt den Endpunkt Daten von N+1 unter der Marke N ausliefern — und der Client verwirft seinen
> Regionen-Cache nur bei einer Revisions**differenz**. `ecosystem_revision` sprang an einem
> Arbeitstag **901**-mal.
>
> ⚠️ **Der Versuch brachte ohnehin nichts:** A34 hat gemessen, dass der 304-Zweig auf diesem Host nie
> feuert. Kein Nutzen, zwei Korrektheitsfehler.
>
> 🔧 **DU: A19 lohnt erst zusammen mit A34** — und dann in dieser Form: die Revision **einmal, nach
> dem DDL** lesen und daraus sowohl den ETag als auch das `revision`-Feld speisen. Eine billige
> Vorab-Lesung darf nur die 304-Entscheidung tragen, und auch das erst, wenn `EnsureTables` den
> Zähler nicht mehr bewegen kann.

13 `CREATE TABLE`, 16 `information_schema`-Proben, 34 `INSERT IGNORE`. Ein Client mit gültigem
ETag — also der Normalfall — zahlt sie vollständig.

*Aufwand:* mittel.

### ✅ A20 · Der N+1 im abgeleiteten Politik-Layer lebt noch
Milestone M6 hat nur den Volltabellen-Scan entfernt. `territories-derived-layer.php:66-67`
feuert weiter **2 Abfragen je abgeleitetem Objekt** — bei Zoom 3 sind das **244 Abfragen** je
Cache-Fehlschlag, auf dem schwersten Endpunkt des Projekts (gemessen: 2,82 s, 3,0 MB).

> **✅ Erledigt `17e5e5de` (+ Korrektur `354a4c35`), 05.08.2026.** Ein Auflöser sammelt die
> Quell-IDs **aller** Objekte, vereinigt sie und löst beide Listen in **zwei** Abfragen auf.
> Live gegengeprüft am Kartenstand: 382 Objekte, davon **121 mit Quell-Listen** (der alte Code
> hätte hier **242** Abfragen gestellt), **2.163** Quell-Territorien und **1.931** Quell-Geometrien
> aufgelöst, **0 Duplikate** in irgendeiner Liste, keine leere Liste — und die Folgewirkung steht
> unverändert: 21 versteckte und 222 stroke-versteckte Quellflächen.
>
> ⚠️ **Nicht vollständig behoben, und das gehört hierhin statt in eine Fussnote.** Der Sammler
> läuft weiter **einmal je Objekt**, und wo er auf `derived_wiki_id` zurückfällt, stellt er zwei
> weitere Abfragen (`avesmapsPoliticalFetchWikiById` plus die namensgleiche Nachfahren-Abfrage).
> Solche Objekte kosteten vorher **4** Abfragen und kosten jetzt **2** — halbiert, nicht beseitigt.
> Im Test gemessen: **18 Abfragen vorher, 4 nachher** bei acht Objekten (davon eines über den
> Wiki-Zweig), und bei drei Wiki-Objekten 2 + 3×2 = **8**. Der Rest ist linear in diesen Objekten.
> Ihn zu bündeln hiesse, über zwei weitere Dateien zu bündeln — eigene Arbeit, eigener Befund.
>
> **Die naheliegende Abkürzung ist bewusst NICHT genommen:** `$territoriesSnapshot` trägt
> `public_id` bereits, die erste Abfrage könnte also ganz entfallen. Er ist aber nach `continent`
> gefiltert, und der **Wiki-Zweig** des Sammlers kann eine ID nennen, die nicht darin steht: seine
> Abfrage matcht Territorien **über den Namen** und filtert allein auf `territory.is_active`, ganz
> ohne Kontinentbedingung. Die Abkürzung verlöre diese Quellen **lautlos** — sichtbar nur als
> doppelt gezeichnete Grenze, nie als Fehler.
>
> 🔁 **Korrektur an meiner eigenen ersten Fassung** (von den Gegenprüf-Agenten gefunden, von mir
> am Code nachgeprüft): dort stand „zwei der drei Sammler-Zweige". Das war falsch. Die beiden
> anderen Zweige starten von `derived_territory_id`, und die Layer-Abfrage dieser Datei erzeugt
> die nur unter `territory.is_active = 1 AND territory.continent = :continent` — dieselbe
> Kontinentbedingung wie der Schnappschuss. Sie liegen also **immer** darin. Der Test pinnte die
> Aussage zuerst am nackten Rückfall fest, also an einem Pfad, den die Produktion gar nicht
> erreicht; jetzt trägt sie ein Objekt über den Wiki-Zweig. Ebenso korrigiert: „M6 hat die beiden
> Leser nicht angefasst" — M6 (`1e4d5bc4`) gab ihnen sehr wohl den Schnappschuss-Parameter,
> unangetastet blieb nur die Abfrage je Objekt.
>
> **Die Reihenfolge in beiden Listen ändert sich** (jetzt nach den gesammelten IDs statt nach
> der Zeilenfolge der Datenbank). Vorher gegen alle fünf Verbraucher geprüft: jeder baut ein
> `Set` oder fragt `.includes()`, keiner liest eine Position. Ausserhalb von `js/` gibt es keinen
> weiteren Verbraucher — in PHP steht nur der Erzeuger.
>
> Der Test (`api/_internal/political/__tests__/derived-source-public-ids-test.php`) führt eine
> wörtliche Kopie der beiden gelöschten Funktionen als **Orakel** mit und vergleicht Objekt für
> Objekt — sonst bewiese er nur, dass der neue Code mit sich selbst übereinstimmt. **Fünf**
> Mutationen als Gegenprobe rot: die Kontinent-Abkürzung, das Gruppieren der Geometrien nach dem
> falschen Schlüssel, jedem Objekt die volle Vereinigung zu geben — und die zwei, die in der
> ersten Fassung noch **grün durchgingen**, weil keine Vorlage sie provozierte: der Riegel gegen
> eine leere `public_id` und `array_unique`. Beide haben jetzt ihre Vorlagenzeile.
>
> 💣 Dass der Wiki-Zweig überhaupt prüfbar ist, hängt an einem `require`: `avesmapsPoliticalFetchWikiById`
> steht in `territories-read.php`. Fehlt die Datei, wirft PHP „Call to undefined function" — ein
> `Error`, also ein `Throwable`, den das `catch (Throwable)` des Sammlers verschluckt. Eine
> Wiki-Vorlage prüfte dann **nichts** und der Test bliebe grün. Ein `function_exists`-Assert hält
> das jetzt fest.
>
> ⚠️ **Die Laufzeit ist hier kein Beweis, und ich gebe sie deshalb nicht als einen aus.** Zwei
> Sonden mit jeweils frischem Cache-Schlüssel ergaben 1,36 s und 2,17 s — dieselbe Anfrageform,
> **byteidentische Antwort** (2.959.644 Bytes beide Male), 60 % Unterschied. Auf diesem Shared
> Hosting schwankt die Wandzeit stärker als der Effekt, den 240 gesparte Abfragen auf einer
> lokalen MySQL-Verbindung haben. Belastbar ist die **Abfragezahl** (im Test deterministisch
> gezählt) und die **Unverändertheit der Antwort** — nicht die Uhr.

*Aufwand:* mittel.

### ✅ A21 · Drei Wiki-Abgleicher schreiben über 4–6 Tabellen ohne jede Transaktion
Ein Abbruch mitten im Lauf hinterlässt halbe Objekte. *Aufwand:* mittel.

> **✅ Zwei von drei erledigt `219bc765` (+ Korrektur `eda93cf9`), 05.08.2026 — der dritte ist A37.**
> `avesmapsCitymapReconcileEntity` (schreibt `citymap`, `citymap_type`, `citymap_place`,
> `citymap_link`, `sources`, `feature_sources`) und `avesmapsPublicationReconcileEntity` (schreibt
> `sources` **und** `feature_sources` — nicht nur die Verknüpfungszeilen) laufen jetzt je Objekt in
> **einer** Transaktion. Der Rumpf heisst `…Writes` und wird aus einer dünnen Hülle gerufen — so
> braucht die Transaktion keine Neu-Einrückung von ~100 Zeilen.
>
> 🔁 **Korrektur an meiner eigenen Begründung.** Ich schrieb, die Je-Objekt-Zusage trage, weil der
> Schrittzähler nur über vollständig verarbeitete Objekte weiterrücke. **Das stimmt nicht** — in
> beiden Schritten wird der Zähler **vor** der Verarbeitung gesetzt. Die Zusage trägt aus einem
> anderen Grund: es gibt **kein `try/catch` um das einzelne Objekt**. Eine Ausnahme verlässt die
> Schleife, die Schrittfunktion kehrt gar nicht zurück, der Aufrufer behält seinen alten Zähler und
> der Lauf endet mit 500. 💣 Das ist zerbrechlich: wer später ein „kaputtes Objekt überspringen"-
> `catch` in die Schleife setzt — der naheliegende Refactor —, schiebt den Zähler über ein
> zurückgerolltes Objekt und baut denselben Schaden eine Ebene höher wieder ein. **Genau das
> sichert der Test jetzt zu**, über alle drei Aufrufer (der Lore-Abgleich ruft den
> Publikations-Reconciler ebenfalls), nicht nur über `dump.php`.
>
> 🔁 **Korrektur an der Erwartung des Befundes.** Der Befund verlangte alle drei Abgleicher. Der
> dritte bleibt bewusst aussen vor: `avesmapsAdventureReconcileEntity` lädt das Wiki-Cover **über
> HTTP** und schreibt es nach `/uploads/questcovers` — **mitten zwischen seinen Schreibvorgängen**,
> verschränkt (erst legt `avesmapsAdventureFindOrAdoptRow` die Zeile an, dann wird deren
> `cover_source` zurückgelesen, dann erst über den Download entschieden). Eine Transaktion darum
> hielte auf einem Shared Host eine Verbindung über unbegrenzte Netz-Latenz offen — und könnte die
> geschriebene Datei ohnehin nicht zurückrollen. Das ist **keine** Verkleinerung des Auftrags,
> sondern ein zweiter Befund: **A37**.
>
> ⚠️ **Live nicht gegenprüfbar, und das sage ich, statt es zu überspringen.** Ein Sync auszulösen
> ist ausgeschlossen (STRATO). Ein sqlite-Prüfstand wäre hier **schlechter als keiner**: sqlite
> committet bei DDL **nicht** implizit, ein grüner Lauf dort sagte also nichts über MySQL, wo genau
> das die Transaktion still beendet. Beweisbar bleibt der statische Weg — und den führt der Test.
>
> Der Test (`api/_internal/wiki/__tests__/reconcile-transaction-test.php`) hält fest: die
> Besitzprüfung (`$ownsTransaction`, denn PDO kennt keine verschachtelten Transaktionen), das
> `rollBack` **mit** Weiterwurf, **kein DDL** und **kein Netz/keine Datei** in der Reichweite der
> Transaktion, dass **kein** Aufrufer eine äussere öffnet, dass **kein `catch`** um das Objekt
> steht — und die Ausnahme für den Abenteuer-Abgleicher **zusammen mit ihrem Grund**, damit sie ihn
> nicht überlebt. 208/208 Tests grün.
>
> 💣 **Die erste Fassung des Tests war genau dort wirkungslos, wo sie zählte** (gefunden von beiden
> Gegenprüf-Agenten, von mir nachgestellt): sie schnitt den Text zwischen `beginTransaction` und
> `commit` aus — **zehn Zeilen mit einem Funktionsaufruf** — und suchte darin nach DDL. Dorthin
> schreibt es niemand. Ein `avesmapsEnsureFeatureSourceTables($pdo);` als erste Zeile von
> `…EntityWrites` ging **grün** durch, ebenso ein `CREATE TABLE` und ein `file_get_contents`.
> Der Test liest jetzt die **tatsächliche Reichweite**: den ausgelagerten Rumpf und **jede**
> `avesmaps*`-Funktion, die er erreicht, in beliebiger Tiefe — mit PHPs eigenem Tokenizer, weil ein
> Regex eine `{` im Kommentar nicht von einer echten unterscheiden kann. Alle drei Mutationen sind
> jetzt rot. Eine Kontrollzusicherung läuft denselben Weg ab dem Abenteuer-Abgleicher und **verlangt**,
> dass er den Cover-Download findet — hört der Lauf je auf zu funktionieren, wäre das Grün oben
> wertlos.
>
> Zwei weitere Löcher derselben Prüfung, ebenfalls behoben: ein **werfendes `rollBack()`** begrub die
> Ursache (es wirft gerade dann, wenn die Verbindung weg ist — der Abbruch, um den es geht — und der
> Aufrufer erfuhr „MySQL server has gone away" statt des echten Fehlers); und
> `avesmapsCitymapLinkSource` **schluckte jeden `Throwable`** über Quellen-Upsert *und* Verknüpfung
> zusammen, committete also eine verwaiste `sources`-Zeile — und bei einem Deadlock, den InnoDB
> serverseitig komplett zurückrollt, liefen die restlichen Schreibvorgänge ohne Transaktion weiter.
> Geschluckt wird jetzt nur noch der dokumentierte Fall (fehlende WikiSync-Staging-Tabellen,
> SQLSTATE 42S02).

---

## 7. Wo die Seite etwas zusagt, das sie nicht einhält

### A22 · Bewertungen erscheinen sofort öffentlich, obwohl eine Prüfung zugesagt ist
Der Hinweistext verspricht eine redaktionelle Prüfung; die Bewertung ist unmittelbar für alle
sichtbar. Während dieses Tests ist genau das passiert (die Testbewertung stand live und wurde
entfernt). Es gibt außerdem keinen Weg, eine Bewertung zu melden.

*Aufwand:* mittel.

### ◐ A23 · Der Besucher-Hash-Salt steht im Quelltext und ist technisch nicht überschreibbar
Die Datenschutzerklärung sagt, die Besucherkennung sei nicht rückführbar. Mit einem bekannten
Salt ist ein IP-Hash aber in Sekunden rückrechenbar — der Adressraum ist winzig. Entweder der
Salt wird konfigurierbar, oder die Zusage muss anders formuliert werden.

*Aufwand:* klein.

> **◐ Der technische Weg ist gebaut `a9d3c6b2` (+ `89cc4e6b`), 05.08.2026 — die Zusage ist damit
> aber noch NICHT eingelöst.** Der Befund bot zwei Wege an; ich habe den gewählt, der die Zusage
> **hält** statt sie abzuschwächen, und der deshalb keine Entscheidung braucht.
>
> 💣 **Warum „nicht überschreibbar" wörtlich stimmte:** `if (!defined('AVESMAPS_VISITOR_SALT'))` sieht
> aus wie ein Überschreibpunkt und ist auf diesem Server keiner. Die Konstante steht fest, sobald die
> Datei per `require` geladen ist — und der einzige Ort, an dem eine Installation ein Geheimnis
> halten kann (`api/config.local.php`, gitignoriert), wird **lazy** von `avesmapsLoadApiConfig()`
> *innerhalb* des Request-Handlers gelesen, also lange danach. Jede Installation lief mit demselben,
> im Repository veröffentlichten Salt und hatte keine Möglichkeit, das zu ändern.
>
> `avesmapsVisitorSalt()` löst jetzt in drei Stufen auf: ein `define()` vor dem `require` (der alte
> Mechanismus, weiterhin geachtet) → `$config['analytics']['visitor_salt']` (die Form, die das
> Projekt schon für das Import-Token nutzt) → der ausgelieferte Rückfallwert. Einmal je Anfrage
> aufgelöst, mit `function_exists` gesichert und in `catch (Throwable)` gewickelt: **fünf** Endpunkte
> laden diese Datei, und ein Analytics-Helfer darf nie der Grund sein, dass einer davon stirbt.
>
> 💣 **Der ausgelieferte Wert bleibt absichtlich unverändert.** Ihn hier zu ändern entwertete jeden
> bereits gespeicherten Hash: ein wiederkehrender Besucher zählte als neu, die Tageszahlen machten
> einen Sprung — lautlos.
>
> ⚠️ **Solange keine Konfiguration gesetzt ist, ist ein Hash weiterhin in Sekunden rückrechenbar.**
> Der Commit macht es *möglich*, das zu ändern; er ändert es nicht. Damit das niemand für erledigt
> hält, meldet die Kennzahlen-Antwort jetzt `salt_configured` — hinter der Fähigkeit `edit`, also für
> Bearbeiter sichtbar und für sonst niemanden.
>
> Zwei Testdateien, und die Trennung ist der Punkt, nicht Ordnungsliebe: eine Konstante lässt sich
> nicht neu definieren und der Auflöser cached in einem `static`, „ohne Überschreibung" und „mit"
> passen also nicht in einen Prozess. Sie zusammenzulegen hiesse, eine der beiden Hälften aus dem
> Quelltext zu behaupten — die Position-statt-Wirkung-Falle, in die diese Sitzung dreimal gelaufen
> ist. **Fünf Mutationen rot**, darunter die entscheidende: Auflöser wird gerufen, der Hash nimmt
> trotzdem den alten Wert. 211/211 grün.
>
> **Live geprüft, spurenfrei** (keine Anfrage, die eine Kennzahl schreibt): die Analytics-Kette lädt —
> `visitor-metrics.php` antwortet **401** statt einer 500, und es bindet `visitor-analytics.php` ganz
> oben ein; ebenso `presence.php` **401** und `import-geo.php` **401**. `map-features.php` unberührt
> bei **200 / 19.236.101 Bytes**.
>
> 🔧 **DU: eine Zeile in `api/config.local.php`**, dann ist der Befund wirklich zu. Zum Beispiel:
> ```php
> 'analytics' => ['visitor_salt' => '<zufällige lange Zeichenkette>'],
> ```
> ⚠️ Ab dem Setzen zählen wiederkehrende Besucher **einmal** als neu — die Tageszahlen machen an dem
> Tag einen Sprung. Das ist der Preis und er fällt nur einmal an.
>
> 🔁 **Zwei Nachbesserungen aus der Gegenprüfung (`d27dc53a`).**
>
> 💣 **Der Zweig, für den die ganze Änderung da ist, wurde von keinem Test je ausgeführt.** Streicht
> man den Vergleich gegen den Rückfallwert, ist der Config-Zweig dauerhaft unerreichbar — die Datei
> definiert die Konstante ja selbst, der Wert ist also nie leer — und **beide** Tests blieben grün.
> Der Zweck starb lautlos, und die Suite klatschte. Ursache: in keinem der beiden Prozesse existierte
> ein Konfigurationslader, der Zweig war also nur per Quelltext-Vergleich „geprüft" — Position statt
> Wirkung, ausgerechnet die Falle, mit der ich die Zweiteilung begründet hatte. Ein **dritter**
> Prozess mit gestubbtem Lader schliesst es; drei vorher grüne Mutationen sind jetzt rot.
>
> 💣 **Die Konfigurationsdatei wurde auf drei Endpunkten ZWEIMAL je Anfrage ausgeführt.**
> `avesmapsLoadApiConfig` nutzt `require`, nicht `require_once` — es muss, denn es gibt zurück, was
> die Datei liefert. Ein zweiter Aufruf führt sie also wirklich erneut aus. Für eine reine
> `return`-Datei folgenlos, aber es war die erste Stelle im Projekt, die den Lader zweimal in einer
> Anfrage rief, und das auf den zwei heissesten Analytics-Pfaden. Die drei Endpunkte reichen die
> Konfiguration jetzt weiter, die sie ohnehin schon halten. ⚠️ Das Weiterreichen ist eine
> **Ersparnis, kein Vertrag**: wer es vergisst, bekommt exakt das alte Verhalten. Ein **vierter**
> Prozess sichert beides zu.
>
> **Vier kleine Prozesse statt einer Datei, die ein Viertel der Zustände prüft und den Rest aus dem
> Quelltext behauptet.** 213/213 grün. Live nach dem Deploy: `visitor-metrics` **401**, `track`
> **200**, `heartbeat` **200** — beide kehren vor dem Schreiben um (`track.php:20` beantwortet alles
> ausser POST ohne eine Zeile), `presence` **401**, `map-features` **200 / 19.236.101 Bytes**.

### ◐ A24 · Das Impressum nennt keine E-Mail-Adresse und hat keine eigene Adresse
Es ist nur über einen JavaScript-Dialog erreichbar, also nicht verlinkbar und für einen
Rechteinhaber, der Kontakt sucht, praktisch nicht auffindbar.

*Aufwand:* klein.

> **◐ Die Adresse gibt es jetzt `faddaf91`, 06.08.2026 — welche E-Mail dort steht, bleibt bei dir.**
> Die acht Abschnitte des Hinweise-Fensters tragen Anker, und ein Hash öffnet das Fenster mit dem
> gemeinten Abschnitt aufgeklappt:
>
> | Link | öffnet |
> |---|---|
> | `https://avesmaps.de/#impressum` | „Kontakt und Impressum" |
> | `https://avesmaps.de/#datenschutz` | „Datenschutz" |
> | `https://avesmaps.de/#kontakt` | „Kontakt und Impressum" |
> | `https://avesmaps.de/#hinweise` | das Fenster als Ganzes |
>
> Die technischen Anker (`#legal-contact` usw.) wirken ebenso. 🔴 **`impressum` zeigt auf
> `legal-contact`, nicht auf `legal-project`** — der Betreiber-Absatz ist am 05.08.2026 nach „Kontakt
> und Impressum" umgezogen (AGENTS.md §11).
>
> ⚠️ **Der Hash wird nur GELESEN, nie geschrieben.** Ein Fenster, das beim Öffnen die Adresszeile
> umschreibt, macht aus jedem Klick einen Eintrag in der Zurück-Historie — und die Adresse dieser
> Karte gehört dem Kartenstand, nicht einem Dialog.
>
> Die Regel liegt in einem **eigenen Blattmodul** (`js/app/legal-anchor.js`), und erst das macht sie
> prüfbar: `bootstrap.js` lädt ohne jQuery und die halbe Karte nicht, eine Regel darin wäre also nur
> über ihren Quelltext zu behaupten — die Falle, in die diese Sitzung fünfmal gelaufen ist. Hier
> läuft sie gegen ein kleines DOM, das **antwortet**.
>
> **Sieben Mutationen, jede benannt und jede mit Nachweis, dass sie auf der Platte landete:** Alias
> entfernt, Alias auf den alten Abschnitt gelegt, jeder Hash öffnet, `open = true` blind gesetzt,
> die Anker aus `index.html` entfernt, Ladereihenfolge gekippt, `bootstrap.js` schreibt den Hash.
> Alle sieben rot. Der Test fand beim Schreiben ausserdem einen echten Fehler: der Auflöser schnitt
> das `#` **vor** dem Trimmen ab, ein Hash mit führendem Leerraum fiel durch.
>
> 🔁 **Und trotzdem prüfte er die Regel, nicht die Verdrahtung** (`88d85b27`). Fünf weitere
> Mutationen gingen durch, die erste davon ist die **gesamte Wirkung** des Commits:
>
> | Mutation | vorher | jetzt |
> |---|---|---|
> | `openLegalSectionFromHash();` beim Start **gelöscht** | grün | rot |
> | derselbe Aufruf mit `&& false` entschärft | grün | rot |
> | `hashchange`-Handler zu `() => {}` geleert | grün | rot |
> | Adresszeile per `history.replaceState(…, "#…")` bzw. `location.hash +=` geschrieben | grün | rot |
> | 💣 **zwei Anker in `index.html` vertauscht** — `#datenschutz` öffnet den Haftungsausschluss | grün | rot |
>
> Der letzte ist der realistischste und ausgerechnet die **🔴-Warnung dieses Moduls eine Ebene
> tiefer**: der Test prüfte, *dass* die acht ids da sind und *dass* es acht sind — nie, **welcher
> Abschnitt welche trägt**. Acht Attribute von Hand nachzutragen ist genau die Geste, bei der eine
> verrutscht. Jeder Anker ist jetzt gegen den i18n-Schlüssel seiner eigenen Überschrift festgenagelt,
> und ein echter Tausch wurde gefahren, um zu belegen, dass die Paarungs-Zusicherung greift und nicht
> die Doppel-id-Zusicherung.
>
> ⚠️ **Ausserdem behoben:** der Start-Aufruf stand ungeschützt auf oberster Ebene. Fällt
> `legal-anchor.js` je aus (404 während eines Deploys), riss ein `ReferenceError` dort die restlichen
> ~420 Zeilen von `bootstrap.js` mit — Schliessen-Knopf, sämtliche Editor-Öffner, der Escape-Riegel.
> Ein Anker fürs Impressum darf nicht die halbe Bedienung kosten. Abgesichert mit **try/catch statt
> `typeof`**: eine halb geladene Datei kann ihre `const` in der Todeszone stehen lassen, und dann
> wirft schon die Prüfung.
>
> **Live im Browser geprüft, alle drei Wege:**
>
> | Probe | Ergebnis |
> |---|---|
> | Neuladen mit `#impressum` | Fenster **offen**, „Kontakt und Impressum" **aufgeklappt** |
> | Neuladen mit `#irgendwas-fremdes` | Fenster bleibt **zu** |
> | `#datenschutz` bei offener Seite (`hashchange`) | Fenster **offen**, „Datenschutz" **aufgeklappt** |
>
> ⚠️ Meine erste Messung war falsch und ich habe sie verworfen: ein Hash-Wechsel lädt die Seite
> nicht neu, das Fenster stand noch von der vorigen Probe offen — und `hashchange` feuert
> asynchron, mein Lesen kam zu früh. Erst mit echtem Neuladen und Abstand zwischen Setzen und Lesen
> war die Messung etwas wert. 214/214 grün, Auslieferung bestätigt
> (`js/app/legal-anchor.js?v=d996dec000`, 8 von 8 Ankern im ausgelieferten HTML).
>
> 🔧 **DU: zwei Fragen, beide inhaltlich, keine technische.**
> 1. **Welche E-Mail-Adresse** soll das Impressum nennen? Das ist Inhalt und Exponiertheit, nicht
>    Technik — ich setze dir keine Adresse ins Impressum.
> 2. Soll das Impressum **zusätzlich eine eigene Seite** bekommen (`html/impressum.html`)? Dafür
>    spricht §5 TMG („unmittelbar erreichbar", ohne JavaScript); dagegen, dass eine neue,
>    indexierbare URL mit deinen Betreiberdaten eine Veröffentlichungsentscheidung ist. **Die treffe
>    ich nicht.** Sag Bescheid, dann baue ich sie.

### A25 · Das vollständige Kartenmaterial ist als Archiv verlinkt
**1,86 GB PNG plus 169 MB Kacheln.** Das steht in Spannung zur eigenen Fanregel-Zusage in
`NOTICE.md`, keine Bereitstellung „als reines Bilderarchiv" zu betreiben. Es ist der Punkt, an
dem das Projekt am ehesten angreifbar ist.

*Aufwand:* klein (Verlinkung), die Entscheidung gehört dem Owner.

---

## 8. Zwei Einzelstücke

### ✅ A26 · Kein Test läuft beim Deploy — und einer ist rot
> **Erledigt `36ea5f20`, 05.08.2026.** Der Deploy fährt alle Tests, bevor er etwas hochlädt. Erster Lauf auf dem CI-Läufer: **PHP 87 grün, JS 79 grün, null rot.**

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

> ⚠️ **Nachgeprüft am Abend des 05.08. — beides stimmt nicht.** Der Fix ist kein Rückbau, und klein
> ist er auch nicht. Zwei Gründe, beide im Code nachgelesen:
>
> 1. **Der frühe Reset ist tragend.** `resetRoutePresentation()`
>    (`js/map-features/map-features.js:161`) räumt nicht nur die Route ab, sondern auch die
>    Wegpunkt-Marker (`removeHighlightedRouteNodes()`) — und direkt danach baut
>    `renderRouteWaypointMarkers()` sie neu auf. Dieses Paar steht **wortgleich an allen drei**
>    Aufrufstellen (`route-engine.js:531`, `:616`, `routing.js:1455`). Wer den Reset hinter die
>    Berechnung schiebt, verdoppelt die Marker. Den fertigen Plan zu erhalten hiesse also:
>    Zustand **vor** dem Reset sichern und im Absage-Zweig zurückspielen — ein Bau, kein Rückbau.
> 2. **Die Absage nennt den Wegpunkt nicht.** Der abgelehnte Punkt ist eine Wegpunkt-Zeile mit Id
>    (`route-travel-here.js`, `getWaypointElementById`), aber die Fehlerantwort trägt nur einen Code.
>    Bei mehreren Kartenpunkt-Wegpunkten ist nicht bestimmbar, welcher gemeint war. Ihn zu entfernen
>    verlangt, dass die Absage ihre Zeile benennt — also eine Erweiterung des Rückwegs von
>    `updateMapView`.
>
> 🔧 **DU: was soll eine Absage hinterlassen?** Drei Formen, und es ist eine Produktfrage:
> **(a)** Der Punkt wird zurückgenommen, der vorige Plan bleibt stehen — ein Fehlklick kostet nichts.
> Verlangt beides: Zustandssicherung **und** die Id im Rückweg.
> **(b)** Nur der Punkt wird zurückgenommen, der Plan bleibt gelöscht — behebt die Endlosschleife
> („jede weitere Berechnung sagt erneut ab"), nicht den Verlust.
> **(c)** Nur der Plan wird erhalten, der Punkt bleibt stehen — behebt den Verlust, nicht die
> Endlosschleife.
>
> Der Befund beschreibt zwei Schäden; jede Form behebt einen oder beide, und (a) ist die einzige
> vollständige.

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

## 9. Sieben Nachträge — gefunden beim Gegenprüfen der eigenen Fixes

Nicht aus dem Testlauf, sondern aus den drei feindlichen Prüfungen der Reparaturen vom Nachmittag
des 05.08. Alle drei sind **älter als diese Fixes**; keiner der zwölf Prüfagenten hatte sie.
Nachgelesen und bestätigt, **nicht ausprobiert** — die ersten beiden ließen sich nur belegen,
indem man sie ausnutzt.

### A29 · Der Schlüssel der Stundengrenze steht in einem Anfrage-Kopf
`api/_internal/bootstrap.php:304-314`

`avesmapsClientIpAddress()` nimmt `X-Forwarded-For` und gibt das **linkeste** Element zurück —
ohne Proxy-Allowlist, ohne Prüfung, dass es überhaupt eine IP ist. Das linkeste Element ist genau
das, was der Aufrufer selbst gesetzt hat: hängt kein Proxy davor, gehört es ihm ganz; hängt einer
davor, wird dessen Wert **rechts** angehängt und der gefälschte bleibt vorn.

Damit ist jede Drossel im Haus wirkungslos, nicht nur die der Meldungen: ein neuer Kopfwert je
Anfrage ergibt einen frischen Eimer. Umgekehrt sperrt fünfmal die IP eines Fremden diesen eine
Stunde lang aus. Betroffen sind **vier** Stellen, die alle denselben Schlüssel bilden:
`report-location.php:444`, `contact.php:156`, `share-link.php:38`, `_internal/reviews.php:47`.

Nebenwirkung für den Datenschutz: `ip_hash` ist damit nicht der Hash einer IP, sondern der einer
beliebigen Zeichenkette des Aufrufers — und der HMAC-Schlüssel fällt ohne Import-Token auf den
**Datenbanknamen** zurück (`report-location.php:438-445`), also auf einen Konfigurationswert
statt auf ein Geheimnis.

*Beleg:* wörtlich gelesen; **bewusst nicht ausprobiert.** Ob STRATO den Kopf vorher überschreibt,
ist von außen nicht feststellbar und wäre als Verlass darauf ohnehin keine Verteidigung.
*Aufwand:* klein (Allowlist oder `REMOTE_ADDR`), Radius: alle vier Drosseln.

> **◐ Die Hälfte, die keine Entscheidung braucht, ist erledigt `864fe864`, 05.08.2026.** Der Wert
> muss jetzt **eine IP sein** (`FILTER_VALIDATE_IP`); ein Kandidat, der es nicht ist, wird
> **übersprungen** statt geglaubt. Damit fällt ein Aufrufer mit Müll im Kopf auf seine **eigene**
> `REMOTE_ADDR` zurück — genau den Schlüssel, dem er entkommen wollte —, und zwei verschiedene
> gefälschte Köpfe landen im **selben** Eimer statt in zweien. Spoofing mit beliebigem Text
> funktioniert nicht mehr. Auch der Datenschutz-Teil ist damit geschlossen: `ip_hash` ist wieder der
> Hash einer Adresse und nicht der einer beliebigen Zeichenkette. Drei Mutationen rot, 209/209 grün.
>
> **Live geprüft, spurenfrei** — `bootstrap.php` hängt an **vier** Drosseln, also alle vier angesehen:
> dieselbe Meldung auf „Gareth" antwortet **409** mit *und ohne* `X-Forwarded-For: nicht-eine-ip`
> (zeichengleich — der Müllkopf ändert nichts mehr), `contact.php` **405**, `share-link.php` **400**,
> `map-features.php` **200 / 19.236.101 Bytes**. Keine gespeicherte Zeile.
> **Offen bleibt**, was eine gültig *aussehende* fremde Adresse angeht — dafür braucht es die
> Topologie-Antwort unten. Ein Assert im Test hält diese Lücke ausdrücklich fest; er soll sich
> **ändern**, wenn die Entscheidung fällt, nicht verschwinden.
>
> 🔁 **Meine Diagnose-Abfrage hat die Frage NICHT beantwortet, und der Fehler war meiner.** Sie
> zählte `remote_ip` — eine Spalte, die der Melde-`INSERT` **absichtlich leer** lässt (gespeichert
> wird nur der Hash; die vier gefüllten Zeilen stammen von vor dieser Entscheidung). Ergebnis: 281
> Zeilen, **2** verschiedene `remote_ip` (277× leer), **92** verschiedene `ip_hash`. Was die 92
> immerhin **ausschliessen**: einen Proxy, der den Client verbirgt und *kein* `X-Forwarded-For`
> setzt — der würde alle auf **einen** Schlüssel zusammenfallen lassen. Übrig bleiben „kein Proxy"
> und „Proxy, der korrekt weiterreicht", und die verlangen gegensätzliche Fixes.
>
> 🔧 **DU: die Tatsachenfrage bleibt offen** — **sitzt ein Proxy davor?**
>
> | | `REMOTE_ADDR` nehmen | Rechtestes `X-Forwarded-For`-Element nehmen |
> |---|---|---|
> | **kein Proxy** | ✅ richtig | ❌ es gibt keins |
> | **Proxy davor** | 💣 **alle Besucher in EINEM Eimer** — nach fünf Meldungen ist die Seite für jeden gesperrt | ✅ richtig |
>
> Beide Wege sind einzeilig; nur die falsche Wahl ist teuer, und die teure Richtung ist ein
> Totalausfall der Meldungsstrecke. Ein einzelner `HEAD` auf die Startseite zeigt nur
> `Server: Apache/2.4.68 (Unix)` — kein `Via`, kein CDN-Kopf. Das *legt* „kein Proxy" nahe,
> beweist es aber nicht (ein transparenter Proxy wirbt nicht für sich).
>
> ⚠️ **Die Daten können es nicht mehr beantworten** — `remote_ip` wird aus gutem Grund nicht mehr
> geschrieben, und ein Hash verrät die Topologie nicht. `sql/a29-proxy-erkennung.sql` hat damit
> seinen Zweck verloren; es bleibt nur als Beleg für die 92 Schlüssel stehen. Was die Frage klärt,
> ohne eine Zeile zu speichern, ist eines von zweien:
> 1. **Die Auskunft des Hosters** — reicht STRATO die Anfragen über einen Reverse-Proxy? Steht das
>    in der Doku oder lässt sich der Support fragen, ist die Sache erledigt.
> 2. **Eine winzige, nur für Admins lesbare Diagnose**, die für die *eigene* Anfrage meldet, ob
>    `X-Forwarded-For` überhaupt ankommt und ob `REMOTE_ADDR` davon abweicht — **ohne** eine Adresse
>    zu zeigen oder zu speichern, nur zwei Wahrheitswerte. Sag Bescheid, dann baue ich sie; sie ist
>    kleiner als der Fix selbst.
>
> ⚠️ Unabhängig davon fehlt in beiden Fällen eine Prüfung, dass der Wert überhaupt eine IP **ist**
> (`filter_var(..., FILTER_VALIDATE_IP)`). Heute ist `ip_hash` deshalb nicht der Hash einer
> Adresse, sondern der einer beliebigen Zeichenkette des Aufrufers — das ist der
> Datenschutz-Teil des Befundes und gilt in jeder Topologie.

### A30 · `report_mode=change` ist ein unbegrenzter Schreibkanal ohne Anmeldung
`api/_internal/app/report-context.php:12-29`

Wer `"report_mode":"change"` schickt, **ist** im Änderungsmodus — es gibt keine Anmeldung, keine
Fähigkeit, kein Token, und `entity_public_id` wird auf 80 Zeichen gekürzt statt gegen irgendeine
Tabelle geprüft. Der Modus schaltet fünf Prüfungen ab: die „unter 3 Sekunden"-Falle, den
409-Namenskonflikt, die Stundengrenze, den Duplikat-Vermerk und die Quellenpflicht. Übrig bleiben
Honigtopf und sieben Spamwörter.

Die Zielscheibe ist der Prüfbildschirm: `avesmapsListLocationReportsForReview`
(`api/edit/reports/locations.php:58-89`) liest **alle** `status='neu'`-Zeilen samt `comment` und
`payload_json`, ohne `LIMIT` und ohne Seitenteilung. Und `avesmapsNormalizeCitymapLinkRows`
(`api/_internal/app/citymaps.php:1696-1725`) kappt die Zahl der Fundorte **nicht** — anders als
die Quellenliste, die bei 10 endet.

⚠️ **Zuschreibung ehrlich:** das Loch ist älter, `776c2b89` erzeugt es nicht. Vorher füllten
Änderungszeilen aber wenigstens den Eimer mit — nach dem Fix ist der Kanal in beiden Hälften
unsichtbar. Für die Verfügbarkeit ehrlicher Melder ist das richtig (das war A2), für die
Missbrauchslage ist es der Verlust des letzten Messpunkts.

*Beleg:* wörtlich gelesen; **bewusst nicht ausprobiert.** *Aufwand:* mittel.

> **◐ Die Zielscheibe ist entschärft `db9d350b` (+ `60e4afb5`), 05.08.2026 — der Kanal selbst ist 🔧 DU.**
> Die **offene** Warteschlange wurde ungedeckelt gelesen: jede `status='neu'`-Zeile aus **beiden**
> Tabellen, samt `comment`, ohne `LIMIT` und ohne Seitenteilung. Sie ist jetzt bei **500**
> gedeckelt — grösser als die 200 der bearbeiteten Liste, weil sie zu erledigende Arbeit ist und
> keine Chronik.
>
> ⚠️ **Zwei Präzisierungen an meiner eigenen Commit-Nachricht** (Behauptungsprüfer): `payload_json`
> steht nur in der `map_reports`-Abfrage, nicht in beiden, und wird vor der Antwort per `unset`
> entfernt — sie belastet also den Lesevorgang, reist aber nicht mit. Und der Deckel begrenzt
> **Zeilen, nicht Bytes**: je Tabelle werden 501 gelesen, danach gemischt und auf 500 geschnitten.
> Dass der ungedeckelte Lesevorgang „den Editor-Bildschirm umlegt", habe ich zweimal als Tatsache
> geschrieben — **gemessen ist es nicht**, und der Befund selbst vermerkt „bewusst nicht
> ausprobiert". Es bleibt eine begründete Erwartung, kein Messwert.
>
> ⭐ **Die Sortierung schützt den Rückstand** — und sie war schon richtig: offene Meldungen kommen
> **älteste zuerst**, eine Flut landet also am **Ende** und ist genau das, was abgeschnitten wird.
> Was ein Bearbeiter gerade abarbeitet, bleibt sichtbar. Dieselbe Deckelung auf einer
> neueste-zuerst-Liste hätte exakt die Meldungen versteckt, auf die es ankommt.
>
> 🔁 **Ich hatte das als „macht den Deckel unbedenklich" verkauft. Das ist zu stark, und der
> Unterschied ist wichtig.** Geschützt ist der Rückstand, der **vor** einer Flut da war. Jede
> **ehrliche Meldung, die danach eintrifft**, landet am neuen Ende — und ist dann von **keiner**
> Oberfläche mehr erreichbar: es gibt kein `OFFSET`, kein „mehr laden", keine Gesamtzahl, keine
> Massenaktion. 100.000 Flutzeilen heissen: die echten Meldungen von morgen sind unsichtbar, bis
> jemand an die Datenbank geht. Neueste-zuerst hätte das Spiegelproblem. **Die eigentliche Antwort
> ist Seitenteilung** (oder wenigstens ein `total`-Feld), und die fehlt — der Deckel ist eine
> Notbremse, keine Lösung. Ohne die Grenze am Schreibkanal (🔧 DU, unten) bleibt es dabei.
>
> 🔁 **Und genau diese Eigenschaft war zunächst NICHT gesichert** (gefunden vom Behauptungsprüfer,
> von mir nachgestellt). Ich hatte zugesichert, sie stehe „neben dem Deckel, damit sie niemand
> später zu `DESC` aufräumt" — zugesichert war aber nur der **SQL**-`ORDER BY`. Die Reihenfolge
> entscheidet das SQL gar nicht: beide Tabellen werden mit eigenem `ORDER BY` gelesen, die
> endgültige Folge vor dem `array_slice` kommt aus einem **`usort` über die gemischte Menge** im
> Endpunkt. Den drehte ich testweise auf neueste-zuerst — **alle 208 Tests blieben grün**, während
> der Deckel anfing, die **ältesten** offenen Meldungen wegzuschneiden. Behoben in `60e4afb5`: der
> Vergleicher ist jetzt wörtlich zugesichert, und die Zeile trägt einen Kommentar, warum eine
> Zusicherung auf das SQL sie nicht abdeckt.
>
> **Zwei Hälften, zwei Deckel, zwei Flaggen.** `truncated`/`limit` behalten ihre Bedeutung für die
> bearbeitete Hälfte, die offene meldet über `open_truncated`/`open_limit`. Eine gemeinsame Flagge
> könnte über eine der beiden nur etwas Falsches sagen.
>
> Die Oberfläche trug einen Kommentar, der das Gegenteil versprach („die offenen sind vollständig").
> Er war richtig, als er geschrieben wurde, und ist es jetzt nicht mehr — eine veraltete Beruhigung
> ist dieselbe „mehr gibt es nicht"-Lüge, gegen die dieser Befund angetreten ist, nur in Prosa.
> Hinweis und Kommentar nennen jetzt die tatsächlich gekürzte Hälfte und schweigen, wenn nichts
> gekürzt wurde.
>
> **Zwei bestehende Tests fielen um und hatten recht damit** — einer sicherte zu, die offene
> Warteschlange werde *nie* gekürzt, der andere die alte Formulierung. Beide sagen jetzt die neue
> Absicht und warum sie die alte ablöst. Fünf von fünf Mutationen rot, 208/208 grün.
>
> **Live gegengeprüft** (203 s nach dem Push, nach der PHP-Verzögerung): der Editor-Endpunkt
> antwortet anonym **401** — er lädt also, ein Parsefehler wäre eine 500; `map-features.php`
> unberührt bei **200 / 19.236.101 Bytes**; und der neue Client ist wirklich draussen (**5** Treffer
> auf `open_truncated`/`reviewReportsOpenTruncated` in der ausgelieferten Datei). Die Deckelung
> selbst lässt sich von aussen nicht messen — sie greift erst über 500 offenen Meldungen, und die
> herbeizuführen hiesse, 500 Zeilen in die Produktionsdatenbank zu schreiben.
>
> 🔁 **Korrektur an meiner eigenen Commit-Nachricht.** Dort steht, ein alter Client formuliere
> während der Deploy-Schräglage weiterhin richtig. **Das stimmt nicht**, und zwar an zwei Stellen:
> bei Filter „Offen" fällt er in seinen Else-Zweig und schreibt *„Von den bearbeiteten werden nur
> die neuesten 500 gezeigt"* — falsche Hälfte, falsche Richtung, falsche Zahl; und bei „Alle", wenn
> **nur** die offene Hälfte gekürzt wurde, sagt er **gar nichts** — genau die stille Kürzung, gegen
> die dieser Befund angetreten ist.
>
> ⚠️ **Auch das Zeitfenster hatte ich falsch beziffert** („2–4 Minuten PHP-Verzögerung"). Das JS
> wird nur beim **Seitenaufbau** geholt; ein Bearbeiter mit offenem Editor-Tab pollt alle 45 s mit
> dem **alten** JS gegen das neue PHP, bis er neu lädt. Das sind **Stunden, nicht Minuten**.
> Ausgelöst wird es weiterhin erst über 500 offenen Meldungen (heute 13). Den Payload habe ich
> trotzdem nicht verbogen: eine dauerhaft unehrliche Antwort — „nicht gekürzt", obwohl gekürzt —
> wäre schlechter als ein Fenster mit einem falschen Satz.
>
> 🔧 **DU: der Schreibkanal bleibt offen, und das ist eine Produktfrage.** `report_mode=change`
> erreicht die Datenbank ohne Anmeldung, ohne Fähigkeit, ohne Token, und die Stundengrenze zählt
> diese Zeilen nicht mit. ⚠️ *Zuschreibung korrigiert:* meine Commit-Nachricht schrieb „seit A2",
> als habe A2 die Schranke entfernt. Das stimmt nicht — die Ausnahme für den Änderungsmodus sass
> **schon vor A2** auf der Prüfung (`report_mode !== 'change' && …`); A2 hat nur den
> Kollateralschaden an **neuen** Meldungen behoben. Der Befundtext oben sagt es richtig („das Loch
> ist älter"), die Commit-Nachricht übernahm diese Ehrlichkeit nicht. Beides ist so gewollt — anonyme
> Änderungsvorschläge *sind* das Feature, und A2 hat ehrliche Melder absichtlich entsperrt. Ob der
> Kanal trotzdem eine eigene, grosszügigere Grenze bekommen soll (z.B. 30/Stunde statt 5), ist
> deine Entscheidung, nicht meine: jede Zahl, die ich hier setzte, nähme A2 teilweise zurück.
> 💣 **Und der Deckel zählt ZEILEN, nicht BYTES — der Bildschirm kann weiterhin sterben, nur bei
> 500 statt bei N.** Durchgerechnet: `payload_json` ist `TEXT` (65.535 Bytes), `comment` 800
> Zeichen; `avesmapsNormalizeCitymapLinkRows` (`api/_internal/app/citymaps.php:1696-1725`) kappt
> die **Zahl der Fundorte** je Meldung weiterhin nicht — rund 85 Links maximaler Grösse füllen die
> Spaltendecke. Das sind **~80 KB je Zeile × 500 ≈ 40 MB** JSON, die PHP mehrfach hält (gepuffertes
> `fetchAll`, das dekodierte `citymap_link`, dann die kodierte Antwort). Auf STRATO ist das der
> `memory_limit`-Abbruch.
>
> 💣 **Diese 64-KB-Zeile ist anmeldefrei erreichbar**, und die Kombination ist der Punkt:
> `report_mode` wird **unabhängig von `report_type`** aus dem Payload gelesen
> (`report-context.php:13`), die Fundort-Normalisierung hängt allein an `report_type`
> (`report-location.php:280-282`). Ein `{"report_type":"fundort","report_mode":"change"}` bekommt
> also die **grosse Nutzlast** *und* die Befreiung von der Stundengrenze. Ein POST, keine Anmeldung.
>
> **✅ Diese Hälfte ist erledigt `09318c8c`, 05.08.2026.** `avesmapsNormalizeCitymapLinkRows`
> deckelt die Zeilenzahl jetzt bei **20** — **zurückgewiesen, nicht abgeschnitten** (Hausform; ein
> still gekürzter Vorschlag ist eine Behauptung über etwas, das der Melder nie gesagt hat). Die
> Ausnahme fällt in `avesmapsValidateMapReport` (`:87`) und damit **vor** dem `INSERT` (`:166`) und
> vor dem teuren Namensabgleich — sie kostet also fast nichts und hinterlässt keine halbe Zeile;
> der Aufrufer bekommt eine **400** mit einer eigens formulierten Meldung, kein Leck.
>
> ⭐ **Die 20 ist gemessen, nicht geraten** (je eine Anfrage an die öffentlichen Endpunkte):
> **456 Karten tragen live höchstens 2 Fundorte** (Verteilung 0:47, 1:123, 2:286) — der Deckel ist
> das **Zehnfache** des beobachteten Maximums. Der Wiki-Sync baut seine Zeilen an diesem
> Normalisierer vorbei und liefert ohnehin genau eine.
>
> 💣 **Derselbe Deckel im Zwilling.** `avesmapsNormalizeAdventureLinkRows` hatte dasselbe Loch —
> und der Kommentar auf der Kartenseite nennt ihn ausdrücklich sein **Vorbild**. Ein Vorbild ohne
> Zeilendeckel vererbt genau den weiter. Auch dort gemessen: **1.352 Abenteuer tragen höchstens 4
> Links**. Anmeldefrei erreichbar ist er heute nicht (einziger Aufrufer hinter einer Fähigkeit),
> die Grössenrechnung ist aber dieselbe.
>
> Leerzeilen zählen weiterhin nicht mit (eine abschliessende leere Zeile im Zeileneditor ist keine
> Zeile), und genau 20 gehen durch. Vier von vier Mutationen rot: Riegel entfernt, abschneiden statt
> abweisen, Deckel unter den Live-Bestand gesetzt, und ein Off-by-one, das 21 daraus gemacht hätte.
>
> **Live an der Grenze gemessen, und zwar spurenfrei** — mit genau dem Angriffs-Payload
> (`report_type=fundort` + `report_mode=change`), plus einer **ungültigen Koordinate** als
> Sicherheitsgurt: die Koordinatenprüfung läuft **nach** der Normalisierung, wirft aber ebenfalls
> vor dem `INSERT`. Hätte der Deckel nicht gegriffen, wäre die Meldung also trotzdem an ihr
> gestorben. Zwei Anfragen:
>
> | Probe | Antwort |
> |---|---|
> | **21** Zeilen | `400` · `"Zu viele Links (max. 20)."` — der Deckel greift |
> | **20** Zeilen | `400` · `"Die Koordinate lat ist ungueltig."` — der Deckel greift **nicht**, die Prüfung läuft weiter |
>
> Das ist die Grenze von beiden Seiten, ohne eine einzige gespeicherte Zeile — was hier zählt, weil
> es für `map_reports` bis heute keinen Löschweg gibt (A3/A28).
>
> 🔁 **Und damit war es NICHT erledigt: ein Zeilendeckel ist kein Grössendeckel.** Der Gegenprüfer
> hat genau das gefunden, was der Commit zu schliessen erklärte, und ich habe es nachgestellt:
> **20 Zeilen, jede innerhalb ihrer eigenen Grenze, ergeben 83.421 Bytes** — gegen eine
> `TEXT`-Spalte von 65.535.
>
> Die Verstärkung steckt in den **Einheiten**: der Titel wird mit `mb_strlen` geprüft (ZEICHEN), die
> URL mit `strlen` (BYTES), und **keines** misst die kodierte Grösse. `json_encode` muss jedes
> C0-Steuerzeichen als `\u00XX` schreiben — sechs Bytes für eines —, und weder `trim()` noch die
> `\s+`-Zusammenfassung entfernt `\x01`.
>
> Was das gekostet hätte: im Strict-Modus wirft MySQL 1406, der Melder bekommt eine **500** für eine
> Meldung, die für ihn richtig aussah. **Ohne** Strict-Modus ist es schlimmer, weil still — die
> Zeile wird gekürzt, `json_decode` liefert im Prüfbildschirm `null`, und die Freigabe antwortet für
> immer „Zu welcher Karte gehoert der Fundort?". Diese Meldung ist dann **weder freizugeben noch zu
> löschen**.
>
> **✅ Behoben `f1bf289a`.** `avesmapsEncodeReportPayloadJson` weist alles über **60.000 Bytes** ab —
> unterhalb der Spalte statt an ihr entlang, denn ein Riegel bei exakt 65.535 reicht der Datenbank
> immer noch eine Zeile, die sie ein Byte später ablehnt. Abgewiesen, nicht gekürzt. Er liegt in der
> Bibliothek statt im Endpunkt-Skript — **erst das macht ihn überhaupt prüfbar**, weil sich ein
> Endpunkt nicht laden lässt, ohne seinen Request-Handler auszuführen. Vier von vier Mutationen rot.
>
> ⚠️ **Der Byte-Riegel selbst ist NICHT spurenfrei live prüfbar, und ich habe es deshalb gelassen.**
> Er läuft am **Ende** der Validierung, also nach der Koordinatenprüfung — der Sicherheitsgurt von
> vorhin greift hier nicht mehr. Und zwischen Validierung und `INSERT` gibt es für einen Fundort
> kein weiteres Tor: der 409-Namenskonflikt gilt nur für `report_type='location'`. Jede Probe, die
> den Riegel auslöst, hinterliesse bei einem Versagen genau die Zeile, für die es keinen Löschweg
> gibt. Belegt ist er durch die Nachstellung gegen den ausgelieferten Code (83.421 Bytes) und durch
> den Test; **live geprüft ist, dass der umgebaute Pfad trägt**: 21 Zeilen → „Zu viele Links (max.
> 20).", 20 Zeilen → „Die Koordinate lat ist ungueltig.", `map-features.php` unverändert
> 200/19.236.101 Bytes.
>
> ⚠️ **Ein Wortfehler in meiner Commit-Nachricht, der teuer werden könnte:** dort steht „456 live
> maps carry at most 2 **places**". Die gemessene Verteilung ist das Feld **`links`**, nicht
> `places`. `places` gibt es daneben und es ist anders gross — auf der **Abenteuer**-Seite live
> **max. 22**, also **über** dem Deckel von 20. Wer später „denselben Zwillings-Deckel" auf eine
> `places`-Liste überträgt, bricht damit sofort echte Daten.
>
> ⚠️ Nebenbefund, heute harmlos: `avesmapsAddCitymapLink` normalisiert **eine** Zeile, der Deckel
> kann dort also nie greifen. Er bindet damit **je Aufruf**, nicht je Karte — Community-Freigaben
> können unbegrenzt anwachsen. Der Editor bricht daran nicht, weil die Detail-Lesung fremde Zeilen
> getrennt und schreibgeschützt führt und sie nie über `set_links` zurückschickt.

### ✅ A31 · Die Drossel sitzt hinter dem teuersten Teil des Endpunkts
`api/app/report-location.php:93` und `:94` gegen `:103`

Die Reihenfolge ist verkehrt: `avesmapsEnsureMapReportsTable` (1 × `CREATE TABLE IF NOT EXISTS`,
7 × `SHOW COLUMNS`, 1 × `SHOW INDEX`) und `avesmapsLocationNameExists` (**zwei ungegrenzte
Volltabellen-Scans** plus ~4.700 Unicode-Regex-Läufe in PHP) laufen **vor** der Stundengrenze.
Wer über der Grenze steht, löst sie mit jeder Anfrage weiter aus und bekommt dafür ein 429 — die
Drossel kostet also mehr, als sie spart. Auf einem Host, der dreimal an Last ausgefallen ist, ist
das kein Randthema.

Dieselbe Reihenfolge ist auch der Grund, warum A1s Ununterscheidbarkeit am Zeitkanal endet: der
stille Weg kehrt vor der Datenbankverbindung um.

*Beleg:* am Kontrollfluss abgelesen, Abfragen gezählt. *Aufwand:* klein (Grenze nach vorn ziehen),
berührt aber die Reihenfolge der Antworten und gehört deshalb geprüft, nicht nebenbei verschoben.

> **✅ Erledigt `9f05463f`, 05.08.2026.** Die Stundengrenze wird jetzt **vor** dem Namensabgleich
> entschieden. Neue Reihenfolge: DDL → **Drossel** → Namensabgleich → Duplikatprobe → `INSERT`.
> Wer über der Grenze steht, zahlt die beiden ungedeckelten Vollscans nicht mehr.
>
> 🔁 **Ich habe den Nutzen zu gross geschrieben — hier die Korrektur (Gegenprüfung, von mir am Code
> nachgestellt).** Ich behauptete, der Tausch schliesse ein Oracle: über der Grenze gebe es nur noch
> 429. **Das greift für den Aufrufer nicht, um den es geht.** Die Stundengrenze zählt
> **gespeicherte Zeilen** (`SELECT COUNT(*) FROM map_reports`), und ein 409 speichert nichts — er
> bricht vor dem `INSERT` ab. Wer mit **existierenden** Namen probt, füllt den Eimer also **nie**,
> steht nie über der Grenze, und behält Antwort *und* ungedeckelten Scan auf **jeder** Anfrage,
> dauerhaft. Für ihn ist der Endpunkt jetzt sogar **eine Abfrage teurer** (der `COUNT` läuft neu
> davor). → eigener Befund **A38**.
>
> ⚠️ Und die Namen sind ohnehin nicht geheim: `GET /api/locations/` liefert alle **4.861**
> anmeldefrei aus. Nicht-öffentlich war immer nur die **zweite** Hälfte der Prüfung — die offenen
> Meldungen in `map_reports`. Für die ist der Tausch ein echter Gewinn.
>
> ⚠️ Zwei weitere Zahlen von mir waren zu hoch: es sind **~2.777** Ortszeilen, nicht ~4.700 (die
> 2.084 Kreuzungen filtert die Abfrage über `feature_type='location'` weg), und die Normalisierung
> kostet gemessen **0,59 ms für den ganzen Satz** — der Treiber sind Abfrage und Zeilen-Hydration,
> nicht die Regex. Bei einem **treffenden** Namen bricht die Schleife ab, ein 409 kostet also
> **einen** Scan, nicht zwei. „Ohne `LIMIT`" heisst zudem nicht „Volltabellenscan": beide Tabellen
> haben einen Index auf der gefilterten Führungsspalte.
>
> Was bleibt: wer wirklich fünf Meldungen gespeichert hat, zahlt die Scans nicht mehr — und die
> nicht-öffentliche Hälfte des Oracles ist hinter der Drossel.
>
> ⚠️ **Was sich für einen ehrlichen Melder ändert:** über der Grenze **und** mit kollidierendem
> Namen kommt jetzt 429 statt 409. Das ist die bessere der beiden Antworten — „komm in ein paar
> Minuten wieder" ist handlungsleitend, und der Namenskonflikt steht dann immer noch da.
>
> ⚠️ `avesmapsEnsureMapReportsTable` bleibt **bewusst über beiden**: die Drosselabfrage liest
> `map_reports`, eine frische Installation antwortete sonst 500 statt zu drosseln. Der Test hält
> auch das fest.
>
> **Zwei Mutationen rot, und die erste ist keine Erfindung:** die Datei aus `git` im Vorzustand
> zurückgespielt lässt die Reihenfolgen-Zusicherung fallen; das DDL unter die Drossel geschoben
> lässt die Frische-Installations-Zusicherung fallen.
>
> 🔁 **Aber der Test prüfte Position, nie Wirkung — und liess eine tote Drossel durch** (`3d9cd9f5`).
> Nachgestellt: `!==` zu `===` in der Bedingung, oder ein `false &&` davor, schaltet sie vollständig
> ab und **alle 208 Tests blieben grün**; ebenso das Entfernen des `report_type`-Riegels, das die
> beiden Scans für *jeden* Meldetyp laufen liesse. Jetzt sind die **Bedingungen selbst**
> zugesichert, alle drei Mutationen rot. 209/209 grün.
>
> **Live geprüft, spurenfrei:** eine Meldung auf den bestehenden Ort „Gareth" antwortet weiter
> **409 `conflict`** — der Namensabgleich läuft nach dem Tausch also unverändert, und der Endpunkt
> ist gesund (der 409 bricht vor dem `INSERT` ab, es bleibt nichts liegen). ⚠️ **Die Reihenfolge
> selbst ist von aussen nicht messbar**: dafür müsste ich über der Stundengrenze stehen, und
> dorthin käme ich nur, indem ich fünf echte Meldungen speichere, für die es keinen Löschweg gibt.
> Belegt ist sie durch die Mutation mit dem echten Vorzustand.
>
> ⚠️ **Nachtrag aus der A30-Gegenprüfung (05.08.2026): der Befund ist schlimmer als notiert, weil
> die zweite Menge WÄCHST.** `avesmapsLocationNameExists` (`report-location.php:527-565`) liest
> nicht nur alle aktiven Orte, sondern auch **alle offenen `map_reports` mit
> `report_type='location'`** — und diese Menge lässt sich anmeldefrei füllen: ein
> `report_mode=change` mit `report_type:'location'` wird als `report_type='location'`,
> `status='neu'` gespeichert und zählt **nicht** gegen die Stundengrenze. Jede Meldung eines
> ehrlichen Melders zahlt danach beide Vollscans über eine Menge, die ein Fremder beliebig
> aufgebläht hat — auch die Anfrage, die anschliessend ein 429 bekommt. Die Grenze nach vorn zu
> ziehen behebt die halbe Rechnung; die andere Hälfte ist der Kanal selbst (A30, 🔧 DU).

### A35 · Auf einer frischen Installation bleibt jede Geländeart bei Faktor 1,00
`api/_internal/app/ecosystem.php:342` / `:476` / `:817` gegen `:845`

Die Reihenfolge in `avesmapsEcosystemEnsureTables` ist verkehrt herum:

| Schritt | Zeile |
|---|---|
| `ecosystem_region_type` wird **leer** angelegt | 342 |
| Startwerte `terrain_*` per `UPDATE` | 476–486 |
| Startwerte `offroad_factor` per `UPDATE` | 817–839 |
| **die Saat, die die Zeilen erst anlegt** | **845** |

Auf einer frischen Datenbank treffen beide `UPDATE`-Blöcke **null Zeilen** — die Tabelle ist zu
diesem Zeitpunkt leer. Ihre Wächter (`if (!$typeColumnExists($pdo, 'offroad_factor'))`,
`in_array('terrain_grain', $typeColumnsAdded, true)`) sind so gebaut, dass sie nur in dem Lauf
feuern, der die Spalte anlegt — sie kommen also **nie wieder**.

**Folge:** jede Geländeart behält dauerhaft `offroad_factor = 1.00`. Sumpf 3,00, Dschungel 2,40,
Gebirge 2,20 stehen nur im Code; Querfeldein rechnet über Sumpf so schnell wie über offenes Land.
Dasselbe für die `terrain_*`-Startwerte. Und es fällt niemandem auf: `offroad-data.php:138-140`
verschluckt einen „Unknown column" mit `catch (Throwable) { return ''; }`.

⚠️ **avesmaps.de ist NICHT betroffen** — dort wurden die Spalten auf eine bereits gefüllte Tabelle
nachgerüstet, die `UPDATE`s trafen also Zeilen. Der Fehler wartet auf die nächste frische
Installation, ein wiederhergestelltes Backup in eine leere Datenbank oder eine Entwicklungsumgebung.

💣 **Der naheliegende Fix ist falsch, und das ist der eigentliche Wert dieses Eintrags.** „Die Saat
einfach nach vorn ziehen" bricht etwas anderes: der `south_type_key`-Nachtrag (`:402`) liest
unmittelbar davor die Vokabeltabelle und ordnet zu, welche Klimagrenze zu welcher Zone gehört —
„Linie k gehört zu Zone k+1". Läuft die Saat vorher, kennt die Tabelle eine neu eingefügte Zone
bereits, und **jede Grenze unterhalb der Einschubstelle bekommt den falschen Schlüssel**. Der
Kommentar dort verbietet es wörtlich: „💣 DAS NACHTRAGEN MUSS HIER STEHEN — **VOR**
`avesmapsEcosystemSeedRegionTypes()`."

**Drei Bedingungen, die in verschiedene Richtungen ziehen** — wer A35 anfasst, muss alle drei halten:

1. Die **Saat** muss **nach** dem `south_type_key`-Nachtrag laufen (sonst verschiebt sich die
   Zuordnung der Klimagrenzen um eine Stelle).
2. Die **Startwerte** müssen **nach** der Saat laufen (sonst treffen sie null Zeilen — dieser Befund).
3. Die Startwerte müssen **genau einmal** laufen, im Lauf, der die Spalte anlegt. Der Kommentar bei
   `:815` sagt warum: „a shared ‚was anything new?' flag would re-run the terrain seed and **silently
   reset every value the owner has adjusted since**" — es sind **Datenzeilen**, die der Owner in der
   Datenbank verstellt.

Daraus folgt die einzige zulässige Form: **Nachtrag → Saat → Startwerte**, wobei die vier
Startwert-Blöcke (`terrain_grain`, `terrain_mean_height`, `affects_paths`, `offroad_factor`) hinter
die Saat wandern und ihre „gerade erst angelegt"-Wächter als Merker mitnehmen. Bei `affects_paths`
und `offroad_factor` stecken ALTER und `UPDATE` heute im **selben** `if` und müssen dafür getrennt
werden.

⚠️ **Auf avesmaps.de ändert der Fix nichts** — dort ist die Tabelle gefüllt, beide Reihenfolgen
verhalten sich identisch, und die Wächter feuern ohnehin nicht mehr. Das macht ihn ungefährlich,
aber auch unprüfbar: belegen lässt er sich nur gegen eine frische Datenbank.

*Beleg:* Reihenfolge, Wächter und beide 💣-Kommentare gelesen; gefunden beim Gegenprüfen von A19.
*Aufwand:* klein in Zeilen, aber drei gegenläufige Bedingungen — nicht nebenbei.

### A34 · Kein PHP-Endpunkt liefert je einen ETag aus — der ganze 304-Mechanismus ist tot
`.htaccess:28` gegen `api/app/map-features.php:131`

Gemessen am 05.08.2026: **weder** `GET /api/app/map-features.php` **noch** `GET /api/locations/`
liefert einen `ETag`-Kopf an den Client — obwohl beide ihn setzen. `Cache-Control` aus **derselben
Codezeile** kommt durch, und eine statische Datei behält ihren eigenen ETag. Es wird also gezielt
dieser eine Kopf entfernt.

Die `.htaccess` schickt jedes `application/json` durch mod_deflate
(`AddOutputFilterByType DEFLATE application/json`, Zeile 28); dessen `DeflateAlterETag` verändert
oder entfernt den Kopf. `Vary: Accept-Encoding,User-Agent` in der Antwort ist dessen Fingerabdruck.

**Folge:** die aufwendige 304-Maschinerie des Kartenendpunkts hat **nie** funktioniert. Kein Client
bekommt je einen ETag, also sendet keiner `If-None-Match`, also feuert der 304-Zweig nie — jeder
Reload lädt die vollen ~2,8 MB (gzip) neu. Die Kommentare dort erklären sorgfältig, warum die
Klimazonen-Marke im ETag-Seed stehen muss und wann die Payload-Version zu erhöhen ist; all das
schützt einen Mechanismus, der nicht läuft.

💣 **Die naheliegende Reparatur ist genau die, die schon einmal die Seite umgelegt hat.**
`DeflateAlterETag` ist in `.htaccess` **nicht erlaubt** — der Versuch am 05.08. warf Apache-500 auf
*alles* (zurückgenommen in `fdd4fc42`).

✅ **Nachgemessen am Abend des 05.08. — es gibt einen Weg ganz ohne Serverkonfiguration.** Vier
Abrufe, kein einziger Codeeingriff:

| Abruf | ETag | `Last-Modified` |
|---|---|---|
| `css/base/tokens.css` **mit** gzip | **entfernt** | ✅ da |
| dieselbe Datei **ohne** gzip | ✅ da | ✅ da |
| `favicon.ico` (nicht komprimierbar) | ✅ da | ✅ da |
| `map-features.php` / `ecosystem-areas.php`, mit **und** ohne gzip | **entfernt** | — (wird nicht gesetzt) |

**Die entscheidende Zeile ist die erste:** in genau der Antwort, aus der der ETag entfernt wurde,
ist `Last-Modified` **geblieben**. Was hier greift, zielt also auf den ETag und nichts sonst. Dazu
kommt: ein **PHP-gesetztes** `Cache-Control` kommt an — PHP-Kopfzeilen werden also nicht pauschal
verworfen.

➡️ **Damit ist `Last-Modified` + `If-Modified-Since` der Weg**: rein in PHP, ohne eine Zeile
`.htaccess`, ohne das Risiko, das am 05.08. die Seite gekostet hat. Er braucht je Endpunkt einen
ehrlichen Zeitstempel — für den Kartenpayload etwa `MAX(updated_at)` aus `map_features`.

⚠️ **Ein Rest bleibt Schlussfolgerung, nicht Messung:** dass ein **PHP-gesetztes** `Last-Modified`
ankommt, ist aus den drei Beobachtungen oben gefolgert, nicht direkt gemessen — kein Endpunkt setzt
heute eines, und um es zu messen müsste man eines ausliefern. Ein Kopf auf einem kleinen Endpunkt
genügt dafür.

🔧 **DU:** die Entscheidung ist damit keine zwischen „riskant" und „unbekannt" mehr, sondern
zwischen `Last-Modified` in PHP (billig, ohne Serverrisiko) und `application/json` aus der
DEFLATE-Liste nehmen (kostet 2,8 MB Kompression je Kartenaufruf).

*Beleg:* live gemessen (beide Endpunkte, dazu `favicon.ico` als Gegenprobe). *Aufwand:* klein, aber
nur mit einer Probe auf dem echten Server zu verantworten.

### A32 · Eine zurückgestellte Meldung lässt sich nie wieder anfassen
`api/edit/reports/locations.php` (`AND status = 'neu'` in jedem Schreibpfad)

„Zurückstellen" (`in_review`) ist als Entscheidung vorgesehen und hat sogar ein eigenes Etikett im
Änderungsprotokoll. Nur: **jeder** Schreibpfad verlangt `AND status = 'neu'`. Eine zurückgestellte
Meldung ist damit aus der Arbeitsschlange raus und kann nie wieder angenommen oder verworfen werden
— sie ist eingefroren, nicht aufgeschoben.

Bis A3 fiel das niemandem auf, weil sie danach ohnehin unsichtbar war. Jetzt ist sie sichtbar, und
die Sackgasse damit auch. (Im Panel heißt der Filter deshalb „Bearbeitet", nicht „Erledigt" —
zurückgestellt ist nicht erledigt.)

⚠️ Der Vollständigkeit halber: **kein Client schickt `status: "in_review"`.** Der Zustand entsteht
heute nur über den Import-Endpunkt (A33) oder von Hand in der Datenbank.

*Beleg:* am Kontrollfluss abgelesen. *Aufwand:* klein (die Schreibpfade auf `status <> 'approved'`
o. ä. öffnen) — aber es ist eine Produktentscheidung, was „zurückgestellt" bedeuten soll.

### ✅ A33 · Der Import-Endpunkt schreibt jeden beliebigen Status
`api/import/location-reports/update-status.php:26`

Der Status wird nur auf 20 Zeichen gekürzt, **ohne Whitelist** — anders als im Editor-Endpunkt
(`api/edit/reports/locations.php`), der auf `approved|rejected|in_review` prüft. Ein Tippfehler im
Importwerkzeug schreibt einen Status, den keine Oberfläche kennt; die Meldung erscheint dann unter
„Bearbeitet", trägt ein Etikett, das niemand vergeben wollte, und ist wegen A32 eingefroren.

*Beleg:* wörtlich gelesen. *Aufwand:* klein (dieselbe Whitelist wie nebenan).

> **✅ Erledigt `7aedccb3`, 05.08.2026.** Der Import-Endpunkt hat jetzt einen Riegel, und der Editor
> gibt seine eigene Kopie ab — **die Kopie war der Befund**.
>
> ⭐ **Die Liste wird ABGELEITET, nicht ein zweites Mal geschrieben:**
> `array_keys(AVESMAPS_REPORT_MODERATION_AUDIT_ACTIONS)`.
>
> 🔁 **Aber meine Begründung dafür war falsch, und zwar für genau den Endpunkt, den ich repariert
> habe** (Gegenprüfung, von mir am Code nachgestellt). Ich schrieb, „setzbar heisst auditiert" —
> das gilt für die **Editor**-Tür. Der **Import**-Endpunkt schreibt **null** Audit-Einträge (kein
> `avesmapsLogReportModeration`, kein `avesmapsWriteMapAuditLog`). Mit gültigem Token lässt sich
> also weiterhin jede Meldung auf `approved`/`rejected`/`in_review` setzen — **ohne jede Spur**.
> Das ist A4 durch die andere Tür, und es ist grösser als A33. → **A39**.
>
> ⚠️ **`neu` bleibt bewusst draussen** — das ist der Zustand, in dem eine Meldung *ankommt*, nicht
> einer, den ein Bearbeiter wählt. Ob eine entschiedene Meldung dorthin zurück darf, ist **A32** und
> deine Entscheidung; fällt sie, gehört der Eintrag in die Audit-Karte und erscheint hier von selbst.
>
> Die Absage **nennt die erlaubten Werte**: dieser Endpunkt antwortet einer Maschine, deren Betreiber
> ein Protokoll liest, und „ungueltig" allein schickt ihn genau dann in den Quelltext, wenn er das
> nicht sollte. ⚠️ Kein Informationsleck: die Token-Prüfung steht bei `:16`, der Riegel bei `:41` —
> ein Unbefugter sieht weiterhin nur 401. Und er greift vor `avesmapsCreatePdo` (`:49`), kostet also
> nicht einmal eine Datenbankverbindung.
>
> **Mutationen — und hier habe ich mich selbst überschätzt.** Ich meldete „vier rot" und schrieb
> „beide Bedingungen vollständig festgenagelt". Die Gegenprüfung fuhr sechs andere: **vier davon
> blieben grün** (`9106f84d` behebt es):
>
> | Mutation | vorher | jetzt |
> |---|---|---|
> | Riegel **loggt** statt abzulehnen (vorhanden, richtig platziert, wirkungslos) | grün | rot |
> | `$newStatus` zwischen Riegel und `UPDATE` neu aus dem Payload gelesen | grün | rot |
> | `in_array(…, true)` in der Bibliothek durch `true` ersetzt | grün | rot |
> | zweite Kopie im Editor mit **doppelten** Anführungszeichen | grün | rot |
>
> Dazu war eine meiner Zusicherungen eine **Tautologie**: sie verglich
> `avesmapsReportModerationStatuses()` mit genau dem, was die Funktion zurückgibt — sie konnte nie
> rot werden, während ich sie als Beweis verkaufte. Und eine andere reagierte auf die **Reihenfolge**
> der Audit-Karte, die nichts bedeutet; verglichen wird jetzt als Menge.
>
> Das war in dieser Sitzung das **dritte** Mal, dass meine Tests Position statt Wirkung prüfen
> (A21: die Hülle statt der Transaktionsreichweite; A31: das SQL statt der Sortierung, dann die
> Bedingung). 209/209 grün.
>
> **Live geprüft, spurenfrei** (der Import-Endpunkt schreibt ohne gültiges Token nichts): ein POST
> ohne Token mit dem Müll-Status `voellig-erfunden` antwortet **401** — der Token-Riegel greift also
> zuerst und die Aufzählung der erlaubten Werte erreicht keinen Unbefugten. Der Endpunkt lädt auch
> mit dem neuen `require_once` (eine 500 wäre der Fatal gewesen), und `api/edit/reports/locations.php`
> antwortet unverändert 401. ⚠️ Kleine Korrektur an meiner eigenen Erwartung: ein **GET** liefert
> **401**, nicht 405 — die Token-Prüfung (`:16`) steht vor der Methodenprüfung (`:20`). Für einen
> Unbefugten ist das die bessere Antwort, sie verrät nicht einmal die erlaubte Methode.

### A36 · Der Rest des N+1 sitzt im Wiki-Zweig des Sammlers
`api/_internal/political/territories-derived-layer.php` (Sammler) → `territories-read.php:1277`
und `territories-derived-geometry.php:598-611`

A20 hat die **beiden Leser** gebündelt, nicht den **Sammler**. Der läuft weiter einmal je
abgeleitetem Objekt, und wo er auf `derived_wiki_id` zurückfällt, stellt er zwei weitere Abfragen:
`avesmapsPoliticalFetchWikiById` und die namensgleiche Nachfahren-Abfrage. Für solche Objekte
sank der Preis von **4 auf 2** Abfragen — halbiert, nicht beseitigt, und weiterhin linear in
ihrer Zahl.

Die saubere Behebung sieht aus wie A20, nur über zwei weitere Dateien: die `derived_wiki_id`
aller Objekte einsammeln, die Wiki-Zeilen in **einer** Abfrage holen, aus allen Namenslisten
**eine** `IN`-Menge bilden und die Namenszuordnung in **einer** zweiten Abfrage auflösen. Das
berührt `territories-derived-geometry.php`, die auch andere Aufrufer hat — deshalb ein eigener
Befund und keine Nachbesserung im selben Commit.

⚠️ **Wie viele Objekte den Zweig wirklich nehmen, ist offen.** Der Zweig greift nur, wenn ein
Objekt im Schnappschuss keine Nachfahren hat **und** eine `derived_wiki_id` trägt; das lässt sich
der Antwort nicht ansehen. Ohne diese Zahl ist unklar, ob A36 ein Rundungsfehler oder die Hälfte
des verbliebenen Aufwands ist. Sie steht in einem `SELECT COUNT(*)` und braucht keinen Massenlauf.

> **📐 Eingegrenzt am öffentlichen Kartenstand, 06.08.2026 — ohne Rückfrage, aber nicht bis zur
> Antwort.** Ich hatte die Zahl als „🔧 DU" abgelegt; sie lässt sich zum Teil selbst messen. Die drei
> Sammler-Zweige hinterlassen unterscheidbare Spuren in `derived_source_territory_public_ids`:
> Zweig 1 liefert das eigene Territorium **plus** Nachfahren (≥2), Zweig 3 genau das eigene (=1).
>
> | | |
> |---|---|
> | abgeleitete Objekte | **121** |
> | Quellliste sieht nach Zweig 1 aus (≥2 + selbst) | 109 |
> | nackter Rückfall (=1, selbst) | 12 |
> | davon **mit** `derived_wiki_id` → Zweig 2 **lief** | **10** |
>
> 💣 **Aber die Obergrenze bleibt offen, und das ist der interessante Teil.** Ein Wiki-Treffer, der
> zufällig das eigene Territorium enthält, ist von aussen nicht von Zweig 1 zu unterscheiden. Von den
> 109 liess sich nur bei **31** ein Kind aus dem Payload in der Quellliste nachweisen; bei **78** sind
> die Kinder im Zoomband gar nicht sichtbar. Der Payload kann es nicht schärfen — der Sammler
> arbeitet auf **allen** aktiven Territorien, der Payload ist ein Ausschnitt.
>
> **Ergebnis: 10 bis 88 Objekte, also 20 bis 176 zusätzliche Abfragen je Layer-Aufbau.** Bei 20 ist
> A36 ein Rundungsfehler und die Arbeit nicht wert; bei 176 ist der Rest **fast so gross wie das,
> was A20 entfernt hat** (242 → 2), und die Bündelung lohnt sofort. Die Spanne entscheidet, nicht
> mein Gefühl.
>
> 🔧 **DU: eine Leseabfrage entscheidet es** — [`sql/a36-wiki-zweig-zaehlung.sql`](../../sql/a36-wiki-zweig-zaehlung.sql),
> Abfrage 1. Abfrage 3 ist die Gegenprobe zum Modell: sie sollte ungefähr **2** liefern.

*Beleg:* am Code gelesen, im Test gemessen (2 + 3×2 = 8 Abfragen bei drei Wiki-Objekten).
*Aufwand:* mittel. *Gefunden von den Gegenprüf-Agenten an der eigenen A20-Auslieferung.*

### ◐ A39 · Der Import-Endpunkt moderiert ohne Spur — und überschreibt entschiedene Meldungen
`api/import/location-reports/update-status.php:49-60` gegen `api/edit/reports/locations.php:280`

Aus der Gegenprüfung von A33, von mir am Code nachgestellt. Zwei Löcher an derselben Tür:

**1. Kein Audit.** Der Endpunkt schreibt **null** Einträge — kein `avesmapsLogReportModeration`, kein
`avesmapsWriteMapAuditLog`. Mit gültigem Import-Token lässt sich jede Meldung auf
`approved`/`rejected`/`in_review` setzen, **ohne dass irgendwo steht, dass es geschah**. A4 hat
genau das für die Editor-Tür geschlossen; diese blieb offen, und A33 hat sie beim Schliessen der
Status-Frage nicht mitgenommen (im Gegenteil: meine Begründung dort behauptete das Gegenteil).

**2. Kein `AND status = 'neu'`.** Der Editor trägt diesen Riegel an **drei** Stellen (`:280`, `:337`,
`:362`) — er verhindert, dass zwei Bearbeiter dieselbe Meldung nacheinander entscheiden. Dem Import
fehlt er: ein Token überschreibt eine bereits entschiedene Meldung stillschweigend, samt
`reviewed_at`, ohne `reviewed_by` und ohne `review_note`. Die Entscheidung eines Menschen wird von
einer Maschine ersetzt, und niemand kann es hinterher sehen.

⚠️ **Und eine Nebenwirkung von A33, die ich benennen muss:** `neu` ist nicht mehr setzbar. Über
diesen Endpunkt war das der **einzige** Weg, eine entschiedene Meldung wieder freizugeben — der
Editor hat in jedem Schreibpfad `AND status = 'neu'`. A33 hat die letzte Umgehung von **A32**
zugemauert und sich dabei auf A32 berufen. Bewusst, aber der Preis stand nicht dabei.

🔧 **DU: eine Frage, dann baue ich beides.** Der Audit-Eintrag braucht einen **Urheber**, und ein
Import-Token ist kein Benutzer. Drei Möglichkeiten: (a) ein fester technischer Benutzer „Import",
(b) `reviewed_by` bleibt leer und die Audit-Zeile trägt nur „import", (c) das Token bekommt eine
Zuordnung zu einem echten Konto. Der `status='neu'`-Riegel dagegen ist keine Entscheidung — er
gleicht den Import an den Editor an und kommt mit.

*Beleg:* `grep` über den Endpunkt (0 Treffer für beide Audit-Funktionen), `UPDATE` wörtlich gelesen.
*Aufwand:* klein bis mittel.

> **◐ Loch 2 ist zu `2d98bb9e`, 05.08.2026 — Loch 1 (der Audit-Eintrag) bleibt bei dir.** Das
> `UPDATE` trägt jetzt `AND status = 'neu'`, wie der Editor in jedem seiner Schreibpfade. Ein
> Import-Token kann damit keine Entscheidung mehr überschreiben, die ein Mensch getroffen hat.
>
> 🔁 **Hier stand meine schlechteste Behauptung dieser Sitzung, ausgerechnet als „geprüft statt
> angenommen" ausgewiesen** (gefunden von der Gegenprüfung, von mir am Code bestätigt). Ich schrieb,
> der Riegel koste Wiederholungsläufe nichts, weil `MYSQL_ATTR_FOUND_ROWS` nicht gesetzt ist und
> `rowCount()` daher *geänderte* Zeilen zählt. Das stimmt — und ich habe **die `SET`-Liste eine Zeile
> darüber nie angesehen**. Dort steht `reviewed_at = CURRENT_TIMESTAMP`, und MySQL nennt eine Zeile
> geändert, sobald **irgendeine** zugewiesene Spalte einen anderen Wert bekommt. Eine entschiedene
> Meldung, erneut mit demselben Status geschickt, antwortete also **200 „aktualisiert"** — jedes Mal,
> eine Sekunde später. Nach dem Riegel: 404.
>
> ⭐ **Das ist kein Verlust, den der Riegel verursacht — es ist mehr von dem Befund.** Jeder dieser
> Wiederholungsläufe schob `reviewed_at` still auf einer fremden Entscheidung nach vorn, der
> Zeitstempel driftete vom Moment der Entscheidung weg, und nichts hielt es fest. 404 ist die
> ehrliche Antwort.
>
> ⚠️ Die `rowCount`-Rechnerei war ausserdem MySQL-spezifisch: die PDO-Fabrik dieses Projekts nimmt
> auch `pgsql`, und dort zählt `rowCount()` *getroffene* Zeilen — die Unterscheidung gab es nie.
>
> Die Absage übernimmt den Wortlaut des Editors **wörtlich**, weil es jetzt dieselbe Tatsache ist:
> null Zeilen heisst **entweder** „keine solche Meldung" **oder** „nicht mehr offen", und der
> Endpunkt kann die beiden nicht unterscheiden, ohne eine Abfrage zu stellen, die er nicht braucht.
> „Nicht gefunden" allein wäre für den interessanteren der beiden Fälle eine Lüge geworden.
>
> **Fünf Mutationen, jede vorher benannt — und zwei davon haben mich erwischt:** meine ersten
> Versuche der beiden mehrzeiligen Mutationen griffen **gar nicht** (die Anker trafen die
> CRLF-Zeilenenden nicht) und meldeten grün. Sauber wiederholt, die erste mit der Vorzustandsdatei
> direkt aus `git`: alle fünf rot.
>
> 🔁 **Und sie sicherten den Riegel nur gegen Löschung, nicht gegen Aushebelung** (`1801b6a8`).
> Fünf realistische Wege, seinen Text zu behalten und seine Wirkung zu verlieren, gingen **alle**
> durch: `if (false && rowCount() < 1)`, die Absage zu `error_log` degradiert, ein `OR id =
> :report_id` an die `WHERE` gehängt (`AND` bindet stärker, das öffnet alles wieder), ein zweites
> ungeschütztes `UPDATE` dahinter, und `$reportId` zwischen Prüfung und Schreiben neu gelesen.
> Bitter daran: **dieselbe Testdatei hatte drei dieser Lektionen sechzig Zeilen weiter oben schon
> gelernt** — für den Status-Riegel — und ich habe keine davon übertragen. Jetzt fallen alle fünf,
> und jede Mutation prüft vorher, ob sie überhaupt auf der Platte gelandet ist. 213/213 grün.
>
> **Live geprüft, spurenfrei:** ein POST ohne Token antwortet unverändert **401** — der Endpunkt lädt
> also mit dem geänderten `UPDATE` (eine 500 wäre der Fatal gewesen) und schreibt nichts; der
> Editor-Endpunkt **401**, `map-features.php` **200 / 19.236.101 Bytes**. ⚠️ **Der Riegel selbst ist
> von aussen nicht messbar** — dafür bräuchte es ein gültiges Import-Token *und* eine bereits
> entschiedene Meldung, also genau den Schreibvorgang, den er verhindern soll. Belegt ist er durch
> die Mutation mit dem echten Vorzustand.
>
> 🔧 **DU: eine Leseabfrage, und sie ist jetzt dringender als vorher.** A33 und A39 sind je für sich
> richtig, **zusammen** frieren sie eine Altzeile aber doppelt ein: A33 lässt nur noch
> `approved|rejected|in_review` **setzen**, A39 lässt nur noch `status='neu'` **ändern**. Eine Zeile
> mit einem Status ausserhalb dieser vier ist damit über die Import-Tür nicht mehr **richtigzustellen**
> — und der Editor fasst sie wegen A32 ebenfalls nicht an.
>
> 🔁 *Korrektur:* hier stand „weder korrigierbar **noch entfernbar**". Das Zweite stimmt für
> `location_reports` nicht — `api/import/location-reports/delete.php` löscht mit demselben Token und
> **ohne** Statusprüfung. Eine festsitzende Ortsmeldung lässt sich also entfernen, nur nicht mehr
> richtigstellen. Für `map_reports` gibt es diese Import-Löschtür nicht; dort stimmt beides.
>
> 💣 Der Verdacht ist konkret, nicht erfunden: das am 17.05.2026 gelöschte Importwerkzeug
> (`map/import_reported_locations.py`) setzte nach getanem Import den Status **`alt`**. Die Spalte
> ist `VARCHAR(20)` **ohne ENUM** — die Datenbank hat das nie eingeschränkt.
>
> ```bash
> cat sql/a39-status-bestand.sql
> ```
> Abfrage 3 listet genau die Zeilen, die von keiner Oberfläche mehr erreichbar wären. **Erwartung:
> leer.** Kommt etwas zurück, melde mir die `id`s — der Weg zurück ist ein einmaliges, gezieltes
> `UPDATE` von Hand, **kein** dauerhaft offener Schreibkanal. Die Riegel bleiben.

### A38 · Eine abgewiesene Anfrage füllt den Eimer nicht — die Drossel sieht den Prober nie
`api/_internal/app/report-outcome.php:57-63` gegen `api/app/report-location.php:129` und `:185`

Aus der Gegenprüfung von A31, von mir am Code nachgestellt. Die Stundengrenze zählt **gespeicherte
Zeilen** (`SELECT COUNT(*) FROM map_reports WHERE ip_hash = …`). Ein 409 (Name existiert bereits)
und ein 400 (Validierung) schreiben aber **nichts** — sie brechen vor dem `INSERT` ab.

**Folge:** wer mit *existierenden* Namen probt, füllt den Eimer nie, steht nie über der Grenze und
behält Antwort **und** die beiden ungedeckelten Scans auf **jeder** Anfrage — unbegrenzt und
dauerhaft. Die Drossel wirkt nur gegen den, der vorher fünf **echte** Meldungen gespeichert hat,
also gegen die naive Flut, nicht gegen den Angreifer. A31 hat die Reihenfolge richtig gestellt, aber
diesen Aufrufer erreicht sie nicht; für ihn ist der Endpunkt seither sogar eine Abfrage teurer.

Dasselbe gilt für das ältere Filter-Oracle, das `report-outcome.php:27-31` beschreibt (409 = nichts
gefiltert, 201 = etwas gefiltert): auch das kostet keine Zeile und wird nie gedrosselt.

🔧 **DU: das ist eine Abwägung, keine Reparatur.** Der naheliegende Weg — **abgewiesene Anfragen
mitzählen** — braucht einen zweiten Zähler (die Stundengrenze zählt Zeilen, nicht Versuche) und
trifft **ehrliche Melder**: wer sich beim Namen vertippt oder auf einen bestehenden Ort stösst,
verbraucht dann sein Kontingent, ohne je etwas gemeldet zu haben. Drei Formen, die ich nicht selbst
wähle:
1. **Nur Versuche zählen, nicht Erfolge deckeln** — ein getrennter, grosszügigerer Versuchszähler
   (z.B. 60/Stunde), der ausschliesslich den Prober trifft.
2. **Abweisungen halb zählen** — 409/400 füllen denselben Eimer, aber die Grenze steigt (z.B. 20),
   damit ein Tippfehler nicht sofort sperrt.
3. **Nichts ändern** und den Preis akzeptieren: die nicht-öffentliche Hälfte des Oracles bleibt
   offen, die Last bleibt ungedrosselt.

*Beleg:* am Code gelesen und nachgestellt (`report-location.php:129` bricht vor `:185` ab).
*Aufwand:* mittel (ein zweiter Zähler ist eine eigene Tabelle oder Spalte).

### A37 · Der Abenteuer-Abgleich lädt ein Cover mitten in seinen Schreibvorgängen
`api/_internal/wiki/adventure-sync.php:557-661` (Reconcile) und `:366-397` (Cover)

Abgespalten von A21, dessen Transaktion die anderen beiden Abgleicher bekommen haben. Hier geht
sie nicht: `avesmapsAdventureReconcileEntity` ruft `avesmapsAdventureSaveCoverLocal`, und das macht
einen **HTTP-Download vom Wiki**, eine GD-Verkleinerung und ein `file_put_contents`. Eine
Transaktion darum hielte auf einem Shared Host eine Datenbankverbindung über unbegrenzte
Netz-Latenz offen — und die geschriebene Datei rollt sie ohnehin nicht zurück. Das Objekt bleibt
damit als einziges der drei ohne Alles-oder-Nichts.

Der Abruf ist **verschränkt**, nicht bloss schlecht platziert: `avesmapsAdventureFindOrAdoptRow`
läuft davor, danach wird `cover_source` gelesen, und erst dieser Vergleich entscheidet, ob überhaupt
geladen wird — anschliessend folgen `UPDATE adventure` und die Ortsschreiber. ⚠️ *Präzisierung nach
Gegenprüfung:* `FindOrAdoptRow` **schreibt nur in zwei seiner drei Zweige** (Adoption und Neuanlage);
der häufigste Fall — Treffer über `wiki_key` — ist rein lesend. Vor dem Download steht für ein
bestehendes Abenteuer also **kein** Schreibvorgang. An der Verschränkung ändert das nichts (danach
wird geschrieben), wohl aber an der Begründung. Ihn nach vorn zu ziehen heisst, die
Reihenfolge Lesen/Schreiben/Netz neu zu ordnen — inklusive der Adoptionslogik, die bestimmt,
**welche** Zeile gemeint ist.

Mögliche Formen, bewusst nicht selbst entschieden, weil sie unterschiedliche Zusagen geben:
1. **Cover vorziehen** — die bestehende Zeile vor der Adoption über `wiki_key` lesen, laden, dann
   alles Übrige in einer Transaktion. Volle Atomarität, aber die Adoptionslogik muss zweimal
   gedacht werden.
2. **Transaktion nur um den Rest** — Anlegen/Adoptieren und Cover bleiben draussen, ab dem Feldplan
   greift sie. Deckt das ab, was der Befund nennt (halbe Objekte), lässt aber einen Absturz direkt
   nach dem Anlegen eine leere Abenteuerzeile hinterlassen.
3. **Cover ganz aus dem Reconcile** — in einen eigenen Schritt nach dem Abgleich, wie ein
   Nachlauf. Sauberste Trennung, grösster Umbau, und der Schritt braucht einen eigenen Zähler.

*Beleg:* Aufrufkette am Code gelesen; der Test zu A21 hält die Ausnahme samt Grund fest und wird
rot, sobald der Abruf nicht mehr dort steht. *Aufwand:* mittel. 🔧 **DU:** welche der drei Formen.

---

## Was der Test hinterlassen hat

13 Zeilen in 4 Tabellen (12 aus dem Test, 1 aus der A2-Ausfallprobe am Abend). Sie sind Folge
des Tests **und zugleich Befund** — dass es für keine
davon einen Löschweg gibt, ist der eigentliche Punkt. Fertiges SQL mit Sicherheitsabfragen:
[`aufraeumen.sql`](aufraeumen.sql).

| Was | Anzahl | Warum nicht entfernbar |
|---|---|---|
| `map_reports` id 273–280, Status ≠ `neu`, mit IP-Hash | 8 | keine Ansicht zeigt bearbeitete Meldungen (→ A3) |
| `map_reports` `ZZ-Nulltest A2 Zaehlabfrage` (13:1x, Kommentar) | 1 | dieselbe Ursache; bewusst angelegt, um die A2-Abfrage auf MySQL auszuführen — spurenfrei ging es nicht |
| `map_share_links`, Route Gareth→Ferdok, einer davon Code `HUGCPFhv` | 2 | kein Löschpfad im Projekt (→ A28) |
| `contact_message` + die zugehörige Mail | 1 | das Postfach kann nicht löschen |
| `sources` id 1224935 (`uses 0`) | 1 | kein Löschpfad für Katalogquellen (→ A6) |

⚠️ Beim Löschen der Kurzlinks aufpassen: am selben Tag können **echte** Kurzlinks von Besuchern
entstanden sein. Ein gelöschter fremder Kurzlink ist ein toter Link in freier Wildbahn. Das SQL
zeigt sie deshalb erst an, statt sie nach Datum wegzuräumen.
