# Postfach: Papierkorb je Mail + „Gesendet" als Klappliste

**Stand:** 2026-08-11 · **Oberfläche:** Editor → Reiter *Meldungen* → Sub-Reiter *Mails*
**Verwandt:** `docs/superpowers/specs/2026-07-03-editor-mail-inbox-design.md` (das Postfach selbst)

## 1. Warum

Zwei Lücken derselben Oberfläche:

1. **Eine gelesene Mail bleibt für immer in der Liste.** Das Postfach zeigt die letzten 40
   Nachrichten des echten `info@avesmaps.de`-Posteingangs. Wer eine Mail erledigt hat, kann sie
   aus Avesmaps heraus nicht weglegen — er muss in ein Mailprogramm wechseln.
2. **„Gesendet" schreibt jede Antwort komplett aus.** Bei ein paar längeren Antworten wird der
   Reiter zu einer endlosen Textwand, in der man den gesuchten Vorgang nicht findet.

## 2. Was gebaut wird

**A — Papierkorb-Knopf je empfangener Mail.** Jede Zeile in *Empfangen* bekommt rechts einen
kleinen Papierkorb. Ein Klick verschiebt die Mail im echten Postfach in den **Papierkorb-Ordner**
und nimmt die Zeile aus der Liste. Kein Bestätigungsdialog.

**B — „Gesendet" wird eine Klappliste.** Jede gesendete Antwort ist zugeklappt eine Zeile und
zeigt dabei weiterhin **Adressat, Betreff, Datum, Absender** (der antwortende Editor) und die
**erste Zeile** des Textes als gedämpfte Vorschau. Ein Klick klappt den vollen Text auf.

**Ausdrücklich nicht gebaut** (Owner-Entscheid 2026-08-11):

- 🔴 **Kein Papierkorb-Reiter.** Wiederhergestellt wird im Mailprogramm, nicht in Avesmaps.
  Deshalb gibt es auch **kein Undo** in der Oberfläche — der Rückweg ist der Papierkorb-Ordner.
- 🔴 **Kein Papierkorb in „Gesendet".** Die dortigen Einträge sind Avesmaps' eigenes Protokoll
  (`mail_reply`), kein Postfach-Inhalt; es gäbe kein Ziel, wohin verschoben werden könnte.

## 3. Der Papierkorb

### 3.1 Was serverseitig passiert

Neue Aktion `trash` am bestehenden Endpunkt `api/edit/mail/mailbox.php`:

- **Nur POST** (`405` sonst) — die Aktion verändert Zustand und darf nicht per Adresszeile
  auslösbar sein.
- Rumpf `{ "uid": <int> }`. Fähigkeit `edit`, wie der Rest des Postfachs.
- Ablauf: Papierkorb-Ordner bestimmen → `imap_mail_move(… CP_UID)` → `imap_expunge`.

### 3.2 💣 Der Ordnername ist nicht bekannt

Es gibt keinen genormten Namen: *Trash*, *Papierkorb*, *Deleted Items*, *INBOX.Trash* sind alle
im Umlauf, und `ext-imap` gibt die SPECIAL-USE-Kennzeichnung (`\Trash`) nicht heraus. Ein geratener
Name legt die Mail in einen **neu angelegten** Ordner, den niemand ansieht — sie wäre praktisch weg,
ohne dass irgendwo ein Fehler stünde.

Deshalb: `avesmapsImapResolveTrashMailbox()` bekommt die echte Ordnerliste (`imap_list`) und wählt
nach einer **Rangfolge bekannter Namen** (`Trash` vor `Papierkorb` vor `Deleted Items` vor
`Deleted Messages` vor `Deleted`), verglichen nur am **letzten Pfadsegment** und ohne
Groß-/Kleinschreibung — so trifft `INBOX.Trash` genauso wie `Trash`. Eine feste Vorgabe ist über
`contact.imap.trash_mailbox` möglich und gewinnt.

⚠️ **Wird kein Ordner gefunden, wird NICHTS verschoben** — die Antwort ist `422 no_trash_mailbox`
und die Zeile bleibt mit sichtbarem Fehler stehen. Ein Fehlschlag, den man sieht, ist besser als
eine Mail, die still verschwindet. Es wird **kein Ordner angelegt**: ein Schreibzugriff auf die
Ordnerstruktur des echten Postfachs ist mehr, als dieser Knopf verspricht.

### 3.3 ⚠️ `expunge` und seine Nebenwirkung

`imap_mail_move` **kopiert** die Mail in den Zielordner und setzt in der Quelle nur das
`\Deleted`-Flag. Ohne `imap_expunge` bliebe die Mail also als Leiche im Posteingang stehen — in
Avesmaps *und* im Mailprogramm, dort durchgestrichen, während sie gleichzeitig im Papierkorb liegt.

Also wird expunged. Der Preis: `imap_expunge` entfernt **alle** `\Deleted`-markierten Mails des
Posteingangs, also auch solche, die im Mailprogramm gelöscht, aber noch nicht endgültig entfernt
wurden. Das ist dasselbe Verhalten wie beim Papierkorb-Klick jedes Mailprogramms, aber es ist eine
echte Nebenwirkung und steht deshalb hier. Ein gezieltes `UID EXPUNGE` bietet `ext-imap` nicht.

**Zusätzlich** filtert `avesmapsImapListRecent()` `\Deleted`-markierte Nachrichten aus der Liste.
Das ist die zweite Sicherung: schlägt das Expunge fehl (Rechte, Serverlaune), sieht der Editor
trotzdem keine Leiche.

### 3.4 💣 Ein Knopf im Knopf geht nicht

Die Listenzeile ist heute selbst ein `<button>`. Ein `<button>` **in** einem `<button>` ist in HTML
verboten; der Parser bricht die Verschachtelung auf, und das Ergebnis ist je nach Browser eine
zerlegte Zeile. Die Zeile bekommt deshalb eine Hülle:

```
div.mail-inbox__row
├── button.mail-inbox__item   (Absender / Betreff / Datum — klappt wie bisher auf)
└── button.mail-inbox__trash  (🗑)
```

⚠️ Damit wandert der Einhängepunkt des Aufklappens mit: die Detailkarte wird nach der **Hülle**
eingefügt, nicht mehr nach dem Zeilenknopf — sonst landet sie *innerhalb* der Zeile. `is-open`
bleibt am Zeilenknopf (dort hängt die Optik).

### 3.5 Aussehen

Weich/outline (`--color-button-soft*`, `--radius-md`), nie gefüllt: eine Handlung **in einer Zeile**
ist nie die Haupthandlung der Seite (AGENTS.md §12). Erst beim Überfahren nimmt der Knopf die
`--color-danger-soft*`-Töne an — die Warnfarbe gehört der Absicht, nicht dem Ruhezustand einer
Liste aus 40 Zeilen. Ausschließlich Token, kein Literal.

Während des Verschiebens ist der Knopf gesperrt; danach verschwindet die Zeile. Schlägt es fehl,
bleibt die Zeile stehen und zeigt den Grund im Klartext.

## 4. „Gesendet" als Klappliste

### 4.1 💣 Nativ, kein selbstgebautes Auf- und Zuklappen

`<details>`/`<summary>`, wie im Fenster *Hinweise*. Der Grund ist derselbe: **Strg+F findet Text
auch in einem zugeklappten `<details>` und klappt es selbst auf.** Ein selbstgebautes Klappen mit
`display: none` nimmt der Seitensuche den Text weg — und ein Postfach ist genau die Oberfläche, in
der man sucht. Fokus, Enter/Leertaste und `aria-expanded` kommen ebenfalls vom Element; hier gehört
kein JS hin.

### 4.2 Zugeklappt sichtbar

Adressat (`An: …`), Betreff, `Datum · Absender · Zustellstatus`, dazu die **erste nicht-leere
Zeile** des Textes, gedämpft und einzeilig gekürzt. Optisch identisch zu einer Postfach-Zeile
daneben — die beiden Reiter dürfen nicht auseinanderlaufen.

⚠️ Das `<summary>`-Dreieck des Browsers wird abgeschaltet (`::-webkit-details-marker` +
`list-style: none`), sonst springt die Zeile gegenüber der Postfach-Zeile ein.

### 4.3 ⚠️ Der Sprung aus „✓ beantwortet" muss aufklappen

`jumpToSent()` wechselt in den Reiter und scrollt zur Antwort. Bleibt die Ziel-Zeile zugeklappt,
landet man auf einer Kopfzeile und sieht die Antwort nicht, um die es ging. `highlightSent()` setzt
deshalb `open = true`, bevor es scrollt.

## 5. Abnahme

**Lokal beweisbar:** `avesmapsImapResolveTrashMailbox()` ist reine Namenslogik ohne IMAP und
bekommt einen Unit-Test (`api/_internal/mail/__tests__/imap-trash-mailbox-test.php`): Rangfolge,
Groß-/Kleinschreibung, Präfixpfade, feste Vorgabe, und der Fall **kein Ordner → leerer String**.

**Nur live prüfbar:** hier hängt kein Postfach dran (kein IMAP, keine DB — siehe
`docs/…/php-js-test-commands`-Praxis). Das echte Verschieben, das Aufklappen der gesendeten Mails
und der Sprung aus „beantwortet" werden **nach dem Deploy im eingeloggten Editor durchgeklickt** und
am Papierkorb-Ordner des Postfachs gegengeprüft — nicht am Statuscode allein.

## 6. Nachtrag: derselbe Fehler im Ordner „Gesendet" (2026-08-11)

Der Blick des Owners in die STRATO-Einstellungen (Standardordner: *Sent Items*, *Trash*, *Drafts*,
*Spam*) hat den Papierkorb bestätigt — und nebenbei einen stillen Fehler von 2026-07-03 aufgedeckt:

Nach jeder Antwort legt der Endpunkt eine Kopie in den Gesendet-Ordner, damit ein echtes
Mailprogramm sie auch sieht. Das Ziel war das **Literal `'Sent'`** — dieses Postfach nennt den
Ordner aber **`Sent Items`**. 💣 `imap_append` ist als „bestenfalls" mit `@` geschrieben, sein
Fehlschlag also unsichtbar: **jede Antwort meldete Erfolg, und keine Kopie kam je an.** Fünf Wochen
lang, ohne dass irgendetwas in der Oberfläche darauf hätte hinweisen können.

Behoben mit derselben Mechanik wie beim Papierkorb: `avesmapsImapResolveFolder()` ist jetzt der
gemeinsame Kern, `AVESMAPS_IMAP_SENT_NAMES` die zweite Kandidatenliste.

⚠️ **`Sent Items` steht in der Rangfolge VOR `Sent`.** Trägt ein Postfach beide Ordner (zwei
Mailprogramme, zwei Gewohnheiten), lässt sich aus IMAP allein nicht ableiten, welcher der echte ist —
die Reihenfolge ist deshalb an **dieses** Postfach gebunden, dessen Servereinstellung `Sent Items`
lautet.

⚠️ **„Ich konnte nicht nachsehen" ist nicht „es gibt keinen".** Liefert `imap_list` gar nichts
(Rechte, Serverlaune), bleibt es beim historischen `'Sent'`; nur eine echte Ordnerliste **ohne**
Gesendet-Ordner lässt die Kopie aus. Der Unterschied hängt an `$folders === []` und ist eigens
getestet.

🔴 Die Antwort selbst ist davon nie betroffen: sie geht über SMTP raus und steht in `mail_reply` —
der Reiter „Gesendet" in Avesmaps zeigte auch vorher alles. Es fehlte nur die Kopie im Postfach.

## 7. Berührte Dateien

| Datei | Änderung |
|---|---|
| `api/_internal/mail/imap.php` | Ordner-Auflösung (Papierkorb **und** Gesendet), Verschieben, `\Deleted`-Filter in der Liste |
| `api/edit/mail/mailbox.php` | Aktion `trash` (POST, `edit`); Antwortkopie in den gefundenen Gesendet-Ordner |
| `js/review/review-mail.js` | Zeilen-Hülle + Papierkorb; `<details>` in „Gesendet"; Sprung klappt auf |
| `css/features/mail-inbox.css` | Knopf, Hülle, `<summary>`-Optik, Vorschauzeile |
| `api/_internal/mail/__tests__/imap-trash-mailbox-test.php` | neu |
| `api/_internal/mail/__tests__/imap-sent-mailbox-test.php` | neu (Nachtrag §6) |
