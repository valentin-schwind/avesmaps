<script setup lang="ts">
import { t } from "../i18n/i18n";
import MapTooltip from "./map-tooltip.vue";

defineProps<{ from: string; to: string }>();
</script>

<template>
    <!-- Seite und Sichtbarkeit setzt die Platzierung (route-border-label-placement.ts) am Schild selbst. -->
    <MapTooltip data-testid="border-label">
        {{ t("planner.borders.step", { from, to }) }}
        <template #meta>{{ t("planner.borders.kind") }}</template>
    </MapTooltip>
</template>
