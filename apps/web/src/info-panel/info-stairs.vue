<script setup lang="ts">
import type { SubjectRef } from "@avesmaps3d/shared";
import InfoLink from "./info-link.vue";
import type { StairRow } from "./panel-types";

/**
 * Die Treppe selbst (Legacy `.location-popup__breadcrumb-chain`): jede Stufe einen Schritt eingerückt und mit einem schwachen Winkel an
 * ihre Elternstufe geknüpft, die oberste ohne. Jede Stufe ist ein goldbrauner Link; bei einer Überlappung steht der Anteil dahinter.
 *
 * Trägt das Gebiet ein Wappen, steht es als kleiner Daumen VOR dem Namen, IM Link (WI-0094, Legacy
 * `settlementTerritoryCoatThumbMarkup`: das `<img>` steht im Knopf, vor dem Text). Der Winkel bleibt davor stehen - er hängt am
 * Einzug der Zeile, nicht am Textanfang. 🔴 Ohne Wappen gibt es keinen Platzhalter: Der Name rückt auf, wie in Legacy, wo der
 * Daumen bei leerer Adresse schlicht `""` liefert.
 */
defineProps<{ rows: StairRow[] }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();
</script>

<template>
    <div class="info-stairs" data-testid="info-stairs">
        <div
            v-for="(row, position) in rows"
            :key="position"
            class="info-stairs__row"
            :class="{ 'is-root': row.depth === 0 }"
            :style="{ '--depth': row.depth }"
            data-testid="info-stairs-row"
        >
            <InfoLink @open="emit('open', row.ref)"
                ><img
                    v-if="row.coat !== undefined"
                    class="info-stairs__coat"
                    data-testid="info-stairs-coat"
                    :src="row.coat.url"
                    :width="row.coat.width"
                    :height="row.coat.height"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                />{{ row.name }}</InfoLink
            ><span v-if="row.share !== undefined" class="info-stairs__share">{{ row.share }}</span>
        </div>
    </div>
</template>

<style scoped>
/* Ein Schritt je Stufe: die Skala trägt 14 (`--space-12`). */
.info-stairs {
    --step: var(--space-12);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.info-stairs__row {
    position: relative;
    padding-left: calc(var(--depth, 0) * var(--step));
}

.info-stairs__row + .info-stairs__row {
    margin-top: var(--space-2);
}

.info-stairs__row:not(.is-root)::before {
    content: "";
    position: absolute;
    top: calc(-1 * var(--space-2));
    left: calc(var(--depth, 0) * var(--step) - var(--space-6));
    width: var(--space-4);
    height: var(--space-12);
    border-bottom: 1px solid var(--color-text-muted);
    border-left: 1px solid var(--color-text-muted);
    border-bottom-left-radius: var(--radius-sm);
    pointer-events: none;
}

/*
 * Der Wappendaumen vor dem Namen (Legacy `.location-popup__breadcrumb-coat`, infopanel.css L695–703): 15 × 15 px, 4 px Luft zum
 * Namen (`space.2`), 3 px unter die Grundlinie - der Link behält seine Textgrundlinie, damit Winkel und Einzug der Treppe
 * stehen bleiben. `object-fit: contain` lässt hohe wie breite Wappen unverzerrt.
 */
.info-stairs__coat {
    display: inline-block;
    width: var(--avesmaps-infopanel-stair-coat);
    height: var(--avesmaps-infopanel-stair-coat);
    margin-right: var(--space-2);
    border-radius: var(--radius-sm);
    object-fit: contain;
    vertical-align: calc(-1 * var(--avesmaps-infopanel-stair-coat-drop));
}

.info-stairs__share {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
