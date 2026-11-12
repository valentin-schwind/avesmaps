<script setup lang="ts">
import { computed } from "vue";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { t } from "../i18n/i18n";
import SprachflaecheLeiste from "./sprachflaeche-leiste.vue";
import type { SpracheditorFuerSeite } from "./spracheditor-anbindung";
// Das Fenster lädt nach wie die übrigen Editorfenster (WI-0235, `nachladen.ts`); die Leisten bleiben statisch, `app.vue` misst sie.
import { SpracheditorFenster } from "../nachladen";

/**
 * Was der Spracheditor auf der Seite zeigt (WI-0261 S5d2): seine Fenster (je Sprache eins, sie verlegen sich selbst nach `body`) und seine
 * beiden Leisten über der Karte, die der Felder („Fertig“ schreibt Name, Legende, Farbe und Wiki-Artikel) und die von „◇ Fläche
 * bearbeiten“. `app.vue` hängt nur dieses eine Bauteil neben die übrigen Leisten (Hausregel „app.vue schmal“).
 *
 * Läuft „Fläche bearbeiten“, steht nur dessen Leiste; die der Felder kommt danach wieder, ihr Entwurf bleibt.
 */
const props = defineProps<{
    editor: SpracheditorFuerSeite;
    ablageZiel: () => DOMRect | undefined;
    /** Darf diese Sitzung Sprachen schreiben? */
    darf: boolean;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const seite = computed(() => props.editor.seite);
const felderLeiste = computed(() => (props.editor.modusLaeuft.value ? undefined : props.editor.aktiv.value));
</script>

<template>
    <SpracheditorFenster
        v-for="fenster in editor.fenster.value"
        :key="fenster.id"
        :fenster="fenster"
        :editor="editor"
        :ablage-ziel="ablageZiel"
        :darf="darf"
        :liste-zu="seite.listenSchalter.zu(fenster.id)"
        @lage="(lage, box) => seite.werkzeugfenster.setzeLage(fenster.id, lage, box)"
        @box="(box) => seite.werkzeugfenster.setzeBox(fenster.id, box)"
        @vorn="seite.werkzeugfenster.nachVorn(fenster.id)"
        @schliesse="seite.werkzeugfenster.schliesse(fenster.id)"
        @liste-zu="(zu: boolean) => seite.listenSchalter.schalte(fenster.id, zu)"
    />
    <EntwurfLeiste
        v-if="felderLeiste"
        :bearbeitung="felderLeiste"
        zeichen="bearbeiten"
        :titel="t('entwurf.felder')"
        :objekt="felderLeiste.stand.value?.felder.name || felderLeiste.detail.value?.name || ''"
        :gesten="t('entwurf.gestenFelder')"
        :rand="rand"
        testid="sprache-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
    <SprachflaecheLeiste :form="editor.form" :rand="rand" @hoehe="(px: number) => emit('hoehe', px)" />
</template>
