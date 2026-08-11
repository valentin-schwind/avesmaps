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
| Mastodon | 500 **gemessen** (instanzabhängig) | 4 | optional | ja | JPEG/PNG/WebP |

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

### 9.1 Die Entwurfs-Box (10.08.2026)

Ein Beitrag muss nicht sofort hinaus. Neben „Veröffentlichen" steht **„Als Entwurf speichern"** —
weich, nicht gefüllt, denn die Haupthandlung des Fensters bleibt das Veröffentlichen. Der Beitrag
landet in der Liste und wartet dort mit **Freigeben und veröffentlichen · Bearbeiten · Verwerfen**.

🔴 **EIN Zustand für beide Herkünfte.** Ein eigener `draft` neben `proposal` wäre dieselbe Sache
unter zwei Namen: die Liste müsste beide filtern, die Freigabe beide kennen, und beim nächsten
Zustand liefen sie auseinander. Woher ein Beitrag kommt, steht in `origin` (`editor` | `routine`),
nicht im Zustand.

🔴 **Ein Entwurf wird nicht versendet.** Der Rücksprung steht **vor** dem Versand und nicht als Zweig
darin — so kann kein später hinzugefügter Zweig daran vorbeilaufen.

💣 **Derselbe Zustand, zwei Sätze.** Über einem wartenden Beitrag stand fest verdrahtet „Vorschlag
der Routine — wartet auf Freigabe". Mit der Box war das ab dem ersten Editor-Entwurf sichtbar falsch,
über dem eigenen Text. `origin` entscheidet; ohne Herkunft fällt es auf den **Menschen** zurück, denn
„eine Routine hat das geschrieben" ist die Aussage, die man nicht raten darf. Die Überschrift der
Liste heißt aus demselben Grund „Beiträge und Entwürfe" statt „Zuletzt veröffentlicht".

**Die Routine liefert hier ein** (`avesmaps-feature-updates`, Schritt 6b): 2–4 Sätze für die
Öffentlichkeit — nicht die Discord-Stichpunktliste —, `channels: ["facebook","instagram","mastodon"]`
(der Server wirft die nicht eingerichteten weg, also steigen die anderen von selbst ein),
`source_ref` = Commit-Hash als Dublettenschutz, **409 ist kein Fehler**. Eigenes Token, das dritte
neben Discord und Verlauf.

⚠️ **`channels` enthält NIE `changelog`.** Der Verlauf gehört Schritt 6 derselben Routine und wird
dort mit richtiger Kategorie und Commit-Anker geschrieben. Ein Hub-Eintrag trägt
`source_ref = social:<id>` und stünde damit oben im Verlauf — der nächste Lauf läse ihn als
`latest_source_ref` und liefe `git log` gegen „social:42". Der Anschluss ginge verloren, ohne dass es
auffällt. **Wer beides zusammenlegen will, braucht am Kanal „Neuigkeiten" zuerst Kategorie und
Commit-Ref.**

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
| Berechtigungen | `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management` — der **Facebook-Login**-Satz, und seit §12.4 der richtige für **beide** Kanäle |
| Instagram `@avesmaps` | Unternehmenskonto, ID `17841434373040202`, im Business-Portfolio |
| Facebook-Seite „Avesmaps" | **neu am 10.08.2026**, `facebook.com/avesmaps`, unter dem eigenen Konto des Owners. Profil-ID `61593145741175`, Graph-ID `1240150995850875` — siehe die zwei Kennungen unten. Die Seitenliste bietet „Beitrag erstellen" an, also liegt `CREATE_CONTENT` vor |
| Mastodon | **`@Avesmaps@rollenspiel.social`**, angelegt 11.08.2026 (Konto-ID `117073953417022480`). Deutschsprachige Pen&Paper-Instanz, Mastodon 4.6.5, 406 aktive Nutzer/Monat, 500 Zeichen — alles gemessen, siehe §12.5. Zugang steht in `api/config.local.php`, nicht in `social_token`: der Schlüssel läuft nicht ab |

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

> 🔴 **VERWORFEN am 11.08.2026, nachdem gemessen wurde.** Instagram hängt inzwischen an der Seite,
> und damit ist der Seiten-Weg offen: derselbe Wirt, derselbe Token, **kein Ablauf**. Der Beleg und
> die Begründung stehen in **§12.4**. Der Absatz bleibt stehen, weil er die Lage vor der Messung
> festhält — die Entscheidung war für den damaligen Stand richtig, nur war der Stand ein anderer.
> ⚠️ Wer diesen Weg je wieder braucht (etwa weil Meta die Verknüpfung löst), findet unten alles
> Nötige; die Rechtenamen sind dann erneut gegen Metas Doku zu prüfen.

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
  dem nichts steht. **Nachtrag 10.08.2026:** Facebook hat seinen Adapter bekommen (§12.3).
  **Nachtrag 11.08.2026:** Instagram ebenfalls (§12.4). Mastodon ist weiter `null` — dort gibt es
  noch nicht einmal ein Konto.
- **Kein Kartenausschnitt, kein Video.** Beide Knöpfe stehen sichtbar und abgeschaltet da. Video ist
  laut §11 ohnehin Stufe 3; der Kartenausschnitt braucht eine eigene Aufnahme (Leaflet mischt
  Kachel-`<img>` und Canvas-Ebenen) und ist damit eigene Arbeit, kein Nebeneffekt der Bild-Pipeline.
- **Keine Token-Verlängerung.** Die Tabelle steht, die Erneuerung braucht einen Adapter und kommt
  mit ihm. **Nachtrag 11.08.2026:** und sie kam mit keinem — beide lebenden Kanäle hängen am
  Seiten-Token, der nicht abläuft (§12.4). Gebraucht wird sie erst von einem Netz, dessen Token
  rotiert. `access_expires` meldet für sie „läuft nie ab", und das ist nachgewiesen, nicht behauptet.
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
läuft nicht ab; `expires_at` bleibt darum `NULL`. Seit §12.4 gilt das für Instagram genauso — beide
Kanäle hängen am selben Seiten-Token, und einen Zähler gibt es an keinem von beiden.

### 12.4 Der Instagram-Adapter (11.08.2026)

Instagram läuft **über die Facebook-Seite**, nicht über den in §12.1 beschriebenen Instagram-Login.
Das ist eine bewusste Abweichung vom eigenen Entwurf, und sie steht auf zwei Messungen, nicht auf
einer Vermutung. Beide am 11.08.2026 im Graph-API-Explorer, App „Avesmaps":

```
GET /1240150995850875?fields=name,instagram_business_account
→ { "name": "Avesmaps",
    "instagram_business_account": { "id": "17841434373040202" },
    "id": "1240150995850875" }

GET /17841434373040202?fields=username,name,media_count      [mit SEITEN-Token]
→ { "username": "avesmaps", "name": "Avesmaps", "media_count": 3,
    "id": "17841434373040202" }
```

💣 **Die erste Messung lügt ohne `instagram_basic`.** Genau dieselbe Anfrage mit einem Token, der nur
die vier `pages_*`-Rechte trug, lieferte `{"name":"Avesmaps","id":"1240150995850875"}` — **das Feld
fehlte einfach**, ohne Fehler, ohne Hinweis. Das liest sich wie „Instagram hängt nicht an der Seite"
und heißt in Wahrheit „ich darf nicht nachsehen". Wer diese Messung je wiederholt, hakt das Recht
**vorher** an; sonst misst er die Rechte seines Tokens und hält das Ergebnis für einen Befund über
das Konto.

Die **zweite** Messung ist die, auf die es ankommt: der Adapter arbeitet mit dem Seiten-Token, nicht
mit einem Nutzer-Token. Dass die Verknüpfung *besteht*, sagt noch nicht, dass der Seiten-Token sie
*erreicht*. Er tut es.

**Warum das dem Weg aus §12.1 vorzuziehen ist:** derselbe Wirt (`graph.facebook.com`), derselbe
Token wie Facebook, **läuft nie ab**. Damit entfallen ersatzlos: der 60-Tage-Zähler, die Erneuerung
um Tag 35, der Läufer, der sie ausführt, dessen Überwachung, und die Sonderregel, dass
`ig_refresh_token` einen ≥24 h alten Token verlangt (also direkt nach der Einrichtung einmal ins
Leere läuft, ohne dass das ein Fehler wäre). Fünf bewegliche Teile gegen null. ⚠️ Der Preis: hängt
Meta die Verknüpfung eines Tages aus, ist Instagram stumm, bis sie wieder steht — §12.1 bleibt
deshalb als beschriebener Rückweg stehen.

**Zwei Orte, wie bei Facebook (§3):** die Konto-Kennung in `social.instagram.user_id` in
`api/config.local.php`, der Token in der Zeile `channel_key = 'instagram'` von `social_token`.

🔴 **Eine EIGENE Token-Zeile, obwohl es derselbe Token ist wie Facebooks.** Naheliegend wäre, den
Facebook-Token mitzulesen. Dann meldete der Hub Instagram aber als „eingerichtet", sobald Facebook
eingerichtet ist — auch wenn dieser Token die Instagram-Rechte gar nicht trägt, was am 10.08.2026
genau der Fall war: der damals abgelegte Seiten-Token wurde mit vier `pages_*`-Rechten geholt und
kann Facebook, aber nicht Instagram. Ein Kanal, der grün meldet und beim ersten Beitrag auffliegt,
ist die eine Sache, die §2.2 verbietet. Die eigene Zeile kostet einen Klick mehr („Zugang einrichten"
zweimal, derselbe Token eingefügt) und kauft dafür, dass **je Kanal die Rechte geprüft werden, die
DIESER Kanal braucht**.

💣 **Sechs Fallen, alle im Adapter begründet und in `instagram-adapter-test.php` festgenagelt:**

1. **ZWEI Schritte, und der erste allein ist nichts.** `POST /{ig-user-id}/media` mit `image_url` und
   `caption` liefert eine `creation_id`; erst `POST /{ig-user-id}/media_publish` mit `creation_id`
   veröffentlicht. Ein Lauf, der nach Schritt 1 abbricht, hat **nichts veröffentlicht** und meldet
   Fehler — nie Erfolg. Der Behälter verfällt von allein (24 h), es bleibt also nichts aufzuräumen,
   und der Fehlertext sagt das, damit niemand in der Datenbank nach Leichen sucht.
2. **Dazwischen muss der Behälter fertig sein.** Wer sofort veröffentlicht, bekommt **Fehler 9007
   („Media ID is not available")** — Instagram hat das Bild noch nicht verarbeitet. Der Adapter fragt
   `GET /{creation-id}?fields=status_code` ab, bis `FINISHED` kommt. ⚠️ **Gedeckelt**, weil das im
   Veröffentlichen-Request auf STRATO läuft: höchstens vier Versuche mit kurzer Pause, zusammen unter
   zehn Sekunden. Läuft der Deckel ab, ist es ein Fehlschlag mit Namen, kein stilles Weitermachen.
   `ERROR` als Status bricht sofort ab, statt den Deckel abzuwarten.
3. **Ohne Bild kein Beitrag.** `requires_media` steht schon im Register und greift in
   `avesmapsSocialCheckTarget` — der Adapter verlässt sich trotzdem nicht darauf und weigert sich
   selbst. Zwei Riegel, weil der eine im Register durch eine Zeile Datenänderung fallen kann.
4. **Der Token gehört in den Rumpf, nie in die Adresse** — dieselbe Begründung wie bei Facebook
   (§12.3 Falle 2), derselbe Token, dieselbe Wirkung, wenn er abfließt.
5. **Keine Kennung zurück heißt nicht gesendet.** Fehlerobjekt, leerer Rumpf, HTTP 200 ohne `id`:
   alles Fehlschlag. Gilt für **beide** Schritte getrennt.
6. **JPEG, und nichts anderes.** Metas Doku ist an der Stelle unmissverständlich („JPEG is the only
   image format supported"). Die Pipeline (§5) wandelt ohnehin alles um — die Falle ist nicht, es zu
   vergessen, sondern zu glauben, ein PNG käme „schon irgendwie" durch.

⚠️ **Rate limit: 100 per API veröffentlichte Beiträge in 24 Stunden.** Weit weg von allem, was dieses
Projekt tut; hier notiert, damit niemand es später messen muss.

⚠️ **Links sind auf Instagram nicht klickbar** — `clickable_links: false` steht seit Stufe 1 im
Register, war aber bis dahin ein reiner Anzeigewert. Der Hub weist jetzt darauf hin, **wenn** im Text
eine Adresse steht und Instagram angehakt ist. 🔴 Er schreibt nichts um und sperrt nichts: „Karte auf
avesmaps.de" ist als bloßer Satz völlig in Ordnung, und ein still umgeschriebener Text wäre der
größere Schaden. Der Hinweis richtet sich an den einen Fall, der wehtut — „mehr dazu unter <Adresse>"
als Aufforderung, die auf Instagram ins Leere zeigt.

💣 **Die Bildbreite ist seit 11.08.2026 auf 1440 px gedeckelt.** Die Pipeline schnitt bis dahin nur
aufs Seitenverhältnis zu und **verkleinerte nie** — ein großer Kartenausschnitt ging in voller
Auflösung hinaus. Metas eigene Doku nennt keine Obergrenze, verbreitete Angaben Dritter nennen 8 MB;
ein Fehlschlag daran wäre erst als API-Fehler nach dem Absenden sichtbar geworden. Der Deckel gilt
**allen** Kanälen, weil es eine Datei für alle ist (§5) — bei Facebook ist der Unterschied nicht zu
sehen, und die Alternative wäre eine zweite Datei je Kanal gewesen.

### 12.5 Der Mastodon-Adapter (11.08.2026)

Der dritte echte Kanal, und der einzige, dessen Konto **kein Konzern** vergibt.
`api/_internal/social/adapters/mastodon.php`, eingetragen in `avesmapsSocialAdapterFor`. Ein Beitrag
**mit** Bild geht in zwei Schritten hinaus — `POST /api/v2/media` (multipart, Feld `file`, dazu die
Bildbeschreibung) liefert eine `id`, die dann als `media_ids` an `POST /api/v1/statuses` geht. Ein
Beitrag **ohne** Bild ist nur der zweite Schritt.

**Das Konto: `@Avesmaps@rollenspiel.social`** (angelegt 11.08.2026). Gewählt wurde eine
deutschsprachige Pen&Paper-Instanz, nicht die größte — auf Mastodon hängt die Reichweite nicht am
Server: wer folgt, folgt von überall, und Hashtags laufen durchs ganze Netz. Der Server entscheidet
über Adresse, Moderation und Fortbestand. ⚠️ Er wird von **einer Privatperson** betrieben (406 aktive
Nutzer im Monat, gemessen 11.08.2026); das ist der bewusst in Kauf genommene Preis. Ein Wechsel kostet
später eine Zeile `base_url`, einen neuen Schlüssel und Mastodons eigenen Kontoumzug — die alten
Beiträge zögen **nicht** mit um.

**Zugang, und warum es hier keinen `connect`-Knopf gibt.** Mastodons Schlüssel läuft **nicht ab**;
damit greift die Regel aus §3 in ihrer anderen Richtung — *rotiert = Datenbank, fest = Konfiguration*.
Beides steht deshalb in `api/config.local.php`: `social.mastodon.base_url` und
`social.mastodon.access_token`. Eine Zeile in `social_token` würde ebenso funktionieren
(`avesmapsSocialAdapterContext` bevorzugt sie), sie hat hier nur keinen Zweck. Angelegt wird der
Schlüssel von Hand unter *Einstellungen → Entwicklung → Neue Anwendung*, mit **genau zwei** Rechten:
`write:statuses` und `write:media`. Lesen und Folgen braucht der Hub nicht, und ein Recht, das man
nicht vergibt, kann auch nicht missbraucht werden.

🔴 **Der Schlüssel gehört dem Konto, das ihn anlegt.** Wer die Anwendung angemeldet als Privatperson
erstellt, bekommt einen Schlüssel, der als Privatperson veröffentlicht — dieselbe Falle wie Facebooks
`/me` (§12.3), nur ohne Vorwarnung, weil hier keine Kennung mitgeschickt wird, an der es auffiele. Es
gibt keinen technischen Riegel dagegen; die Gegenprobe ist, den ersten echten Beitrag auf dem Profil
von `@Avesmaps` **anzusehen**.

⭐ **Der einzige Kanal mit einem Wiederhol-Riegel.** Mastodon achtet auf einen `Idempotency-Key`: eine
zweite Anfrage mit einem bereits gesehenen Schlüssel bekommt den **ursprünglichen** Beitrag zurück,
statt einen zweiten anzulegen. Der Schlüssel wird aus der `post_id` abgeleitet und ist damit über alle
Versuche derselbe. Das dreht den zweideutigen Fall um: wo Facebook nach einer Zeitüberschreitung sagt
„erst nachsehen, dann erneut" (§12.3), sagt Mastodon „erneut senden ist gefahrlos".
⚠️ Bewusst **ohne** Textprüfsumme im Schlüssel: ein Schlüssel, der sich mit dem Text ändert, wäre genau
dann neu, wenn jemand einen zeitüberschrittenen Beitrag korrigiert und noch einmal schickt — also im
einzigen Fall, für den es ihn gibt. Ein *gescheiterter* Versuch legt keinen Beitrag an und merkt sich
keinen Schlüssel; ein geänderter Wiederholversuch nach echtem Fehler geht daher normal hinaus.

💣 **Sechs Fallen, alle im Adapter begründet und in `mastodon-adapter-test.php` mutationsgeprüft:**

1. **Mastodon meldet Fehler als STRING, Facebook als OBJEKT.** Dort `{"error":{"message":…,"code":…}}`,
   hier `{"error":"Validation failed: …"}`. Wer den Facebook-Leser abschreibt, dessen
   `is_array($data['error'])` greift nie — die Antwort fällt in den „keine id"-Zweig und ist damit
   **zufällig richtig** (nicht gesendet), aber Mastodons eigener Satz ist weg und mit ihm die Diagnose.
   Genau diese Mutation überlebte den ersten Testentwurf; beweiskräftig ist deshalb nicht
   `ok === false`, sondern dass der **Text** durchkommt.
2. **`base_url` ist die INSTANZ, nicht das Profil.** Was in der Adresszeile steht, ist
   `https://rollenspiel.social/@Avesmaps` — und das ist das Naheliegende zum Einfügen. Mit Pfad entstünde
   `…/@Avesmaps/api/v1/statuses`, also ein 404, den man dann dem Schlüssel anlasten würde. Alles nach dem
   Wirt fällt weg; `http` wird auf `https` gehoben, weil ein Bearer-Token über eine offene Verbindung ein
   abgeflossener Token ist.
3. **`202` beim Bild heißt „noch nicht verarbeitet", nicht „fertig".** Mastodon antwortet 200, wenn der
   Anhang bereit ist, und 202, wenn er noch läuft. Wer die `id` dann sofort anhängt, bekommt einen 422,
   dessen Text vom **Beitrag** redet und nicht vom Bild. Also wird gewartet (`GET /api/v1/media/:id`,
   dreimal, je eine Sekunde) und im Zweifel **nichts** gesendet.
4. **`media_ids` muss eine LISTE sein.** `http_build_query` schreibt ein Array als `media_ids[0]=…`, und
   Rack liest das als **Hash** mit dem Schlüssel „0", den Mastodon zurückweist. Der Status geht deshalb
   als **JSON** hinaus — der Bild-Upload ist der einzige Aufruf, der multipart bleibt, weil er eine Datei
   trägt.
5. **Die Bildbeschreibung gehört an den UPLOAD, nicht an den Status.** `/api/v1/statuses` hat kein
   solches Feld; dort gesendet wird sie angenommen und verworfen, und das Bild steht als unbeschrieben da.
6. **Keine `id` zurück heißt NICHT gesendet** — wie überall (§2.2). Der Adapter folgt aus demselben
   Grund wie Facebook **keiner Weiterleitung**: auf einem POST würde curl den Rumpf samt Schlüssel noch
   einmal senden, wohin auch immer.

💣 **Die 500 Zeichen sind INSTANZABHÄNGIG, kein Gesetz.** Jede Instanz stellt sie selbst ein; es gibt
welche mit 1 500 und mit 5 000. Der Wert im Register ist deshalb **gemessen** —
`GET https://rollenspiel.social/api/v2/instance` → `configuration.statuses.max_characters = 500`, am
11.08.2026 gegen Mastodon 4.6.5 abgefragt. Wer die Instanz wechselt, misst neu.

🔧 **Offen, bewusst:** dieselbe Antwort nennt `characters_reserved_per_url = 23`. **Mastodon zählt jede
Verknüpfung als 23 Zeichen**, auch eine kürzere. Unser Zähler zählt sie echt und ist damit bei langen
Adressen strenger als nötig (harmlos); nur bei einer sehr kurzen (`avesmaps.de` = 11) sind wir zu
großzügig, und ein Beitrag in den letzten zwölf Zeichen vor 500 kann drüben abprallen. Der Adapter
erklärt diesen 422 im Klartext. Es zu beheben hieße, den **gemeinsamen** Zähler (`compose.php`) und die
Oberfläche mitzuändern — eigene Arbeit, nicht ein Nebeneffekt dieses Adapters.

⚠️ **`language = de`** reist mit. Ohne das rät Mastodon aus dem Kontovorgabewert, und wer seine
Zeitleiste nach Sprache filtert, sieht den Beitrag im falschen Topf.

### 12.6 Das Feld „Bildbeschreibung" (11.08.2026)

Kam mit dem Mastodon-Adapter, gilt aber allen Kanälen, die eine kennen. Ein Eingabefeld im Hub unter
dem Bild, Spalte `social_post.media_alt` (VARCHAR(500), nachgerüstet).

⚠️ **Leer ist erlaubt und sendet dann KEINE.** Den Beitragstext ersatzweise als Bildbeschreibung
durchzureichen wäre schlechter als nichts: ein Screenreader liest denselben Satz dann zweimal vor.
Mastodons eigene Markierung „ohne Beschreibung" ist die ehrlichere Auskunft.

💣 **Eigene Bedingung bei der Nachrüstung.** `CREATE TABLE IF NOT EXISTS` rührt eine bestehende Tabelle
nicht an, also hängt `avesmapsSocialEnsureTables` die Spalte per `ALTER TABLE` an — mit einem **eigenen**
Wenn neben dem von `title`. Ein gemeinsames hätte bei jedem Bestand, der `title` bereits hat, auch
`media_alt` übersprungen, und das fiele erst beim ersten Schreibvorgang auf, als SQL-Fehler.

⚠️ Sie reist in `list.php` mit zurück, damit „Bearbeiten" sie wiederherstellt — sonst verlöre ein
Entwurf beim zweiten Speichern still seine Bildbeschreibung, und ein leeres Feld sieht genauso aus wie
ein nie gefülltes.
