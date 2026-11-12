<script setup lang="ts">
import { LINIEN_ZEICHEN, type LinienZeichen } from "./reisebild-zeichen";

/**
 * Ein Linienzeichen des Formulars der Reisebilder (`reisebild-zeichen.ts`): reiner Schmuck, für Vorleser versteckt; der Name steht immer im Text daneben. Größe und Farbe
 * kommen vom Aufrufer (`currentColor`), die Strichstärke ist die des Hauses für kleine Zeichen.
 */
const props = defineProps<{ name: LinienZeichen }>();
</script>

<template>
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <template v-for="(form, nr) in LINIEN_ZEICHEN[props.name]" :key="nr">
            <path v-if="form.art === 'pfad'" :d="form.d" />
            <circle v-else-if="form.art === 'kreis'" :cx="form.cx" :cy="form.cy" :r="form.r" />
            <rect v-else :x="form.x" :y="form.y" :width="form.w" :height="form.h" :rx="form.rx" />
        </template>
    </svg>
</template>
