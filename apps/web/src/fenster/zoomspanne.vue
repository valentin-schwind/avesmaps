<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../i18n/i18n";

/**
 * Die Zoomspanne (EDIT-0003 T27 Regel 7: „sichtbar ab und bis Zoom“ ist EINE Spanne mit EINEM Bauteil, Anfasser links und rechts):
 * für jeden Editor gleich, zuerst die Hierarchie der Herrschaftsgebiete (WI-0209 D2, von dort herausgezogen) und die Beschriftungen der
 * Landschaften (WI-0178), dann der Reiter „Zoombänder“ (WI-0221). Abgestimmt mit den Sitzungen „kartenverwaltung“ und Herrschaftsgebiete
 * (Kopf `zoomspanne-schnittstelle.md`, 2026-10-18).
 *
 * - Je Band eine Zelle (0 bis `oben`, Vorgabe 8), darunter der Balken der eigenen Spanne, an seinen Enden die Anfasser (`role="slider"`):
 *   ziehen, oder ←/→ (auch ↓/↑) je ein Band. Ein Zug meldet erst beim Loslassen (`aendere`): EIN Schritt im Entwurf.
 * - `von`/`bis` `undefined` heißt offen (Legacy NULL): Es gilt die Vorgabe, gepunktet um die Zellen (`vorgabe`).
 * - `stufen` färbt die Zellen (`data-stufe`, die Gebiete: gezeigt · verdeckt · aus); `markiert` rahmt ein Band (Vorschau „was ist bei Band n
 *   zu sehen“). `zellTitel` erklärt eine Zelle.
 * - `paar`: Ein Zug setzt immer beide Grenzen; eine offene nimmt die Vorgabe an (Beschriftungen der Landschaften: Der eigene Wert wirkt
 *   nur mit Min UND Max, Sicht `map_label_effective`, Migration 0057; dass er der Art vorgeht, ist WI-0221 F2).
 * - `tippen`: Ein Tipp auf eine Zelle außerhalb der Spanne zieht den nächsten Anfasser dorthin (am Telefon; Wunsch der Sitzung
 *   „kartenverwaltung“). Aus, wo ein Klick auf eine Zelle schon etwas anderes heißt.
 * - `gesperrt` (ein Satz): keine Anfasser, Zellen und Balken bleiben (nur Ansicht).
 * - Nicht drin: ⇉ (Spanne für Geschwister) und ↺ „Vorgabe“; das sind Handgriffe der Zeile, sie stehen beim Aufrufer am Zeilenende.
 */
// Der Dateiname bleibt, wie abgestimmt (`zoomspanne-schnittstelle.md`); der Name des Bauteils ist zweiteilig (vue/multi-word-component-names).
defineOptions({ name: "ZoomSpanne" });
const props = withDefaults(
    defineProps<{
        von: number | undefined;
        bis: number | undefined;
        oben?: number;
        vorgabe?: { von: number; bis: number } | undefined;
        stufen?: readonly string[] | undefined;
        zellTitel?: ((band: number) => string) | undefined;
        paar?: boolean;
        tippen?: boolean;
        markiert?: number | undefined;
        gesperrt?: string | undefined;
        /** Wofür die Spanne steht (aria der Anfasser). */
        name: string;
        /** Die aria-Beschriftung eines Anfassers; ohne Angabe „Zoom von: {name}“. */
        griffName?: ((seite: "von" | "bis") => string) | undefined;
        testid?: string | undefined;
    }>(),
    { oben: 8, paar: false, tippen: false },
);
const emit = defineEmits<{ aendere: [spanne: { von: number | undefined; bis: number | undefined }] }>();

type Seite = "von" | "bis";
const SEITEN: readonly Seite[] = ["von", "bis"];
const baender = computed(() => Array.from({ length: props.oben + 1 }, (_, b) => b));
const zellenKasten = ref<HTMLElement>();
/** Ein laufender Zug an einem Anfasser: die Spanne, wie sie beim Loslassen würde. */
const zug = ref<{ von: number | undefined; bis: number | undefined }>();
const spanne = computed(() => zug.value ?? { von: props.von, bis: props.bis });
const offen = computed(() => props.gesperrt === undefined);

/** Mit `paar` nimmt eine offene Grenze die Vorgabe an (sonst 0 bzw. das höchste Band). */
function vollstaendig(
    von: number | undefined,
    bis: number | undefined,
): { von: number | undefined; bis: number | undefined } {
    if (!props.paar) return { von, bis };
    return { von: von ?? props.vorgabe?.von ?? 0, bis: bis ?? props.vorgabe?.bis ?? props.oben };
}
function melde(von: number | undefined, bis: number | undefined): void {
    const neu = vollstaendig(von, bis);
    if (neu.von === props.von && neu.bis === props.bis) return;
    emit("aendere", neu);
}
/** Das Band unter dem Zeiger, aus den Zellen. */
function bandAm(event: PointerEvent): number {
    const box = zellenKasten.value?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return 0;
    const n = props.oben + 1;
    return Math.max(0, Math.min(props.oben, Math.floor(((event.clientX - box.left) / box.width) * n)));
}
let seiteImZug: Seite = "von";
function runter(event: PointerEvent, seite: Seite): void {
    if (!offen.value || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seiteImZug = seite;
    zug.value = { von: props.von, bis: props.bis };
}
function ziehen(event: PointerEvent): void {
    const jetzt = zug.value;
    if (jetzt === undefined) return;
    const b = bandAm(event);
    zug.value =
        seiteImZug === "von"
            ? { ...jetzt, von: Math.min(b, jetzt.bis ?? props.oben) }
            : { ...jetzt, bis: Math.max(b, jetzt.von ?? 0) };
}
function hoch(): void {
    const jetzt = zug.value;
    zug.value = undefined;
    if (jetzt !== undefined) melde(jetzt.von, jetzt.bis);
}
/** ←/→ (auch ↓/↑) am Anfasser: ein Band weiter, ein Schritt. */
function taste(event: KeyboardEvent, seite: Seite): void {
    const richtung = ["ArrowLeft", "ArrowDown"].includes(event.key)
        ? -1
        : ["ArrowRight", "ArrowUp"].includes(event.key)
          ? 1
          : 0;
    if (richtung === 0 || !offen.value) return;
    event.preventDefault();
    const von = props.von ?? 0;
    const bis = props.bis ?? props.oben;
    if (seite === "von") {
        const neu = Math.max(0, Math.min(bis, von + richtung));
        if (neu !== von) melde(neu, props.bis);
    } else {
        const neu = Math.max(von, Math.min(props.oben, bis + richtung));
        if (neu !== bis) melde(props.von, neu);
    }
}
/** Ein Tipp außerhalb der Spanne zieht den nächsten Anfasser dorthin. */
function tippe(b: number): void {
    if (!props.tippen || !offen.value) return;
    const von = props.von ?? 0;
    const bis = props.bis ?? props.oben;
    if (b < von) melde(b, props.bis);
    else if (b > bis) melde(props.von, b);
}

/** Der Balken der Spanne unter den Zellen, in Anteilen der Bandbreite (beim Ziehen die gezogene). */
const balken = computed((): Record<string, string> | undefined => {
    const { von, bis } = spanne.value;
    if (von === undefined && bis === undefined && zug.value === undefined) return undefined;
    const n = props.oben + 1;
    const a = von ?? 0;
    const e = bis ?? props.oben;
    return { left: `${(a / n) * 100}%`, width: `${((e - a + 1) / n) * 100}%` };
});
/** Wo ein Anfasser steht: links an „von“, rechts an „bis“. */
function griffLage(seite: Seite): Record<string, string> {
    const n = props.oben + 1;
    const stelle = seite === "von" ? (spanne.value.von ?? 0) : (spanne.value.bis ?? props.oben) + 1;
    return { left: `${(stelle / n) * 100}%` };
}
const griffName = (seite: Seite): string =>
    props.griffName?.(seite) ?? t(seite === "von" ? "zoomspanne.von" : "zoomspanne.bis", { name: props.name });
const imVorgabe = (b: number): boolean =>
    props.vorgabe !== undefined && b >= props.vorgabe.von && b <= props.vorgabe.bis;
</script>

<template>
    <span class="zs" :title="gesperrt" :data-testid="testid">
        <span ref="zellenKasten" class="zs__zellen" :style="{ '--zs-baender': oben + 1 }">
            <span
                v-for="b in baender"
                :key="b"
                class="zs__zelle"
                :class="{
                    'zs__zelle--vorgabe': imVorgabe(b),
                    'zs__zelle--markiert': markiert === b,
                    'zs__zelle--tippbar': tippen && offen,
                }"
                :data-stufe="stufen?.[b]"
                :title="zellTitel?.(b)"
                @click="tippe(b)"
            ></span>
        </span>
        <span v-if="balken" class="zs__spanne" :style="balken"></span>
        <template v-if="offen">
            <button
                v-for="seite in SEITEN"
                :key="seite"
                type="button"
                role="slider"
                class="zs__griff"
                :class="`zs__griff--${seite}`"
                :style="griffLage(seite)"
                :aria-label="griffName(seite)"
                aria-valuemin="0"
                :aria-valuemax="oben"
                :aria-valuenow="seite === 'von' ? (spanne.von ?? 0) : (spanne.bis ?? oben)"
                :data-testid="testid && `${testid}-griff-${seite}`"
                @pointerdown="runter($event, seite)"
                @pointermove="ziehen"
                @pointerup="hoch"
                @pointercancel="zug = undefined"
                @keydown="taste($event, seite)"
            ></button>
        </template>
    </span>
</template>

<style scoped>
/* Die Maße aus dem Kanon (Guide §12.6), einmal hier: Haarlinie, Zellhöhe, Anfasser. */
.zs {
    --zs-haar: calc(var(--space-2) / 4);
    --zs-zelle: var(--space-10);
    --zs-griff: var(--space-6);
    --zs-rund: calc(var(--space-2) / 2);

    position: relative;
    display: block;
    padding-bottom: var(--space-2);
}

/* Dasselbe Raster wie der Kopf (`zoomspanne-kopf.vue`): Spalten je Band, 1 px Abstand. So fluchten Zahlen und Zellen. */
.zs__zellen {
    display: grid;
    grid-template-columns: repeat(var(--zs-baender), minmax(0, 1fr));
    gap: var(--zs-haar);
}

.zs__zelle {
    height: var(--zs-zelle);
    border-radius: var(--zs-rund);
}

.zs__zelle--tippbar {
    cursor: pointer;
}

/* Die Gebiete (Blatt): gezeigt dunkel, verdeckt schraffiert hell, außerhalb leer. */
.zs__zelle[data-stufe="gezeigt"] {
    background: color-mix(in srgb, var(--color-accent-strong) 55%, transparent);
}

.zs__zelle[data-stufe="verdeckt"] {
    background: repeating-linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-text-muted) 35%, transparent) 0 var(--zs-rund),
        transparent var(--zs-rund) calc(var(--space-2) * 1.25)
    );
}

.zs__zelle[data-stufe="aus"] {
    box-shadow: inset 0 0 0 var(--zs-haar) color-mix(in srgb, var(--color-text-muted) 18%, transparent);
}

/* Ohne Stufen: leer umrandet (wer die wirksame Spanne zeigen will, gibt sie als Stufen gezeigt · aus). */
.zs__zelle:not([data-stufe]) {
    box-shadow: inset 0 0 0 var(--zs-haar) color-mix(in srgb, var(--color-text-muted) 18%, transparent);
}

/* Die Vorgabe: gepunktet umrandet (D2, T23 Frage 7). */
.zs__zelle--vorgabe {
    outline: var(--zs-haar) dotted color-mix(in srgb, var(--color-text-muted) 70%, transparent);
    outline-offset: calc(var(--zs-haar) * -1);
}

.zs__zelle--markiert {
    outline: var(--zs-rund) solid var(--color-accent-strong);
    outline-offset: calc(var(--zs-rund) * -1);
}

/* Die eigene Spanne als Strich unter den Zellen. */
.zs__spanne {
    position: absolute;
    bottom: 0;
    height: var(--zs-rund);
    border-radius: var(--zs-haar);
    background: var(--color-accent-strong);
    pointer-events: none;
}

/* Die Anfasser: schmale Griffe an den Enden, über dem Strich. */
.zs__griff {
    position: absolute;
    top: calc(var(--zs-rund) * -1);
    bottom: calc(var(--zs-rund) * -1);
    width: var(--zs-griff);
    margin-left: calc(var(--zs-griff) / -2);
    padding: 0;
    border: 1px solid var(--color-accent-strong);
    border-radius: var(--zs-rund);
    background: var(--color-panel);
    cursor: ew-resize;
    touch-action: none;
}

.zs__griff:hover,
.zs__griff:focus-visible {
    outline: none;
    background: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

/* Am Finger: Trefferfläche mindestens 24 px (Griff 8 plus zweimal 8), unsichtbar um den schmalen Griff. */
@media (pointer: coarse) {
    .zs__griff::before {
        position: absolute;
        inset: calc(var(--space-4) * -1) calc(var(--space-6) * -1);
        content: "";
    }
}
</style>
