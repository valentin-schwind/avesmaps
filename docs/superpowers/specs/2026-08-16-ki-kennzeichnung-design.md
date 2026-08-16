# KI-Kennzeichnung im Social-Media-Hub — Entwurf

**Stand:** 16.08.2026 · **Owner-Befund:** „unser posting hatte KI-label: off, soll aber on sein"
· **Owner-Auftrag:** „ich will eine checkbox im social media hub, die das KI-Label durchpiped"
· **Owner-Entscheid:** das Häkchen ist **vorgehakt**.

Verwandt: AGENTS.md §11 (Social-Media-Hub), `docs/superpowers/specs/2026-08-10-social-media-hub-design.md`.

---

## 1. Was gebaut wird, in einem Satz

Ein Häkchen im Hub erklärt einen Beitrag als KI-erstellt; die Erklärung reist mit dem Beitrag bis in
die Anfrage an das Netz — bei den zwei Netzen, die so etwas überhaupt entgegennehmen.

---

## 2. Was die Netze können — gemessen, nicht vermutet (16.08.2026)

| Kanal | Feld | Quelle |
|---|---|---|
| Facebook **mit Bild** (`/photos`) | `provenance_info` (JSON, Pflicht: `is_gen_ai`, `provenance_type`) | `developers.facebook.com/docs/graph-api/reference/page/photos/` |
| Facebook **ohne Bild** (`/feed`) | **keins** | Parameterliste von `/feed` kennt es nicht |
| Instagram (`/media`, Schritt 1) | `is_ai_generated` (bool) | `…/instagram-api-with-facebook-login/content-publishing/` |
| Mastodon (`POST /api/v1/statuses`) | **keins** | `docs.joinmastodon.org/methods/statuses/` |
| Neuigkeiten (`changelog_entry`) | entfällt — eigene Datenbank, kein fremdes Netz | — |

### 💣 Facebook kann NUR Beiträge mit Bild kennzeichnen

`/feed` nimmt die Felder nicht an. Ein reiner Textbeitrag geht auf Facebook also **ohne**
KI-Kennzeichnung raus, egal was das Häkchen sagt. Das ist keine Lücke im Code — sie ist bei Meta.

⚠️ Daraus folgt die einzige Stelle, an der dieses Feature laut werden muss: wer anhakt, Facebook
wählt und **kein Bild** dranhängt, bekommt heute wortlos einen unbeschrifteten Beitrag. Deshalb §4.2.

⚠️ Und es trifft die **Routine** vollständig: `routine-post.php` setzt nie ein `media_url`
(AGENTS.md §11), ihre Vorschläge landen also immer auf `/feed`. Für sie ist das Häkchen heute
wirkungslos — kein Grund, es ihr zu verweigern, aber ein Grund, es nicht als gelöst zu verbuchen.

### 🔴 Der Typ ist `EXPLICIT`, nicht einer der drei aus der Vorlage

Die Enum hat 27 Werte. `EXPLICIT_AI_EDIT`, `EXPLICIT_AI_EXPANDER` und `EXPLICIT_RESTYLE` benennen
**konkrete Meta-Werkzeuge**, die wir nicht benutzt haben — sie zu behaupten wäre eine Falschangabe in
die andere Richtung. `EXPLICIT` heißt „der Absender hat es selbst erklärt", und genau das ist ein
Häkchen. Vollständige Liste, falls sie je gebraucht wird: `C2PA, IPTC, EXPLICIT,
INVISIBLE_WATERMARK, C2PA_METADATA_EDITED, IPTC_METADATA_EDITED, EXPLICIT_IMAGINE,
EXPLICIT_IMAGINE_ME, EXPLICIT_RESTYLE, EXPLICIT_ANIMATE, EXPLICIT_FACE_SWAP, EXPLICIT_WARDROBE,
EXPLICIT_DROP_IN, EXPLICIT_AI_EDIT, EXPLICIT_AI_EXPANDER, EXPLICIT_AI_CUT, EXPLICIT_AI_TRANSITION,
EXPLICIT_MAGIC_CUT, EXPLICIT_CLIPGEN, EXPLICIT_AI_V2V_RESTYLE, EXPLICIT_RESTYLE_EFFECTS_MERGE,
EXPLICIT_SUBJECT_EFFECT, EXPLICIT_CUTOUT, EXPLICIT_AI_REWRITE_WITH_META_AI_INTENT,
EXPLICIT_AI_EDIT_PRESETS_SHEET, NONE`.

### 🔴 Kein `provenance_metadata`

Das zweite Feld trägt `c2pa_metadata` / `iptc_metadata` — Listen aus der **Bilddatei selbst**. Wir
haben keine: unsere Bild-Pipeline (`media.php`) schreibt JPEG neu und trägt keine Provenienzdaten
ein. Ein leeres Objekt mitzuschicken wäre Rauschen, das aussieht wie eine Angabe.

### 💣 Und noch eine Meta-Asymmetrie

Facebook: `provenance_info`, ein JSON-Objekt, zwei Pflichtfelder. Instagram: `is_ai_generated`, ein
Bool. Dasselbe Haus, dasselbe Graph, dieselbe Anfrage-Bauart — zwei Schreibweisen. Sie reiht sich
ein neben `url` vs. `image_url` und `caption` vs. `message` (AGENTS.md §11). Wer eine der beiden
Funktionen von der anderen abschreibt, baut ein Feld ein, das das Netz still verwirft.

---

## 3. Was NICHT gebaut wird

- **Kein `is_gen_ai: false`.** Ohne Häkchen wird **gar nichts** geschickt. Die Abwesenheit ist die
  Aussage; eine ausdrückliche Verneinung wäre eine Behauptung über Inhalte, die niemand geprüft hat.
- **Kein `privacy`, kein `published`** dazu. Die Regel aus AGENTS.md §11 bleibt: der Beitrag erbt die
  Zielgruppe der Seite, und dieses Feature ist kein Anlass, daran zu rühren.
- **Kein Nachtragen an veröffentlichte Beiträge.** Was draußen steht, steht draußen.
- **Keine Kennzeichnung im Text** („🤖 KI-generiert" o. ä.). Das wäre eine zweite, konkurrierende
  Wahrheit neben der, die das Netz selbst rendert — und sie zählte zum Zeichenlimit.

---

## 4. Oberfläche

### 4.1 Das Häkchen

Eine Zeile am Ende der linken Spalte, unter „Herkunft und Rechte":

> ☑ **Mit KI erstellt**
> *Facebook und Instagram zeigen daraufhin ihren KI-Hinweis am Bild. Mastodon und Neuigkeiten
> kennen keinen.*

**Vorgehakt** (Owner 16.08.2026). Begründung: der Anlass des ganzen Features war ein Beitrag, der
unbeabsichtigt ohne Kennzeichnung rausging. Zu viel gekennzeichnet ist harmlos, zu wenig nicht.

⚠️ Bauform: `.social-hub__check` wird der bestehenden Regel `.social-hub__radio` **beigestellt**
(gleiche Zeile im Selektor), nicht abgeschrieben. Die Regel ist trotz ihres Namens nicht
radio-spezifisch — sie beschreibt „Eingabefeld + fette Zeile + kleine Zeile darunter".
Vgl. AGENTS.md §11, „Die Listenzeile — es gibt ZWEI, und das ist die Obergrenze".

### 4.2 💣 Die Warnung, die nur auftaucht, wenn sie muss

Häkchen gesetzt **und** Facebook angehakt **und** kein Bild dran:

> Facebook kann den Hinweis nur an einem Bild anbringen — ohne Bild geht der Beitrag dort ohne
> KI-Kennzeichnung raus.

Ohne diesen Satz hakt jemand an, drückt, und glaubt, es sei gekennzeichnet. **Das ist der einzige
stille Fehlschlag, den dieses Feature erzeugen kann**, und er ist die eigentliche Arbeit hier — die
drei Zeilen im Adapter sind der leichte Teil.

⚠️ Sie sperrt nichts. Ein unbebilderter Facebook-Beitrag ist völlig zulässig; er ist nur nicht
kennzeichenbar.

### 4.3 Woher der Client weiß, welcher Kanal es kann

Ein Feld **`ai_label`** im Register (`channels.php`), neben `shows_media`. Dieselbe Begründung, die
dort schon steht: sonst kennt der Browser eine Zuordnung, die der Server nicht kennt, und der nächste
Kanal bekommt seine an einer zweiten Stelle — oder gar nicht.

⚠️ `channels-test.php` nagelt die Schlüsselliste fest, die zum Client reist. Der Test zieht mit; das
ist Absicht und kein Hindernis (er existiert, damit ein neues Feld nicht unbemerkt hinausreist).

---

## 5. Speicherung

Neue Spalte an `social_post`:

```sql
ai_declared TINYINT(1) NOT NULL DEFAULT 0
```

💣 **Eigene Bedingung beim Nachrüsten**, nicht die von `title` oder `media_alt` mitbenutzt. Die Falle
steht wörtlich in `store.php`: ein Bestand, der `title` schon hat, überspränge bei einer gemeinsamen
Bedingung auch diese Spalte — und das fällt erst beim ersten Schreibvorgang auf, als SQL-Fehler.

💣 **Sie reist in `list.php` mit.** Ohne das verlöre ein Entwurf beim zweiten Speichern still sein
Häkchen — genau die Begründung, die dort schon für `media_source` und `media_alt` steht.

⚠️ `avesmapsSocialUpdateProposal` muss sie in seinem `SET` führen. Ein Entwurf, dessen Häkchen sich
nicht mehr **abhaken** lässt, wäre schlimmer als keins.

---

## 6. Der Weg durch den Code

```
Hub (index.html + review-social.js)
  → POST /api/edit/social/publish.php      { ai_declared: true }
    → avesmapsSocialCreatePost / …UpdateProposal   (Spalte)
      → avesmapsSocialDispatch  ($post trägt die Spalte bereits)
        → avesmapsSocialAdapterFacebook   → avesmapsSocialFacebookRequest(…, $aiDeclared)
        → avesmapsSocialAdapterInstagram  → avesmapsSocialInstagramContainerRequest(…, $aiDeclared)
        → avesmapsSocialAdapterProbe      → payload
```

⭐ **Keine Signaturänderung in der Kette.** Die Adapter bekommen `$post` ohnehin vollständig; die
Spalte steht dort ohne Zutun. Nur die beiden **reinen** Bau-Funktionen bekommen je ein Argument —
und genau die sind die testbaren Hälften.

🔴 Die Felder gehören in `avesmapsSocialFacebookRequest()` bzw.
`avesmapsSocialInstagramContainerRequest()`, **nicht** in den curl-Aufruf. Der Token kommt erst dort
dazu; das bleibt so (AGENTS.md §11: Token nie in die Adresse, und die reine Hälfte ist die, die sich
ohne Seite prüfen lässt).

---

## 7. Der Probe-Kanal

Der Kasten „Was gesendet worden wäre" bekommt `ai_declared` in den Merkzettel. Sonst lässt sich der
einzige Weg, der ohne öffentlichen Beitrag prüfbar ist, für dieses Feature **nicht** proben — und die
Probe ist laut Entwurf §10 genau dafür da.

---

## 8. Tests

| Datei | Zusicherung |
|---|---|
| `publish-test.php` | `/photos` **mit** Häkchen trägt `provenance_info` mit `is_gen_ai:true` + `provenance_type:EXPLICIT` · **ohne** Häkchen trägt es das Feld **gar nicht** (kein `false`) · `/feed` trägt es **nie**, auch mit Häkchen · kein `provenance_metadata` |
| `instagram-adapter-test.php` | `is_ai_generated` steht am **Behälter**, nicht am Veröffentlichen-Schritt · ohne Häkchen fehlt es |
| `channels-test.php` | `ai_label` reist mit; Facebook/Instagram `true`, der Rest `false` |
| `store-test.php` | die Spalte ist an **allen vier** Stellen verdrahtet (CREATE · ALTER · INSERT · UPDATE-SET), und die Nachrüstung hat eine **eigene** Bedingung |

⚠️ **Der `store-test`-Eintrag ist eine VERDRAHTUNGS-, keine Verhaltensprüfung, und gibt sich auch
nicht als eine aus.** Die DDL ist MySQL (InnoDB, `DATETIME(3)`), der Test läuft auf sqlite, und ob
eine Spalte einen Neustart überlebt, entscheidet sich live. Geprüft wird stattdessen die Fehlerklasse,
die dieses Projekt zweimal teuer bezahlt hat (AGENTS.md §11, „vier Erzeuger"): eine Angabe, die nur an
drei der vier nötigen Stellen steht. 💣 Besonders die vierte — ohne `ai_declared` im `UPDATE … SET`
ließe sich das Häkchen setzen, aber nie wieder abhaken, und das fiele niemandem auf, weil das Formular
es beim nächsten Öffnen brav wieder anzeigt.

⚠️ Die in der Aufgabenstellung genannte Datei `facebook-adapter-test.php` **existiert nicht** — die
Facebook-Zusicherungen stehen in `publish-test.php`. Dort kommen die neuen hin, statt eine zweite
Heimat für dieselbe Datei aufzumachen.

---

## 9. Abnahme

1. **Testfeld komplett** (AGENTS.md §9) — JS, PHP mit `mbstring`/`pdo_sqlite`/`gd`, **und** die
   `tools/wikidump/test-*.php`, die das dokumentierte Muster nicht findet.
2. Echter Beitrag **mit Bild** über den Hub, angemeldet am Beitrag nachsehen.

🔴 **Die öffentliche Verifikation ist blockiert und das ist keine Codefrage.** Die Meta-App
(`1037557352198584`) steht auf „unveröffentlicht"; per API erzeugte Beiträge sind für Fremde
unsichtbar (ausgeloggt gemessen 16.08.2026). Solange das gilt, lässt sich nur prüfen, dass die
Anfrage angenommen wurde und was der Betreiber selbst sieht — **nicht**, was ein Fremder sieht.
Das Veröffentlichen der App verlangt Datenschutz-URL und Kategorie und ist eine **Owner-Entscheidung**;
diese Sitzung fasst die App-Einstellungen nicht an.

⚠️ **Und die ehrliche Grenze des Ganzen:** wir schicken die Erklärung ab. Ob und wie Meta daraus ein
sichtbares Kennzeichen macht, entscheidet Meta. Ein ausbleibendes Label ist nicht zwingend ein Fehler
bei uns — die prüfbare Zusicherung ist „die Felder gehen mit der Anfrage raus und werden angenommen".
