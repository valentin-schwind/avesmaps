<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from "vue";
import type { EditorPlaceKind } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { formatNumber, t } from "../i18n/i18n";
import { filtereOrtsarten, ladeOrtsarten, teileNachTreffer } from "./ortsarten";

/**
 * Das Feld „Art“ mit den Ortsarten aus dem Wiki (WI-0295; Legacy `js/ui/place-kind-autocomplete.js`, Entwurf „Neue Wiki-Bauwerke“ Fassung 2, Szene „Art wählen“,
 * von Vali am 2026-11-09 zum Bauen freigegeben). Discord am selben Tag: „Burg/Festung und Gut/Gutshof seh ich nimmie“: Unser Feld war ein leeres Textfeld.
 *
 * - **Beim Fokus die ganze Liste** (Legacy `minChars: 0`): Wer „Art“ öffnet, weiß oft noch nicht, was zur Wahl steht. Tippen filtert auf das Teilstück, das
 *   getippte Stück ist markiert. Rechts die Zahl der Orte mit dieser Art, „—“ für eine, die noch niemand benutzt hat.
 * - **Frei bleibt frei:** Was nicht in der Liste steht, darf man weiter eintragen; die Liste schlägt nur vor.
 * - **Tastatur** wie `wikisync-pillen-wahl.vue`: Pfeile wählen, Enter übernimmt, Escape schließt nur die Liste. Ein Klick auf einen Vorschlag übernimmt ihn,
 *   ohne dass das Feld den Fokus verliert. Die Liste bleibt im Fenster: Passt sie unter dem Feld nicht, öffnet sie darüber.
 * - **Ohne eigene Art** zeigt das leere Feld die Art laut Wiki als Platzhalter („Festung (aus dem Wiki)“): Die Infobox nimmt sie dann ohnehin.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
    id?: string | undefined;
    /** Die Bauwerkart laut Wiki-Stand, Platzhalter des leeren Felds. */
    wiki?: string | undefined;
    gesperrt?: string | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<string>({ default: "" });

const arten = ref<readonly EditorPlaceKind[]>([]);
const offen = ref(false);
const aktiv = ref(-1);
const listeId = useId();
const huelle = useTemplateRef<HTMLElement>("huelle");
const liste = useTemplateRef<HTMLElement>("liste");
const oben = ref(false);
const platz = ref<number | null>(null);

const treffer = computed(() => filtereOrtsarten(arten.value, wert.value));
const zeigen = computed(() => offen.value && treffer.value.length > 0);
const optionId = (i: number): string => `${listeId}-${String(i)}`;
const platzhalter = computed(() =>
    props.wiki ? t("ortseditor.art.ausWiki", { art: props.wiki }) : t("ortseditor.art.platzhalter"),
);

/** Wie `wikisync-pillen-wahl.vue`: unter dem Feld, wenn die Liste dort in den Rollbereich passt, sonst darüber, sonst gekürzt auf den größeren Platz. */
const MAX_HOEHE_PX = 260;
const RAND = 8;
function platziere(): void {
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
        const wunsch = Math.min(box.scrollHeight, MAX_HOEHE_PX);
        const unten = unterkante - feld.bottom - RAND;
        const drueber = feld.top - oberkante - RAND;
        const mindest = 120;
        if (unten >= wunsch) return;
        if (drueber > unten) {
            oben.value = true;
            platz.value = drueber >= wunsch ? null : Math.max(drueber, mindest);
        } else {
            platz.value = Math.max(unten, mindest);
        }
    });
}

async function oeffne(): Promise<void> {
    if (props.gesperrt) return;
    const warZu = !offen.value;
    offen.value = true;
    aktiv.value = -1;
    if (arten.value.length === 0) arten.value = await ladeOrtsarten();
    if (warZu && offen.value) platziere();
}

function nimm(art: string | undefined): void {
    if (art === undefined) return;
    wert.value = art;
    offen.value = false;
}

function zeigeAktiv(): void {
    void nextTick(() => document.getElementById(optionId(aktiv.value))?.scrollIntoView({ block: "nearest" }));
}

function taste(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!offen.value) void oeffne();
        else aktiv.value = Math.min(aktiv.value + 1, treffer.value.length - 1);
        zeigeAktiv();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        aktiv.value = Math.max(aktiv.value - 1, 0);
        zeigeAktiv();
    } else if (event.key === "Enter") {
        if (zeigen.value && aktiv.value >= 0) {
            event.preventDefault();
            nimm(treffer.value[aktiv.value]?.kind);
        }
    } else if (event.key === "Escape" && offen.value) {
        event.preventDefault();
        event.stopPropagation();
        offen.value = false;
    }
}

function getippt(): void {
    aktiv.value = -1;
    if (!offen.value) void oeffne();
}
</script>

<template>
    <span ref="huelle" class="ortsart-wahl">
        <AvmEingabe
            :id="id"
            v-model="wert"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="zeigen"
            :aria-controls="listeId"
            :aria-activedescendant="zeigen && aktiv >= 0 ? optionId(aktiv) : undefined"
            :placeholder="platzhalter"
            :gesperrt="gesperrt"
            autocomplete="off"
            maxlength="120"
            :testid="testid"
            @focus="oeffne"
            @input="getippt"
            @blur="offen = false"
            @keydown="taste"
        />
        <div
            v-if="zeigen"
            ref="liste"
            class="ortsart-wahl__liste"
            :class="{ 'is-oben': oben }"
            :style="platz === null ? undefined : { '--ortsart-wahl-platz': `${platz}px` }"
            :data-testid="testid ? `${testid}-liste` : undefined"
        >
            <div class="ortsart-wahl__kopf" aria-hidden="true">{{ t("ortseditor.art.kopf") }}</div>
            <ul :id="listeId" role="listbox" :aria-label="t('ortseditor.art.kopf')" class="ortsart-wahl__arten">
                <li
                    v-for="(art, i) in treffer"
                    :id="optionId(i)"
                    :key="art.kind"
                    role="option"
                    class="ortsart-wahl__art"
                    :class="{ 'is-aktiv': i === aktiv }"
                    :aria-selected="i === aktiv"
                    :data-art="art.kind"
                    @mousedown.prevent="nimm(art.kind)"
                    @mousemove="aktiv = i"
                >
                    <span class="ortsart-wahl__name"
                        ><template v-for="(stueck, s) in teileNachTreffer(art.kind, wert)" :key="s"
                            ><mark v-if="stueck.treffer">{{ stueck.text }}</mark
                            ><template v-else>{{ stueck.text }}</template></template
                        ></span
                    >
                    <span v-if="art.count > 0" class="ortsart-wahl__zahl">{{ formatNumber(art.count, 0) }}</span>
                    <span v-else class="ortsart-wahl__zahl is-nie" :title="t('ortseditor.art.nieBenutzt')">—</span>
                </li>
            </ul>
        </div>
    </span>
</template>

<style scoped>
.ortsart-wahl {
    position: relative;
    display: block;
    min-width: 0;
}

.ortsart-wahl__liste {
    position: absolute;
    z-index: 5;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    max-height: min(260px, 60vh, var(--ortsart-wahl-platz, 100vh));
    overflow: hidden;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
}

/* Über dem Feld, wo unter ihm kein Platz ist. */
.ortsart-wahl__liste.is-oben {
    inset-block-start: auto;
    inset-block-end: calc(100% + var(--space-2));
}

/* Die Überschrift wie die Titel der Abschnitte: klein, leise, in Großbuchstaben. */
.ortsart-wahl__kopf {
    flex: none;
    padding: var(--space-4) var(--space-8);
    border-block-end: 1px solid var(--color-border);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.ortsart-wahl__arten {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
}

.ortsart-wahl__art {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-8);
    border-block-end: 1px solid var(--color-divider);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--font-size-body);
    transition: background-color 120ms ease;
}

.ortsart-wahl__art.is-aktiv {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.ortsart-wahl__name mark {
    border-radius: 2px;
    background: var(--color-pill);
    color: var(--color-pill-text);
}

.ortsart-wahl__zahl {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
    .ortsart-wahl__art {
        transition: none;
    }
}
</style>
