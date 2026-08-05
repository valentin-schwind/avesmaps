# A16 · Änderungsprotokoll für Karten, Abenteuer und Vorkommen — Entwurf

**Stand:** 2026-08-06 · **Befund:** `docs/systemtest-2026-08-05/1-akut.md` § A16 · **Status:** Entwurf,
noch nicht gebaut. Er braucht eine Owner-Entscheidung an genau zwei Stellen (§ 6).

---

## 1. Was der Befund sagt, und was davon stimmt

> „Sieben schreibende Vorgänge, **null Protokollzeilen**, in allen drei Bibliotheken null
> Audit-Aufrufe. Abenteuer und Karten werden **hart** gelöscht; Vorkommen speichern beim
> Fokusverlust, ohne Speichern-Knopf."

**Null Audit-Aufrufe: bestätigt.** `grep -c 'AuditLog\|audit_log'` liefert 0 für
`api/_internal/app/citymaps.php` (bei 11 `DELETE`, 14 `UPDATE`, 6 `INSERT`) und 0 für
`api/_internal/app/adventures.php` (6 / 11 / 7).

⚠️ **„Sieben schreibende Vorgänge" untertreibt deutlich.** Ausgezählt an den `match ($action)`-Armen
der drei Editor-Endpunkte:

| Endpunkt | schreibende Aktionen |
|---|---|
| `api/edit/map/citymaps.php` | `upsert_citymap`, `delete_citymap`, `set_types`, `set_related`, `set_links`, `suppress_link`, `add_place`, `set_place`, `suppress_place`, `resolve_place`, `set_citymaps_enabled`, `set_citymap_previews_enabled` — **12** |
| `api/edit/map/adventures.php` | `upsert_adventure`, `set_links`, `add_place`, `set_place`, `suppress_place`, `delete_adventure`, `resolve_place`, `set_covers_enabled`, `set_adventures_enabled` — **9** |
| `api/edit/map/lore.php` | `add_place`, `remove_place`, `set_field`, `set_status`, `set_kind_enabled` — **5** |

**26 Aktionen**, nicht 7. Der Aufwand ist entsprechend größer als notiert — und das ist der Grund,
warum dieser Entwurf existiert statt eines Commits.

---

## 2. Die vier Tatsachen, die den Weg öffnen (alle nachgeprüft)

1. **Protokollzeilen ohne Rückgängig sind ein vorgesehener Zustand.**
   `avesmapsCanUndoAuditAction()` (`api/_internal/map/features.php:276`) antwortet `true` nur für
   drei Fälle: eine Aktion aus der Erzeugungs-**Liste**, `delete_feature`, oder eine Aktion mit
   Rückgängig-Spalten. Alles andere ist automatisch nicht rückgängig zu machen — Server **und**
   Oberfläche, aus derselben Funktion.
2. **`avesmapsIsCreateAuditAction()` ist eine explizite Liste** (`:322`), **kein** Präfix-Vergleich.
   Ein neuer Aktionsname `create_citymap` würde also *nicht* versehentlich rückgängig-fähig.
3. **`feature_id` ist nullable.** `avesmapsWriteMapAuditLog(PDO $pdo, ?int $featureId, …)`
   (`:2979`) — geweitet für A9.
4. **Es gibt ein Vorbild im Haus, aus A4:** `api/edit/reports/locations.php:581-584` protokolliert
   Moderationsentscheidungen mit `feature_id = NULL` und dem Namen in `after_json`.

---

## 3. 💣 Die eine Falle, an der dieses Vorhaben scheitern kann

Die Listen-Abfrage der Oberfläche (`api/edit/map/audit-log.php:67-68`) lautet:

```sql
FROM map_audit_log audit
LEFT JOIN map_features features ON features.id = audit.feature_id
```

**Wer die Id einer Karte, eines Abenteuers oder eines Vorkommens in `feature_id` schreibt, trifft
damit ein völlig unbeteiligtes Kartenobjekt** — die Id-Räume sind getrennt, aber die Zahlen
überschneiden sich. Der Protokolleintrag zeigte dann den Namen eines fremden Ortes an, und niemand
sähe, dass er falsch ist. Ein `LEFT JOIN` fällt nicht auf; er liefert einfach eine Zeile.

**Regel: `feature_id` ist für alle drei Bibliotheken `NULL`.** Nicht `0` — eine Null behauptet ein
Objekt, das es nicht gibt, und überlebt in jeder späteren Abfrage. Die Identität (`public_id`, Titel,
Art) reist in `after_json`, genau wie bei A4.

⚠️ **Folge für die Oberfläche:** `features.name` ist bei diesen Zeilen `NULL`. Der Normalisierer
(`avesmapsNormalizeAuditRow`) muss den Namen dann aus `after_json` nehmen, sonst steht im
Änderungsverlauf eine namenlose Zeile. Das ist die einzige Stelle, an der die Oberfläche angefasst
werden muss.

---

## 4. Was gebaut wird — in drei Stufen, jede für sich lieferbar

**Stufe 1 — Protokoll für die Löschungen** (`delete_citymap`, `delete_adventure`, `remove_place`).
Der Befund nennt das Fehlen eines Wegs zurück als Kern; ein hartes Löschen ohne Spur ist der
schlimmste der 26 Fälle. Drei Aufrufe, ein Aktionsnamen-Trio, keine Rückgängig-Fähigkeit.

**Stufe 2 — Protokoll für die übrigen 23 Aktionen.** Mechanisch, aber breit. Ein gemeinsamer Helfer
je Bibliothek (nach dem Muster von `avesmapsBuildReportModerationAuditSnapshots`), damit die
Vorher/Nachher-Paare nicht 23-mal von Hand gebaut werden.

⚠️ **Feldliste je Bibliothek, nicht `SELECT *`.** A4 hat dafür eine Allowlist
(`AVESMAPS_REPORT_MODERATION_AUDIT_FIELDS`), und der Grund steht dort: `map_audit_log` wird von einem
anderen Endpunkt gelesen, behält 200 Einträge und reist in jedem Datenbank-Backup mit. Was nicht
beantwortet „welches Objekt, und was wurde entschieden", bleibt draußen.

**Stufe 3 — Rückgängig.** Erst hier wird es teuer: es braucht Rückgängig-Spalten je Aktion, und für
die Löschungen ein weiches Löschen (`is_active`), das es in diesen Tabellen noch nicht gibt. Stufe 3
ist ein eigener Entwurf und **nicht** Teil dieses.

---

## 5. Wie es geprüft wird

- **Ohne Datenbank prüfbar:** die Namen der Aktionen dürfen weder in der Erzeugungs-Liste stehen noch
  Rückgängig-Spalten haben ⇒ `avesmapsCanUndoAuditAction()` muss für jede `false` liefern. Das ist
  eine reine Funktion und eine Zusicherung je Name.
- **💣 Und eine Zusicherung, die den Befund selbst festhält:** kein Aufruf von
  `avesmapsWriteMapAuditLog` aus diesen drei Bibliotheken darf etwas anderes als `null` als
  `feature_id` übergeben. Am Quelltext prüfbar, und sie fängt genau die Falle aus § 3.
- **Verhaltensprüfung** der Vorher/Nachher-Paare gegen sqlite, wie bei A4.
- ⚠️ **Live nicht prüfbar** ohne Anmeldung als Bearbeiter; die Wirkung zeigt sich erst im
  Änderungsverlauf des Editors.

---

## 6. 🔧 DU: zwei Entscheidungen, sonst nichts

1. **Zählen die Schalter mit?** `set_citymaps_enabled`, `set_citymap_previews_enabled`,
   `set_covers_enabled`, `set_adventures_enabled`, `set_kind_enabled` sind **Notausschalter**, keine
   Inhaltsänderungen — aber genau sie will man im Nachhinein wissen („seit wann sind die Karten
   aus?"). Dafür: ja. Dagegen: sie fluten ein Protokoll, das nur 200 Einträge behält, wenn jemand
   einen Schalter mehrfach umlegt. **Mein Vorschlag: ja**, sie sind selten und ihre Wirkung ist
   global.
2. **Wie weit reicht Stufe 1?** Nur die drei Löschungen (klein, sofort), oder gleich alle 26
   (vollständig, aber ein großer Commit gegen 55 Schreibanweisungen). **Mein Vorschlag: die drei
   Löschungen zuerst** — sie sind der Kern des Befundes, und die Erfahrung dieser Sitzung ist, dass
   breite mechanische Änderungen genau die sind, bei denen eine Zeile verrutscht.

⚠️ Was **nicht** zur Debatte steht und deshalb hier nicht als Frage auftaucht: `feature_id = NULL`
(§ 3) und die Feldliste statt `SELECT *` (§ 4). Beides ist keine Geschmacksfrage.
