<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from "vue";
import {
    WIKISYNC_LAGE_RICHTUNGEN,
    type InhalteVorkommenLageOrt,
    type InhalteVorkommenUmriss,
    type WikisyncLageRichtung,
} from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPillenknopf from "../controls/avm-pillenknopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { isMessageKey, t } from "../i18n/i18n";
import { lageText, richtungName } from "../wikisync/wikisync-regeln-text";
import {
    LAGE_ORTE_MAX,
    alsLage,
    lageFertig,
    lageHalb,
    lageWarnung,
    skizze,
    type LageEntwurf,
} from "./inhalte-regel-lage";

/**
 * Das Feld „Lage zu einer Linie“ einer Bedingung (WI-0254, Regelbedingung Lage; Entwurf `d-editor.js`, von Vali am 2026-10-28 abgenommen): eine Richtung, ein oder zwei Orte, der Satz dazu und eine Skizze
 * auf dem Umriss Aventuriens, die zeigt, was die Lage zulässt.
 *
 * - **Ein Ort:** die Linie läuft quer durch ihn (waagerecht für nördlich und südlich, senkrecht für östlich und westlich). **Zwei Orte:** sie läuft durch beide; A–B ist B–A.
 * - **Die Orte kommen vom Server** (Siedlungen, nie Gebäude): Die Liste öffnet auch ohne Text und zeigt dann die Metropolen und Großstädte; getippt wird entprellt gesucht. Nichts wird geraten.
 * - **Halb gefüllt gilt nicht:** Das Feld meldet jeden Stand (`update:stand`), auch den halben; ob er eine Lage der Regel wird, entscheidet die Bedingung (`setzeLage`). „egal“ nimmt alles weg.
 * - **Warnung:** Läuft die Linie durch zwei Orte fast von Norden nach Süden, trennt sie Osten und Westen, nicht Norden und Süden (und umgekehrt); das Feld sagt es, rechnet aber wie gewählt.
 * - **Die Skizze:** Der Umriss kommt einmal vom Server (`umriss`); fehlt er, steht keine Skizze da, und alles andere geht. Die Halbebene beschneidet der Umriss; `ST_AsSVG` dreht `y` schon um, die Orte stehen darum mit `-y`.
 */
const props = defineProps<{
    stand: LageEntwurf;
    /** Die Nummer der Bedingung in der Kette, ab 1 (für die Namen der Elemente). */
    nummer: number;
    /** Was die Suche zum getippten Text fand. */
    treffer: readonly InhalteVorkommenLageOrt[];
    laedt: boolean;
    /** Wie viele Treffer die Suche höchstens liefert: Ist die Liste so lang, gibt es vermutlich weitere. */
    max: number;
    umriss: InhalteVorkommenUmriss | undefined;
}>();
const emit = defineEmits<{
    "update:stand": [stand: LageEntwurf];
    suche: [text: string];
    umrissLaden: [];
}>();

onMounted(() => emit("umrissLaden"));

// --- Richtung ---
const richtungen = computed(() => WIKISYNC_LAGE_RICHTUNGEN.map((wert) => ({ value: wert, label: richtungName(wert) })));
function waehleRichtung(wert: string): void {
    const richtung: WikisyncLageRichtung | undefined = WIKISYNC_LAGE_RICHTUNGEN.find((r) => r === wert);
    if (richtung !== undefined) emit("update:stand", { richtung, orte: props.stand.orte });
}
const leer = computed(() => props.stand.richtung === null && props.stand.orte.length === 0);
const egal = (): void => emit("update:stand", { richtung: null, orte: [] });

// --- Orte ---
const voll = computed(() => props.stand.orte.length >= LAGE_ORTE_MAX);
const gewaehlt = computed(() => new Set(props.stand.orte.map((o) => o.kennung)));
const sichtbar = computed(() => props.treffer.filter((o) => !gewaehlt.value.has(o.kennung)));
/** Was die Suche zu den gewählten Orten weiß (für den Hinweis am Zeichen): ihre Größe. */
const bekannt = ref(new Map<string, InhalteVorkommenLageOrt>());
/** Die Größe eines Ortes in der Sprache der Seite („Stadt“, „Dorf“). */
function artName(art: string): string {
    const key = `place.${art}`;
    return isMessageKey(key) ? t(key) : art;
}
const ortArt = (kennung: string): string | undefined => {
    const bekannter = bekannt.value.get(kennung);
    return bekannter === undefined ? undefined : artName(bekannter.art);
};

const text = ref("");
const menue = ref(false);
const aktiv = ref(0);
const listeId = useId();
const huelle = useTemplateRef<HTMLElement>("huelle");
const liste = useTemplateRef<HTMLElement>("liste");
const oben = ref(false);
const platz = ref<number | null>(null);
const optionId = (i: number): string => `${listeId}-${String(i)}`;
const zeigeMenue = computed(() => menue.value && !voll.value);
const keineTreffer = computed(() => zeigeMenue.value && !props.laedt && sichtbar.value.length === 0);

/** Wie hoch die Liste höchstens wird (in der Schrift der Liste) und der Abstand zum Rand des Rollbereichs, den sie nicht unterschreitet (px). */
const MAX_HOEHE_EM = 22;
const RAND = 8;
/** Wohin sich die Liste öffnet: unter das Feld, wenn sie in den Rollbereich passt, sonst darüber; reicht es nirgends, auf den größeren Platz gekürzt (wie die Liste der Flächen). */
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
        const schrift = Number.parseFloat(getComputedStyle(box).fontSize) || 14;
        const abstand = Math.max(box.offsetTop - wurzel.offsetHeight, 0);
        const unten = unterkante - feld.bottom - abstand - RAND;
        const drueber = feld.top - oberkante - abstand - RAND;
        const wunsch = Math.min(box.scrollHeight, MAX_HOEHE_EM * schrift, globalThis.innerHeight * 0.6);
        const mindest = 6 * schrift;
        if (unten >= wunsch) return;
        if (drueber > unten) {
            oben.value = true;
            platz.value = drueber >= wunsch ? null : Math.max(drueber, mindest);
        } else platz.value = Math.max(unten, mindest);
    });
}

function oeffneMenue(): void {
    const warZu = !menue.value;
    menue.value = true;
    aktiv.value = 0;
    // Ohne Text stehen die Metropolen und Großstädte da: Das Feld bittet darum, sobald es den Fokus bekommt.
    if (warZu) {
        emit("suche", text.value);
        platziere();
    }
}
function tippe(event: Event): void {
    oeffneMenue();
    aktiv.value = 0;
    emit("suche", (event.target as HTMLInputElement).value);
}
function schliesseMenue(): void {
    menue.value = false;
}
function waehleOrt(o: InhalteVorkommenLageOrt | undefined): void {
    if (o === undefined || voll.value || gewaehlt.value.has(o.kennung)) return;
    bekannt.value = new Map(bekannt.value).set(o.kennung, o);
    const orte = [...props.stand.orte, { kennung: o.kennung, name: o.name, x: o.x, y: o.y }];
    emit("update:stand", { richtung: props.stand.richtung, orte });
    text.value = "";
    aktiv.value = 0;
    emit("suche", "");
    // Mit dem zweiten Ort ist das Feld gesperrt und verliert den Fokus: Die Liste bleibt zu.
    if (orte.length >= LAGE_ORTE_MAX) menue.value = false;
}
function nimmOrtWeg(kennung: string): void {
    emit("update:stand", {
        richtung: props.stand.richtung,
        orte: props.stand.orte.filter((o) => o.kennung !== kennung),
    });
}
function zeigeAktiv(): void {
    void nextTick(() => document.getElementById(optionId(aktiv.value))?.scrollIntoView({ block: "nearest" }));
}
function taste(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!menue.value) oeffneMenue();
        else aktiv.value = Math.min(aktiv.value + 1, Math.max(sichtbar.value.length - 1, 0));
        zeigeAktiv();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        aktiv.value = Math.max(aktiv.value - 1, 0);
        zeigeAktiv();
    } else if (event.key === "Enter") {
        if (zeigeMenue.value && sichtbar.value.length > 0) {
            event.preventDefault();
            waehleOrt(sichtbar.value[aktiv.value]);
        }
    } else if (event.key === "Escape" && menue.value) {
        // Escape gilt dem Feld, nicht dem Fenster.
        event.preventDefault();
        event.stopPropagation();
        schliesseMenue();
    }
}

// --- Satz, Warnung, Skizze ---
const satz = computed(() =>
    lageFertig(props.stand) ? lageText(alsLage(props.stand)) : t("admin.wikisync.regeln.ueberall"),
);
const warnung = computed(() => {
    const w = lageWarnung(props.stand);
    if (w === "steil") return t("inhalte.vorkommen.regeleditor.lageSteil");
    if (w === "flach") return t("inhalte.vorkommen.regeleditor.lageFlach");
    return lageHalb(props.stand) ? t("inhalte.vorkommen.regeleditor.lageLeer") : undefined;
});
const bild = computed(() => (props.umriss === undefined ? undefined : skizze(props.stand, props.umriss.rahmen)));
/** Die Kennungen der Elemente in der Skizze: Jedes Feld hat seine eigenen, damit sich zwei Skizzen im Fenster nicht in die Quere kommen. */
const bildId = useId().replace(/\W/gu, "_");
const landId = `${bildId}-land`;
const landBeschnittId = `${bildId}-land-beschnitt`;
const rahmenBeschnittId = `${bildId}-rahmen-beschnitt`;
</script>

<template>
    <div class="rl" data-testid="inhalte-regel-lage">
        <div class="rl__wahl">
            <div class="rl__zeile">
                <AvmSegmente
                    class="rl__richtung"
                    :model-value="stand.richtung ?? ''"
                    :options="richtungen"
                    :label="`${t('inhalte.vorkommen.regeleditor.richtungLabel')} ${String(nummer)}`"
                    testid="inhalte-regel-lage-richtung"
                    @update:model-value="waehleRichtung"
                />
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="leer ? '' : undefined"
                    testid="inhalte-regel-lage-egal"
                    @click="egal"
                    >{{ t("inhalte.vorkommen.regeleditor.egal") }}</AvmKnopf
                >
            </div>

            <span ref="huelle" class="rl__ort">
                <AvmEingabe
                    v-model="text"
                    role="combobox"
                    aria-autocomplete="list"
                    :aria-expanded="zeigeMenue"
                    :aria-controls="listeId"
                    :aria-activedescendant="zeigeMenue && sichtbar.length > 0 ? optionId(aktiv) : undefined"
                    :aria-label="`${t('inhalte.vorkommen.regeleditor.feldLage')} ${String(nummer)}`"
                    :placeholder="t('inhalte.vorkommen.regeleditor.ortSuche')"
                    :gesperrt="voll ? t('inhalte.vorkommen.regeleditor.ortZwei') : undefined"
                    autocomplete="off"
                    testid="inhalte-regel-lage-ort"
                    @focus="oeffneMenue"
                    @input="tippe"
                    @blur="schliesseMenue"
                    @keydown="taste"
                />
                <ul
                    v-if="zeigeMenue"
                    :id="listeId"
                    ref="liste"
                    class="rl__liste"
                    :class="{ 'is-oben': oben }"
                    :style="platz === null ? undefined : { '--rl-platz': `${platz}px` }"
                    role="listbox"
                    :aria-label="t('inhalte.vorkommen.regeleditor.feldLage')"
                    data-testid="inhalte-regel-lage-orte"
                >
                    <li
                        v-for="(o, index) in sichtbar"
                        :id="optionId(index)"
                        :key="o.kennung"
                        role="option"
                        class="rl__eintrag"
                        :class="{ 'is-aktiv': index === aktiv }"
                        :aria-selected="index === aktiv"
                        :data-kennung="o.kennung"
                        @mousedown.prevent="waehleOrt(o)"
                        @mousemove="aktiv = index"
                    >
                        <span class="rl__eintrag-name">{{ o.name }}</span>
                        <span class="rl__eintrag-meta">{{ artName(o.art) }}</span>
                    </li>
                    <li v-if="laedt && sichtbar.length === 0" class="rl__leise" role="presentation">
                        {{ t("inhalte.laedt") }}
                    </li>
                    <li v-else-if="keineTreffer" class="rl__leise" role="presentation">
                        {{ t("inhalte.vorkommen.regeleditor.menueKeine") }}
                    </li>
                    <li v-else-if="treffer.length >= max" class="rl__leise" role="presentation">
                        {{ t("inhalte.vorkommen.regeleditor.menueWeitere") }}
                    </li>
                </ul>
            </span>

            <span v-if="stand.orte.length > 0" class="rl__zeichen">
                <AvmPillenknopf
                    v-for="o in stand.orte"
                    :key="o.kennung"
                    :title="ortArt(o.kennung)"
                    testid="inhalte-regel-lage-ort-weg"
                    @click="nimmOrtWeg(o.kennung)"
                    >{{ o.name }}<template #zeichen>✕</template></AvmPillenknopf
                >
            </span>

            <p class="rl__text" data-testid="inhalte-regel-lage-text">{{ satz }}</p>
            <p v-if="warnung !== undefined" class="rl__hinweis" data-testid="inhalte-regel-lage-warnung">
                {{ warnung }}
            </p>
        </div>

        <svg
            v-if="bild !== undefined && umriss !== undefined"
            class="rl__skizze"
            :viewBox="bild.ansicht"
            role="img"
            :aria-label="t('inhalte.vorkommen.regeleditor.lageKarte')"
            data-testid="inhalte-regel-skizze"
        >
            <title>{{ t("inhalte.vorkommen.regeleditor.lageKarte") }}</title>
            <defs>
                <path
                    :id="landId"
                    class="rl__land"
                    :d="umriss.pfad"
                    stroke-width="1"
                    vector-effect="non-scaling-stroke"
                />
                <clipPath :id="landBeschnittId"><use :href="`#${landId}`" /></clipPath>
                <clipPath :id="rahmenBeschnittId">
                    <rect
                        :x="bild.rahmen.x"
                        :y="bild.rahmen.y"
                        :width="bild.rahmen.breite"
                        :height="bild.rahmen.hoehe"
                    />
                </clipPath>
            </defs>
            <use :href="`#${landId}`" />
            <polygon
                v-if="bild.flaeche !== undefined"
                class="rl__teil"
                :points="bild.flaeche"
                :clip-path="`url(#${landBeschnittId})`"
                data-testid="inhalte-regel-skizze-teil"
            />
            <line
                v-if="bild.linie !== undefined"
                class="rl__linie"
                :x1="bild.linie.x1"
                :y1="bild.linie.y1"
                :x2="bild.linie.x2"
                :y2="bild.linie.y2"
                :clip-path="`url(#${rahmenBeschnittId})`"
                stroke-width="1.5"
                stroke-dasharray="5 3"
                vector-effect="non-scaling-stroke"
            />
            <template v-for="o in bild.orte" :key="o.name + String(o.cx)">
                <circle
                    class="rl__punkt"
                    :cx="o.cx"
                    :cy="o.cy"
                    r="11"
                    stroke-width="1"
                    vector-effect="non-scaling-stroke"
                />
                <text
                    class="rl__name"
                    :x="o.tx"
                    :y="o.ty"
                    :text-anchor="o.anker"
                    font-size="52"
                    stroke-width="3"
                    vector-effect="non-scaling-stroke"
                >
                    {{ o.name }}
                </text>
            </template>
        </svg>
    </div>
</template>

<style scoped>
.rl {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-8);
}

.rl__wahl {
    display: flex;
    flex: 1 1 16em;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.rl__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

/* Die Richtung sitzt so breit wie ihre Wörter, die Segmente etwas niedriger als ein Bedienelement (wie die Verknüpfung zwischen zwei Bedingungen). */
.rl__richtung {
    flex: 0 1 auto;
    grid-auto-columns: auto;
}

.rl__richtung :deep(.segmente__segment) {
    height: var(--space-24);
    padding: 0 var(--space-8);
}

.rl__ort {
    position: relative;
    display: block;
    min-width: 0;
}

.rl__ort :deep(.eingabe-huelle) {
    display: flex;
    width: 100%;
}

.rl__zeichen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.rl__text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.rl__hinweis {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

/* Die Auswahl der Orte: dieselbe Liste wie die der Flächen (Rand, Schatten, Hover), mit zwei Zeilen je Eintrag. */
.rl__liste {
    position: absolute;
    z-index: 30;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline-start: 0;
    box-sizing: border-box;
    min-width: 100%;
    width: max-content;
    max-width: min(24em, 80vw);
    max-height: min(22em, 60vh, var(--rl-platz, 100vh));
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    list-style: none;
}

.rl__liste.is-oben {
    inset-block-start: auto;
    inset-block-end: calc(100% + var(--space-2));
}

.rl__eintrag {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--font-size-small);
}

.rl__eintrag.is-aktiv {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.rl__eintrag-meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.rl__leise {
    padding: var(--space-4) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Skizze: Aventurien blass, die Halbebene eingefärbt, die Linie gestrichelt, die Orte als Punkte mit Namen. Linienstärken und Schriftgröße stehen als Attribute am Element (Einheiten der Karte). */
.rl__skizze {
    display: block;
    flex: 0 0 auto;
    width: 11em;
    height: auto;
}

.rl__land {
    fill: color-mix(in srgb, var(--color-text) 13%, transparent);
    stroke: var(--color-border-strong);
}

.rl__teil {
    fill: var(--color-accent);
    opacity: 0.45;
}

.rl__linie {
    stroke: var(--color-accent-strong);
}

.rl__punkt {
    fill: var(--color-text-strong);
    stroke: var(--color-panel);
}

.rl__name {
    fill: var(--color-text-strong);
    paint-order: stroke;
    stroke: var(--color-panel);
}
</style>
