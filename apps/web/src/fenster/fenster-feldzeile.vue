<script setup lang="ts">
/**
 * EINE Feldzeile im Editor (Betreiber 2026-10-19 an den Eigenschaften der Herrschaftsgebiete, wörtlich: „glaubst man kann das so
 * angleichen?“, mit roten Linien an der Kante der Wiki-Felder). 🔴 HIER steht das Raster jeder Zeile mit Beschriftung und Feld in einer
 * Editorspalte; keine Zeile trägt ein eigenes:
 *
 * - **Drei Spalten** (`fenster-feldzeile-raster.css`): Beschriftung (130 px, `--avm-field-label-w`, Design Guide „Aufbau einer
 *   Feldzeile“) · das Feld (füllt) · ↺ (24 px). Die ↺-Spalte steht in JEDER Zeile, auch leer: So beginnen alle Felder an einer Kante
 *   und enden an einer.
 * - **Das Wiki-Feld** (`wiki-feld.vue`) ist diese Zeile mit Wiki-Wert hinter der Beschriftung und ↺ im Slot `zurueck`; eine Zeile ohne
 *   Wiki nimmt dieses Bauteil direkt, auch eine ohne Eingabe („keins (Wurzel) Umhängen …“). Eine Liste aus `<dt>`/`<dd>` nimmt
 *   `FensterFeldzeilen` (`fenster-feldzeilen.vue`), auf demselben Raster.
 * - **Das Feld füllt seine Spalte:** Die Hüllen von Eingabe, Auswahl und Textbereich tragen die Breite des Aufrufers und liefen sonst
 *   nur so breit wie ihr Inhalt. Mehrere Teile nebeneinander (Text und Verweis) gehören deshalb in EINE Hülle.
 * - **`oben`:** ein mehrzeiliges Feld (Textbereich); Beschriftung und ↺ stehen oben, nicht mittig.
 */
defineOptions({ name: "FensterFeldzeile" });

defineProps<{
    /** Die Beschriftung, übersetzt, ohne Doppelpunkt; der Slot `beschriftung` ersetzt sie. */
    name?: string | undefined;
    /** Die Kennung des Felds im Slot: Dann ist die Beschriftung ein `<label for>`. */
    fuer?: string | undefined;
    oben?: boolean | undefined;
    /** Der Zettel an der Beschriftung. */
    titel?: string | undefined;
    testid?: string | undefined;
}>();
</script>

<template>
    <div
        class="fenster-feldzeile fenster-feldzeile-raster"
        :class="{ 'fenster-feldzeile--oben': oben }"
        :data-testid="testid"
    >
        <component
            :is="fuer === undefined ? 'span' : 'label'"
            class="fenster-feldzeile__beschriftung"
            :for="fuer"
            :title="titel"
        >
            <slot name="beschriftung">{{ name }}</slot>
        </component>
        <div class="fenster-feldzeile__feld"><slot /></div>
        <span class="fenster-feldzeile__spalte"><slot name="zurueck" /></span>
    </div>
</template>

<style src="./fenster-feldzeile-raster.css"></style>

<style scoped>
.fenster-feldzeile {
    align-items: center;
}

.fenster-feldzeile__beschriftung {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

.fenster-feldzeile--oben {
    align-items: start;
}

.fenster-feldzeile--oben .fenster-feldzeile__beschriftung {
    padding-top: var(--space-6);
}

.fenster-feldzeile__feld {
    min-width: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.fenster-feldzeile__feld > :deep(*) {
    width: 100%;
}

.fenster-feldzeile__spalte {
    display: inline-flex;
    justify-content: center;
}
</style>
