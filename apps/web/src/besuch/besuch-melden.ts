import {
    bandForRenderZoom,
    BESUCH_PING_URL,
    BESUCH_URL,
    CLIENT_FEHLER_GRENZEN,
    fensterKlasse,
    SITZUNG_ANSICHTEN,
    type BesuchMetrik,
    type ClientFehlerArt,
    type ClientFehlerDiagnose,
    type GrafikKlasse,
    type SitzungAnsicht,
} from "@avesmaps3d/shared";
import { locale } from "../i18n/i18n";
import { theme } from "../theme/theme";

/**
 * Was der Browser der Statistik meldet (WI-0138, BESUCH-0001 §6).
 *
 * - **Gebündelt und beiläufig**: Ereignisse sammeln sich in einer Schlange und gehen zusammen weg, wenn die Seite in den
 *   Hintergrund wechselt oder nach kurzer Ruhe. Nichts davon hält die Karte auf; ein Fehler bleibt hier.
 * - **Nichts wird gespeichert**: kein Cookie, kein `localStorage`, kein `sessionStorage`. Deshalb braucht die Zählung kein
 *   Zustimmungsfenster (§ 25 TDDDG greift für Zugriff auf das Endgerät).
 * - **Nur unsere eigenen Werte**: Die Metriken stehen in `BESUCH_METRIKEN`, die Ausprägungen kommen aus unseren Listen. Der
 *   Server prüft beides noch einmal und verwirft, was nicht passt.
 * - **Der Ping** geht nur bei sichtbarem Tab; ein seit gestern im Hintergrund liegender Tab ist von einem geschlossenen nicht zu
 *   unterscheiden, und eine erfundene Verweildauer wäre schlimmer als keine. 🔴 Dazu kommt ein **Abschied** im Moment, in dem die Seite
 *   verschwindet (OPS-000118): Ohne ihn hatte ein Besuch unter einer Minute nur ein Lebenszeichen und stand als 0 s da.
 * - **Nach zehn Sekunden bestätigt sich die Seite** (OPS-000118, Filter „Besuche unter 10 Sekunden ausblenden“): Sie schickt alles, was sie
 *   bis dahin gemeldet hat, noch einmal als Nachtrag, und jede spätere Meldung trägt `bestaetigt`. Der Server zählt daraus die gefilterte
 *   Sicht. Der Nachtrag lebt nur im Speicher dieses Tabs.
 */

const PING_MS = 60_000;
const BUENDEL_MS = 4_000;
/** Ab hier ist ein Besuch kein kurzer mehr (OPS-000118). */
export const BESTAETIGT_MS = 10_000;
/** Ein Fehler wartet kürzer als ein gewöhnliches Ereignis: Nach einem Absturz lebt die Seite vielleicht nicht mehr lange. */
const FEHLER_MS = 1_000;

interface Ereignis {
    metrik: BesuchMetrik;
    dimension?: string;
}

let schlange: Ereignis[] = [];
/** Was diese Seite vor ihrer Bestätigung gemeldet hat; geht mit dem Nachtrag noch einmal weg und wird danach nicht mehr geführt. */
let vorBestaetigung: Ereignis[] = [];
let bestaetigt = false;
let bestaetigungsTimer: ReturnType<typeof setTimeout> | undefined;
/** Diagnosen zu Fehlern im Browser (WI-0202); höchstens `jeMeldung` reisen mit einer Meldung. */
let fehlerSchlange: ClientFehlerDiagnose[] = [];
let buendelTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let bewegt = false;
let gestartet = false;

let grafik: GrafikKlasse | undefined;

/**
 * Die Grafik des Geräts, grob und einmal je Seite: `webgl2`, `webgl1` oder `ohne`. Nie der Name der Karte oder des Treibers.
 * Einmal, weil jede Probe eine eigene Leinwand mit eigenem Kontext anlegt; der Browser hält davon nur wenige.
 */
export function grafikKlasse(): GrafikKlasse {
    if (grafik !== undefined) return grafik;
    try {
        const probe = (art: string): boolean => Boolean(document.createElement("canvas").getContext(art));
        grafik = probe("webgl2") ? "webgl2" : probe("webgl") ? "webgl1" : "ohne";
    } catch {
        grafik = "ohne";
    }
    return grafik;
}

/** Die groben Merkmale der Umgebung; jedes zählt für sich, nie zwei in einer Zeile. */
function geraet():
    { breite: number; dreid: boolean; grob: boolean; wenigerBewegung: boolean; dunkel: boolean } | undefined {
    try {
        return {
            breite: Math.round(window.innerWidth),
            dreid: grafikKlasse() === "webgl2",
            grob: window.matchMedia("(pointer: coarse)").matches,
            wenigerBewegung: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            dunkel: window.matchMedia("(prefers-color-scheme: dark)").matches,
        };
    } catch {
        return undefined;
    }
}

function sende(mitGeraet: boolean): void {
    if (schlange.length === 0 && fehlerSchlange.length === 0) return;
    const fehler = fehlerSchlange.splice(0, CLIENT_FEHLER_GRENZEN.jeMeldung);
    const ereignisse = schlange.slice(0, 20);
    if (!bestaetigt) vorBestaetigung.push(...ereignisse);
    schicke({
        ereignisse,
        stunde: new Date().getHours(),
        herkunft: document.referrer || undefined,
        ...(mitGeraet ? { geraet: geraet() } : {}),
        ...(fehler.length > 0 ? { fehler } : {}),
        ...(bestaetigt ? { bestaetigt: true } : {}),
    });
    schlange = [];
    // Mehr Diagnosen, als eine Meldung trägt: der Rest geht gleich mit der nächsten.
    if (fehlerSchlange.length > 0) planeSenden(FEHLER_MS);
}

/**
 * Die Seite ist zehn Sekunden offen (OPS-000118). Was noch in der Schlange wartet, geht vorher als gewöhnliche Meldung weg; danach alles bis
 * hierher als Nachtrag, der nur in der gefilterten Sicht zählt, zu je 20 Ereignissen, die Umgebung beim ersten.
 */
function bestaetige(): void {
    bestaetigungsTimer = undefined;
    if (bestaetigt) return;
    sende(false);
    const bisher = vorBestaetigung;
    vorBestaetigung = [];
    bestaetigt = true;
    for (let start = 0; start < bisher.length; start += 20) {
        schicke({
            ereignisse: bisher.slice(start, start + 20),
            stunde: new Date().getHours(),
            herkunft: document.referrer || undefined,
            ...(start === 0 ? { geraet: geraet() } : {}),
            bestaetigt: "nachtrag",
        });
    }
}

function schicke(rumpf: Record<string, unknown>): void {
    const koerper = JSON.stringify(rumpf);
    try {
        // `keepalive` trägt die Meldung auch über das Schließen der Seite; sendBeacon kann keine Kopfzeilen setzen und
        // scheitert deshalb an der Origin-Prüfung des Servers nicht, wohl aber an unserem JSON-Typ.
        void fetch(BESUCH_URL, {
            method: "POST",
            keepalive: true,
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: koerper,
        }).catch(() => undefined);
    } catch {
        /* Die Zählung darf die Karte nie stören. */
    }
}

/**
 * Was dieser Besuch schon **einmalig** gemeldet hat (`meldeEinmal`). Lebt nur im Speicher dieses Tabs und verfällt mit ihm;
 * nichts davon wird gespeichert.
 */
const einmalig = new Set<BesuchMetrik>();

/**
 * Einmal je Besuch melden, auch wenn es zehnmal geschieht (WI-0138 V10 für `tilt`, WI-0159 für `flight`, `profile`, `play`).
 *
 * 🔴 **Weil die vier eine Frage beantworten:** `BESUCH-0001 §13 D` fragt „Lohnt die dritte Dimension?“, und darauf antwortet
 * „wie viele Besuche nutzen es“ - nicht „wie oft wurde geklickt“. Die vier Zeilen stehen im Panel untereinander im Block „3D“;
 * zählte eine davon Klicks und die andere Besuche, wären sie nicht vergleichbar. `share_create` liegt im selben Block und
 * zählt trotzdem jeden Link: Dort IST die Menge die Aussage (§13 E, „Kurzlinks erzeugt“).
 */
export function meldeEinmal(metrik: BesuchMetrik): void {
    // 🪤 Vor dem Start nichts merken: `melde` steigt dann aus, und ein Vermerk hier verschlösse die Metrik für den ganzen Besuch.
    if (!gestartet || einmalig.has(metrik)) return;
    einmalig.add(metrik);
    melde(metrik);
}

/** Ein Ereignis melden. Die Ausprägung bleibt kurz; der Server verwirft, was nicht in seine Form passt. */
export function melde(metrik: BesuchMetrik, dimension?: string): void {
    if (!gestartet) return;
    schlange.push(dimension === undefined ? { metrik } : { metrik, dimension: dimension.slice(0, 60) });
    if (schlange.length >= 20) {
        sende(false);
        return;
    }
    planeSenden(BUENDEL_MS);
}

/** Senden nach `ms`; ein kürzerer Wunsch zieht einen wartenden längeren vor. */
let buendelFaellig = Number.POSITIVE_INFINITY;
function planeSenden(ms: number): void {
    const faellig = Date.now() + ms;
    if (buendelTimer !== undefined && faellig >= buendelFaellig) return;
    if (buendelTimer !== undefined) clearTimeout(buendelTimer);
    buendelFaellig = faellig;
    buendelTimer = setTimeout(() => {
        buendelTimer = undefined;
        buendelFaellig = Number.POSITIVE_INFINITY;
        sende(false);
    }, ms);
}

/**
 * Einen Fehler im Browser melden (WI-0202): die Zählung der Art und, wenn es eine gibt, die Diagnose. Die Grenzen je Seite
 * hält der Fänger (`fehler-faenger.ts`); hier wird nur verschickt.
 *
 * 🔴 **Auch vor dem Start der Zählung.** Ein Fehler beim Start ist genau der, nach dem gefragt ist; wartete er auf
 * `starteBesuchsmeldung`, käme er nie an. Er reist dann ohne Seitenaufruf.
 */
export function sendeFehler(art: ClientFehlerArt | undefined, diagnose: ClientFehlerDiagnose | undefined): void {
    if (typeof window === "undefined") return;
    if (art !== undefined) schlange.push({ metrik: "client_fehler", dimension: art });
    if (diagnose !== undefined) fehlerSchlange.push(diagnose);
    if (art !== undefined || diagnose !== undefined) planeSenden(FEHLER_MS);
}

/**
 * Woran die Person gerade sitzt (WI-0141b). Gemeldet wird eine Kennung aus der Positivliste, nie Freitext; die
 * Oberfläche setzt sie, wenn sich der Arbeitsbereich ändert. Sie lebt an der Sitzung und verfällt mit ihr.
 */
let ansichtJetzt: SitzungAnsicht | undefined;

export function setzeAnsicht(ansicht: SitzungAnsicht | undefined): void {
    ansichtJetzt = ansicht;
}

/** Welche Kartenansicht offen ist, aus derselben Adresse, aus der auch gezählt wird; Vorgabe ist die Standardkarte. */
function karteAusHash(): SitzungAnsicht {
    const view = adresseLesen().ansicht ?? "standard";
    const kennung = `karte.${view}`;
    return (SITZUNG_ANSICHTEN as readonly string[]).includes(kennung) ? (kennung as SitzungAnsicht) : "karte.standard";
}

/** Ein Lebenszeichen; `abschied` geht auch, wenn die Seite schon verborgen ist, und misst so das Ende des Besuchs (OPS-000118). */
function ping(abschied = false): void {
    if (!abschied && document.visibilityState !== "visible") return;
    const zustand = abschied ? "hidden" : bewegt ? "active" : "reading";
    bewegt = false;
    try {
        void fetch(BESUCH_PING_URL, {
            method: "POST",
            keepalive: true,
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ zustand, ansicht: ansichtJetzt ?? karteAusHash() }),
        }).catch(() => undefined);
    } catch {
        /* still */
    }
}

/** Beginnt zu zählen: ein Seitenaufruf, danach die Schlange und der Ping. Mehrfaches Starten bleibt folgenlos. */
export function starteBesuchsmeldung(): void {
    if (gestartet || typeof window === "undefined") return;
    gestartet = true;
    schlange.push({ metrik: "pageview" });
    // Wie die Seite gerade läuft (WI-0286). Ein Wechsel meldet sich am Schalter (`theme-toggle.vue`, `lang-toggle.vue`).
    schlange.push({ metrik: "theme", dimension: theme.value });
    schlange.push({ metrik: "sprache_eingestellt", dimension: locale.value });
    sende(true);
    bestaetigungsTimer = setTimeout(bestaetige, BESTAETIGT_MS);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            sende(false);
            ping(true);
        } else ping();
    });
    for (const art of ["pointerdown", "wheel", "keydown"] as const) {
        window.addEventListener(art, () => (bewegt = true), { passive: true });
    }
    pingTimer = setInterval(ping, PING_MS);
    ping();
}

/**
 * Welche Ansicht offen ist, aus der Adresse — nur für den Ping (`karteAusHash`), nicht zum Zählen.
 *
 * 🪤 Hier hing bis WI-0161 ein `hashchange`-Haken, der `map_mode`, `map_style` und `zoom_band` meldete („ein Blick auf den Hash
 * statt eines Hakens in jedem Schalter"). Er hat fast nie gefeuert: Der Hash wird ausschließlich mit `history.replaceState`
 * geschrieben (`app.vue`, an `moveend`/`zoomend`), **und das löst kein `hashchange` aus**. In der lokalen Datenbank standen von
 * `map_mode` und `map_style` je zwei Zeilen, beide in der Sorte `bot`. Sie melden jetzt dort, wo der Mensch wählt: im
 * Kartenfächer (`map-fan.vue`) und an der Kartenruhe (`beobachteKarte`, seit WI-0286 als `zoom_stufe`).
 */
function adresseLesen(): { ansicht?: string | undefined } {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { ansicht: hash.get("view") ?? undefined };
}

/** Die Zoomstufe, auf der die Karte zuletzt zur Ruhe kam; `undefined`, solange keine Karte beobachtet wird. */
let letzteStufe: number | undefined;

/**
 * Was die Karte selbst verrät (WI-0138 V10, WI-0161, WI-0286): die Neigung und die Zoomstufe.
 *
 * 🔴 **Die Karte kommt von dem, der sie besitzt.** Bis WI-0161 holte sich der Haken `globalThis.avesmapsMap` — das
 * **Entwicklungs-Handle** der Browsertests, das `app.vue` nur unter `import.meta.env.DEV` setzt („not shipped in a production
 * build") und erst nach dem Kartenaufbau. Der Haken hängte sich darum nie ein: `tilt` hatte seit WI-0138 keine einzige Zeile,
 * in keiner Umgebung. Jetzt ruft `app.vue` diese Funktion mit der echten Karte auf.
 *
 * - **Neigung:** einmal je Besuch, sobald die Karte wirklich geneigt steht (`meldeEinmal`), auch schon beim Einhängen: Wer einem
 *   geneigten Link folgt und die Karte nicht anfasst, sieht sie trotzdem in 3D. Das beantwortet die Frage, die Legacy nicht
 *   stellen konnte — ob sich das Gelände lohnt.
 * - **Zoomstufe:** die fachliche Stufe (`bandForRenderZoom`, dieselbe wie in den Zoombändern), bei jeder Kartenruhe, aber nur beim
 *   **Wechsel** der Stufe (`BESUCH-0001 §13 D`: „Kartenruhe nach dem Zoomen"). 🪤 `moveend` feuert bei jeder Fahrt, jedem
 *   Zoomschritt und jedem Bild des Playmodes; ohne den Vergleich mit der letzten Stufe schriebe ein einziger Besuch hunderte
 *   Zeilen. Die Stufe beim Einhängen wird **gemerkt, nicht gemeldet**: Wer mit `?z=8` ankommt, ist nicht herangezoomt.
 */
export function beobachteKarte(karte: {
    on(art: string, haken: () => void): void;
    getPitch(): number;
    getZoom(): number;
}): void {
    letzteStufe = bandForRenderZoom(karte.getZoom());
    if (karte.getPitch() > 5) meldeEinmal("tilt");
    karte.on("moveend", () => {
        if (karte.getPitch() > 5) meldeEinmal("tilt");
        const stufe = bandForRenderZoom(karte.getZoom());
        if (stufe === letzteStufe) return;
        letzteStufe = stufe;
        melde("zoom_stufe", String(stufe));
    });
}

/** Für Tests: alles zurücksetzen. */
export function haltBesuchsmeldung(): void {
    if (pingTimer) clearInterval(pingTimer);
    if (buendelTimer) clearTimeout(buendelTimer);
    if (bestaetigungsTimer) clearTimeout(bestaetigungsTimer);
    bestaetigungsTimer = undefined;
    bestaetigt = false;
    vorBestaetigung = [];
    pingTimer = undefined;
    buendelTimer = undefined;
    buendelFaellig = Number.POSITIVE_INFINITY;
    schlange = [];
    fehlerSchlange = [];
    einmalig.clear();
    letzteStufe = undefined;
    gestartet = false;
}

/** Die Klasse, hier nur für Tests sichtbar. */
export { fensterKlasse };
