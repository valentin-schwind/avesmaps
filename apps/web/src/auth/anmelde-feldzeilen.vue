<script setup lang="ts">
/**
 * Feldzeilen eines Formulars der Anmeldung (Guide §8, Blatt A8): Beschriftung links mit Doppelpunkt, das Feld füllt; auch am
 * Telefon nie übereinander. Was über die ganze Breite geht (Meldung, Knopf), trägt die Klasse `breit`; ein Feld mit Hinweis
 * darunter steht in einem `<span class="feldwert">` (nicht `wert`: das ist die Hausklasse von `AvmWert`, die nie umbricht), seine Beschriftung oben (`oben`).
 */
defineEmits<{ submit: [] }>();
</script>

<template>
    <form class="feldzeilen" novalidate @submit.prevent="$emit('submit')">
        <slot />
    </form>
</template>

<style scoped>
.feldzeilen {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-8);
    margin: 0;
}

.feldzeilen :slotted(label) {
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.feldzeilen :slotted(label.oben) {
    align-self: start;
    margin-top: var(--space-6);
}

.feldzeilen :slotted(.feldwert) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.feldzeilen :slotted(.feldhinweis) {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.feldzeilen :slotted(.breit) {
    grid-column: 1 / -1;
}
</style>
