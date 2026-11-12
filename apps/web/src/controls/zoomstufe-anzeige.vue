<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { bandForRenderZoom, labelFamily } from "@avesmaps3d/shared";
import type { Camera } from "../map/camera/camera";
import { t } from "../i18n/i18n";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";

/**
 * Die Zoomstufe im Editor (WI-0129 R2, Betreiber 2026-10-10 E3 A: „Zoomanzeige unter dem Steuerring mit der Beschriftung ZOOM,
 * wie in deinem Entwurf. Die angezeigte Zahl muss die fachliche Zoomstufe sein.“).
 *
 * - Legacys Bauteil (Fall #100, Owner 25.08.2026: „mach weiße schrift auf transparentem untergrund“): die Ziffer 30 px, darunter
 *   „ZOOM“ in 9 px, weiß ohne Fläche, mit dem Schatten der Kartenschrift (Kanon `mapInk`, wie die Maßstabsleiste).
 * - Die Zahl ist die STUFE, nach der die Karte Orte und Namen ein- und ausblendet (`bandForRenderZoom`, 0..8), nie der
 *   MapLibre-Zoom; ein Zwischenstand zeigt die ganze Stufe darunter (MapLibre 7,4 ist Stufe 6). Sie läuft bei jeder
 *   Kamerabewegung mit.
 * - Nur im Editor-Modus, dieselbe Frage wie die übrigen Editorwerkzeuge (`view_flow_directions`); die Besuchervorschau blendet
 *   sie aus (`bootstrap-viewer.ts`).
 * - Sie sitzt in der Kamerasteuerung und wandert deshalb mit dem Ring, auch wenn ein Panel aufgeht. Sie nimmt keinen Klick und ist
 *   für den Screenreader stumm: Sie wiederholt nur, was die Karte zeigt.
 */
const props = defineProps<{ camera: Camera }>();

const editor = inject(VIEWER_CONTEXT_KEY)?.can("view_flow_directions") ?? false;
const zoom = ref(props.camera.state().zoom);
const stop = props.camera.onChange((state) => {
    zoom.value = state.zoom;
});
onBeforeUnmount(stop);

const band = computed(() => bandForRenderZoom(zoom.value));
/** Die Schrift der Ortsnamen: dasselbe Weiß, das ohne Fläche auf der Karte steht (wie die Maßstabsleiste). */
const INK = labelFamily("place").color;
</script>

<template>
    <div v-if="editor" class="zoomstufe" :style="{ '--zoomstufe-ink': INK }" aria-hidden="true" data-testid="zoomstufe">
        <span class="zoomstufe__zahl" data-testid="zoomstufe-zahl">{{ band }}</span>
        <span class="zoomstufe__wort">{{ t("camera.zoomstufe") }}</span>
    </div>
</template>

<style scoped>
.zoomstufe {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--zoomstufe-ink);
    line-height: 1;
    text-shadow: var(--shadow-map-ink);
    pointer-events: none;
    user-select: none;
}

.zoomstufe__zahl {
    font-size: var(--font-size-zoomstufe);
    font-variant-numeric: tabular-nums;
}

.zoomstufe__wort {
    margin-top: var(--space-2);
    font-size: var(--font-size-zoomstufe-wort);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}
</style>
