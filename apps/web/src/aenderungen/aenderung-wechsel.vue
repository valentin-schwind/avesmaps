<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";

/**
 * Ein Feld vorher und nachher (WI-0265 §1.4; Vorlage `review/wi-0265/aenderungen-neu.html`): **Vorher** blassrot, gestrichelt, mit „−“; **Nachher** hellgelb, durchgezogen, mit „+“. Die Töne stehen im Designkanon
 * (`changeBefore*`, `changeAfter*`, hell und dunkel). Die Bedeutung trägt nie die Farbe allein: Zeichen und Rahmenart sagen sie mit, Vorleser bekommen die Wörter „Vorher“ und „Nachher“.
 *
 * - **Eine leere Seite entfällt** (WI-0265 B10): Ein neu gesetztes Feld zeigt nur „+ neu“, ein geleertes nur „− alt“; sind beide leer, steht „(leer)“. Fehlt die frühere Form im Protokoll (`formFehlt`), steht dort der
 *   Satz dafür, nie ein Wert aus dem heutigen Stand.
 * - **Lange Werte stehen in zwei Zeilen** mit „mehr“ und „weniger“; was in die zwei Zeilen passt, trägt keinen Knopf.
 * - Ist der Wert in der Liste weggelassen und wird gerade nachgeladen, steht „…“; scheitert das Laden, „–“ (das Detail sagt es darüber).
 * - Das Vorher ist ein `<s>` (Bestand der Verläufe der Editoren; ihre Specs lesen es), ohne Durchstreichung: Das „−“ und der gestrichelte Rahmen genügen.
 */
const props = defineProps<{
    vorher: string | undefined;
    nachher: string | undefined;
    formFehlt: boolean;
    laedt: boolean;
    /** Ein Satz unter den beiden, wo sie als Text gleich sind und doch nicht dasselbe (die Form eines Netzes). */
    hinweis?: string | undefined;
}>();

/** Hat die Seite einen Wert? „–“ ist das Zeichen der Liste für leer: Eine leere Seite zeigt die Tafel nicht. */
const hatWert = (text: string | undefined): boolean => text !== undefined && text !== "–" && text !== "";
const zeigtVorher = computed(() => props.formFehlt || props.laedt || hatWert(props.vorher));
const zeigtNachher = computed(() => props.laedt || hatWert(props.nachher));
const leer = computed(() => !zeigtVorher.value && !zeigtNachher.value);

const huelle = useTemplateRef<HTMLElement>("huelle");
const mehr = ref(false);
/** Schneiden die zwei Zeilen etwas ab? Dann steht „mehr“ da. */
const gekappt = ref(false);
const zeigtKnopf = computed(() => gekappt.value || mehr.value);

function messe(): void {
    if (mehr.value) return;
    const texte = huelle.value?.querySelectorAll<HTMLElement>(".wechsel__t") ?? [];
    gekappt.value = [...texte].some((text) => text.scrollHeight > text.clientHeight + 1);
}
let beobachter: ResizeObserver | undefined;
onMounted(() => {
    messe();
    if (typeof ResizeObserver !== "undefined" && huelle.value) {
        beobachter = new ResizeObserver(() => messe());
        beobachter.observe(huelle.value);
    }
});
onBeforeUnmount(() => beobachter?.disconnect());
watch(
    () => [props.vorher, props.nachher, props.laedt],
    () => void nextTick(messe),
);
</script>

<template>
    <span ref="huelle" class="wechsel" :class="{ 'is-mehr': mehr }">
        <template v-if="leer">
            <span class="wechsel__leer">{{ t("aenderungen.detail.leer") }}</span>
        </template>
        <template v-else>
            <template v-if="zeigtVorher">
                <span class="wechsel__vorlese">{{ t("aenderungen.detail.vorher") }}</span>
                <span v-if="formFehlt" class="wechsel__fehlt" data-testid="aenderung-form-fehlt">{{
                    t("aenderungen.detail.formFehlt")
                }}</span>
                <s v-else class="wechsel__chip wechsel__vorher"
                    ><span class="wechsel__t">{{ laedt ? "…" : (vorher ?? "–") }}</span></s
                >
            </template>
            <template v-if="zeigtNachher">
                <span class="wechsel__vorlese">{{ t("aenderungen.detail.nachher") }}</span>
                <span class="wechsel__chip wechsel__nachher"
                    ><span class="wechsel__t">{{ laedt ? "…" : (nachher ?? "–") }}</span></span
                >
            </template>
        </template>
        <button v-if="zeigtKnopf" type="button" class="wechsel__mehr" :aria-expanded="mehr" @click="mehr = !mehr">
            {{ mehr ? t("aenderungen.detail.weniger") : t("aenderungen.detail.mehr") }}
        </button>
        <small v-if="hinweis" class="wechsel__hinweis">{{ hinweis }}</small>
    </span>
</template>

<style scoped>
.wechsel {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4);
    max-width: 100%;
}

.wechsel__chip,
.wechsel__fehlt {
    display: inline-grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    box-sizing: border-box;
    max-width: 100%;
    padding: 1px var(--space-6);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    text-decoration: none;
    overflow-wrap: anywhere;
}

.wechsel__vorher {
    border: 1px dashed var(--color-change-before-line);
    background: var(--color-change-before-bg);
}

.wechsel__nachher {
    border: 1px solid var(--color-change-after-line);
    background: var(--color-change-after-bg);
}

/* Das Zeichen steht als Inhalt davor, nicht im Text: Das `<s>` des Vorher trägt nur den Wert (die Specs der Editoren lesen es so). */
.wechsel__vorher::before {
    content: "−";
    color: var(--color-change-before-line);
}

.wechsel__nachher::before {
    content: "+";
    color: var(--color-change-after-line);
}

/* Zwei Zeilen, dann abgeschnitten; „mehr“ hebt es auf. */
.wechsel__t {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
}

.is-mehr .wechsel__t {
    display: block;
    -webkit-line-clamp: unset;
    line-clamp: unset;
}

/* Fehlt die frühere Form: derselbe gestrichelte Rahmen, aber ohne Füllung - hier steht kein Wert, sondern ein Satz. */
.wechsel__fehlt {
    display: inline-block;
    border: 1px dashed var(--color-change-before-line);
    color: var(--color-text-muted);
}

.wechsel__leer {
    color: var(--color-text-muted);
}

.wechsel__mehr {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.wechsel__mehr:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.wechsel__mehr:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wechsel__hinweis {
    flex-basis: 100%;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wechsel__vorlese {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
