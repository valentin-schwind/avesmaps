<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { SpracheEditorArtikel, SpracheEditorArtikelListe, SpracheEditorPille } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { t } from "../i18n/i18n";
import { pilleDazu, pilleNach, pilleSchieben, pilleWeg, wikiArtikelUrl } from "./sprache-felder";

/**
 * Die Wiki-Artikel einer Sprache als Pillen (WI-0261 S5d2; O1: eine Sprache je Kartengruppe trägt einen oder mehrere Artikel; Bauvorlage
 * `fenster-sprachen.js` `wikiPillen`): in ihrer Folge, ziehen oder ↑ ↓ ordnet um, ✕ löst, darunter die Suche „Wiki-Artikel suchen und
 * zuordnen“ über `GET /api/editor/sprachen-artikel`. Jede Änderung ist ein Schritt im Entwurf der Sprache (`setze`); „Fertig“ schreibt.
 *
 * - Gehört ein Artikel schon einer anderen Sprache, sagt der Vorschlag es: Zuordnen nimmt ihn ihr weg (der Server protokolliert es an
 *   beiden).
 * - Ein Artikel, den der WikiSync stillgelegt hat, steht als „im Wiki verschwunden“ da; er darf bleiben, aber nicht neu dazukommen.
 * - Die Namen der Pillen kommen aus dem gelesenen Stand und aus den Vorschlägen; eine Pille aus einem gesicherten Entwurf, die beides nicht
 *   kennt, steht mit „…“ da, bis sie gelesen ist.
 */
const props = defineProps<{
    /** Die Kennungen der Artikel in ihrer Folge (der Entwurf). */
    pillen: readonly string[];
    /** Die gelesenen Pillen der Sprache: Titel, Familie, „noch im Wiki“. */
    bekannt: readonly SpracheEditorPille[];
    /** Die Sprache dieses Fensters: Ein Artikel, der ihr gehört, ist kein Wechsel. */
    sprache: string;
    /** Lesend: ohne Knöpfe und ohne Suche. */
    lesend: boolean;
    suche: (q: string, signal: AbortSignal) => Promise<SpracheEditorArtikelListe>;
    kennung: string;
}>();
const emit = defineEmits<{ setze: [liste: readonly string[]] }>();

interface Info {
    readonly titel: string;
    readonly unter: string | undefined;
    readonly imWiki: boolean;
}
/** Was über einen Artikel bekannt ist: gelesen oder aus einem Vorschlag. */
const infos = shallowRef(new Map<string, Info>());
watch(
    () => props.bekannt,
    (bekannt) => {
        const neu = new Map(infos.value);
        for (const pille of bekannt)
            neu.set(pille.id, { titel: pille.titel, unter: pille.sprachfamilie ?? undefined, imWiki: pille.imWiki });
        infos.value = neu;
    },
    { immediate: true },
);
const info = (id: string): Info => infos.value.get(id) ?? { titel: "…", unter: undefined, imWiki: true };

const setze = (liste: readonly string[]): void => {
    if (liste !== props.pillen) emit("setze", liste);
};

// --- Ziehen ---
const gezogen = ref<string | undefined>(undefined);
const ueber = ref<number | undefined>(undefined);
function ziehStart(event: DragEvent, id: string): void {
    gezogen.value = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}
function ziehUeber(event: DragEvent, index: number): void {
    if (gezogen.value === undefined) return;
    event.preventDefault();
    ueber.value = index;
}
function abgelegt(event: DragEvent, index: number): void {
    const id = gezogen.value;
    event.preventDefault();
    gezogen.value = undefined;
    ueber.value = undefined;
    if (id === undefined) return;
    const von = props.pillen.indexOf(id);
    // `index` zählt in der Liste MIT der gezogenen Pille: dahinter rückt alles eins vor.
    setze(pilleNach(props.pillen, id, von < index ? index - 1 : index));
}
function ziehEnde(): void {
    gezogen.value = undefined;
    ueber.value = undefined;
}

// --- Suche ---
const tippen = ref("");
const offen = ref(false);
const treffer = shallowRef<readonly SpracheEditorArtikel[]>([]);
const laedt = ref(false);
const fehler = ref(false);
let frage: AbortController | undefined;
let uhr: ReturnType<typeof setTimeout> | undefined;
function frageNach(): void {
    if (uhr !== undefined) clearTimeout(uhr);
    uhr = setTimeout(() => {
        frage?.abort();
        const steuer = new AbortController();
        frage = steuer;
        laedt.value = true;
        fehler.value = false;
        props.suche(tippen.value, steuer.signal).then(
            (liste) => {
                if (frage !== steuer) return;
                laedt.value = false;
                treffer.value = liste.artikel;
                const neu = new Map(infos.value);
                for (const artikel of liste.artikel)
                    if (!neu.has(artikel.id))
                        neu.set(artikel.id, {
                            titel: artikel.titel,
                            unter: artikel.sprachfamilie ?? undefined,
                            imWiki: true,
                        });
                infos.value = neu;
            },
            () => {
                if (frage !== steuer || steuer.signal.aborted) return;
                laedt.value = false;
                fehler.value = true;
            },
        );
    }, 200);
}
watch(tippen, () => {
    if (offen.value) frageNach();
});
function oeffne(): void {
    offen.value = true;
    frageNach();
}
const vorschlaege = computed(() => treffer.value.filter((artikel) => !props.pillen.includes(artikel.id)).slice(0, 8));
function nimm(artikel: SpracheEditorArtikel): void {
    tippen.value = "";
    setze(pilleDazu(props.pillen, artikel.id));
}
function taste(event: KeyboardEvent): void {
    if (event.key === "Enter") {
        event.preventDefault();
        const erster = vorschlaege.value[0];
        if (erster !== undefined) nimm(erster);
    } else if (event.key === "Escape" && offen.value) {
        event.stopPropagation();
        offen.value = false;
    } else if (event.key === "Backspace" && tippen.value === "" && props.pillen.length > 0) {
        setze(props.pillen.slice(0, -1));
    }
}
/** Der Hinweis am Vorschlag: Gehört er einer anderen Sprache, nimmt das Zuordnen ihn ihr weg. */
function besitzerText(artikel: SpracheEditorArtikel): string | undefined {
    const besitzer = artikel.besitzer;
    if (besitzer === null || besitzer.id === props.sprache) return undefined;
    return besitzer.aktiv
        ? t("spracheditor.wiki.gehoert", { name: besitzer.name })
        : t("spracheditor.wiki.gehoertStill", { name: besitzer.name });
}
function zu(): void {
    // Erst nach dem Klick auf einen Vorschlag schließen: Das Blur kommt vor dem Klick.
    setTimeout(() => (offen.value = false), 160);
}
onBeforeUnmount(() => {
    frage?.abort();
    if (uhr !== undefined) clearTimeout(uhr);
});

const hinweis = computed(() => {
    const n = props.pillen.length;
    if (n > 1) return t("spracheditor.wiki.gruppe", { n: String(n) });
    if (n === 1) return t("spracheditor.wiki.einer");
    return t("spracheditor.wiki.keiner");
});
</script>

<template>
    <div class="pillen" :data-testid="`${kennung}-wiki`">
        <ol v-if="pillen.length > 0" class="pillen__liste" :aria-label="t('spracheditor.wiki.liste')">
            <li
                v-for="(id, index) in pillen"
                :key="id"
                class="pillen__pille"
                :class="{ 'is-ueber': ueber === index, 'is-weg': !info(id).imWiki }"
                :draggable="lesend ? undefined : 'true'"
                :data-testid="`${kennung}-pille`"
                @dragstart="ziehStart($event, id)"
                @dragover="ziehUeber($event, index)"
                @drop="abgelegt($event, index)"
                @dragend="ziehEnde"
            >
                <span v-if="!lesend" class="pillen__griff" aria-hidden="true"></span>
                <a
                    class="pillen__titel einzeilig"
                    :href="wikiArtikelUrl(info(id).titel)"
                    target="_blank"
                    rel="noopener"
                    >{{ info(id).titel }}</a
                >
                <span
                    v-if="!info(id).imWiki"
                    class="pillen__weg"
                    :title="t('spracheditor.wiki.verschwundenTitel')"
                    :data-testid="`${kennung}-pille-weg`"
                    >{{ t("spracheditor.wiki.verschwunden") }}</span
                >
                <template v-if="!lesend">
                    <button
                        type="button"
                        class="pillen__knopf"
                        :disabled="index === 0"
                        :aria-label="t('spracheditor.wiki.hoch', { titel: info(id).titel })"
                        :title="t('spracheditor.wiki.hochTitel')"
                        @click="setze(pilleSchieben(pillen, id, -1))"
                    >
                        ↑
                    </button>
                    <button
                        type="button"
                        class="pillen__knopf"
                        :disabled="index === pillen.length - 1"
                        :aria-label="t('spracheditor.wiki.runter', { titel: info(id).titel })"
                        :title="t('spracheditor.wiki.runterTitel')"
                        @click="setze(pilleSchieben(pillen, id, 1))"
                    >
                        ↓
                    </button>
                    <button
                        type="button"
                        class="pillen__knopf pillen__knopf--weg"
                        :aria-label="t('spracheditor.wiki.weg', { titel: info(id).titel })"
                        :title="t('spracheditor.wiki.wegTitel')"
                        :data-testid="`${kennung}-pille-loesen`"
                        @click="setze(pilleWeg(pillen, id))"
                    >
                        ✕
                    </button>
                </template>
            </li>
        </ol>
        <p v-else class="pillen__leer">{{ t("spracheditor.wiki.keine") }}</p>
        <div v-if="!lesend" class="pillen__suche">
            <AvmEingabe
                v-model="tippen"
                art="suche"
                :placeholder="t('spracheditor.wiki.platzhalter')"
                :aria-label="t('spracheditor.wiki.suche')"
                autocomplete="off"
                :testid="`${kennung}-wiki-suche`"
                @focus="oeffne"
                @blur="zu"
                @keydown="taste"
            />
            <ul
                v-if="offen"
                class="pillen__vorschlaege"
                role="listbox"
                :aria-label="t('spracheditor.wiki.vorschlaege')"
                :data-testid="`${kennung}-wiki-vorschlaege`"
            >
                <li v-if="laedt && vorschlaege.length === 0" class="pillen__still">
                    {{ t("spracheditor.wiki.laedt") }}
                </li>
                <li v-else-if="fehler" class="pillen__still">{{ t("spracheditor.wiki.fehler") }}</li>
                <li v-else-if="vorschlaege.length === 0" class="pillen__still">
                    {{ tippen.trim() === "" ? t("spracheditor.wiki.alleDa") : t("spracheditor.wiki.nichts") }}
                </li>
                <li v-for="artikel in vorschlaege" :key="artikel.id" role="option" aria-selected="false">
                    <button
                        type="button"
                        class="pillen__vorschlag"
                        :data-testid="`${kennung}-wiki-vorschlag`"
                        @mousedown.prevent
                        @click="nimm(artikel)"
                    >
                        <span class="pillen__vname">{{ artikel.titel }}</span>
                        <small v-if="artikel.sprachfamilie">{{ artikel.sprachfamilie }}</small>
                        <small v-if="besitzerText(artikel)" class="pillen__besitzer">{{ besitzerText(artikel) }}</small>
                    </button>
                </li>
            </ul>
        </div>
        <p class="pillen__hinweis">{{ hinweis }}</p>
    </div>
</template>

<style scoped>
.pillen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.pillen__liste {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.pillen__pille {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.pillen__pille.is-ueber {
    border-color: var(--color-accent);
}

.pillen__pille.is-weg {
    border-style: dashed;
}

/* Der Griff des Hauses (⠿) zum Ziehen. */
.pillen__griff {
    width: var(--space-4);
    height: var(--space-8);
    background-image: radial-gradient(circle, var(--color-text-muted) 1px, transparent 1.2px);
    background-size: var(--space-2) var(--space-2);
    cursor: grab;
}

.pillen__titel {
    min-width: 0;
    color: var(--color-link);
}

.pillen__titel:hover {
    color: var(--color-link-hover);
}

.pillen__weg {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
}

.pillen__knopf {
    display: inline-grid;
    place-items: center;
    min-width: var(--space-12);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    line-height: 1;
}

.pillen__knopf:hover:not(:disabled) {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.pillen__knopf--weg:hover:not(:disabled) {
    color: var(--color-danger);
}

.pillen__knopf:disabled {
    opacity: 0.35;
    cursor: default;
}

.pillen__knopf:focus-visible,
.pillen__vorschlag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.pillen__leer,
.pillen__hinweis,
.pillen__still {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.pillen__suche {
    position: relative;
}

.pillen__vorschlaege {
    display: grid;
    gap: var(--space-2);
    max-height: 16rem;
    margin: var(--space-2) 0 0;
    padding: var(--space-4);
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-field-float);
    list-style: none;
}

.pillen__vorschlag {
    display: grid;
    width: 100%;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.pillen__vorschlag:hover {
    background: var(--color-hover-wash);
}

.pillen__vorschlag small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.pillen__vorschlag .pillen__besitzer {
    color: var(--color-warning-soft-text);
}

@media (prefers-reduced-motion: reduce) {
    .pillen__knopf {
        transition: none;
    }
}
</style>
