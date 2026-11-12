<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { zeilenBereich } from "./inhalte-regeln-text-modell";
import type { TextMarkierung } from "./inhalte-regeln-text-steuerung";

/**
 * Das Textfeld von „Regeln als Text“ (WI-0254 §13; Entwurf `j-text-ansicht.js`): ein mehrzeiliges Feld mit Zeilennummern am Rand. Die Höhe folgt dem Text (das Fenster rollt, nicht das Feld), und lange Zeilen
 * brechen um: Jede Nummer am Rand bekommt die Höhe ihrer Zeile, gemessen an einem unsichtbaren Spiegel mit derselben Breite und Schrift.
 *
 * - **Marken am Rand:** Eine Zeile mit Rückfrage steht gelb, eine mit Fehler rot (`marken`, Zeile ab 0); die Zeilen, die ein „Z. n“ der Vorschau anspringt, stehen goldfarben, bis getippt wird.
 * - **Markieren** (`markierung`, eine Aufforderung der Steuerung): wählt die Zeilen im Feld aus und rollt sie in den Blick (der Rollkasten ist die Spalte darüber). Am Finger bleibt der Fokus draußen, damit die
 *   Tastatur die Vorschau nicht verdeckt; dort zeigt der Rand die Zeile.
 * - **Strg + Eingabe** prüft. **Einfügen** (`fuegeEin`) setzt ein Wort der Schreibweise an die Schreibmarke: eine Landschaftsart als Link (hinter einem Link mit „oder“), eine Beziehung als neue Zeile „| Beziehung = “.
 * - Das Feld hält den Text nicht selbst; er gehört der Steuerung (`v-model`).
 */
const props = defineProps<{
    modelValue: string;
    /** Zeile (ab 0) → `fehler` oder `frage`, aus der Vorschau, solange sie zum Text gehört. */
    marken: ReadonlyMap<number, "fehler" | "frage">;
    markierung: TextMarkierung | undefined;
    /** Der Text steht still (eine Anfrage läuft). */
    gesperrt: boolean;
    bezeichnung: string;
    platzhalter: string;
}>();
const emit = defineEmits<{ "update:modelValue": [text: string]; pruefen: [] }>();

const feld = useTemplateRef<HTMLTextAreaElement>("feld");
const rand = useTemplateRef<HTMLDivElement>("rand");
const nummern = computed(() => props.modelValue.split("\n").length);
/** Die Höhe der Nummer je Zeile (px), wo die Zeile umbricht; sonst steht keine und die Nummer hat die Höhe einer Zeile. */
const hoehen = ref<number[]>([]);
/** Die Zeilen, die zuletzt markiert wurden, bis jemand tippt. */
const markiert = ref<{ von: number; bis: number } | undefined>(undefined);

let spiegel: HTMLDivElement | undefined;
let beobachter: ResizeObserver | undefined;
let breite = 0;
/** Die Messung ist für das nächste Bild vorgemerkt (`requestAnimationFrame`), 0 wenn nicht. */
let geplant = 0;

/** Die Höhe der Textfläche an den Text anpassen und die Nummern neu messen. */
function wachse(): void {
    const ta = feld.value;
    if (ta === null) return;
    ta.style.height = "auto";
    ta.style.height = `${String(ta.scrollHeight + (ta.offsetHeight - ta.clientHeight))}px`;
    messeZeilen();
}

function messeZeilen(): void {
    const ta = feld.value;
    if (ta === null) return;
    const stil = getComputedStyle(ta);
    if (spiegel === undefined) {
        spiegel = document.createElement("div");
        spiegel.setAttribute("aria-hidden", "true");
        spiegel.style.cssText =
            "position:absolute;left:-10000px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;hyphens:manual;padding:0;border:0;";
        document.body.append(spiegel);
    }
    breite = ta.clientWidth;
    Object.assign(spiegel.style, {
        width: `${String(ta.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight))}px`,
        fontFamily: stil.fontFamily,
        fontSize: stil.fontSize,
        fontWeight: stil.fontWeight,
        lineHeight: stil.lineHeight,
        letterSpacing: stil.letterSpacing,
        tabSize: stil.tabSize,
    });
    spiegel.replaceChildren(
        ...ta.value
            .split("\n")
            .map((zeile) => Object.assign(document.createElement("div"), { textContent: zeile === "" ? "​" : zeile })),
    );
    const eine = parseFloat(stil.lineHeight);
    hoehen.value = [...spiegel.children].map((d) => Math.max(eine, (d as HTMLElement).offsetHeight));
}

onMounted(() => {
    wachse();
    beobachter = new ResizeObserver(() => {
        if (feld.value !== null && feld.value.clientWidth !== breite) wachse();
    });
    if (feld.value !== null) beobachter.observe(feld.value);
});
onBeforeUnmount(() => {
    beobachter?.disconnect();
    if (geplant !== 0) cancelAnimationFrame(geplant);
    spiegel?.remove();
    spiegel = undefined;
});
// Der Text kann von außen wechseln (Beispiel, Leeren, Antwort, Übernehmen) oder getippt werden: Höhe und Nummern folgen nach dem Zeichnen, höchstens einmal je Bild (ein langer Stapel hat tausende Zeilen).
watch(
    () => props.modelValue,
    () => {
        if (geplant !== 0) return;
        geplant = requestAnimationFrame(() => {
            geplant = 0;
            wachse();
        });
    },
    { flush: "post" },
);

function eingabe(): void {
    const ta = feld.value;
    if (ta === null) return;
    markiert.value = undefined;
    emit("update:modelValue", ta.value);
}

/** Die Zeilen im Feld auswählen und in den Blick rollen. */
async function markiere(von: number, bis: number): Promise<void> {
    const ta = feld.value;
    if (ta === null) return;
    // Der Text kann eben erst gewechselt haben: Die Nummern brauchen ihre Höhen, bevor die Zeile gesucht wird.
    wachse();
    markiert.value = { von, bis };
    await nextTick();
    const { anfang, ende } = zeilenBereich(ta.value, von, bis);
    const finger = window.matchMedia?.("(pointer: coarse)").matches === true;
    if (!finger) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(anfang, ende);
    }
    const kasten = ta.closest<HTMLElement>(".fenster-spalte__inhalt");
    if (kasten === null) return;
    const eine = parseFloat(getComputedStyle(ta).lineHeight);
    // Die Zeile über ihre Nummer am Rand finden: Umgebrochene Zeilen davor sind höher als eine Textzeile.
    const nummer = rand.value?.children[von] as HTMLElement | undefined;
    const y =
        (nummer ?? ta).getBoundingClientRect().top -
        kasten.getBoundingClientRect().top +
        kasten.scrollTop +
        (nummer === undefined ? von * eine : 0);
    if (y < kasten.scrollTop + 8 || y + eine > kasten.scrollTop + kasten.clientHeight - 8)
        kasten.scrollTo({ top: Math.max(0, y - kasten.clientHeight / 3) });
}
watch(
    () => props.markierung,
    (neu) => {
        if (neu !== undefined) void markiere(neu.von, neu.bis);
    },
    { flush: "post" },
);

/** Ein Wort aus den Listen an der Schreibmarke einfügen: eine Landschaftsart als Link (hinter einem Link mit „oder“), eine Beziehung als neue Zeile „| Beziehung = “. */
function fuegeEin(text: string, art: "art" | "beziehung" | "wort"): void {
    const ta = feld.value;
    if (ta === null || props.gesperrt) return;
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const vor = ta.value.slice(0, a);
    const leerraum = vor === "" || /\s$/u.test(vor);
    let einfuegen = text;
    let pre = "";
    if (art === "art") {
        einfuegen = `[[${text}]]`;
        pre = /\]\]\p{L}*\s*$/u.test(vor) ? (leerraum ? "oder " : " oder ") : leerraum ? "" : " ";
    } else if (art === "beziehung") pre = vor === "" || vor.endsWith("\n") ? "" : "\n";
    else if (!leerraum && !/[([]$/u.test(vor)) pre = " ";
    ta.focus({ preventScroll: true });
    ta.setRangeText(pre + einfuegen, a, b, "end");
    eingabe();
}
defineExpose({ fuegeEin, fokus: () => feld.value?.focus() });

const klasse = (i: number): Record<string, boolean> => ({
    "is-frage": props.marken.get(i) === "frage",
    "is-fehler": props.marken.get(i) === "fehler",
    "is-markiert": markiert.value !== undefined && i >= markiert.value.von && i <= markiert.value.bis,
});
</script>

<template>
    <div class="tx-feld" data-testid="inhalte-text-feld">
        <div ref="rand" class="tx-feld__nr" aria-hidden="true">
            <span
                v-for="i in nummern"
                :key="i"
                class="tx-nr"
                :class="klasse(i - 1)"
                :style="hoehen[i - 1] === undefined ? undefined : { height: `${String(hoehen[i - 1])}px` }"
                >{{ i }}</span
            >
        </div>
        <textarea
            ref="feld"
            class="tx-feld__text"
            :value="modelValue"
            :readonly="gesperrt"
            :aria-label="bezeichnung"
            :placeholder="platzhalter"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            rows="12"
            data-testid="inhalte-text-eingabe"
            @input="eingabe"
            @keydown.ctrl.enter.prevent="emit('pruefen')"
            @keydown.meta.enter.prevent="emit('pruefen')"
        ></textarea>
    </div>
</template>

<style scoped>
/* Nummern am Rand, die Höhe folgt dem Text; die Schrift ist die der Bedienelemente (am Finger die größere). */
.tx-feld {
    --tx-schrift: var(--font-size-body);
    --tx-zeile: calc(var(--tx-schrift) * var(--leading-normal));

    display: flex;
    align-items: stretch;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

@media (pointer: coarse) {
    .tx-feld {
        --tx-schrift: var(--font-size-touch);
    }
}

.tx-feld:hover {
    border-color: var(--color-border-strong);
}

.tx-feld:focus-within {
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.tx-feld__nr {
    display: flex;
    flex: none;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 2.4em;
    padding: var(--space-6) var(--space-4) var(--space-6) var(--space-6);
    border-right: 1px solid var(--color-divider);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: calc(var(--tx-schrift) - 2px);
    font-variant-numeric: tabular-nums;
    text-align: right;
    user-select: none;
}

.tx-nr {
    display: block;
    flex: none;
    height: var(--tx-zeile);
    line-height: var(--tx-zeile);
}

.tx-nr.is-markiert {
    background: var(--color-active-wash);
    box-shadow: inset 3px 0 0 var(--color-accent-strong);
    color: var(--color-text-strong);
}

.tx-nr.is-frage {
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.tx-nr.is-fehler {
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.tx-feld__text {
    flex: 1 1 auto;
    box-sizing: border-box;
    min-width: 0;
    min-height: calc(12 * var(--tx-zeile) + 2 * var(--space-6));
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--tx-schrift);
    line-height: var(--tx-zeile);
    white-space: pre-wrap;
    overflow: hidden;
    overflow-wrap: anywhere;
    hyphens: manual;
    tab-size: 4;
}

.tx-feld__text::placeholder {
    color: var(--color-placeholder);
}
</style>
