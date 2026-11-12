<script setup lang="ts">
import { t } from "../i18n/i18n";
import ReisePdfZeichen from "./reise-pdf-zeichen.vue";

/**
 * Der Fuß von „Reise als PDF“ (WI-0306, Entwurf Fassung 6): links leise „5 Seiten · DIN A4 hoch · etwa 1,2 MB“, rechts „Abbrechen“ und der große
 * goldene Hauptknopf „PDF erstellen“, im Ton von „Bild hochladen“ (`photobox/reisebild-formular-fuss.vue`). Während das PDF entsteht, heißt er
 * „Wird erstellt …“ und dreht ein Rad (bei reduzierter Bewegung steht es); ein zweiter Druck tut dann nichts.
 *
 * Zustände nach Guide §30.5: Ruhe, Hover (hebt sich um einen Pixel), Aktiv, Fokus (Abstandsring), Beschäftigt; 120 bis 180 ms; nie Deckkraft.
 */
const props = defineProps<{
    /** Seiten, Format und Größe; leer, solange noch kein PDF steht. */
    info: string;
    erstellt: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ abbrechen: []; erstellen: [] }>();
</script>

<template>
    <div class="rpf" :class="{ 'rpf--telefon': props.telefon }" data-testid="reise-pdf-fuss">
        <span v-if="!props.telefon" class="rpf__info" data-testid="reise-pdf-info">{{ props.info }}</span>
        <span class="rpf__rechts">
            <button type="button" class="rpf__leise" data-testid="reise-pdf-abbrechen" @click="emit('abbrechen')">
                {{ t("reisePdf.abbrechen") }}
            </button>
            <button
                type="button"
                class="rpf__senden"
                :aria-busy="props.erstellt ? 'true' : undefined"
                data-testid="reise-pdf-erstellen"
                @click="emit('erstellen')"
            >
                <span v-if="props.erstellt" class="rpf__lauf" aria-hidden="true"></span>
                <ReisePdfZeichen v-else name="herunterladen" />
                <span>{{ props.erstellt ? t("reisePdf.erstellt") : t("reisePdf.erstellen") }}</span>
            </button>
        </span>
    </div>
</template>

<style scoped>
.rpf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-16) var(--space-10);
}

.rpf--telefon {
    padding-bottom: max(var(--space-10), env(safe-area-inset-bottom, 0));
}

.rpf__info {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.rpf__rechts {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-8);
    margin-left: auto;
}

.rpf--telefon .rpf__rechts {
    flex: 1 1 auto;
    justify-content: space-between;
}

/* „Abbrechen“: leise, ohne Fläche, bis man ihn berührt. */
.rpf__leise {
    display: inline-flex;
    align-items: center;
    min-height: var(--avm-control-h);
    padding: 0 var(--space-8);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.rpf__leise:hover {
    border-color: var(--color-button-soft-border);
    background: var(--color-button-soft-hover);
    color: var(--color-text-strong);
}

.rpf__leise:active {
    background: var(--color-button-soft-active);
}

.rpf__leise:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Der Hauptknopf in der Akzentfarbe, groß (wie `.rbf__senden` der Reisebilder). */
.rpf__senden {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-6);
    box-sizing: border-box;
    min-height: calc(var(--avm-control-h) + var(--space-10));
    padding: 0 var(--space-20) 0 var(--space-16);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    background: var(--color-accent);
    box-shadow: var(--shadow-field-rest);
    color: var(--color-page-bg-deep);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: var(--leading-tight);
    white-space: nowrap;
    transition:
        background-color 180ms ease,
        border-color 180ms ease,
        color 180ms ease,
        box-shadow 140ms ease,
        transform 120ms ease;
}

.rpf__senden svg {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 2;
}

.rpf__senden:hover {
    background: color-mix(in srgb, var(--color-accent) 86%, var(--color-text-strong));
    box-shadow: var(--shadow-button-hover-strong);
    transform: translateY(-1px);
}

.rpf__senden:active {
    background: color-mix(in srgb, var(--color-accent) 80%, var(--color-page-bg-deep));
    box-shadow: none;
    transform: none;
}

.rpf__senden:focus-visible {
    outline: none;
    box-shadow:
        0 0 0 2px var(--color-panel),
        0 0 0 5px var(--color-accent);
}

/* Beschäftigt: ein goldener Umriss, der wartet; das Rad dreht sich. */
.rpf__senden[aria-busy="true"] {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel));
    box-shadow: none;
    color: var(--color-accent-strong);
    cursor: progress;
    transform: none;
}

.rpf__lauf {
    width: var(--icon-sm);
    height: var(--icon-sm);
    box-sizing: border-box;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: rpf-dreh 0.8s linear infinite;
}

@keyframes rpf-dreh {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .rpf__leise,
    .rpf__senden {
        transition: none;
    }

    .rpf__senden:hover {
        transform: none;
    }

    .rpf__lauf {
        animation: none;
    }
}
</style>
