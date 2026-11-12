<script setup lang="ts">
import { computed } from "vue";
import AvmWert from "./avm-wert.vue";
import { laeufe } from "./wert";

/**
 * 🔴 Text in einer Klappbox mit seiner Rolle (Design Guide §16.3 und §17, Betreiber 2026-10-04: „numerische Mess-/Geldwerte
 * verwenden --color-text-strong und tabular-nums; Einheiten und Abkürzungen … sowie erläuternde Sekundärtexte verwenden
 * --color-text-muted; normale Fließtexte bleiben --color-text, reine Titel --color-text-strong“):
 *
 * | Rolle | Farbe |
 * |---|---|
 * | `text` (Fließtext, die Vorgabe) | `--color-text` |
 * | `sekundaer` (erläuternd: Herleitung, Hinweis, Kurzangabe) | `--color-text-muted` |
 * | `titel` (reiner Titel) | `--color-text-strong` |
 *
 * In jeder Rolle schneidet der Baustein die Werte aus dem fertig formatierten Text (`laeufe`) und setzt sie über `AvmWert`:
 * die Zahl hell mit Ziffern gleicher Breite, die Einheit gedämpft. Die Zahlen formatieren die vorhandenen Formatierer; hier
 * wird nichts neu formatiert. Der Text im DOM ist unverändert (Suche, Vorleser, Tests).
 */
const props = withDefaults(defineProps<{ text: string; rolle?: "text" | "sekundaer" | "titel" }>(), { rolle: "text" });
const teile = computed(() => laeufe(props.text));
</script>

<template>
    <span class="avm-text" :class="`avm-text--${rolle}`"
        ><template v-for="(teil, index) in teile" :key="index"
            ><AvmWert v-if="typeof teil !== 'string'" :werte="[teil]" /><template v-else>{{ teil }}</template></template
        ></span
    >
</template>

<style scoped>
.avm-text--text {
    color: var(--color-text);
}

.avm-text--sekundaer {
    color: var(--color-text-muted);
}

.avm-text--titel {
    color: var(--color-text-strong);
}
</style>
