# Was auf den Server gehört, nicht ins Repository

Stand 06.08.2026. Alles hier verlangt eine Hand am Server — nichts davon kann der Deploy
ausliefern, und das ist jeweils Absicht.

**Reihenfolge nach Nutzen:** 1 ist eine eingelöste Datenschutz-Zusage, 2 und 3 sind Komfort und
Konsequenz. 4 ist eine Warnung.

---

## 1 · `api/config.local.php` — der Besucher-Salt ✅ empfohlen

**Befund A23.** Die Datenschutzerklärung sagt, die Besucherkennung sei nicht rückführbar. Der Wert,
mit dem sie gebildet wird, steht bis dahin im öffentlichen Quelltext — ein gespeicherter Hash deckt
eine IP-Adresse plus Browserkennung ab, und der IPv4-Raum ist klein genug, um ihn in Sekunden
durchzuprobieren.

Einzutragen neben `import_api`:

```php
'analytics' => [
    'visitor_salt' => 'HIER-DEN-ERZEUGTEN-WERT-EINSETZEN',
],
```

Den Wert selbst erzeugen (er darf nirgends stehen, wo er mitgelesen wird — auch nicht in einem
Chatverlauf):

```
php -r "echo bin2hex(random_bytes(32)), \"\n\";"
```

⚠️ **Der Preis, einmalig:** ab diesem Moment zählt jeder wiederkehrende Besucher **einmal** als neu.
Die Tageszahlen springen an dem Tag nach oben, danach ist es normal. Je früher gesetzt, desto
kleiner der Sprung.

**Danach prüfbar:** die Kennzahlen-Antwort meldet `salt_configured` (sichtbar für Bearbeiter, für
sonst niemanden). Die Vorlage kennt den Eintrag seit `01b76b7e`, `api/README.md` erklärt ihn.

---

## 2 · `.htaccess` (Wurzel) — kurze Adresse fürs Impressum ⭕ optional

**Befund A24.** Die Seite liegt unter `avesmaps.de/html/impressum.html`. Hübscher wäre
`avesmaps.de/impressum`.

In den vorhandenen Block `<IfModule mod_rewrite.c>`, **nach** der HTTPS-Umleitung und **vor** der
`VERSIONED_ASSET`-Zeile:

```apache
    # Kurze Adresse fuers Impressum (Befund A24). 301, nicht intern umgeschrieben: so bleibt
    # /html/impressum.html die EINE kanonische Adresse -- dieselbe, die in sitemap.xml und im
    # <link rel="canonical"> der Seite steht. Kein Loop moeglich, das Ziel trifft ^impressum/?$ nicht.
    RewriteRule ^impressum/?$ /html/impressum.html [R=301,L]
```

🔴 **Das ist die riskanteste der vier.** Ein Tippfehler in der Wurzel-`.htaccess` ist eine **500 für
die ganze Seite**, und erproben lässt sie sich vorher nicht — genau so ist der Versuch bei A34
ausgegangen (`DeflateAlterETag`, zurückgenommen in `fdd4fc42`). Die Regel selbst ist unbedenklich:
`RewriteRule` steht in dieser Datei bereits dreimal, ist also nachweislich erlaubt.

**Direkt nach dem Speichern prüfen** — erst die Startseite, dann die neue Adresse:

```
curl -s -o /dev/null -w "%{http_code}\n" https://avesmaps.de/
```

Antwortet das **nicht** 200, die Zeile sofort wieder herausnehmen.

---

## 3 · `uploads/map/.htaccess` — das Kartenarchiv zumachen ⭕ optional

**Befund A25.** Die Links sind seit `57f2dc92` aus dem Hinweise-Fenster raus. **Die Dateien liegen
weiter da:** gemessen am 06.08.2026 antwortet `uploads/map/avesmaps_aventurien_tiles_v2.05.zip` mit
**HTTP 200 und 168.647.049 Bytes**. Wer die Adresse kennt oder im Verlauf hat, lädt weiter.

Der Deploy löscht nie, und `uploads/` steht nicht einmal in seiner Liste — diese Datei kann also
**nur von Hand** dorthin, per FTP oder Dateimanager:

```apache
# Das Kartenmaterial wird seit 06.08.2026 nicht mehr als Archiv angeboten (Befund A25).
# Gilt NUR fuer diesen Ordner -- in uploads/ liegen Wappen und Kartenvorschauen, die die
# oeffentliche Karte braucht. Ein Riegel eine Ebene hoeher nimmt der Karte ihre Bilder.
<FilesMatch "\.(?:zip|7z|rar|tar|gz)$">
    Require all denied
</FilesMatch>
```

⚠️ **Nur in `uploads/map/`, niemals in `uploads/`.** Der Unterschied ist der zwischen „zwei Archive
gesperrt" und „die Karte hat keine Wappen mehr".

✅ **Deutlich harmloser als 2:** ein Fehler darin trifft **diesen einen Ordner**, nicht die Seite.
Geprüft mit `Apache/2.4.68` — `Require all denied` ist die Schreibweise für 2.4.

**Danach prüfen** (erwartet: 403):

```
curl -s -o /dev/null -w "%{http_code}\n" https://avesmaps.de/uploads/map/avesmaps_aventurien_tiles_v2.05.zip
```

---

## 4 · 🔴 Was NICHT in eine `.htaccess` gehört

**Befund A34.** Kein Endpunkt liefert je einen `ETag` aus — `mod_deflate` entfernt den Kopf. Die
naheliegende Reparatur ist:

```apache
DeflateAlterETag NoChange     # ⛔ NICHT EINTRAGEN
```

Diese Direktive ist in einer `.htaccess` **nicht erlaubt**. Der Versuch am 05.08.2026 warf
Apache-500 auf **alles** und wurde in `fdd4fc42` zurückgenommen. Für A34 ist ein Weg **ganz ohne
Serverkonfiguration** gemessen; der steht im Befund.

---

## Was hier NICHT steht

- **A29** (sitzt ein Zwischenserver davor?) ist keine Konfigurationsfrage, sondern eine
  Tatsachenfrage. Beantwortet wird sie durch eine Auskunft von STRATO oder durch eine kleine, nur
  für Admins lesbare Diagnose — Owner-Entscheid 06.08.2026: die Diagnose wird gebaut.
- Datenbank-Korrekturen liegen unter `sql/`, nicht hier.
