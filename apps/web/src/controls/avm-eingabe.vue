<script setup lang="ts">
import { computed, ref, useAttrs, useId, useTemplateRef, type StyleValue } from "vue";
import { t } from "../i18n/i18n";
import { autocompleteVorgabe, eingabeTyp, type EingabeArt } from "./avm-eingabe";
import AvmSperrgrund from "./avm-sperrgrund.vue";
import { beschriebenVon, sperre, teileAttrs } from "./bedienelement";

/**
 * Das Textfeld in Bedienhöhe (Guide §7 „Eine Höhe für alles Bedienbare: 32 px“, §8 „Eingabefelder“, §30.5; WI-0120 A8).
 * `AvmFeld` bleibt das kleine Zahlenfeld des Planers (25 px); dieses ist das Feld der Fenster.
 *
 * - **Vier Arten:** `text`; `datum`, das Datumsfeld des Browsers (WI-0217); `passwort` mit einem Schalter „Anzeigen“ im Feld (AUTH-0001 §6.4: „das Passwort lässt sich
 *   anzeigen“); `suche` mit der Lupe vorn und einem ✕ zum Leeren, sobald etwas drinsteht (Guide §8). Mit `schliessbar` steht das ✕
 *   auch im leeren Feld und heißt „Suche schließen“ (die aufgeklappte Suche der Leiste, `AvmListenleiste`); es meldet sich mit
 *   `geleert`. Ein Tipp auf das ✕ lässt den Fokus im Feld, sonst schlösse ein Abgang des Fokus die Suche vor dem Klick.
 * - **Alles Übrige reicht der Aufrufer durch** - `id`, `name`, `autocomplete`, `placeholder`, `aria-label`, `required`,
 *   `readonly`, Ereignisse - es landet am `<input>`; `class` und `style` an der Hülle (Breite, Lage). Ohne `autocomplete`
 *   gilt die Vorgabe der Art (`current-password`, bei der Suche `off`).
 * - **Schrift:** 13 px wie Legacys `--font-size-control`; am Finger 16 px (`--font-size-touch`), sonst zoomt Safari beim
 *   Fokus hinein und kehrt nicht zurück.
 * - **Zustände nach §30.5:** Kante `border-strong` beim Überfahren; im Fokus goldbraune Kante und der Fokusring am Rahmen
 *   (ein Feld zeigt den Fokus auch nach einem Klick, man tippt ja hinein); `ungueltig` mit `aria-invalid` und der Kante des
 *   Gefahrtripels; gesperrt eine eigene Farbfassung samt sichtbarem Satz darunter (`gesperrt`, wie beim Knopf); nennt ein Satz
 *   an anderer Stelle den Grund schon für die ganze Seite, steht das Feld ohne eigene Zeile und zeigt darauf (`grundBei`); 120 ms.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
    art?: EingabeArt | undefined;
    /** Der Inhalt passt nicht (etwa nach einer abgewiesenen Anmeldung): Kante im Gefahrton und `aria-invalid`. */
    ungueltig?: boolean | undefined;
    /** Der Satz, warum das Feld gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    /**
     * Die Kennung eines Satzes, der den Grund schon sichtbar nennt, etwa EIN `AvmSperrgrund` oder Hinweiskasten über einer Seite voller aus
     * demselben Grund gesperrter Elemente (wie bei `AvmKnopf`). Das Feld steht dann ohne eigene Zeile, mit dem Grund als `title` und
     * `aria-describedby` auf jenen Satz.
     */
    grundBei?: string | undefined;
    /** Nur `suche`: Das ✕ steht auch im leeren Feld und schließt (die aufgeklappte Suche der Leiste). */
    schliessbar?: boolean | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<string>({ default: "" });
const emit = defineEmits<{ geleert: [] }>();

const attrs = useAttrs();
const geteilt = computed(() => teileAttrs(attrs));
const feld = useTemplateRef<HTMLInputElement>("feld");
const feldId = useId();
const grundId = useId();
const passwortSichtbar = ref(false);
const art = computed((): EingabeArt => props.art ?? "text");
const typ = computed(() => eingabeTyp(art.value, passwortSichtbar.value));
const zustand = computed(() => sperre(props.gesperrt));
const beschreibung = computed(() =>
    beschriebenVon(
        attrs["aria-describedby"],
        zustand.value.grund === undefined ? undefined : (props.grundBei ?? grundId),
    ),
);
const autocomplete = computed(() => (attrs["autocomplete"] as string | undefined) ?? autocompleteVorgabe(art.value));

function leeren(): void {
    wert.value = "";
    feld.value?.focus();
    emit("geleert");
}

defineExpose({
    focus: (): void => feld.value?.focus(),
    select: (): void => feld.value?.select(),
});
</script>

<template>
    <span class="eingabe-huelle" :class="[geteilt.huelle.class]" :style="geteilt.huelle.style as StyleValue">
        <span
            class="eingabe"
            :class="[`eingabe--${art}`, { 'is-ungueltig': props.ungueltig, 'is-gesperrt': zustand.gesperrt }]"
            :data-testid="props.testid"
        >
            <svg v-if="art === 'suche'" class="eingabe__lupe" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path
                    d="M10 10l4.25 4.25"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                />
            </svg>
            <!-- Kennung und Rechtschreibprüfung sind Vorgaben: Was der Aufrufer mitgibt, steht danach und gewinnt. -->
            <input
                :id="feldId"
                ref="feld"
                v-model="wert"
                spellcheck="false"
                v-bind="geteilt.element"
                class="eingabe__feld"
                :type="typ"
                :autocomplete="autocomplete"
                :disabled="zustand.gesperrt"
                :title="props.grundBei === undefined ? (attrs['title'] as string | undefined) : zustand.grund"
                :aria-invalid="props.ungueltig ? 'true' : undefined"
                :aria-describedby="beschreibung"
            />
            <button
                v-if="art === 'passwort'"
                type="button"
                class="eingabe__schalter"
                :aria-label="passwortSichtbar ? t('ui.input.hidePassword') : t('ui.input.showPassword')"
                :aria-controls="(attrs['id'] as string | undefined) ?? feldId"
                :disabled="zustand.gesperrt"
                @click="passwortSichtbar = !passwortSichtbar"
            >
                <span class="avm-versalmitte">{{ passwortSichtbar ? t("ui.input.hide") : t("ui.input.show") }}</span>
            </button>
            <button
                v-if="art === 'suche' && (wert !== '' || props.schliessbar)"
                type="button"
                class="eingabe__schalter"
                :aria-label="wert === '' ? t('ui.input.closeSearch') : t('ui.input.clearSearch')"
                :title="wert === '' ? t('ui.input.closeSearch') : t('ui.input.clearSearch')"
                @mousedown.prevent
                @click="leeren"
            >
                <span class="avm-versalmitte" aria-hidden="true">✕</span>
            </button>
        </span>
        <AvmSperrgrund
            v-if="zustand.grund !== undefined && props.grundBei === undefined"
            :id="grundId"
            :text="zustand.grund"
        />
    </span>
</template>

<style scoped>
/* Die Hülle trägt die Breite des Aufrufers; der Rahmen darin füllt sie, der Satz einer Sperre steht darunter. */
.eingabe-huelle {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    vertical-align: middle;
}

/* Der Rahmen gehört der Hülle: Lupe, Feld und Schalter stehen gemeinsam darin. */
.eingabe {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    min-width: 0;
    height: var(--avm-control-h);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.eingabe:hover:not(.is-gesperrt) {
    border-color: var(--color-border-strong);
}

/* Der Fokus steht am Rahmen, auch nach einem Klick: In ein Feld tippt man, der Ort muss sichtbar sein. */
.eingabe:has(> .eingabe__feld:focus) {
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.eingabe.is-ungueltig {
    border-color: var(--color-danger-soft-border);
}

.eingabe.is-ungueltig:has(> .eingabe__feld:focus) {
    border-color: var(--color-danger-soft-text);
}

.eingabe.is-gesperrt {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
}

.eingabe__feld {
    flex: 1 1 auto;
    align-self: stretch;
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0 var(--space-8);
    border: 0;
    border-radius: inherit;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--font-size-body);
}

.eingabe__feld::placeholder {
    color: var(--color-placeholder);
}

.eingabe__feld:disabled {
    cursor: not-allowed;
}

/* Die Suche hat ihr eigenes ✕; das des Browsers stünde doppelt da. */
.eingabe__feld::-webkit-search-cancel-button {
    appearance: none;
}

.eingabe--suche .eingabe__feld {
    padding-left: var(--space-4);
}

/* Ein Bedienzeichen, gezeichnet in der Schriftfarbe (Guide §6), nicht gemalt. */
.eingabe__lupe {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-left: var(--space-6);
    color: var(--color-text-muted);
}

/* Ein Knopf ohne Fläche bekommt beim Überfahren eine (§13.22); er sitzt im Rahmen und hält Abstand zur Kante. */
.eingabe__schalter {
    display: inline-flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    margin: var(--space-2);
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.eingabe__schalter:hover:not(:disabled) {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.eingabe__schalter:active:not(:disabled) {
    background: var(--color-active-wash);
}

.eingabe__schalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.eingabe__schalter:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

/* iOS fährt in jedes Feld unter 16 px hinein und kehrt nicht zurück (Legacy: die iOS-Schwelle). */
@media (pointer: coarse) {
    .eingabe__feld {
        font-size: var(--font-size-touch);
    }
}

@media (prefers-reduced-motion: reduce) {
    .eingabe,
    .eingabe__schalter {
        transition: none;
    }
}
</style>
