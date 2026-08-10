# Social-Media-Hub — Entwurf

**Stand:** 10.08.2026 · **Mockup:** `docs/social-hub-mockup.html`

## 1. Worum es geht

Editoren sollen aus Avesmaps heraus über ihre Arbeit berichten — kurzer Text, ein Bild, auf
mehreren Netzen gleichzeitig. Bisher gibt es dafür nur Discord (die alle zwei Tage laufende
Routine `avesmaps-feature-updates`) und den „Neuigkeiten"-Verlauf im Fenster „Hinweise". Beides
schreibe **ich** aus Commits. Was fehlt, ist die andere Hälfte: **die Redaktion, die erzählt, was
sich auf der Karte getan hat** — und ein Weg nach draußen, der nicht bei Discord endet.

Der Hub ist diese Stelle. Er nimmt Text, Hashtags und ein Bild entgegen und verteilt sie an die
angehakten Kanäle. Dieselbe Liste trägt die automatischen Feature-Updates und die Beiträge der
Editoren.

**Nicht Teil dieses Entwurfs:** Kommentare lesen oder beantworten, Direktnachrichten, Statistiken,
Werbung. Der Hub veröffentlicht, mehr nicht.

## 2. Oberfläche

### 2.1 Der Reiter heißt jetzt „Community"

| bisher | neu |
|---|---|
| Hauptreiter **Meldungen** | **Community** |
| Unterreiter **Community Meldungen** | **Meldungen** |
| Unterreiter Bewertungen | unverändert |
| Unterreiter Mails | unverändert |
| — | **Social Media** (neu) |

🔴 **Nur die Beschriftung ändert sich, kein technischer Name.** `data-editor-panel-tab="review"`,
`data-review-subtab="reports"`, `review-panel__*`, `#review-report-list` und alles Weitere bleiben,
wie sie heißen. Dieselbe Trennung wie bei „Neuigkeiten", wo die Tabelle weiter `changelog_entry`
heißt (AGENTS.md §11): umbenannt wird, was Menschen lesen, nicht das, woran Code hängt. Der neue
Unterreiter bekommt `data-review-subtab="social"`.

⚠️ `html/editor-handbuch.html` nennt den Reiter an mehreren Stellen („Editor → Meldungen →
Community Meldungen"). Das Handbuch wird **nicht** in diesem Zug angefasst — es gehört der
nächtlichen Routine (AGENTS.md §9). Die Commit-Betreffs müssen die Umbenennung klar benennen,
damit die Routine sie findet.

### 2.2 Der Reiter „Social Media"

Ein gefüllter Knopf **„Social Media Hub öffnen"** — die Haupthandlung —, darunter die Liste der
bisherigen Beiträge, neueste zuerst. Je Zeile: Herkunftskennzeichen (Editorname oder
„Automatisch"), Datum, Textanfang, und **je Kanal eine Marke mit eigenem Status**.

💣 **Der Status gehört an den Kanal, nicht an den Beitrag.** Ein Beitrag geht an drei Netze, und
jedes kann für sich scheitern. Ein gemeinsames „gesendet" verschluckt den Fall, dass Mastodon
abgelehnt hat — und niemand merkt es, bis jemand fragt, warum dort nichts steht. Jede Marke trägt
deshalb ihren eigenen Zustand (`wartet` · `gesendet` · `fehler` · `geplant`) und bei `fehler` einen
eigenen „Erneut"-Knopf, der **nur diesen einen Kanal** wiederholt.

### 2.3 Der Hub

Zweispaltig. Links Inhalt, rechts Kanäle.

**Links:** Textfeld · Hashtag-Feld · Medienbereich (eigene Datei · Kartenausschnitt aufnehmen ·
Video) · Herkunfts- und Rechteangabe.

**Rechts:** die Kanalliste mit Häkchen, je Kanal Konto, Limits und Auflagen · Zeitpunkt (sofort
oder geplant).

**Fußzeile:** „Geht an N Kanäle · als Avesmaps, nicht unter deinem Namen" · Vorschau ·
Veröffentlichen.

Der Hinweis auf den Absender steht dort, weil es die häufigste Rückfrage ist: Es postet das Konto
des Projekts, nie das persönliche Konto dessen, der drückt. Wer es war, steht nur intern.

## 3. Kanal-Register

Ein Kanal ist ein Eintrag mit Anzeigedaten und einem Adapter. Die **Anzeigedaten** (Schlüssel,
Name, Konto, Zeichenlimit, Hashtag-Anzahl, ob Bild Pflicht ist, ob Links klickbar sind) stehen
deklarativ in `api/_internal/social/channels.php`. Die **Zugangsdaten** stehen ausschließlich in
`api/config.local.php` auf STRATO, unter einem eigenen Block `social`, wie beim Discord-Bot.

```
'social' => [
    'app_token'  => '…',              // gated die Endpunkte, NICHT der Netz-Token
    'enabled'    => true,             // Killschalter, siehe §8
    'instagram'  => ['user_id' => '…', 'app_id' => '…', 'app_secret' => '…'],
    'facebook'   => ['page_id' => '…', 'app_id' => '…', 'app_secret' => '…'],
    'mastodon'   => ['base_url' => '…'],
],
```

⚠️ `facebook.graph_version` ist wahlfrei und überschreibt die im Adapter gepinnte Fassung. Meta nimmt
eine Graph-Fassung rund zwei Jahre nach ihrer Freigabe außer Betrieb; gepinnt ist `v25.0` (frei seit
18.02.2026, nutzbar bis 29.07.2028, am 10.08.2026 an Metas Changelog gemessen). Der Schlüssel steht
da, damit ein Sprung eine Konfigurationszeile ist und kein Deploy. Eine **unversionierte** Adresse
wäre das Gegenteil: dann würde Metas Umstellung zu unserer, ohne dass hier jemand etwas tut.

🔴 **Der rotierende Zugangs-Token steht in der DATENBANK, nicht hier** (Owner-Entscheid 10.08.2026;
Tabelle `social_token`, Spalten `channel_key · access_token · expires_at · refreshed_at`). Ein Token,
der sich alle paar Wochen selbst erneuert, kann nicht in einer von Hand gepflegten PHP-Datei wohnen:
der Server müsste PHP-Quelltext parsen und zurückschreiben, und der erste misslungene Schreibvorgang
hinterließe eine kaputte Konfiguration, die die ganze Seite mitnimmt. Also die Teilung:
`config.local.php` trägt, was sich **nie** ändert (App-Kennung, App-Geheimnis, der eigene
`app_token` der Endpunkte, der Killschalter), die Datenbank trägt, was **umläuft**. Auf die Datenbank
hat nur der Owner Zugriff.

⚠️ Für die Verfügbarkeitsprüfung zählt deshalb **beides**: ein Kanal gilt als eingerichtet, wenn er
eine Token-Zeile **oder** einen Token in der Konfiguration hat — **und** das, wodurch er adressiert
wird (`user_id` · `page_id` · `base_url`). Ein Token ohne Adresse erreicht niemanden, und das erst
beim Absenden zu merken heißt: ein öffentlich gescheiterter Beitrag.

**Ein Kanal in der Oberfläche = eine Zeile.** Serverseitig braucht jeder Dienst trotzdem einen
eigenen Adapter (`api/_internal/social/adapters/<key>.php`), weil die APIs verschieden sind —
grob 50–150 Zeilen je Dienst. Der Adapter hat genau eine Aufgabe: einen fertigen Beitrag
entgegennehmen und `{ok, remote_id}` oder `{ok:false, error}` zurückgeben.

Fehlt zu einem Kanal der Zugang, erscheint er **ausgegraut und nicht anhakbar** („noch nicht
eingerichtet"), statt zu verschwinden. Wer die Oberfläche sieht, soll wissen, was möglich wäre.

### 3.2 „Zugang einrichten" — der Server holt den Token selbst

Ein Kanal-Zugang entsteht über **einen** Knopf im Hub, unter der Kanalliste. Der Editor fügt **einen**
kurzlebigen Nutzer-Token aus dem Graph-API-Explorer ein; alles Weitere macht der Server:
tauschen (`fb_exchange_token`) → `GET /me/accounts` → nachprüfen (`debug_token`) → ablegen.
Endpunkt `api/edit/social/connect.php` (Fähigkeit `social`), Kern `api/_internal/social/connect.php`.

**Warum überhaupt.** Am 10.08.2026 wurde derselbe Zugang von Hand über drei Werkzeuge eingerichtet —
Explorer, Debugger, phpMyAdmin — und dabei landete **dreimal** etwas Falsches in `social_token`.
Zwei davon fielen nicht auf: der Seiten-Token aus einem **kurzlebigen** Nutzer-Token (tot nach einer
Stunde) und der **langlebige Nutzer**-Token selbst (tot am 09.10.2026). Beide sehen aus wie der
richtige, beide werden gespeichert, beide posten. Der Unterschied ist eine Zahl in einer Antwort, die
niemand aufruft. Genau deshalb ruft sie jetzt der Server auf.

💣 **Fünf Riegel, und gespeichert wird nur, was alle fünf besteht** (`connect-test.php`, jede Mutation
tötet ihre Zusicherung):

1. **`expires_at === 0`** ist die EINZIGE Zusage „läuft nie ab". Jede andere Zahl ist ein Datum, an
   dem der Kanal ohne Vorwarnung aufhört.
2. **`type === 'PAGE'`**, nicht `USER`. Ein Nutzer-Token trägt dieselben Rechte und sieht überall
   gleich aus.
3. **Ein fehlendes `expires_at` ist kein Freibrief.** Die Prüfung fällt geschlossen aus: keine
   Antwort ist kein Nachweis.
4. **Die Seite wird über die KENNUNG gesucht, nie über den Namen.** Es gibt mehrere Auftritte namens
   „Avesmaps"; über den Namen erwischt man die alte Seite, die zuerst in der Liste steht.
5. **`pages_manage_posts` muss dabei sein**, sonst wäre der Zugang eingerichtet und trotzdem stumm —
   und das fiele erst beim ersten Beitrag auf, also öffentlich.

Schlägt einer an, bleibt die Tabelle, wie sie war, und die Absage nennt den **gemessenen** Grund.
Fehlt die Seite in `/me/accounts`, nennt sie sogar den Weg (Business-Integrationen → „Ansehen und
bearbeiten" → unter *Pages* die Seite anhaken) — daran gingen am 10.08.2026 zwei Stunden verloren.

🔴 **Kein Token verlässt den Server** — nicht in der Antwort, nicht in einer Fehlermeldung. Zurück
gehen der Name der Seite und „läuft nie ab". Der eingefügte reist im **POST-Rumpf**, nie in der
Adresse (Abfragezeichenfolgen landen in Server-Protokollen), und das Feld ist maskiert und wird nach
dem Absenden geleert.

⚠️ **Vollautomatisch geht das nicht und soll es nicht.** Meta verlangt einmal eine menschliche
Zustimmung im Browser — das ist der Sinn der Sache. Weg ist alles *danach*.

⚠️ Welche Kanäle diesen Weg haben, steht als `connect` im **Register** (§3), nicht im Client. Zum
Browser reist nur `connectable` — DASS es geht, nie WIE. Heute: `facebook`. Instagram bekommt einen
eigenen Weg (`graph.instagram.com`, andere Rechtenamen, §12.1).

### 3.0 Der Kanal „Neuigkeiten" — avesmaps selbst

Ein Kanal muss nicht nach draußen führen. **„Neuigkeiten"** (Schlüssel `changelog`) schreibt in
`changelog_entry` und erscheint im Fenster **Hinweise → Neuigkeiten**. Er braucht kein fremdes
Konto, keinen Token und keine Freigabe von Meta — damit ist er nach der Probe der zweite Kanal, der
ohne jede Einrichtung läuft, und der erste, der dabei **wirklich veröffentlicht**.

Das ist auch die ehrlichste Antwort auf §1: der Verlauf war bisher etwas, das *ich* aus Commits
schreibe. Über diesen Kanal kann die Redaktion ihn selbst bespielen, im selben Fenster, in dem sie
auch nach draußen schreibt.

🔴 Schlüssel `changelog`, Beschriftung „Neuigkeiten" — dieselbe Trennung, die AGENTS.md §11 für
dieses Fenster ohnehin festhält. Der Schlüssel steht in `social_post_target.channel_key`; ihn
umzutaufen hieße, jede gespeicherte Zeile mitzuziehen.

**Die Titelzeile.** Der Hub hat ein eigenes Feld **„Titelzeile"** über dem Text, und es gilt
**ausschließlich für diesen Kanal** — die Netze kennen keine Überschrift; dort bliebe sie unsichtbar
oder stünde doppelt im Beitrag. Sie zählt deshalb auch **nicht** zum Zeichenlimit im Zähler.
`social_post.title`, VARCHAR(190), `maxlength` am Feld.

⚠️ **Bleibt sie leer, gilt die alte Regel:** die erste Zeile des Textes wird die Überschrift, der
Rest der Rumpf. Der Rückfall bleibt, weil ihn zwei Aufrufer brauchen — die Routine
(`routine-post.php` muss keinen Titel liefern) und jeder Beitrag von vor dem 10.08.2026.
💣 Ist die Titelzeile dagegen **gefüllt, wird dem Text nichts abgeschnitten**: der Editor hat die
Überschrift bereits separat gesagt, also ist die erste Textzeile gewöhnlicher Text.

💣 **Zu lang wird abgelehnt, nicht gekürzt** — mit beiden Zahlen, und die Absage nennt das Feld, aus
dem die Überschrift kam (Titelzeile oder erste Textzeile), sonst sucht der Editor am falschen Ort.
Eine stumm abgeschnittene Überschrift steht öffentlich, und niemand erführe, dass etwas fehlt.

⚠️ Die Spalte kam am 10.08.2026 dazu und wird **nachgerüstet**: `CREATE TABLE IF NOT EXISTS` rührt
eine bestehende Tabelle nicht an, also prüft `avesmapsSocialEnsureTables` einmal
`information_schema` und hängt `title` per `ALTER TABLE` an, wenn es fehlt (Muster aus
`citymaps.php`, **eine** Abfrage für alle Spalten — nicht eine Sonde je Spalte).

💣 **Eine leere `changelog_entry` fällt im Lesepfad auf die Saat zurück** (AGENTS.md §11). Wer in
diesem Zustand eine Zeile einfügt, hat den Verlauf nicht ergänzt, sondern auf einen einzigen
Eintrag zusammengestrichen — und es fällt nicht auf, weil Saat und gepflegter Verlauf gleich
aussehen. Der Adapter ruft deshalb `avesmapsChangelogSeedIfEmpty()` **vor** jedem Schreibvorgang,
genau wie der Schreibendpunkt.

⚠️ **Keine Hashtags** (`max_hashtags = 0`): im Verlaufsfenster wären sie toter Text unter einer
Meldung, die niemand nach Schlagworten durchsucht. ⚠️ **Kein Bild** — der Verlauf hat kein Bildfeld;
`shows_media = false` sorgt dafür, dass die Zeile „✓ Passt für …" im Hub ihn nie nennt und damit
nichts verspricht. ⚠️ Kategorie ist immer `community`; der Hub hat keine Kategoriewahl und soll
keine bekommen. ⚠️ Idempotent über `source_ref = social:<id>` — ein „Erneut" schreibt dieselbe Zeile
fort, statt eine sichtbare Dublette im öffentlichen Fenster anzulegen.

### 3.1 Die Auflagen der Netze

| | Zeichen | Hashtags | Bild | Link klickbar | Format |
|---|---|---|---|---|---|
| Instagram | 2 200 | alle | **Pflicht** | nein | **nur JPEG**, 4:5 … 1,91:1 |
| Facebook | ~63 000 | 2 | optional | ja | JPEG/PNG |
| Mastodon | 500 (instanzabhängig) | 4 | optional | ja | JPEG/PNG/WebP |

💣 **Instagram nimmt kein PNG.** Der häufigste Stolperstein, und er fällt erst beim Absenden auf.
Hochgeladene PNGs werden deshalb serverseitig zu JPEG gewandelt und bei Bedarf auf ein zulässiges
Seitenverhältnis zugeschnitten. Die Oberfläche sagt **vor** dem Absenden, was durchgeht („✓ Passt
für Instagram, Facebook und Mastodon").

💣 **Instagram hat keine klickbaren Links.** Ein „mehr auf avesmaps.de" in der Bildunterschrift ist
dort toter Text. Der Facebook-Beitrag bekommt den Link, der Instagram-Text verweist aufs Profil.
Das entscheidet der Adapter, nicht der Editor.

## 4. Hashtags

Eigenes Feld, ausgeliefert wird im Text — die APIs kennen kein Hashtag-Feld. Getrennt eingegeben,
weil die Netze Verschiedenes vertragen: Instagram alle, Facebook 2, Mastodon 4 (Zahl steht je
Kanal im Register). Jeder Kanal bekommt die ersten so vielen.

Ein Vorrat projektweiter Tags (`#DSA`, `#Aventurien`, `#Rollenspiel`, `#TDE`, …) steht zum
Anklicken bereit. Grund: Sonst tippt jeder etwas anderes, und `#dsa5` / `#DSA5` /
`#dasschwarzeauge` sind drei Töpfe.

⚠️ **Hashtags zählen zum Zeichenlimit.** Vier Tags sind schnell 60 Zeichen — bei Mastodons 500 über
ein Zehntel. Der Zähler weist sie getrennt aus („168 + 61 Hashtags = 229 / 500") und zeigt immer
das **strengste gerade angehakte** Limit.

Der Instagram-Brauch, Tags in den *ersten Kommentar* zu setzen, ist bewusst **nicht** vorgesehen:
Er bräuchte `instagram_manage_comments`, und die haben wir nicht angefordert. Wir veröffentlichen,
wir kommentieren nicht.

## 5. Medien

Drei Wege zu einem Anhang: **eigene Datei**, **Kartenausschnitt aufnehmen**, **Video**. Der
Kartenausschnitt ist die Abkürzung für „zeig, was sich geändert hat" und nutzt die vorhandene
Screenshot-Pipeline.

Ablage in `uploads/social/` — **nicht** ins Repo, sonst wächst es mit jedem Beitrag. Die Datei muss
öffentlich erreichbar sein, weil Meta sie von der URL lädt; anhängen kann man sie nicht.

💣 **Erst live, dann posten.** Nach dem Upload muss ein `curl` auf die öffentliche URL HTTP 200
liefern, bevor der Beitrag rausgeht. Dieselbe Falle wie beim Discord-Bild: Postet man früher, cacht
der Dienst den Fehlschlag und das Bild bleibt leer.

**Rechte.** Zwei Angaben zur Wahl — „eigenes Werk / Avesmaps-Karte" oder „freie Lizenz (Quelle
angeben)" —, dazu der Hinweis auf die Fan-Richtlinien. Beim Stadtkarten-Upload gibt es diesen
Riegel bereits; hier wiegt er schwerer, weil das Ergebnis öffentlich unter dem Namen Avesmaps
steht und sich nicht zurückholen lässt. Ein Scan aus einem DSA-Band wäre keine Ungenauigkeit,
sondern eine Urheberrechtsverletzung unter eurem Namen.

## 6. Datenmodell

```
social_post            id · text · hashtags · media_url · media_kind · media_license
                       origin (editor|routine) · author_user_id · created_at · scheduled_for
social_post_target     id · post_id · channel_key · status · remote_id · error · attempted_at
```

Ein Beitrag, N Ziele — genau deshalb, weil der Status je Kanal eigenständig ist (§2.2).

## 7. Endpunkte

| Endpunkt | Zweck | Auth |
|---|---|---|
| `POST /api/edit/social/publish.php` | Beitrag anlegen und senden | Fähigkeit `social` |
| `GET /api/edit/social/list.php` | Liste für den Reiter | Fähigkeit `social` |
| `POST /api/edit/social/retry.php` | **einen** Kanal wiederholen | Fähigkeit `social` |
| `POST /api/edit/social/media.php` | Upload + Konvertierung | Fähigkeit `social` |
| `POST /api/social/routine-post.php` | Vorschlag der Routine einliefern | App-Token |

🔴 **Eine eigene Fähigkeit `social`, nicht `edit`.** Wer die Karte pflegen darf, darf damit noch
lange nicht im Namen des Projekts an die Öffentlichkeit. Die beiden Rechte trennen sich hier
sauber, und die Trennung ist billig — eine Zeile in der Rechteprüfung.

⚠️ **In Stufe 1 deckt sich `social` mit `admin`** (`avesmapsUserCan`, live 10.08.2026). Das
Rechtemodell kennt nur die drei Rollen `admin · editor · reviewer` und **keine Rechtematrix je
Person** — enger geht es also nicht, ohne das Modell zu erweitern. Das ist die enge **Startwahl**,
nicht die Definition der Fähigkeit. Sie auf namentliche Editoren zu öffnen ist eine Spalte
`users.can_social` plus dieselbe eine Zeile, und **kein Aufrufer ändert sich dabei**, weil alle
schon durch `avesmapsUserCan(…, 'social')` gehen. Genau dafür hat sie jetzt schon einen eigenen
Namen bekommen, statt überall `admin` hinzuschreiben.

## 8. Betrieb

**Token-Verlängerung.** Instagram-Tokens laufen nach 60 Tagen ab, lassen sich aber programmatisch
erneuern. Der Server tut das rechtzeitig von selbst und meldet nach Discord, wenn es fehlschlägt.
Ohne das stünde der Owner alle zwei Monate vor einer Anmeldemaske — genau das soll die
Einrichtung *einmalig* machen.

**Killschalter.** `social.enabled = false` in der Config stoppt jedes Senden, ohne dass jemand Code
anfassen muss.

**Notbremse.** Höchstens ein automatischer Beitrag pro Tag und Kanal. Ein Fehler kann dann keine
Serie auslösen.

**Frischeprüfung** für die Routine, übernommen aus `avesmaps-feature-updates`: kein Beitrag, wenn
`origin/master` nicht von heute oder gestern ist. Genau daran ist der Discord-Post zweimal ins
falsche Zeitfenster gelaufen — dort mit einer zweiten Nachricht heilbar, auf Instagram nicht.

**Dublettenschutz** über den gespeicherten `source_ref`, wie ihn der Änderungsverlauf führt.

## 9. Die automatischen Beiträge

Die Routine erzeugt einen **Vorschlag**, der im Reiter mit „Freigeben und veröffentlichen ·
Bearbeiten · Verwerfen" wartet. Er landet in derselben Liste wie ein Editor-Beitrag.

Begründung für die Freigabe: Solange nur Discord bespielt wurde, war das Publikum die eigene
Community und ein Fehler mit einer zweiten Nachricht zu heilen. Sobald Editoren und Automatik
denselben öffentlichen Kanal teilen, ist ein ungeprüfter Beitrag ein öffentlicher Fehler unter dem
Namen des Projekts — und ein Instagram-Beitrag lässt sich nachträglich nicht ändern, nur löschen.
Die Freigabe kostet einen Klick.

## 10. Der Probe-Kanal

Ein eingebauter Kanal `probe`, der die volle Kette durchläuft — Bild konvertieren, zuschneiden,
hochladen, Text und Hashtags je Kanal zusammensetzen, Status schreiben — und statt zu senden
protokolliert, was er gesendet hätte.

Damit ist alles testbar, **bevor ein einziger Zugang existiert**. Er bleibt danach nützlich: ein
Beitrag zur Probe, ohne Öffentlichkeit.

## 11. Stufen

**Stufe 1 — Fundament.** Umbenennung · Reiter „Social Media" · Hub · Kanal-Register · Endpunkte ·
Bild-Pipeline · Status je Kanal · Rechteabfrage · Probe-Kanal · Freigabe-Ablauf.

**Stufe 2 — echte Kanäle.** Je ein Adapter: Instagram, Mastodon, Facebook.

**Stufe 3 — Video.** Instagram nimmt Videos nur asynchron an (hochladen, Status abfragen, dann
veröffentlichen). Das ist ein anderer Ablauf mit eigenen Fehlerfällen, kein größeres Bild — deshalb
getrennt, wenn Bild nachweislich läuft.

## 12. Stand der Konten (10.08.2026)

| | Stand |
|---|---|
| Meta-App „Avesmaps" | `1037557352198584`, Anwendungsfälle Instagram + Seiten, **kein** App-Review, **keine** Unternehmensverifizierung |
| Berechtigungen | `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management` — ⚠️ das ist der **Facebook-Login**-Satz, siehe unten |
| Instagram `@avesmaps` | Unternehmenskonto, ID `17841434373040202`, im Business-Portfolio |
| Facebook-Seite „Avesmaps" | **neu am 10.08.2026**, `facebook.com/avesmaps`, unter dem eigenen Konto des Owners. Profil-ID `61593145741175`, Graph-ID `1240150995850875` — siehe die zwei Kennungen unten. Die Seitenliste bietet „Beitrag erstellen" an, also liegt `CREATE_CONTENT` vor |
| Mastodon | noch kein Konto |

🔴 **Eine Seite hat ZWEI Kennungen, und die Graph-API meint die zweite.** Seiten der „neuen
Seitenerfahrung" tragen eine Profil-ID in der `6159…`-Form — das ist die, die in `profile.php?id=`
steht und die man im Browser sieht — und daneben eine klassische Seiten-ID (`delegate_page`), und
**nur die zweite ist der Knoten, den ein Seiten-Token adressiert.** Genau diese Doppelung steckte
schon in der alten Zeile: was hier als „Asset `1322710140914682`" notiert war, war nie ein Asset,
sondern die Graph-ID der alten Seite. Wer die `6159…`-Zahl in `social.facebook.page_id` schreibt,
bekommt von Meta einen Fehler statt eines Beitrags. 🔧 **Maßgeblich ist, was
`GET /me/accounts?fields=name,id,tasks` als `id` zurückgibt** — was dort steht, ist per Definition
der richtige Knoten.

⭐ **Und man kann die beiden ohne einen einzigen API-Aufruf auseinanderhalten — an den Links der
Seite selbst.** Facebook adressiert sie je nach Werkzeug verschieden, und das verrät, welche Zahl
welche ist:

| steht in | ist |
|---|---|
| `business.facebook.com/latest/home`, `…/inbox`, `/ad_center/…`, `/leads_center` | die **Graph-ID** — dieselbe Welt, in der auch die API lebt |
| `profile.php?id=…`, `photo.php?…` | die **Profil-ID**, reine Anzeige |

Am 10.08.2026 an der neuen Seite abgelesen: `1240150995850875` in allen Business-Adressen,
`61593145741175` in `profile.php`. Damit ist die Zuordnung oben nicht geraten, sondern belegt — die
Antwort aus `/me/accounts` bleibt trotzdem die letzte Instanz, und sie kostet nichts: sie kommt in
derselben Zeile wie der Token.

⚠️ **Altlasten, vom Owner zu löschen:** die alte Seite `61592910429900` und das persönliche Profil
„Aves Maps" `61593292284323`. Das Profil war nie die Seite — es verstößt als Projektauftritt gegen
Facebooks Regeln und ist per API nicht bespielbar. Die „Folge uns"-Kachel zeigte bis 10.08.2026
dorthin und steht seither auf `facebook.com/avesmaps`. ⚠️ Dort steht bewusst der **Namenspfad**, nicht
eine der beiden Zahlen: er ist lesbar, und er überlebt es, wenn Meta die Kennungen der Seite noch
einmal umstellt.

### 12.1 Die drei Entscheidungen vom 10.08.2026

**1. Instagram geht über „API-Einrichtung mit Instagram-Login" — ohne Facebook-Seite.**
Der Name meint den **Einrichtungsweg**, nicht eine laufende Anmeldung: einmal im Browser bestätigen,
Code gegen einen Kurzzeit-, den gegen einen Langzeit-Token tauschen, ablegen, nie wieder eine Maske.
Dasselbe Muster wie beim Discord-Bot. ⚠️ Dieser Weg spricht `graph.instagram.com` an, **nicht**
`graph.facebook.com`, und hat **eigene Rechtenamen** (`instagram_business_basic`,
`instagram_business_content_publish`) — die oben gelisteten gehören zum Facebook-Login-Weg. Die
genauen Namen sind vor dem Bau des Adapters (Stufe 2) einmal gegen Metas aktuelle Doku abzugleichen;
Meta tauft sowas gern um, und ein falscher Rechtename kostet eine Stunde Rätselraten.

💣 **Der Zähler darf nie durchlaufen.** Der Langzeit-Token gilt 60 Tage und wird per
`ig_refresh_token` verlängert. Verstreichen 60 Tage ohne Verlängerung, ist er tot und die
„einmalige" Einrichtung fängt von vorn an — dann wäre „einmalig" still gelogen. Verlängert wird
deshalb um **Tag 35**, nicht um Tag 58, und ein Fehlschlag meldet nach Discord (§8). ⚠️ Zweite Falle:
`ig_refresh_token` verlangt einen mindestens **24 Stunden alten** Token. Die Routine läuft direkt
nach der Einrichtung einmal ins Leere und darf das **nicht** als Fehler melden.

**2. Facebook ist zu MESSEN, nicht zu vermuten.** *Uneingeschränkte Kontrolle* verlangt Meta für die
**Instagram-Verknüpfung**. Zum **Posten** auf der Seite genügt dagegen die Aufgabe *Inhalte
erstellen* (`CREATE_CONTENT`). Ob der Owner sie hat, sagt eine einzige Anfrage im Graph-API-Explorer:

```
GET /me/accounts?fields=name,id,tasks
```

Steht bei „Avesmaps" ein `CREATE_CONTENT` im `tasks`-Feld, ist Facebook offen und der Blocker betraf
nur den Umweg über die Seite — den wir mit Entscheidung 1 ohnehin nicht mehr gehen. Steht es nicht
drin, ist Facebook wirklich zu, und die einzige Lösung ist, den Inhaber der Seite zu finden.

✅ **Gemessen am 10.08.2026 — und die Frage hat sich anders erledigt, als sie gestellt war.** Der Owner
hat eine **neue** Seite unter dem eigenen Konto angelegt (`facebook.com/avesmaps`), womit der alte
Zugriffsstreit gegenstandslos ist. Die Seitenliste führt sie mit „Beitrag erstellen" — genau das
Erkennungszeichen, dessen Fehlen („Seite verwalten") die alte Vermutung ausgelöst hatte. Was die
Messung **stattdessen** zutage förderte, ist die Zwei-Kennungen-Falle oben: die eigentliche
Fehlerquelle war nie das Recht, sondern die Frage, welche der beiden Zahlen die Graph-API meint.

**3. Der rotierende Token steht in der Datenbank** — begründet in §3.

### 12.2 Was Stufe 1 bewusst NICHT enthält

Damit niemand es für vergessen hält. **Live seit 10.08.2026** ist alles aus §11 Stufe 1: Reiter,
Hub, Register, Endpunkte, Bild-Pipeline, Status je Kanal, Rechteabfrage, Probe-Kanal, Freigabe.
Nicht enthalten sind:

- **Kein echter Kanal.** Instagram, Facebook und Mastodon stehen im Register und erscheinen
  ausgegraut als „noch nicht eingerichtet". Ihre Adapter sind Stufe 2. 🔴 Ein fehlender Adapter ist
  `null`, nie ein stiller Leerlauf, der Erfolg meldet — sonst stünde „gesendet" an einem Kanal, auf
  dem nichts steht. **Nachtrag 10.08.2026:** Facebook hat seinen Adapter bekommen (§12.3); Instagram
  und Mastodon sind weiter `null`.
- **Kein Kartenausschnitt, kein Video.** Beide Knöpfe stehen sichtbar und abgeschaltet da. Video ist
  laut §11 ohnehin Stufe 3; der Kartenausschnitt braucht eine eigene Aufnahme (Leaflet mischt
  Kachel-`<img>` und Canvas-Ebenen) und ist damit eigene Arbeit, kein Nebeneffekt der Bild-Pipeline.
- **Keine Token-Verlängerung.** Die Tabelle steht, die Erneuerung braucht einen Adapter und kommt
  mit ihm.
- **Keine Zeitplanung.** Spalte `scheduled_for` und Status `geplant` existieren, es gibt nur noch
  keinen Läufer, der sie abarbeitet.

### 12.3 Der Facebook-Adapter (10.08.2026)

Der erste echte Kanal. `api/_internal/social/adapters/facebook.php`, eingetragen in
`avesmapsSocialAdapterFor`. Ein Beitrag **mit** Bild geht an `POST /{page_id}/photos`, einer **ohne**
an `POST /{page_id}/feed`.

Was der Adapter braucht, steht an **zwei** Orten, und das ist Absicht (§3): die Seiten-Kennung in
`social.facebook.page_id` in `api/config.local.php`, der Seiten-Token in der Zeile
`channel_key = 'facebook'` der Tabelle `social_token`. Fehlt eines von beidem, nennt die Absage
**genau die fehlende Stelle** — „nicht eingerichtet" wäre wahr und nutzlos, denn welche der beiden
Hälften fehlt, ist die ganze Frage.

💣 **Fünf Fallen, alle im Adapter begründet und in `publish-test.php` festgenagelt:**

1. **Ein SEITEN-Token, und niemals `/me`.** Der Token entsteht, indem man `GET /me/accounts` mit
   einem **langlebigen NUTZER**-Token abfragt — erst dann läuft der Seiten-Token seinerseits nie ab.
   Jede Anfrage adressiert die Seite über ihre Kennung. `/me/feed` wäre kürzer und würde an dem Tag,
   an dem der abgelegte Token doch ein Nutzer-Token ist, den Projektbeitrag **öffentlich auf dem
   privaten Profil des Owners** veröffentlichen. Es gibt im Adapter keinen Rückfall auf `/me`.
2. **Der Token gehört in den Rumpf, nie in die Adresse.** Graph nimmt `?access_token=…`, und so
   zeigen es die meisten Beispiele; eine Abfragezeichenfolge landet in Server-Protokollen und in
   jedem Fehlertext. Ein abgeflossener Seiten-Token postet als Avesmaps, bis ihn jemand von Hand
   entzieht.
3. **`caption` bei `/photos`, `message` bei `/feed`.** Die Asymmetrie ist Metas. Schickt man
   `message` an `/photos`, wird es **angenommen und verworfen** — das Bild steht ohne ein Wort des
   Textes da, und nichts meldet einen Fehler.
4. **`post_id` vor `id`.** `/photos` antwortet mit beidem; `id` ist das **Foto**. Wer es speichert,
   führt in der Liste eine Kennung, die den sichtbaren Beitrag weder öffnet noch löscht.
5. **Keine Kennung zurück heißt nicht gesendet.** Ein Fehlerobjekt, ein leerer Rumpf, HTTP 200 ohne
   `id` — alles gilt als Fehlschlag. „Gesendet" ist in der Liste das Versprechen, dass etwas
   öffentlich steht (§2.2). Aus demselben Grund folgt der Adapter **keiner Weiterleitung**: auf einem
   POST würde curl den Rumpf samt Token noch einmal senden, wohin auch immer.

⚠️ Metas Fehlertext wandert unverändert in die Zeile — er *ist* die Diagnose, und ihn hinter „Fehler
beim Senden" zu verstecken macht aus fünf Minuten eine Stunde. Zwei Codes bekommen einen Zusatz, weil
ihr Wortlaut die Ursache nicht nennt: **190** (Token ungültig → Zeile in `social_token` ersetzen) und
**200/10** (Recht fehlt → `CREATE_CONTENT` bzw. `pages_manage_posts`, und der Token muss ein
Seiten-Token sein).

⚠️ **Eine Zeitüberschreitung ist der zweideutige Fall** — der Beitrag *kann* draußen sein. Er zählt
als Fehlschlag, aber der Text sagt es: erst auf der Seite nachsehen, dann „Erneut" drücken. Sonst ist
der zweite Versuch ein Doppelbeitrag, und den kann man auf keinem Netz nachträglich zusammenführen.

⚠️ **Der Token gilt für keine Verlängerung.** Ein Seiten-Token aus einem langlebigen Nutzer-Token
läuft nicht ab; `expires_at` bleibt darum `NULL`. Das ist der Unterschied zu Instagram (§12.1), wo
der Zähler durchlaufen kann — hier gibt es keinen.
