# Refactoring-Arbeitspakete

**Was das ist:** das Rückgrat der Routine `avesmaps-refactoring` (Entwurf
`docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md`). Jedes Paket ist eine
**Momentaufnahme** gegen `Stand`/`Blob`; die Routine prüft es bei jedem Lauf gegen `origin/master`
nach (`tools/refactoring/frischelauf.mjs`) und zieht nach oder verwirft. Zeilennummern sind
Orientierung, die Identität eines Blocks sind seine Funktionsnamen.

**Zustände:** `offen` · `GO nötig` · `in Arbeit (<datum>)` · `erledigt (<sha>)` · `verworfen (<grund>)`.
Nur der Owner setzt `GO nötig` → `offen` (eine Zeile im Dokument, gepusht). Nur die Routine setzt die
übrigen drei; jede Änderung bekommt eine Zeile unter `Verlauf`.

**Sperre:** steht unter dieser Zeile eine Zeile `Sperre: <datum> <grund>`, analysiert die Routine nur
und pusht nichts.

<!-- Sperre: (zum Sperren die naechste Zeile OHNE Kommentar setzen: `Sperre: 2026-09-05 Grund`) -->

**Verfahren:** A JS-Schnitt (Lauf globaler Funktionen → Geschwisterdatei) · B Inline-Script einer
Editorseite → `js/pages/` · C PHP-Lib per `require_once` an der Blockstelle · D Perf-Umbau mit
Messbeleg (gleiche Ausgabe, weniger Arbeit; die ersten drei mit GO).

**Form eines Pakets** (der Wächter `tools/refactoring/__tests__/arbeitspakete.test.js` hält sie fest):

```
### P-NNN · <pfad der zieldatei> · Verfahren A|B|C|D
- Status: offen
- Stand: <sha auf origin/master> · Blob: <git rev-parse origin/master:<pfad>>
- Block: „<Thema>“ — <erste Funktion> … <letzte Funktion> (<n> Funktionen, ~<zeilen> Zeilen ab Z. <von>)
- Ziel: <pfad der geschwisterdatei>[, Nachsatz]
- Messskript: tools/perf/<paket>.mjs|php          (nur D)
- Vorprüfung (<datum>): Ladezeit-Bezug n · Register n · Quelltext-Tests n · vm-Bindung n · Konstanten n
- Fallen: <was die Vorprüfung NICHT sieht und ein Mensch wissen muss>
- Verlauf: <datum> angelegt (<quelle>)[ · <datum> <ereignis>]
```

---

## Pakete

(werden von der Analyse vom 05.09.2026 und danach vom Überwachungsmodus der Routine gefüllt)
