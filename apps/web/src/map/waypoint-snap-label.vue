<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MapTooltip from "./map-tooltip.vue";
import type { SnapLabel } from "./waypoint-drag";

/**
 * Das Namensschild über einer eingerasteten Wegpunktmarke (WI-0052): Es nennt den Ort, auf dem die Marke beim
 * Loslassen liegen wird. Es ist ein Kartentooltip (Guide §15.3, Hülle `MapTooltip`), mittig über der Marke mit dem Pfeil
 * auf sie; es nimmt keinen Zeiger an, die Geste gehört der Marke. Es steht immer darüber: Darunter läge es auf der
 * Marke, die der Betrachter gerade zieht. Es blendet kurz ein und aus.
 */
const props = defineProps<{ label: SnapLabel | null }>();

/** Die letzte Lage: Beim Ausblenden bleibt das Schild, wo es war. */
const last = ref<SnapLabel | null>(null);
watch(
    () => props.label,
    (label) => {
        if (label) last.value = label;
    },
    { immediate: true },
);

const style = computed(() => {
    const at = last.value;
    return at ? { left: `${String(at.x)}px`, top: `${String(at.y - at.lift)}px` } : {};
});
</script>

<template>
    <div class="snap-anchor" :style="style">
        <Transition leave-active-class="map-tooltip--leave-active" leave-to-class="map-tooltip--leave-to">
            <MapTooltip v-if="label" data-testid="waypoint-snap-label">{{ label.name }}</MapTooltip>
        </Transition>
    </div>
</template>

<style scoped>
/* Der Anker ist die Stelle über der Marke: ein Punkt ohne Ausdehnung, an dem die Hülle hängt. */
.snap-anchor {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
}
</style>
