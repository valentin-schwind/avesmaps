<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Camera, CameraState } from "../map/camera/camera";
import { t } from "../i18n/i18n";

/**
 * Der Steuerring (WI-0016, Konzept B, D8): EIN rundes Element für Zoom, Drehen und Norden.
 *
 * - Oben „+", unten „−": eine Zoomstufe.
 * - Links und rechts: zur nächsten der acht Himmelsrichtungen. Flach stehen dort Drehpfeile ↺ ↻,
 *   geneigt die Winkel ‹ › (WI-0040, Betreiber 2026-09-26: „die neuen kringel sind nur in 2D weil
 *   sie hier eine rotation auslösen“). Die Wirkung ist in beiden Ansichten dieselbe.
 * - Mitte: die Rosettenscheibe. Die goldene Nadel zeigt nach Norden und dreht sich mit der Karte.
 *   Geneigt wird sie nicht gestaucht, sondern räumlich: jede Spitze in eine Licht- und eine
 *   Schattenseite geteilt wie die Zacken von Legacys Windrose, in derselben Größe wie flach
 *   (Betreiber 2026-09-26: „sollte diesselbe größe haben wie in 2D“). Ein Klick richtet nach Norden
 *   aus, sonst nichts (D2, Kompass nur Norden).
 *
 * 🔴 Er ersetzt die Zoomknöpfe. Jede Zone ist ein echter Knopf mit Namen: so dreht auch, wer weder
 * ziehen noch zwei Finger benutzen kann (WCAG 2.5.1 und 2.5.7), und der Screenreader findet fünf
 * benannte Knöpfe statt einer Grafik.
 *
 * 🪤 Keine Tooltips: der Design Guide erklärt die Bedienung dort, wo sie stattfindet (§ 13.11).
 *
 * ⭐ `compact` (am Finger): kein Ring, nur die Rosette, und die nur, solange die Karte gedreht ist.
 * Betreiber 2026-09-23: „Mobil braucht kein Navigationsrad, … man kann alles mit 2 Fingern machen.“
 * Wer mit zwei Fingern aus Versehen gedreht hat, braucht trotzdem einen Weg zurück nach Norden - so
 * machen es auch Google und Apple. 💣 Offen (D10): Ohne Ring fehlt am Finger das Drehen und
 * Herauszoomen ohne zwei Finger, das K15 (WCAG 2.5.1) verlangt.
 */
const props = defineProps<{ camera: Camera; compact?: boolean }>();

/** Unter diesem Wert gilt die Karte als genordet: dann braucht es am Finger keinen Kompass. */
const NORTH_EPSILON = 0.5;
/** Unter diesem Wert gilt die Karte als flach (wie der 2D/3D-Schalter in camera-controls.vue). */
const FLAT_EPSILON = 0.5;

const state = ref<CameraState>(props.camera.state());
const stop = props.camera.onChange((next) => {
    state.value = next;
});
onBeforeUnmount(stop);

const rotated = computed(() => Math.abs(state.value.bearing) >= NORTH_EPSILON);
const tilted = computed(() => state.value.pitch > FLAT_EPSILON);

/** Die Nadel zeigt nach Norden: gegen die Drehung der Karte gedreht. */
const needleTransform = computed(() => `rotate(${(-state.value.bearing).toFixed(1)})`);

const northLabel = computed(() => {
    const degrees = Math.round(Math.abs(state.value.bearing));
    return degrees === 0 ? t("camera.northUp") : t("camera.northUp.rotated", { degrees });
});
</script>

<template>
    <div
        v-if="!compact || rotated"
        class="camera-ring"
        :class="{ 'camera-ring--compact': compact, 'camera-ring--tilted': tilted }"
        role="group"
        :aria-label="t('camera.group')"
        data-testid="camera-ring"
    >
        <template v-if="!compact">
            <button
                type="button"
                class="camera-ring__zone camera-ring__zone--in"
                :aria-label="t('camera.zoomIn')"
                data-testid="camera-zoom-in"
                @click="camera.zoomBy(1)"
            >
                <span aria-hidden="true">+</span>
            </button>
            <button
                type="button"
                class="camera-ring__zone camera-ring__zone--out"
                :aria-label="t('camera.zoomOut')"
                data-testid="camera-zoom-out"
                @click="camera.zoomBy(-1)"
            >
                <span aria-hidden="true">−</span>
            </button>
            <button
                type="button"
                class="camera-ring__zone camera-ring__zone--left"
                :aria-label="t('camera.rotateLeft')"
                data-testid="camera-rotate-left"
                @click="camera.rotateToNextDirection(-1)"
            >
                <span v-if="tilted" aria-hidden="true">‹</span>
                <!-- ↺: ein offener Bogen, die Spitze oben nach links. -->
                <svg v-else class="camera-ring__turn" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.17 8.9 A6.6 6.6 0 1 0 14.04 5.72" />
                    <path class="camera-ring__turn-head" d="M10.05 4.43 L13.4 8.99 L15.44 2.71 Z" />
                </svg>
            </button>
            <button
                type="button"
                class="camera-ring__zone camera-ring__zone--right"
                :aria-label="t('camera.rotateRight')"
                data-testid="camera-rotate-right"
                @click="camera.rotateToNextDirection(1)"
            >
                <span v-if="tilted" aria-hidden="true">›</span>
                <!-- ↻: das Spiegelbild. -->
                <svg v-else class="camera-ring__turn" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.83 8.9 A6.6 6.6 0 1 1 9.96 5.72" />
                    <path class="camera-ring__turn-head" d="M13.95 4.43 L10.6 8.99 L8.56 2.71 Z" />
                </svg>
            </button>
        </template>
        <button
            type="button"
            class="camera-ring__north"
            :aria-label="northLabel"
            data-testid="camera-north"
            @click="camera.northUp()"
        >
            <svg class="camera-ring__rose" viewBox="-20 -20 40 40" aria-hidden="true">
                <!-- C1 (D11): die Nadel steht frei auf der Scheibe, ohne Kreis um sich. Ihre Spitzen
                     reichen bis an den Rand der Zeichenfläche, und die steht 1 px innerhalb der
                     Scheibe (Betreiber 2026-09-23: „dass die spitzen 1px vom rand weg sind“). -->
                <g v-if="tilted" :transform="needleTransform">
                    <!-- Geneigt: je Spitze Licht links, Schatten rechts; Süd gedreht wie bei der Windrose.
                         Die Nordspitze steht zuerst, damit die Messung der Spitze dieselbe bleibt. -->
                    <polygon
                        class="camera-ring__needle-north camera-ring__facet-north-light"
                        points="0,-20 -5.8,0 0,0"
                    />
                    <polygon class="camera-ring__facet-north-shade" points="0,-20 5.8,0 0,0" />
                    <polygon class="camera-ring__facet-south-light" points="0,20 5.8,0 0,0" />
                    <polygon class="camera-ring__facet-south-shade" points="0,20 -5.8,0 0,0" />
                </g>
                <g v-else :transform="needleTransform">
                    <polygon class="camera-ring__needle-north" points="0,-20 -5.8,0 5.8,0" />
                    <polygon class="camera-ring__needle-south" points="0,20 -5.8,0 5.8,0" />
                </g>
                <circle class="camera-ring__pin" r="2.8" />
            </svg>
        </button>
    </div>
</template>

<style scoped>
/*
 * 🔴 Farben, Schatten und Linien kommen aus dem Kanon. Die Maße darunter sind BAUTEILMASSE des
 * Steuerrings: sie gehören diesem einen Bauteil und stehen deshalb hier, benannt, an einer Stelle
 * (dasselbe Muster wie die Suchkachel).
 *
 * Am Rechner hat jede Zone mehr als 24 px (WCAG 2.5.8), am Finger mindestens 44 px (Apple HIG):
 * Ring 136 px, Scheibe 48 px, also 44 px Band.
 */
.camera-ring {
    --ring-d: 88px;
    --ring-center-d: 36px;
    --ring-glyph: var(--font-size-title);
    --ring-turn-glyph: var(--icon-md);
    /* So weit bleiben die Spitzen der Nadel vom Rand der Scheibe weg. */
    --ring-needle-gap: 1px;

    position: relative;
    /* Der Ring liegt über dem unteren Rand der 2D/3D-Pille (WI-0040, P6). */
    z-index: 1;
    width: var(--ring-d);
    height: var(--ring-d);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

@media (pointer: coarse) {
    .camera-ring {
        --ring-d: 136px;
        --ring-center-d: 48px;
    }
}

/* Am Finger bleibt vom Ring nur die Rosette, so groß wie ein Fingerziel (44 px, Apple HIG). */
.camera-ring--compact {
    --ring-d: 44px;
    --ring-center-d: var(--ring-d);
}

.camera-ring--compact .camera-ring__north {
    border: 0;
}

.camera-ring:has(:focus-visible) {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-panel), var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Vier Viertel des Rings: jedes ein Keil von der Mitte bis zum Rand. */
.camera-ring__zone {
    position: absolute;
    inset: 0;
    display: flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--ring-glyph);
    line-height: 1;
}

.camera-ring__zone span {
    margin: auto;
}

.camera-ring__zone--in {
    clip-path: polygon(0 0, 100% 0, 50% 50%);
}
.camera-ring__zone--in span {
    margin-top: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-glyph) / 2);
}

.camera-ring__zone--out {
    clip-path: polygon(0 100%, 100% 100%, 50% 50%);
}
.camera-ring__zone--out span {
    margin-bottom: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-glyph) / 2);
}

.camera-ring__zone--left {
    clip-path: polygon(0 0, 0 100%, 50% 50%);
}
.camera-ring__zone--left span {
    margin-left: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-glyph) / 4);
}

.camera-ring__zone--right {
    clip-path: polygon(100% 0, 100% 100%, 50% 50%);
}
.camera-ring__zone--right span {
    margin-right: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-glyph) / 4);
}

/* Die Drehpfeile: Bedienzeichen in der Schriftfarbe, so kräftig wie + und −. */
.camera-ring__turn {
    /* Senkrecht mittig: oben im Feld schnitte der Keil der Zone das Zeichen weg. */
    margin-block: auto;
    width: var(--ring-turn-glyph);
    height: var(--ring-turn-glyph);
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
}
.camera-ring__zone--left .camera-ring__turn {
    margin-left: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-turn-glyph) / 2 + 1px);
}
.camera-ring__zone--right .camera-ring__turn {
    margin-left: auto;
    margin-right: calc((var(--ring-d) - var(--ring-center-d)) / 4 - var(--ring-turn-glyph) / 2 + 1px);
}
.camera-ring__turn-head {
    fill: currentColor;
    stroke: none;
}

.camera-ring__zone:hover {
    background: var(--color-hover-wash);
}

.camera-ring__zone:active,
.camera-ring__zone:focus-visible {
    outline: none;
    background: var(--color-active-wash);
}

/* Die Mitte: die Rosettenscheibe über den vier Keilen. */
.camera-ring__north {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    width: var(--ring-center-d);
    height: var(--ring-center-d);
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: var(--color-panel);
    cursor: pointer;
    transform: translate(-50%, -50%);
}

.camera-ring__north:hover {
    border-color: var(--color-border-strong);
    background: var(--color-hover-wash);
}

.camera-ring__north:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

/*
 * Die Zeichenfläche steht `--ring-needle-gap` innerhalb der Scheibe, und die Nadel reicht bis an
 * ihren Rand: so gilt der Abstand in jeder Größe, am Rechner, am Finger und ohne Ring.
 * `overflow: visible`, damit die Kantenglättung die Spitze nicht anschneidet.
 */
.camera-ring__rose {
    width: calc(100% - 2 * var(--ring-needle-gap));
    height: calc(100% - 2 * var(--ring-needle-gap));
    margin: auto;
    overflow: visible;
}

/* Gold in beiden Themen (WI-0040, P7). */
.camera-ring__needle-north {
    fill: var(--color-accent);
}

.camera-ring__needle-south {
    fill: var(--color-text-muted);
}

.camera-ring__pin {
    fill: var(--color-text-strong);
}

/* Geneigt: die Facetten aus dem Kanon (im Dunkeln getauscht, siehe $compassComment), ein leichter Schatten. */
.camera-ring--tilted .camera-ring__rose {
    filter: drop-shadow(var(--shadow-field-float));
}
.camera-ring .camera-ring__facet-north-light {
    fill: var(--color-compass-north-light);
}
.camera-ring__facet-north-shade {
    fill: var(--color-compass-north-shade);
}
.camera-ring__facet-south-light {
    fill: var(--color-compass-south-light);
}
.camera-ring__facet-south-shade {
    fill: var(--color-compass-south-shade);
}
.camera-ring--tilted .camera-ring__pin {
    fill: var(--color-accent-strong);
}
</style>
