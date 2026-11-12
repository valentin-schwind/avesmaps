<script setup lang="ts">
import FensterAbschnitt from "./fenster-abschnitt.vue";
import FensterText from "./fenster-text.vue";

/**
 * Die Quellenzeile am Ende eines Erklärfensters (Legacy `.tsi-sources`, Guide §17.12: „Ein
 * Erklärfenster nennt seine Quelle“): worauf die Zahlen beruhen. Beide Erklärfenster tragen sie -
 * deshalb steht sie hier und nicht zweimal (Guide §13.44).
 *
 * - „Grundlage“ goldbraun, das Werk in Textfarbe, 11 px; eine Anmerkung darunter gedämpft, mit
 *   Auszeichnung und Verweisen (`fenster-text.ts`).
 * - Ein Werk mit Verweis führt nach draußen und trägt dessen ↗ (Guide §13.42).
 * - Sie ist ein Abschnitt: die Trennlinie darüber, der Takt des Rumpfes davor.
 */
defineProps<{
    /** Die Aufschrift („Grundlage“). */
    grundlage: string;
    /** Die Werke mit Seiten („Geographia Aventurica S. 113–141“), je Werk gern `[Werk](https://…)`. */
    werke: string;
    /** Eine Anmerkung zur Herkunft, mit `*…*`, `**…**` und `[Verweis](https://…)`. */
    anmerkung?: string | undefined;
}>();
</script>

<template>
    <FensterAbschnitt class="fenster-quellen">
        <p class="fenster-quellen__zeile">
            <strong>{{ grundlage }}</strong> <FensterText als="span" :text="werke" />
        </p>
        <FensterText v-if="anmerkung" class="fenster-quellen__anmerkung" :text="anmerkung" />
    </FensterAbschnitt>
</template>

<style scoped>
.fenster-quellen {
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

.fenster-quellen__zeile {
    margin: 0;
}

.fenster-quellen__zeile strong {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-bold);
}

.fenster-quellen__anmerkung {
    margin-top: var(--space-2);
    color: var(--color-text-muted);
}
</style>
