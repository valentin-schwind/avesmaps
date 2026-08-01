# Instruction A — Die Erprobung abschaffen

**Auftrag Owner 2026-07-30:** *„Es gibt keine ‚Erprobungen' oder ‚Stempel' mehr und keine
landschaften=1. Schalte landschaften=1 aber nur für Admins automatisch frei (Totmannschalter ist
abgeschafft)."*

**Diese Instruction ist die Vorarbeit für Instruction B** (`2026-07-30-hierher-reisen-und-astar.md`).
Ohne sie sieht der A\* keine Gebirge, weil alle 19 als Versuch markiert sind.

---

## 0. Warum das keine Aufräumarbeit ist

Der Erprobungszustand ist an **vier** Stellen verdrahtet, und drei davon wirken auf das, was
Besucher sehen:

| | wo | was es heute tut |
|---|---|---|
| `ecosystem_area.is_trial` | Spalte | markiert jede Fläche als Versuch |
| `app_setting['ecosystem_trial']` | Schalter | solange an, bekommt **jede neue** Fläche den Stempel |
| `app_setting['ecosystem_enabled']` | Totmannschalter | ist er aus, liefert der öffentliche Lesepfad **nichts** |
| `?landschaften=1` | URL-Riegel | schaltet die Ebene im Browser frei |

💣 **`is_trial` filtert das Routing.** `avesmapsLoadRouteWater()` (V13) hat
`AND a.is_trial = 0` in der Abfrage, mit ausdrücklicher Begründung: *„Routing darf sich nicht
ändern, weil jemand etwas ausprobiert."* Diese Zeile fällt hier weg — und **erst dann** wirken die
19 Gebirge und die 11 Erprobungs-Seen.

---

## 1. Der Bestand, gemessen am 2026-07-30 (`ecosystem_revision` 6211)

| | Anzahl |
|---|---|
| Flächen gesamt | **681** |
| davon `is_trial = 1` | **133** |
| `gebirge` | 19 (18 mit Höhenwerten) |
| Flächen mit Höhenwerten | 63 |
| `ecosystem_enabled` | **true** |

⚠️ **Die Zahl 133 altert.** Der Owner arbeitet täglich an den Flächen; vor dem Bauen neu zählen.

**Gemessene Wirkung des Stempel-Entfernens auf das heutige Routing: eine einzige Brücke**
(861 → 860 synthetische Kanten), **kein** zusätzlicher Ort verliert die Landverbindung. Das
Entfernen ist also für sich genommen ungefährlich; gefährlich wäre nur, es unvollständig zu tun.

---

## 2. Was zu tun ist

### 2.1 🔴 Zuerst: den Stempel im Bestand löschen — über den vorhandenen Weg

Die Aktion existiert fertig und wurde **nie an eine Oberfläche angeschlossen**:
`promote_trial` in `api/edit/map/ecosystem.php:103` → `avesmapsPromoteEcosystemTrial`
(`api/_internal/app/ecosystem.php:2293`). `mode=keep` löscht den Stempel und behält die Flächen,
`mode=discard` löscht die Flächen.

**Nicht per rohem SQL.** Die Funktion schreibt Prüfeinträge ins Audit-Log, hebt die
`ecosystem_revision` und schaltet `app_setting['ecosystem_trial']` ab — SQL allein ließe den
Schalter an, und die **nächste** gezeichnete Fläche bekäme den Stempel wieder.

🔧 **DU (Owner):** angemeldet auf avesmaps.de, Browser-Konsole:

```
fetch("api/edit/map/ecosystem.php",{method:"POST",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({action:"promote_trial",mode:"keep"})}).then(r=>r.json()).then(console.log)
```

⚠️ **Prüfen, ob es schon gelaufen ist**, bevor irgendetwas gebaut wird: eine Anfrage an
`GET /api/app/ecosystem-areas.php` und `is_trial` zählen. Steht dort 0, ist Schritt 2.1 erledigt.

### 2.2 Den Stempel aus dem Code entfernen

- **`avesmapsLoadRouteWater()`** (`api/_internal/routing/water-areas.php`): `AND a.is_trial = 0`
  streichen, samt der Begründung im Kommentar — sie gilt nicht mehr.
- **Neue Flächen** dürfen keinen Stempel mehr bekommen: die Setzung in
  `api/_internal/app/ecosystem.php` (dort, wo `is_trial` beim Anlegen aus
  `app_setting['ecosystem_trial']` gezogen wird) entfällt.
- **`promote_trial`** selbst und `avesmapsPromoteEcosystemTrial` entfallen, **nachdem** 2.1 gelaufen
  ist. ⚠️ Erst prüfen, dann löschen — nicht in derselben Sitzung beides.
- Die Spalte `is_trial` **bleibt vorerst in der Tabelle** (NOT NULL DEFAULT 0). Eine Spalte zu
  löschen ist eine Migration mit Rückweg-Problem; sie kostet nichts und kann später fallen.
- ⚠️ **`map-features-ecosystem-height-render.js:12`** dokumentiert ausdrücklich, dass
  `is_trial`-Flächen **mitgezeichnet** werden. Dieser Kommentar wird gegenstandslos und gehört
  entfernt, nicht stehengelassen.

### 2.3 Den Totmannschalter abschaffen

`app_setting['ecosystem_enabled']` und `avesmapsEcosystemEnabled()` entfallen. Betroffen sind
mindestens `api/app/ecosystem-areas.php` (die Kill-Switch-Prüfung ganz oben, vor dem ETag) und
`api/edit/map/ecosystem.php` (`set_enabled`).

💣 **Vorher alle Aufrufer suchen** — `grep -rn "ecosystem_enabled\|avesmapsEcosystemEnabled"`.
V11 hat einen eigenen (`avesmapsPathLandscapesEcosystemEnabled`); prüfen, ob der derselbe Schalter
ist oder ein anderer, und **nicht blind mitlöschen**.

### 2.4 `?landschaften=1` durch „Admin" ersetzen

Statt des URL-Riegels wird die Ebene **automatisch** freigeschaltet, wenn der angemeldete Nutzer
Admin ist. Reviewer bekommen später Zugriff — die Prüfung gehört deshalb an **eine** Stelle, damit
ein zweites Recht später eine Zeile ist.

💣 **Wie erfährt der Browser, dass jemand Admin ist?** Das ist die eigentliche Arbeit dieses
Schrittes, nicht das Entfernen des Riegels. Es gibt bereits einen Weg, über den der Client
Anmeldung und Rechte erfährt (der Edit-Modus hängt daran) — **den benutzen, keinen zweiten bauen.**
Zuerst suchen: `grep -rn "capability\|avesmapsUserCan\|isAdmin\|admin" js/app/ js/config.js`.

⚠️ **Der Riegel darf nicht ersatzlos fallen.** Fällt er weg, ohne dass die Adminprüfung greift,
sieht **jeder Besucher** die Landschaftsebene. Das ist eine öffentliche Bestandsänderung, keine
interne Umstellung — der Nachweis in §3 prüft genau das.

---

## 3. Nachweis

**Lokal (ohne DB):** die reinen Prädikate, die durch den Umbau entstehen — vor allem die
Adminprüfung — bekommen einen Unit-Test. Muster: `api/_internal/routing/__tests__/*.php` bzw.
`js/*/__tests__/*.test.js`. Siehe `php-js-test-commands` für die Pflicht-Flags.

**Am Livebestand, nach dem Deploy — drei Proben, jede einzeln:**

1. `GET /api/app/ecosystem-areas.php` **anonym**: liefert die Flächen (kein Kill-Switch mehr),
   und `is_trial` ist überall 0.
2. `https://avesmaps.de/` **ohne Anmeldung, ohne `?landschaften=1`**: die Landschaftsebene ist
   **nicht** sichtbar. 💣 Das ist die Probe, die schiefgehen kann, und die einzige mit
   Außenwirkung.
3. `https://avesmaps.de/` **als Admin angemeldet**: die Ebene ist da, ohne Parameter.

**Und die Zahl, die den Erfolg belegt:** `POST /api/route/` liefert in
`route.debug.context.client_graph_statistics.synthetic_connection_count` **860** statt 861
(gemessen: das Entfernen kostet genau eine Brücke). Ändert sich die Zahl gar nicht, hat 2.2 nicht
gegriffen.

---

## 4. Fallen

1. 💣 **Nicht per SQL** — der Schalter für neue Flächen bliebe an (§2.1).
2. 💣 **`is_trial = 0` im Routing streichen ist der Punkt der ganzen Übung.** Wer nur die
   Oberfläche aufräumt und die Abfrage vergisst, hat nichts erreicht.
3. 💣 **Der URL-Riegel darf nicht ersatzlos fallen** (§2.4) — sonst öffentlich sichtbar.
4. ⚠️ **`avesmapsPathLandscapesEcosystemEnabled` (V11) ist möglicherweise ein anderer Schalter.**
   Prüfen, nicht annehmen.
5. ⚠️ **Kein `?v=` von Hand.** Frontend-Änderungen stempelt der Deploy; nur
   `edit/index.php` ist die dokumentierte Ausnahme (AGENTS.md §7).
6. ⚠️ **Editor-sichtbare Änderung → im Commit-Betreff benennen**, aber das Handbuch **nicht**
   anfassen (AGENTS.md §9).

---

## 5. Was NICHT dazugehört

- Der A\* und „Hierher reisen" — **Instruction B**.
- Die Spalte `is_trial` aus der Tabelle löschen (§2.2).
- Reviewer-Rechte — der Owner sagt ausdrücklich „zur gegebenen Zeit".
- Ein Knopf für `promote_trial` — die Aktion verschwindet ja.

---

Siehe `docs/superpowers/specs/2026-07-30-landschaften-v14-astar-design.md` §4.5,
`docs/superpowers/specs/2026-07-29-landschaften-v13-wasser-design.md` §4.1.
