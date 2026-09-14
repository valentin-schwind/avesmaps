# ÜBERGABE — Garetien-Importer, Umbau des Import-Workflows

**Stand:** 12.09.2026 · **Zweig:** `claude/garetien-importer-flachen-merge-iiz0zd` ·
**Gebaut:** nichts. Entwurf, Befundliste, Mockup.

---

## 0 · 🔴 ZUERST LESEN: EINE QUELLE FEHLT, UND SIE IST NICHT VERLOREN — NUR NICHT HIER

Der Owner hat am 12.09.2026 einen Plan genannt, den es in diesem Repository **nicht gibt**:

```
docs/superpowers/plans/2026-09-09-garetien-fragmente-verbund.md
```

Nachgeprüft, nicht vermutet:

- nicht im Arbeitsbaum,
- auf **keinem** der 23 Remote-Zweige (alle flach gefetcht und ihre Bäume durchsucht, auch nach
  `fragment` und `garetien.*verbund`),
- **keine** Commit-Historie auf GitHub für diesen Pfad — er wurde also auch nicht gepusht und
  später gelöscht,
- repoweiter Grep nach `fragmente-verbund`: null Treffer. Kein anderes Dokument zitiert ihn.

Er ist in einer **anderen Sitzung** entstanden und liegt dort. Der Owner sagt dazu (12.09.2026):
*„ich würd gern deine erkenntnisse mit denen aus der vorherigen session, zu der ich gerade keinen
zugang habe, kombinieren"* — und er wird jene Sitzung bitten, beide Stände zu verbinden.

**Dasselbe gilt für ein Mockup:** `docs/garetien-importer-mockup.html` wird in fünf Dokumenten
dieses Repos als *„die freigegebene Vorlage"* (27.08.2026) zitiert und liegt ebenfalls auf keinem
Zweig. Wer den fehlenden Plan hat, hat vermutlich auch dieses Mockup.

> ⚠️ **Wer diesen Text liest und den fehlenden Plan besitzt: nicht überschreiben, nicht
> ersetzen — gegeneinander halten.** Das Verfahren steht in §4. Keiner der beiden Stände ist
> der gültige; der gültige entsteht erst aus beiden.

---

## 1 · Was in dieser Sitzung entstanden ist

| Datei | Inhalt |
|---|---|
| `docs/superpowers/specs/2026-09-12-garetien-import-workflow-design.md` | Der Entwurf: der neu geschnittene Workflow, die Zielwahl, die Merge-Regel, die Owner-Entscheide dieses Tages, zehn offene Entscheidungen |
| `docs/superpowers/plans/2026-09-12-garetien-importer-befunde.md` | **82 Befunde** aus sieben Prüfläufen am Code, nach den Stationen des Imports sortiert, jeder mit Codestelle |
| `docs/garetien-import-workflow-mockup.html` | Das Mockup: „Offen“ und „Stage“ als gebaute Fenster, die Merge-Gruppe, der Zusatz-Fall |
| diese Datei | Übergabe und Verfahren zum Zusammenführen |

**Die sieben Prüfläufe** (je ein Agent, alle nur lesend, alle mit dem Auftrag, am Code zu belegen
statt zu vermuten): *neuer Editor* · *Vielimporteur* · *Datenpflege* — dann, nach dem Befund des
Owners „viele sachen sind noch nicht beachtet“, vier weitere auf die ungeprüften Flächen:
*vor dem Fenster* · *der Abgleich* · *die anderen Objektarten* · *das Fenster als Fläche*.

---

## 2 · Was diese Sitzung NICHT konnte

Diese Grenzen gelten für **jeden** Befund der Liste. Wer sie beim Zusammenführen übersieht, hält
Belegtes und Hergeleitetes für gleichwertig.

- 🔴 **Keine angemeldete Sitzung.** Kein Handgriff lief je gegen die echte Datenbank oder im
  Browser. Dieselbe Lücke steht seit dem 27.08.2026 in jeder Übergabe dieses Werkzeugs.
- 🔴 **Keine Datenbank.** Jede Mengenangabe stammt aus dem Code, aus einem Kommentar, aus einer
  Fixture oder aus einem Entwurf — nie aus einer Abfrage am Bestand.
- 🔴 **`garetien.de` ist per Egress gesperrt** (`CONNECT tunnel failed, 403`). Die Quelldaten
  konnten nicht gelesen werden; die Suffix-Verteilung der Merge-Regel ist deshalb **ungemessen**.
- ⚠️ **Kein Browser.** Die Fenster-Befunde sind am CSS **gerechnet**. Vier Fragen sind
  ausdrücklich als „nur im Browser zu klären“ markiert.
- ⚠️ **Nicht gegen die Commits vom 8./9. September geprüft.** Ob einzelne Befunde inzwischen
  erledigt sind, ist offen — an jenen Tagen wurde am Importer gearbeitet.

---

## 3 · Die drei Maßstäbe des Owners

Er hat sie am 12.09.2026 für den vereinigten Plan gesetzt: **Fehlerfreiheit, Usability,
Einstellungsmöglichkeiten.** Wo die beiden Stände auseinandergehen, entscheidet, welche Fassung
diesen dreien besser dient — nicht, welche älter oder ausführlicher ist.

- **Fehlerfreiheit** heißt hier nicht „keine Bugs“, sondern: *keine Handlung, die etwas anderes
  tut als sie sagt.* Die schwersten Befunde dieser Liste sind alle von dieser Art — ein Knopf,
  der ohne Rückfrage schreibt; eine Meldung „40 abgelehnt“, wo null abgelehnt wurden; ein Lauf,
  der „fertig“ sagt und fünf Ebenen vermisst.
- **Usability** heißt: der Editor sieht **vor** dem Klick, was passiert, und **nach** dem Klick,
  was passiert ist. Daran hängen die Ziel-Marke in der Zeile, die Suche auf der Stage, die
  Zielwahl statt zweier widersprüchlicher Häkchen.
- **Einstellungsmöglichkeiten** ist der Maßstab, der im bisherigen Entwurf am schwächsten
  vertreten ist. Was heute fest im Code steht und begründet einstellbar sein könnte, ist in
  §5 dieser Datei gesammelt — **das ist die Stelle, an der der fehlende Plan am ehesten mehr
  weiß**, denn der Owner hat ihn im selben Atemzug mit den Einstellungen genannt.

---

## 4 · Das Verfahren zum Zusammenführen

Drei Durchgänge, in dieser Reihenfolge. Der dritte ist der wichtigste und wird am ehesten
übersprungen.

### (a) Gemeinsame Ergebnisse — was beide Stände sagen, ist belastbar

Wo der fehlende Plan und diese Befundliste **dieselbe** Aussage treffen, ist sie zweifach
unabhängig gefunden und braucht keine weitere Prüfung. Innerhalb dieser Sitzung gab es zwei
solche Fälle, und sie waren die verlässlichsten von allen:

- **Stadtviertel** (zwei Prüfläufe unabhängig): ausgeschlossen mit der Begründung „hat bei uns
  kein Gegenstück“, obwohl die Ortsklasse existiert — und **zwei Tests nageln den falschen
  Zustand fest**.
- **Der Wiki-Schlüssel am Schild statt an der Fläche** (zwei Prüfläufe): jede importierte
  Landschaft bleibt halb zugewiesen und bezieht ihr Kanon-Etikett aus der falschen Quelle.

⭐ Solche Doppelfunde gehören im vereinigten Plan **markiert** — sie sind die Punkte, bei denen
man nicht mehr nachmessen muss.

### (b) Ergänzungen — was nur einer hat, gehört hinein

Beide Stände haben blinde Flecken, und sie sind **verschieden**:

- Diese Sitzung hat **den Code** gelesen und **nie die echten Daten** gesehen.
- Der fehlende Plan entstand am 09.09.2026 in einer Sitzung, die am Importer gearbeitet hat —
  vermutlich **mit** Owner-Gesprächen, Messungen und Entscheiden, die hier fehlen.

⚠️ Ein Punkt, der nur in einem der beiden Stände steht, ist deshalb **kein Widerspruch** und
darf nicht als „überholt“ verworfen werden. Er ist eine Ergänzung, bis jemand ihn widerlegt.

### (c) Fehlerchecks — wo beide sich widersprechen, ist mindestens einer falsch

💣 **Ein Widerspruch wird nicht ausgehandelt, sondern am Code nachgemessen.** Nicht die jüngere
Fassung gewinnt und nicht die ausführlichere, sondern die, die eine Codestelle nennt, die man
öffnen kann.

Dieses Haus hat mehrfach dafür bezahlt, dass ein Satz, der wie eine geprüfte Zusage aussah, nie
nachgemessen wurde (AGENTS.md kennt die Fälle: der Faktor 3,000 der Routing-Umrechnung; der
Docblock, der einer ganzen Objektart ein Etikett absprach; der Kommentar, der „keinen interaktiven
Einzelabruf“ behauptete). **In dieser Befundliste stehen mindestens vier solche Sätze** — Kommentare
im Code, die das Gegenteil dessen behaupten, was der Code tut:

| Der Satz im Code | Was der Code tut |
|---|---|
| „Der Große Fluss“ und „Großer Fluss“ seien dasselbe | Gemessen: **nein**, gestrichen wird nur der Artikel |
| Die Namensregel sei „NIE allein entscheidend“ | Sie entscheidet an **drei** Stellen |
| Der Client stemple den Lauf auf „partial“ | Er stempelt „done“, mit nur einer Ebene im Blick |
| Ein Kopfkommentar verbiete den Massenlauf | Die Übernahme fährt ihn, zweimal je Fläche |
| Ein `entity_key` enthalte „keine Zeilen-ID“ | Für artikellose Zeilen enthält er genau die |

⭐ **Wer beim Zusammenführen auf einen Widerspruch stößt, prüft zuerst, ob einer der beiden
Stände einem solchen Kommentar geglaubt hat.**

---

## 5 · Einstellungsmöglichkeiten — der Maßstab, der hier am dünnsten ist

Der Owner nennt ihn als dritten von drei. Was heute **fest im Code** steht und begründet
einstellbar sein könnte (die Zahlen sind die heutigen Festwerte):

| Heute fest | Wert | Warum eine Einstellung sinnvoll wäre |
|---|---|---|
| Punkt-Trefferschwelle | 0,3 Einheiten (0,9 Meilen) | Liegt unter dem Messfehler der Koordinaten (p90 3,5 Meilen) |
| Linien-Trefferschwelle | 2,0 Einheiten (6 Meilen) | Gilt für Pfad wie Reichsstraße gleich |
| Probepunkte je Deckung | 16 | Deckelt zugleich die Abschnittsliste — ein Weg trifft nie mehr als 16 |
| Deckungsmaß | Median | 50 % genügen für „deckt sich“; eine Quote wäre einstellbar |
| Ausdehnungsverhältnis | 0,75 | Einseitig, prüft nur, ob ihr Objekt kleiner ist |
| Innerorts-Kandidaten | 8 | Ungemessen, ob das in dichter Gegend reicht |
| Kartenrand-Toleranz | 64 Einheiten | Der Schreibweg lehnt ab, was der Import durchlässt |
| Staging-Läufe | 3 behalten | Begründung im Kommentar nennt einen Lauf-Wähler, den es nicht gibt |
| Zeilen in der Liste | 1000 (Vorgabe) | Kleinste Stufe zu groß für Tastaturbedienung |
| Endkreuzungen | immer an | Owner-Entscheid — aber ohne Einrasten an vorhandene Knoten |

⚠️ **Nicht alles davon soll ein Regler werden.** Das Haus hat die Gegenregel: eine Zahl, die man
aus etwas anderem *rechnen* kann, wird gerechnet und nicht gepflegt; und ein Regler, dessen Wert
stillschweigend nirgends gilt, ist von einem kaputten Formular nicht zu unterscheiden
(AGENTS.md §11, „Das Zoomband einer Beschriftung“). Die Tabelle ist eine **Kandidatenliste für
den vereinigten Plan**, keine Bestellung.

---

## 6 · Die zehn offenen Entscheidungen

Sie stehen ausführlich in `…-garetien-import-workflow-design.md` §7. Kurzform, weil der
vereinigte Plan an ihnen hängt:

1. **Umfang und Reihenfolge** des Plans — vier Vorhaben oder eines?
2. **Wird die Identität stabil?** (heute: die Zeilennummer im Export — Voraussetzung für den Merge)
3. **Was soll das Telefon können** — „nicht kaputt“ oder „bedienbar“?
4. **Kommt Stufe 5 (Territorien) hinein?** 585 Junkertümer gegen die Baronie-Geometrie
5. **Bleibt „auf die Karte *zusätzlich* zu X“?** (334 Objekte hängen daran)
6. **Berge:** Punkt gegen Punkt messen — oder Bergflächen als eigene Form?
7. **Was wird aus der Küste?** (20 Linien ohne richtige Zielform)
8. **Ab wann heißt „deckt sich“ wirklich deckt sich?**
9. **Strömungsrichtung beim Import** offenlassen oder annehmen?
10. **Wird der Bestand nachgezogen?** (512 übernommene Objekte mit Waisen und falschem Träger)

Und **vier Messungen**, die in dieser Umgebung nicht möglich waren: Suffix-Verteilung ·
gleichnamige Orte jenseits der Schwelle · wie grob unsere Geometrien gezeichnet sind ·
ein Trockenlauf der Merge-Erkennung vor dem Scharfstellen.

> ⭐ Die letzte ist die wichtigste. Als am 08.09.2026 die Wegquellen verteilt wurden, meldete der
> Trockenlauf **1070** statt der erwarteten ~50 — und die Differenz war kein Rechenfehler, sondern
> eine ganze Objektklasse, die niemand bedacht hatte. **Der Trockenlauf ist die Messung, die kein
> Test leisten kann.**

---

## 7 · Wohin das führen soll

Ein **vollwertiger Umbauplan** (Owner, 12.09.2026), der aus beiden Ständen entsteht und diese
Form hat — die Form, die sich in diesem Repo bewährt hat:

1. **Ein Entwurf** (`specs/…-design.md`) mit den Owner-Entscheiden in §0 und den Zusicherungen,
   die der Bau nicht unterlaufen darf.
2. **Ein Mockup** (`docs/…-mockup.html`) mit **Vertrag**-Marken an den Werten, die gebunden sind.
3. **Ein Bauplan** (`plans/…md`), in Aufgaben geschnitten, **jede mit eigenem Testlauf** und
   eigener Abnahme — so wie `2026-09-06-garetien-importer-stage.md` es mit seinen 16 Aufgaben tut.
4. **Eine Abnahmeliste** aus den 💣/⚠️/🔴-Zeilen des eigenen Entwurfs. AGENTS.md §9 ist an dieser
   Stelle unmissverständlich: *„Der eigene Entwurf ist die Abnahmeliste“* — zwei der vier
   Regressionen vom 10.08.2026 standen wörtlich als Warnung im eigenen Entwurf und wurden nicht
   gebaut.
5. **Die sichtbaren Schritte gehen einzeln live** (§9), und vor jedem Push läuft das **ganze**
   Testfeld, nicht nur die eigenen Tests.

⚠️ **Und eine Reihenfolge-Warnung aus den Befunden selbst:** Der Workflow-Umbau (Zielwahl, Stage,
Merge) setzt voraus, dass die Identität der Objekte stabil ist — sonst verlieren beim ersten
Zusammenfassen alle Teile ihre Entscheidungen. Entscheidung 2 ist damit keine Nebenfrage, sondern
bestimmt, ob der Merge überhaupt vor ihr gebaut werden kann.

---

## 8 · Wo die Sachen liegen

- Befunde: `docs/superpowers/plans/2026-09-12-garetien-importer-befunde.md`
- Entwurf: `docs/superpowers/specs/2026-09-12-garetien-import-workflow-design.md`
- Mockup: `docs/garetien-import-workflow-mockup.html`
- Die vier älteren Garetien-Entwürfe und die zwei Übergaben liegen unverändert daneben; §12 des
  Stage-Entwurfs („Paket 2 — Abgleich“) ist in der Befundliste vollständig nachgeprüft und
  aufgegangen.
