# Ein Fenster für Landschaftsfläche und Beschriftung — Entwurf

**Stand:** 2026-08-25 · **Owner-GO:** 25.08.2026 („Vereinigung GO")
**Mockup (lauffähig):** `docs/landschaft-dialoge-mockup.html`, Reiter „Vereinigung"
**Vorläufer:** `ui(beschriftung): der Dialog wird kompakter …` (77e30062, live 25.08.2026)

---

## 0. Der Auftrag, wörtlich

> „Dieser Dialog soll nun Flächen+Labels miteinander verbinden. Klick ich auf ein Label komm ich auf
> den neuen Dialog und automatisch auf ‚Beschriftung', klick ich auf die Eigenschaften der Fläche,
> komm ich auf Fläche."

Und die Frage davor:

> „macht es sinn die eigenschaten label und fläche weiterhin zu trennen? macht es sinn daraus eine
> einheit zu machen, wobei man label und fläche unabhängig voneinander auf der karte platzieren kann
> (außer bei der kurvenbeschriftung, dann is das label an die fläche gebunden)"

---

## 1. Was gemessen wurde, bevor entschieden wurde

Live am 25.08.2026, je eine Anfrage gegen `api/app/ecosystem-areas.php` und
`api/app/map-features.php`:

| Befund | Zahl |
|---|---:|
| Beschriftungen gesamt | 961 |
| … **ohne** Fläche (69 Berggipfel, 42 „Region", 38 Wald, 21 Fluss, 16 Tal …) | 254 (26 %) |
| Flächen (Regionen) gesamt | 1026 |
| … **ohne** Beschriftung | 334 (33 %) |
| … mit genau einer Beschriftung | 679 |
| … mit zwei oder drei (Ingvaltal, Yaquirtal, Eiszinnen …) | 13 (1,3 %) |
| Regionen mit mehr als einer Fläche | 1 |
| **Paare, bei denen Flächenname und Beschriftungstext identisch sind** | **679 von 679 = 100 %** |

🚩 **Damit sind drei Stellen überholt — und meine erste Fassung dieses Absatzes war es auch.**
Hier stand, AGENTS.md §11 sage „zweimal: der Finsterkamm liegt in 57 Flächen". Nachgesehen stimmt
das nicht: AGENTS.md sagt „57 **Einheiten lang** und trägt seinen Namen **zweimal**" — eine Länge
und eine Labelzahl, nicht eine Flächenzahl. Die Zahl „57 **Flächen**" steht woanders, nämlich
dreimal: in `index.html`, in `map-features-ecosystem-properties.js` und im Handbuch.

Live gemessen am 25.08.2026 trägt der Finsterkamm **kein einziges** Label und liegt in **einer**
Fläche; 1025 von 1026 Regionen haben genau eine. Korrigiert werden die zwei Stellen im Code und
der Halbsatz in AGENTS.md. ⚠️ Das **Handbuch** bleibt unangetastet — es gehört der nächtlichen
Routine (AGENTS.md §9); der Commit-Betreff nennt die Wirkung, damit sie es findet.

⚠️ Und die Lehre daraus gehört hierher, nicht in eine Fußnote: **eine Zahl in einer Begründung
altert.** Wer sie zitiert, sollte sie nachmessen — auch (und gerade) wenn sie in AGENTS.md steht.

---

## 2. Die Entscheidung: EIN FENSTER, ZWEI OBJEKTE

🔴 **Zusammengelegt wird die Bedienung, nicht die Ablage.**

**Dafür** sprechen vier Doppelungen, die es heute wirklich gibt:

1. **Der Name steht zweimal** — `ecosystem_region.name` und `map_features.text` — und ist in
   **jedem** der 679 Paare gleich. Zwei Felder in zwei Fenstern für einen Wert.
2. **`curve_label` und `curve_label_max` stehen in BEIDEN Dialogen** und bedienen denselben Wert.
   Das steht wörtlich als Warnung im Markup: „Wer hier einen dritten Zustand erfindet, hat zwei
   Wahrheiten über dieselbe Region."
3. **Nodix steht in beiden** — und gehört laut Code der Beschriftung, wird aber auch im
   Flächendialog bedient.
4. **Zwei getrennte Quellenlisten** für dasselbe Ding: Beschriftung `entity_type='region'` mit
   `map_features.public_id`, Fläche `entity_type='ecosystem'` mit `ecosystem_region.public_id`. Wer
   bei der Fläche eine Quelle einträgt, sieht sie bei der Beschriftung nicht.

Dazu: **„Regionname anzeigen"** ist ein Schalter der Beschriftung, den es nur im Flächendialog gibt.

⭐ **Und die Kopplung ist längst gebaut** — in BEIDE Richtungen und bewacht:
`renameLinkedEcosystemLabel` + `applyRegionToLabels`
(`map-features-ecosystem-properties.js`) tragen Name, Art, Nodix und Wiki-Landschaft abwärts;
`ecosystemRegionWriteBackPayload` (`map-features-ecosystem-label-writeback.js`) trägt sie aufwärts.
**Die Vereinigung erfindet also keine Verbindung — sie zeigt die, die es gibt.**

**Dagegen** spricht genau eine Sache, und sie ist hart: **ein Drittel jeder Seite hat keine
Gegenseite.** Ein Berggipfel ist ein Punkt und bekommt nie eine Fläche. Ein zusammengelegter
Datensatz wäre für **588 von 1281 Objekten** halb leer und nähme dem Ingvaltal zwei seiner drei
Beschriftungen — die 1:N-Beziehung ist ein Owner-Entscheid vom 28.07.2026 („der Finsterkamm will im
Norden UND im Süden beschriftet werden, jedes mit eigener Drehung/Position/Größe").

🔴 **Die freie Platzierung bleibt unangetastet.** Eine Beschriftung IST heute schon ein eigenes
Kartenobjekt mit eigener Position; das Fenster nimmt ihr das nicht. Die **Kurvenbeschriftung** ist
die vom Owner benannte Ausnahme: mit ihr läuft der Name auf der Mittelachse der Fläche, und die
eigene Position wirkt nicht mehr.

---

## 3. Das Fenster

**Titel:** „Landschaft bearbeiten". Breite 560 px (die größere der beiden — der Flächendialog stand
bei 420).

```
Landschaft bearbeiten                                    ×
┌───────────────────────────────────────────────────────┐
│ Name *   [ Nord-Gratenfels                        ]   │  ← schreibt BEIDE Hälften
│ Art *    [ Gebirge                             v  ]   │
│              ☐ Auto-Name                              │
└───────────────────────────────────────────────────────┘
[ Fläche ] [ Beschriftung ] [ Wiki & Quellen ]
…
[ Löschen ]                     [ Abbrechen ] [ Speichern ]
```

🔴 **Der Kopf gehört BEIDEN Hälften.** Name und Art stehen einmal da und schreiben über die
vorhandenen Propagationswege in beide Zeilen. ⚠️ Fehlt eine Hälfte, schreibt der Kopf nur die
vorhandene — die Propagation hat dafür schon ihre Wächter („nur bei echter Änderung", „ein leeres
Feld löscht nichts").

💣 **Drei Reiter, keine lange Rolle.** Untereinander wäre die Vereinigung so hoch wie beide Fenster
zusammen — genau das Problem, das der Vorläufer-Commit gerade bekämpft hat. Gemessen im Mockup:
**735 px, passt ohne Scrollen** (mit Kurvenbeschriftung 794).

| Reiter | Inhalt | gehört |
|---|---|---|
| **Fläche** | Für Klicks gesperrt · Gelände (nur Gebirge) · Gipfel · Höhenskala | der Region |
| **Beschriftung** | Auf der Karte anzeigen · Größe · Priorität · Zoom ab/bis · Nodix · Kurvenbeschriftung + Anzahl Kurvenlabel | dem Label |
| **Wiki & Quellen** | Wiki-Zuweisung (gekürzt) · Quellen | der Region |

---

## 4. Der Einstieg bestimmt den offenen Reiter

🔴 **Owner-Regel:** Klick auf eine **Beschriftung** → Reiter „Beschriftung". „Eigenschaften …" einer
**Fläche** → Reiter „Fläche".

⚠️ **Auch dann, wenn die gewählte Hälfte fehlt.** Wer auf eine Fläche ohne Beschriftung klickt und
danach auf „Beschriftung" wechselt, findet dort das Angebot — nicht ein leeres Formular und nicht
einen gesperrten Reiter. Ein Reiter, der sich nicht öffnen lässt, verbirgt genau die Handlung, die
gerade fehlt.

💣 **Der Einstieg ist ein Parameter des Öffners, kein zweiter Zustand.** Ein Modulzustand „welcher
Reiter war zuletzt offen" läuft beim zweiten Öffnen auseinander — dieselbe Falle, an der das
Anzeige-Menü und die Ansichts-Kacheln schon gescheitert sind.

**Aufrufer, die umgestellt werden** (alle heutigen Öffner von `openLabelEditDialog`):
`map-features-ecosystem-context-action.js` (2×), `map-features-labels.js` (2×, Klon und Neuanlage),
`review-panels-change-log.js` (1×) — und das Kontextmenü „Eigenschaften …" der Fläche
(`map-features-ecosystem-properties.js`, `MENU_ACTION = "ecosystem-properties"`).

---

## 5. Die vier Datenlagen

| Lage | live | Reiter „Fläche" | Reiter „Beschriftung" |
|---|---:|---|---|
| beides | 679 | normal | normal |
| nur Fläche | 334 | normal | **„Diese Fläche trägt keine Beschriftung."** + „Beschriftung anlegen" |
| nur Beschriftung | 254 | **„Diese Beschriftung liegt auf keiner Fläche."** + „Gehört zu" + „Fläche zeichnen" | normal |
| Fläche mit 2–3 Beschriftungen | 13 | normal | Auswahl + normal |

🔴 **Ein Satz, keine Statistik** (Owner 25.08.2026: „Reicht"). Die Zahlen aus dieser Tabelle stehen
im Entwurf, nicht im Fenster.

🔴 **„Beschriftung anlegen" sagt, WO sie entstanden ist** (Owner 25.08.2026): nach dem Anlegen
erscheint die Meldung „Beschriftung am Punkt der Unzugänglichkeit (x / y) angelegt." und der Reiter
zeigt das Formular. ⚠️ Die Meldung gehört dem **Vorgang**, nicht dem Fenster — sie verschwindet beim
nächsten Wechsel. Ein dauerhafter Auskunftssatz stand im ersten Entwurf und wurde gestrichen
(„braucht nicht dastehen").

💣 **Der Punkt der Unzugänglichkeit ist bereits die Regel** — jede Region bekommt ihr Label dort
(`polylabel`). Hier wird nichts neu gerechnet, nur benannt.

---

## 6. Mehrere Beschriftungen an einer Fläche

Eine Auswahl im Reiter, **keine zweite Fensterinstanz**:

```
Beschriftung  [ 1 — nördlich (Gratenfels)  v ]  [+ weitere]  [Diese entfernen]
```

💣 **Der Wechsel verwirft nichts stillschweigend.** Wer an Beschriftung 1 etwas ändert und auf 2
umschaltet, muss entweder gefragt werden oder die Änderung muss mitwandern. 🔴 Entschieden:
**ungespeicherte Änderungen halten den Wechsel an** und fragen — dieselbe Haltung wie beim Schließen
des Dialogs.

⚠️ **Der Kopf gehört der REGION, nicht der gewählten Beschriftung.** Name und Art oben ändern beim
Speichern alle Beschriftungen der Fläche — das ist der Sinn der Kopplung. Größe, Zoom, Priorität und
Position gehören der gewählten allein; ein zweites Label existiert gerade deshalb, weil es anders
stehen soll (`ecosystemRegionWriteBackPayload` sagt das wörtlich).

---

## 7. Die Kurvenbeschriftung — die Ausnahme

🔴 Sie **gehört der Region**, nicht der einzelnen Beschriftung. Im vereinigten Fenster steht sie
damit **genau einmal** — und die zwei Wahrheiten, vor denen das Markup heute warnt, können gar nicht
mehr entstehen.

Sie steht im Reiter **Beschriftung**, weil man dort ihre Wirkung sieht, mit einem Satz an Ort und
Stelle:

- Haken **aus**: „Die Beschriftung liegt frei auf der Karte und lässt sich unabhängig von der Fläche
  verschieben."
- Haken **an**: „**An die Fläche gebunden:** die Beschriftung läuft auf der Mittelachse der Fläche.
  Ihre eigene Position und Drehung wirken nicht mehr."

⚠️ **Ohne Fläche ist der Haken gesperrt** und sagt warum — es gibt keine Mittelachse. Diese Regel
existiert und bleibt (`syncLabelCurveControls`).

🔴 **„Anzahl Kurvenlabel" erscheint nur mit dem Haken** (seit 25.08.2026, live). Unverändert
übernehmen.

---

## 8. Die Quellen — die eine offene Datenfrage

🔴 **ERLEDIGT AM 26.08.2026 — und anders, als dieser Abschnitt es vorhatte.**

Hier stand, die Zusammenlegung sei eine Datenmigration über zwei `entity_type` und gehöre in
Stufe 2. **Vor dem Bauen gemessen — und die Annahme fiel:**

| | |
|---|---:|
| Flächen mit `ecosystem`-Quellen (Stichprobe, 30 gleichmäßig verteilt) | **0** |
| `ecosystem` in der Kartenpayload (6336 Objekte mit Quellen, 5 Typen) | **kommt nicht vor** |
| Beschriftungen mit `region`-Quellen | **637 Objekte / 8142 Zeilen** |

Der zweite Kasten war **leer**. Er kam am 28.07.2026 dazu und hat nie jemand gefüllt — und sein
Inhalt hätte auch kein Besucher gesehen: die Karte liest ausschließlich die Liste der
**Beschriftung** (`renderFeatureSourceLine`, `map-features-labels.js`).

🔴 **Die Regel lautet deshalb: die Quellen einer Landschaft liegen an ihrer BESCHRIFTUNG.** Es gab
nichts zu migrieren — nur einen zweiten Kasten wegzunehmen. Der `entity_type` `ecosystem` bleibt
serverseitig freigegeben (der Deploy löscht nie, und ein alter Client darf nicht auf einen 400
laufen); er hat nur keinen Erzeuger mehr.

⚠️ **Der Preis, offen benannt:** eine Fläche **ohne** Beschriftung kann keine Quellen mehr tragen
(334 von 1026). Sie konnte es nominell vorher — nur hat es niemand getan, und sichtbar geworden
wäre es nirgends. Der Landschaften-Editor sagt es dort jetzt hin und verweist auf „Beschriftung
anlegen".

🪤 **Die Lehre:** die teuerste Aufgabe dieses Vorhabens war in Wahrheit die kleinste — und das
stellte sich erst heraus, als jemand die Zeilen zählte statt die Struktur zu lesen. Zwei
`entity_type` sehen im Code nach einer Migration aus; einer davon war eine leere Hülle.

---
## 9. Was aus den zwei alten Fenstern wird

🔴 **Die IDs bleiben, die Fenster verschwinden aus der Bedienung.** `#label-edit-overlay` und
`#ecosystem-properties-overlay` werden nicht umbenannt und nicht aus `index.html` entfernt:

- Der Deploy löscht nie (AGENTS.md §10); eine gecachte `index.html` griffe sonst ins Leere.
- **`#label-edit-overlay` steht in drei Selektorlisten** (`bootstrap.js` Klick-Ausnahme,
  `review-core.js` zweimal „ist ein Fenster offen") und `#ecosystem-properties-overlay` in **drei**
  Listen in `dialog-overlays.css`. Ein neues Fenster muss in denselben Listen stehen — sonst ist es
  kein Fenster, sondern ein Block im Dokumentfluss, und ein Klick daneben schließt die Karte.

🔧 **Offen und bewusst nicht in dieser Stufe:** der Regionen-Block im Landschaften-Editor
(`html/landschaften-editor.html`) bleibt, wie er ist. Er ist ein eigenes iframe-Dokument mit eigenem
`window`; ihn mitzuziehen wäre ein zweiter Umbau im selben Zug.

---

## 10. Die Fallen (das ist zugleich die Abnahmeliste)

1. 💣 **Zwei Merklisten für die Wiki-Feldherkunft.** Kartendialog und Editorfenster führen je eine
   (`wikiUebernommen`); trägt eine nicht ein, stempelt der Server ihre Übernahmen als „von uns", und
   der nächste Abgleich lässt genau die Felder in Ruhe, die er selbst gefüllt hat. Das vereinigte
   Fenster erbt **eine** — und sie muss beide alten Pfade abdecken.
2. 💣 **Eine Art, die die Ebene nicht kennt, wird nicht geschickt.** `avesmapsEcosystemAssertRegionType`
   antwortet sonst mit 400 — nach einem erfolgreichen Label-Speichern. Der Wächter existiert; er
   muss im neuen Kopf-Feld „Art" weiterlaufen.
3. 💣 **Der Vertrag des Wiki-Bauteils:** `laden`/`zuweisen`/`loesen` dürfen im Fehlerfall NIEMALS
   auflösen, sondern müssen ablehnen — sonst hält das Bauteil den leeren Zustand für „nichts
   zugewiesen", und das nächste Speichern löscht die echte Zuweisung.
4. 💣 **Die Löschung ist zweierlei.** „Löschen" im Flächendialog nimmt die Region samt Flächen; im
   Beschriftungsdialog nur die Beschriftung. Im vereinigten Fenster braucht der Knopf einen
   **Bezug** — er löscht, was der offene Reiter zeigt, und sagt das. ⚠️ Das letzte Label einer Region
   nimmt Region UND Flächen mit (`refuse_ecosystem_cascade`); die Rückfrage muss das nennen.
5. 💣 **Ein `berggipfel`/`vulkan`-Label IST ein Stützpunkt des Höhenfelds** (`terrain-store.php`).
   Seine Löschung ist keine reine Beschriftungssache — die zweite Rückfrage bleibt.
6. 💣 **`height_schritt` ist FÜNFstellig** und braucht `--wide`; 56 px schnitten „5000" zu „500".
7. ⚠️ **Die Vorgabemarken** unter den Reglern kommen aus der Darstellungs-Tafel und bleiben.
8. ⚠️ **Der versteckte `rotation`-Input muss mitwandern** — ohne ihn schreibt jedes Speichern eine 0
   über den gespeicherten Winkel.
9. 💣 **Die Klasse `.location-report-form__field` bleibt an jedem Feld** — die Zeilenform ist ein
   Modifier. Sie zu ersetzen lässt jedes `<input>` auf den Browserstandard zurückfallen.
10. ⚠️ **`#label-edit-dialog` trägt eigene, engere Feldregeln** (`padding: 6px 8px`,
    `border-radius: 6px`, `region-sync.css`). Das neue Fenster braucht dieselben — sonst springt der
    Dialog optisch auf die geteilten 9px/10px um.

---

## 11. Stufen

| Stufe | Inhalt | Ergebnis |
|---|---|---|
| **1** | Das Fenster: Kopf, drei Reiter, Einstiege, leere Zustände, Mehrfach-Beschriftungen, Kurven-Bindung. Beide Quellenlisten nebeneinander. | Ein Fenster statt zwei |
| **2** ✅ | Die Quellen zusammenführen — **gemessen: nichts zu migrieren**, der zweite Kasten war leer | Eine Quellenliste |
| **3** ✅ | Der Regionen-Block im Landschaften-Editor zieht nach | Eine Quelle überall |

**Alle drei Stufen sind am 26.08.2026 live.**

---

## 12. Tests

- `js/map-features/__tests__/landschaft-dialog-einstieg.test.js` — der Einstieg bestimmt den Reiter,
  in allen sechs Aufrufern; und ein fehlender Halbteil sperrt den Reiter NICHT.
- `js/map-features/__tests__/landschaft-dialog-lagen.test.js` — die vier Datenlagen erzeugen genau
  einen leeren Zustand mit genau einem Satz.
- `js/map-features/__tests__/landschaft-dialog-loeschen.test.js` — der Löschknopf bezieht sich auf
  den offenen Reiter und nennt die Kaskade.
- Erweiterung von `wiki-assign-landschaft.test.js` und `label-vorgabemarke.test.js` auf die neuen
  Behälter-IDs.
- ⚠️ **Und der Ablauf, nicht das Maß** (AGENTS.md §9): das Fenster wird mit angemeldeter Sitzung
  aufgemacht, ein Name geändert, gespeichert, beide Zeilen in der Datenbank nachgesehen. Kein
  Emulator beantwortet, ob die Propagation wirklich beide Richtungen schreibt.
