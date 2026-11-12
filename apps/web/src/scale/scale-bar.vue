<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { labelFamily } from "@avesmaps3d/shared";
import { layoutBox, type Insets } from "../map/camera/visible-area";
import { currentToast } from "../feedback/toast";
import { hinweiseUnten, leisteUnten } from "../feedback/unten-mitte";
import { t } from "../i18n/i18n";
import { massstabHub, type Hindernis } from "./scale-lift";
import { measureSchrittPerPixel } from "./scale-measure";
import { readScale, scaleBarMaxWidth, scaleLabel, type ScaleReading } from "./scale-reading";

/**
 * Die Maßstabsleiste am unteren Kartenrand (WI-0096). Legacy hat eine, Avesmaps3D hatte keine
 * (Finding MCS-029).
 *
 * 🔴 **Gestalt vom Betreiber entschieden, 2026-10-07:** „die dynamische skala zentriert, ohne
 * hintergrund, schatten wie bei legacy". Damit sind beide Abweichungen des ersten Anlaufs zurückgenommen:
 * keine Scheibe mehr, und sie steht wieder in der Mitte wie in Legacy (`margin-left: 50vw`).
 *
 * - **Was gezeigt wird:** die größte schöne Zahl (1, 2, 5 je Zehnerpotenz), die noch in den Deckel der
 *   Breite passt — in Meilen, unter einer Meile in Schritt. Die Rechnung steht in `scale-reading.ts`
 *   (ohne Browser, ohne MapLibre), die Messung in `scale-measure.ts` (ohne Vue).
 * - **Striche wie in Legacy:** elf Marken auf Zehnteln, groß bei 0, 50 und 100 % (MCS-029 §4).
 * - 🔴 **Weiß mit Saum, keine Fläche** — und das ist nicht Geschmack, sondern die EINE Regel der
 *   Kartenschrift (Guide §20): helle Schrift, dunkler Saum. Beide Farben kommen aus der Kartenschrift
 *   selbst (`labelFamily("place")`: `color` #ffffff, `haloColor` #000000), die Form des Saums aus
 *   `shadow.mapInk` — in Legacys `map-scale-band.css` gemessen. Deshalb braucht hier nichts einen
 *   Dunkelwert: Die Leiste trennt sich von der KARTE, und die ist in beiden Themen dieselbe.
 * - **Kein Bedienelement:** kein Hover, kein Fokus, `pointer-events: none` wie in Legacy. 🪤 In der Mitte
 *   des Bildes ist das keine Kosmetik — ohne die Zeile finge sie Klicks auf die Karte ab.
 * - 🔴 **Neu gerechnet in jedem Bild, höchstens einmal je Bild** (`requestAnimationFrame`). Legacy rechnet
 *   nur bei `zoomend`, weil seine Zahl an ganzen Zoomstufen hängt; unser Zoom rastet nicht (MCS-029 §3).
 */

const props = defineProps<{
    map: MapLibreMap | undefined;
    /** Was Panels von der Karte decken; ohne Angabe sitzt die Leiste in der Mitte des Canvas. */
    insets?: () => Partial<Insets>;
    /** Am Telefon tritt die Leiste zurück, solange ein Panel die Karte deckt (wie `.corner--covered`). */
    covered?: boolean;
    /**
     * Irgendein Wert, der sich ändert, wenn ein Panel auf- oder zugeht.
     *
     * 💣 Ohne ihn blieb die Leiste stehen, wo der Planer sie hingeschoben hatte: Sie misst nur, wenn die
     * Karte etwas meldet, und ein zugehender Planer bewegt die Karte nicht (die sichtbare Fläche hält sie
     * ausdrücklich still, WI-0039 E3). Die ZAHLEN kommen weiter aus `insets`.
     */
    layout?: unknown;
}>();

const INK = labelFamily("place");

const reading = shallowRef<ScaleReading | undefined>(undefined);
/** Wie weit die Leiste über ihrem Kartenrand steht, weil der Toast dort liegt. */
const lift = ref(0);
const host = ref<HTMLElement>();
const line = ref<HTMLElement>();

/** Die elf Marken, genau wie in Legacy: Zehntel, groß bei 0, 50 und 100 %. */
const TICKS = Array.from({ length: 11 }, (_, index) => ({
    at: `${String(index * 10)}%`,
    major: index % 5 === 0,
}));

const label = computed(() => (reading.value === undefined ? "" : scaleLabel(reading.value)));

/**
 * 🔴 Legacys Luft über dem, worüber die Leiste steigt: 6 px (`syncMapScaleBandLift`, MCS-029 §4).
 */
const GAP = 6;

/**
 * Was der Leiste am unteren Rand im Weg stehen kann. 🔴 **Legacys Auswahl, nicht unsere:** Betreiber
 * 11.08.2026 in Legacy, „schueb nach oben, aber nur ueber die zwei buttons. es is ok wenn es vom
 * suchfeld verdeckt werden sollte." Also die Verweiszeile (bei uns `.corner-links`) — nicht der ganze
 * Eckbund, nicht die Suchkachel, nicht der Fächer. Dazu der Toast, den Legacy nicht kennt, und die Hinweise zur Bitte um Freigabe
 * an seinem Platz (WI-0262; nur unten, oben am Telefon stehen sie der Leiste nicht im Weg).
 * Die Leiste der Reisebilder steht NICHT hier: Sie geht nach ihrer gemeldeten Höhe (`leisteUnten`, `scale-lift.ts`).
 */
const OBSTACLES = ['[data-testid="toast"]', ".corner-links", ".freigabe-hinweise--unten"];

/**
 * Wie weit die Leiste über ihre Ruhelage steigen muss, um unter nichts zu verschwinden.
 *
 * 💣 **Gemessen, nicht gerechnet** — dieselbe Lösung wie in Legacy: das Rechteck des Dings darüber plus
 * 6 px. Ausrechnen hieße Kartenrand plus Abstand plus Höhe, und die Höhe hängt am Inhalt (ein zweizeiliger
 * Toast ist doppelt so hoch, und die Verweiszeile stapelt auf schmalem Schirm).
 * 🪤 Gemessen wird die LAGE OHNE `transform`: Der Toast steigt beim Erscheinen 140 ms lang um 8 px auf,
 * und ein Hub aus dem Rechteck mitten in dieser Bewegung wäre genau um diese 8 px zu klein.
 * 🪤 Nur, was den PLATZ der Leiste waagerecht schneidet, hebt sie — am Rechner steht der Eckbund weit rechts von
 * der Bildmitte und kostet nichts. Damit braucht die Regel keine Telefonabfrage. Der Platz ist ihr Deckel, nicht
 * ihre heutige Breite (`scale-lift.ts`): sonst springt sie beim Zoomen.
 */
function obstacleLift(hostBox: DOMRect, span: number): number {
    const hindernisse: Hindernis[] = [];
    for (const selector of OBSTACLES) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            // Was ausgeblendet ist, steht nicht im Weg (der Eckbund tritt am Telefon zurück).
            // 💣 **Deckkraft zählt hier NICHT.** Der Toast beginnt sein Auffahren mit `opacity: 0`, und wer
            // danach fragt, misst genau in dem einen Bild, in dem die Leiste nachsieht: Der Hub blieb 0 und
            // wurde nie mehr nachgeholt, weil danach nichts mehr geschieht. Gemessen am 2026-10-07.
            const style = getComputedStyle(element);
            if (style.visibility === "hidden" || style.display === "none") continue;
            // Waagerecht gilt das gezeichnete Rechteck: Der `-50%` des Toasts steht vom ersten Bild an.
            const drawn = element.getBoundingClientRect();
            if (drawn.height <= 0) continue;
            hindernisse.push({ left: drawn.left, right: drawn.right, top: layoutBox(element).top });
        }
    }
    return massstabHub({
        mitte: (hostBox.left + hostBox.right) / 2,
        breite: Math.max(span, hostBox.width),
        fensterHoehe: window.innerHeight,
        leisteUnten: leisteUnten.value,
        hindernisse,
        luft: GAP,
    });
}

let frame: number | undefined;

function sample(): void {
    frame = undefined;
    const map = props.map;
    const element = host.value;
    if (!map || !element) return;
    const covered = props.insets?.() ?? {};
    const left = Math.max(0, covered.left ?? 0);
    const right = Math.max(0, covered.right ?? 0);
    const canvas = map.getCanvas();
    // 🔴 Die MITTE macht das Stilblatt (`left: 50%`), nicht diese Rechnung - wie Legacys `50vw`.
    // 💣 Sie stand hier einmal als gemessene Zahl, und das war falsch: Am Telefon maß der erste Lauf eine
    // 68 px breite Zeichenfläche, und die Leiste blieb bis zum nächsten Kartenereignis bei 34 px stehen.
    // Eine Mitte, die kein Ereignis braucht, kann nicht veralten.
    // Der Deckel der Breite richtet sich nach dem FREIEN Platz - er ist die Antwort auf „steht sie
    // jemandem im Weg", nicht auf „wo steht sie". Gemessen am Behälter, nicht an der Zeichenfläche:
    // deren Größe führt MapLibre selbst nach und sie ist beim ersten Bild noch nicht die endgültige.
    const span = scaleBarMaxWidth(map.getContainer().clientWidth - left - right);
    const hostBox = element.getBoundingClientRect();
    lift.value = obstacleLift(hostBox, span);
    // 🪤 Gemessen auf der Zeile der LINIE, nicht in der Mitte des Bauteils: geneigt sind das zwei
    // verschiedene Maßstäbe. Steht die Linie noch nicht, gilt die Unterkante.
    const frameBox = canvas.getBoundingClientRect();
    const box = (line.value ?? element).getBoundingClientRect();
    const row = box.bottom - frameBox.top;
    const perPixel = measureSchrittPerPixel(map, box.left - frameBox.left, row, span);
    reading.value = perPixel === undefined ? undefined : readScale(perPixel, span);
}

function schedule(): void {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(sample);
}

let detach: (() => void) | undefined;

function attach(map: MapLibreMap | undefined): void {
    detach?.();
    detach = undefined;
    if (!map) {
        reading.value = undefined;
        return;
    }
    // `move` deckt Rad, Pinch, Fahrt und Tastatur ab; `pitch` und `rotate` ändern den Maßstab an der Zeile.
    const events = ["move", "zoom", "pitch", "rotate", "resize"] as const;
    for (const name of events) map.on(name, schedule);
    detach = () => {
        for (const name of events) map.off(name, schedule);
    };
    schedule();
}

/**
 * Was im Weg steht, ändert seine Höhe im Betrieb: Der Toast wächst mit seinem Text, und die Verweiszeile
 * stapelt auf schmalem Schirm (Legacy: 32 px werden 70). Legacy hängt dafür einen `ResizeObserver` an die
 * Zeile; hier an alles, worüber die Leiste steigen kann.
 */
const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : undefined;

function watchObstacles(): void {
    sizes?.disconnect();
    for (const selector of OBSTACLES) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) sizes?.observe(element);
    }
    schedule();
}

watch(() => props.map, attach, { immediate: false });
watch(() => props.layout, schedule);
// Der Toast kommt und geht; erst im nächsten Bild steht sein Kasten im Dokument.
watch(currentToast, () => requestAnimationFrame(watchObstacles));
// Ebenso die Hinweise zur Bitte um Freigabe: Ihr Stapel kommt, geht und wächst mit jeder Bitte.
watch(hinweiseUnten, () => requestAnimationFrame(watchObstacles));
// Und die Leiste der Reisebilder (WI-0272 S4): Sie steht über die ganze Breite und hebt die Maßstabsleiste über ihre Oberkante.
// 🪤 Der Eckbund fährt mit ihr (`--avm-reisebilder-leiste`, 220 ms). Ein zweites Messen nach der Fahrt, sonst bliebe der
// Hub aus der Mitte der Bewegung stehen, bis die Karte sich wieder rührt.
const NACH_DER_FAHRT_MS = 260;
let nachDerFahrt: ReturnType<typeof setTimeout> | undefined;
watch(leisteUnten, () => {
    requestAnimationFrame(watchObstacles);
    if (nachDerFahrt !== undefined) clearTimeout(nachDerFahrt);
    nachDerFahrt = setTimeout(() => {
        nachDerFahrt = undefined;
        schedule();
    }, NACH_DER_FAHRT_MS);
});
onMounted(() => {
    attach(props.map);
    watchObstacles();
    window.addEventListener("resize", schedule);
});
onBeforeUnmount(() => {
    detach?.();
    sizes?.disconnect();
    window.removeEventListener("resize", schedule);
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (nachDerFahrt !== undefined) clearTimeout(nachDerFahrt);
});
</script>

<template>
    <div
        ref="host"
        class="scale-bar"
        :class="{ 'scale-bar--covered': covered, 'scale-bar--leer': reading === undefined }"
        :style="{
            '--scale-lift': `${String(lift)}px`,
            '--scale-ink': INK.color,
        }"
        :aria-label="t('scale.label')"
        data-testid="scale-bar"
    >
        <div
            ref="line"
            class="scale-bar__bar"
            :style="{ width: `${String(reading?.width ?? 1)}px` }"
            data-testid="scale-bar-bar"
            aria-hidden="true"
        >
            <span
                v-for="tick in TICKS"
                :key="tick.at"
                class="scale-bar__tick"
                :class="tick.major ? 'scale-bar__tick--major' : 'scale-bar__tick--minor'"
                :style="{ left: tick.at }"
            />
        </div>
        <p class="scale-bar__label" data-testid="scale-bar-label">{{ label }}</p>
    </div>
</template>

<style scoped>
/*
 * 🔴 Kein Farb-, Größen- oder Abstandsliteral: alles aus dem Kanon. Keine Fläche, kein Rahmen, kein
 * Radius, kein Panel-Schatten - die Leiste steht unmittelbar auf der Karte (Betreiber 2026-10-07).
 *
 * 💣 Was sie trägt, ist der Saum, nicht eine Scheibe: `colour` und `haloColor` der Ortsnamen
 * (`labelFamily("place")`, die EINE Regel der Kartenschrift, Guide §20) und `shadow.mapInk`, in Legacys
 * `map-scale-band.css` gemessen. Deshalb ist sie in beiden Themen dieselbe: Sie hebt sich von der Karte
 * ab, und die Karte hat kein dunkles Thema.
 */
.scale-bar {
    position: absolute;
    /*
     * 💣 Der Hub ERSETZT den Kartenrand, er kommt nicht dazu - genau wie Legacys Hub Leaflets
     * `margin-bottom: 10px` ersetzt. Addiert gemessen: 6 px Luft gewollt, 18 px herausgekommen.
     */
    bottom: max(var(--space-10), var(--scale-lift, 0px));
    left: 50%;
    z-index: var(--z-map-ui);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    transform: translateX(-50%);
    color: var(--scale-ink);
    /* Sie beantwortet eine Frage, sie nimmt keine: kein Klick, kein Tipp, kein Fokus. */
    pointer-events: none;
    /* Sie fährt nur senkrecht - der Toast steigt in 140 ms auf, die Leiste weicht in derselben Zeit. */
    transition: bottom 140ms ease;
}

/*
 * Steht die Kamera noch nicht, gibt es keinen Maßstab - dann ist die Leiste unsichtbar, behält aber
 * ihren Platz. 🪤 Kein `display: none`: Die Messung braucht die Zeile, auf der die Linie stehen WIRD.
 */
.scale-bar--leer {
    visibility: hidden;
}

/*
 * Am Telefon tritt sie zurück, solange Planer oder Infopanel die Karte decken - wie der Eckbund
 * (`.corner--covered`, app.vue). Erst blenden, dann verstecken.
 */
.scale-bar--covered {
    visibility: hidden;
    opacity: 0;
    transition:
        opacity 220ms ease,
        visibility 0s linear 220ms;
}

@media (prefers-reduced-motion: reduce) {
    .scale-bar,
    .scale-bar--covered {
        transition: none;
    }
}

/*
 * Der Balken: die Linie unten, die Marken darauf, Legacys Maße (Balken 18, groß 9, klein 2 px), hier an
 * den Abständen des Kanons ausgedrückt - `--space-16` ist 18 px, `--space-6` ist 8 px.
 * 🪤 Der Saum sitzt als `drop-shadow` am Balken, nicht als `box-shadow`: Er soll den Strichen folgen,
 * nicht ein Rechteck umranden. Dieselbe Trennung wie in Legacy.
 */
.scale-bar__bar {
    position: relative;
    height: var(--space-16);
    min-width: 1px;
    filter: drop-shadow(var(--shadow-map-ink));
}

.scale-bar__bar::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    background: currentcolor;
}

.scale-bar__tick {
    position: absolute;
    bottom: 0;
    width: 2px;
    background: currentcolor;
    transform: translateX(-50%);
}

.scale-bar__tick--major {
    height: var(--space-6);
}

.scale-bar__tick--minor {
    bottom: 2px;
    height: 2px;
}

.scale-bar__label {
    margin: 0;
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-shadow: var(--shadow-map-ink);
}
</style>
