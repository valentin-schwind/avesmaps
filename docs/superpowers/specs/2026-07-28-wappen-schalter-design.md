# Wappen-Schalter — global abschaltbare Wappen

**Stand:** 2026-07-28. Gebaut gegen `origin/master` = `0e5cc16a`.
Owner-Auftrag: „global die Wappen der Territorien abschalten (Wappen: AN/AUS im
Territoriumseditor) … Ergänze dasselbe bei den Wappen der Siedlungen … vergleiche das mit dem
Aus-Schalter der Vorschauen in ‚Karten bearbeiten'."

> **Was gebaut wird.** Zwei globale Schalter im Menüband der beiden Editoren, die alle Wappen
> im öffentlichen Frontend durch eine neutrale Platzhalter-Grafik ersetzen. Die Daten bleiben,
> die Editor-Fenster bleiben, der Edit-Mode der Karte bleibt.

## 1. Zwei Schalter, nicht einer

| Setting (`app_setting`) | Knopf | Wirkt auf |
|---|---|---|
| `territory_coats_enabled` | Territorien-Editor, neue Kachel neben „Wappen lokalisieren" | Wappen der Herrschaftsgebiete |
| `settlement_coats_enabled` | Siedlungs-Editor, neue Kachel neben „Bilder: An" | Wappen der Siedlungen |

Beide **Standard AN**, fail-open (fehlende Zeile/Tabelle ⇒ an) — dieselbe Polarität wie
`settlement_images_enabled`, `citymap_previews_enabled`, `adventure_covers_enabled`.

Getrennt, nicht ein gemeinsamer Schalter: dieselbe Begründung, die schon Karten-Vorschauen und
Abenteuer-Cover trennt (`api/_internal/app/citymaps.php`) — ein Schalter, der nach *einer* Fläche
benannt ist, darf nicht zwei Flächen mitreißen.

**„Wappen lokalisieren" bleibt** (Owner-Entscheidung). Es ist gerade nur grau, weil alles lokal
ist; nach jedem Territorien-Sync holt es die neuen gemeinfreien Wappen. Der Toggle kommt daneben.

## 2. Die fünf Flächen

| # | Fläche | Klasse | Payload | Schalter |
|---|---|---|---|---|
| 1 | Kartenlabel eines Gebiets | `.region-label__coat` | Politik-Layer (`label_coat_of_arms_url`) | Territorien |
| 2 | Gebiets-Infobox im Infopanel | `.region-info-box__coat` | `territory-detail.php` (`coat.url`) | Territorien |
| 3 | Kompakt-Tooltip beim Überfahren | `.region-compact-tooltip__coat` | Politik-Layer (`coat_of_arms_url`) | Territorien |
| 4 | „Liegt in"-Treppe im Siedlungs-Popup/Infopanel | `.location-popup__breadcrumb-coat` | `map-features.php` (`coat_url`) | Territorien |
| 5 | Siedlungskopf in Popup + Infopanel | `.location-popup__icon--coat` | `map-features.php` (`properties.coat`) | Siedlungen |

## 3. Der Aus-Zustand

**1–4: Platzhalter.** `img/wappen.png` (leerer Schild, 500×500, transparent) tritt an die exakte
Stelle des Wappens. Ersetzt wird **serverseitig die URL** — nicht das Markup. Damit bleibt jede
Layout-Entscheidung des Frontends unverändert: dieselbe `<img>`, dieselbe Klasse, dieselbe
zoom-abhängige Größe am Kartenlabel, dieselbe `has-coat`-Klasse in der Infobox. Das Frontend
braucht **keine einzige Änderung** und kann den Zustand nicht falsch raten.

**5: das Siedlungs-Icon kehrt zurück.** Dort *ersetzt* das Wappen heute das Siedlungs-Icon
(`popups.js:187`). Ein leerer Schild würde Information wegnehmen statt nur das Wappen; also fällt
der Kopf auf sein normales Icon zurück — volle Auflösung, gleiche Box. (Owner informiert, Entwurf
so abgenommen.)

**Ein Gebiet ohne Wappen bleibt ohne Wappen.** Ersetzt wird nur eine URL, die *da war* —
`'' → ''`. Sonst bekäme die Karte Hunderte Schilde, wo heute nichts steht.

## 4. Wo geblendet wird

Serverseitig, wie bei `settlement_images_enabled` — die URL verlässt den Server gar nicht erst.

- `api/_internal/political/territories-layer.php` — ein Durchlauf über die fertigen Features,
  `coat_of_arms_url` + `label_coat_of_arms_url` (Flächen 1 + 3).
- `api/app/territory-detail.php` — `coat.url` (Fläche 2).
- `api/app/map-features.php` — Breadcrumb-`coat_url` (Fläche 4) und `properties.coat` (Fläche 5).

Die **Editor-Fenster** lesen `api/edit/wiki/sync-monitor.php` bzw. `…/settlements.php` und sind
nicht betroffen — das Wappen in der rechten Spalte des Territorien-Editors bleibt sichtbar.

## 5. Edit-Mode behält die echten Wappen

Owner: „nicht im editmode, nur im frontend".

Der Politik-Layer schickt `edit_mode` heute schon mit (`map-features-political-territory-loader.js:673`).
**`map-features.php` bekam es nicht** — die Annahme, es reise „in beiden Kartenanfragen" mit, war falsch;
`map-features.js:105` ist der Politik-Layer-Prefetch, nicht der Kartenabruf. Der Kartenabruf
(`routing.js:145`) rief die Nutzlast ganz ohne Parameter ab. Er hängt jetzt `edit_mode=1` an, wenn
`IS_EDIT_MODE` gilt, ebenso die Delta-Schleife der Live-Aktualisierung (`routing.js:233`), die ohnehin
nur im Edit-Modus läuft.

- Politik-Layer: `$isEditMode` ist dort bereits gelesen, und der Datei-Cache ist **schon nach
  `edit_mode` geschlüsselt** (`territories-derived-layer.php:20`) — keine Cache-Vergiftung.
- `map-features.php`: `edit_mode` wird gelesen **und in den ETag-Seed aufgenommen**. Ohne das
  bekäme ein Browser, der die öffentliche Nutzlast gecacht hat, im Edit-Mode ein 304 mit
  Platzhaltern.
- `territory-detail.php`: die zwei Fetches in `map-features-infopanel.js` hängen `edit_mode=1`
  an, wenn `IS_EDIT_MODE` gilt — sonst zeigte das Label das echte Wappen und die Infobox daneben
  den Schild.

Das ist der einzige Punkt, an dem der Wappen-Schalter vom Bilder-Schalter abweicht (der kennt
keine Ausnahme).

## 6. Caches

Ein Umlegen des Schalters ändert die Nutzlast, ohne dass irgendwo eine Revision steigt. Also:

- **`map_revision` hochzählen** (`avesmapsWikiSyncNextMapRevision`) — bricht den ETag von
  `map-features.php`. Genau das tut der Bilder-Schalter schon.
- **Politik-Layer-Cache leeren** (`avesmapsPoliticalInvalidateLayerCache`) — die Datei-Caches
  halten sonst bis zu 300 s die alten Wappen-URLs.
- `territory-detail.php` hat keinen Cache.

## 7. Endpunkte und Knöpfe

| | Territorien | Siedlungen |
|---|---|---|
| POST-Action | `set_territory_coats_enabled` in `api/edit/wiki/sync-monitor.php` | `set_coats_enabled` in `api/edit/wiki/settlements.php` |
| Zustand beim Laden | im `status`-Payload | im Status-Payload (neben `images_enabled`) |
| Kachel | `#btnCoatsToggle`, `html/wiki-sync-monitor.html` | `#seCoatsToggle`, `html/wiki-sync-settlement-editor.html` |

Beschriftung wie der Bilder-Schalter: `t1` = „Wappen: An" / „Wappen: Aus", `t2` = „im Frontend",
`aria-pressed` gesetzt. Beide Editor-Fenster werden mit `?v=Date.now()` geladen — **kein**
`ASSET_VERSION`-Bump nötig.

## 8. Neu: `api/_internal/app/coat-display.php`

Ein Ort für beide Schlüssel, den Platzhalter-Pfad und die Ersetzung:

```php
const AVESMAPS_TERRITORY_COATS_SETTING   = 'territory_coats_enabled';
const AVESMAPS_SETTLEMENT_COATS_SETTING  = 'settlement_coats_enabled';
const AVESMAPS_COAT_PLACEHOLDER_URL      = '/img/wappen.png';

avesmapsCoatSwitchEnabledFast(PDO, string $key): bool   // roher SELECT, fail-open, KEIN DDL
avesmapsCoatDisplayUrl(string $url, bool $enabled): string
```

`…Fast` statt `avesmapsAppSettingGet`, weil der Getter bei jedem Lesen ein
`CREATE TABLE IF NOT EXISTS` absetzt — auf dem heißen `map-features`-Pfad ist DDL tabu
(dieselbe Begründung steht schon über `avesmapsMapFeaturesSettlementImagesEnabled`). Die
Editor-Endpunkte lesen/schreiben weiter über `app-setting.php` (selbstheilend).

## 9. Prüfung

- Unit-Test `api/_internal/app/__tests__/coat-display-test.php`: `'' → ''`, an ⇒ unverändert,
  aus ⇒ Platzhalter, und der Feature-Durchlauf des Politik-Layers.
- Live auf localhost: Schalter aus ⇒ Kartenlabel und Infopanel zeigen den Schild, der
  Siedlungskopf sein Icon; `?edit=1` zeigt weiter die echten Wappen; Schalter an ⇒ alles zurück.

## 10. Nicht Teil davon

- Kein Wappen wird gelöscht, keine Lizenz neu bewertet — der `public_domain`-Gate in
  `api/_internal/coat-url.php` bleibt unangetastet und läuft **vor** diesem Schalter.
- `api/app/coat.php` (Proxy) bleibt unverändert; ohne externe URL fragt ihn niemand.
- `html/editor-handbuch.html` wird **nicht** angefasst (Nachtroutine, AGENTS.md §9) — die
  Commit-Betreffs benennen die sichtbare Wirkung.
