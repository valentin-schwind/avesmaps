# Ausreißer-Prüfung gegen den Wiki-Verlauf validieren (Design)

**Datum:** 2026-07-23 · **Auftraggeber:** Owner · **Anlass:**
[Reichsstraße 2](https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2) wird als
„Ausreißer" gemeldet, obwohl der Weg im Wiki legitim aus getrennten Stücken
besteht. Bezug: [[bug39-strassen-fehlzuweisung-altlast]], `docs/konfliktmanagement-design.md`.

## 1. Ausgangslage

Der „Ausreißer"-Reiter (`api/_internal/wiki/path-outliers.php`, Reiter in
`js/review/review-path-sync.js`, `GET ?action=outliers`) arbeitet **rein
geometrisch**: die Segmente eines Wiki-Weges werden an ihren Endpunkten
verschweißt (Toleranz `0.05`), der größte zusammenhängende Klumpen gilt als „die
Straße", jeder abgetrennte Klumpen ist ein Ausreißer — sortiert nach **Abstand**
zum Korridor. Das Wiki schaut die Prüfung nie an.

Das ist Absicht (der Detektor sollte ohne Wiki-Kette auskommen und deckt die
~354 fall-losen Wege ab), erzeugt aber **falsch-positive**: ein Weg, der im Wiki
sauber beschrieben ist, aber auf der Karte mit einer kleinen Lücke gezeichnet
wurde, zerfällt in zwei Klumpen und wird gemeldet — obwohl beide Klumpen echte
Teile desselben Weges sind. Genau das meint der Owner mit „Straßen dürfen durchaus
Ausreißer haben".

## 2. Der Befund (gemessen an der Live-`map-features`-Payload, 2026-07-23)

Der geparste Verlauf reist **schon im Payload** mit: jedes Segment trägt
`properties.wiki_path.verlauf` als Stationskette (`Trallop → Eichenau → …`). Der
Parser listet dort **nur die Stationen AUF der Strecke**, nicht die Abzweigziele
(`{{Abzweigung rechts|[[Braunsfurt]]|[[Tobrische Straße]]}}` → nur Braunsfurt
steht im Verlauf, nicht Tobrische Straße). Das ist die entscheidende Eigenschaft:
die bekannten Fehlläufer (Abzweigziele wie Artésa, Fremdwege) stehen **gar nicht
erst** im Verlauf.

Ordnet man jede Verlauf-Station ihrer nächsten Kartenkoordinate zu und misst den
Abstand zu jedem Klumpen, trennt eine **enge Toleranz (~2 Karteneinheiten)** die
Fälle sauber — in **beide** Richtungen:

| Weg | Klumpen | Abstand z. Haupt | Verlauf-Stationen ≤2 u | Urteil |
|---|---|---|---|---|
| **Eisenstraße** | 17 Segm. (Haupt) | — | 13 | die Straße |
| | 2 Segm. | 0,0 | 3 (Retingen, Valquirbrück, Punin) | **legitim → fällt raus** |
| | 1 Segm. „Eisenstraße" | **344,2** | **0** | **echter Streuner → bleibt gemeldet** |
| **Reichsstraße 2** | 30 Segm. (Haupt) | — | 19 | die Straße |
| | 23 Segm. | 2,5 | 13 | **legitim → fällt raus** |

Die RS2 (53 Segmente, zwei Klumpen, 2,5 u Lücke zwischen Wehrheim und Perz) hat
danach **keinen** Streuner mehr und verschwindet aus der Liste. Der Strand-Streuner
der Eisenstraße (344 u daneben, `public_id`-Name „Eisenstraße", der Bug #39-Fall)
besitzt **keine** Verlauf-Station und bleibt gemeldet.

**Robust gegen die bekannte Schwäche.** 32 der 33 RS2-Stationen liegen bei ≈0 auf
der Linie. Die eine Ausnahme — `[[Grünau (Almada)|Grünau]]` — löst falsch auf
(der Verlauf-String behält nur „Grünau", verliert den Klammer-Zusatz; siehe
[[settlement-duplicate-wiki-url]]) und landet 121 u daneben. Das ist **egal**: der
Klumpen besitzt 13 andere Stationen bei ≈0, und die eine Fehlauflösung liegt zu
weit weg, um zu zählen. Das Kriterium braucht nur **eine** Station auf der Linie,
nie alle.

## 3. Der Vertrag — beides kombiniert

Die Prüfung klassifiziert künftig **jeden abgetrennten Klumpen** eines Weges,
statt ihn pauschal zu melden:

**Teil A — automatische Verlauf-Validierung (deckt RS2 & Co.):**
Ein abgetrennter Klumpen gilt als *legitimer Abschnitt* (kein Ausreißer), wenn ≥1
Verlauf-Station des Weges innerhalb von `OUTLIER_ONCOURSE_TOL` (Start **2,0**
Karteneinheiten) auf seiner **gezeichneten Geometrie** liegt. Besitzt er **keine**
Verlauf-Station, bleibt er ein *Streuner-Kandidat*.

**Teil B — manuelles „gelöst" (Auffangnetz):**
Für die Fälle, die Teil A nicht klären kann — Wege ohne (auflösbaren) Verlauf, die
~462-„fehlende-Orte"-Klasse, oder eine echte Sonderlage, die das Wiki nicht als
Station führt — kann der Editor einen Streuner-Kandidaten als **„gehört zum Weg"**
bestätigen. Die Entscheidung ist **dauerhaft** und öffnet sich von selbst wieder,
wenn sich die Geometrie des Klumpens ändert.

**Meldelogik:** ein Weg erscheint im Reiter genau dann, wenn er ≥1 abgetrennten
Klumpen hat, der **weder** on-course (A) **noch** bestätigt (B) ist. Die
Kopfzeile („N Wege mit Ausreißern") zählt nur noch diese.

**Keine Vollautomatik ohne Tür.** A entfernt nur Falschmeldungen für Klumpen, die
nachweislich auf der beschriebenen Strecke liegen; ein Streuner besitzt keine
Station und bleibt sichtbar. Der Mensch behält mit B die Entscheidung über alles,
was A nicht beweisen kann — das Muster des Konfliktzentrums („computed, never
stored; nur die Entscheidung ist durabel").

## 4. Datenmodell — die bestehende Entscheidungs-Tabelle wiederverwenden

Teil A ist zustandslos (jeder Lauf rechnet frisch). Teil B braucht einen durablen
Speicher — und den gibt es schon: `conflict_decision`
(`api/_internal/conflicts/store.php`) ist der generische `(rule_id, fingerprint)`-
Entscheidungsspeicher des Projekts, exakt für „berechneter Konflikt + durable
Entscheidung, Fingerabdruck über die Fakten, damit sich ein Fall bei Änderung von
selbst wieder öffnet". **Kein zweites System bauen** (AGENTS.md-Ethos, vgl.
[[sources-live-in-one-place]]).

* `rule_id` = **`path_outlier`**.
* `decision` = **`approved`** — steht bereits in `AVESMAPS_CONFLICT_DECISIONS`
  (`core.php`) und bedeutet dort „die Meldung stimmt UND die Lage ist legitim"
  (Kommentar an `AVESMAPS_CONFLICT_STATUS_APPROVED`). Kein neuer Entscheidungswert
  nötig.
* `fingerprint` = `sha256(wiki_key . '|' . implode(',', sort(segment public_ids des Klumpens)))`.
  Ändert sich der Segmentbestand des Klumpens (Segment umgehängt, geteilt,
  verschoben), passt der Fingerabdruck nicht mehr → der Fall öffnet sich wieder.
* `subject_type='path'`, `subject_id=wiki_key`; `title` = Wegname für die Historie.

Lesen/Anwenden/Schreiben/Löschen laufen über die vorhandenen
`avesmapsConflictReadDecisions` / `…RecordDecision` / `…ClearDecision`.

## 5. Umsetzung (Skizze, Detail im Plan)

* **`path-outliers.php`:** `avesmapsWikiPathOutlierAnalyseWay` bekommt die
  aufgelösten Verlauf-Stationskoordinaten des Weges übergeben und markiert jeden
  abgetrennten Klumpen mit `on_course: bool` + `on_course_stations: []`.
  `avesmapsWikiPathOutlierList`
  * baut **einmal** einen Namensindex `name → [coords]` über
    `feature_type IN ('location','crossing')` (eine Abfrage, ~3400 Zeilen; kein
    Route-Graph, ein Durchlauf — die bestehende STRATO-schonende Zusage bleibt),
  * splittet je Weg `wiki_path.verlauf` an ` → `, löst gegen den Index auf,
  * lädt die `path_outlier`-Entscheidungen und blendet on-course- **und**
    `approved`-Klumpen aus der Meldung aus.
* **Endpoint `api/edit/wiki/paths.php`:** neue Aktion, um eine
  `path_outlier`-Entscheidung zu setzen/aufzuheben (Capability `edit`, wie die
  übrigen Schreibpfade); ruft die vorhandenen Store-Funktionen.
* **`review-path-sync.js`:** je gemeldetem Weg zeigt der abgetrennte Klumpen
  Abstand + Segmentzahl + „liegt bei keiner Verlauf-Station" als Beleg; ein
  Knopf **„gehört zum Weg (gelöst)"** schreibt die Entscheidung, der Klumpen (und
  der Weg, falls es sein einziges Problem war) fällt raus. On-course-Klumpen
  werden gar nicht erst als Problem gezeigt.
  **🔒 Owner-Vorgabe: keine neuen Reiter im „Wege"-Panel.** Alles bleibt im
  bestehenden „Ausreißer"-Reiter — der „gelöst"-Knopf sitzt in der Wegzeile, kein
  eigener „Gelöst"-Reiter. Bestätigte Fälle fallen aus der Liste; das Rückgängig
  passiert **inline** (Fußzeile „N als ‚gehört zum Weg' bestätigt · anzeigen",
  klappt die Fälle mit einem Reopen-Knopf auf), nicht über einen Reiter.

## 6. Sicherheit & Tests

Der Restrisiko-Pfad ist ein *echter* Fehlläufer, der zufällig ≤2 u an einer
Verlauf-Station **dieses** Weges liegt. Dann liegt er aber an einem gelisteten Ort
der Strecke — also an einer Zufahrt, die der Owner ausdrücklich zum Weg zählt
(„Verlauf-gelistete Orte gehören samt Zufahrt zum Weg",
[[strassen-wiki-namenssystem]]). Das Exonerieren ist dort also konsistent, nicht
falsch.

* **Unit-Tests** in `tools/paths/test-path-outliers.php`: RS2-Klumpen fällt raus,
  Eisenstraße-Strandsegment bleibt, Eisenstraße-Punin-Stück fällt raus, `approved`
  blendet aus, geänderter Segmentbestand öffnet wieder.
* **Beobachten statt vorab festzurren (Owner 2026-07-23):** mit `TOL = 2,0`
  ausliefern; beim Ausliefern eine **Vorher/Nachher-Liste** der gemeldeten Wege
  erzeugen (welche fallen durch die Validierung raus) und einmal drüberschauen,
  dass nichts Verdächtiges dabei ist. Kein harter Vorab-Prüf-Gate. Fällt später
  ein **echter** Streuner zu Unrecht raus, ist der Hebel bekannt: **≥2** Stationen
  verlangen oder Kontiguität in der Verlauf-Reihenfolge fordern (in RS2 &
  Eisenstraße nicht nötig — sie trennen schon bei „≥1").

## 7. Nicht in diesem Umbau (YAGNI)

* Den „Ausreißer"-Reiter ganz in die Konfliktzentrum-Oberfläche einschmelzen
  (größer; hier wird nur der Speicher geteilt, die Oberfläche bleibt der Reiter).
* Die gezeichneten Lücken selbst schließen (Kartendaten) — die Prämisse ist ja,
  dass die Lücken erlaubt sind.
* Die Verlauf-Namensauflösung verbessern (Klammer-Zusätze wie „(Almada)") — das
  Design ist ohne das robust; eine Fehlauflösung wird ignoriert, nicht falsch
  gewertet.
* **Keine neuen Reiter im „Wege"-Panel** (Owner-Vorgabe) — auch keine
  „Lücken"-Ansicht und kein „Gelöst"-Reiter. Siehe §5.

## 8. Owner-Entscheidungen (2026-07-23)

* **Toleranz:** `OUTLIER_ONCOURSE_TOL = 2,0` fest als Startwert — ausliefern und
  beobachten (§6), nicht vorab durchtunen. Nachträglich änderbar, falls nötig.
* **Keine „Lücken"-Ansicht.** On-course-Wege verschwinden restlos aus der Liste
  (die Kopfzahl soll sinken); eine Lücken-Sicht erst, wenn der Owner sie vermisst.
