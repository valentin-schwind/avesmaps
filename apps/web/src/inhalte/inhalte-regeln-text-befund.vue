<script setup lang="ts">
import { computed } from "vue";
import type { InhalteRegelTextProblem } from "@avesmaps3d/shared";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import type { TextErsatz } from "./inhalte-regeln-text-modell";
import InhalteRegelnTextZeilenknopf from "./inhalte-regeln-text-zeilenknopf.vue";

/**
 * Ein Befund der Vorschau von „Regeln als Text“ (WI-0254 §13; Entwurf `txProblemHtml`): ein Fehler (so nicht anlegbar) oder eine Rückfrage (mehrdeutig). Der Satz kommt deutsch vom Server und steht unverändert da
 * (die Schreibweise ist deutsch); darunter stehen die Antworten als Auswahl. Ein Klick auf eine Antwort meldet ihren Ersatz (`waehle`): Die Steuerung schreibt ihn in den Text und prüft neu.
 *
 * - **Gesperrt** (`gesperrt`, mit dem Satz warum): Der Ersatz gehört zum Text der Prüfung. Ist der Text seither anders oder läuft eine Anfrage, würde er an die falsche Stelle schreiben.
 * - Die Antwort ist ein eigener Knopf, kein `AvmKnopf`: Sie trägt zwei Zeilen (Name und Zusatz wie Ebene, Art, Wiki-Titel, Kennungsanfang) und bricht um, wo ein Knopf des Hauses einzeilig bliebe und überliefe.
 */
const props = defineProps<{
    problem: InhalteRegelTextProblem;
    /** Die Pille „Fehler“ oder „Rückfrage“ vor dem Satz (an einer Regel sagt es schon die Pille der Regel). */
    mitPille: boolean;
    /** „Z. n“ vor dem Satz: wo der Befund nicht in der Zeile des Kopfs steht, an dem er hängt. */
    mitZeile: boolean;
    /** Warum die Antworten gerade nicht gehen; `undefined`, wo sie gehen. */
    gesperrt: string | undefined;
}>();
const emit = defineEmits<{ waehle: [ersatz: TextErsatz]; markiere: [von: number, bis: number] }>();

const istFehler = computed(() => props.problem.art === "fehler");
</script>

<template>
    <div class="tx-problem" :class="`tx-problem--${problem.art}`" :data-testid="`inhalte-text-${problem.art}`">
        <p class="tx-problem__text">
            <AvmPille v-if="mitPille" :ton="istFehler ? 'gefahr' : 'warnung'">{{
                t(istFehler ? "inhalte.vorkommen.text.status.fehler" : "inhalte.vorkommen.text.status.rueckfrage")
            }}</AvmPille>
            <InhalteRegelnTextZeilenknopf
                v-if="mitZeile"
                :von="problem.zeile"
                :bis="problem.zeile"
                @markiere="(von, bis) => emit('markiere', von, bis)"
            />
            <span>{{ problem.text }}</span>
        </p>
        <div v-if="problem.optionen.length > 0" class="tx-wahlen">
            <button
                v-for="(option, i) in problem.optionen"
                :key="i"
                type="button"
                class="tx-wahl"
                :disabled="gesperrt !== undefined"
                :title="gesperrt"
                data-testid="inhalte-text-wahl"
                @click="emit('waehle', option.ersatz)"
            >
                <span class="tx-wahl__label">{{ option.label }}</span>
                <span v-if="option.meta !== ''" class="tx-wahl__meta">{{ option.meta }}</span>
            </button>
        </div>
    </div>
</template>

<style scoped>
.tx-problem {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-sm);
}

.tx-problem--rueckfrage {
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.tx-problem--fehler {
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.tx-problem__text {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.tx-problem__text > span:last-child {
    flex: 1 1 14em;
    min-width: 0;
}

.tx-wahlen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.tx-wahl {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    box-sizing: border-box;
    max-width: 100%;
    padding: 3px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.tx-wahl:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.tx-wahl:active {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.tx-wahl:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

/* Gesperrt: eine eigene Farbfassung, nie Deckkraft (Guide §30.2). */
.tx-wahl:disabled {
    border-color: var(--color-divider);
    background: var(--color-panel-soft);
    background-image: none;
    color: var(--color-text-muted);
    cursor: not-allowed;
}

.tx-wahl__label {
    overflow-wrap: anywhere;
}

.tx-wahl__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (pointer: coarse) {
    .tx-wahl {
        min-height: 40px;
        justify-content: center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .tx-wahl {
        transition: none;
    }
}
</style>
