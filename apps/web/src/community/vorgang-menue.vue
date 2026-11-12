<script setup lang="ts">
import { useId, useTemplateRef } from "vue";
import { useMenueBlatt } from "../controls/menue-blatt";

/**
 * Ein Knopf mit kleinem Menü in der Leiste der Handgriffe eines Vorgangs (WI-0268 C3; Bedienkonzept §2.2 Nr. 4): „Priorität: hoch ▾“, „zuständig: Vali ▾“ und „⋯“. Das Blatt ist das des Hauses
 * (`menue-blatt.ts`: öffnet an den Knopf, bleibt im offenen Fenster, schließt mit Esc, Klick daneben, Bildlauf), die Einträge tragen die Fassung der Kartenmenüs.
 *
 * - **Eine Wahl oder eine Handlung:** `wahl` zeigt die aktive Wahl mit einer Marke ● (Priorität, Zuständig), ohne `wahl` sind die Einträge Handlungen („⋯“).
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §13.19): Ein Eintrag, der nicht geht, steht gedämpft da, mit seinem Grund darunter, nicht mit einem toten Knopf.
 * - Pfeile wandern durch die Einträge, die gehen; Enter wählt, Esc schließt und gibt den Fokus an den Knopf zurück.
 */
export interface MenueEintrag {
    readonly id: string;
    readonly text: string;
    readonly aktiv?: boolean | undefined;
    /** Der Satz, warum der Eintrag nicht geht; gesetzt heißt gesperrt. */
    readonly gesperrt?: string | undefined;
    readonly gefahr?: boolean | undefined;
    /** Eine Haarlinie VOR diesem Eintrag. */
    readonly trenner?: boolean | undefined;
}

const props = defineProps<{
    eintraege: readonly MenueEintrag[];
    /** Der Name des Knopfs für Vorleser, mit der Wahl („Priorität: hoch“). */
    bezeichnung: string;
    /** Was auf dem Knopf steht; ohne Text steht „⋯“. */
    text?: string | undefined;
    /** Ob die Einträge eine Wahl sind (Marke ● an der aktiven) oder Handlungen. */
    wahl?: boolean | undefined;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ waehle: [id: string] }>();

const knopf = useTemplateRef<HTMLButtonElement>("knopf");
const blatt = useTemplateRef<HTMLDivElement>("blatt");
const blattId = useId();

const eintragKnoepfe = (): HTMLButtonElement[] => [
    ...(blatt.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
];

function fokus(): void {
    const knoepfe = eintragKnoepfe();
    (knoepfe.find((eintrag) => eintrag.getAttribute("aria-checked") === "true") ?? knoepfe[0])?.focus({
        preventScroll: true,
    });
}
const { offen, lage, ziel, umschalten, schliessen } = useMenueBlatt(knopf, blatt, fokus);

function waehle(eintrag: MenueEintrag): void {
    if (eintrag.gesperrt !== undefined) return;
    schliessen(true);
    emit("waehle", eintrag.id);
}

function taste(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        // Esc gehört dem Blatt: verbraucht, damit das Fenster nicht gleich mit zugeht.
        event.preventDefault();
        event.stopPropagation();
        schliessen(true);
        return;
    }
    const knoepfe = eintragKnoepfe();
    const jetzt = knoepfe.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const schritt = event.key === "ArrowDown" ? 1 : -1;
        knoepfe[(jetzt + schritt + knoepfe.length) % knoepfe.length]?.focus({ preventScroll: true });
    } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        knoepfe[event.key === "Home" ? 0 : knoepfe.length - 1]?.focus({ preventScroll: true });
    }
}

const kennung = (rest: string): string | undefined =>
    props.testid === undefined ? undefined : `${props.testid}${rest}`;
</script>

<template>
    <span class="menue-huelle">
        <button
            ref="knopf"
            type="button"
            class="menue-knopf"
            :class="{ 'is-offen': offen, 'menue-knopf--zeichen': props.text === undefined }"
            :aria-label="props.bezeichnung"
            :title="props.bezeichnung"
            aria-haspopup="menu"
            :aria-expanded="offen"
            :aria-controls="offen ? blattId : undefined"
            :data-testid="props.testid"
            @click="umschalten"
        >
            <span class="avm-versalmitte">{{ props.text ?? "⋯" }}</span>
            <span v-if="props.text !== undefined" class="menue-knopf__winkel" aria-hidden="true">▾</span>
        </button>
        <Teleport :to="ziel">
            <div
                v-if="offen"
                :id="blattId"
                ref="blatt"
                class="menue-blatt"
                role="menu"
                :aria-label="props.bezeichnung"
                :style="{
                    top: `${String(lage.top)}px`,
                    left: `${String(lage.left)}px`,
                    ...(lage.hoehe === undefined ? {} : { maxHeight: `${String(lage.hoehe)}px` }),
                }"
                :data-testid="kennung('-blatt')"
                @keydown="taste"
            >
                <template v-for="eintrag in props.eintraege" :key="eintrag.id">
                    <hr v-if="eintrag.trenner === true" class="menue-blatt__trenner" />
                    <button
                        type="button"
                        class="menue-blatt__eintrag"
                        :class="{ 'is-gefahr': eintrag.gefahr === true, 'is-gesperrt': eintrag.gesperrt !== undefined }"
                        :role="props.wahl === true ? 'menuitemradio' : 'menuitem'"
                        :aria-checked="props.wahl === true ? eintrag.aktiv === true : undefined"
                        :disabled="eintrag.gesperrt !== undefined"
                        :title="eintrag.gesperrt"
                        :data-testid="kennung(`-${eintrag.id}`)"
                        @click="waehle(eintrag)"
                    >
                        <span class="menue-blatt__marke" aria-hidden="true">{{
                            props.wahl === true && eintrag.aktiv === true ? "●" : ""
                        }}</span>
                        <span class="menue-blatt__text">
                            <span class="avm-versalmitte">{{ eintrag.text }}</span>
                            <span v-if="eintrag.gesperrt !== undefined" class="menue-blatt__grund">{{
                                eintrag.gesperrt
                            }}</span>
                        </span>
                    </button>
                </template>
            </div>
        </Teleport>
    </span>
</template>

<style scoped>
.menue-huelle {
    display: inline-flex;
    flex: none;
}

/* Die Fassung des Menüknopfs (`avm-menueknopf.vue`): Kante, Fläche, Radius und Bedienhöhe wie das Feld daneben; Zustände nach Guide §30.5. */
.menue-knopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    box-sizing: border-box;
    min-height: var(--avm-control-h);
    margin: 0;
    padding: 0 var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.menue-knopf--zeichen {
    min-width: var(--avm-control-h);
    padding: 0 var(--space-4);
    font-size: var(--font-size-body);
}

.menue-knopf:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.menue-knopf:active,
.menue-knopf.is-offen {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.menue-knopf:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.menue-knopf__winkel {
    color: var(--color-text-muted);
}

/* Das Blatt: dieselbe Fläche wie das Kartenmenü (Guide §18). */
.menue-blatt {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 14em;
    max-width: calc(100vw - 2 * var(--space-6));
    max-height: min(70vh, 40em);
    padding: var(--space-4);
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.menue-blatt__trenner {
    margin: var(--space-4) 0;
    border: 0;
    border-top: 1px solid var(--color-divider);
}

.menue-blatt__eintrag {
    display: grid;
    grid-template-columns: var(--space-12) minmax(0, 1fr);
    align-items: start;
    column-gap: var(--space-6);
    width: 100%;
    padding: var(--space-6) var(--space-8);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.menue-blatt__eintrag:hover:not(:disabled),
.menue-blatt__eintrag:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
}

.menue-blatt__eintrag:active:not(:disabled) {
    background: var(--color-active-wash);
}

.menue-blatt__eintrag.is-gefahr:not(:disabled) {
    color: var(--color-danger-soft-text);
}

/* Gesperrt: gedämpft in der Fassung der Sperre, nie über die Deckkraft (§30.2); der Grund steht daneben. */
.menue-blatt__eintrag.is-gesperrt {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.menue-blatt__marke {
    color: var(--color-accent-strong);
    text-align: center;
}

.menue-blatt__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.menue-blatt__grund {
    font-size: var(--font-size-caption);
    white-space: normal;
}
</style>
