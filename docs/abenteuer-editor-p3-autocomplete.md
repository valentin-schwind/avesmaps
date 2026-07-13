# Abenteuer-Editor — P3 Ort-Autocomplete (Spec)

> Status: **freigegeben** (Owner-Mockup-Session 2026-07-13). Prosa DE, Bezeichner EN.
> Baut auf `docs/abenteuer-editor-ui-spec.md` (P2, LIVE) auf. Referenz-Mockup:
> `html/adventure-editor-p3-mockup.html` (wird beim Bau überflüssig, dann gelöscht).

## 1. Ziel & Ansatz

Beim Ort-Hinzufügen tippt der Editor einen Namen; ein Autocomplete zeigt **echte, typisierte,
eindeutige** Vorschläge aus `GET /api/app/map-search.php`. **Ansatz B (Namens-Picker + Resolver):** eine
Auswahl füttert nur den **Namen** in den **bestehenden** `add_place` → `resolve_place`-Flow (P1). Der
Resolver bestimmt `target_kind` + `public_id` + `wiki_key` + `territory_path` konsistent — genau wie beim
manuellen Tippen heute. **Kein Backend-Umbau, keine neue Speicher-Logik.** map-search liefert `public_id`,
aber **kein** `wiki_key`; deshalb wird die `public_id` NICHT direkt gespeichert (sonst fehlte Territorien/
Regionen das für Phase-2-Aggregation nötige `wiki_key`) — der Resolver macht das vollständig.

## 2. UX (Owner-freigegeben)

- **Add-Zeile wird schlanker:** `[Autocomplete-Eingabe] [+ Ort]`. Das separate **„Typ: automatisch"-Dropdown
  entfällt** (der Typ ergibt sich aus Auswahl/Auflösung).
- **Dropdown** unter der Eingabe (Token-basiert, `--shadow-panel`, `--radius-lg`): je Zeile Name +
  **Typ-Badge** (map-search `type_label`: Metropole/Ort/Herrschaftsgebiet/Region/Weg …); getippter Teilstring
  **gold hervorgehoben** (`--color-accent-strong`). Letzte Zeile = **Freitext-Fallback** „»<Eingabe>« als
  freien Ort hinzufügen (unaufgelöst)".
- **Tastatur:** ↑/↓ markiert, **Enter** übernimmt den markierten Vorschlag (bzw. Freitext, wenn keiner
  markiert), **Esc** schließt; Klick geht ebenso.
- **Auswahl = Hinzufügen:** ein Vorschlag setzt den Namen und löst **sofort** den bestehenden Add-Flow aus
  (`add_place(raw_name)` → `resolve_place`), Eingabe wird geleert. Freitext (kein Treffer) = genau der
  heutige Flow.
- **Ausschluss:** `kind==='powerline'` (Kraftlinien) sind keine Ort-Ziele → aus den Vorschlägen filtern.

## 3. Typ-Anzeige (nur Darstellung, nicht Speicherung)

Der Badge nutzt direkt map-search `type_label`. Zur Orientierung, wie map-search auf `target_kind` abbildet
(macht der **Resolver** serverseitig, nicht der Client):

| map-search `kind` / `feature_subtype` | Abenteuer-`target_kind` |
|---|---|
| `location` (metropole/dorf/…) | settlement |
| `region` + `political_territory` | territory |
| `label` + `region` | region (Landschaft) |
| `path` (Pfad/Straße/…) | path |
| `powerline` | — (ausgeschlossen) |

## 4. Abruf-Verhalten (STRATO-schonend)

- Erst ab **≥ 2 Zeichen**; **Debounce ~250 ms**; in-flight-Request per `AbortController` abbrechen, wenn
  weitergetippt wird (nie parallel hämmern). Top **~8** Ergebnisse (`&limit=8`).
- `GET /api/app/map-search.php?q=…` ist **öffentlich** (kein Auth nötig), Envelope `{ok:true,results:[…]}`.

## 5. Grenzen / Edge Cases

- **Namensgleichheit über Typen:** löst der Resolver per Präzedenz (settlement→territory→region→path). Wählt
  man z. B. ein Territorium, dessen Name auch eine Siedlung ist, gewinnt die Siedlung — seltener Grenzfall,
  bewusst akzeptiert (Design §5-Präzedenz). Distinkte Namen (Regelfall) lösen exakt.
- Freitext-Add bleibt vollständig erhalten (unaufgelöste Orte, Rohname erhalten).

## 6. Datei-Landkarte

| Datei | Aktion |
|---|---|
| `html/adventure-editor.html` | **ändern** — Autocomplete in der Orte-Add-Zeile (Dropdown-Markup/CSS, map-search-Fetch mit Debounce/Abort, Tastatur, Freitext-Fallback); `#aeAddKind`-Dropdown entfernen; Add-Handler entkoppeln vom Typ. |
| `html/adventure-editor-p3-mockup.html` | **löschen** am Ende. |

Backend unverändert (P1 `add_place`/`resolve_place` + öffentliches `map-search.php`).

## 7. Invarianten

- Nur Tokens, kein Blau. `?v=Date.now()` (kein `ASSET_VERSION`). STRATO: map-search debounced + abort, nie
  loopen. Verifikation: localhost-Repro / CDP in echter Session (statischer Editor auch headless render-bar).
