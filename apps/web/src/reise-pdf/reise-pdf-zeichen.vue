<script setup lang="ts">
import { PDF_ZEICHEN, type PdfForm, type PdfZeichenName } from "./reise-pdf-zeichen";

/**
 * Ein Linienzeichen von „Reise als PDF“ (`reise-pdf-zeichen.ts`): reiner Schmuck, für Vorleser versteckt; der Name steht im Text oder im
 * `aria-label` daneben. Größe und Farbe kommen vom Aufrufer (`currentColor`).
 */
const props = defineProps<{ name: PdfZeichenName }>();
const formen = (): readonly PdfForm[] => PDF_ZEICHEN[props.name];
</script>

<template>
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <template v-for="(form, nr) in formen()" :key="nr">
            <path v-if="form.art === 'pfad'" :d="form.d" />
            <circle v-else-if="form.art === 'kreis'" :cx="form.cx" :cy="form.cy" :r="form.r" />
            <rect v-else :x="form.x" :y="form.y" :width="form.w" :height="form.h" :rx="form.rx" />
        </template>
    </svg>
</template>
