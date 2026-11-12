<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Camera } from "../map/camera/camera";
import CameraRing from "./camera-ring.vue";
import ZoomstufeAnzeige from "./zoomstufe-anzeige.vue";
import { coarsePointer, ringOnTouch } from "./camera-settings";
import { t } from "../i18n/i18n";
import type { HinweisPlatz } from "./kamera-hinweis-platz";

/**
 * Die Kamera im Eckknopf-Bund (WI-0016): der Steuerring und darüber die Pille „2D | 3D“ (WI-0040).
 *
 * 🔴 Die Pille ändert NUR die Neigung (0° ↔ 45°, D2): wer mit Osten oben schaut und wieder flach
 * sehen will, verliert seine Ausrichtung nicht. Sie ist ein Segmentschalter wie DE | EN: außen
 * rund, in der Mitte gerade geteilt, die gewählte Hälfte gefüllt (Betreiber 2026-09-26, am Mockup
 * `review/kamera-pille/`). Sie ist nie breiter als der Ring, und der Ring liegt über ihrem unteren
 * Rand - beides zusammen liest sich als EIN Bauteil. Die gewählte Hälfte ist kein zweiter Schalter:
 * ein Klick darauf tut nichts.
 *
 * ⭐ Beim ersten Besuch steht EINMAL ein Hinweis daneben, wie man dreht und neigt (Betreiber
 * 2026-09-26: „für nutzer, die das erste mal die seite sehen“). Er bleibt, bis man ihn schließt,
 * und kommt danach nicht wieder. Gemerkt wird das im Browserspeicher des Geräts, kein Cookie und
 * nichts, was den Server erreicht.
 *
 * Am Finger gibt es keinen Ring, zwei Finger machen alles (D5, 2026-09-23) - außer der Schalter
 * „Steuerring auch am Handy“ ist an (D10), dann steht auch die Pille da. Ohne Ring bleibt es beim
 * runden Knopf mit der Kartenkachel (Betreiber 2026-09-26: „wir lassen das raster icon so wie es
 * ist“), und darüber steht, solange die Karte gedreht ist, der Kompass. Den Zustand trägt dort
 * allein das Zeichen - flach eine Kartenkachel von oben, eingeschaltet dieselbe Kachel gekippt;
 * für den Screenreader `aria-pressed`.
 */
const props = defineProps<{
    camera: Camera;
    /**
     * Wo der einmalige Hinweis steht (`kamera-hinweis-platz.ts`): ganz in der freien Fläche, fest im Browserfenster. `null`: Er passt
     * gerade nirgends ganz hin und wartet. Ohne Angabe (am Finger) steht er im Bund.
     */
    hinweisPlatz?: HinweisPlatz | null | undefined;
}>();

/** Unter diesem Wert gilt die Karte als flach. */
const FLAT_EPSILON = 0.5;
const HINT_STORAGE_KEY = "avesmaps3d.hinweis-3d";

const pitch = ref(props.camera.state().pitch);
const stop = props.camera.onChange((state) => {
    pitch.value = state.pitch;
});
onBeforeUnmount(stop);

const tilted = computed(() => pitch.value > FLAT_EPSILON);
const compact = computed(() => coarsePointer && !ringOnTouch.value);

/**
 * Das Zeichen des runden Knopfs kippt MIT der Karte, Grad für Grad und während jeder Fahrt, statt
 * zwischen zwei Bildern zu springen (Betreiber: „den Übergang der beiden Icons animieren“). Bis 45°
 * folgt es der Neigung, darüber bleibt es stehen, damit die Kachel lesbar bleibt; dabei wächst es
 * um ein Zehntel, wie die große gekippte Kachel aus der Abnahme. „Bewegung reduzieren“ gilt mit:
 * springt die Kamera, springt auch das Zeichen.
 */
const GLYPH_MAX_TILT = 45;
const GLYPH_GROWTH = 0.1;
const glyphStyle = computed(() => {
    const angle = Math.min(Math.max(pitch.value, 0), GLYPH_MAX_TILT);
    return {
        "--tilt-angle": `${angle.toFixed(1)}deg`,
        "--tilt-grow": (1 + (GLYPH_GROWTH * angle) / GLYPH_MAX_TILT).toFixed(3),
    };
});
const hintText = computed(() => (coarsePointer ? t("camera.hint.touch") : t("camera.hint.mouse")));

function hintSeen(): boolean {
    try {
        return globalThis.localStorage?.getItem(HINT_STORAGE_KEY) === "gesehen";
    } catch {
        // Ohne Speicher (privates Fenster) erscheint der Hinweis eben bei jedem Besuch einmal.
        return false;
    }
}

const hintVisible = ref(!hintSeen());

function toggle(): void {
    props.camera.toggleTilt();
}

/** Die Pille: nur die andere Hälfte schaltet. */
function choose(wantTilted: boolean): void {
    if (wantTilted !== tilted.value) {
        props.camera.toggleTilt();
    }
}

function closeHint(): void {
    hintVisible.value = false;
    try {
        globalThis.localStorage?.setItem(HINT_STORAGE_KEY, "gesehen");
    } catch {
        // siehe hintSeen
    }
}
</script>

<template>
    <div
        class="camera-controls"
        :class="{ 'camera-controls--compact': compact, 'camera-controls--finger': coarsePointer }"
        data-testid="camera-controls"
    >
        <p
            v-if="hintVisible && hinweisPlatz !== null"
            class="camera-hint"
            :class="{ 'camera-hint--frei': hinweisPlatz !== undefined }"
            :style="
                hinweisPlatz === undefined
                    ? undefined
                    : {
                          top: `${String(hinweisPlatz.top)}px`,
                          right: `${String(hinweisPlatz.right)}px`,
                          maxWidth: `min(${String(hinweisPlatz.maxWidth)}px, var(--camera-hint-max-w))`,
                      }
            "
            role="status"
            data-testid="camera-hint"
        >
            <span>{{ hintText }}</span>
            <button type="button" class="camera-hint__close" data-testid="camera-hint-close" @click="closeHint">
                {{ t("camera.hint.close") }}
            </button>
        </p>
        <div class="camera-dial" data-ziel-deckung>
            <div
                v-if="!compact"
                class="view-toggle"
                role="group"
                :aria-label="t('camera.view')"
                data-testid="camera-view"
            >
                <button
                    type="button"
                    class="view-toggle__option"
                    :class="{ 'is-active': !tilted }"
                    :aria-pressed="!tilted"
                    :aria-label="t('camera.view.flat')"
                    data-testid="camera-view-2d"
                    @click="choose(false)"
                >
                    <!-- Eine Kartenkachel von oben. -->
                    <svg class="view-toggle__glyph" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="1.8" />
                        <path stroke-width="1.1" d="M4 9.35 H20 M4 14.65 H20 M9.35 4 V20 M14.65 4 V20" />
                    </svg>
                    <span>2D</span>
                </button>
                <button
                    type="button"
                    class="view-toggle__option"
                    :class="{ 'is-active': tilted }"
                    :aria-pressed="tilted"
                    :aria-label="t('camera.view.tilted')"
                    data-testid="camera-view-3d"
                    @click="choose(true)"
                >
                    <!-- Ein Würfel, schräg von oben. -->
                    <svg class="view-toggle__glyph" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3.2 L19.8 7.6 V16.4 L12 20.8 L4.2 16.4 V7.6 Z" />
                        <path d="M4.2 7.6 L12 12 L19.8 7.6 M12 12 V20.8" />
                    </svg>
                    <span>3D</span>
                </button>
            </div>
            <CameraRing :camera="camera" :compact="compact" />
            <button
                v-if="compact"
                type="button"
                class="tilt-toggle"
                :aria-pressed="tilted"
                :aria-label="tilted ? t('camera.tiltFlat') : t('camera.tilt3d')"
                data-testid="camera-tilt"
                @click="toggle"
            >
                <!-- Eine Kartenkachel: flach von oben, geneigt kippt sie mit der Karte (`glyphStyle`). -->
                <svg
                    class="tilt-toggle__glyph"
                    :style="glyphStyle"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    aria-hidden="true"
                    data-testid="camera-tilt-glyph"
                >
                    <rect x="5" y="5" width="14" height="14" rx="1.5" />
                    <path stroke-width="1" d="M5 9.7 H19 M5 14.3 H19 M9.7 5 V19 M14.3 5 V19" />
                </svg>
            </button>
            <!-- Die Zoomstufe im Editor (WI-0129 R2, E3 A): unter dem Ring, sie wandert mit ihm. -->
            <ZoomstufeAnzeige class="camera-zoomstufe" :camera="camera" />
        </div>
    </div>
</template>

<style scoped>
/*
 * 🔴 Das Positionieren gehört dem Bund, das Aussehen den Knöpfen (Guide § 9). Farben, Linien und
 * Schatten kommen aus dem Kanon; die Maße darunter sind BAUTEILMASSE dieser Säule: die
 * Fingergröße nach Apple HIG, die Breite des einmaligen Hinweises, die Pille und der runde Knopf.
 */
.camera-controls {
    --camera-touch-target: 44px;
    --camera-hint-max-w: 16rem;
    /* Die Pille (WI-0040, am Mockup entschieden): Feldhöhe, Innenrand, Zeichen, Überlappung. */
    --view-option-h: 28px;
    --view-inset: 2px;
    --view-glyph: 12px;
    --view-overlap: 7px;
    --tilt-glyph: var(--icon-md);

    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
}

@media (pointer: coarse) {
    .camera-controls {
        /* Mit dem Ring am Finger (D10): 44 px hoch, so groß wie ein Fingerziel. */
        --view-option-h: 38px;
        --view-glyph: var(--icon-sm);
        --tilt-glyph: var(--icon-lg);
    }
}

/* Pille über Ring, beide gleich breit: der Ring gibt die Breite vor, die Pille streckt sich darauf. */
.camera-dial {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
}

/*
 * 🔴 Die Pille ist eine benannte Ausnahme der Radiusregel „keine Pillenform“ (Kanon, Guide § 7):
 * der Betreiber hat sie ausdrücklich so bestellt. Sie ist ein Segmentschalter wie DE | EN.
 */
.view-toggle {
    position: relative;
    display: flex;
    margin-bottom: calc(-1 * var(--view-overlap));
    padding: var(--view-inset);
    border: 1px solid var(--color-border);
    border-radius: calc(var(--view-option-h) / 2 + var(--view-inset) + 1px);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.view-toggle:has(:focus-visible) {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-panel), var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.view-toggle__option {
    display: inline-flex;
    flex: 1 1 0;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
    height: var(--view-option-h);
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    line-height: 1;
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

/* Außen rund, innen gerade: die Mitte ist ein senkrechter Schnitt mit einem Strich. */
.view-toggle__option:first-child {
    border-radius: calc(var(--view-option-h) / 2) 0 0 calc(var(--view-option-h) / 2);
}

.view-toggle__option:last-child {
    border-left: 1px solid var(--color-border);
    border-radius: 0 calc(var(--view-option-h) / 2) calc(var(--view-option-h) / 2) 0;
}

.view-toggle__glyph {
    flex: none;
    width: var(--view-glyph);
    height: var(--view-glyph);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
    stroke-linecap: round;
}

/* Gewählt: gefüllt wie DE | EN und Guide § 7, ohne Goldkante (Betreiber 2026-09-26). */
.view-toggle__option.is-active {
    background: var(--color-button);
    color: var(--color-button-text);
    cursor: default;
}

.view-toggle__option.is-active:last-child {
    border-left-color: var(--color-button);
}

/* 🪤 Die Hoverwäsche ist durchscheinend: sie liegt über der Fläche der Pille, nicht über der Karte. */
.view-toggle__option:not(.is-active):hover {
    background: var(--color-hover-wash);
    color: var(--color-text);
}

.view-toggle__option:not(.is-active):active,
.view-toggle__option:not(.is-active):focus-visible {
    outline: none;
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.view-toggle__option.is-active:focus-visible {
    outline: none;
}

/*
 * Ohne Ring: ein runder Knopf, darüber der Kompass, solange die Karte gedreht ist. Die Säule steht
 * unten im Bund: der Hinweis daneben wächst nach oben, der Knopf bleibt direkt über dem Auge.
 */
.camera-controls--compact {
    align-items: flex-end;
}

.camera-controls--compact .camera-dial {
    align-items: center;
    gap: var(--space-6);
}

.tilt-toggle {
    display: flex;
    width: var(--camera-touch-target);
    height: var(--camera-touch-target);
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text-strong);
    cursor: pointer;
}

.tilt-toggle__glyph {
    width: var(--tilt-glyph);
    height: var(--tilt-glyph);
    margin: auto;
    stroke: currentColor;
    /* Die Perspektive wächst mit dem Zeichen, damit es am Finger genauso kippt wie am Rechner. */
    transform: perspective(calc(var(--tilt-glyph) * 0.75)) rotateX(var(--tilt-angle, 0deg)) scale(var(--tilt-grow, 1));
}

.tilt-toggle:hover {
    border-color: var(--color-border-strong);
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.tilt-toggle:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--shadow-panel), var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .view-toggle,
    .view-toggle__option {
        transition: none;
    }
}

/*
 * Am Rechner steht der einmalige Hinweis fest an seiner Stelle in der freien Fläche (`kamera-hinweis-platz.ts`, Editor-Orchestrierung
 * 2026-10-19): Er verdeckt kein Fenster und keinen Planer, und nichts verdeckt ihn.
 */
.camera-hint--frei {
    position: fixed;
}

.camera-hint {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-4);
    max-width: var(--camera-hint-max-w);
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.camera-hint__close {
    padding: var(--space-2) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
}

.camera-hint__close:hover {
    background: var(--color-button-soft-hover);
}

.camera-hint__close:focus-visible {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Die Zoomstufe (WI-0129 R2, Blatt E3 A): mittig unter dem Ring, 8 px Luft wie auf dem Blatt. Sie hängt an der Scheibe, nimmt
 * keinen Platz im Bund und verschiebt deshalb nichts darunter.
 */
.camera-zoomstufe {
    position: absolute;
    top: calc(100% + var(--space-6));
    left: 50%;
    transform: translateX(-50%);
}

/* Am Finger steht der Kamerabund unten, und unter ihm liegt das Auge: Dort steht die Stufe links neben der Scheibe. */
.camera-controls--finger .camera-zoomstufe {
    top: 50%;
    right: calc(100% + var(--space-6));
    left: auto;
    transform: translateY(-50%);
}
</style>
