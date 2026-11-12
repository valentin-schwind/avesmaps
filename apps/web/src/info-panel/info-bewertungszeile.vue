<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import { kopfzeileOf } from "./bewertungen-modell";
import InfoStars from "./info-stars.vue";
import type { OrtBewertungen } from "./bewertungen-quelle";

/**
 * Die Bewertungszeile im Kopf eines Orts (WI-0269 C10; Bedienkonzept §6.3, Variante „Reiter“): unter OFFIZIELL, in der Spalte des Namens, „3,8 ★★★★½ (10 Bewertungen)“; ein Klick auf die
 * Zählung öffnet den Reiter „Bewertungen“. Ein Ort ohne Bewertung sagt „Noch keine Bewertung“ (ohne Link: Schreiben geht über die Kachel darüber, Bedienkonzept §6.3).
 *
 * - **Die Zahl steht vor den Sternen** (Guide §16.6), die Zählung in Klammern. Der Tooltip am Wert nennt die Datenbasis („Durchschnitt der 23 sichtbaren Bewertungen“).
 * - **Schrift wie die Unterzeile des Kopfes** (13 px), die Zählung 12 px; das Bild der Sterne 14 px.
 * - Solange die Bewertungen laden, scheitern oder für Besucher ausgeblendet sind, steht hier nichts: Eine Zeile, die später springt, wäre schlimmer als eine, die kurz fehlt.
 */
const props = defineProps<{ bewertungen: OrtBewertungen; ort: string }>();
const emit = defineEmits<{ oeffnen: [] }>();

const zeile = computed(() => {
    if (props.bewertungen.pausiert.value || props.bewertungen.status.value !== "ready") return undefined;
    const section = props.bewertungen.section.value;
    return section === undefined ? undefined : kopfzeileOf(section);
});
</script>

<template>
    <p v-if="zeile !== undefined" class="info-bewzeile" data-testid="info-bewertungszeile">
        <template v-if="zeile.art === 'wert'">
            <b class="info-bewzeile__wert" :title="zeile.datenbasis" data-testid="info-bewertungszeile-wert">{{
                zeile.wert
            }}</b>
            <InfoStars :stars="zeile.sterne" :label="zeile.label" />
            <button
                type="button"
                class="info-bewzeile__zaehlung"
                :title="t('bewertungen.kopf.oeffnen', { name: ort })"
                data-testid="info-bewertungszeile-oeffnen"
                @click="emit('oeffnen')"
            >
                ({{ zeile.zaehlung }})
            </button>
        </template>
        <span v-else class="info-bewzeile__keine" data-testid="info-bewertungszeile-keine">{{
            t("bewertungen.kopf.keine")
        }}</span>
    </p>
</template>

<style scoped>
.info-bewzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-6) 0 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.info-bewzeile__wert {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-bold);
    font-variant-numeric: tabular-nums;
}

.info-bewzeile :deep(.info-stars__glyphs) {
    font-size: var(--font-size-reading);
}

/* Die Zählung ist ein Link auf den Reiter: wie die Links des Panels, ohne Rand und Fläche. */
.info-bewzeile__zaehlung {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition: color 120ms ease;
}

.info-bewzeile__zaehlung:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-bewzeile__zaehlung:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-bewzeile__keine {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .info-bewzeile__zaehlung {
        transition: none;
    }
}
</style>
