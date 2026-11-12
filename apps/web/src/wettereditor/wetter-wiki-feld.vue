<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    wetterWikiAdresse,
    type WetterSymbol,
    type WetterSymbolAenderungen,
    type WetterWikiArtikel,
} from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { t } from "../i18n/i18n";
import { wikiArtikelZu, wikiNamensvorschlag, wikiTreffer } from "./wetter-wiki";

/**
 * Das Feld „Wiki-Artikel“ eines Wetter-Icons (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“): ein Verweis auf den Artikel eines Winds, einer Meeresströmung oder eines Mahlstroms, wie
 * der Derographie-Zug ihn führt. Gesetzt steht der Titel als Verweis ins Wiki mit ✕ zum Lösen; sonst eine Suche über die Artikel. Gespeichert wird sofort wie bei jedem Feld des Icons (`setze`).
 *
 * - Kein Sync, keine Wiki-Felder: Das ist kein Kasten „Wiki“ eines Kartenobjekts (`WikiBox`), nur ein Verweis wie ein Link.
 * - **Name aus dem Titel** nur als Vorschlag mit eigenem Knopf, solange das Icon keinen Namen hat; nie von selbst.
 * - Die Liste lädt erst, wenn die Suche sie braucht (`brauche`).
 */
const props = defineProps<{
    symbol: WetterSymbol;
    artikel: readonly WetterWikiArtikel[] | undefined;
    fehler: boolean;
    gesperrt: string | undefined;
    kennung: string;
}>();
const emit = defineEmits<{
    setze: [aenderungen: WetterSymbolAenderungen];
    brauche: [];
}>();

const suche = ref("");
const offen = ref(false);
watch(
    () => props.symbol.id,
    () => {
        suche.value = "";
        offen.value = false;
    },
);
watch(suche, (text) => {
    if (text.trim() === "") return;
    offen.value = true;
    emit("brauche");
});

const titel = computed(() => props.symbol.wikiTitel ?? null);
const gesetzt = computed(() => wikiArtikelZu(props.artikel, titel.value));
const adresse = computed(() =>
    titel.value === null ? undefined : (gesetzt.value?.wikiUrl ?? wetterWikiAdresse(titel.value)),
);
const treffer = computed(() =>
    props.artikel === undefined ? [] : wikiTreffer(props.artikel, suche.value, props.symbol.art),
);
const vorschlag = computed(() =>
    titel.value !== null && props.symbol.name === null ? wikiNamensvorschlag(titel.value) : undefined,
);
const unterzeile = (eintrag: WetterWikiArtikel): string =>
    [eintrag.art, eintrag.region].filter((teil) => teil !== undefined && teil !== "").join(" · ");

function oeffne(): void {
    offen.value = true;
    emit("brauche");
}

function waehle(eintrag: WetterWikiArtikel): void {
    emit("setze", { wikiTitel: eintrag.titel });
    suche.value = "";
    offen.value = false;
}

function escape(event: KeyboardEvent): void {
    if (!offen.value) return;
    event.stopPropagation();
    offen.value = false;
}
</script>

<template>
    <FensterFeldzeile
        :name="t('wettereditor.icon.wiki')"
        :fuer="titel === null ? `${kennung}-wiki-suche` : undefined"
        :oben="(titel === null && offen) || vorschlag !== undefined"
        :testid="`${kennung}-wiki`"
    >
        <div class="wetter-wiki">
            <template v-if="titel !== null">
                <span class="wetter-wiki__gesetzt" :data-testid="`${kennung}-wiki-artikel`">
                    <a :href="adresse" target="_blank" rel="noopener" :title="t('wettereditor.icon.wiki.oeffnet')">{{
                        titel
                    }}</a>
                    <small v-if="gesetzt" class="wetter-wiki__leise">{{ gesetzt.art }}</small>
                    <button
                        type="button"
                        class="wetter-wiki__loesen"
                        :aria-label="t('wettereditor.icon.wiki.loesen')"
                        :title="gesperrt ?? t('wettereditor.icon.wiki.loesen')"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-wiki-loesen`"
                        @click="emit('setze', { wikiTitel: null })"
                    >
                        <span class="avm-versalmitte" aria-hidden="true">✕</span>
                    </button>
                </span>
                <span v-if="vorschlag !== undefined" class="wetter-wiki__vorschlag">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-wiki-namensvorschlag`"
                        @click="emit('setze', { name: vorschlag })"
                    >
                        {{ t("wettereditor.icon.wiki.name", { name: vorschlag }) }}
                    </AvmKnopf>
                </span>
            </template>
            <div v-else class="wetter-wiki__suche" @keydown.esc="escape">
                <AvmEingabe
                    :id="`${kennung}-wiki-suche`"
                    v-model="suche"
                    art="suche"
                    :placeholder="t('wettereditor.icon.wiki.suchen')"
                    :gesperrt="gesperrt"
                    :testid="`${kennung}-wiki-suche`"
                    autocomplete="off"
                    spellcheck="false"
                    @focus="oeffne"
                />
                <template v-if="offen">
                    <p v-if="fehler" class="wetter-wiki__leise" role="status">
                        {{ t("wettereditor.icon.wiki.fehler") }}
                    </p>
                    <p v-else-if="artikel === undefined" class="wetter-wiki__leise" role="status">
                        {{ t("wettereditor.icon.wiki.laedt") }}
                    </p>
                    <p v-else-if="treffer.length === 0" class="wetter-wiki__leise" role="status">
                        {{ t("wettereditor.icon.wiki.keine") }}
                    </p>
                    <ul v-else class="wetter-wiki__treffer" :aria-label="t('wettereditor.icon.wiki.treffer')">
                        <li v-for="eintrag in treffer" :key="eintrag.titel">
                            <button
                                type="button"
                                class="wetter-wiki__treffer-knopf"
                                :disabled="gesperrt !== undefined"
                                :data-testid="`${kennung}-wiki-treffer`"
                                @click="waehle(eintrag)"
                            >
                                <strong>{{ eintrag.titel }}</strong>
                                <small>{{ unterzeile(eintrag) }}</small>
                            </button>
                        </li>
                    </ul>
                </template>
            </div>
        </div>
    </FensterFeldzeile>
</template>

<style scoped>
.wetter-wiki {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.wetter-wiki__gesetzt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    min-width: 0;
}

.wetter-wiki__gesetzt a {
    color: var(--color-link);
    overflow-wrap: anywhere;
}

.wetter-wiki__gesetzt a:hover {
    color: var(--color-link-hover);
}

.wetter-wiki__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Das ✕ wie das Leeren der Suche: klein, ohne Rahmen, im Fokus mit Ring. */
.wetter-wiki__loesen {
    display: inline-grid;
    place-items: center;
    width: var(--space-24);
    height: var(--space-24);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
}

.wetter-wiki__loesen:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    color: var(--color-text-strong);
}

.wetter-wiki__loesen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wetter-wiki__loesen:disabled {
    cursor: default;
    opacity: 0.6;
}

.wetter-wiki__vorschlag {
    display: flex;
}

.wetter-wiki__suche {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

/* Die Treffer wie in der Artikelsuche der Wiki-Box (`wiki-box.vue`). */
.wetter-wiki__treffer {
    display: grid;
    gap: var(--space-2);
    max-height: 14rem;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}

.wetter-wiki__treffer-knopf {
    display: grid;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.wetter-wiki__treffer-knopf:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.wetter-wiki__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wetter-wiki__treffer-knopf:disabled {
    cursor: default;
    opacity: 0.6;
}

.wetter-wiki__treffer-knopf small {
    color: var(--color-text-muted);
}
</style>
