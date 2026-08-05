# Bericht 1 — AKUT: was behoben werden muss

28 Befunde. 27 davon haben eine feindliche Gegenprüfung überstanden, deren Auftrag ausdrücklich
war, sie zu widerlegen; 20 weitere ursprünglich als AKUT gemeldete wurden dabei abgestuft,
2 widerlegt, 4 als Doppelungen erkannt — die stehen hier nicht mehr.

Der 28. Befund (A28) kam erst beim Nachzählen der eigenen Testspuren dazu. Er ist damit der
einzige, den nicht das Prüfen, sondern das **Aufräumen** gefunden hat — und ein Beleg dafür,
dass sich der Aufräumteil dieses Tests gelohnt hat.

**Nachtrag vom Abend des 05.08.: fünf weitere (A29–A33), gefunden beim feindlichen Gegenprüfen
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

### A14 · `GET /api/locations/` ist der ungeschützte Zwilling eines 152-MB-Pfades
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

## 9. Fünf Nachträge — gefunden beim Gegenprüfen der eigenen Fixes

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

### A31 · Die Drossel sitzt hinter dem teuersten Teil des Endpunkts
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

### A33 · Der Import-Endpunkt schreibt jeden beliebigen Status
`api/import/location-reports/update-status.php:26`

Der Status wird nur auf 20 Zeichen gekürzt, **ohne Whitelist** — anders als im Editor-Endpunkt
(`api/edit/reports/locations.php`), der auf `approved|rejected|in_review` prüft. Ein Tippfehler im
Importwerkzeug schreibt einen Status, den keine Oberfläche kennt; die Meldung erscheint dann unter
„Bearbeitet", trägt ein Etikett, das niemand vergeben wollte, und ist wegen A32 eingefroren.

*Beleg:* wörtlich gelesen. *Aufwand:* klein (dieselbe Whitelist wie nebenan).

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
