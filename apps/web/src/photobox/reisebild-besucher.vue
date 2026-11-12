<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { NEBEN_PANEL } from "../community/community-besucher";
import { phoneViewport } from "../controls/phone-viewport";
import type { FensterBox, FensterHuellenLage, FensterVorgabeEcke } from "../fenster/fenster-lage";
import type { ReisebildHinweisZiel } from "../legal/hinweise-ziel";
import {
    REISEBILD_FENSTER,
    REISEBILD_STATUS_FENSTER,
    folgeFensterLinie,
    linienPfad,
    type FensterLinie,
    type LinienFolger,
} from "./fenster-linie";
import { reisebildBesucher as steuerung } from "./reisebild-besucher";
import MeineReisebilderFenster from "./meine-reisebilder-fenster.vue";
import ReisebildFenster from "./reisebild-fenster.vue";
import ReisebildStatusFenster from "./reisebild-status-fenster.vue";

/**
 * Der Wirt der Reisebilder auf der Besucherseite (WI-0272 S2b): hängt das Formular „Eigenes Bild hinzufügen“ (Aufgabe 13), die Statusseite oder die Liste „Meine Reisebilder“ (Entwurf 9) ein, je nachdem was `reisebild-besucher.ts` gerade
 * zeigt, trägt dessen Lage und zeichnet die Linie vom Fensterkopf zur Stelle (Aufgabe 12). Die Seite (`app.vue`) hängt diesen einen Bauteil einmal ein und ruft sonst nur
 * `reisebildBesucher.oeffne`.
 *
 * 🔴 **Ein Werkzeugfenster der Hülle** wie der Wirt der Meldungen (`community/community-besucher.vue`, dessen Dateien WI-0268 gerade umbaut; darum ein eigener Wirt): Lage und Box
 * hält die Steuerung. Gelöst steht das Fenster IMMER in der Mitte (`vorgabeEcke` „mitte“, bis jemand es zieht; Entwurf 8, Betreiber 2026-11-01), im Wählmodus („Stelle ändern“) als schmaler Balken
 * oben in der Mitte („oben-mitte“); angedockt steht es am rechten Rand neben dem offenen Panel. Die Kamera fliegt die Stelle in die freie Fläche neben dem Fenster (`stelle-layer.ts`).
 * 🔴 **Am Telefon ist es das Blatt unten** (`telefon-blatt` der Hülle): angedockt, so hoch wie der Inhalt, die Karte darüber bleibt frei; die Kamera fliegt die Stelle dorthin
 * (`stelle-layer.ts`). Es gibt dort nur diese Lage, und die Lage der Steuerung bleibt, wie sie war.
 * 🔴 **Die Linie zur Stelle** (Vali 2026-10-31) beginnt am Kopf des Fensters, folgt Karte und Fenster, zeichnet sich beim Öffnen einmal und entfällt, wo das Fenster die Stelle
 * verdeckt (`fenster-linie.ts`). Im Wählmodus gibt es keine: Die Stelle ändert sich gerade.
 * 🔴 **Auch die Statusseite zieht sie**, sobald „Auf der Karte zeigen“ ausgelöst ist (Stage-Fund; Vali 2026-11-01): dieselbe Linie, dieselbe Zeichnung beim Auslösen, bis die Seite schließt.
 */
const props = defineProps<{
    /** Steht rechts das Info- oder Editorpanel offen (am Rechner)? Dann dockt das Fenster links daneben an, nie darüber. */
    nebenPanel?: boolean;
}>();
const emit = defineEmits<{
    /** „Bedingungen“ im Häkchen der Erklärung und „Mehr zum Datenschutz“ unter dem Kurzsatz: die Hinweise bei ihrem Abschnitt öffnen (die Seite hängt `openNotes` daran). */
    hinweise: [ziel: ReisebildHinweisZiel];
}>();

const rand = computed(() => (props.nebenPanel === true && !phoneViewport.value ? NEBEN_PANEL : "0px"));

const anzeige = steuerung.anzeige;
const offen = computed({
    get: () => steuerung.anzeige.value !== undefined,
    set: (auf: boolean) => {
        if (!auf) steuerung.schliesse();
    },
});
/**
 * Soll gerade eine Linie zur Stelle stehen? Beim Formular, solange die Stelle nicht abgegeben ist und nicht gewählt wird; bei der Statusseite, nachdem „Auf der Karte zeigen“
 * die Stelle gezeigt hat (`gezeigt`). Sonst nie.
 */
const linieAn = computed(() => {
    const jetzt = anzeige.value;
    if (jetzt?.art === "formular") return jetzt.abgesendet !== true && !steuerung.waehlen.value;
    return jetzt?.art === "status" && steuerung.gezeigt.value !== undefined;
});
const lage = computed<FensterHuellenLage>(() => (phoneViewport.value ? "angedockt" : steuerung.fenster.value.lage));
const box = computed(() => steuerung.fenster.value.box);
/** Immer die Mitte; im Wählmodus („Stelle ändern“) der schmale Balken oben in der Mitte, damit die Karte zum Tippen frei bleibt. */
const vorgabeEcke = computed<FensterVorgabeEcke>(() => (steuerung.waehlen.value ? "oben-mitte" : "mitte"));

function neueLage(neu: Exclude<FensterHuellenLage, "modal">, neueBox?: FensterBox): void {
    if (neu === "versenkt" || phoneViewport.value) return;
    steuerung.setzeLage(neu, neueBox ?? box.value);
}

// --- Die Linie vom Fensterkopf zur Stelle ---------------------------------------------------------------------------------

const linie = shallowRef<FensterLinie | undefined>(undefined);
/** Die ersten 560 ms nach dem Öffnen zeichnet sich die Linie vom Fenster zur Stelle (einmal; ein späteres Neuberechnen startet sie nicht neu). */
const zeichnetSich = ref(false);
let uhr: ReturnType<typeof setTimeout> | undefined;
let folger: LinienFolger | undefined;

onMounted(() => {
    folger = folgeFensterLinie({
        stelle: () => steuerung.schirm.value,
        fenster: () =>
            document.querySelector<HTMLDialogElement>(
                `[data-testid="${REISEBILD_FENSTER}"], [data-testid="${REISEBILD_STATUS_FENSTER}"]`,
            ),
        aktiv: () => linieAn.value,
        zeichne: (neu) => {
            linie.value = neu;
        },
    });
    folger.aktualisiere();
});
onBeforeUnmount(() => {
    folger?.stop();
    clearTimeout(uhr);
});
watch(
    [steuerung.schirm, steuerung.waehlen, steuerung.gezeigt, anzeige, lage, box, vorgabeEcke],
    () => folger?.aktualisiere(),
    {
        flush: "post",
    },
);
// Ein neues Formular oder ein neues „Auf der Karte zeigen“: Die Linie zeichnet sich einmal.
watch(
    () => {
        const jetzt = anzeige.value;
        if (jetzt?.art === "formular") return `formular-${String(jetzt.nr)}`;
        const gezeigt = steuerung.gezeigt.value;
        return jetzt?.art === "status" && gezeigt !== undefined
            ? `zeigen-${String(jetzt.nr)}-${String(gezeigt.nr)}`
            : undefined;
    },
    (kennung) => {
        clearTimeout(uhr);
        zeichnetSich.value = kennung !== undefined;
        if (kennung !== undefined) uhr = setTimeout(() => (zeichnetSich.value = false), 560);
    },
    { immediate: true },
);
const pfad = computed(() => (linie.value === undefined ? "" : linienPfad(linie.value)));
</script>

<template>
    <div
        v-if="anzeige !== undefined"
        class="reisebild-rahmen"
        :style="{ right: rand }"
        data-testid="reisebild-besucher"
    >
        <ReisebildFenster
            v-if="anzeige.art === 'formular'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :anzeige="anzeige"
            :steuerung="steuerung"
            :lage="lage"
            :box="box"
            :vorgabe-ecke="vorgabeEcke"
            @update:lage="neueLage"
            @update:box="(neu) => steuerung.setzeBox(neu)"
            @hinweise="(ziel: ReisebildHinweisZiel) => emit('hinweise', ziel)"
        />
        <!-- „Meine Reisebilder“ (Entwurf 9): die gemerkten Einreichungen dieses Geräts; eine Karte öffnet die Statusseite im selben Fenster. -->
        <MeineReisebilderFenster
            v-else-if="anzeige.art === 'meine'"
            :key="anzeige.nr"
            v-model:offen="offen"
            :steuerung="steuerung"
            :lage="lage"
            :box="box"
            :vorgabe-ecke="vorgabeEcke"
            @update:lage="neueLage"
            @update:box="(neu) => steuerung.setzeBox(neu)"
        />
        <ReisebildStatusFenster
            v-else
            :key="anzeige.nr"
            v-model:offen="offen"
            :schluessel="anzeige.schluessel"
            :von="anzeige.von"
            :steuerung="steuerung"
            :lage="lage"
            :box="box"
            :vorgabe-ecke="vorgabeEcke"
            @update:lage="neueLage"
            @update:box="(neu) => steuerung.setzeBox(neu)"
        />
    </div>
    <svg v-if="linie !== undefined && linieAn" class="reisebild-linie" aria-hidden="true" data-testid="reisebild-linie">
        <g class="reisebild-linie__saum"><path pathLength="1" :d="pfad" :class="{ 'is-neu': zeichnetSich }" /></g>
        <g class="reisebild-linie__strich"><path pathLength="1" :d="pfad" :class="{ 'is-neu': zeichnetSich }" /></g>
        <circle class="reisebild-linie__anfang" :cx="linie.von.x" :cy="linie.von.y" r="3.5" />
    </svg>
</template>

<style scoped>
/*
 * Der Rahmen des Wirts: so groß wie die Karte, aber um die Breite des offenen Info- oder Editorpanels kürzer (`NEBEN_PANEL`, null ohne Panel und am Telefon). Die Hülle dockt an SEINER
 * rechten Kante an, also links neben dem Panel statt darüber (Betreiber 2026-10-31). Er fängt keinen Klick ab: Nur das Fenster darin nimmt Zeiger an. Wie `.besucher-rahmen`.
 */
.reisebild-rahmen {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
}

.reisebild-rahmen > :deep(dialog) {
    pointer-events: auto;
}

/*
 * Die Linie vom Fensterkopf zur Stelle (Vali 2026-10-31): über der Karte, unter dem Fenster, ohne Klick. Hell mit dunklem Saum wie die Linien zwischen Leiste und Symbolen, damit
 * sie auf jedem Gelände steht; in Bildschirmkoordinaten der Seite (`fixed`).
 */
.reisebild-linie {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-map-panel) - 1);
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
}

.reisebild-linie__saum path,
.reisebild-linie__strich path {
    fill: none;
}

.reisebild-linie__saum path {
    stroke: rgb(0 0 0 / 55%);
    stroke-width: 3.5;
}

.reisebild-linie__strich path {
    stroke: var(--color-map-paper);
    stroke-width: 1.5;
}

/* Beim Öffnen zeichnet sich die Linie vom Fenster zur Stelle. */
.reisebild-linie path.is-neu {
    stroke-dasharray: 1;
    animation: reisebild-zeichnen 520ms ease-out both;
}

@keyframes reisebild-zeichnen {
    from {
        stroke-dashoffset: 1;
    }
}

.reisebild-linie__anfang {
    fill: var(--color-map-paper);
    stroke: rgb(0 0 0 / 60%);
    stroke-width: 1;
}

@media (prefers-reduced-motion: reduce) {
    .reisebild-linie path.is-neu {
        animation: none;
    }
}
</style>
