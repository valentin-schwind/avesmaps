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
    'instagram'  => ['user_id' => '…', 'access_token' => '…', 'expires_at' => …],
    'facebook'   => ['page_id'  => '…', 'access_token' => '…'],
    'mastodon'   => ['base_url' => '…', 'access_token' => '…'],
    'enabled'    => true,             // Killschalter, siehe §8
],
```

**Ein Kanal in der Oberfläche = eine Zeile.** Serverseitig braucht jeder Dienst trotzdem einen
eigenen Adapter (`api/_internal/social/adapters/<key>.php`), weil die APIs verschieden sind —
grob 50–150 Zeilen je Dienst. Der Adapter hat genau eine Aufgabe: einen fertigen Beitrag
entgegennehmen und `{ok, remote_id}` oder `{ok:false, error}` zurückgeben.

Fehlt zu einem Kanal der Zugang, erscheint er **ausgegraut und nicht anhakbar** („noch nicht
eingerichtet"), statt zu verschwinden. Wer die Oberfläche sieht, soll wissen, was möglich wäre.

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
| Berechtigungen | `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management` |
| Instagram `@avesmaps` | Unternehmenskonto, ID `17841434373040202`, im Business-Portfolio |
| Facebook-Seite „Avesmaps" | ID `61592910429900`, Asset `1322710140914682` — 🔧 **blockiert**: Der Owner hat nur Aufgabenzugriff, für die Instagram-Verknüpfung braucht es *uneingeschränkte Kontrolle*; wer sie hat, ist offen |
| Mastodon | noch kein Konto |

⚠️ Das Facebook-Profil „Aves Maps" (`61593292284323`) ist **nicht** die Seite. Es ist ein
persönliches Profil, verstößt als Projektauftritt gegen Facebooks Regeln und kann nicht per API
bespielt werden. Der Link in der „Folge uns"-Kachel auf avesmaps.de zeigt derzeit dorthin und
gehört auf `61592910429900` umgestellt.
