# Lizenzangaben Phase 3 (Die Gates) — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen Checkboxen.

**Entwurf:** `docs/superpowers/specs/2026-08-16-lizenzangaben-vereinheitlichung-design.md` (§5)
**Vorgänger:** Phase 1 (`b2f7fb62`…`5bbdf210`) und Phase 2 (`ad9ec778`…`3e756d59`) sind live.

**Ziel:** Eine Regel für alle fünf Flächen — `cc_by` und `unknown_other` erscheinen nicht im
Frontend, die übrigen fünf schon. Zwei Flächen ändern dabei ihr Verhalten.

**Bauart:** Zwei kleine Eingriffe an genau zwei Stellen, jeder mit einem Test, plus die
Rechtsdokumente. Kein neues Modul, keine Datenänderung.

🔴 **Das ist die EINZIGE besucher-sichtbare Änderung des ganzen Umbaus.** Sie geht allein live und
wird angesehen (AGENTS §9). Kein Bündel mit Phase 4.

---

## 🔴 Die Vorbedingung — ohne sie darf diese Phase nicht deployen

**Der Anwendungslauf aus Phase 2 muss vollständig durch sein.** Nicht „gestartet", nicht „meistens":
vollständig.

Der Grund steht in einer einzigen Zahl: Ein Siedlungs-Wappen mit dem Altwert `'own'` ist heute
**sichtbar** (es gibt dort kein Gate). `avesmapsMediaLicenseIsPublic('own')` liefert `false` — der
Katalog kennt bewusst keine Aliase. Baut jemand das Gate ein, bevor die Migration `'own'` zu
`ai_generated` gemacht hat, **verschwinden diese Wappen still von der Karte**, und es sähe von außen
aus wie ein geglückter Deploy.

⚠️ **Für die Territoriums-Wappen gilt das NICHT** — dort ist jeder unmigrierte Altwert
(`attribution_required`, `unknown`) vorher wie nachher unsichtbar. Die Falle betrifft allein die
Siedlungen.

**Prüfbefehl vor dem Bauen** — die Vorschau aus Phase 2 gegen den Livebestand, und zwar mit dem
großen Fenster (`batch_limit: 2000`, sonst 24 Aufrufe statt 3):

```bash
curl -s -X POST https://avesmaps.de/api/edit/admin/media-license-migration.php \
  -H 'Content-Type: application/json' -H 'Cookie: <Sitzung eines Admins>' \
  -d '{"batch_limit": 2000}' | python -m json.tool
```

Drei Zahlen müssen stimmen, bevor irgendjemand Code schreibt:

| Feld | erwartet | sonst |
|---|---|---|
| `surfaces.settlement_coat.geaendert` | **0** | die Migration ist nicht durch — Phase 3 **stoppen** |
| `sichtbarkeitswechsel` | **leer** | der Bestand trägt einen Wert, den die Zuordnung nicht kennt |
| `coat_ohne_lizenz_gesamt` | **0** | siehe unten |

💣 **`coat_ohne_lizenz_gesamt` ist der Fall, den Phase 2 bewusst NICHT migriert hat:** ein
Wappen-Objekt mit gesetzter URL, aber leerem `license_status`. Es ist heute sichtbar und wäre nach
dem Gate weg. Ist die Zahl größer als 0, gehört sie vor den Owner — jede dieser Zeilen braucht eine
Einstufung von Hand, bevor das Gate kommt. **Nicht raten, nicht überspringen.**

🔧 **DU (Owner):** Diese Prüfung ist deine, nicht die einer Sitzung. Sie braucht eine Admin-Sitzung
gegen die Live-Datenbank.

---

## Globale Vorgaben

- **Kommentare und Commit-Nachrichten auf Deutsch** (AGENTS §8).
- **Der Baum ist geteilt: niemals `git add -A`, `git add .` oder `git commit -a`.** Nur eigene Pfade
  einzeln stagen; fremde Änderungen bleiben liegen, auch wenn sie Tests rot färben.
- **Vor dem Push das GANZE Testfeld.** 💣 Rote Tests, die nicht zu den eigenen Dateien gehören, sind
  kein Freibrief und kein eigener Befund: dann in einem separaten Arbeitsbaum auf dem Commit-Stand
  prüfen (`git worktree add --detach <scratchpad>/pruefbaum HEAD`) — nur der belegt, was der Push
  überträgt.
- **Die öffentlichen fünf sind:** `public_domain`, `cc0`, `permission_granted`, `ai_generated`,
  `own_work`. Nicht öffentlich: `cc_by`, `unknown_other`.
- 🔴 **Diese Phase ändert keine Daten.** Kein `UPDATE`, kein Migrationslauf, keine DDL.
- 🔴 **Kein Dialog wird angefasst** (Phase 4). Kein `?v=` von Hand.

---

## Dateien dieser Phase

| Datei | Änderung |
|---|---|
| `api/_internal/app/coat-display.php` | neue Prüffunktion `avesmapsSettlementCoatIsPublic` — hier, weil testbar |
| `api/app/map-features.php` | der Aufruf, vor dem Anzeige-Schalter |
| `api/_internal/coat-url.php` | der rohe Listenvergleich weicht der Katalog-Funktion |
| `api/_internal/app/__tests__/settlement-coat-gate-test.php` | **neu** — das Siedlungs-Gate |
| `api/_internal/__tests__/coat-resolve-test.php` | erweitert um die fünf öffentlichen und die Altwerte |
| `NOTICE.md` | der Wortlaut, mit Owner-Blick (`LEGAL.md` nur falls nötig) |

---

## Aufgabe 1: Siedlungs-Wappen bekommen ihr Gate

**Dateien:**
- Ändern: `api/_internal/app/coat-display.php` (die Prüffunktion)
- Ändern: `api/app/map-features.php` (der Aufruf)
- Test: `api/_internal/app/__tests__/settlement-coat-gate-test.php` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsMediaLicenseIsPublic()` aus `api/_internal/media-license.php` (Phase 1, live).
- Liefert: `avesmapsSettlementCoatIsPublic(mixed $coat): bool`

💣 **Die Funktion gehört NICHT in `map-features.php`, obwohl der Aufruf dort steht.** Die Datei ist
ein Endpunkt: ihr `require __DIR__ . '/../_internal/bootstrap.php'` (Zeile 5) läuft beim Laden, ein
Test kann sie also nicht einbinden. `api/_internal/app/coat-display.php` ist der richtige Ort — sie
ist seiteneffektfrei, trägt bereits die Wappen-Anzeigelogik (`avesmapsCoatDisplayUrl`), wird von
`map-features.php` ohnehin schon eingebunden (Zeile 8) und hat einen laufenden Test
(`api/_internal/app/__tests__/coat-display-test.php`). Prüfbefehl:

```bash
head -12 api/app/map-features.php | grep -n "require"
grep -n "^require\|^try" api/_internal/app/coat-display.php; echo "(leer = seiteneffektfrei)"
```

- [ ] **Schritt 1: Die Stelle ansehen, bevor du sie anfasst**

```bash
grep -n -B 8 -A 4 "settlementCoatsEnabled)" api/app/map-features.php
grep -n -A 24 "function avesmapsMapFeaturesPublicImageUrls" api/app/map-features.php
```

Das zweite ist dein Vorbild: das Bild-Gate steht direkt darüber und tut genau dasselbe eine Ebene
tiefer. Bau die gleiche Form, nicht eine neue.

⚠️ **Beachte, was der bestehende Kommentar bei `$settlementCoatsEnabled` sagt:** hier wird das Wappen
**entfernt**, nicht durch einen Platzhalter ersetzt — anders als bei den Territorien. Der Grund steht
dort: das Siedlungswappen **ersetzt** das Ortssymbol (`settlementCoatIconMarkup`), ein leerer Schild
nähme also Information weg statt nur den Schmuck. Dein Gate erbt dieselbe Form: `unset`.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

Datei `api/_internal/app/__tests__/settlement-coat-gate-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Das Lizenz-Gate der Siedlungs-Wappen. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/settlement-coat-gate-test.php
 *
 * 🔴 Bis Phase 3 gab es hier GAR KEIN Gate: properties.coat ging ungefiltert an die Karte, und ein
 * Upload stand sofort oeffentlich, unabhaengig von seiner Herkunft. Dieser Test ist die Zusicherung,
 * dass das vorbei ist -- und zugleich, dass der Bestand (ai_generated nach der Migration aus Phase 2)
 * dabei sichtbar BLEIBT.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

// ⚠️ coat-display.php, NICHT map-features.php: jene ist ein Endpunkt und zieht beim Laden den
// Bootstrap nach. Die Pruefunktion lebt deshalb hier, der Aufruf drueben.
require __DIR__ . '/../../media-license.php';
require __DIR__ . '/../coat-display.php';

// ---- die fuenf oeffentlichen kommen durch ----------------------------------------------------------
foreach (['public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work'] as $kennung) {
    assert(
        avesmapsSettlementCoatIsPublic(['url' => '/uploads/wappen/own/a.png', 'license_status' => $kennung]) === true,
        "{$kennung} muesste durchkommen"
    );
}

// ---- die zwei stillen nicht -------------------------------------------------------------------------
foreach (['cc_by', 'unknown_other'] as $kennung) {
    assert(
        avesmapsSettlementCoatIsPublic(['url' => '/uploads/wappen/own/a.png', 'license_status' => $kennung]) === false,
        "{$kennung} duerfte NICHT durchkommen"
    );
}

// ---- der Bestand nach der Migration aus Phase 2 -----------------------------------------------------
// 🔴 'own' wurde zu 'ai_generated' (Owner: die Editoren haben diese Wappen mit KI erzeugt). Der
// Bestand bleibt damit sichtbar -- das ist die Zusicherung "kein Bild wechselt seine Sichtbarkeit",
// eine Phase weiter getragen.
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'ai_generated']) === true);
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'public_domain']) === true);

// 💣 Ein unmigrierter Altwert ist NICHT oeffentlich. Genau deshalb darf diese Phase erst nach dem
// Anwendungslauf deployen -- der Test haelt die Tatsache fest, er entschaerft sie nicht.
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'own']) === false);

// ---- Unfug faellt heraus ----------------------------------------------------------------------------
assert(avesmapsSettlementCoatIsPublic(['url' => '', 'license_status' => 'public_domain']) === false); // kein Bild
assert(avesmapsSettlementCoatIsPublic(['license_status' => 'public_domain']) === false);              // keine url
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png']) === false);                                // keine Lizenz
assert(avesmapsSettlementCoatIsPublic(null) === false);
assert(avesmapsSettlementCoatIsPublic('/x.png') === false);
assert(avesmapsSettlementCoatIsPublic([]) === false);

// ---- die Rangfolge: Gate VOR Schalter ---------------------------------------------------------------
// ⚠️ Beides endet in unset(), das Ergebnis ist also gleich -- die Reihenfolge steht trotzdem fest, weil
// sie die Bedeutung traegt: der Riegel ist rechtlich, der Schalter eine Anzeigepraeferenz. Ein wieder
// eingeschaltetes "Wappen: An" darf nie etwas hervorholen, das das Gate verworfen hat
// (dieselbe Ordnung wie coat-display.php:92-94).
$quelle = file_get_contents(__DIR__ . '/../../../app/map-features.php');
$posGate = strpos($quelle, 'avesmapsSettlementCoatIsPublic($properties[\'coat\'])');
$posSchalter = strpos($quelle, 'if (!$settlementCoatsEnabled)');
assert($posGate !== false && $posSchalter !== false, 'eine der beiden Stellen fehlt');
assert($posGate < $posSchalter, 'das Lizenz-Gate muss VOR dem Anzeige-Schalter stehen');

echo "settlement-coat-gate-test: OK\n";
```

- [ ] **Schritt 3: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/settlement-coat-gate-test.php
```

Erwartet: **Fehlschlag** — `avesmapsSettlementCoatIsPublic` gibt es noch nicht.

⚠️ Schlägt es stattdessen beim `require` von `map-features.php` fehl (Bootstrap, DB-Verbindung), dann
hat die Datei Seiteneffekte auf oberster Ebene, die ein Test nicht auslösen darf. **Melde das als
BLOCKED**, statt den Test um die Stelle herumzubauen — dann muss die Funktion in eine Bibliothek, und
das ist eine Planänderung.

- [ ] **Schritt 4: Die Funktion schreiben**

In `api/app/map-features.php`, direkt neben `avesmapsMapFeaturesPublicImageUrls`:

```php
/**
 * Darf dieses Siedlungs-Wappen im Frontend erscheinen?
 *
 * 🔴 Bis zum 16.08.2026 gab es hier GAR KEIN Gate -- properties.coat ging ungefiltert an die Karte,
 * und ein Upload stand sofort oeffentlich, unabhaengig von seiner Herkunft. Die Territoriums-Wappen
 * hatten seit jeher eines (coat-url.php); die Siedlungen waren die Luecke.
 *
 * ⚠️ KEIN edit_mode-Bypass, anders als beim Anzeige-Schalter daneben. Der Editor liest sein Wappen
 * ueber einen EIGENEN Endpunkt (avesmapsWikiSettlementCoatInfo, api/edit/wiki/settlements.php:131)
 * und sieht dort immer den vollen Datensatz -- er braucht die Karte dafuer nicht. Genau so haelt es
 * das Bild-Gate direkt darueber, und ein Bypass hier waere eine zweite, schwaechere Tuer zu Bildern,
 * die nicht oeffentlich sein duerfen.
 */
function avesmapsSettlementCoatIsPublic(mixed $coat): bool {
    if (!is_array($coat)) {
        return false;
    }
    if (trim((string) ($coat['url'] ?? '')) === '') {
        return false;
    }

    return avesmapsMediaLicenseIsPublic($coat['license_status'] ?? null);
}
```

Und an der Stelle, die du in Schritt 1 gelesen hast — **vor** dem Schalter-Block:

```php
    // Lizenz-Gate der Siedlungs-Wappen (Phase 3). Dieselbe Regel wie ueberall: cc_by und
    // unknown_other werden gespeichert, aber nicht gezeigt. Entfernt wird der GANZE coat-Schluessel,
    // nicht nur die url -- aus demselben Grund, den der Schalter-Block darunter nennt: das Wappen
    // ERSETZT hier das Ortssymbol, ein leerer Schild naehme also Information weg.
    //
    // 🔴 STRIKT VOR dem Anzeige-Schalter. Beide enden in unset(), das Ergebnis ist also dasselbe --
    // die Reihenfolge traegt die Bedeutung: der Riegel ist rechtlich, der Schalter eine Praeferenz.
    // Dieselbe Ordnung wie in coat-display.php:92-94, und der Test nagelt sie fest.
    if (isset($properties['coat']) && !avesmapsSettlementCoatIsPublic($properties['coat'])) {
        unset($properties['coat']);
    }
```

⚠️ Vergewissere dich, dass `api/_internal/media-license.php` in `map-features.php` eingebunden ist —
in Phase 1 wurde dort **kein** Aufrufer umgestellt, das `require_once` fehlt also noch:

```bash
grep -n "media-license" api/app/map-features.php
```

Ist es nicht da, gehört es zu den anderen `require_once` am Kopf der Datei.

- [ ] **Schritt 5: Test grün**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/settlement-coat-gate-test.php
```

- [ ] **Schritt 6: Committen**

```bash
git add api/app/map-features.php api/_internal/app/__tests__/settlement-coat-gate-test.php
git commit -m "feat(lizenzen): Siedlungs-Wappen bekommen erstmals ein Lizenz-Gate"
```

---

## Aufgabe 2: Das Territoriums-Gate liest den Katalog

**Dateien:**
- Ändern: `api/_internal/coat-url.php`
- Ändern: `api/_internal/__tests__/coat-resolve-test.php`

- [ ] **Schritt 1: Die Stelle lesen**

```bash
grep -n -B 6 -A 14 "AVESMAPS_COAT_PUBLIC_LICENSES" api/_internal/coat-url.php
```

💣 **Der Entwurf sagte ursprünglich „die Konstante wird auf die fünf öffentlichen Werte erweitert" —
das ist der falsche Griff und wurde am 16.08.2026 korrigiert.** `coat-url.php:70` prüft die Liste
**roh**, ohne vorherige Normalisierung. Ein bloßer Konstantentausch umginge damit
`avesmapsMediaLicenseIsPublic()` und mit ihr genau die Regel „erst normalisieren, dann prüfen", für
die Phase 1 gebaut wurde. **Der Aufruf wird ersetzt, nicht sein Inhalt.**

- [ ] **Schritt 2: Den Test zuerst erweitern**

In `api/_internal/__tests__/coat-resolve-test.php` — die vorhandenen Fälle bleiben, diese kommen dazu:

```php
// ---- Phase 3: das Gate liest den gemeinsamen Katalog ------------------------------------------------
// 🔴 Bis 16.08.2026 liess AVESMAPS_COAT_PUBLIC_LICENSES nur 'public_domain' durch. Die Lockerung ist
// gewollt: die Editoren erzeugen ihre Wappen mit KI, und bei den Siedlungen standen sie mangels Gate
// laengst auf der Karte. Ein selbst erzeugtes Wappen als "nicht gemeinfrei, also weg" zu behandeln
// verwechselt die Herkunft mit der Erlaubnis.
foreach (['public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work'] as $kennung) {
    assert(
        avesmapsResolveGatedCoatUrl([], '/uploads/wappen/x.png', '', $kennung) !== '',
        "{$kennung} muesste durchkommen"
    );
}
foreach (['cc_by', 'unknown_other'] as $kennung) {
    assert(
        avesmapsResolveGatedCoatUrl([], '/uploads/wappen/x.png', '', $kennung) === '',
        "{$kennung} duerfte NICHT durchkommen"
    );
}

// 💣 Unmigrierte Altwerte bleiben still -- vorher wie nachher. Das ist der Grund, warum diese Phase
// bei den TERRITORIEN auch ohne vollstaendige Migration sicher ist (bei den Siedlungen ist sie es
// NICHT, siehe Vorbedingung des Bauplans).
foreach (['attribution_required', 'unknown', ''] as $altwert) {
    assert(
        avesmapsResolveGatedCoatUrl([], '/uploads/wappen/x.png', '', $altwert) === '',
        "Altwert '{$altwert}' duerfte nicht ploetzlich sichtbar werden"
    );
}

// ⚠️ Der leere Override bleibt ein bewusstes "kein Wappen" -- die Lockerung darf ihn nicht aufweichen.
assert(avesmapsResolveGatedCoatUrl(['coat_of_arms_url' => ''], '/uploads/wappen/x.png', '', 'public_domain') === '');
```

Lauf ihn — er muss **rot** werden, bevor du `coat-url.php` anfasst.

- [ ] **Schritt 3: Den Aufruf ersetzen**

In `api/_internal/coat-url.php`: das `require_once` auf `media-license.php` an den Kopf, die
Konstante entfernen, und in `avesmapsResolveGatedCoatUrl` den Vergleich austauschen:

```php
    if ($url === '' || !avesmapsMediaLicenseIsPublic($license)) {
        return '';
    }
```

Den Kommentarblock über der alten Konstante ersetzen durch:

```php
/**
 * 🔴 Bis 16.08.2026 stand hier AVESMAPS_COAT_PUBLIC_LICENSES = ['public_domain'] -- die einzige
 * Lizenz, unter der ein Wappen oeffentlich erscheinen durfte. Seit Phase 3 entscheidet der gemeinsame
 * Katalog (avesmapsMediaLicenseIsPublic), und damit kommen vier weitere Werte durch: cc0,
 * permission_granted, ai_generated, own_work.
 *
 * 💣 Die FUNKTION, nicht eine andere Konstante. Der Vergleich hier lief roh, ohne Normalisierung --
 * eine erweiterte Liste haette den Riegel neben dem Fundament noch einmal aufgebaut und die Regel
 * "erst normalisieren, dann pruefen" umgangen, fuer die Phase 1 ueberhaupt gebaut wurde.
 */
```

⚠️ **Erst prüfen, ob die Konstante noch woanders gelesen wird**, bevor du sie entfernst:

```bash
grep -rn "AVESMAPS_COAT_PUBLIC_LICENSES" api/ js/ tools/
```

Findet der Befehl außer der Definition noch etwas, gehört jede Fundstelle auf die Funktion umgestellt
— oder die Konstante bleibt stehen und wird von der Funktion abgeleitet. Schreib die Ausgabe in den
Bericht.

- [ ] **Schritt 4: Test grün und committen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-resolve-test.php
git add api/_internal/coat-url.php api/_internal/__tests__/coat-resolve-test.php
git commit -m "feat(lizenzen): das Territoriums-Gate liest den Katalog statt einer eigenen Liste"
```

---

## Aufgabe 3: Die Rechtsdokumente

⚠️ **Diese Aufgabe endet mit einem Owner-Blick, nicht mit einem Commit.** Der Wortlaut ist eine
Rechtsauffassung, keine technische Feststellung.

**Dateien:** `NOTICE.md`, `LEGAL.md`

- [ ] **Schritt 1: Den Ist-Zustand feststellen — er ist anders als gedacht**

```bash
grep -n -i "wappen\|coat\|gemeinfrei\|public domain" NOTICE.md LEGAL.md
```

💣 **Befund vom 16.08.2026: `NOTICE.md` sagt über Wappen-Lizenzen GAR NICHTS.** Der Entwurf (§5)
behauptete, dort stünde die alte Regel — das stimmt nicht. Was sie behauptet, ist ein
**Code-Kommentar**: `api/_internal/coat-url.php` schrieb „The only licence under which a coat may
appear on the public map (NOTICE.md / Ulisses fan rules)" und verwies damit auf eine Stelle, die es
nicht gibt.

`NOTICE.md` enthält die Ulisses-Fanrichtlinien („Erlaubnis … nur bis auf Widerruf") und die
Kartenpaket-Lizenz. `LEGAL.md:38/66` sagt, dass Wiki-Dateien ihre eigene Lizenz tragen und **nicht**
unter MIT stehen.

- [ ] **Schritt 2: Den Vorschlag schreiben, nicht committen**

Ein Absatz für `NOTICE.md`, der beschreibt, was künftig gilt — Vorschlag:

> **Bildmaterial auf der Karte.** Wappen, Ortsbilder, Stadtkarten und Cover erscheinen nur unter
> einer von fünf Einstufungen: gemeinfrei, CC0, mit Genehmigung des Urhebers, von uns KI-erzeugt oder
> von uns selbst erstellt. Material unter CC-BY oder mit ungeklärter Herkunft wird im Bestand
> geführt, aber nicht öffentlich angezeigt.

Der Code-Kommentar in `coat-url.php` verweist danach auf einen Absatz, den es wirklich gibt.

🔧 **DU (Owner):** Lies den Absatz, bevor er committet wird. Zwei Punkte, die deine Entscheidung
brauchen:
- Ist „mit Genehmigung des Urhebers" die Formulierung, die du für `permission_granted` willst? Sie
  deckt sowohl die Ulisses-Fanrichtlinien als auch Einzelzusagen ab.
- Soll der Absatz die Einstufungen benennen, oder reicht „nur frei verwendbares Material"? Das
  Genauere ist ehrlicher, bindet dich aber an die Liste.

- [ ] **Schritt 3: Nach Freigabe committen**

```bash
git add NOTICE.md
git commit -m "docs(lizenzen): NOTICE nennt, unter welchen Einstufungen Bildmaterial erscheint"
```

---

## Aufgabe 4: Abschluss

- [ ] **Schritt 1: Die eigene Abhakliste**

- [ ] das Siedlungs-Gate steht **vor** dem Anzeige-Schalter (im Test verankert)
- [ ] kein `edit_mode`-Bypass im Lizenz-Gate
- [ ] das Territoriums-Gate ruft die **Funktion**, nicht eine erweiterte Konstante
- [ ] unmigrierte Altwerte werden nirgends plötzlich sichtbar
- [ ] der leere Override bleibt ein bewusstes „kein Wappen"
- [ ] keine Daten geändert, keine DDL, kein Dialog angefasst

- [ ] **Schritt 2: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
```

Erwartet: nur `api/_internal/linkcheck/__tests__/link-url-test.php` (vorbestehend, echter DNS-Abruf).

- [ ] **Schritt 3: Push**

⚠️ Bricht der Rebase mit „You have unstaged changes" ab, liegt fremde Arbeit im Baum: **nicht**
`--autostash`. Separater Arbeitsbaum, `cherry-pick` der eigenen Commits, dort testen und
`git push origin HEAD:master`. Fremde, noch nicht gepushte Commits werden **nicht** mitgenommen.

- [ ] **Schritt 4: 🔧 DU (Owner): hinsehen**

🔴 **Das ist die einzige besucher-sichtbare Änderung des ganzen Umbaus.** Nach dem Deploy
(~1–2 Minuten) auf der Live-Karte prüfen:

- **Die Wappen sind noch da.** Ein Ort mit KI-erzeugtem Wappen zeigt es weiterhin — das ist die
  Zusicherung „kein Bild wechselt seine Sichtbarkeit", eine Phase weiter getragen.
- **Ein Territorium mit gemeinfreiem Wappen** zeigt es weiterhin (Grafschaft Ferdok ist der Fall aus
  Discord #32 und ein guter Prüfstein).
- **Der Anzeige-Schalter „Wappen: Aus/An"** wirkt noch, und Einschalten holt nichts hervor, was
  vorher nicht da war.

⚠️ Fällt ein Wappen weg, das vorher da war: **melden, nicht selbst suchen.** Der wahrscheinlichste
Grund ist, dass der Anwendungslauf aus Phase 2 diese Zeile nicht erfasst hat — dann ist der Rückbau
ein `git revert` der zwei Commits, und die Zeile gehört in die nächste Migrationsrunde.

---

## Was diese Phase ausdrücklich NICHT tut

- **Keine Daten** werden geändert — kein `UPDATE`, kein Lauf, keine DDL.
- **Kein Dialog** bekommt ein Auswahlfeld, Urheber-Feld oder eine Protokollzeile (Phase 4).
- **Die Erlaubnislisten in `sync-monitor-identity.php`** (`avesmapsWikiSyncMonitorUploadCoat`,
  `avesmapsWikiSyncMonitorApplyCoatsPreview`) bleiben, wie Phase 2 sie hinterlassen hat — sie tragen
  weiterhin `attribution_required` **und** `cc_by` nebeneinander, damit ein Editor mit gecachter
  Seite nicht abgewiesen wird. Sie werden in Phase 4 durch den Katalog ersetzt.
- **Das Inline-JS der zwei Editorseiten** (`html/wiki-sync-monitor.html`,
  `html/wiki-sync-settlement-editor.html`) kennt weiterhin `attribution_required` — Phase 4.
