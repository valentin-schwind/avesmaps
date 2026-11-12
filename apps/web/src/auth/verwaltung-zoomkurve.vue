<script setup lang="ts">
/**
 * Der Kurveneditor der Zoomkurve (Standardwerte, Panel „Zoomkurve“; Betreiber 2026-11-09: „einen freien editor von stützpunkten auf einer
 * funktion (wie bei lüfterkurven) … nur dass ich auf die kurve klicken und neue stützpunkte erzeugen kann, um das zoom-winkel-verhältnis
 * selbst einzustellen“). Vorbild ist der Plot desselben Tages: Zoom waagerecht wie die Karte ihn anzeigt (MapLibre minus 1), Neigung
 * senkrecht, gestrichelt die Grenze nach Zoom (`maxPitchForZoom`), über der die Kamera an der Grenze bleibt.
 *
 * - **Ziehen** verschiebt einen Punkt, zwischen seinen Nachbarn; losgelassen wird gespeichert (`aendern`).
 * - **Klick auf die Kurve** setzt dort einen neuen Punkt, **Doppelklick** auf einen Punkt entfernt ihn (mindestens zwei bleiben).
 * - **Tastatur:** Punkte sind fokussierbar; Pfeile hoch und runter je 1°, links und rechts je 0,1 Zoom (mit Umschalt das Fünffache),
 *   Entfernen löscht. Gespeichert wird, wenn der Fokus den Editor verlässt.
 * - Gesperrt (ohne Recht, während eines Schreibwegs) nimmt er keine Eingabe an.
 */
import { computed, ref, watch } from "vue";
import { kurvenWert, type KurvenEinstellung, type KurvenPunkt } from "@avesmaps3d/shared";
import { formatDecimal, t } from "../i18n/i18n";
import { maxPitchForZoom } from "../map/camera/camera-math";

const props = defineProps<{
    einstellung: KurvenEinstellung;
    punkte: readonly KurvenPunkt[];
    /** Gesperrt mit Grund (oder leer), `undefined`: frei. */
    gesperrt: string | undefined;
    name: string;
    testid?: string;
}>();
const emit = defineEmits<{ aendern: [punkte: KurvenPunkt[]] }>();

/** Die Anzeige zählt eine Stufe niedriger als MapLibre (WI-0015). */
const ANZEIGE = 1;
const B = 640;
const H = 250;
const RAND = { links: 44, rechts: 14, oben: 12, unten: 34 };
const NEIGUNG_OBEN = 85;
const ZOOM_SCHRITT = 0.1;
const MIN_ABSTAND = 0.1;

const lokal = ref<KurvenPunkt[]>(props.punkte.map((p) => ({ ...p })));
const geaendert = ref(false);
watch(
    () => props.punkte,
    (neu) => {
        if (zug.value === null) {
            lokal.value = neu.map((p) => ({ ...p }));
            geaendert.value = false;
        }
    },
);

const frei = computed(() => props.gesperrt === undefined);
const zoomMin = computed(() => props.einstellung.zoom.min);
const zoomMax = computed(() => props.einstellung.zoom.max);
const x = (zoom: number): number =>
    RAND.links + ((zoom - zoomMin.value) / (zoomMax.value - zoomMin.value)) * (B - RAND.links - RAND.rechts);
const y = (neigung: number): number => H - RAND.unten - (neigung / NEIGUNG_OBEN) * (H - RAND.oben - RAND.unten);
const zoomAus = (px: number): number =>
    zoomMin.value + ((px - RAND.links) / (B - RAND.links - RAND.rechts)) * (zoomMax.value - zoomMin.value);
const neigungAus = (py: number): number => ((H - RAND.unten - py) / (H - RAND.oben - RAND.unten)) * NEIGUNG_OBEN;

const runde = (wert: number, schritt: number): number => Math.round(wert / schritt) * schritt;
const zahl = (wert: number, stellen: number): string => formatDecimal(wert, stellen);

/** Die Linie über die ganze Breite: vor dem ersten und hinter dem letzten Punkt waagerecht. */
const linie = computed(() => {
    const p = lokal.value;
    if (p.length === 0) return "";
    const teile = [`${x(zoomMin.value)},${y(p[0]!.neigung)}`, ...p.map((q) => `${x(q.zoom)},${y(q.neigung)}`)];
    teile.push(`${x(zoomMax.value)},${y(p[p.length - 1]!.neigung)}`);
    return teile.join(" ");
});
const grenze = computed(() => {
    const teile: string[] = [];
    for (let z = zoomMin.value; z <= zoomMax.value + 1e-9; z += 0.05) teile.push(`${x(z)},${y(maxPitchForZoom(z))}`);
    return teile.join(" ");
});
const zoomTicks = computed(() => {
    const ticks: number[] = [];
    for (let z = Math.ceil(zoomMin.value); z <= zoomMax.value + 1e-9; z += 1) ticks.push(z);
    return ticks;
});
const neigungTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80];
const ueberGrenze = computed(() => {
    for (let z = zoomMin.value; z <= zoomMax.value + 1e-9; z += 0.05)
        if (kurvenWert(lokal.value, z) > maxPitchForZoom(z) + 0.01) return true;
    return false;
});

const punktText = (p: KurvenPunkt): string =>
    t("admin.karteneinstellungen.curve.point", { zoom: zahl(p.zoom - ANZEIGE, 1), neigung: zahl(p.neigung, 0) });

// --- Ziehen ---------------------------------------------------------------------------------------------------------------------
const svg = ref<SVGSVGElement | null>(null);
const zug = ref<number | null>(null);
const aktiv = ref<number | null>(null);

function svgPunkt(event: PointerEvent | MouseEvent): { px: number; py: number } {
    const rahmen = svg.value!.getBoundingClientRect();
    return {
        px: ((event.clientX - rahmen.left) / rahmen.width) * B,
        py: ((event.clientY - rahmen.top) / rahmen.height) * H,
    };
}

/** Setzt Punkt `i` auf Zoom und Neigung, zwischen seinen Nachbarn und in den Grenzen der Einstellung. */
function setze(i: number, zoom: number, neigung: number): void {
    const p = lokal.value;
    const links = i > 0 ? p[i - 1]!.zoom + MIN_ABSTAND : zoomMin.value;
    const rechts = i < p.length - 1 ? p[i + 1]!.zoom - MIN_ABSTAND : zoomMax.value;
    const z = Math.min(rechts, Math.max(links, runde(zoom, ZOOM_SCHRITT / 2)));
    const n = Math.min(props.einstellung.neigung.max, Math.max(props.einstellung.neigung.min, runde(neigung, 0.5)));
    if (p[i]!.zoom === z && p[i]!.neigung === n) return;
    lokal.value = p.map((q, j) => (j === i ? { zoom: Math.round(z * 100) / 100, neigung: n } : q));
    geaendert.value = true;
}

function greife(i: number, event: PointerEvent): void {
    if (!frei.value) return;
    zug.value = i;
    aktiv.value = i;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
}
function ziehe(event: PointerEvent): void {
    if (zug.value === null) return;
    const { px, py } = svgPunkt(event);
    setze(zug.value, zoomAus(px), neigungAus(py));
}
function lasse(): void {
    if (zug.value === null) return;
    zug.value = null;
    melde();
}

/** Klick auf die Kurve: dort ein neuer Punkt, auf ihrer Höhe. */
function setzePunkt(event: MouseEvent): void {
    if (!frei.value || lokal.value.length >= props.einstellung.punkte.max) return;
    const zoom = runde(zoomAus(svgPunkt(event).px), ZOOM_SCHRITT / 2);
    if (zoom <= zoomMin.value || zoom >= zoomMax.value) return;
    if (lokal.value.some((p) => Math.abs(p.zoom - zoom) < MIN_ABSTAND)) return;
    const neu = { zoom: Math.round(zoom * 100) / 100, neigung: runde(kurvenWert(lokal.value, zoom), 0.5) };
    lokal.value = [...lokal.value, neu].sort((a, b) => a.zoom - b.zoom);
    aktiv.value = lokal.value.indexOf(neu);
    geaendert.value = true;
    melde();
}

function entferne(i: number): void {
    if (!frei.value || lokal.value.length <= props.einstellung.punkte.min) return;
    lokal.value = lokal.value.filter((_, j) => j !== i);
    aktiv.value = null;
    geaendert.value = true;
    melde();
}

function taste(i: number, event: KeyboardEvent): void {
    if (!frei.value) return;
    const p = lokal.value[i]!;
    const mal = event.shiftKey ? 5 : 1;
    const schritte: Record<string, [number, number]> = {
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
        ArrowRight: [ZOOM_SCHRITT, 0],
        ArrowLeft: [-ZOOM_SCHRITT, 0],
    };
    const schritt = schritte[event.key];
    if (schritt !== undefined) {
        event.preventDefault();
        setze(i, p.zoom + schritt[0] * mal, p.neigung + schritt[1] * mal);
    } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        entferne(i);
    } else if (event.key === "Enter") melde();
}

function melde(): void {
    if (!geaendert.value) return;
    geaendert.value = false;
    emit(
        "aendern",
        lokal.value.map((p) => ({ zoom: p.zoom, neigung: p.neigung })),
    );
}
function verlasse(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && svg.value?.contains(event.relatedTarget)) return;
    aktiv.value = null;
    melde();
}
</script>

<template>
    <div class="zoomkurve" :class="{ 'zoomkurve--gesperrt': !frei }" :data-testid="props.testid">
        <svg
            ref="svg"
            class="zoomkurve__flaeche"
            :viewBox="`0 0 ${B} ${H}`"
            role="group"
            :aria-label="props.name"
            @pointermove="ziehe"
            @pointerup="lasse"
            @pointercancel="lasse"
            @focusout="verlasse"
        >
            <g class="zoomkurve__gitter" aria-hidden="true">
                <line
                    v-for="n in neigungTicks"
                    :key="`n${n}`"
                    :x1="RAND.links"
                    :x2="B - RAND.rechts"
                    :y1="y(n)"
                    :y2="y(n)"
                />
                <line
                    v-for="z in zoomTicks"
                    :key="`z${z}`"
                    :x1="x(z)"
                    :x2="x(z)"
                    :y1="RAND.oben"
                    :y2="H - RAND.unten"
                />
            </g>
            <g class="zoomkurve__achse" aria-hidden="true">
                <text v-for="n in neigungTicks" :key="`tn${n}`" :x="RAND.links - 6" :y="y(n) + 4" text-anchor="end">
                    {{ n }}°
                </text>
                <text v-for="z in zoomTicks" :key="`tz${z}`" :x="x(z)" :y="H - RAND.unten + 16" text-anchor="middle">
                    {{ zahl(z - ANZEIGE, 0) }}
                </text>
                <text :x="(B + RAND.links) / 2" :y="H - 4" text-anchor="middle">
                    {{ t("admin.karteneinstellungen.curve.zoomAxis") }}
                </text>
            </g>
            <polyline class="zoomkurve__grenze" :points="grenze" aria-hidden="true" />
            <polyline class="zoomkurve__linie" :points="linie" aria-hidden="true" />
            <polyline
                class="zoomkurve__treffer"
                :points="linie"
                aria-hidden="true"
                data-testid="zoomkurve-linie"
                @click="setzePunkt"
            />
            <g
                v-for="(p, i) in lokal"
                :key="i"
                class="zoomkurve__punkt"
                :class="{ 'zoomkurve__punkt--aktiv': aktiv === i }"
                :tabindex="frei ? 0 : -1"
                role="slider"
                :aria-label="
                    t('admin.karteneinstellungen.curve.pointLabel', {
                        zoom: zahl(p.zoom - ANZEIGE, 1),
                        neigung: zahl(p.neigung, 0),
                    })
                "
                :aria-valuenow="p.neigung"
                :aria-valuemin="props.einstellung.neigung.min"
                :aria-valuemax="props.einstellung.neigung.max"
                :data-testid="`zoomkurve-punkt-${i}`"
                @pointerdown="greife(i, $event)"
                @dblclick="entferne(i)"
                @keydown="taste(i, $event)"
                @focus="aktiv = i"
            >
                <circle :cx="x(p.zoom)" :cy="y(p.neigung)" r="12" class="zoomkurve__griff" />
                <circle :cx="x(p.zoom)" :cy="y(p.neigung)" r="6" class="zoomkurve__kern" />
                <text
                    v-if="aktiv === i"
                    :x="Math.min(Math.max(x(p.zoom), RAND.links + 40), B - RAND.rechts - 40)"
                    :y="y(p.neigung) - 14"
                    text-anchor="middle"
                    class="zoomkurve__wert"
                >
                    {{ punktText(p) }}
                </text>
            </g>
        </svg>
        <p class="zoomkurve__legende" aria-hidden="true">
            <span class="zoomkurve__strich" /> {{ props.name }}
            <span class="zoomkurve__strich zoomkurve__strich--grenze" />
            {{ t("admin.karteneinstellungen.curve.limit") }}
            <span v-if="ueberGrenze" class="zoomkurve__warnung">{{
                t("admin.karteneinstellungen.curve.aboveLimit")
            }}</span>
        </p>
    </div>
</template>

<style scoped>
.zoomkurve {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zoomkurve__flaeche {
    width: 100%;
    height: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
    touch-action: none;
    user-select: none;
}

.zoomkurve__gitter line {
    stroke: var(--color-border);
    stroke-width: 1;
}

.zoomkurve__achse text {
    fill: var(--color-text-muted);
    font-size: 11px;
}

.zoomkurve__grenze {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.5;
    stroke-dasharray: 3 4;
}

.zoomkurve__linie {
    fill: none;
    stroke: var(--color-accent-strong);
    stroke-width: 2.5;
    stroke-linejoin: round;
}

/* Die breite, unsichtbare Spur über der Linie: dort setzt ein Klick einen Punkt. */
.zoomkurve__treffer {
    fill: none;
    stroke: transparent;
    stroke-width: 16;
    cursor: copy;
}

.zoomkurve__punkt {
    cursor: grab;
    outline: none;
}

.zoomkurve__griff {
    fill: transparent;
}

.zoomkurve__kern {
    fill: var(--color-panel);
    stroke: var(--color-accent-strong);
    stroke-width: 2.5;
    transition:
        r 120ms ease,
        fill 120ms ease;
}

.zoomkurve__punkt:hover .zoomkurve__kern,
.zoomkurve__punkt--aktiv .zoomkurve__kern {
    r: 7.5;
    fill: var(--color-accent-strong);
}

.zoomkurve__punkt:focus-visible .zoomkurve__griff {
    stroke: var(--color-focus, var(--color-accent-strong));
    stroke-width: 2;
}

.zoomkurve__wert {
    fill: var(--color-text);
    font-size: 12px;
    paint-order: stroke;
    stroke: var(--color-panel-muted);
    stroke-width: 4px;
}

.zoomkurve--gesperrt .zoomkurve__punkt,
.zoomkurve--gesperrt .zoomkurve__treffer {
    cursor: default;
    pointer-events: none;
}

.zoomkurve--gesperrt .zoomkurve__kern {
    stroke: var(--color-text-muted);
}

.zoomkurve__legende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zoomkurve__strich {
    display: inline-block;
    width: 18px;
    border-top: 2.5px solid var(--color-accent-strong);
}

.zoomkurve__strich--grenze {
    margin-left: var(--space-6);
    border-top: 1.5px dashed var(--color-text-muted);
}

.zoomkurve__warnung {
    margin-left: var(--space-6);
    color: var(--color-accent-strong);
}
</style>
