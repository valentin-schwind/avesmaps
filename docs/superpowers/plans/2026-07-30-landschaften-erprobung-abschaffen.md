# Instruction A — Die Erprobung abschaffen

**Auftrag Owner 2026-07-30:** *„Es gibt keine ‚Erprobungen' oder ‚Stempel' mehr und keine
landschaften=1. Schalte landschaften=1 aber nur für Admins automatisch frei (Totmannschalter ist
abgeschafft)."*

> 🔴 **Diese Instruction wurde nach einer feindlichen Prüfung berichtigt.** Die erste Fassung stand
> auf drei falschen Annahmen; sie sind unten als ~~durchgestrichen~~ benannt, damit niemand sie aus
> einer älteren Kopie wiederholt.

---

## 0. 💣 Was diese Instruction NICHT bewirkt

~~„Ohne sie sieht der A\* keine Gebirge, weil alle 19 als Versuch markiert sind."~~ **Falsch.**

Repo-weit filtert **genau eine** Abfrage `is_trial`: `api/_internal/routing/water-areas.php:78`.
Und die ist auf `AVESMAPS_ROUTE_WATER_REGION_TYPES = ['meer', 'see']` beschränkt — sie wählt
**nie** `gebirge`. Jeder andere Leser von `ecosystem_area` filtert gar nicht: der öffentliche
Lesepfad, `terrain-store.php`, `heightmap.php`.

⭐ **Folge: die Erprobungs-Gebirge wirken heute schon.** V11s Gelände nutzt sie live. Das Entfernen
des Stempels ändert **nur Wasser** — die 11 Erprobungs-Seen — und das deckt sich mit der Messung:
`synthetic_connection_count` 861 → 860, **eine** Brücke.

**Diese Instruction ist also keine Voraussetzung für den A\*, sondern Aufräumarbeit mit einer
öffentlichen Nebenwirkung (§2.3/§2.4).** Sie kann parallel zu Instruction B laufen.

---

## 1. Der Bestand (2026-07-30, `ecosystem_revision` 6211) — nachzählen, nicht glauben

| | Anzahl |
|---|---|
| Flächen gesamt | 681 |
| davon `is_trial = 1` | **133** |
| davon Wasser (`meer`/`see`) | **11** ← die einzigen mit Routing-Wirkung |
| `gebirge` | 19 (18 mit Höhenparametern) |

⚠️ Der Owner zeichnet täglich. **Vor dem Bauen neu zählen**, eine einzelne Anfrage an
`GET /api/app/ecosystem-areas.php`.

---

## 2. Was zu tun ist

### 2.1 Den Stempel im Bestand löschen — über den vorhandenen Weg

`promote_trial` (`api/edit/map/ecosystem.php:103` → `avesmapsPromoteEcosystemTrial`,
`api/_internal/app/ecosystem.php:2293`) existiert fertig und wurde **nie an eine Oberfläche
angeschlossen** (repo-weit null Treffer in `js/`, `html/`, `index.html`, `edit/`).

`mode=keep` löscht den Stempel und behält die Flächen. ~~„schreibt Prüfeinträge ins Audit-Log"~~ —
**falsch für `keep`**: `:2323–2326` schreibt ausdrücklich **keine** Audit-Zeile („keep only flips a
flag; nothing is lost"). Nur `discard` protokolliert. Was `keep` sehr wohl tut und weshalb rohes SQL
falsch wäre: es hebt die `ecosystem_revision` und schaltet `app_setting['ecosystem_trial']` ab —
sonst bekäme die **nächste** gezeichnete Fläche den Stempel wieder.

⚠️ **`promote_trial` ist nicht rückgängig machbar** (`ecosystem-undo-test.php:57`).

🔧 **DU (Owner):** angemeldet, Browser-Konsole. 🪤 **Absoluter Pfad** — der relative löst von
`/edit/` aus auf `/edit/api/…` auf und ergibt 404:

```
fetch("/api/edit/map/ecosystem.php",{method:"POST",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({action:"promote_trial",mode:"keep"})}).then(r=>r.json()).then(console.log)
```

Die Aktion verlangt Fähigkeit **`edit`** (`api/edit/map/ecosystem.php:42`), nicht `admin`.

### 2.2 Den Stempel aus dem Code entfernen

- **`water-areas.php:78`**: `AND a.is_trial = 0` streichen. ⚠️ Die Begründung steht **nicht**
  daneben, sondern im Block `:102–111` unter der Funktion — und derselbe Block dokumentiert
  `affects_paths` und `ecosystem_enabled`, die **bleiben**. Nur den mittleren Punkt entfernen.
- **Neue Flächen**: `ecosystem.php:2137–2139` zieht `is_trial` aus `avesmapsEcosystemTrialActive`
  (Vorgabe **'1'** — Erprobung ist an, solange nichts '0' sagt). Einziger INSERT: `:2145–2157`.
- **`promote_trial`** + `avesmapsPromoteEcosystemTrial` + `AVESMAPS_ECOSYSTEM_TRIAL_SETTING`
  (`:171`) + `avesmapsEcosystemTrialActive` (`:850`) entfallen — **nachdem** 2.1 gelaufen ist.
- Spalte `is_trial` **bleibt** in der Tabelle (NOT NULL DEFAULT 0).
- **Zwei** Kommentarstellen, nicht eine: `map-features-ecosystem-height-render.js:12` **und
  `:174`** („`is_trial` wird NICHT gefiltert -- siehe Kopf.").
- **Die Oberfläche sagt weiterhin „Erprobung"**: `index.html:663`
  `<h2 id="ecosystem-intro-title">Landschaften (Erprobung)</h2>`, der V3.5-Hinweisdialog
  (`map-features-ecosystem-intro.js`) und der i18n-Schlüssel `ecosystem.intro.title`.
  🔧 **Owner fragen, ob der Erstkontakt-Hinweis ganz entfällt** — er hat ihn einmal ausdrücklich
  weder ausbauen noch entfernen lassen wollen.

### 2.3 Den Totmannschalter abschaffen

`app_setting['ecosystem_enabled']` (`AVESMAPS_ECOSYSTEM_SETTING`, `ecosystem.php:165`) und
`avesmapsEcosystemEnabled` (`:832`).

💣 **Vollständige Aufruferliste — die erste Fassung nannte zwei und übersah den mit
Außenwirkung:**

| Datei | Wirkung |
|---|---|
| `api/app/ecosystem-areas.php:73` | öffentlicher Lesepfad |
| **`api/app/path-landscapes.php:60`** (+ `:64`, `:83`) | 💣 **V10 „Führt durch" im Reiseplaner jedes Besuchers** |
| `api/_internal/app/path-landscapes.php:85` | derselbe Schlüssel, eigener Leser |
| `api/edit/map/ecosystem.php:100` | `set_enabled` |
| `js/map-features/map-features-ecosystem-loader.js:120` | Frontend |
| `html/landschaften-editor.html:49/784–786/1692/1809–1819` | Kachel „Landschaftsmodul" |
| `js/config.js:154/209`, `js/app/i18n-en.js:291` | |

~~„`avesmapsPathLandscapesEcosystemEnabled` (V11) ist möglicherweise ein anderer Schalter"~~ —
**falsch, zweifach**: es ist **derselbe** Schlüssel (`path-landscapes.php:80–86`, nur
`…GetWithoutDdl` statt `…Get`, kein DDL auf dem heißen Pfad), und es gehört zu **V10**, nicht V11.

⭐ **V11 hat einen echten eigenen Schalter, und der bleibt:**
`AVESMAPS_TERRAIN_SETTING = 'terrain_travel_enabled'` (`terrain-read.php:22`), gelesen von
`avesmapsRouteTerrainEnabled` (`:49`). **Nicht mitlöschen.**

### 2.4 🔴 `?landschaften=1` durch „Admin" ersetzen — hier liegt die eigentliche Arbeit

Ausgewertet an **genau einer** Stelle: `js/config.js:213`
(`const IS_ECOSYSTEM_ENABLED = INITIAL_SEARCH_PARAMS.get("landschaften") === "1";`).
Acht Verbraucher der Globalen: `bootstrap.js:309`, `map-features.js:37`,
`map-features-display-mode.js:173`, `…-ecosystem-layer-switch.js:53`,
`…-ecosystem-context-action.js:245/266`, `…-ecosystem-territory-import.js:629/894`.
Dazu `map-features-layer-state.js:187` — `"landschaften"` steht in `ignoredParams`.

💣 ~~„Es gibt bereits einen Weg, über den der Client Anmeldung und Rechte erfährt — den benutzen"~~
— **den gibt es nicht.** `IS_EDIT_MODE = INITIAL_SEARCH_PARAMS.get("edit") === "1"`
(`js/config.js:207`) ist ein **ungeprüfter URL-Schalter**. `index.html` ist statisch, dort kann
serverseitig nichts eingebettet werden. Die Sitzung lebt nur serverseitig (`api/_internal/auth.php`,
`$_SESSION['avesmaps_user']`, Rollen `admin|editor|reviewer`, `avesmapsUserCan:83`), und
serverseitig gerendert wird der Nutzer **nur** in `edit/index.php` und `admin/index.php` — die
Editor-Hülle bindet die Karte als `<iframe src="../index.html?…&edit=1">` ein und gibt **nichts**
über den Nutzer weiter. Einen `session`/`me`-Endpunkt gibt es nicht.

**Der Kanal ist Neubau.** Das Nächstliegende ist `POST /api/edit/map/presence.php` (Fähigkeit
`review`, liefert `username`+`role`) — brauchbar, aber indirekt und nur im Edit-Modus gepollt.
Sauberer ist ein schlanker Lese-Endpunkt („wer bin ich, was darf ich"), den die Karte einmal beim
Start fragt.

💣 **Und die Falle, die daraus folgt:** weil `?edit=1` ungeprüft ist, wäre „nimm einfach
`IS_EDIT_MODE`" **gar kein Riegel** — jeder Besucher hängt `?edit=1` an. Wer den URL-Riegel
entfernt, bevor der echte Kanal steht, macht die Landschaftsebene **öffentlich sichtbar**.

---

## 3. Nachweis

**Lokal:** Unit-Test für die neue Rechteprüfung (Muster: `api/_internal/*/__tests__/*.php`,
`js/*/__tests__/*.test.js`; Pflicht-Flags siehe `php-js-test-commands`).

**Live, nach dem Deploy — Einzelproben:**

1. `GET /api/app/ecosystem-areas.php` anonym → Flächen kommen, `is_trial` überall 0.
2. **`GET /api/app/path-landscapes.php`** → die „Führt durch"-Zeile funktioniert weiterhin.
   💣 Der Aufrufer, den die erste Fassung übersah.
3. `https://avesmaps.de/` **ohne Anmeldung, ohne Parameter** → Landschaftsebene **nicht** sichtbar.
   Die einzige Probe mit Außenwirkung.
4. `https://avesmaps.de/?edit=1` **ohne Anmeldung** → ebenfalls **nicht** sichtbar (§2.4).
5. Als **Admin** angemeldet → Ebene da, ohne Parameter.
6. Eine Route: `synthetic_connection_count` fällt von 861 auf **860**. Bleibt sie bei 861, hat
   §2.2 nicht gegriffen.

---

## 4. Fallen

1. 💣 **Der Stempel versteckt keine Gebirge** (§0) — wer das glaubt, sucht eine Wirkung, die nicht kommt.
2. 💣 **Nicht per SQL** (§2.1) — der Schalter für neue Flächen bliebe an.
3. 💣 **`path-landscapes.php` nicht vergessen** (§2.3) — öffentliche Wirkung.
4. 💣 **`terrain_travel_enabled` ist ein ANDERER Schalter und bleibt** (§2.3).
5. 💣 **Der Rechte-Kanal ist Neubau** (§2.4); `?edit=1` ist kein Ersatzriegel.
6. 🪤 **Absoluter Pfad im Konsolen-Schnipsel** (§2.1).
7. ⚠️ Kein `?v=` von Hand (AGENTS.md §7), kein Handbuch-Edit (§9).

---

## 5. Was NICHT dazugehört

Der A\* und „Hierher reisen" (**Instruction B**) · die Spalte `is_trial` löschen ·
Reviewer-Rechte („zur gegebenen Zeit") · ein Knopf für `promote_trial`.
