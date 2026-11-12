<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import { NEBEN_PANEL, besucher } from "./community-besucher";
import BewertungFenster from "./bewertung-fenster.vue";
import BewertungMeldenFenster from "./bewertung-melden-fenster.vue";
import KontaktFenster from "./kontakt-fenster.vue";
import MeldungFenster from "./meldung-fenster.vue";
import StatusFenster from "./status-fenster.vue";

/**
 * Der Wirt der Besucherseite der Meldungen (WI-0268 C2): hängt das Meldeformular, das Kontaktformular (C4), die Statusseite oder (WI-0269 C10) „Bewertung schreiben“ und „Bewertung melden“ ein, je nachdem was `community-besucher.ts` gerade zeigt, und trägt ihre Lage.
 * Die Seite (`app.vue`) hängt diesen einen Bauteil einmal ein und ruft sonst nur `oeffneMeldung`, `oeffneStelle` und `oeffneStatus`.
 *
 * 🔴 **Ein Werkzeugfenster der Hülle** (Bedienkonzept §1.3): Lage und Box hält die Steuerung, nicht das Fenster; ⧉ lösen, ▥ andocken und das Verschieben am Kopf melden nur und
 * schalten hier. Besucher haben keine Ablage: ein „versenkt“ der Hülle (es kann nur ein Zug über „Offene Bearbeitungen“ sein, und der gilt hier nicht) wird nicht übernommen.
 * Am Telefon gibt es nur angedockt (EDIT-0001 §4.1): Dort zeichnet dieser Wirt jedes Fenster angedockt, und die Lage der Steuerung bleibt, wie sie war.
 *
 * Beide Fenster sind statisch eingebunden, nicht nachgeladen: `nachladen.ts` ist der Weg der Editorfenster, und ein nachgeladenes Fenster stand unter Last später da, als die
 * Browserfälle warten (`vite.config.ts`, `nachladenStatisch`). Ein Besucher-Chunk für die zwei Bauteile wäre ein späterer Schritt, wenn die Größe es verlangt.
 */
const props = defineProps<{
    /** Steht rechts das Info- oder Editorpanel offen (am Rechner)? Dann dockt das Fenster links daneben an, nie darüber. */
    nebenPanel?: boolean;
}>();
const rand = computed(() => (props.nebenPanel === true && !phoneViewport.value ? NEBEN_PANEL : "0px"));
const anzeige = besucher.anzeige;
const offen = computed({
    get: () => besucher.anzeige.value !== undefined,
    set: (auf: boolean) => {
        if (!auf) besucher.schliesse();
    },
});
const lage = computed<FensterHuellenLage>(() => (phoneViewport.value ? "angedockt" : besucher.fenster.value.lage));
const box = computed(() => besucher.fenster.value.box);

function neueLage(neu: Exclude<FensterHuellenLage, "modal">, neueBox?: FensterBox): void {
    if (neu === "versenkt" || phoneViewport.value) return;
    besucher.setzeLage(neu, neueBox ?? box.value);
}
</script>

<template>
    <div v-if="anzeige !== undefined" class="besucher-rahmen" :style="{ right: rand }" data-testid="community-besucher">
        <MeldungFenster
            v-if="anzeige?.art === 'meldung'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :bezug="anzeige.bezug"
            :steuerung="besucher"
            :lage="lage"
            :box="box"
            @update:lage="neueLage"
            @update:box="(neu) => besucher.setzeBox(neu)"
            @status="(schluessel) => besucher.oeffneStatus(schluessel)"
        />
        <KontaktFenster
            v-else-if="anzeige?.art === 'kontakt'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :lage="lage"
            :box="box"
            @update:lage="neueLage"
            @update:box="(neu) => besucher.setzeBox(neu)"
            @status="(schluessel) => besucher.oeffneStatus(schluessel)"
        />
        <BewertungFenster
            v-else-if="anzeige?.art === 'bewertung'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :ziel="anzeige.ziel"
            :lage="lage"
            :box="box"
            @update:lage="neueLage"
            @update:box="(neu) => besucher.setzeBox(neu)"
        />
        <BewertungMeldenFenster
            v-else-if="anzeige?.art === 'bewertungMelden'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :ziel="anzeige.ziel"
            :lage="lage"
            :box="box"
            @update:lage="neueLage"
            @update:box="(neu) => besucher.setzeBox(neu)"
            @status="(schluessel) => besucher.oeffneStatus(schluessel)"
        />
        <StatusFenster
            v-else-if="anzeige?.art === 'status'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :schluessel="anzeige.schluessel"
            :lage="lage"
            :box="box"
            @update:lage="neueLage"
            @update:box="(neu) => besucher.setzeBox(neu)"
        />
    </div>
</template>

<style scoped>
/*
 * Der Rahmen der Besucherfenster: so groß wie die Karte, aber um die Breite des offenen Info- oder Editorpanels kürzer (`NEBEN_PANEL`, null ohne Panel und am
 * Telefon). Die Hülle dockt an SEINER rechten Kante an, also links neben dem Panel statt darüber (Betreiber 2026-10-31), und rechnet Breite und Höhe aus seinen Maßen.
 * Er fängt keinen Klick ab: Nur die Fenster darin nehmen Zeiger an. Wie `.redaktion-rahmen` in `community-redaktion.vue`.
 */
.besucher-rahmen {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
}

.besucher-rahmen > :deep(dialog) {
    pointer-events: auto;
}
</style>
