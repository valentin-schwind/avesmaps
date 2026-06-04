# Asset-Caching & Versionierung (Cache-Busting)

**Ziel:** Endnutzer bekommen nach einem Deploy **sofort** frischen Code – ohne
`Strg+Shift+R` – und gleichzeitig **maximale Performance** (unveränderte Dateien
bleiben clientseitig „für immer" gecacht).

Eingeführt am 2026-06-04 (Commit `6b1700bc`). Diese Datei ist die zentrale
Referenz, wenn neue JS/CSS-Dateien dazukommen oder „meine Änderung kommt nicht an".

---

## 1. Überblick: zwei getrennte Mechanismen

Es gibt **zwei** Cache-Busting-Systeme. Welches greift, hängt davon ab, **wie**
eine Datei geladen wird:

| Lademechanismus | Cache-Busting | Wer pflegt es |
|---|---|---|
| **Direkt in `index.html`** (`<script src>` / `<link href>`) | **Auto** per Content-Hash beim Deploy | niemand – automatisch |
| **Dynamisch vom Editor** (`territory-editor-inline-host.js` lädt Editor-HTML/CSS/JS) | **Manuell** per `ASSET_VERSION` | Entwickler (Konstante hochzählen) |

> Faustregel: Steht die Datei als `<script>`/`<link>` in `index.html`, musst du
> **nichts** tun. Wird sie vom Editor dynamisch nachgeladen, musst du
> `ASSET_VERSION` hochzählen.

---

## 2. Mechanismus A – Auto-Versionierung der `index.html`-Assets

### Wie es funktioniert
1. Beim Deploy (GitHub Action) läuft der Schritt **„Stamp asset versions into
   index.html"**. Er ruft `.github/scripts/stamp-asset-versions.py` auf.
2. Das Skript hängt an **jede** lokale `js/`-, `css/`- oder `assets/`-Referenz in
   `<script>`/`<link>`-Tags von `index.html` ein `?v=<sha1-prefix>` an – berechnet
   aus dem **Inhalt der jeweiligen Datei**.
   - Beispiel: `<script src="js/app/runtime-state.js">`
     → `<script src="js/app/runtime-state.js?v=8c13fa5241">`
3. Der Server (`.htaccess`) liefert Dateien **mit** `?v=` als
   `Cache-Control: public, max-age=31536000, immutable` → Browser cacht sie ein Jahr.
4. `index.html` selbst wird **nie** hart gecacht (`no-cache`) → bei jedem Aufruf
   frisch → die aktuellen `?v=`-Hashes kommen immer an.

### Warum nur geänderte Dateien neu geladen werden
Der Hash kommt aus dem **Dateiinhalt**. Ändert sich `app.js`, ändert sich sein
Hash → neue URL → Browser lädt neu. Alle **unveränderten** Dateien behalten ihren
Hash → gleiche URL → Cache-Treffer. Das ist der Performance-Gewinn.

### Wichtig: `index.html` wird bei JEDEM Deploy neu gestempelt
Auch wenn nur ein Asset (nicht `index.html` selbst) geändert wurde, wird
`index.html` neu gestempelt und mit hochgeladen – sonst zeigte sie auf den alten
Hash. Sie ist winzig und `no-cache`, das kostet nichts.

### Beteiligte Dateien
- `.github/scripts/stamp-asset-versions.py` – das Stamping-Skript (läuft nur in CI,
  wird **nicht** deployt).
- `.github/workflows/deploy-avesmaps-strato.yml` – Schritt „Stamp asset versions
  into index.html".
- `.htaccess` – die Cache-Control-Regeln (siehe unten).
- `index.html` – die **Quelle** bleibt unversioniert; gestempelt wird nur die
  Deploy-Kopie. **Nie** Hashes von Hand in die Quelle schreiben.

---

## 3. Mechanismus B – Editor-Assets (`ASSET_VERSION`)

Der Territoriumseditor lädt sein HTML/CSS/JS **dynamisch** (nicht über
`index.html`). Diese Dateien werden über eine Konstante cache-gebustet:

- Datei: `js/territory/territory-editor-inline-host.js`
- Konstante: `const ASSET_VERSION = "20260604r";` (Datum + Buchstabe hochzählen)
- Sie hängt `?v=ASSET_VERSION` an: das Editor-HTML
  (`/html/political-territory-editor.html`), die Editor-CSS
  (`political-territory-editor-inline.css`, `…-columns.css`) und alle Editor-JS
  (`EDITOR_SCRIPTS`-Liste).

### Wann hochzählen?
**Immer**, wenn du eine vom Editor dynamisch geladene Datei änderst:
- `html/political-territory-editor.html`
- `css/pages/political-territory-editor-inline.css`,
  `css/components/political-territory-editor-columns.css`
- alle JS in der `EDITOR_SCRIPTS`-Liste (z. B. `territory-editor-embedded.js`,
  `territory-editor-inheritance.js`, `territory-derived-geometry-iframe-editor.js`,
  `territory-editor-ui-hints.js`, …)

> `territory-editor-inline-host.js` selbst steht in `index.html` → wird von
> Mechanismus A auto-versioniert. Ein normaler Reload zieht es frisch. Aber die
> davon **dynamisch nachgeladenen** Editor-Assets brauchen weiterhin den
> `ASSET_VERSION`-Bump.

---

## 4. `.htaccess` – Cache-Control-Matrix

Im Root-`.htaccess` (Abschnitt „Caching"), alles via `<IfModule>` abgesichert
(kein Fehler, falls ein Apache-Modul fehlt):

| Ressource | Cache-Control | Begründung |
|---|---|---|
| `*.js` / `*.css` **mit** `?v=…` | `public, max-age=31536000, immutable` | URL ändert sich bei Inhaltsänderung → sicher ewig cachebar |
| `*.js` / `*.css` **ohne** `?v=…` | `no-cache` | sichere Degradierung – nie „für immer stale" |
| `*.html` | `no-cache` | immer frisch, damit aktuelle `?v=`-Hashes ankommen |
| Bilder/Fonts (`png,jpg,gif,webp,svg,ico,woff,woff2,ttf,eot`) | `public, max-age=2592000` (30 Tage) | ändern sich selten |

Technik: `mod_rewrite` setzt bei vorhandenem `?v=` die Env-Variable
`VERSIONED_ASSET`; `mod_headers` schaltet damit zwischen `immutable` und
`no-cache` um (`env=VERSIONED_ASSET` / `env=!VERSIONED_ASSET`).

---

## 5. Kochrezepte

### Ich habe eine bestehende `index.html`-JS/CSS-Datei geändert
Nichts tun. Push → Deploy stempelt automatisch einen neuen Hash → Nutzer bekommen
sie beim nächsten **normalen** Reload.

### Ich habe eine NEUE JS/CSS-Datei hinzugefügt
1. `<script src="js/…">` bzw. `<link href="css/…">` in `index.html` eintragen
   (relativer Pfad unter `js/`, `css/` oder `assets/`, **ohne** `?v=`).
2. Push. Der Deploy stempelt sie automatisch.
3. Sicherstellen, dass die Datei im **Deploy-Paket** ist: liegt sie unter `js/`,
   `css/` oder `assets/`, ist sie automatisch dabei (siehe `deploy_items` im
   Workflow). Andere Top-Level-Ordner müssten dort ergänzt werden.

### Ich habe eine Editor-Datei geändert (dynamisch geladen)
`ASSET_VERSION` in `territory-editor-inline-host.js` hochzählen (z. B.
`20260604r` → `20260604s`). Push.

### Ich habe ein Bild/Font ausgetauscht (gleicher Dateiname)
Wird bis zu 30 Tage gecacht. Für sofortige Wirkung: Datei umbenennen (neuer Name =
neue URL) und Referenz anpassen, **oder** kurzfristig `Strg+Shift+R`.

---

## 6. Troubleshooting

**„Meine Code-Änderung kommt nicht an."**
1. Deploy durch? GitHub Action grün? (Deploy-Latenz ~1–2 min nach Push.)
2. Server-Stand prüfen (cache-buster umgeht den Browser-Cache):
   `curl -s "https://avesmaps.de/<pfad>?cb=$RANDOM" | head`
3. Welcher Mechanismus? Steht die Datei in `index.html`? → sollte Auto-`?v=`
   tragen: `curl -s https://avesmaps.de/?cb=1 | grep -o '<dateiname>?v=[a-f0-9]*'`.
   Dynamisch vom Editor geladen? → `ASSET_VERSION` vergessen hochzuzählen?
4. Header prüfen: `curl -sI "https://avesmaps.de/<pfad>?v=…" | grep -i cache-control`.

**„Eine Datei bleibt für immer stale."**
Sollte nicht passieren: unversionierte `.js/.css` sind `no-cache`. Falls doch, hat
eine `<script>`/`<link>`-Referenz fälschlich eine andere Query oder einen
ungewöhnlichen Pfad. Das Stamp-Skript loggt übersprungene Referenzen als
`warning: referenced asset not found, left unversioned: …`.

**„Stamp-Schritt meldet `missing`."**
Die referenzierte Datei existiert nicht am angegebenen Pfad im Repo. Entweder Pfad
in `index.html` falsch oder Datei fehlt. (Stand 2026-06-04: 2 bekannte tote Pfade,
siehe unten.)

---

## 7. Server-Aufräumen: verwaiste Dateien (Retire-Liste)

Der Deploy spiegelt nur (`mirror` **ohne** `--delete`) – verschobene/gelöschte
Dateien bleiben sonst als Leichen auf dem Server. Ein globales `--delete` ist
gefährlich (würde z. B. die nicht mitgelieferten Tiles löschen). Deshalb gibt es
einen **chirurgischen** Schritt **„Retire orphaned remote files"** im
Deploy-Workflow: eine **explizite Allowliste** von Pfaden, die bei jedem Deploy
per `rm -f` (idempotent) entfernt werden.

Wenn du eine Datei im Repo **verschiebst/umbenennst**, trage den **alten** Pfad in
diese Allowliste ein (`.github/workflows/deploy-avesmaps-strato.yml`, Schritt
„Retire orphaned remote files"), damit die alte Server-Kopie verschwindet.

### Erledigte Altlast (2026-06-04)
Eine halbfertige CSS-Umstrukturierung hatte Dateien in Unterordner verschoben,
aber die `index.html`-Referenzen nie nachgezogen und die alten Server-Kopien nie
gelöscht:
- `css/leaflet.css` → jetzt `css/third-party/leaflet.css` (inhaltsgleich, nur
  Whitespace; verifiziert per Diff → kein optischer Unterschied).
- `css/political-territory-wiki-tree.css` → jetzt
  `css/pages/political-territory-wiki-tree.css` (das vom Editor gepflegte File;
  das auf der öffentlichen Seite gestylte `.tree-wrap` ist unsichtbar/leer →
  ohne optische Wirkung).

Beide alten Pfade stehen in der Retire-Allowliste und wurden serverseitig gelöscht.
`index.html` + `html/political-boundary-diagnostics.html` zeigen jetzt auf die
Repo-Pfade und werden damit normal versioniert.

- `inline-host.js` wird von `index.html` **ohne** `?v=` in der Quelle eingetragen,
  bekommt aber durch das Stamping eine Version. (Historisch war genau das der
  Grund für den ständigen `Strg+Shift+R` – jetzt behoben.)
