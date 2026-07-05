# Design: Anker-basiertes „Richtung vervollständigen" (set_dir auf teilgerichteten Flüssen)

> Erweiterung der Flussrichtung (docs/superpowers/specs/2026-07-05-flussrichtung-design.md §6).
> Auftrag 2026-07-06 (Follow-up-Chip task_856af82d): Designrichtung war im Auftrag vorgegeben
> (Anker-Orientierung, Anker nie invertieren, Abzweige dirlos, source=editor); UI-Wording
> steht unter Owner-Vorbehalt. Deutsch wie die Mutter-Spec; Code/Kommentare/Commits Englisch.

## 1. Problem

`set_flow {set_dir:true}` wirft bei Wegen mit ≥1 gerichtetem Segment bewusst
„Way already has a direction (use flip)." (Stale-Panel-Guard). Bei teilweise
wiki-abgeleiteten Flüssen — Großer Fluss: nur 7/38 Segmente ableitbar, Rest-Etappen
unroutbar (Nicht-Ort-Stationen im Verlauf) — gibt es dadurch KEINEN Weg, die
verbleibenden richtungslosen Kettenteile manuell zu richten: `flip` invertiert nur
Vorhandenes, `set_dir` ist blockiert.

## 2. Semantik (beschlossen)

`set_dir` wird **anker-bewusst** statt strikt. Kein neuer Action-Parameter — der alte
Guard schützte davor, bestehende Richtungen willkürlich neu zu würfeln; genau das kann
die Anker-Variante konstruktiv nicht mehr (Anker werden NIE angefasst), also darf der
Guard weg.

Ablauf bei `set_flow {set_dir:true}`:

1. **Anker sammeln:** alle Weg-Segmente, deren normalisiertes `flow` ein gültiges `dir`
   trägt (`avesmapsPathFlowNormalize` ≠ null), unabhängig von `source`.
2. **Hauptkette:** unverändert die geometrische Diameter-Kette
   (`avesmapsPathFlowChainOrientation`, längster Losende-zu-Losende-Pfad).
3. **Ausrichtung an den Ankern AUF der Kette:**
   - kein Anker vorhanden (Weg komplett ungerichtet) ⇒ heutiges Verhalten, Ende beliebig;
   - alle Ketten-Anker stimmen mit dem Walk überein ⇒ Walk übernehmen;
   - alle widersprechen ⇒ kompletten Walk invertieren;
   - gemischt ⇒ Fehler `anchors_conflict` (Datenanomalie, nichts schreiben);
   - Anker existieren, aber KEINER liegt auf der Kette ⇒ Fehler `no_anchor_on_chain`
     (Konsistenz zum Anker wäre nicht herstellbar; willkürlich richten könnte an einer
     Verzweigung physikalisch widersprüchlichen Fluss erzeugen).
4. **Schreiben:** `dir` NUR auf bisher ungerichtete Ketten-Segmente, `source: "editor"`.
   Anker bleiben byte-unverändert (auch `source` nicht). Abzweige abseits der Kette
   bleiben dirlos (bestehende Owner-Regel; ob ein Arm Zu- oder Abfluss ist — z. B.
   GF-Drift — ist geometrisch nicht entscheidbar).
5. Kette bereits vollständig gerichtet ⇒ Fehler „Main chain is already fully directed
   (use flip)." (Button war überflüssig; klares Feedback statt No-op).

Off-Chain-Anker (auf Abzweigen) liefern KEINE Ausrichtungsinformation (Armrichtung
relativ zur Kette unbestimmbar) und werden nur als „nie überschreiben" respektiert.

## 3. Pure Funktion (Engine)

`api/_internal/wiki/path-flow.php`:

```php
avesmapsPathFlowPlanSetDir(array $coordinatesByPublicId, array $anchorDirByPublicId): array
// => ['ok' => bool,
//     'reason' => null|'no_chain'|'anchors_conflict'|'no_anchor_on_chain',
//     'dir_by_public_id' => [pid => 'forward'|'reverse']  // NUR neue Segmente, Anker nie
//    ]
```

`avesmapsWikiPathSetFlow` ersetzt den `directedBefore > 0`-Throw durch diesen Plan;
die Merge-Schleife (dir + source=editor auf `$working`/`$writes`) bleibt wie gehabt.
Fehlermeldungen englisch im Guard-Stil (§8 Sprachpolitik):

- `anchors_conflict` → „Directed segments on the main chain disagree — re-derive or flip first."
- `no_anchor_on_chain` → „No directed segment lies on the main chain; cannot orient the rest consistently."
- leerer Plan → „Main chain is already fully directed (use flip)."

Endpoint `api/edit/wiki/paths.php` bleibt unverändert (Parameter identisch).

## 4. UI (js/review/review-path-flow.js + index.html-Panel)

Drei Weg-Zustände statt zwei (weg-weiter Blick wie bisher über `pathFlowWaySegments`):

| Zustand | Button 1 (`path-flow-direction`) | Button 2 (`path-flow-complete`, NEU) |
|---|---|---|
| 0 gerichtet | „Richtung festlegen" (set_dir) | versteckt |
| teilgerichtet | „Richtung umdrehen (ganzer Fluss)" (flip) | „Richtung vervollständigen" (set_dir) |
| voll gerichtet* | „Richtung umdrehen (ganzer Fluss)" (flip) | versteckt |

\* Client-Heuristik: Button 2 zeigt sich bei ≥1 gerichtetem UND ≥1 ungerichtetem
Weg-Segment. Abzweige bleiben immer ungerichtet ⇒ bei komplett gerichteter Kette mit
dirlosem Abzweig bleibt der Button sichtbar und der Server antwortet mit dem klaren
„already fully directed"-Fehler — akzeptiert, autoritativ ist der Server.

Erfolgsmeldung Vervollständigen: „Richtung vervollständigt (N Segmente ergänzt, M waren
schon gerichtet — Abzweige bleiben ohne Richtung)." (nutzt `directed` + `directed_before`
aus der Response).

**🔧 Owner-Vorbehalt (Wording):** Button-Label „Richtung vervollständigen" (Alternativen:
„Restliche Segmente richten", „Richtung ergänzen") und die Erfolgsmeldung.

## 5. Wechselwirkung mit der Ableitung (dokumentiert, unverändert)

Die Ableitung besitzt weiterhin den dir-Zustand des Wegs: Ein späterer
`derive_flow`/`apply_verlauf_case`-Lauf ENTFERNT manuell ergänzte Richtungen auf
unbestimmbaren Segmenten wieder (bewusste Flip+Sync-Sicherung der Mutter-Spec). Danach
ist der Weg wieder teilgerichtet und EIN erneuter „Vervollständigen"-Klick stellt den
Zustand konsistent wieder her. Für den Großen Fluss (source=editor, Sync nur manuell)
bleibt die Vervollständigung praktisch stehen.

## 6. Nicht-Ziele

- KEIN Richten von Abzweigen (GF-Drift bleibt dirlos; eigenes Feature, falls je gewünscht).
- KEINE Änderung an flip, factor, Ableitung, Routing, Pfeil-Overlay.
- KEINE per-Komponenten-Orientierung bei zerfallenen Wegen (Diameter-Kette wie bisher).

## 7. Tests

`tools/paths/test-path-flow-engine.php` (pure, CLI, Muster beibehalten):

1. Ohne Anker ⇒ identisch zu `avesmapsPathFlowChainOrientation` (ok, konsistent, Ende egal).
2. Anker stimmt mit Basis-Walk überein ⇒ neue dirs = Basis minus Anker, Anker fehlt im Plan.
3. Anker widerspricht ⇒ alle neuen dirs invertiert, konsistent, Anker fehlt im Plan.
4. Gemischte Anker ⇒ ok=false, `anchors_conflict`, leerer Plan.
5. Anker nur auf Abzweig ⇒ ok=false, `no_anchor_on_chain`.
6. Kette voll geankert ⇒ ok=true, leerer Plan (set_flow macht daraus den „use flip"-Fehler).
7. Zyklus + Anker ⇒ ok=false, `no_chain`.
8. GF-Form: lange Kette, Anker mittig, Abzweig an Junction ⇒ alle Ketten-Reste gerichtet
   konsistent zum Anker, Abzweig dirlos.

## 8. Verifikation / DoD

1. CLI-Suite grün (alle bestehenden 30 Checks + neue).
2. `node --check js/review/review-path-flow.js`.
3. 🔧 Owner: GF im Editmode anklicken ⇒ „Richtung vervollständigen" sichtbar; dry-run-los
   anwenden ⇒ ~31 Rest-Segmente gerichtet, Pfeile durchgehend Richtung Havena, die 7
   Wiki-Anker unverändert (source bleibt verlauf-sync); Undo-Probe auf einem Segment.
4. 🔧 Owner: Wording-Freigabe Button/Meldung (§4).
