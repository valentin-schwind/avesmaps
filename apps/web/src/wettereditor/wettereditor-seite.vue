<script setup lang="ts">
import { computed } from "vue";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { ListenSchalter } from "../fenster/listen-schalter";
// Das Fenster lädt nach wie die übrigen Editorfenster (WI-0235, `nachladen.ts`).
import { WettereditorFenster } from "../nachladen";
import type { WettereditorHuelle } from "./wettereditor-huelle";

/**
 * Was der Wetter-Editor auf der Seite zeigt (WI-0288 Stufe 3): sein Fenster. `app.vue` hängt nur dieses eine Bauteil ein (Hausregel
 * „app.vue schmal“); Lage, Box und Liste schaltet die gemeinsame Fensterverwaltung. Fenster gibt es erst, wenn die Steuerung da ist
 * (`wettereditor-huelle.ts`).
 */
const props = defineProps<{
    editor: WettereditorHuelle;
    werkzeugfenster: Werkzeugfenster;
    listenSchalter: ListenSchalter;
    ablageZiel: () => DOMRect | undefined;
}>();

const geladen = computed(() => props.editor.editor.value);
</script>

<template>
    <template v-if="geladen">
        <WettereditorFenster
            v-for="fenster in geladen.fenster.value"
            :key="fenster.id"
            :fenster="fenster"
            :editor="geladen"
            :ablage-ziel="ablageZiel"
            :liste-zu="listenSchalter.zu(fenster.id)"
            @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
            @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
            @vorn="werkzeugfenster.nachVorn(fenster.id)"
            @schliesse="werkzeugfenster.schliesse(fenster.id)"
            @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
        />
    </template>
</template>
