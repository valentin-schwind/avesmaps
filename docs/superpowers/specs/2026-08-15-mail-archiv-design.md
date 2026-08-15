# Postfach: Archivieren + Reiter „Archiv"

**Stand:** 2026-08-15 · **Oberfläche:** Editor → Reiter *Meldungen* → Sub-Reiter *Mails*
**Verwandt:** `docs/superpowers/specs/2026-07-03-editor-mail-inbox-design.md` (das Postfach selbst),
`docs/superpowers/specs/2026-08-11-mail-papierkorb-und-gesendet-klappliste-design.md` (der Papierkorb,
dessen Mechanik hier ein zweites Mal gebraucht wird)

## 1. Warum

Der Papierkorb räumt die Liste auf, aber er ist eine Entscheidung gegen die Mail. Wer eine erledigte
Anfrage **behalten** will, hat heute nur die Wahl zwischen „steht für immer in der Liste" und
„liegt im Papierkorb, den irgendwann jemand leert". Owner-Auftrag vom 15.08.2026: „mails sollen
archiviert werden können … neben dem papierkorb → archivieren (auch für gesendete)", und auf die
Rückfrage, ob das Archiv in Avesmaps lesbar sein soll: „ja ich will sie noch ansehen können,
brauche also einen reiter".

## 2. Was gebaut wird

**A — Archiv-Knopf 🗄 neben dem Papierkorb**, in *Empfangen* **und** in *Gesendet*. Ein Klick, kein
Bestätigungsdialog, die Zeile verschwindet aus der Liste.

**B — ein dritter Reiter „Archiv"** mit zwei Abschnitten untereinander: *Empfangen* und *Gesendet*.
Die Einträge sehen aus wie in ihrem Herkunftsreiter; statt des Archiv-Knopfs tragen sie **„↩"**
(Zurückholen).

**Ausdrücklich nicht gebaut** (Owner-Entscheid 2026-08-15):

- 🔴 **Kein Antworten aus dem Archiv heraus.** Erst zurückholen, dann antworten. Der Antwortweg ist
  die sicherheitsempfindlichste Stelle des Postfachs — der Empfänger wird dort **immer** serverseitig
  aus der referenzierten Mail geholt, der Client schickt nur eine `uid` (kein offenes Relay). Für die
  Bequemlichkeit, aus einem zweiten Ordner heraus zu antworten, wird dieser Pfad nicht angefasst.
- 🔴 **Kein Papierkorb im Archiv.** Zurückholen, dann löschen. Zwei Zeilenhandlungen sind die
  Obergrenze, bevor die Zeile zur Werkzeugleiste wird (AGENTS.md §12).

## 3. 💣 Mail-Nummern gelten nur innerhalb eines Ordners

Das ist die tragende Entdeckung dieses Features. Eine IMAP-`uid` ist **pro Mailbox** vergeben:
Nachricht 123 im Posteingang und Nachricht 123 im Archiv sind zwei verschiedene Mails. Bis heute
konnte das nicht auffallen, weil das Postfach genau **einen** Ordner kannte — `avesmapsImapConnect()`
öffnet `INBOX`, und jede `uid` in jeder Aktion meinte selbstverständlich diesen Ordner.

Mit dem Archiv gibt es zwei. Jede Aktion, die eine `uid` entgegennimmt (`message`, `image`,
`unarchive`), bekommt deshalb einen **Ordner-Schlüssel** dazu:

- Parameter `box`, Werte **genau** `inbox` (Vorgabe) oder `archive`. Alles andere ⇒ `400`.
- 💣 **Der Client nennt nie einen Ordnernamen.** `box` ist ein Stichwort, das der Server auf einen
  Ordner abbildet, den er selbst gefunden hat. Ein durchgereichter Name wäre ein Fremdzugriff auf die
  Ordnerstruktur eines echten Postfachs — und die Namensauflösung (§4) wäre umgangen.
- Umgesetzt wird das mit `imap_reopen()` auf demselben Strom; ein zweiter `imap_open` wäre eine
  zweite Anmeldung je Anfrage.

⚠️ Wer eine neue `uid`-Aktion ergänzt und `box` vergisst, baut den Fehler ein, den dieser Abschnitt
verhindert: die Aktion trifft dann die gleichnummerierte Mail im **falschen** Ordner und meldet
Erfolg. Es gibt hier bewusst **keine Zahl** in Kommentar oder Doku, die behauptet, wie viele solcher
Aufrufer es gibt — eine Zahl liest sich wie eine vollständige Liste und hat am 14.08.2026 in
`offroad-leg.php` genau deshalb zwei übersehene Erzeuger gedeckt.

## 4. Der Ordner heißt nicht „Archiv", solange niemand nachgesehen hat

Dieselbe Regel wie beim Papierkorb, und aus demselben Grund: ein IMAP-Server legt eine fehlende
Mailbox **stillschweigend an**. Ein geratener Name verschiebt die Mail also in einen Ordner, den
niemand je öffnet, und meldet Erfolg.

`avesmapsImapResolveArchiveMailbox()` bekommt die echte Ordnerliste und wählt nach Rangfolge am
letzten Pfadsegment, ohne Groß-/Kleinschreibung: **`archive` vor `archiv` vor `archives` vor
`archivierte objekte` vor `archivierte elemente`**. `Archive` steht vorn, weil der Owner am
15.08.2026 gemeldet hat, dass dieses Postfach einen so benannten Ordner trägt. Eine feste Vorgabe
über `contact.imap.archive_mailbox` gewinnt.

⚠️ **Kein Ordner gefunden heißt: nichts verschieben, nichts anlegen.** Beim Archivieren und beim
Zurückholen ist die Antwort `422 no_archive_mailbox`, die Zeile bleibt mit sichtbarem Grund stehen.

⚠️ **Beim LISTEN ist es aber kein Fehler, sondern eine Aussage.** Der Reiter „Archiv" antwortet mit
`ok: true`, leerer Liste und `mailbox: ""`; die Oberfläche sagt dann „Im Postfach gibt es keinen
Ordner ‚Archiv'." statt „leer". Ein fehlender Ordner und ein leerer Ordner sehen sonst identisch
aus — und der erste ist eine Aufgabe für den Owner, der zweite nicht.

## 5. Verschieben und seine bekannte Nebenwirkung

`avesmapsImapMoveToTrash()` wird zu `avesmapsImapMoveToFolder($imap, $uid, $folder)` verallgemeinert
(der alte Name bleibt als dünne Hülle, damit sein Test und sein Aufrufer unangetastet bleiben).
Drei Wege benutzen sie:

| Handlung | Strom steht auf | Ziel |
|---|---|---|
| Archivieren | `INBOX` | gefundener Archiv-Ordner |
| Zurückholen | Archiv-Ordner | `INBOX` (bzw. `contact.imap.mailbox`) |
| Papierkorb (unverändert) | `INBOX` | gefundener Papierkorb-Ordner |

⚠️ `imap_mail_move` kopiert nur und setzt in der Quelle `\Deleted`; das nötige `imap_expunge`
entfernt **alle** `\Deleted`-Mails des gerade geöffneten Ordners — jetzt also auch im Archiv, wenn
von dort zurückgeholt wird. Das ist dieselbe bekannte Nebenwirkung wie beim Papierkorb (ext-imap hat
kein gezieltes `UID EXPUNGE`), nur an einer Stelle mehr. Der `\Deleted`-Filter in
`avesmapsImapListRecent()` deckt beide Ordner ab, weil beide Listen durch dieselbe Funktion laufen.

## 6. 💣 „Gesendet" ist ein Protokoll, kein Postfach-Ordner

Der Reiter *Gesendet* zeigt `mail_reply` — Avesmaps' eigene Aufzeichnung jeder Antwort, mit
Editor-Name und Zustellstatus. Genau deshalb hat er keinen Papierkorb (Entwurf vom 11.08., §2). Für
das Archiv gilt dieselbe Trennung, nur mit anderem Ergebnis:

**Archivieren eines gesendeten Eintrags setzt `mail_reply.archived_at` und sonst nichts.** Die Mail
selbst wird **nicht** angefasst; ihre Kopie liegt weiter im Postfach-Ordner *Sent Items*. Sie dorthin
aus dem Gesendet-Ordner wegzuräumen wäre auch nicht auffindbar: die ausgehende Mail bekommt von uns
keine `Message-ID` (die vergibt der SMTP-Server), die Kopie ist aus `mail_reply` heraus also nur über
Betreff und Empfänger zu raten. Nichts anzufassen ist hier die ehrlichere Antwort.

💣 **`CREATE TABLE IF NOT EXISTS` heilt eine bestehende Tabelle nicht.** `mail_reply` steht seit dem
03.07.2026 auf jedem Server; die neue Spalte kommt dort nur durch ein `ALTER TABLE` an. Also beides:
die Spalte in der DDL für frische Installationen **und** `avesmapsEnsureMailReplyArchiveColumn()`,
das per `SHOW COLUMNS` nachsieht und nur bei Bedarf altert. Ohne das schlüge jeder Lesezugriff mit
„unknown column" fehl — und zwar erst auf dem Server, nie lokal.

⚠️ `archived_at` ist `DATETIME(3) NULL`; `NULL` heißt „in der Liste", ein Zeitstempel heißt
„archiviert". Kein Bool — der Zeitpunkt ist die Sortierung des Archivs.

## 7. Oberfläche

### 7.1 Die Zeile hat jetzt zwei Handlungen

Die Hülle `.mail-inbox__row` von 2026-08-11 trägt bereits Eintrag + Handlung; dazu kommt eine zweite.
Der gemeinsame Knopf-Look zieht in `.mail-inbox__action` um, `.mail-inbox__trash` behält nur noch
seinen Gefahr-Ton beim Überfahren, `.mail-inbox__archive` bekommt einen neutralen.

Weich/outline, nie gefüllt (AGENTS.md §12): eine Handlung **in einer Zeile** ist nie die Haupthandlung
der Seite, und diese Liste ist 40 Zeilen lang. Ausschließlich Token, kein Literal.

⚠️ Die Reihenfolge ist **Archiv links, Papierkorb rechts** — die zerstörerische Handlung steht außen,
nicht zwischen den beiden anderen Klickzielen.

### 7.2 Der Reiter

Ein dritter `data-mail-tab="archiv"` neben *Empfangen* und *Gesendet*, ein `data-mail-pane="archiv"`
mit zwei Abschnitten. Die Abschnitte werden durch **Überschrift + Trennlinie** gruppiert, nicht durch
gerahmte Kästen (AGENTS.md §12).

Die gesendeten Einträge bleiben `<details>` wie im Reiter *Gesendet* — 💣 nativ, weil Strg+F Text
auch in einem **zugeklappten** `<details>` findet und es selbst aufklappt. Ein Archiv ist die
Oberfläche, in der man sucht; ein selbstgebautes Klappen mit `display: none` nähme der Seitensuche
genau das weg.

### 7.3 ⚠️ Der Sprung aus „✓ beantwortet" muss das Archiv mitsuchen

`jumpToSent()` wechselt in *Gesendet* und hebt die Antwort hervor. Ist genau diese Antwort
archiviert, steht sie dort nicht mehr — der Klick auf das Abzeichen täte dann **nichts**, ohne
Erklärung. Also: nicht gefunden ⇒ in *Archiv* weitersuchen und dort hervorheben. Ein Abzeichen, das
ins Leere klickt, ist die stille Sorte Fehler, die dieses Projekt teuer bezahlt hat.

## 8. Abnahme

**Lokal beweisbar** (reine Namens- und Auswahllogik, kein IMAP, keine DB):

- `api/_internal/mail/__tests__/imap-archive-mailbox-test.php` — Rangfolge, Groß-/Kleinschreibung,
  Präfixpfade (`INBOX.Archive`), feste Vorgabe, und der Fall **kein Ordner ⇒ leerer String**.
  Mutationsscharf: jede Zusicherung muss fallen, wenn man die Rangfolge dreht.
- `js/review/__tests__/mail-archiv-form.test.js` — 31 Zusicherungen am Quelltext: **jede
  uid-Aktion nennt ihren Ordner** (§3, die tragende); der offene Aufklapper ist nach Ordner **und**
  uid geschlüsselt; die Zeile trägt zwei Handlungen in der Reihenfolge Archiv/Papierkorb; die Zeile
  verschwindet erst nach der Bestätigung des Servers; „kein Ordner" ist von „leer" unterschieden;
  kein Antwortfeld im Archiv; der Sprung findet eine archivierte Antwort; der Knopf-Look steht
  einmal und ohne Farbliteral.

  🪤 **Die Geometrie-Zusicherung aus dem ersten Entwurf ist hier ausdrücklich verworfen, nicht
  vergessen.** Sie hätte behauptet, dass die Abschnitte des Archiv-Reiters stapeln (die Lehre vom
  11.08.2026, als `textContent` eine nebeneinander gequetschte Zeile für richtig hielt). Dafür
  braucht es einen echten Layout-Durchlauf; `review-mail.js` ist ein Browser-Global ohne Exporte,
  das beim Laden schon ein `document` anfasst, und hier gibt es weder jsdom noch einen Runner —
  dieselbe Lage, die `ecosystem-terrain-number-input.test.js` bereits begründet. Die Frage wandert
  damit in die Live-Abnahme unten und wird dort **angesehen**, nicht gerechnet.

**Nur live prüfbar** (hier hängt kein Postfach dran). Nach dem Deploy im eingeloggten Editor
durchzuklicken, nicht am Statuscode zu messen (AGENTS.md §9: Abnahme heißt Ablauf, nicht Maß):

1. Eine empfangene Mail archivieren → Zeile weg, und im Mailprogramm liegt sie im Ordner *Archive*.
2. Reiter *Archiv* öffnen → beide Abschnitte stehen **untereinander**, jeder unter seiner
   Überschrift (das ist die verworfene Geometrie-Zusicherung, hier mit dem Auge).
3. Die archivierte Mail aufklappen → Text da, **kein** Antwortfeld, dafür der Hinweis.
4. Zurückholen → sie steht wieder in *Empfangen*.
5. Einen gesendeten Eintrag archivieren und zurückholen → und gegenprüfen, dass die Kopie in
   *Sent Items* dabei unangetastet liegen bleibt.
6. Ein „✓ beantwortet" anklicken, dessen Antwort archiviert ist → der Sprung landet im Archiv.

## 9. Berührte Dateien

| Datei | Änderung |
|---|---|
| `api/_internal/mail/imap.php` | Archiv-Ordner auflösen, `avesmapsImapMoveToFolder`, Ordner wechseln |
| `api/edit/mail/mailbox.php` | Aktionen `archive`, `unarchive`, `archived`, `sent-archive`, `sent-unarchive`, `sent-archived`; `box`-Schlüssel bei `message`/`image`; `archived_at` in DDL + Nachrüstung |
| `js/review/review-mail.js` | Archiv-Knopf, dritter Reiter, Zurückholen, Sprung ins Archiv |
| `index.html` | dritter Reiter + Bereich mit zwei Abschnitten |
| `css/features/mail-inbox.css` | `.mail-inbox__action`, `.mail-inbox__archive`, Abschnittsüberschrift |
| `api/_internal/mail/__tests__/imap-archive-mailbox-test.php` | neu |
| `js/review/__tests__/mail-archiv-form.test.js` | neu |
