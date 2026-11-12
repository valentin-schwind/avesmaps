<script setup lang="ts">
import { computed } from "vue";
import { formatNumber, t } from "../i18n/i18n";
import type { Spanne, SpannenFolge } from "./zoombaender";

/**
 * Was eine neue Zoomspanne an den Untergebieten tut, vor „Fertig“ (T51, Entscheid A: „Untergebiete ziehen mit, ein Haken für Farbe und
 * Zoomspanne“; `spannenFolgen`): Haben sie sich mitverschoben, „Zieht mit:“ je Untergebiet mit Band vorher und jetzt; sonst was bleibt und
 * in welchen Bändern Gebiet und Untergebiete zugleich auf der Karte stehen. Für die Eigenschaften und den Reiter „Hierarchie“.
 */
const props = defineProps<{
    /** Die Untergebiete mit ihrer Spanne vom Start und im Entwurf. */
    folgen: readonly SpannenFolge[];
    /** Die Spanne des Gebiets im Entwurf. */
    spanne: Spanne;
    testid?: string | undefined;
}>();

const ZEILEN = 6;
const text = (s: Spanne): string => t("gebietseditor.unter.spanne", { von: s.min ?? 0, bis: s.max ?? 8 });
const gleich = (a: Spanne, b: Spanne): boolean => a.min === b.min && a.max === b.max;
/** Haben sich Untergebiete mitverschoben? Dann „Zieht mit“, sonst was bleibt (unabhängig vom Haken danach). */
const ziehen = computed(() => props.folgen.some((f) => !gleich(f.vorher, f.nachher)));
const bleiben = computed(() =>
    props.folgen
        .slice(0, ZEILEN)
        .map((f) => `${f.name} ${text(f.nachher)}`)
        .join(", "),
);
/** Die Bänder, in denen das Gebiet und Untergebiete zugleich stehen (Fassung 5, `ueberlagert`). */
const ueberlagert = computed((): string | undefined => {
    const baender: number[] = [];
    for (let b = props.spanne.min ?? 0; b <= (props.spanne.max ?? 8); b++)
        if (props.folgen.some((f) => (f.nachher.min ?? 0) <= b && b <= (f.nachher.max ?? 8))) baender.push(b);
    if (baender.length === 0) return undefined;
    return t("gebietseditor.spanne.ueberlagert", { baender: text({ min: baender[0], max: baender.at(-1) }) });
});
</script>

<template>
    <div v-if="folgen.length > 0" class="folgen" :class="{ 'folgen--warn': !ziehen }" :data-testid="testid">
        <template v-if="ziehen">
            <b>{{ t("gebietseditor.spanne.ziehtTitel") }}:</b>
            <ul>
                <li v-for="f in folgen.slice(0, ZEILEN)" :key="f.id">
                    {{
                        t("gebietseditor.spanne.zeile", {
                            name: f.name,
                            vorher: text(f.vorher),
                            nachher: text(f.nachher),
                        })
                    }}
                    <template v-if="gleich(f.vorher, f.nachher)">{{ t("gebietseditor.spanne.bleibt") }}</template>
                </li>
                <li v-if="folgen.length > ZEILEN">
                    {{ t("gebietseditor.sammel.weitere", { n: formatNumber(folgen.length - ZEILEN, 0) }) }}
                </li>
            </ul>
        </template>
        <template v-else>
            {{ t("gebietseditor.spanne.bleiben", { liste: bleiben }) }}
            {{ ueberlagert }}
        </template>
    </div>
</template>

<style scoped>
.folgen {
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.folgen ul {
    margin: 0;
    padding-left: var(--space-12);
}

.folgen--warn {
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}
</style>
