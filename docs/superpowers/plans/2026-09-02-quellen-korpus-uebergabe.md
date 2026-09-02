# Übergabe — Quellen & Korpus, Stand 02.09.2026 abends

> Für eine frische Sitzung. Der Owner hat abgebrochen mit „ich glaube wir zwei reden seit einiger
> Zeit aneinander vorbei" — dieser Text soll das auflösbar machen. Er nennt **auch, was
> schiefgegangen ist**, nicht nur was gebaut wurde.

## 1. Der offene Befund — bitte zuerst lesen

**Owner, 02.09.2026: „wieso habe ich jetzt wieder das alte Eingabeformular".**

Gemessen, nicht vermutet:

| Prüfung | Ergebnis |
|---|---|
| Deploy gelaufen? | ja, `33636113671`, success, 2m49s |
| Server liefert die neue Datei? | ja — `data-fs-add-cancel` 2× im Live-Abruf |
| `?v=`-Stempel aktuell? | ja, `c1fee8f9ed`, gestempelte Adresse = frischer Inhalt |
| CSS live? | ja, `fs-row__cancel` + `fs-row__kind:empty` vorhanden |

Also **kein** Cache- und **kein** Deployproblem. Die Ursache ist inhaltlich:

**`d95be4b32` („der Korpuskasten erscheint erst, wenn die Adresse einen Korpus ergibt") hat drei
Felder mitversteckt, die nichts mit dem Korpus zu tun haben.**

`Art`, `Lizenz` und `Namensnennung` liegen im Markup **innerhalb** von
`<span class="fs-korpus" data-fs-korpus-gruppe hidden>`. Bis `152f1ef70` startete dieser Kasten
sichtbar, seit `d95be4b32` startet er `hidden`. Auf einer frisch geladenen Seite zeigt die
Eingabezeile seither nur noch:

```
Adresse ⟳ | Titel | Seite(n) | Abdeckung | [Hinzufügen] [Abbrechen]
```

Art, Lizenz und Namensnennung sind **weg**, bis eine Adresse einen bekannten Korpus auflöst. Das
ist weniger als vor dem ganzen Umbau — und liest sich als „das alte Formular".

**Der Fehler ist meiner.** Der Owner sagte „dieses feld kommt wenn ich eine NEUE quelle erstellen
will" und meinte damit das **Korpus-Namensfeld**. Ich habe den Riegel an den ganzen Kasten gehängt,
ohne nachzusehen, was sonst noch darin liegt.

### Der Fix, der noch nicht gebaut ist

Die drei Felder gehören **aus dem Kasten heraus**, zurück in die Zeile — sie beschreiben die
Quelle, auch wenn niemand ihren Wirt kennt. Im Kasten bleiben nur **Name des Korpus** und **Form**.

⚠️ **Das kollidiert mit einer anderen Zusage** und muss vom Owner entschieden werden: seit
`11e17d7f8` **besitzt** der Korpus Art, Lizenz, Namensnennung und den Kanon-Haken
(`AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS`) — eine Änderung dort gilt allen Quellen des Wirts, wie
gewünscht („ändere ich ART, LIZENZ, Namensnennung oder Name, ändert sich alles mit"). Genau deshalb
stehen sie im eingerahmten Kasten: der Rahmen ist die Warnung.

Die zwei Wünsche widersprechen sich also an dieser Stelle:
* „alles einrahmen, was zum Korpus gehört" → Art/Lizenz **in** den Kasten
* eine neue Quelle ohne bekannten Wirt braucht trotzdem Art und Lizenz → **aus** dem Kasten

🔧 **Offene Owner-Frage:** Vorschlag wäre — der Kasten ist immer sichtbar, trägt aber zwei
Zustände: mit Wirt „Gilt für den ganzen Korpus (39 Quellen)", ohne Wirt „Gilt für diese Quelle".
Dieselben Felder, dieselbe Stelle, nur die Überschrift und die Reichweite ändern sich. Das war
**nicht** abgestimmt und ist deshalb nicht gebaut.

## 2. Was das Korpus-Modell ist (in einem Absatz)

Ein **Korpus** ist der Wirt einer Quelle: die registrierbare Domain aus `sources.url`
(`westlande.de`, `garetien.de`, …). Der Schlüssel wird **abgeleitet, nie gespeichert** — deshalb
brauchte das Modell **keine Migration**. Die Tabelle `source_corpus` hält nur das, was man aus der
Adresse *nicht* ableiten kann: `label` (Anzeigename), `form` (`werk` | `belegstelle` | leer),
`source_type`, `license`, `attribution`, `is_official`. Die letzten vier gehören dem Korpus und
werden beim Speichern auf **alle** seine Quellen geschrieben; `label` und `form` bewusst nicht.

Modul: `api/_internal/app/source-corpus.php`. Entwurf:
`docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md`.

## 3. Wird die Tabelle benutzt?

Ja — **aber nur im Editor**. Ein Leser (`avesmapsSourceCorpusReadAll`), vier Aufrufer:

| Wo | Wozu |
|---|---|
| `inspect_url` (Prüfknopf ⟳) | löst die eingefügte Adresse zum Wirt auf |
| Quellenliste im Editor | schreibt Korpusname + Reichweite an jede Zeile |
| Speichern einer Quelle | trägt die vier Korpusfelder auf alle Quellen des Wirts |
| `save_corpus`, `corpus_titles_probe/_apply` | schreibt den Korpus, Titel-Lauf |

**Nicht** benutzt: die öffentliche Anzeige. `js/ui/feature-source-markup.js` erwähnt den Korpus mit
keinem Wort, die Kartennutzlast trägt kein Korpusfeld. Ein Besucher sieht von den acht Korpora
heute nichts. Das ist der größte offene Brocken (Korpusname vorn bei Belegstellen, Seitentitel
dahinter).

## 4. Was heute gebaut wurde (Reihenfolge = Commits)

| Commit | Was |
|---|---|
| `cd4ce7795`, `93635225c` | Entwurf: Linkcheck beim Einfügen, dritter Zustand des Adressfeldes |
| `1eba82ad3` | Entwurf auf das Korpus-Modell des Owners umgeschrieben |
| `568f97336` | `source_corpus` + Modul (Domain als Schlüssel) |
| `777b544e9` | Adressauskunft: Katalog zuerst, sonst Seite lesen (`<h1>` schlägt `<title>`) |
| `d36915905` | Prüfknopf, Enter, drei Zustände |
| `37482f3f0` | gesperrte Felder zeigen ihre Katalogwerte („der rest fehlt irgendwie") |
| `41736692d` | Korpus-Feld + beschriftete Eingabezeile |
| `b0151909b` | bekannte Seite wird **korrigiert**, nicht gesperrt |
| `8e1e56ff7` | erster Eintrag einer Domain legt ihren Korpus an; Korrektur läuft **nach** dem Verknüpfen |
| `11e17d7f8` | der Korpus **besitzt** Art/Lizenz/Nennung/Kanon — Änderung gilt allen |
| `152f1ef70` | die **Form** (Werke / Belegstellen) |
| `4c245febe` | Mapping-Tabelle **vor** dem Lauf, 133 Zeilen (`docs/quellen-mapping-tabelle.html`) |
| `e915dacca` | Lizenz + Plattform der Wirte autoritativ hergeleitet (MediaWiki `api.php`) |
| `53291f82f`, `98c2711f2` | die acht Korpora als SQL — **vom Owner ausgeführt** |
| `03c514300` | „Titel aus den Seiten holen" als Lauf, **Serverhälfte** (keine Oberfläche!) |
| `d95be4b32` | Korpuskasten erscheint erst mit Adresse ← **hier entstand der Befund aus §1** |
| `2eef24d71` | drei Gruppen im Bearbeiten-Kasten; Seite(n)/Abdeckung vor den Kasten; Abbrechen; leere Kachel ohne Rahmen |

### Zwei SQL-Läufe hat der Owner selbst ausgeführt
* `sql/quellen-korpora-anlegen.sql` — 8 Korpora
* `sql/quellen-titel-aus-den-seiten.sql` — 117 Titel

Ergebnis danach live gemessen: 120 Zeilen tragen Seitentitel, 0 ohne Titel, „Briefspiel" 33→4,
„AlmadaWiki" 24→0. Diese Titel stehen in `sources.label` und wirken deshalb **überall sofort**.

## 5. Was offen ist

* 🔧 **Der Befund aus §1** — Art/Lizenz/Namensnennung unsichtbar ohne Wirt. Owner-Entscheid nötig.
* 🔧 **Die öffentliche Anzeige** kennt den Korpus nicht (§3).
* 🔧 **Der Titel-Lauf hat keine Oberfläche.** `corpus_titles_probe`/`_apply` existieren serverseitig
  (`03c514300`), es gibt keine Vorschau, kein Knopf. Der Owner hat gefragt „warum muss ich das
  manuell machen" — die Serverhälfte ist die Antwort darauf, die Bedienhälfte fehlt.
* 🔧 **Die 133 bestehenden Quellen** haben ihre Korpuswerte noch nicht übernommen.
* 🔧 Zwei Wirte ohne Korpus: **Nordmarken-Wiki**, **Kosch-Wiki**.
* 🔧 Owner-Frage nie beantwortet: gilt eine **Genehmigung** dem Korpus oder der einzelnen Seite?

## 6. Was eine neue Sitzung zuerst wissen sollte

💣 **Es arbeitet mindestens eine ZWEITE Sitzung im selben Bereich.** `931c6b855`
(„das Kanon-Etikett steht fett") kam 9 Minuten nach meinem Push und fasst dieselbe Oberfläche an.
Vorher `git log --oneline -15` lesen, nie `git add -A`.

🪤 **Ich habe heute zweimal in dieselbe Falle getreten**, beide stehen schon in AGENTS.md:
1. Ein Heredoc frisst Backslash-Sequenzen — mein Patch schrieb echte Steuerzeichen in eine Regex.
   Patch-Skripte gehören in den Scratchpad, nicht in ein `<<EOF`.
2. Ein Quelltext-Test schlägt am **Kommentar** an, der die Zeile erklärt. Von fünf Mutationen
   überlebte genau die, deren Zeile ich gelöscht hatte, weil der Kommentar darüber sie nannte.

⭐ **Testlage:** JS 426 Dateien null rot; PHP nur der bekannte vorbestehende
`link-url-test.php` (echter DNS-Abruf). Die neuen Zusicherungen liegen in
`js/review/__tests__/quellen-adresspruefung.test.js` (72) und `…/quellen-bearbeiten-form.test.js`.
