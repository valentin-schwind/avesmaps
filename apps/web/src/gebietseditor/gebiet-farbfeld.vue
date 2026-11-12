<script setup lang="ts">
/**
 * Die feste Farbe eines Herrschaftsgebiets als kleines Feld (WI-0209 A3, D4; EDIT-0003 T38: jedes Gebiet hat seine Farbe, die Karte
 * zeigt sie 1:1). Ein Baustein für Fensterkopf, Eigenschaften, Untergebiete und die Zeilen der Hierarchie.
 *
 * - **Wählbar** (`wahl`, D4): Über dem Feld liegt die Farbwahl des Browsers, unsichtbar; ein Klick öffnet sie, übernommen wird beim
 *   Schließen (`change`, nicht jedes `input`), wie im Probierblatt. `wahl` ist der Name für Vorleser („Farbe von Kosch ändern“).
 * - Ohne `wahl` nur gezeigt.
 * - `gemischt` (Mehrfachauswahl, EDIT-0003 T57): Die gewählten haben verschiedene Farben; das Feld steht gestreift, jede Wahl gilt.
 */
const props = defineProps<{
    farbe: string;
    klein?: boolean | undefined;
    wahl?: string | undefined;
    gemischt?: boolean | undefined;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ farbe: [farbe: string] }>();

function gewaehlt(event: Event): void {
    const neu = (event.target as HTMLInputElement).value.toLowerCase();
    if (props.gemischt === true || neu !== props.farbe.toLowerCase()) emit("farbe", neu);
}
</script>

<template>
    <span
        class="farbfeld"
        :class="{ 'farbfeld--klein': klein, 'farbfeld--wahl': wahl !== undefined, 'farbfeld--gemischt': gemischt }"
        :style="{ '--farbe': farbe }"
        :aria-hidden="wahl === undefined ? 'true' : undefined"
        :title="wahl"
    >
        <input
            v-if="wahl !== undefined"
            type="color"
            class="farbfeld__wahl"
            :value="farbe.toLowerCase()"
            :aria-label="wahl"
            :data-testid="testid"
            @change="gewaehlt"
        />
    </span>
</template>

<style scoped>
.farbfeld {
    position: relative;
    flex: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: 3px;
    background: var(--farbe);
}

.farbfeld--gemischt {
    background: repeating-linear-gradient(45deg, var(--color-panel-muted) 0 3px, var(--color-border) 3px 6px);
}

.farbfeld--klein {
    width: 12px;
    height: 12px;
}

.farbfeld--wahl {
    cursor: pointer;
    transition: box-shadow 120ms ease;
}

.farbfeld--wahl:hover {
    box-shadow: 0 0 0 2px var(--color-active-wash);
}

.farbfeld--wahl:has(:focus-visible) {
    box-shadow: var(--focus-ring);
}

.farbfeld__wahl {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
    .farbfeld--wahl {
        transition: none;
    }
}
</style>
