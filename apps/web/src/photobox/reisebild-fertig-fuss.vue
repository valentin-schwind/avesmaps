<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import ReisebildZeichen from "./reisebild-zeichen.vue";

/**
 * Der Fuß der Bestätigung (WI-0272, Entwurf 8): rechts „Schließen“; über der Zeile, nur solange vor dem Verlust des Links gewarnt wird, der Hinweis „Link noch nicht kopiert oder gemerkt.“ (Entwurf 9; ohne
 * Häkchen „… kopiert.“) mit „Kopieren“ (goldener kleiner Knopf) und dem leisen „Trotzdem schließen“ beziehungsweise „Trotzdem weiter“. Was die Knöpfe tun, entscheidet `reisebild-fenster.vue` nach `fertig-schutz.ts`: Der erste Versuch zu schließen oder ein neues
 * Bild zu beginnen hält an, der zweite geht durch.
 *
 * Der Fokus geht beim Erscheinen der Warnung auf „Kopieren“ (ohne zu rollen): Wer mit der Tastatur schließen wollte, landet auf dem Weg, den Link zu retten.
 */
const props = defineProps<{
    /** Steht die Warnung da? */
    warnt: boolean;
    /** Der Sprachschlüssel hinter dem leisen Knopf der Warnung („Trotzdem schließen“ oder „Trotzdem weiter“). */
    trotzdem: MessageKey;
    /** Lässt der Browser das Merken zu? Dann heißt der Hinweis „… kopiert oder gemerkt“, sonst nur „… kopiert“ (ohne Häkchen wäre „gemerkt“ ein Satz, der nicht stimmt). */
    merkenMoeglich: boolean;
}>();
const emit = defineEmits<{
    schliessen: [];
    "warn-kopieren": [];
    trotzdem: [];
}>();

const kopierKnopf = useTemplateRef<HTMLButtonElement>("kopierKnopf");
watch(
    () => props.warnt,
    (steht) => {
        if (steht) void nextTick(() => kopierKnopf.value?.focus({ preventScroll: true }));
    },
);
</script>

<template>
    <div class="rbs" :class="{ 'rbs--telefon': phoneViewport }" data-testid="reisebild-fertig-fuss">
        <div v-if="props.warnt" class="rbs__warnung" role="alert" data-testid="reisebild-fertig-warnung">
            <span class="rbs__text">{{
                props.merkenMoeglich ? t("photobox.fertig.warnungMerken") : t("photobox.fertig.warnung")
            }}</span>
            <span class="rbs__taten">
                <button
                    ref="kopierKnopf"
                    type="button"
                    class="rbs__klein"
                    data-testid="reisebild-fertig-warn-kopieren"
                    @click="emit('warn-kopieren')"
                >
                    <ReisebildZeichen name="kopie" />
                    <span>{{ t("photobox.fertig.warnKopieren") }}</span>
                </button>
                <button
                    type="button"
                    class="rbs__leise"
                    data-testid="reisebild-fertig-trotzdem"
                    @click="emit('trotzdem')"
                >
                    {{ t(props.trotzdem) }}
                </button>
            </span>
        </div>
        <div class="rbs__zeile">
            <AvmKnopf testid="reisebild-fertig-schliessen" @click="emit('schliessen')">{{
                t("photobox.fertig.schliessen")
            }}</AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
.rbs {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-16) var(--space-10);
}

.rbs--telefon {
    padding-bottom: max(var(--space-10), env(safe-area-inset-bottom, 0));
}

.rbs__zeile {
    display: flex;
    justify-content: flex-end;
}

.rbs__warnung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-10);
    padding: var(--space-6) var(--space-6) var(--space-6) var(--space-10);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-body);
    animation: rbs-ein 180ms ease;
}

@keyframes rbs-ein {
    from {
        opacity: 0;
        transform: translateY(var(--space-2));
    }
}

.rbs__taten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-left: auto;
}

/* Der kleine Knopf in der Akzentfarbe: Er rettet den Link. */
.rbs__klein {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    box-sizing: border-box;
    min-height: calc(var(--avm-control-h) - var(--space-2) / 2);
    padding: 0 var(--space-8) 0 var(--space-6);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-page-bg-deep);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease,
        transform 120ms ease;
}

.rbs__klein svg {
    width: calc(var(--icon-sm) - var(--space-2) / 4);
    height: calc(var(--icon-sm) - var(--space-2) / 4);
    stroke-width: 2;
}

.rbs__klein:hover {
    background: color-mix(in srgb, var(--color-accent) 86%, var(--color-text-strong));
    box-shadow: var(--shadow-button-hover);
    transform: translateY(-1px);
}

.rbs__klein:active {
    background: color-mix(in srgb, var(--color-accent) 80%, var(--color-page-bg-deep));
    box-shadow: none;
    transform: none;
}

.rbs__klein:focus-visible {
    outline: none;
    box-shadow:
        0 0 0 2px var(--color-panel),
        0 0 0 4px var(--color-accent);
}

/* Der leise Weg weiter: ohne Fläche, in der Schrift der Warnung. */
.rbs__leise {
    display: inline-flex;
    align-items: center;
    min-height: calc(var(--avm-control-h) - var(--space-2) / 2);
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-warning-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.rbs__leise:hover {
    border-color: var(--color-warning-soft-border);
    background: var(--color-hover-wash);
}

.rbs__leise:active {
    background: var(--color-active-wash);
}

.rbs__leise:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .rbs__warnung {
        animation: none;
    }

    .rbs__klein,
    .rbs__leise {
        transition: none;
    }

    .rbs__klein:hover {
        transform: none;
    }
}
</style>
