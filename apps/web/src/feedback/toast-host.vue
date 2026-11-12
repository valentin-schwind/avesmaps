<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { currentToast, holdToast, releaseToast } from "./toast";
import { hinweiseUnten, leisteUnten } from "./unten-mitte";

/**
 * Der Platz des Toasts: fest unten mittig, über allem außer Dialogen (Guide §15.1). Stehen dort Hinweise zur Bitte um Freigabe
 * (WI-0262) oder die Leiste der Reisebilder (WI-0272), steigt er über sie.
 */
const ueberHinweisen = computed(() => {
    const hoch = hinweiseUnten.value + leisteUnten.value;
    return hoch > 0 ? { bottom: `calc(var(--space-16) + ${String(hoch)}px)` } : undefined;
});

/** Der Text vor und nach dem Link; steht der Link nicht im Satz, folgt er ihm. */
const around = computed(() => {
    const toast = currentToast.value;
    if (toast?.link === undefined) return null;
    const at = toast.text.indexOf(toast.link);
    return at < 0
        ? { before: `${toast.text} `, after: "" }
        : { before: toast.text.slice(0, at), after: toast.text.slice(at + toast.link.length) };
});
</script>

<template>
    <Transition name="toast">
        <div
            v-if="currentToast"
            :key="currentToast.id"
            class="toast"
            :class="[`toast--${currentToast.tone}`, { 'toast--aktionen': currentToast.aktionen !== undefined }]"
            :style="ueberHinweisen"
            role="status"
            aria-live="polite"
            data-testid="toast"
            @pointerenter="currentToast.aktionen && holdToast()"
            @pointerleave="currentToast.aktionen && releaseToast()"
            @focusin="currentToast.aktionen && holdToast()"
            @focusout="currentToast.aktionen && releaseToast()"
        >
            <!-- Mit Knöpfen (der Screenshot, WI-0274): Bild links, der Satz, die Knöpfe rechts. -->
            <template v-if="currentToast.aktionen">
                <button
                    v-if="currentToast.bild"
                    type="button"
                    class="toast__bild"
                    :title="currentToast.aktionen[0]?.text"
                    data-testid="toast-bild"
                    @click="currentToast.aktionen[0]?.tun()"
                >
                    <img :src="currentToast.bild.url" :alt="currentToast.bild.alt" />
                </button>
                <span class="toast__satz">{{ currentToast.text }}</span>
                <span class="toast__knoepfe">
                    <AvmKnopf
                        v-for="(aktion, nr) in currentToast.aktionen"
                        :key="aktion.text"
                        groesse="zeile"
                        :art="aktion.haupt ? 'gefuellt' : 'weich'"
                        :testid="`toast-aktion-${String(nr)}`"
                        @click="aktion.tun()"
                        >{{ aktion.text }}</AvmKnopf
                    >
                </span>
            </template>
            <!-- Der Link ist zum Mitnehmen da, nicht zum Folgen: Ein Klick markiert ihn, statt die Seite neu zu laden. -->
            <template v-else-if="around && currentToast.link !== undefined"
                >{{ around.before
                }}<a
                    class="toast__link"
                    :href="currentToast.link"
                    data-testid="toast-link"
                    @click.prevent
                    @pointerenter="holdToast"
                    @pointerleave="releaseToast"
                    @focus="holdToast"
                    @blur="releaseToast"
                    >{{ currentToast.link }}</a
                >{{ around.after }}</template
            >
            <template v-else>{{ currentToast.text }}</template>
        </div>
    </Transition>
</template>

<style scoped>
.toast {
    position: fixed;
    bottom: var(--space-16);
    left: 50%;
    z-index: var(--z-dialog);
    width: min(320px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: var(--space-8) var(--space-12);
    transform: translateX(-50%);
    border: 1px solid var(--color-toast-border);
    border-radius: var(--radius-lg);
    background: var(--color-toast-bg);
    box-shadow: var(--shadow-toast);
    color: var(--color-toast-text);
    font-size: var(--font-size-toast);
    line-height: 1.35;
    text-align: center;
    /* Die Meldung ist Auskunft, keine Schaltfläche: Klicks gehen an die Karte darunter - außer auf einen Link. */
    pointer-events: none;
}

.toast--success {
    border-color: var(--color-toast-border-success);
    background: var(--color-toast-bg-success);
}

.toast--warning {
    border-color: var(--color-toast-border-warning);
    background: var(--color-toast-bg-warning);
}

/* Mit Knöpfen: eine Reihe, so breit wie nötig; sie nimmt Klicks an. Am Telefon brechen die Knöpfe unter den Satz. */
.toast--aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    width: max-content;
    max-width: calc(100vw - 32px);
    padding: var(--space-6);
    text-align: left;
    pointer-events: auto;
}

.toast__bild {
    flex: none;
    padding: 0;
    overflow: hidden;
    /* Weißer Rahmen nur um die Vorschau im Toast (WI-0274); das Bild selbst bleibt unberührt, auch im Dunkeln. */
    border: var(--space-2) solid var(--color-media-text);
    border-radius: var(--radius-sm);
    background: none;
    cursor: zoom-in;
    transition: box-shadow 120ms ease;
}

.toast__bild:hover {
    box-shadow: var(--shadow-button-hover);
}

.toast__bild:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.toast__bild img {
    display: block;
    width: auto;
    max-width: 96px;
    height: 48px;
    object-fit: cover;
}

.toast__satz {
    flex: 1 1 12em;
    min-width: 0;
}

.toast__knoepfe {
    display: flex;
    flex: none;
    gap: var(--space-6);
    margin-left: auto;
}

/*
 * Der Link in der Meldung ist greifbar (§15.1): ein Klick markiert ihn ganz, ein langer Druck bietet
 * „Link kopieren“ an. In der Schrift der Meldung, unterstrichen - keine neue Farbe im Toast.
 */
.toast__link {
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: text;
    overflow-wrap: anywhere;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    -webkit-user-select: all;
    user-select: all;
    pointer-events: auto;
    transition:
        text-decoration-thickness 120ms ease,
        box-shadow 120ms ease;
}

.toast__link:hover {
    text-decoration-thickness: 2px;
}

.toast__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Er steigt auf, während er erscheint - 140 ms, die schnellste Bewegung des Hauses (§15.1). */
.toast-enter-active {
    transition:
        opacity 140ms ease,
        transform 140ms ease;
}

.toast-enter-from {
    opacity: 0;
    transform: translate(-50%, 8px);
}

.toast-leave-active {
    transition: opacity 120ms ease;
}

.toast-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .toast-enter-active,
    .toast-leave-active,
    .toast__link,
    .toast__bild {
        transition: none;
    }
}
</style>
