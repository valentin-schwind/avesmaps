<script setup lang="ts">
/**
 * Das Feld „Pille hinzufügen“ der Begriffstafel (WI-0253 §24, Vali 2026-10-27: „Autovervollständigung über unsere Landschaftsarten und Klimazonen“): ein Textfeld, das beim Tippen die Arten
 * und Zonen vorschlägt, die zum Wort passen (Anfang des Namens vor Teilstück, auch die Ebene zählt: „vegetation“ nennt alle ihre Arten). Vorgeschlagen wird nur, was es gibt und was das Wort noch nicht hat.
 *
 * - 🔴 **Ohne Text steht JEDE noch freie Pille da** (Vali 2026-10-27: „ich kann nur Vegetation auswählen“; bis dahin schnitt die Liste nach vierzehn Einträgen ab, und das waren genau die Arten der Vegetation).
 *   Die Liste ist nach Gruppen geordnet (Vegetation, Topographie, Regionen, Klimazonen), jede unter einer kleinen Überschrift, und rollt. Die Überschriften sind keine Optionen: Pfeile laufen über die Gruppen hinweg.
 * - 🔴 **Die Liste bleibt im Fenster:** Passt sie unter dem Feld nicht in den Rollbereich des Fensters (Zeilen weiter unten), öffnet sie sich über dem Feld; reicht auch dort der Platz nicht, wird sie auf den größeren
 *   Platz gekürzt und rollt. Entschieden wird beim Öffnen, nicht beim Tippen: Die Liste springt nicht zwischen oben und unten, wenn die Treffer weniger werden.
 * - **Tastatur:** Pfeile wählen (die gewählte Option rollt ins Bild), Enter übernimmt, Escape schließt die Liste (nur dann gilt Escape dem Feld und nicht dem Fenster). Ein Klick auf einen Vorschlag übernimmt ihn, ohne dass das Feld den Fokus verliert.
 * - Gespeichert wird nichts hier: Das Feld meldet nur die gewählte Pille (`waehle`); der Aufrufer speichert sofort.
 * - **Andere Auswahl** (Regeleditor, WI-0254 `--weiter`): `optionen` ersetzt die Liste aller Pillen, etwa durch die Landschaftsarten ohne die Klimazonen (die hat der Streifen), `platzhalter` den Text im Feld.
 *   Ohne beide steht das Feld da wie in der Begriffstafel.
 */
import { computed, nextTick, ref, useId, useTemplateRef } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { t } from "../i18n/i18n";
import { alleVonPillen, pillenGruppen, type PilleOption } from "./wikisync-regeln-text";

const props = defineProps<{
    /** Pillen, die das Wort schon hat (sie werden nicht noch einmal vorgeschlagen). */
    vergeben: readonly string[];
    /** Der Satz, warum das Feld gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    grundBei?: string | undefined;
    beschriftung: string;
    /** Die Pillen, aus denen gewählt wird; ohne Angabe alle (unsere Landschaftsarten und Klimazonen). */
    optionen?: readonly PilleOption[] | undefined;
    /** Der Text im leeren Feld; ohne Angabe „Pille hinzufügen“. */
    platzhalter?: string | undefined;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ waehle: [pille: string] }>();

const text = ref("");
const offen = ref(false);
const aktiv = ref(0);
const listeId = useId();
const huelle = useTemplateRef<HTMLElement>("huelle");
const liste = useTemplateRef<HTMLElement>("liste");
/** Öffnet die Liste über dem Feld (statt darunter); `platz` kürzt sie auf den Platz, den es dort gibt (px). */
const oben = ref(false);
const platz = ref<number | null>(null);
/** Die Gruppen mit der laufenden Nummer jeder Option über alle Gruppen: Sie ist, was `aktiv` zählt und die Pfeile bewegen. */
const gruppen = computed(() => {
    let index = 0;
    return pillenGruppen(text.value, props.vergeben, props.optionen ?? alleVonPillen()).map((gruppe) => ({
        ...gruppe,
        optionen: gruppe.optionen.map((option) => ({ ...option, index: index++ })),
    }));
});
const sichtbareOptionen = computed(() => gruppen.value.flatMap((gruppe) => gruppe.optionen));
const optionId = (i: number): string => `${listeId}-${String(i)}`;
const kopfId = (ebene: string): string => `${listeId}-kopf-${ebene}`;

/** Wie hoch die Liste höchstens wird (`max-height` im Stil, in der Schrift der Liste). */
const MAX_HOEHE_EM = 22;
/** Abstand zum Rand des Rollbereichs, den die Liste nicht unterschreitet (px). */
const RAND = 8;

/**
 * Entscheidet, wohin sich die Liste öffnet: Der Rollbereich ist der engste Vorfahr, der beschneidet (Rollbereich des Fensters, sonst die Seite). Unter dem Feld, wenn sie dort ganz hineinpasst, sonst über
 * dem Feld, wenn dort mehr Platz ist; ist es auf beiden Seiten eng, wird sie auf den größeren Platz gekürzt (höchstens so hoch, dass noch drei Zeilen zu sehen sind).
 */
function platziere(): void {
    // Zuerst zurück in die Ausgangslage (unter dem Feld, ungekürzt): Gemessen wird die Liste so, wie sie ohne Eingriff stünde.
    oben.value = false;
    platz.value = null;
    void nextTick(() => {
        const wurzel = huelle.value;
        const box = liste.value;
        if (wurzel === null || box === null) return;
        const feld = wurzel.getBoundingClientRect();
        let oberkante = 0;
        let unterkante = globalThis.innerHeight;
        for (let el = wurzel.parentElement; el !== null; el = el.parentElement) {
            if (!/auto|scroll|hidden|clip/u.test(getComputedStyle(el).overflowY)) continue;
            const rand = el.getBoundingClientRect();
            oberkante = Math.max(oberkante, rand.top);
            unterkante = Math.min(unterkante, rand.bottom);
        }
        const schrift = Number.parseFloat(getComputedStyle(box).fontSize) || 14;
        const abstand = Math.max(box.offsetTop - wurzel.offsetHeight, 0);
        const unten = unterkante - feld.bottom - abstand - RAND;
        const drueber = feld.top - oberkante - abstand - RAND;
        const wunsch = Math.min(box.scrollHeight, MAX_HOEHE_EM * schrift, globalThis.innerHeight * 0.6);
        const mindest = 6 * schrift;
        if (unten >= wunsch) {
            oben.value = false;
            platz.value = null;
        } else if (drueber > unten) {
            oben.value = true;
            platz.value = drueber >= wunsch ? null : Math.max(drueber, mindest);
        } else {
            oben.value = false;
            platz.value = Math.max(unten, mindest);
        }
    });
}

/** Öffnet die Liste; platziert wird nur beim Übergang von zu auf offen. */
function oeffne(): void {
    const warZu = !offen.value;
    offen.value = true;
    aktiv.value = 0;
    // Erst nach dem Zustandswechsel: `nextTick` wartet dann auf das Zeichnen der Liste, die es zu messen gilt.
    if (warZu) platziere();
}

function nimm(pille: string | undefined): void {
    if (pille === undefined) return;
    emit("waehle", pille);
    text.value = "";
    offen.value = false;
}

/** Rollt die gewählte Option ins Bild (nur in der Liste selbst, nie die Seite); die Überschrift darüber bleibt stehen, dafür sorgt `scroll-margin` der Option. */
function zeigeAktiv(): void {
    void nextTick(() => document.getElementById(optionId(aktiv.value))?.scrollIntoView({ block: "nearest" }));
}

function taste(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!offen.value) oeffne();
        else aktiv.value = Math.min(aktiv.value + 1, Math.max(sichtbareOptionen.value.length - 1, 0));
        zeigeAktiv();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        aktiv.value = Math.max(aktiv.value - 1, 0);
        zeigeAktiv();
    } else if (event.key === "Enter") {
        if (offen.value && sichtbareOptionen.value.length > 0) {
            event.preventDefault();
            nimm(sichtbareOptionen.value[aktiv.value]?.pille);
        }
    } else if (event.key === "Escape" && offen.value) {
        event.preventDefault();
        event.stopPropagation();
        offen.value = false;
    }
}
</script>

<template>
    <span ref="huelle" class="wsync-pillenwahl">
        <AvmEingabe
            v-model="text"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="offen && sichtbareOptionen.length > 0"
            :aria-controls="listeId"
            :aria-activedescendant="offen && sichtbareOptionen.length > 0 ? optionId(aktiv) : undefined"
            :aria-label="beschriftung"
            :placeholder="platzhalter ?? t('admin.wikisync.begriffe.pilleHinzu')"
            :gesperrt="gesperrt"
            :grund-bei="grundBei"
            autocomplete="off"
            maxlength="40"
            :testid="testid"
            @focus="oeffne"
            @input="oeffne"
            @blur="offen = false"
            @keydown="taste"
        />
        <ul
            v-if="offen && sichtbareOptionen.length > 0"
            :id="listeId"
            ref="liste"
            class="wsync-pillenwahl__liste"
            :class="{ 'is-oben': oben }"
            :style="platz === null ? undefined : { '--wsync-pillenwahl-platz': `${platz}px` }"
            role="listbox"
            :aria-label="beschriftung"
        >
            <li
                v-for="gruppe in gruppen"
                :key="gruppe.ebene"
                role="presentation"
                class="wsync-pillenwahl__gruppe"
                :data-ebene="gruppe.ebene"
            >
                <ul role="group" :aria-labelledby="kopfId(gruppe.ebene)" class="wsync-pillenwahl__arten">
                    <li :id="kopfId(gruppe.ebene)" role="presentation" class="wsync-pillenwahl__kopf">
                        {{ gruppe.name }}
                    </li>
                    <li
                        v-for="option in gruppe.optionen"
                        :id="optionId(option.index)"
                        :key="option.pille"
                        role="option"
                        class="wsync-pillenwahl__eintrag"
                        :class="{ 'is-aktiv': option.index === aktiv }"
                        :aria-selected="option.index === aktiv"
                        :data-pille="option.pille"
                        @mousedown.prevent="nimm(option.pille)"
                        @mousemove="aktiv = option.index"
                    >
                        {{ option.name }}
                    </li>
                </ul>
            </li>
        </ul>
    </span>
</template>

<style scoped>
.wsync-pillenwahl {
    position: relative;
    display: inline-block;
    min-width: 0;
    max-width: 100%;
}

.wsync-pillenwahl__liste {
    position: absolute;
    z-index: 5;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline-start: 0;
    box-sizing: border-box;
    min-width: 100%;
    width: max-content;
    max-width: min(24em, 80vw);
    max-height: min(22em, 60vh, var(--wsync-pillenwahl-platz, 100vh));
    margin: 0;
    padding: 0 var(--space-2) var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    list-style: none;
}

/* Über dem Feld, wo unter ihm kein Platz ist (Zeilen am unteren Rand des Fensters). */
.wsync-pillenwahl__liste.is-oben {
    inset-block-start: auto;
    inset-block-end: calc(100% + var(--space-2));
}

.wsync-pillenwahl__arten {
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Die Überschrift einer Gruppe: klein, leise, in Großbuchstaben wie die Titel der Abschnitte; beim Rollen bleibt sie oben stehen, bis die nächste sie ablöst. */
.wsync-pillenwahl__kopf {
    position: sticky;
    z-index: 1;
    inset-block-start: 0;
    padding: var(--space-6) var(--space-6) var(--space-2);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-pillenwahl__eintrag {
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--font-size-small);
    scroll-margin-block-start: 2.2em;
}

.wsync-pillenwahl__eintrag.is-aktiv {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}
</style>
