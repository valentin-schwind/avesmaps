<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t } from "../i18n/i18n";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen, { type EditorZeichenName } from "../controls/editor-zeichen.vue";
import { meldeLeistenbreite } from "./leistenplatz";

/**
 * Die Leiste eines Modus auf der Karte (EDIT-0003 §2a „die Leiste des Modus oben zentriert auf der Karte“, T27 (4), (5), (7), (13);
 * WI-0178 C1, übernommen aus `1f1ec092` der Wege-Sitzung und nach T27 neu gefasst). Für jeden Editor gleich; der erste Nutzer ist
 * „Ecken bearbeiten“.
 *
 * - **Eine Zeile:** das Zeichen und der Modus („✎ Ecken bearbeiten“, er nennt, was man tut, T27 (13)), das Objekt, „n ungespeichert“,
 *   ↶ ↷ (Strg+Z, Strg+Y; T27 (7)), „Verwerfen“ und „Fertig“. „Fertig“ schreibt Form und Felder in EINER Änderung (T27 (4)); ein
 *   „↺ Zurücknehmen“ gibt es nicht, der Verlauf reicht (T27 (5)). Ein gesperrter Knopf sagt warum (`AvmKnopf`, Guide §7).
 * - **Darunter** leise die Gesten (`gesten`), am Finger über der Zeile.
 * - **Ein Zusatz** (Slot `zusatz`, Wunsch der Wege-Sitzung für „Wegkurve vereinfachen“: Regler „Stärke“, Wert, „19 → 7 Stützpunkte“)
 *   steht am Rechner zwischen Zeile und Gesten, am Telefon zwischen Gesten und Zeile. Ohne Inhalt fehlt er ganz.
 * - **Eine Frage** (`frage`, etwa beim Verlassen mit ungespeicherten Schritten) steht über der Zeile, mit zwei Antworten; mit
 *   `frage.speichern` mit drei: „Speichern · Verwerfen · Weiter bearbeiten“ (R2, gemeinsamer Entwurf O3, `entwurf-leiste.vue`).
 * - **Lage:** am Rechner oben mittig über der freien Karte, zwischen den Panels (`rand`, EDIT-0003 §2a: „das panel muss oben zentriert
 *   sein“, nicht im eingeklappten Fenster), am Telefon unten (Probierblatt R4, R8). Die Leiste meldet sich als Rand der Karte
 *   (`data-map-overlay`): Die Kamera passt darunter ein, nie unter die Leiste (R8). Ihre Höhe meldet sie (`hoehe`), damit die Bunde
 *   der Karte unter beziehungsweise über ihr stehen, statt verdeckt zu werden.
 * - **Keine Lücke** (EDIT-0003 T45 (3)): Bleibt neben Planer und angedocktem Fenster keine freie Fläche (`rand.imFenster`, gerechnet in
 *   `app.vue` über `leavesGap` aus `map/camera/visible-area.ts`, WI-0218), steht DIESELBE Leiste unten im angedockten Fenster
 *   (`avm-fenster.vue`, `data-modusleiste-ziel`) statt auf der Karte: kein zweiter Satz Knöpfe, kein Speichern im Fuß. Dort ist sie kein
 *   Rand der Karte und meldet die Höhe 0.
 * - **Eigene Zeilen** (Slots `zeile` und `unten`, WI-0245, Mockup des Betreibers für die Kamm-Leiste 2026-10-21): Ein Modus mit vielen
 *   Werkzeugen ersetzt die Zeile (Zeichen, Titel, Objekt, ↶ ↷, Verwerfen, Fertig) und die Gesten darunter durch seine eigene, kompakte
 *   Fassung. Lage, Rand, Höhe, Fensterlage und die Frage beim Verlassen bleiben die dieser Leiste. Ohne Slot ist alles wie bisher.
 * - **„Auswahl isolieren“** (`isoliert`, WI-0178, Vali 2026-11-09): ein Umschalter vor der Zahl, nur wenn der Modus ihn anbietet;
 *   an blendet er die übrigen Flächen aus. Was er ausblendet und wann er endet, sagt der Modus (`landschaftseditor/auswahl-isolieren.ts`).
 */

const props = withDefaults(
    defineProps<{
        zeichen: EditorZeichenName;
        titel: string;
        objekt: string;
        ungespeichert: number;
        zurueck: boolean;
        wieder: boolean;
        /** Warum „Fertig“ gerade nicht geht; ohne Satz geht es, sobald etwas ungespeichert ist. */
        fertigGrund?: string | undefined;
        /** Warum „Fertig“ eben nicht geschrieben hat (OPS-000079): Steht die Leiste allein auf der Karte, sähe sonst niemand den Satz im Fuß des Fensters. */
        fehler?: string | undefined;
        gesten: string;
        frage?: { text: string; ja: string; nein: string; speichern?: string | undefined } | undefined;
        telefon?: boolean | undefined;
        /** Was die Panels links und rechts von der Karte decken, in Bildpunkten; `imFenster`: keine Lücke, die Leiste steht im Fenster. */
        rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
        /**
         * „Auswahl isolieren“: gesetzt steht der Umschalter, `true` heißt an. Die Vorgabe `undefined` steht in `withDefaults`: Ohne sie macht Vue eine fehlende Boolean-Prop
         * zu `false`, und der Umschalter stand in jeder Leiste (`boolean-props-vorgabe.test.ts`).
         */
        isoliert?: boolean | undefined;
        testid?: string | undefined;
    }>(),
    { isoliert: undefined },
);

const emit = defineEmits<{
    zurueck: [];
    wieder: [];
    verwerfen: [];
    fertig: [];
    antwort: [ja: boolean];
    speichern: [];
    isolieren: [];
    hoehe: [px: number];
}>();

/** Das Ziel im angedockten Fenster (T45 (3)); D15: höchstens eins ist angedockt. */
const FENSTER_ZIEL = '[data-lage="angedockt"] [data-modusleiste-ziel]';
const imFenster = computed(() => props.telefon !== true && props.rand?.imFenster === true);
const buehne = ref<HTMLElement>();
const zeile = ref<HTMLElement>();
let hoehe = 0;
const meldeHoehe = (): void => emit("hoehe", imFenster.value ? 0 : hoehe);
/**
 * Die Breite der Zeile in EINER Zeile (T45 (3), `leistenplatz.ts`): ihre Teile nebeneinander samt Abständen und Polster, auch wenn sie im
 * Fenster gerade umbricht; ein gekürztes Objekt mit seiner ganzen Breite.
 */
const ich = Symbol("modusleiste");
function messeBreite(): void {
    const z = zeile.value;
    if (z === undefined || props.telefon === true) return;
    const stil = getComputedStyle(z);
    const teile = [...z.children] as HTMLElement[];
    const summe = teile.reduce((s, teil) => s + Math.max(teil.getBoundingClientRect().width, teil.scrollWidth), 0);
    const abstand = (Number.parseFloat(stil.columnGap) || 0) * Math.max(0, teile.length - 1);
    const polster = (Number.parseFloat(stil.paddingLeft) || 0) + (Number.parseFloat(stil.paddingRight) || 0);
    // Dazu der Rahmen des Blatts über der Karte.
    meldeLeistenbreite(ich, Math.ceil(summe + abstand + polster + 2));
}
const messung = new ResizeObserver(([eintrag]) => {
    hoehe = eintrag?.borderBoxSize[0]?.blockSize ?? 0;
    meldeHoehe();
    messeBreite();
});
onMounted(() => {
    if (buehne.value) messung.observe(buehne.value);
    // Gleich beim Einhängen: Die Seite wählt den Platz einen Takt später (`app.vue`, `messeModusRand("neu")`).
    messeBreite();
});
onBeforeUnmount(() => {
    messung.disconnect();
    meldeLeistenbreite(ich, undefined);
});
watch(imFenster, meldeHoehe);
</script>

<template>
    <Teleport :to="FENSTER_ZIEL" :disabled="!imFenster">
        <div
            ref="buehne"
            class="modusbuehne"
            :class="{ 'modusbuehne--telefon': telefon, 'modusbuehne--fenster': imFenster }"
            :style="
                telefon || !rand || imFenster
                    ? undefined
                    : { left: `${String(rand.links)}px`, right: `${String(rand.rechts)}px` }
            "
            :data-map-overlay="imFenster ? undefined : telefon ? 'bottom' : 'top'"
        >
            <div
                class="modusleiste"
                :class="{ 'modusleiste--telefon': telefon, 'modusleiste--fenster': imFenster }"
                role="toolbar"
                :aria-label="titel"
                :data-testid="testid"
            >
                <slot v-if="telefon" name="unten">
                    <p class="modusleiste__gesten">{{ gesten }}</p>
                </slot>
                <p v-if="fehler" class="modusleiste__fehler" role="alert" :data-testid="testid && `${testid}-fehler`">
                    {{ fehler }}
                </p>
                <div v-if="frage" class="modusleiste__frage" role="alert" :data-testid="testid && `${testid}-frage`">
                    <span class="modusleiste__fragetext">{{ frage.text }}</span>
                    <AvmKnopf
                        v-if="frage.speichern"
                        groesse="zeile"
                        art="gefuellt"
                        :testid="testid && `${testid}-frage-speichern`"
                        @click="emit('speichern')"
                    >
                        {{ frage.speichern }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        art="gefahr"
                        :testid="testid && `${testid}-frage-ja`"
                        @click="emit('antwort', true)"
                    >
                        {{ frage.ja }}
                    </AvmKnopf>
                    <AvmKnopf
                        groesse="zeile"
                        :testid="testid && `${testid}-frage-nein`"
                        @click="emit('antwort', false)"
                    >
                        {{ frage.nein }}
                    </AvmKnopf>
                </div>
                <div
                    v-if="telefon && $slots.zusatz"
                    class="modusleiste__zusatz"
                    :data-testid="testid && `${testid}-zusatz`"
                >
                    <slot name="zusatz" />
                </div>
                <div ref="zeile" class="modusleiste__zeile">
                    <slot name="zeile">
                        <span class="modusleiste__zeichen" aria-hidden="true"><EditorZeichen :name="zeichen" /></span>
                        <span class="modusleiste__titel">{{ titel }}</span>
                        <span class="modusleiste__objekt einzeilig">· {{ objekt }}</span>
                        <span class="modusleiste__aktionen">
                            <AvmKnopf
                                v-if="isoliert !== undefined"
                                groesse="zeile"
                                :gedrueckt="isoliert"
                                :title="t('modusleiste.isolierenTitel')"
                                :testid="testid && `${testid}-isolieren`"
                                @click="emit('isolieren')"
                            >
                                {{ t("modusleiste.isolieren") }}
                            </AvmKnopf>
                            <span class="modusleiste__zahl" :data-testid="testid && `${testid}-ungespeichert`">{{
                                t("modusleiste.ungespeichert", { n: String(ungespeichert) })
                            }}</span>
                            <button
                                type="button"
                                class="modusleiste__schritt"
                                :disabled="!zurueck"
                                :title="t('modusleiste.zurueck')"
                                :aria-label="t('modusleiste.zurueck')"
                                :data-testid="testid && `${testid}-zurueck`"
                                @click="emit('zurueck')"
                            >
                                ↶
                            </button>
                            <button
                                type="button"
                                class="modusleiste__schritt"
                                :disabled="!wieder"
                                :title="t('modusleiste.wieder')"
                                :aria-label="t('modusleiste.wieder')"
                                :data-testid="testid && `${testid}-wieder`"
                                @click="emit('wieder')"
                            >
                                ↷
                            </button>
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="ungespeichert === 0 ? t('modusleiste.nichtsZuVerwerfen') : undefined"
                                :testid="testid && `${testid}-verwerfen`"
                                @click="emit('verwerfen')"
                            >
                                {{ t("modusleiste.verwerfen") }}
                            </AvmKnopf>
                            <AvmKnopf
                                groesse="zeile"
                                art="gefuellt"
                                :gesperrt="fertigGrund"
                                :testid="testid && `${testid}-fertig`"
                                @click="emit('fertig')"
                            >
                                {{ t("modusleiste.fertig") }}
                            </AvmKnopf>
                        </span>
                    </slot>
                </div>
                <div
                    v-if="!telefon && $slots.zusatz"
                    class="modusleiste__zusatz"
                    :data-testid="testid && `${testid}-zusatz`"
                >
                    <slot name="zusatz" />
                </div>
                <slot v-if="!telefon" name="unten">
                    <p class="modusleiste__gesten">{{ gesten }}</p>
                </slot>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/*
 * Die Bühne spannt die freie Karte oben (im Rahmen der Seite `.app`, unter der Kopfleiste des Editors, nie über ihr); die Leiste steht
 * darin mittig. Den Rand der Panels setzt `rand`, der Abstand zur Kante ist der der Bunde (Guide §9).
 */
.modusbuehne {
    position: absolute;
    /* Steht oben schon die Ebenenleiste (Derographie), dann darunter (`--avm-leiste-oben`, `app.vue`, WI-0225). */
    top: calc(var(--space-10) + var(--avm-leiste-oben, 0px));
    right: 0;
    left: 0;
    z-index: var(--z-map-ui);
    display: flex;
    justify-content: center;
    /* Die Laschen „Routenplaner“ und „Info“ stehen neben ihren Panels, also in der freien Karte. */
    padding: 0 calc(var(--avesmaps-tab-w) + var(--space-10));
    pointer-events: none;
}

.modusbuehne--telefon {
    top: auto;
    bottom: 0;
    padding: 0;
}

/* Im Fenster (T45 (3)): im Fluss über dem Fuß, so breit wie das Fenster, ohne eigenes Blatt. */
.modusbuehne--fenster {
    position: static;
    padding: 0;
}

/* Ein Blatt über der Karte wie das Kartenmenü (§18); am Telefon unten über die ganze Breite. */
.modusleiste {
    display: grid;
    width: max-content;
    max-width: min(var(--avm-fenster-werkzeug), 100%);
    pointer-events: auto;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.modusleiste--fenster {
    width: 100%;
    max-width: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
}

/*
 * Im Fenster stehen Zahl, ↶ ↷, „Verwerfen“ und „Fertig“ als EINE Gruppe rechtsbündig (T45 (3), Fall 1): Das angedockte Fenster hängt
 * am rechten Rand, seine linke Kante wandert, wenn die Liste ein- oder ausfährt. Wird es zu schmal, bricht die Gruppe als Ganzes in die
 * nächste Zeile, wieder rechts; „Fertig“ bleibt an derselben Stelle.
 */
.modusleiste--fenster .modusleiste__aktionen {
    margin-left: auto;
}

.modusleiste--telefon {
    width: 100%;
    max-width: none;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.modusleiste__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-6) var(--space-6) var(--space-6) var(--space-10);
}

/* Was bearbeitet wird, in der Farbe der Kante (Knallrot, `editEdge`). */
.modusleiste__zeichen,
.modusleiste__titel {
    color: var(--color-edit-edge);
    white-space: nowrap;
}

.modusleiste__zeichen {
    display: grid;
    width: var(--icon-sm);
    place-items: center;
}

.modusleiste__objekt {
    min-width: 0;
    max-width: var(--avm-fenster-spalte);
    color: var(--color-text-strong);
}

.modusleiste__aktionen {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.modusleiste__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.modusleiste__schritt {
    display: grid;
    /* So hoch wie die Knöpfe der Zeile (`AvmKnopf` „zeile“). */
    width: var(--space-24);
    height: var(--space-24);
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    transition: background-color 120ms ease;
}

.modusleiste__schritt:hover:not(:disabled),
.modusleiste__schritt:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
}

.modusleiste__schritt:disabled {
    border-color: var(--color-border);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    cursor: default;
}

.modusleiste__zusatz {
    padding: var(--space-6) var(--space-10);
    border-top: 1px solid var(--color-border);
}

.modusleiste--telefon .modusleiste__zusatz {
    border-top: 0;
    border-bottom: 1px solid var(--color-border);
}

.modusleiste__gesten {
    margin: 0;
    padding: var(--space-4) var(--space-10) var(--space-6);
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.modusleiste--telefon .modusleiste__gesten {
    border-top: 0;
    border-bottom: 1px solid var(--color-border);
}

.modusleiste__fehler {
    margin: 0;
    padding: var(--space-4) var(--space-10);
    border-bottom: 1px solid var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.modusleiste__frage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-8);
    padding: var(--space-6) var(--space-10);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel-soft);
}

.modusleiste__fragetext {
    flex: 1 1 var(--avm-fenster-spalte);
    color: var(--color-text-strong);
}

@media (prefers-reduced-motion: reduce) {
    .modusleiste__schritt {
        transition: none;
    }
}
</style>
