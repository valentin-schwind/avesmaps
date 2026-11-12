/**
 * Zwei Stellschrauben des Playmode-Flugs, NUR im Entwicklungsbuild und nur über die Adresse (Betreiberbefund 2026-10-12: Chrome auf
 * dem iPhone beendet den Zugriff, „es kommt in 3D wenn ich auf den playbutton der route klick“).
 *
 * 🔴 **Eine Messhilfe, kein Produktschalter.** `import.meta.env.DEV` ist im gebauten Release `false`; die Funktionen geben dann
 * immer die Vorgabe zurück, und der Zweig fällt beim Bauen weg. Nichts davon erscheint in einer Oberfläche, nichts wird gemerkt.
 *
 * Hintergrund: Der Flug steigt auf `FLIGHT_ZOOM` (7) und neigt auf `FLIGHT_PITCH` (75°, Betreiber 2026-10-13 „im flug 75°
 * bei Reise ▶ in 3D“; die Messungen unten entstanden bei 60°). Gemessen am 2026-10-12, Fenstermaße iPhone 15, dieselbe Route, 18 s nach ▶: geneigt 1.167 Kacheln und rund 214
 * VertexArrays je Sekunde, flach 433 Kacheln und rund 14. Welche Schwelle ein Telefon trägt, lässt sich hier nicht messen — nur
 * dort. Mit diesen beiden Werten findet der Betreiber sie in wenigen Versuchen:
 *
 *     …/edit?route=…&flugneigung=30#…       Flug mit 30° statt 60°
 *     …/edit?route=…&flughoehe=6#…          Flug auf Zoom 6 statt 7
 *
 * Beide zusammen gehen auch. Ohne Angabe ändert sich nichts.
 */
import { FLIGHT_PITCH, maxPitchForZoom } from "./camera/camera-math";

/** Der Wert aus Abfrage oder Fragment; nur im Entwicklungsbuild, sonst immer `undefined`. */
function zahlAusAdresse(name: string): number | undefined {
    if (!import.meta.env.DEV) return undefined;
    const ort = globalThis.location;
    if (!ort) return undefined;
    const ausFragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, ausFragment]) {
        const wert = new URLSearchParams(quelle).get(name);
        if (wert === null) continue;
        const zahl = Number(wert);
        if (Number.isFinite(zahl)) return zahl;
    }
    return undefined;
}

/**
 * `?gelaende=aus` lässt die Karte das Höhenmodell gar nicht erst holen — derselbe Zustand, den der Inhaltsschalter
 * `map.terrain3d` herstellt („Das 3D-Gelände ist gerade pausiert. Die Karte bleibt flach."): Neigen geht weiter, nur ohne Berge.
 *
 * Warum über die Adresse und nicht über den Schalter: Der Schalter will ein Betreiberkonto mit Passkey, und er gilt für die ganze
 * Instanz — auf dem gemeinsamen Entwicklungsstapel säßen die anderen Sitzungen mit in der flachen Karte. Für EINEN Gegenversuch
 * ist das zu viel. Auf Stage bleibt der Schalter der richtige Weg.
 */
export function gelaendeAus(): boolean {
    if (!import.meta.env.DEV) return false;
    const ort = globalThis.location;
    if (!ort) return false;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        if (new URLSearchParams(quelle).get("gelaende") === "aus") return true;
    }
    return false;
}

/**
 * `?dpr=<zahl>` gibt der Karte eine andere Bildpunktdichte als die des Geräts (MapLibre `pixelRatio`).
 *
 * 🔴 Warum gerade das, nachdem Güteleiter und Kachelprotokoll nichts brachten: Mit Gelände zeichnet MapLibre die ganze Karte
 * erst in Texturen und legt sie dann über die Maschen. Diese Ziele hängen an der Fläche des Bildes, also am QUADRAT der
 * Bildpunktdichte — und ein iPhone hat 3. Von 3 auf 1,5 ist ein Viertel der Bildpuffer.
 *
 * Das passt zu allem, was gemessen ist: Gelände AUS hält (keine Zwischentexturen), Gelände AN stirbt — unabhängig davon, wie fein
 * das Höhenmodell ist oder woher die Kacheln kommen. Genau das sagt die Leiter, die nichts brachte: Sie senkt Daten, nicht
 * Bildfläche.
 */
export function bildpunktdichte(): number | undefined {
    const gewuenscht = zahlAusAdresse("dpr");
    if (gewuenscht === undefined) return undefined;
    return Math.min(Math.max(gewuenscht, 0.5), 4);
}

/**
 * `?drape=<zahl>` setzt die Feinheit der Zwischenbilder des Geländes (`GelaendeGuete.drape`, MapLibre `qualityFactor`) direkt,
 * an der Leiter vorbei. Erlaubt sind 2 (MapLibres Vorgabe), 1 und 0,5.
 *
 * 🔴 **Das ist die Zahl, an der es hängt** (gemessen 2026-10-12, Fenstermaße iPhone 15, Überblick ohne Flug): 171 MB
 * Zwischenbilder bei 2, 43 MB bei 1, 11 MB bei 0,5. Die Tabelle und die Rechnung stehen bei `DRAPE_MB` in `terrain/terrain.ts`.
 */
export function drapeGuete(): number | undefined {
    const gewuenscht = zahlAusAdresse("drape");
    if (gewuenscht === undefined) return undefined;
    return Math.min(Math.max(gewuenscht, 0.25), 2);
}

/**
 * `?flugbahn=aus` und `?pillen=aus` lassen die beiden EIGENEN WebGL-Ebenen der Route weg (`flight-arcs.ts`,
 * `route-pills.ts`). Die Route bleibt als Linie, die Reise lässt sich abspielen; nur Bahn und Querfeldein-Punkte fehlen.
 *
 * 🔴 **Warum sie jetzt dran sind.** Am 2026-10-12 ist der Speicher als Ursache ausgeschlossen: Der Gipfel im Flug ließ sich
 * von 66 auf 24 MB drücken, und die Seite starb unverändert. Übrig bleibt das, was an der Karte NICHT MapLibre ist — diese
 * beiden Ebenen. Sie sind handgeschriebenes WebGL 2 (`#version 300 es`, VertexArrays, eine `RG32F`-Textur, die der
 * VERTEX-Shader mit `texelFetch` liest) und treten nur auf, wenn eine Route auf der Karte liegt.
 *
 * Und sie erklären als einzige den Befund „andere pfade gehen. ähnliche nicht" (Betreiber 2026-10-12): Ihre Puffer und die
 * Höhentextur wachsen mit der LÄNGE der Route. Keine Speichertheorie hat das je erklärt, denn Kacheln und Zwischenbilder
 * hängen am Bildausschnitt, nicht an der Reise.
 */
export function flugbahnAus(): boolean {
    return schalterAus("flugbahn") || eigeneEbenenAus();
}

/**
 * `?eigene=aus` laesst ALLE vier eigenen WebGL-Ebenen weg: Kraftlinienboegen, Querfeldein-Punkte, Flugbahn und den
 * Reisepfeil (`powerline-arcs.ts`, `route-pills.ts`, `flight-arcs.ts`, `traveler-layer.ts`).
 *
 * 🔴 **Warum das jetzt die Trennlinie ist.** Am 2026-10-12 lief die nackte Seite - MapLibre, unsere Hoehenkacheln,
 * dazu der ECHTE Stil der App mit 78 Ebenen und 24 Quellen - auf dem iPhone des Betreibers fluessig und ohne
 * Absturz, geneigt bis Zoom 7. Damit sind MapLibres Geländepfad, die Kacheldaten und der ganze Stil als Ursache
 * ausgeschlossen. Uebrig bleibt unsere eigene Mechanik, und ihr einziger handgeschriebener WebGL-Teil sind diese vier.
 */
export function eigeneEbenenAus(): boolean {
    return schalterAus("eigene");
}

/**
 * `?leiste=ruhig` laesst die Abspielleiste ihren Fortschritt nur fuenfmal je Sekunde zeigen statt in jedem Bild.
 *
 * 🔴 **Die letzte gemessene Auffaelligkeit.** Am 2026-10-12 lief auf dem iPhone des Betreibers: MapLibre mit unseren
 * Hoehenkacheln, mit dem ECHTEN Stil der App (78 Ebenen, 24 Quellen) UND mit der echten Kamerabahn des Playmode
 * (75 s, Zoom 2,75 bis 7, Neigung 60, 37,7 Grad Luftlinie) - alles fluessig. Die App an derselben Stelle stirbt.
 * Gemessen trennt die beiden vor allem eines: 475 DOM-Aenderungen je Sekunde gegen 5. Die groessten Posten sind
 * `player__played` und `player__knob` mit je 120 je Sekunde, dazu `aria-valuetext` und die Meilen- und Tagesanzeige.
 */
export function leisteRuhig(): boolean {
    if (!import.meta.env.DEV) return false;
    const ort = globalThis.location;
    if (!ort) return false;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        if (new URLSearchParams(quelle).get("leiste") === "ruhig") return true;
    }
    return false;
}

/**
 * `?dunst=aus` laesst die Dunstschicht weg (`map/atmosphere/atmosphere.ts`).
 *
 * 🔴 **Warum sie jetzt dran ist.** Sie ist unser einziges Stueck, das BEIM BLOSSEN KIPPEN in jedem Bild einer Bewegung
 * arbeitet - und der Absturz braucht kein ▶ (Betreiber 2026-10-12: „bin auf den link, auf den ▶ komm ich nicht, so
 * schnell stuerzt das ab"). Zwei Posten je Bild:
 *
 * 1. `farEdgeY` sucht den Horizont mit einer Binaersuche ueber `map.unproject` - drei Spalten, je rund dreizehn
 *    Schritte, also etwa **39 Aufrufe je Bild**, ab einem Grad Neigung. Mit Gelaende ist jeder davon ein Strahl durch
 *    den Deckungsindex des Hoehenmodells statt einer Matrixrechnung.
 * 2. `overlay.style.background` setzt einen bildschirmfuellenden Verlauf neu - auf dem iPhone sind das 1179 x 2556
 *    Bildpunkte, die ueber der WebGL-Karte neu gerastert werden, in jedem Bild.
 *
 * Die nackte Seite hat beides nicht, und sie laeuft auf demselben Geraet mit demselben Stil und derselben Kamerabahn.
 */
export function dunstAus(): boolean {
    return schalterAus("dunst");
}

/**
 * `?ohne=<woerter>` wirft Ebenen aus dem fertigen Stil, deren Kennung eines der Wörter enthält (Komma getrennt).
 * `?derographie=aus` ist die Kurzform für `?ohne=derographie`.
 *
 * 🔴 **Betreiberspur 2026-10-13**: „irgendwann kamen die vielen transparenzen der derographie hinzu". Gemessen hat
 * Derographie 110 Zeichenaufrufe je Bild gegen 94 bei Topographie — die Standardkarte liegt mit 116 darüber, und die
 * Zahl der durchsichtigen Ebenen ist bei beiden Landschaftsansichten gleich (21). Der Schalter lässt den Betreiber
 * das trotzdem am Gerät prüfen, denn die Füllrate eines Telefons misst sich hier nicht.
 *
 * 🪤 In `view=landschaften&layer=topographie` zeichnet die Karte die Derographieflächen gar nicht. Wer sie prüfen
 * will, braucht `layer=derographie`; wer ALLE Landschaftsflächen weglassen will, nimmt `?ohne=landscape-fill`.
 */
/**
 * `?deckend=an` nimmt den Flächen und Linien jede Durchsichtigkeit: Deckkraft auf 1, Alpha aus den Farben.
 *
 * 🔴 **Betreiberauftrag 2026-10-13** („verhinder mal die transparenzen einfach"), nachdem `layer=alle` — drei
 * gestapelte durchsichtige Flächensätze — auf dem Gerät SOFORT starb, während dieselbe Seite mit einem Satz
 * Sekunden bis Minuten trug.
 *
 * Durchsichtigkeit kostet keinen Speicher, sondern **Füllrate**: Jede Lage zwingt die GPU, dieselben Bildpunkte
 * erneut zu mischen, und mit Gelände geschieht das in den Zwischenbildern, also nochmals vervielfacht. Das passt
 * zu allem, was übrig blieb: kein Speicherabschuss, volle Bildrate bis zuletzt, kein `webglcontextlost`, und ein
 * Hauptthread, der dem Inspector eine Minute lang nicht antwortet.
 */
export function deckend(): boolean {
    return schalterAn("deckend");
}

/**
 * `?relief=aus` nimmt den Landschaftsansichten das **mehrdirektionale** Relief und gibt ihnen die einfache
 * Schattierung der Standardkarte (eine Lichtquelle statt dreier).
 *
 * 🔴 **Betreiberbefund 2026-10-13**: „bei vegetation stürzt es auch ab, alles bei landschaft, im standard modus is
 * alles ok trotz 3d." Gemessen hat keine der drei Landschaftsebenen eine Geometrie, die das erklärt — Vegetation hat
 * die meisten Stützpunkte (561k) bei der KLEINSTEN bedeckten Fläche, Derographisch die größte Fläche bei nur 125
 * Flächen. Was alle drei teilen und der Standardkarte fehlt, ist das Relief: `hillshade-method: "multidirectional"`
 * mit drei Lichtrichtungen (`GELAENDE.relief`, WI-0054) statt der einen in `GELAENDE.schattierung`.
 *
 * Das ist dreifache Schattierungsrechnung je Bildpunkt über die ganze Karte — und mit Gelände in jedem
 * Zwischenbild erneut. Der Schalter prüft genau das und lässt alles andere stehen.
 */
export function reliefAus(): boolean {
    return schalterAus("relief");
}

/** Ob `?<name>=an` in der Adresse steht; nur im Entwicklungsbuild. */
function schalterAn(name: string): boolean {
    if (!import.meta.env.DEV) return false;
    const ort = globalThis.location;
    if (!ort) return false;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        if (new URLSearchParams(quelle).get(name) === "an") return true;
    }
    return false;
}

export function ohneEbenen(): readonly string[] {
    if (!import.meta.env.DEV) return [];
    const ort = globalThis.location;
    if (!ort) return [];
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    const woerter: string[] = [];
    for (const quelle of [ort.search, fragment]) {
        const liste = new URLSearchParams(quelle).get("ohne");
        if (liste !== null) woerter.push(...liste.split(",").filter(Boolean));
    }
    // 🪤 Die Ebene heisst im Stil `derographisch`, nicht `derographie` (`landscape-fill-derographisch`).
    if (schalterAus("derographie")) woerter.push("derographisch");
    if (schalterAus("vegetation")) woerter.push("vegetation");
    if (schalterAus("flaechen")) woerter.push("landscape-fill", "landscape-line");
    return woerter.map((w) => w.toLowerCase());
}

/**
 * `?maxneigung=<grad>` deckelt die Neigung zusätzlich zur Regel nach Zoom (`camera/camera-math.ts`, `setMaxPitch`).
 *
 * 🔴 **Die Neigung ist der Kostentreiber, nicht die Güte.** Gemessen im iPhone-Fenster, dieselbe Karte, nur gekippt:
 * 0–30° = 53 MB Texturen, 50° = 106 MB, 60° = 109 MB, 85° = 228 MB. Der Betreiber hat am 2026-10-12 auf dem Gerät
 * bestätigt, dass die NACKTE Karte (MapLibre, unsere Kacheln, unser Stil, kein Vue, keine Route, keine eigenen
 * Ebenen) stabil läuft „bis ein extremer winkel kommt, dann stürzts ab".
 *
 * Ohne Angabe ändert sich nichts. Welcher Wert für Telefone gilt, ist eine Betreiberentscheidung; naheliegend ist
 * `TILT_PRESET` (45), weil der 3D-Knopf ohnehin dorthin kippt — kein neuer Wert, nur ein vorhandener als Decke.
 */
export function maxNeigung(): number | undefined {
    const gewuenscht = zahlAusAdresse("maxneigung");
    if (gewuenscht === undefined) return undefined;
    return Math.min(Math.max(gewuenscht, 0), 85);
}

/** Siehe `flugbahnAus`. */
export function pillenAus(): boolean {
    return schalterAus("pillen") || eigeneEbenenAus();
}

/** Ob `?<name>=aus` in der Adresse steht; nur im Entwicklungsbuild. */
function schalterAus(name: string): boolean {
    if (!import.meta.env.DEV) return false;
    const ort = globalThis.location;
    if (!ort) return false;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        if (new URLSearchParams(quelle).get(name) === "aus") return true;
    }
    return false;
}

/**
 * `?cache=<n>` begrenzt, wie viele Kacheln eine Quelle AUSSER SICHT behält (`maxTileCacheSize`), `?cachezoom=<n>` über wie
 * viele Zoomstufen hinweg (`maxTileCacheZoomLevels`, Vorgabe 5).
 *
 * 🔴 **Der Gipfel liegt im Flug, nicht im Überblick** (Betreiber 2026-10-12: „nachdem ich play drücke lädt die ganze seite neu").
 * Gemessen am iPhone-15-Fenster, dieselbe Route, lebende GL-Texturen: vor ▶ **20 MB**, während des Flugs **67 MB** und weiter
 * steigend. Die Zwischenbilder bleiben dabei klein (5–11 MB); was wächst, sind die Höhenkacheln — von 10 auf 32 Texturen à
 * rund 1,4 MB. Der Flug steigt von Zoom 2,56 auf 7 und sammelt dabei jede Stufe mit ein.
 *
 * 🪤 Ein früherer Versuch mit `maxTileCacheSize: 64` blieb wirkungslos und wurde verworfen (878c244a). Der Grund war nicht,
 * dass der Schalter nichts tut, sondern dass 64 über dem liegt, was MapLibre aus dem Fenster ohnehin errechnet: Die Grenze
 * ist `Math.min(maxTileCacheSize, viewDependentMaxSize)`. Erst deutlich kleinere Zahlen greifen.
 */
export function kachelSpeicher(): { groesse?: number; zoomstufen?: number } {
    const groesse = zahlAusAdresse("cache");
    const zoomstufen = zahlAusAdresse("cachezoom");
    return {
        ...(groesse === undefined ? {} : { groesse: Math.min(Math.max(Math.round(groesse), 0), 512) }),
        ...(zoomstufen === undefined ? {} : { zoomstufen: Math.min(Math.max(Math.round(zoomstufen), 0), 10) }),
    };
}

/**
 * `?parallel=<n>` begrenzt, wie viele Kachelbilder MapLibre GLEICHZEITIG holt (`setMaxParallelImageRequests`, Vorgabe 16).
 *
 * 🔴 **Der Betreiber hat die Spur gelegt** (2026-10-12: „kann es sein dass wir irgendwo ne race condition haben? da wo es ging
 * war ich im mobilfunknetz"). Nachgemessen am iPhone-15-Fenster, dieselbe Seite, einmal ungebremst und einmal auf 3 Mbit
 * gedrosselt: Am Ende stehen beide Male **48 MB** Texturen — aber ungebremst nach **einer** Sekunde, gedrosselt erst nach
 * **fünfzehn**. Nicht der Endstand unterscheidet sich, sondern wie steil er erreicht wird.
 *
 * Das ist der Hebel, der ein schnelles Netz wie ein langsames aussehen lässt, ohne irgendetwas wegzulassen: Dieselben Kacheln,
 * nur nicht alle auf einmal.
 */
export function parallelGrenze(): number | undefined {
    const gewuenscht = zahlAusAdresse("parallel");
    if (gewuenscht === undefined) return undefined;
    return Math.min(Math.max(Math.round(gewuenscht), 1), 32);
}

/**
 * `?kachelprotokoll=aus` meldet das eigene Protokoll der Geländekacheln (WI-0125, `terrain/terrain-tiles.ts`) NICHT an; die Quellen
 * nennen dann wieder die Vorlage der Pyramidenrevision, und MapLibre lädt die Höhenkacheln wie vor dem 9. Oktober selbst.
 *
 * 🪤 Der Grund, es überhaupt trennen zu können (Betreiber 2026-10-12: „mich wundert es nur dass es jetzt passiert, weil ich hab
 * das gelände schon öfter aufm handy getestet - war nie ein problem"): Ein Lader aus `addProtocol` läuft im HAUPTTHREAD, während
 * MapLibre seine Kacheln sonst in Arbeitern holt. Das ist die eine Sache, die sich am Gelände geändert hat, seit es auf dem
 * Telefon noch ging — ob sie es ist, sagt dieser Schalter.
 */
export function kachelprotokollAus(): boolean {
    if (!import.meta.env.DEV) return false;
    const ort = globalThis.location;
    if (!ort) return false;
    const fragment = ort.hash.startsWith("#") ? ort.hash.slice(1) : ort.hash;
    for (const quelle of [ort.search, fragment]) {
        if (new URLSearchParams(quelle).get("kachelprotokoll") === "aus") return true;
    }
    return false;
}

/**
 * Welche Stufe der Geländegüte dieses Gerät bekommt (`GELAENDE_STUFEN` in `terrain/terrain.ts`).
 *
 * 🔴 **Die Vorgabe ist für ALLE Geräte die Stufe 0, also unverändert**, bis der Betreiber eine wählt. Am Telefon findet er sie
 * mit `?handy=<0..3>` selbst: Stufe 1 eine Höhenquelle statt zwei, Stufe 2 dazu ein gröberes Höhenmodell (ein Viertel der
 * Kacheln), Stufe 3 dazu ohne Schattierung. `?gelaende=aus` bleibt die Stufe darunter.
 *
 * Der Schalter gilt im Entwicklungsbuild für jedes Gerät, damit dieselbe Stufe am Rechner nachgemessen werden kann; die spätere
 * Vorgabe gilt nur am Telefon (`telefon`), und der Stil wird beim Wechsel über die Telefongrenze ohnehin neu gebaut.
 */
export function gelaendeStufe(telefon: boolean, stufen: number): number {
    const gewuenscht = zahlAusAdresse("handy");
    if (gewuenscht !== undefined) return Math.min(Math.max(Math.round(gewuenscht), 0), stufen - 1);
    return telefon ? TELEFON_VORGABE : 0;
}

/**
 * Was ein Telefon ohne Angabe bekommt: **Stufe 1** — eine Höhenquelle statt zweier, und Zwischenbilder halber Kantenlänge.
 *
 * 🔴 **Begründet durch das Gerät selbst** (Betreiber 2026-10-13, `JetsamEvent-2026-10-13-001223.ips`): iOS hat den
 * Inhaltsprozess bei **2.059 MB** mit `reason: per-process-limit` abgeschossen, während 169 MB frei waren und kein anderer
 * Prozess weichen musste. Das ist keine Gerätenot, sondern eine harte Obergrenze je Prozess — und auf iOS zählen die
 * WebGL-Flächen in denselben Prozess.
 *
 * Was Stufe 1 davon abzieht, ist gemessen (iPhone-Fenstermaße): Zwischenbilder **171 → 43 MB** im Überblick und
 * **226 → rund 60 MB** im Flug, dazu **12 MB** für die zweite Höhenquelle. Die Sichtprüfung bei Telefongröße zeigt zu
 * Stufe 0 keinen erkennbaren Unterschied (`DRAPE_MB` in `terrain/terrain.ts`).
 *
 * Am Rechner bleibt es bei Stufe 0.
 */
const TELEFON_VORGABE = 1;

/** Die Flughöhe des Playmode; `?flughoehe=` überschreibt sie im Entwicklungsbuild. */
export function flugHoehe(vorgabe: number): number {
    const gewuenscht = zahlAusAdresse("flughoehe");
    return gewuenscht === undefined ? vorgabe : Math.min(Math.max(gewuenscht, 0), 22);
}

/** Die Neigung, auf die der Flug steigt; `?flugneigung=` überschreibt sie im Entwicklungsbuild. Nie über die Grenze des Zooms. */
export function flugNeigung(zoom: number): number {
    const grenze = maxPitchForZoom(zoom);
    const gewuenscht = zahlAusAdresse("flugneigung");
    if (gewuenscht === undefined) return Math.min(FLIGHT_PITCH, grenze);
    return Math.min(Math.max(gewuenscht, 0), grenze);
}
