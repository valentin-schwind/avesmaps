<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MapTooltip from "../map-tooltip.vue";
import { KRINGEL_ECKE_PX } from "./bild";

/**
 * Das Schild am Ziel beim Anlegen (EDIT-0003 R9, R12; `anlegen.ts`): Es steht über dem Ziel unter dem Zeiger und sagt, was ein Klick
 * dort tut, oben das Ziel („Gareth“), darunter leise die Wirkung („Weg hier abschließen“). Ein Kartentooltip (Guide §15.3, Hülle
 * `MapTooltip`) über dem Kringel; es nimmt keinen Zeiger an. Den Satz bildet der Aufrufer, der Modus nennt nur das Ziel und die Lage.
 */
const props = defineProps<{ schild: { x: number; y: number; name: string; tut: string } | undefined }>();

/** Die letzte Lage: Beim Ausblenden bleibt das Schild, wo es war. */
const last = ref(props.schild);
watch(
    () => props.schild,
    (schild) => {
        if (schild) last.value = schild;
    },
);
const style = computed(() => {
    const at = last.value;
    return at ? { left: `${String(at.x)}px`, top: `${String(at.y - KRINGEL_ECKE_PX)}px` } : {};
});
</script>

<template>
    <div class="anlegen-schild" :style="style">
        <Transition leave-active-class="map-tooltip--leave-active" leave-to-class="map-tooltip--leave-to">
            <MapTooltip v-if="schild" data-testid="anlegen-schild">
                {{ schild.name }}
                <template #meta>{{ schild.tut }}</template>
            </MapTooltip>
        </Transition>
    </div>
</template>

<style scoped>
/* Der Anker ist die Stelle über dem Ziel: ein Punkt ohne Ausdehnung, an dem die Hülle hängt. */
.anlegen-schild {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
}
</style>
