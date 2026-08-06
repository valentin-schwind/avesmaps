# Aus „Abenteuer" werden „Spielwerke"

**Stand:** 2026-08-06 · **Status:** Entwurf, mit dem Owner abgestimmt, noch nicht gebaut ·
**Verwandt:** [`2026-08-06-sync-uebernahme-design.md`](2026-08-06-sync-uebernahme-design.md) (Sitzung 2
baut darauf auf), `docs/abenteuer-feature-design.md`, AGENTS.md §11 „Abenteuer"

---

## 1. Worum es geht

Ein Abenteuer ist **eine Form** von Spielwerk, nicht die einzige. Eine Regionalspielhilfe wie
„Das Bornland" gehört genauso an einen Ort — sie beschreibt ihn. Heute kann unsere Karte sie nicht
zeigen, weil das ganze Feature „Abenteuer" heißt und nur Abenteuer einliest.

Der Umbau ist kleiner, als er klingt: die Datenhaltung passt schon, die Oberfläche braucht neue Wörter,
und der Sync braucht eine breitere Weiche plus ein zweites Quellfeld.

---

## 2. Was entschieden ist (Owner, 06.08.2026)

| | |
|---|---|
| Kategorie heißt **Spielwerk**, „Abenteuer" ist eine Art davon | an jeder Oberfläche |
| Aufgenommen werden | **Abenteuer · Regionalspielhilfe · Spielhilfe** |
| **Regelband und Buch bleiben draußen** | hart, nicht über eine Regel |
| Nicht-Abenteuer erscheinen mit der Rolle **„beschreibt"** | ohne Spoiler-Schleier |
| Abenteuer behalten „beginnt hier / spielt hier (Spoiler)" | unverändert |
| Ein Werk **ohne verlinkten Ort wird nicht angelegt** | sonst kämen leere Einträge herein |
| Die Bezeichner im Code werden **voll umbenannt** | aber in **eigener Sitzung**, nach diesem Umbau |
| Reihenfolge | Spielwerke → Rename → Sync-Übernahme für Spielwerke |

---

## 3. Die nachgeprüften Tatsachen

Am 06.08.2026 gegen das echte Wiki geprüft (Einzelabrufe `?action=raw`, **kein** Crawl —
[[wiki-aventurica-dump-policy]]).

1. **Die vier Listenseiten sind unbrauchbar.** `Regionalspielhilfe/Liste` besteht aus
   `{{Kat Liste Publikationsart}}` — eine DPL, im Dump also leer. Derselbe Fall wie bei den
   Regionen-Unterseiten. Der Weg führt wie bei den Abenteuern über `Art` in der `{{Infobox Produkt}}`.
2. 💣 **Eine Regionalspielhilfe hat KEIN `Ort`-Feld.** Geprüft an „Das Bornland":
   `Art=Regionalspielhilfe`, kein `Ort`, dafür `Thema=[[Bornland (Bund)|Bornland]]; [[Vallusa|Vallusa]]`
   — Wikilinks, **semikolongetrennt**. Das ist die Ortsquelle für alles außer Abenteuern.
3. 💣 **`Thema` ist nicht immer eine Ortsliste.** „Abenteuer Ausbau-Spiel" (`Art=Regelband`) hat
   `Thema=erweiterte Regeln` — Freitext. „Am Rande des Reiches" (`Art=Spielhilfe`) hat ein **leeres**
   `Thema`. Nur die Wikilinks zählen.
4. **`Art` trägt den Kategorienamen wörtlich** (`Regionalspielhilfe`, `Regelband`, `Spielhilfe`), fällt
   also durch dieselbe Faltung wie heute die Abenteuertypen.
5. **Die Kategorie `Buch` hat vier Seiten insgesamt.** Sie wäre eine Rubrik für nichts.
6. **Der Katalog ist schon da.** `wiki_publication_catalog` enthält alle ~3060 Produktseiten samt
   `art`. Es wird **nichts neu gecrawlt**; die Weiche entscheidet nur, welche davon in
   `wiki_adventure_catalog` promoviert werden.

---

## 4. 💣 Die Fallen

**(a) Der Freitext-Rückfall darf `Thema` nicht anfassen.** `avesmapsWikiParseAdventurePlaceList` liest
eine Kommaliste als Namen, wenn keine Wikilinks da sind. Auf `Thema=erweiterte Regeln` angewandt legt
das einen **Ort namens „erweiterte Regeln"** an, der dann durch den Resolver läuft und im Editor als
unaufgelöster Ort steht. Für `Thema` gilt: **nur Wikilinks, sonst nichts.**

**(b) Ein neuer `product_type` MUSS in `PRODUCT_TYPES` im Editor stehen.** Sonst hat der Eintrag keine
passende Option, zeigt beim Öffnen den falschen Typ und **schreibt ihn beim Speichern still um**. Das
ist 2026-07-19 schon einmal passiert (`kampagne` gegen „Kampagnenband", 27 Bände).

**(c) Die Weiche greift beim „Dump holen", nicht beim Syncen.** Wer nur synct, ändert gar nichts — die
Seiten stehen dann noch nicht im Staging. Reihenfolge bleibt: **Dump holen → syncen.**

**(d) Ein unbekanntes `Art` kostet das ganze Werk.** Dieselbe Funktion beantwortet „ist das ein
Spielwerk?" und „welcher Quelltyp ist das?". Kennt die Tabelle den Wert nicht, fällt die Seite lautlos
aus dem Katalog — kein Fehler, kein Log. Deshalb gehört zu jeder Erweiterung eine Messung
(`GET /api/edit/wiki/publication-art-survey.php`, liest `art` aus dem Katalog, **ohne** Wiki-Zugriff).

**(e) Das Frontend rechnet mit zwei Rollen.** `role` ist heute `start|play`, und `play` **ist** der
Spoiler. Ein dritter Wert muss überall dort ankommen, wo heute „alles, was nicht start ist, ist
Spoiler" steht — sonst wird eine Regionalspielhilfe als Spoiler verschleiert.

**(f) 💣 Und der Server schreibt eine unbekannte Rolle STILL auf `play` um.** In
`api/_internal/app/adventures.php` steht zweimal
`if ($role !== 'start' && $role !== 'play') { $role = 'play'; }` (bei `add_place` und `set_place`).
Wird das nicht mitgeändert, landet jede über den Editor gesetzte Rolle `covers` als **`play`** in der
Datenbank — also als Spoiler, und zwar ohne Fehlermeldung. Dieselbe Bauart wie Falle (b), dieselbe
Wirkung: der Wert sieht beim Speichern richtig aus und ist es beim nächsten Laden nicht mehr.

---

## 5. Das Datenmodell — keine neue Spalte

`adventure.product_type` **ist bereits** der gefaltete `Art`-Wert. Es kommen nur Werte dazu:

```
heute:  gruppenabenteuer soloabenteuer kurzabenteuer szenario anthologie kampagne kampagnenband metaband
neu:    regionalspielhilfe spielhilfe
```

Eine **einzige** Tabelle in einer Datei sagt, welcher Typ ein Abenteuer ist:

```php
AVESMAPS_GAME_WORK_KINDS = [
    'abenteuer'          => [ …die acht Abenteuertypen… ],   // Rollen start|play, play = Spoiler
    'regionalspielhilfe' => ['regionalspielhilfe'],          // Rolle covers
    'spielhilfe'         => ['spielhilfe'],                  // Rolle covers
];
```

Ein unbekannter `product_type` gilt als **Abenteuer** — so verhalten sich alle heute vorhandenen Zeilen
weiter genau wie bisher, ohne Backfill.

**Einziger Schema-Zuwachs:** `adventure_place.role` bekommt den dritten Wert **`covers`**. Die Spalte
ist `VARCHAR(8)`, passt also ohne `ALTER`.

Die Tabellen behalten in DIESER Sitzung ihre Namen. Der volle Rename ist beschlossen, aber eigene
Sitzung (§8).

---

## 6. Der Sync

**Die Weiche gibt die Art zurück statt ja/nein.** Aus `avesmapsWikiProductIsAdventure(string): bool`
wird `avesmapsWikiProductWorkKind(string): string` (`''` = kein Spielwerk). Die drei zugelassenen Arten
stehen als Liste da; Regelband und Buch fallen durch, weil sie nicht darin stehen.

**Die Ortsliste kommt aus zwei Feldern:**

| Art | Feld | Rolle der Orte |
|---|---|---|
| Abenteuer | `Ort` | erster = `start`, Rest = `play` |
| Regionalspielhilfe, Spielhilfe | `Thema` | alle `covers` |

⚠️ **Der Trenner ist egal** — beide Wege lesen die **Wikilink-Ziele in Quellreihenfolge** heraus, und
das tut ein Ausdruck über `[[…]]`, dem Komma und Semikolon gleichgültig sind. Genau deshalb ist der
Freitext-Rückfall der einzige Unterschied zwischen den beiden Wegen: für `Thema` bleibt er **aus**
(Falle a). Ein Werk, dessen Liste danach leer ist, wird **gar nicht erst** in den Katalog geschrieben.

Alles andere am Sync bleibt: Staging-Aufbau während „Dump holen", owner-getriggertes Syncen,
override-sicherer Reconcile (`origin='wiki'`), Cover, Shop-Links, Resolver.

---

## 7. Die Oberfläche

| heute | danach |
|---|---|
| „Abenteuer in Gareth" | **„Spielwerke in Gareth"** |
| Umschalter „Beginnt hier (N) \| Spielt hier (Spoiler) (M)" | dazu eine dritte Gruppe **„Beschreibt (K)"**, ohne Schleier |
| Floating-Kachel „Abenteuer" | **„Spielwerke"** |
| Spotlight-Abschnitt „Abenteuer" | **„Spielwerke"**, Art als Beisatz an der Zeile |
| Menüband-Reiter „Abenteuer" / „Abenteuer bearbeiten" | **„Spielwerke"** / **„Spielwerke bearbeiten"** |
| Editor: Produkttyp-Auswahl (8 Werte) | **gruppierte** Auswahl: `<optgroup>` Abenteuer / Regionalspielhilfe / Spielhilfe |
| Editor-Listenfilter | zusätzlich **Art** |
| Änderungsprotokoll `delete_adventure` | Beschriftung „Spielwerk gelöscht" (Aktionsname bleibt) |

⚠️ **Die Art wird NICHT als zweites Feld gespeichert.** Sie ist aus `product_type` abgeleitet (§5); die
Gruppierung im Editor ist Anzeige, kein Datenmodell. Wer sie mitspeichert, hat ab dem ersten
Handgriff zwei Wahrheiten über dieselbe Zeile.

**Visuell unterschieden** wird über das vorhandene Art-Merkmal an der Karte (`.tag`), nicht über eine
neue Farbe: die Designsprache kennt schon Pills, und eine zweite Farbfamilie für „Art" wäre genau die
Divergenz, gegen die §12 geschrieben ist.

⚠️ **Der Aktionsname `delete_adventure` im Protokoll bleibt.** Er steht in
`AVESMAPS_COLLECTION_AUDIT_ACTIONS`, in `avesmapsCanUndoAuditAction` und in bereits **geschriebenen
Protokollzeilen**. Nur die Beschriftung ändert sich; alte Zeilen bleiben lesbar.

---

## 8. Was NICHT dazugehört

- **Kein Rename der Bezeichner.** Beschlossen, aber eigene Sitzung: 24 Dateien, 275 Vorkommen,
  4 Tabellen, 3 öffentliche Endpunkte. 💣 Der Deploy löscht nie — ein umbenannter Endpunkt bleibt als
  funktionierende Waise auf dem Server liegen (AGENTS.md §10). Empfohlener Zielname **`game_work` /
  `game_work_place`** (`publication` ist durch das Quellensystem belegt), Migration als
  selbstheilendes `RENAME TABLE`, bewacht durch „nur wenn die alte existiert und die neue nicht" —
  ein Deploy, kein Zeitfenster.
- **Keine Übernahme-Vorschau.** Die kommt in der Sitzung danach und gilt dann für Spielwerke als
  Ganzes.
- **Keine neue Ortsquelle.** `Inhalt`, `Reihentitel` und `Setting` bleiben ungenutzt.
- **Keine Änderung an Cover, Shop-Links oder Resolver.**

---

## 9. Wie geprüft wird

- **Die Weiche ist rein und wird mit echten `Art`-Werten geprüft:** die drei zugelassenen Arten kommen
  durch, `Regelband`, `Buch`, `Hörbuch`, `Brettspiel`, `Merchandising` fallen durch — je eine
  Zusicherung, wie schon heute.
- 💣 **Der Freitext-Rückfall:** `Thema=erweiterte Regeln` MUSS eine leere Ortsliste ergeben. Das ist
  Falle (a) in einer Zusicherung, und sie wird durch Mutation belegt (Rückfall wieder einschalten ⇒ rot).
- **Kein Ort, kein Eintrag:** ein Werk mit leerem `Thema` erzeugt keine Katalogzeile.
- **Die Rollen:** ein Abenteuer bekommt `start` + `play`, eine Regionalspielhilfe ausschließlich
  `covers` — und der Spoiler-Schleier greift nur bei `play`.
- **Der Editor-Zwang:** eine Zusicherung hält `PRODUCT_TYPES` in `html/adventure-editor.html` gegen die
  serverseitige Liste. Das ist Falle (b), und sie ist am Quelltext prüfbar.
- ⚠️ **End-to-End braucht einen echten „Dump holen" + Sync** — lokal gibt es keine Datenbank. Vor dem
  ersten Lauf die Art-Messung fahren, damit die Zahl der neuen Werke vorher bekannt ist.

---

## 10. 🔧 DU: eine Frage

**Wie viele Werke kommen dazu?** Die Zahl steht schon in unserer eigenen Datenbank, es braucht keinen
Wiki-Zugriff: `GET /api/edit/wiki/publication-art-survey.php` (angemeldet) zählt die `art`-Werte im
Publikationskatalog. Interessant sind `Regionalspielhilfe` und `Spielhilfe`. Kommt dabei eine Zahl in
der Größenordnung von tausend heraus, lohnt vor dem Bau ein zweiter Blick darauf, wie viele davon
überhaupt ein verlinktes `Thema` haben — sonst baue ich eine Rubrik für Einträge, die die
„kein Ort, kein Eintrag"-Regel gleich wieder verwirft.
