<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, watchEffect } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import BewertungRedaktionsFenster from "./bewertung-redaktion-fenster.vue";
import NeueMailFenster from "./neue-mail-fenster.vue";
import { redaktion } from "./redaktion";
import VorgangFenster from "./vorgang-fenster.vue";

/** Das Fenster eines Beitrags (WI-0270 C11) lädt erst beim Öffnen: Es ist groß und liegt sonst im Startpaket jedes Editors. */
const SocialFenster = defineAsyncComponent(() => import("./social-fenster.vue"));
/** Das Fenster eines Kartenvorschlags (WI-0275) ebenso. */
const KartenvorschlagFenster = defineAsyncComponent(() => import("./kartenvorschlag-redaktion-fenster.vue"));

/**
 * Der Wirt der Vorgangsfenster der Redaktion (WI-0268 C3): hängt je Eintrag der Fensterverwaltung mit dem Werkzeug `vorgang` ein Fenster ein und trägt dessen Lage. `app.vue` hängt diesen einen Bauteil
 * einmal ein (für Editoren) und verbindet die Steuerung (`redaktion.verbinde`); sonst weiß die Seite nichts von den Vorgängen.
 *
 * - 🔴 **Lage und Box gehören der Fensterverwaltung** (`werkzeugfenster`): ⧉ lösen, ▥ andocken, − ablegen und das Verschieben am Kopf melden nur und schalten dort; die Ablage unter „Offene Bearbeitungen“ und
 *   „Entwurf verwerfen?“ sind ihre Sache. Am Telefon gibt es nur angedockt oder abgelegt (EDIT-0001 §4.1): Ein gelöstes Fenster wird dort angedockt gezeichnet.
 * - 🔴 **Angedockt links neben dem Panel** (Bedienkonzept §1.1: „So bleibt die Liste stehen, die Karte daneben sichtbar“): Ein Fenster der Redaktion rückt um die Breite des offenen Panels nach links, statt es zu
 *   überdecken wie ein Editorfenster mit eigener Liste. Das tut nicht die Hülle (sie bleibt, wie sie ist), sondern dieser Wirt: Er ist der Rahmen, an dessen rechter Kante die Hülle andockt, und endet
 *   um `--community-rand` vor dem Rand der Karte. Die Breite steht an der Wurzel (`app.vue` rückt Laschen und Eckknöpfe um dieselbe Zahl); ohne offenes Panel ist sie null.
 */
const props = defineProps<{
    /** Die Rechte der Sitzung. */
    rechte: readonly string[];
    /** Steht das Editorpanel offen und vorn? Dann liegt ein angedocktes Fenster der Redaktion links daneben. */
    panelOffen: boolean;
}>();

const fenster = computed(() => [
    ...redaktion.vorgangFenster.value,
    ...redaktion.bewertungFenster.value,
    ...redaktion.kartenvorschlagFenster.value,
    ...redaktion.beitragFenster.value,
    ...redaktion.neueMailFenster.value,
]);
const bewertungen = redaktion.bewertungFenster;
const beitraege = redaktion.beitragFenster;
const RAND = "--community-rand";
/**
 * Genau die Breite des Editorpanels (`editor-panel.vue`: `--editor-w`), ohne Fuge: Angedockt schließt das Fenster bündig an das Panel an und steht von oben bis unten
 * (Betreiber 2026-10-31: „vollständig von oben nach unten gehen lassen und ohne spalt an den das editor-panel andocken“). Die Laschen rücken links neben das Fenster.
 */
const PANEL = "min(var(--avesmaps-infopanel-width), 100vw - var(--avesmaps-tab-w))";

const lageVon = (lage: FensterHuellenLage): FensterHuellenLage =>
    phoneViewport.value && lage === "geloest" ? "angedockt" : lage;

watchEffect(() => {
    const gedockt = fenster.value.some((eintrag) => lageVon(eintrag.lage) === "angedockt");
    document.documentElement.style.setProperty(
        RAND,
        gedockt && props.panelOffen && !phoneViewport.value ? PANEL : "0px",
    );
});
onBeforeUnmount(() => document.documentElement.style.removeProperty(RAND));

/** Wohin der Platzhalter beim Ablegen fliegt: die Fläche „Offene Bearbeitungen“, sonst die Lasche des Panels (wie der Ortseditor). */
function ablageZiel(): DOMRect | undefined {
    for (const ziel of ['[data-testid="editor-panel-bearbeitungen"]', '[data-testid="editor-panel-tab"]']) {
        const element = document.querySelector<HTMLElement>(ziel);
        if (element && element.getClientRects().length > 0) return element.getBoundingClientRect();
    }
    return undefined;
}
</script>

<template>
    <div
        v-if="fenster.length > 0"
        class="redaktion-rahmen"
        :class="{ 'redaktion-rahmen--telefon': phoneViewport }"
        data-testid="community-redaktion"
    >
        <!-- Die Fenster der Bewertungen (WI-0269 C10): dieselbe Hülle, dieselbe Lage wie die der Vorgänge. -->
        <BewertungRedaktionsFenster
            v-for="eintrag in bewertungen"
            :key="eintrag.id"
            :offen="true"
            :fenster="eintrag"
            :rechte="rechte"
            :lage="lageVon(eintrag.lage)"
            :box="eintrag.box"
            :ablage-ziel="ablageZiel"
            @update:offen="(an: boolean) => !an && redaktion.fenster.value?.schliesse(eintrag.id)"
            @update:lage="(lage, box) => redaktion.fenster.value?.setzeLage(eintrag.id, lage, box)"
            @update:box="(box) => redaktion.fenster.value?.setzeBox(eintrag.id, box)"
            @vorn="redaktion.fenster.value?.nachVorn(eintrag.id)"
        />
        <!-- Die Fenster der Kartenvorschläge (WI-0275): dieselbe Hülle, dieselbe Lage. -->
        <KartenvorschlagFenster
            v-for="eintrag in redaktion.kartenvorschlagFenster.value"
            :key="eintrag.id"
            :offen="true"
            :fenster="eintrag"
            :rechte="rechte"
            :lage="lageVon(eintrag.lage)"
            :box="eintrag.box"
            :ablage-ziel="ablageZiel"
            @update:offen="(an: boolean) => !an && redaktion.fenster.value?.schliesse(eintrag.id)"
            @update:lage="
                (lage: Exclude<FensterHuellenLage, 'modal'>, box?: FensterBox) =>
                    redaktion.fenster.value?.setzeLage(eintrag.id, lage, box)
            "
            @update:box="(box: FensterBox) => redaktion.fenster.value?.setzeBox(eintrag.id, box)"
            @vorn="redaktion.fenster.value?.nachVorn(eintrag.id)"
        />
        <!-- Die Fenster der Beiträge des Social Hubs (WI-0270 C11): dieselbe Hülle, dieselbe Lage. -->
        <SocialFenster
            v-for="eintrag in beitraege"
            :key="eintrag.id"
            :offen="true"
            :fenster="eintrag"
            :rechte="rechte"
            :lage="lageVon(eintrag.lage)"
            :box="eintrag.box"
            :ablage-ziel="ablageZiel"
            @update:offen="(an: boolean) => !an && redaktion.fenster.value?.schliesse(eintrag.id)"
            @update:lage="(lage, box) => redaktion.fenster.value?.setzeLage(eintrag.id, lage, box)"
            @update:box="(box) => redaktion.fenster.value?.setzeBox(eintrag.id, box)"
            @vorn="redaktion.fenster.value?.nachVorn(eintrag.id)"
        />
        <!-- Das Fenster „Neue Mail“ (WI-0268 C6a): dieselbe Hülle, dieselbe Lage. -->
        <NeueMailFenster
            v-for="eintrag in redaktion.neueMailFenster.value"
            :key="eintrag.id"
            :offen="true"
            :fenster="eintrag"
            :rechte="rechte"
            :lage="lageVon(eintrag.lage)"
            :box="eintrag.box"
            :ablage-ziel="ablageZiel"
            @update:offen="(an: boolean) => !an && redaktion.fenster.value?.schliesse(eintrag.id)"
            @update:lage="(lage, box) => redaktion.fenster.value?.setzeLage(eintrag.id, lage, box)"
            @update:box="(box) => redaktion.fenster.value?.setzeBox(eintrag.id, box)"
            @vorn="redaktion.fenster.value?.nachVorn(eintrag.id)"
        />
        <VorgangFenster
            v-for="eintrag in redaktion.vorgangFenster.value"
            :key="eintrag.id"
            :offen="true"
            :fenster="eintrag"
            :rechte="rechte"
            :lage="lageVon(eintrag.lage)"
            :box="eintrag.box"
            :ablage-ziel="ablageZiel"
            @update:offen="(an: boolean) => !an && redaktion.fenster.value?.schliesse(eintrag.id)"
            @update:lage="(lage, box) => redaktion.fenster.value?.setzeLage(eintrag.id, lage, box)"
            @update:box="(box) => redaktion.fenster.value?.setzeBox(eintrag.id, box)"
            @vorn="redaktion.fenster.value?.nachVorn(eintrag.id)"
        />
    </div>
</template>

<style scoped>
/*
 * Der Rahmen der Vorgangsfenster: so groß wie die Karte, aber um die Breite des offenen Panels kürzer (`--community-rand`, null ohne Panel und am Telefon). Die Hülle dockt an SEINER rechten
 * Kante an und rechnet ihre Breite und Höhe aus seinen Maßen, ohne dass hier eine ihrer Regeln überschrieben wird. Er fängt keinen Klick ab: Die Karte darunter bleibt bedienbar, nur die Fenster darin nehmen
 * Zeiger an.
 */
.redaktion-rahmen {
    position: absolute;
    top: 0;
    right: var(--community-rand, 0px);
    bottom: 0;
    left: 0;
    pointer-events: none;
}

/* Am Telefon gibt es kein Daneben, das Fenster liegt auf dem Panel. In derselben Schicht wie das Panel läge es dahinter, und ein Klick auf eine Zeile täte scheinbar nichts. */
.redaktion-rahmen--telefon {
    z-index: calc(var(--z-map-panel) + 1);
}

.redaktion-rahmen > :deep(dialog) {
    pointer-events: auto;
}
</style>
