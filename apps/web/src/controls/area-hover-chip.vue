<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mapTooltipViewport, pickTooltipSide } from "../map/map-tooltip";
import MapTooltip from "../map/map-tooltip.vue";
import type { PointerHint } from "../map/pointer-hint";
import type { LabelSide } from "../map/route-border-label-placement";

/**
 * Das Zeiger-Schild für jede Art des Zeigens (WI-0043 Stufe 2, „A“; seit WI-0063 4.5 auch für Orte, Flüsse und Bäche): welche
 * Stelle ein Klick wählen würde, und ob dort noch andere liegen. Es ist ein Kartentooltip (Guide §15.3, Hülle `MapTooltip`):
 * Name und Art oben, der Hinweis leise darunter, ein Pfeil auf den Zeiger. Es ist eine Anzeige, kein Bedienelement: Es fängt
 * keinen Zeiger und keinen Fokus, hat keine Aktion und lädt nichts nach, und es liest sich für Screenreader nicht vor (die Liste
 * des Klicks nennt dieselben Flächen bedienbar). Was es zeigt, steht fertig in `PointerHint` (`map/pointer-hint.ts`).
 *
 * Es steht über dem Zeiger und weicht an den Rändern der Karte nach unten oder zur Seite aus - auch dem offenen Infopanel am
 * rechten Rand. Beim Verschwinden blendet es kurz aus (Betreiber 2026-10-03: alle Kartenschilder in einer Fassung).
 */

const props = defineProps<{ hint: PointerHint | undefined }>();

const anchor = ref<HTMLElement | null>(null);
const side = ref<LabelSide>("top");
/** Die letzte Lage: Beim Ausblenden bleibt das Schild, wo es war. */
const last = ref<PointerHint | undefined>(undefined);

watch(
    () => props.hint,
    (hint) => {
        if (!hint) return;
        last.value = hint;
        const box = anchor.value?.firstElementChild?.getBoundingClientRect();
        if (!box) return;
        side.value = pickTooltipSide(
            { x: hint.screen.x, y: hint.screen.y, width: box.width, height: box.height },
            mapTooltipViewport(),
        );
    },
    { flush: "post" },
);

const style = computed(() => {
    const at = last.value;
    return at ? { left: `${String(at.screen.x)}px`, top: `${String(at.screen.y)}px` } : {};
});
</script>

<template>
    <div ref="anchor" class="area-anchor" :style="style" aria-hidden="true">
        <Transition leave-active-class="map-tooltip--leave-active" leave-to-class="map-tooltip--leave-to">
            <MapTooltip v-if="hint" :side="side" data-testid="pointer-hint">
                {{ hint.type === "" ? hint.name : `${hint.name} · ${hint.type}` }}
                <template v-if="hint.note" #meta>{{ hint.note }}</template>
            </MapTooltip>
        </Transition>
    </div>
</template>

<style scoped>
/* Der Anker ist der Zeiger: ein Punkt ohne Ausdehnung über der Karte, an dem die Hülle hängt. */
.area-anchor {
    position: fixed;
    z-index: var(--z-map-menu);
    width: 0;
    height: 0;
    pointer-events: none;
}
</style>
