# Startladen: Schleier, Windrose und die rechte Kante

**Stand:** 19.08.2026 · **Mockup:** `docs/startladen-mockup.html`

## 1. Anlass

Owner, wörtlich:

> „wir wollen einen ladebalken solange der routerplaner noch nicht aktiv ist ist, sollen die
> kacheln im hintergrund leicht weiß erscheinen während im vordergrund zentriert mittig ein
> ladebalkenzirkel erscheint bis die labels geladen und die routenplanung verfügbar ist, der
> jetztige schmale streifen oben soll bleioben"
>
> „bei der gelegenheit sollen info bzw. editor panel ebenfalls rechts versteckt bleiben und nach
> links ausklappen sobald geladen ist"

Der Startlauf ist heute halb gebaut: der Streifen oben läuft, der Knopfbund und der Zoom warten,
der Routenplaner fährt von links herein (alles 12.08.2026). Was fehlt, ist die **Mitte** — dort
passiert sichtbar nichts, während die Karte lädt — und die **rechte Kante**, die als einzige
Bedienfläche unverändert dasteht, während links alles wartet.

## 2. Entscheidungen des Owners

| Frage | Entscheid |
|---|---|
| Form des Kreises | **drehender Bogen**, kein Fortschrittsring — wir kennen den echten Fortschritt nicht |
| Aussehen | **Windrose** (aus vier vorgelegten Fassungen: schlichter Bogen · Windrose · Astrolabium · Wagenrad) — „die windrose ist schön" |
| Text darunter | **ja**, „Karte wird geladen …" |
| Bedienung während des Ladens | **Schleier lässt durch** (`pointer-events: none`), Schieben und Zoomen gehen wie heute |

## 3. Wo alles hängt — und warum es keinen neuen Zustand gibt

🔴 **Beides hängt an der schon vorhandenen Klasse `avesmaps-booting` auf `<html>`.** Sie wird in
`js/app/loading-bar.js` gesetzt und fällt in `bootBeenden()` — beim Ereignis `avesmaps:map-ready`
oder spätestens nach 20 Sekunden durch das Sicherheitsnetz. Das ist exakt der vom Owner benannte
Zeitpunkt: `map-ready` feuert am Ende des Routendaten-`.finally()` in `js/routing/routing.js`, also
wenn Labels stehen und die Routenplanung bedienbar ist.

💣 **Kein zweiter Zuhörer auf `avesmaps:map-ready`.** Der Vermerk steht schon in `loading-bar.js`:
das Ereignis kann feuern, **bevor** ein später geladenes Skript überhaupt parst — ein zweiter
Zuhörer verpasst es und lässt seinen Teil für immer stehen. Es gibt genau eine Stelle, die den
Startlauf beendet, und sie trägt jetzt vier Dinge statt drei.

## 4. Teil 1 — Der Schleier

**Was:** eine feste Fläche über der ganzen Karte, `position: fixed; inset: 0`, gebaut von
`loading-bar.js` neben dem Balken (dieselbe Datei, die weiß, wann der Start vorbei ist).

- `pointer-events: none` — Owner-Entscheid. Der Schleier ist rein optisch.
- Ein- und Ausblenden über `opacity` + `visibility`, **nie `display: none`** — sonst gibt es kein
  Ausblenden, nur ein Verschwinden.
- 💣 **`z-index` unter dem Streifen oben.** Der Balken steht auf `2000000`. Läge der Schleier
  darüber, verdeckte er genau das, was laut Auftrag bleiben soll. Der Schleier bekommt `1999000`.
- 🔴 **Im dunklen Thema ist er NICHT weiß.** „leicht weiß" beschreibt das helle Thema; ein weißer
  Schleier über der dunklen Karte ist ein Blitz. Der Wert ist ein Token und kippt im
  `:root[data-theme="dark"]`-Block mit.

## 5. Teil 2 — Die Windrose

Eine Inline-SVG in der Mitte des Schleiers, darunter der Text.

🔴 **Die Rose steht still, das Gold wandert.** Eine kreiselnde Kompassrose liest sich als „verirrt",
nicht als „lädt". Bewegt wird ein goldenes Stück auf dem Außenring — wie ein Sonnenschatten. Es ist
zugleich das einzige animierte Element: **eine** Keyframe-Regel (`rotate(360deg)`), sonst nichts.

Aufbau (viewBox `0 0 100 100`):

- Außenring `r=46`, dünn, in `--color-boot-ring-track`
- Teilstrichkranz `r=40` als gestrichelter Ring, 24 Striche — die Strichlänge ist **aus dem Umfang
  gerechnet** (2·π·40 = 251,3 ÷ 24 = 10,47), keine geratene Zahl
- acht Zacken, je zwei Hälften: hell (`--color-boot-ring-pale`) und dunkel
  (`--color-boot-ring-ink`) — die Seekarten-Optik; vier lange (N/O/S/W), vier kurze (diagonal)
- goldener Mittelpunkt
- das laufende Stück: derselbe Ring `r=46`, `stroke-dasharray="48 241"` (≈ 17 % des Umfangs),
  `class="bt-spin"`, 1,5 s linear

💣 **`transform-box: fill-box` ist tragend.** Ohne sie ist der Bezugspunkt einer Drehung bei einem
SVG-Teilelement der ganze Zeichenbereich — das goldene Stück liefe dann auf einer Kreisbahn um die
Rose herum, statt sich an Ort und Stelle zu drehen.

⚠️ **`prefers-reduced-motion`:** die Drehung wird durch ein langsames Auf- und Abblenden ersetzt
(1,8 s). Ein völlig stehender Kreis sagt nichts; eine Blende ist keine vestibuläre Bewegung.

### Der Text

`data-i18n="boot.loading"`, deutsche Vorgabe „Karte wird geladen …", englischer Wert in
`js/app/i18n-en.js`.

💣 **Das Merkmal gehört an ein Element, das NUR den Text enthält** — der Übersetzer setzt
`el.textContent = v` und räumte sonst die SVG daneben mit weg. Dieselbe Falle steht schon zweimal in
`index.html` vermerkt.

⚠️ **Bekannte kleine Lücke, bewusst:** `loading-bar.js` läuft in Zeile 247, `js/app/i18n.js` erst in
Zeile 3003 — `window.tr` gibt es zur Bauzeit des Knotens nicht. Der Text steht deshalb deutsch im
Knoten und wird vom Durchlauf des Übersetzers nachgezogen, sobald dieser lädt. Unter `?lang=en`
sieht ein Besucher den Satz auf einem kalten Ladevorgang also kurz deutsch. Die Alternative wäre
eine **zweite** Spracherkennung in `loading-bar.js` — und dass es davon nur eine gibt, ist mehr
wert als diese Sekunde. 🔧 Sauber lösen ließe sich das in M8, wenn die i18n-Schicht ohnehin
angefasst wird.

## 6. Teil 3 — Die rechte Kante fährt herein

Spiegelbildlich zum Planer: Startstellung draußen rechts, beim Ende des Startlaufs gleiten die
Flächen nach links auf ihren Platz. Gleiche 0,22 s wie überall sonst in dieser Ecke.

Betroffen sind vier Dinge: die Info-Lasche (`.avesmaps-infopanel__handle`), die Editor-Lasche
(`#review-panel-toggle`, nur im Edit-Modus) und die beiden Panels dahinter.

💣 **Der Editor-Tab trägt schon `transform: rotate(180deg)`.** Ein `translateX` daneben *ersetzt*
die Drehung — die Beschriftung stünde kopf. Und weil nach der Drehung die eigene x-Achse nach
**links** zeigt, muss es `rotate(180deg) translateX(-100%)` heißen. Ein `+` schöbe die Lasche über
die Karte statt aus dem Bild. Das ist der Grund, warum die beiden Laschen **nicht** in einer
gemeinsamen Regel stehen können wie Planer und Planer-Lasche: dieselbe Strecke, zwei Schreibweisen.
Beide Vorzeichen werden deshalb einzeln im Test festgenagelt.

💣 **`transform`, nicht `right`.** `right` wäre naheliegend — beide Laschen haben schon eine
`right`-Transition für das Andocken an die Panelkante. Aber die Andock-Regeln in
`css/features/infopanel.css` setzen `right: 0` bei **gleicher Spezifität** und stehen später im
Ladepfad als `loading-bar.css`; sie würden die Startstellung lautlos überstimmen, und die Laschen
blieben einfach stehen. `transform` kollidiert mit nichts.

⚠️ **Beide Laschen brauchen `transform` in ihrer eigenen Transition** (`infopanel.css` bzw.
`review-panel.css`). Ohne das springen sie am Ende des Startlaufs auf ihren Platz, statt zu
gleiten — der Balken fiele auf, die Bewegung nicht.

⚠️ Die Panels tragen ihre Startstellung ohnehin schon über `.is-hidden` (`translateX(100%)`). Die
Boot-Regel schreibt denselben Wert und wirkt nur in dem einen Fall, der sonst durchfiele: ein Panel,
das im Edit-Modus bereits offen ist, wenn der Startlauf noch läuft.

## 7. Was ausdrücklich NICHT geändert wird

- **Der schmale Streifen oben** — Auftrag: „soll bleioben".
- **Der Routenplaner und seine Lasche.** `#toggle-button` steht auf `left: 350px` und wandert beim
  Start um −350 px, landet also auf `left: 0` und ist während des Ladens **sichtbar**. Das ist der
  Owner-Entscheid vom 12.08.2026 („ich meinte nicht, dass die tab-lasche nachgeladen wird") und
  bleibt so.
- **Knopfbund und Zoom** — die warten seit dem 12.08.2026 bereits.

## 8. Token

Vier neue in `css/base/tokens.css`, je ein Wert im hellen und im dunklen Block. Das Gold ist
**kein** neues Token: es ist `--color-accent-strong`, das Wappengold, das die Designsprache dafür
schon führt.

| Token | hell | dunkel | Rolle |
|---|---|---|---|
| `--color-boot-veil` | `rgba(255,253,249,.55)` | `rgba(33,31,25,.66)` | der Schleier |
| `--color-boot-ring-ink` | `#6d5236` | `#cbb99a` | dunkle Rosenhälfte |
| `--color-boot-ring-pale` | `#d7c9a8` | `#efe6d2` | helle Rosenhälfte |
| `--color-boot-ring-track` | `rgba(109,82,54,.22)` | `rgba(238,231,218,.20)` | ruhender Ring, Teilstriche |

⚠️ **Das Mockup weicht hier ab** und führt ein eigenes `--color-boot-ring-gold`. Das war zum
Vergleichen der vier Fassungen bequem, ist aber ein fünftes Token für eine Farbe, die es schon
gibt. **Maßgeblich ist diese Tabelle**, nicht die CSS des Mockups.

## 9. Berührte Dateien

| Datei | was |
|---|---|
| `js/app/loading-bar.js` | baut Schleier + Windrose + Text neben dem Balken |
| `css/features/loading-bar.css` | Schleier, Rose, Drehung, die vier Startstellungen der rechten Kante |
| `css/base/tokens.css` | die vier Token, hell und dunkel |
| `css/features/infopanel.css` | `transform` in die Transition der Info-Lasche |
| `css/features/review-panel.css` | `transform` in die Transition der Editor-Lasche |
| `js/app/i18n-en.js` | `boot.loading` |

## 10. Tests

Neu: `js/app/__tests__/startladen-schleier.test.js`

1. Der Schleier ist `pointer-events: none` — der Owner-Entscheid, nicht nur ein Detail.
2. Sein `z-index` ist **kleiner** als der des Balkens (beide Zahlen aus der Datei gelesen, nicht
   abgeschrieben).
3. Er blendet über `opacity`/`visibility` aus, nicht über `display`.
4. Keine hartkodierte Farbe im Schleier und in der Rose — jede Farbe kommt aus einem Token
   (AGENTS.md §12).
5. Die vier Startstellungen der rechten Kante stehen da, und die Editor-Lasche komponiert
   `rotate(180deg)` **mit negativem** `translateX`.
6. Beide Laschen führen `transform` in ihrer Transition.
7. Der Textknoten trägt `data-i18n` und enthält die SVG **nicht**.
8. `boot.loading` existiert in `js/app/i18n-en.js`.
9. Die Drehung nutzt `transform-box: fill-box`.

Bestehend und weiter grün zu halten: `js/app/__tests__/touch-scale.test.js` prüft die vorhandenen
Startlauf-Regeln mit `^`-verankerten Mustern — die neuen Regeln kommen **hinzu**, die alten bleiben
wortgleich.

## 11. Offene Punkte

- 🔧 Der Blick im echten Browser gegen die echte Karte steht aus (das Mockup ist eine Bühne, kein
  Beleg). Besonders: wie der Schleier über den **echten** Kacheln liegt — die Bühne ist blasser als
  Aventurien.
- 🔧 Am Telefon ist die Info-Lasche im Frontend ohnehin ausgeblendet; die rechte Kante wirkt dort
  nur im Edit-Modus. Ungemessen, ob der Schleier auf einem echten Gerät zu dicht wirkt.
- 🔧 Die deutsche Sekunde unter `?lang=en` (§5) — bewusst offen gelassen, gehört in M8.
