# Phase 7a: Derived-Boundary-Plan-Endpunkt

Stand: 2026-05-29

Dieser Log ergänzt `docs/political-territory-global-display-and-derived-boundaries-progress.md` fuer den ersten technischen Schritt der hierarchischen Außengrenzen-Planung.

## Ziel

Der Endpunkt `derived_geometry_plan` ist ein read-only Plan-Endpunkt. Er verändert keine Geometrien, keine Territorien, keine Hierarchien und keine Derived Boundaries.

Er dient dazu, vor der eigentlichen Editor-Client-Berechnung zu prüfen:

- welches Territory der aktive Breadcrumb adressiert,
- welche Unterknoten und Ancestors betroffen sind,
- welche echten Geometrien fuer das gewaehlte Jahr als Quellen verfuegbar sind,
- welche Kinder bereits oder planbar als Boundary-Quelle dienen koennen,
- welche vorhandenen Derived Boundaries aktiv sind,
- welche Warnungen oder Blocker bestehen.

## Commit-Log

### 2026-05-29 — `c1cf2f0f1dc24701860e7c65edd37087f2232411`

**Ziel:** Read-only Plan-Logik fuer hierarchische Außengrenzen anlegen.

**Geaenderte Dateien:**

- `api/_internal/political/territories-derived-geometry-plan.php`

**Was wurde geaendert:**

- Neue Funktion `avesmapsPoliticalReadDerivedGeometryPlan()` angelegt.
- Ziel-Territory wird ueber den bestehenden Derived-Geometry-Resolver bestimmt.
- Subtree, Ancestors und Recompute-Ziele werden geplant.
- Quellen werden nach aktivem Territory und optionalem Jahr `selected_year_bf` / `year_bf` gefiltert.
- Aktive Derived Boundaries werden fuer Plan-Knoten gebuendelt gelesen.
- Erste Warnungen werden ausgegeben: `target_territory_missing`, `no_boundary_sources`, `hierarchy_cycle`.
- Fuer jeden planbaren Knoten wird ein `source_revision_hint` erzeugt.

**Nicht geaendert:**

- Keine API-Route wurde in diesem Commit freigeschaltet.
- Keine Datenbankstruktur.
- Keine Schreiboperationen.
- Keine Union-Berechnung.
- Keine echten Geometrien.
- Keine Territorien oder Hierarchien.

**Offene Risiken:**

- Noch kein Browser-/API-Livetest.
- Der Plan ist absichtlich eine Metadatenplanung; er liefert noch keine fertige Editor-Client-Batch-Berechnung.
- Historische Intervalle werden noch nicht materialisiert, sondern nur ueber ein optionales Jahr gefiltert.

### 2026-05-29 — `aaa5f2537bdfbc7a0f8a78d243adfb0435b5ba9a`

**Ziel:** Read-only Plan-Endpunkt im bestehenden Political-Territories-Endpoint freischalten.

**Geaenderte Dateien:**

- `api/_internal/political/territories-endpoint.php`

**Was wurde geaendert:**

- `territories-derived-geometry-plan.php` wird eingebunden.
- GET-Actions `derived_geometry_plan` und `get_derived_geometry_plan` rufen `avesmapsPoliticalReadDerivedGeometryPlan()` auf.

**Nicht geaendert:**

- Keine POST-/PATCH-/DELETE-Aktion.
- Keine Datenbankstruktur.
- Keine Schreiboperationen.
- Keine Union-Berechnung.
- Keine echten Geometrien.
- Keine Territorien oder Hierarchien.

**Offene Risiken:**

- Noch kein Browser-/API-Livetest.
- Der Endpunkt verwendet vorhandene Tabellenfelder `valid_from_bf` und `valid_to_bf`; falls eine Produktionsdatenbank diese Spalten noch nicht hat, muss die bestehende Schema-/Migration-Lage separat geprüft werden.

## Testidee

Beispiel fuer einen manuellen Read-only-Test im Browser oder per PowerShell:

```powershell
Invoke-RestMethod "https://avesmaps.de/api/app/political-territories.php?debug_errors=1&action=derived_geometry_plan&territory_public_id=<TERRITORY_PUBLIC_ID>"
```

Optional mit Jahr:

```powershell
Invoke-RestMethod "https://avesmaps.de/api/app/political-territories.php?debug_errors=1&action=derived_geometry_plan&territory_public_id=<TERRITORY_PUBLIC_ID>&selected_year_bf=1049"
```

Optional mit rekursiver Planung:

```powershell
Invoke-RestMethod "https://avesmaps.de/api/app/political-territories.php?debug_errors=1&action=derived_geometry_plan&territory_public_id=<TERRITORY_PUBLIC_ID>&apply_to_subregions=1"
```

Erwartung: Die Antwort enthaelt `ok: true`, `plan_nodes`, `recompute_targets`, `ancestors_to_refresh`, `warnings` und `blocking_warnings`. Es werden keine Daten veraendert.
