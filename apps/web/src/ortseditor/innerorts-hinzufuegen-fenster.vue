<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { EditorSiteCandidate } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import {
    KEINE_HANDGRIFFE,
    UMKREIS_VORGABE,
    gewaehlt,
    hinzufuegenKoerper,
    kandidatSchluessel,
    umschalten,
    zeilen,
    type Handgriffe,
} from "./innerorts-auswahl";
import type { OrtseditorDaten } from "./ortseditor-daten";

/**
 * „Innerorts hinzufügen“ (WI-0196, EDIT-0003 T33 (3); Betreiber 2026-10-16: „Hier will man eine Button mit dem man Gebäude/Stätten und
 * Stadtviertel, die noch nicht woanders innerorts sind, hinzufügen können. Zur Vereinfachung der Suche kann man einen "Automatische
 * Auswahl von Gebäuden/Stätten und Stadtviertel im Umkreis von N Meilen" mit N = 1 default hinzufügen“).
 *
 * - Angeboten wird, was noch nirgends innerorts ist (`readSiteCandidates`): Gebäude und Stadtviertel der Karte mit Abstand, Stätten
 *   ohne Lage über die Suche.
 * - Vorgewählt ist, was im Umkreis liegt (Vorgabe 1 Meile); Haken von Hand gelten dagegen und überleben einen anderen Umkreis
 *   (`innerorts-auswahl.ts`). Oben steht immer alles Gewählte: Man sieht, was „Fertig“ schreibt.
 * - Geschrieben wird erst mit „Fertig“, in EINER Operation (`site.add`). Scheitert sie, steht der Satz des Servers hier, und nichts
 *   ist geschrieben.
 */
const props = defineProps<{
    publicId: string;
    ortName: string;
    kennung: string;
    daten: OrtseditorDaten;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ hinzugefuegt: [] }>();

const kandidaten = shallowRef<EditorSiteCandidate[]>([]);
const laedt = ref(false);
const ladeFehler = ref(false);
const suche = ref("");
const meilen = ref(UMKREIS_VORGABE);
const handgriffe = shallowRef<Handgriffe>(KEINE_HANDGRIFFE);
const sendet = ref(false);
const fehler = ref<string | undefined>();

let lauf: AbortController | undefined;
async function lade(): Promise<void> {
    lauf?.abort();
    const eigener = new AbortController();
    lauf = eigener;
    laedt.value = true;
    ladeFehler.value = false;
    try {
        const antwort = await props.daten.innerortsKandidaten(props.publicId, eigener.signal);
        if (!eigener.signal.aborted) kandidaten.value = antwort?.candidates ?? [];
    } catch {
        if (!eigener.signal.aborted) ladeFehler.value = true;
    } finally {
        if (!eigener.signal.aborted) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) {
            lauf?.abort();
            return;
        }
        suche.value = "";
        meilen.value = UMKREIS_VORGABE;
        handgriffe.value = KEINE_HANDGRIFFE;
        fehler.value = undefined;
        kandidaten.value = [];
        void lade();
    },
    { immediate: true },
);
onBeforeUnmount(() => lauf?.abort());

const wahl = computed(() => gewaehlt(kandidaten.value, meilen.value, handgriffe.value));
const liste = computed(() => zeilen(kandidaten.value, wahl.value, suche.value));

function setzeUmkreis(event: Event): void {
    const wert = Number.parseFloat((event.target as HTMLInputElement).value.replace(",", "."));
    meilen.value = Number.isFinite(wert) && wert >= 0 ? wert : 0;
}

function schalte(kandidat: EditorSiteCandidate): void {
    handgriffe.value = umschalten(
        kandidat,
        meilen.value,
        handgriffe.value,
        wahl.value.has(kandidatSchluessel(kandidat)),
    );
}

const QUELLE: Readonly<Record<string, MessageKey>> = {
    punkt: "ortseditor.innerorts.quelle.punkt",
    gespeichert: "ortseditor.innerorts.quelle.gespeichert",
    weg: "ortseditor.innerorts.quelle.weg",
    sitz: "ortseditor.innerorts.quelle.sitz",
    stadtteil: "ortseditor.innerorts.quelle.stadtteil",
};
const GROESSE: Readonly<Record<string, MessageKey>> = {
    gebaeude: "place.gebaeude",
    stadtviertel: "place.stadtviertel",
};

/** Die zweite Zeile: Art, Ortsgröße bzw. Quelle, Abstand - was es gibt, in dieser Folge. */
function merkmale(kandidat: EditorSiteCandidate): string {
    const teile: string[] = [];
    if (kandidat.type) teile.push(kandidat.type);
    if (kandidat.kind === "kartenpunkt") teile.push(t("ortseditor.innerorts.hinzu.kartenpunkt"));
    else if (kandidat.sourceKind) teile.push(t(QUELLE[kandidat.sourceKind]!));
    if (kandidat.siteClass && GROESSE[kandidat.siteClass]) teile.push(t(GROESSE[kandidat.siteClass]!));
    teile.push(
        kandidat.meilen === undefined
            ? t("ortseditor.innerorts.hinzu.ohneLage")
            : t("ortseditor.innerorts.hinzu.abstand", { n: formatNumber(kandidat.meilen, 1) }),
    );
    return teile.join(" · ");
}

const gesperrt = computed(() => {
    if (sendet.value) return t("ortseditor.innerorts.hinzu.sendet");
    if (wahl.value.size === 0) return t("ortseditor.innerorts.hinzu.nichts");
    return undefined;
});

async function fertig(): Promise<void> {
    if (gesperrt.value !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    const antwort = await props.daten.innerortsHinzufuegen(
        props.publicId,
        hinzufuegenKoerper(kandidaten.value, wahl.value, crypto.randomUUID()),
    );
    sendet.value = false;
    if (!antwort.ok) {
        fehler.value = antwort.fehler.message;
        return;
    }
    offen.value = false;
    emit("hinzugefuegt");
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('ortseditor.innerorts.hinzu.titel')"
        :zusatz="ortName"
        :testid="`${kennung}-innerorts-hinzu`"
    >
        <div class="hinzu">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert">{{ t("ortseditor.fehler") }}</AvmHinweis>
            <label class="hinzu__umkreis">
                <span>{{ t("ortseditor.innerorts.hinzu.umkreis") }}</span>
                <AvmFeld
                    class="hinzu__zahl"
                    type="number"
                    min="0"
                    step="0.5"
                    :value="meilen"
                    :data-testid="`${kennung}-innerorts-hinzu-umkreis`"
                    @input="setzeUmkreis"
                />
                <span>{{ t("ortseditor.innerorts.hinzu.meilen") }}</span>
            </label>
            <p class="hinzu__satz">{{ t("ortseditor.innerorts.hinzu.satz") }}</p>
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('ortseditor.innerorts.hinzu.suche')"
                :placeholder="t('ortseditor.innerorts.hinzu.suche')"
                :testid="`${kennung}-innerorts-hinzu-suche`"
            />
            <p class="hinzu__satz" :data-testid="`${kennung}-innerorts-hinzu-zahl`">
                {{ t("ortseditor.innerorts.hinzu.gewaehlt", { n: formatNumber(wahl.size, 0) }) }}
            </p>
            <p v-if="laedt" class="hinzu__satz">{{ t("editorListe.laedt") }}</p>
            <p v-else-if="liste.zeilen.length === 0" class="hinzu__satz">{{ t("ortseditor.innerorts.hinzu.leer") }}</p>
            <ul v-else class="hinzu__liste" :data-testid="`${kennung}-innerorts-hinzu-liste`">
                <li v-for="kandidat in liste.zeilen" :key="kandidatSchluessel(kandidat)">
                    <label
                        class="hinzu__zeile"
                        :class="{ 'is-gewaehlt': wahl.has(kandidatSchluessel(kandidat)) }"
                        :data-kandidat="kandidatSchluessel(kandidat)"
                        :data-testid="`${kennung}-innerorts-hinzu-zeile`"
                    >
                        <input
                            class="hinzu__haken"
                            type="checkbox"
                            :checked="wahl.has(kandidatSchluessel(kandidat))"
                            @change="schalte(kandidat)"
                        />
                        <span class="hinzu__text">
                            <span class="hinzu__name einzeilig">{{ kandidat.name }}</span>
                            <span class="hinzu__unter einzeilig">{{ merkmale(kandidat) }}</span>
                        </span>
                    </label>
                </li>
            </ul>
            <p v-if="liste.weitere > 0" class="hinzu__satz">
                {{ t("ortseditor.innerorts.hinzu.weitere", { n: formatNumber(liste.weitere, 0) }) }}
            </p>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" :testid="`${kennung}-innerorts-hinzu-fehler`">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf :testid="`${kennung}-innerorts-hinzu-abbrechen`" @click="offen = false">{{
                t("ortseditor.innerorts.hinzu.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="gesperrt"
                :testid="`${kennung}-innerorts-hinzu-fertig`"
                @click="fertig"
                >{{ t("ortseditor.innerorts.hinzu.fertig") }}</AvmKnopf
            >
        </template>
    </AvmFenster>
</template>

<style scoped>
.hinzu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.hinzu__umkreis {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.hinzu__zahl {
    /* Platz für die Zahl samt Pfeilen, in Zeichen statt Pixeln (Kanon: kein Maßliteral im Fenster). */
    width: 7ch;
}

.hinzu__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.hinzu__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 46vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

/* Eine Zeile wie in „Verlagern …“: durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.hinzu__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.hinzu__zeile:hover {
    background: var(--color-hover-wash);
}

.hinzu__zeile.is-gewaehlt {
    background: var(--color-active-wash);
}

.hinzu__zeile:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.hinzu__haken {
    flex: none;
    margin: 0;
}

.hinzu__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.hinzu__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.hinzu__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .hinzu__zeile {
        transition: none;
    }
}
</style>
