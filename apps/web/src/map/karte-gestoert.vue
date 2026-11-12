<script setup lang="ts">
import { t } from "../i18n/i18n";
import { karteGestoert } from "./karte-gestoert";

/**
 * Der ruhige Hinweis über der Karte, wenn sie trotz geladener Seite nicht lädt (WI-0127 SYS-6, SYS-0001 §6.6). Er spricht den Satz
 * der Störungsseite (`scripts/dev/build-infoscreens.mjs`), mittig oben über der Karte, als Auskunft und nicht als Schaltfläche:
 * Klicks gehen an die Karte darunter, er schließt sich nicht von Hand, er geht von selbst, sobald die Kacheln zurück sind
 * (`karte-gestoert.ts`). Kein Fehlertext je Kachel, keine Farbe der Gefahr: Er sagt, was ist, und dass es vorbeigeht.
 */
</script>

<template>
    <Transition name="karte-gestoert">
        <div v-if="karteGestoert" class="karte-gestoert" role="status" aria-live="polite" data-testid="karte-gestoert">
            <p class="karte-gestoert__titel">{{ t("outage.title") }}</p>
            <p class="karte-gestoert__satz">{{ t("outage.text") }}</p>
        </div>
    </Transition>
</template>

<style scoped>
.karte-gestoert {
    position: fixed;
    top: calc(var(--avm-control-h) * 3);
    left: 50%;
    z-index: var(--z-map-menu);
    box-sizing: border-box;
    width: min(calc(var(--avm-fenster-lesespalte) + var(--avm-fenster-spalte)), 100vw - 2 * var(--space-12));
    padding: var(--space-10) var(--space-12);
    transform: translateX(-50%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    pointer-events: none;
}

.karte-gestoert__titel {
    margin: 0 0 var(--space-4);
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
}

.karte-gestoert__satz {
    margin: 0;
    color: var(--color-text-muted);
}

/* Er erscheint ohne Sprung (§29): 140 ms Deckkraft, wie der Toast. */
.karte-gestoert-enter-active,
.karte-gestoert-leave-active {
    transition: opacity 140ms ease;
}

.karte-gestoert-enter-from,
.karte-gestoert-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .karte-gestoert-enter-active,
    .karte-gestoert-leave-active {
        transition: none;
    }
}
</style>
