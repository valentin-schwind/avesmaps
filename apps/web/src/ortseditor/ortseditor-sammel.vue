<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import {
    ORTSEDITOR,
    PLACE_SAMMEL_MAX,
    kinder,
    type OperationReceipt,
    type PlaceRemoval,
    type PlaceWikiField,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import { ueberAlle } from "../fenster/sammel";
import { formatList, formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import {
    eigeneJeFeld,
    feldWert,
    nacheinander,
    sammelEntfernenStand,
    type OrtSammel,
    type SammelApi,
} from "./ort-sammel";
import "./ortseditor-formular.css";

/**
 * Die Eigenschaften mehrerer angehakter Orte (WI-0237, EDIT-0003 T57; Vorlage Fassung 5 der Gebiete, Betreiber 2026-10-19: „perfekt genau
 * das wollen wir“). Logik und Sätze für alle: `ort-sammel.ts`, `fenster/sammel.ts`.
 *
 * - Kopf: „n Orte gewählt“, darunter die ersten Namen. Reiter: nur „Eigenschaften“; die übrigen grau mit „Nur einzeln“.
 * - Identität: jedes Feld mit seinem Wert, wenn er für alle gleich ist, sonst „gemischt“; geschrieben wird es nur einzeln. Die Wiki-Felder
 *   tragen ↺ „für alle auf den Wiki-Wert“ (gesperrt, wenn keiner der Orte dort einen eigenen Wert hat); danach steht „auf Wiki-Werte, gilt
 *   für alle n“ daran, und „Speichern“ im Fuß schreibt EINE Operation.
 * - Merkmale und „Ort verschieben“: nur einzeln. „Entfernen …“ fragt wie „Ort entfernen“, für alle; „Von der Karte nehmen“ geht nur einzeln.
 */
const props = defineProps<{
    kennung: string;
    sammel: OrtSammel;
    /** Die Namen der angehakten Zeilen, in Listenreihenfolge (auch die ohne angelegten Ort). */
    namen: readonly string[];
    /** Angehakte Zeilen ohne angelegten Ort (nur im Wiki): Sie bleiben außen vor. */
    ohneOrt: number;
    /** Warum nicht geschrieben werden kann (Recht, Bearbeiten aus); ohne Satz geht es. */
    gesperrt: string | undefined;
    api: Pick<SammelApi, "entfernenVorschau" | "loescheAlle">;
    /** Die Rechte der Person: Sie bestimmen, welche Reiter es gibt (wie einzeln). */
    rechte: readonly string[];
}>();
const emit = defineEmits<{ geloescht: [quittung: OperationReceipt, ids: readonly string[]] }>();

const n = computed(() => props.sammel.ids.length);
const nText = computed(() => formatNumber(n.value, 0));
const details = computed(() => [...props.sammel.details.value.values()]);
const zuViele = computed(() =>
    n.value > PLACE_SAMMEL_MAX ? t("ortseditor.sammel.zuViele", { n: formatNumber(PLACE_SAMMEL_MAX, 0) }) : undefined,
);
const sperre = computed(() => props.gesperrt ?? zuViele.value);

// --- Kopf und Reiter ---
const STREIFEN = 6;
const streifen = computed(() => props.namen.slice(0, STREIFEN));
const weitere = computed(() => Math.max(0, props.namen.length - STREIFEN));
type ReiterId = (typeof ORTSEDITOR)["eintraege"][number]["id"];
const REITER_NAMEN: Record<ReiterId, MessageKey> = {
    eigenschaften: "ortseditor.reiter.eigenschaften",
    innerorts: "ortseditor.reiter.innerorts",
    quellen: "ortseditor.reiter.quellen",
    bilder: "ortseditor.reiter.bilder",
    karten: "ortseditor.reiter.karten",
    verlauf: "ortseditor.reiter.verlauf",
};
const reiter = ref<ReiterId>("eigenschaften");
const reiterListe = computed(() =>
    // Karten gehören zu einem einzelnen Ort; der Reiter steht nur dort, wo es welche gibt.
    kinder(ORTSEDITOR, null, props.rechte)
        .filter((eintrag) => eintrag.id !== "karten")
        .map((eintrag) => {
            const id = eintrag.id as ReiterId;
            return {
                id,
                name: t(REITER_NAMEN[id]),
                spaeter: id === "eigenschaften" ? undefined : t("fenster.sammel.nurEinzeln"),
            };
        }),
);

// --- Identität ---
const FELDER: readonly { feld: PlaceWikiField | "kind"; name: MessageKey; wiki: boolean }[] = [
    { feld: "name", name: "ortseditor.feld.name", wiki: true },
    { feld: "subtype", name: "ortseditor.feld.groesse", wiki: true },
    { feld: "kind", name: "ortseditor.feld.art", wiki: false },
    { feld: "einwohner", name: "infoPanel.field.einwohner", wiki: true },
    { feld: "oberhaupt", name: "ortseditor.feld.herrscher", wiki: true },
    { feld: "lage", name: "infoPanel.field.lage", wiki: true },
    { feld: "description", name: "infoPanel.field.description", wiki: true },
];
const anzeige = (feld: PlaceWikiField | "kind", wert: string): string =>
    feld === "subtype" ? t(`place.${wert}` as MessageKey) : wert;
const werte = computed(() =>
    Object.fromEntries(
        FELDER.map(({ feld }) => {
            const ueber = ueberAlle(details.value, (detail) => feldWert(detail, feld));
            return [feld, ueber.gleich ? anzeige(feld, ueber.wert) : undefined];
        }),
    ),
);
const eigene = computed(() => eigeneJeFeld(details.value));
const alleWiki = computed(() =>
    FELDER.filter(
        (f) => f.wiki && eigene.value[f.feld as PlaceWikiField] > 0 && !props.sammel.entwurf.geaendert(f.feld),
    ),
);
function zurueckSatz(feld: PlaceWikiField): string {
    return t("ortseditor.sammel.wikiFuerAlle", { n: nText.value, k: formatNumber(eigene.value[feld], 0) });
}
function zurueckGesperrt(feld: PlaceWikiField): boolean {
    return (
        sperre.value !== undefined ||
        props.sammel.laedt.value ||
        eigene.value[feld] === 0 ||
        props.sammel.entwurf.geaendert(feld)
    );
}
function alleZurueck(): void {
    for (const f of alleWiki.value) props.sammel.entwurf.aufWiki(f.feld);
}

// --- Entfernen …: wie „Ort entfernen“, für alle; nur „Ganz löschen“ (Von der Karte nehmen geht nur einzeln) ---
const entfernenOffen = ref(false);
const vorschauen = shallowRef<readonly PlaceRemoval[] | undefined>(undefined);
const loeschtGerade = ref(false);
const loeschFehler = ref<string | undefined>(undefined);
let lesung: AbortController | undefined;
async function oeffneEntfernen(): Promise<void> {
    entfernenOffen.value = true;
    loeschFehler.value = undefined;
    vorschauen.value = undefined;
    lesung?.abort();
    const jetzt = new AbortController();
    lesung = jetzt;
    const gelesen = await nacheinander(props.sammel.ids, (id) =>
        props.api.entfernenVorschau(id, jetzt.signal).catch(() => null),
    );
    if (!jetzt.signal.aborted) vorschauen.value = gelesen.filter((ort): ort is PlaceRemoval => ort !== null);
}
function schliesseEntfernen(): void {
    lesung?.abort();
    entfernenOffen.value = false;
}
const entfernenStand = computed(() =>
    vorschauen.value === undefined ? undefined : sammelEntfernenStand(vorschauen.value),
);
const loeschSperre = computed(() => {
    if (sperre.value !== undefined) return sperre.value;
    if (entfernenStand.value === undefined) return t("ortseditor.sammel.entfernen.laedt");
    if (entfernenStand.value.gesperrt.length > 0) return t("ortseditor.sammel.entfernen.gesperrt");
    if (loeschtGerade.value) return t("ortseditor.speichernLaeuft");
    return undefined;
});
async function loescheAlle(): Promise<void> {
    const orte = vorschauen.value;
    if (orte === undefined || loeschSperre.value !== undefined) return;
    loeschtGerade.value = true;
    const antwort = await props.api.loescheAlle({
        operationId: crypto.randomUUID(),
        orte: orte.map((ort) => ({ id: ort.publicId, baseRevision: ort.revision })),
    });
    loeschtGerade.value = false;
    if (!antwort.ok) {
        loeschFehler.value = antwort.fehler.message;
        return;
    }
    entfernenOffen.value = false;
    emit(
        "geloescht",
        antwort.quittung,
        orte.map((ort) => ort.publicId),
    );
}
</script>

<template>
    <div class="ortsammel" :data-testid="`${kennung}-sammel`">
        <header class="ortsammel__kopf">
            <span class="ortsammel__zahl" :data-testid="`${kennung}-sammel-zahl`">{{
                tPlural("ortseditor.sammel.gewaehlt", n, { n: nText })
            }}</span>
            <span class="ortsammel__streifen">
                <span v-for="name in streifen" :key="name" class="ortsammel__name">{{ name }}</span>
                <span v-if="weitere > 0" class="ortsammel__name">{{
                    t("ortseditor.sammel.weitere", { n: formatNumber(weitere, 0) })
                }}</span>
            </span>
            <p v-if="ohneOrt > 0" class="ortsammel__leise">
                {{ tPlural("ortseditor.sammel.ohneOrt", ohneOrt, { n: formatNumber(ohneOrt, 0) }) }}
            </p>
        </header>
        <FensterReiter
            v-model="reiter"
            :reiter="reiterListe"
            :beschriftung="t('ortseditor.reiter')"
            :kennung="`${kennung}-sammel`"
        />
        <p v-if="sperre" class="ortsammel__leise" :data-testid="`${kennung}-sammel-gesperrt`">{{ sperre }}</p>
        <p v-else-if="sammel.laedt.value" class="ortsammel__leise">{{ t("editorListe.laedt") }}</p>

        <section class="ortsform__kasten">
            <div class="ortsammel__kastenkopf">
                <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.identitaet") }}</h4>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="alleWiki.length === 0 || sperre !== undefined ? '' : undefined"
                    :testid="`${kennung}-sammel-alle-wiki`"
                    @click="alleZurueck"
                >
                    {{ t("ortseditor.sammel.alleWiki", { n: nText }) }}
                </AvmKnopf>
            </div>
            <FensterFeldzeile
                v-for="f in FELDER"
                :key="f.feld"
                :name="t(f.name)"
                :fuer="`${kennung}-sammel-${f.feld}`"
                :testid="`${kennung}-sammel-zeile-${f.feld}`"
            >
                <AvmEingabe
                    :id="`${kennung}-sammel-${f.feld}`"
                    :model-value="werte[f.feld] ?? ''"
                    :placeholder="werte[f.feld] === undefined && details.length > 0 ? t('fenster.sammel.gemischt') : ''"
                    gesperrt=""
                    :testid="`${kennung}-sammel-feld-${f.feld}`"
                />
                <SammelHinweis
                    :art="f.wiki && sammel.entwurf.geaendert(f.feld) ? 'wiki' : 'einzeln'"
                    :n="n"
                    :testid="`${kennung}-sammel-hinweis-${f.feld}`"
                />
                <template v-if="f.wiki" #zurueck>
                    <button
                        type="button"
                        class="ortsammel__zurueck"
                        :disabled="zurueckGesperrt(f.feld as PlaceWikiField)"
                        :title="zurueckSatz(f.feld as PlaceWikiField)"
                        :aria-label="zurueckSatz(f.feld as PlaceWikiField)"
                        :data-testid="`${kennung}-sammel-wiki-${f.feld}`"
                        @click="sammel.entwurf.aufWiki(f.feld)"
                    >
                        ↺
                    </button>
                </template>
            </FensterFeldzeile>
        </section>

        <section class="ortsform__kasten">
            <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.merkmale") }}</h4>
            <SammelHinweis art="einzeln" />
        </section>

        <section class="ortsform__kasten">
            <h4 class="ortsform__titel">{{ t("ortseditor.abschnitt.lage") }}</h4>
            <AvmKnopf :gesperrt="t('fenster.sammel.nurEinzeln')" :testid="`${kennung}-sammel-verschieben`">{{
                t("ortseditor.verschieben")
            }}</AvmKnopf>
        </section>

        <section class="ortsform__kasten">
            <h4 class="ortsform__titel">{{ t("ortseditor.sammel.entfernen.titel") }}</h4>
            <AvmBestaetigung
                v-if="entfernenOffen"
                :frage="tPlural('ortseditor.sammel.entfernen.frage', n, { n: nText })"
                :bestaetigen="tPlural('ortseditor.sammel.entfernen.knopf', n, { n: nText })"
                :gesperrt="loeschSperre"
                :testid="`${kennung}-sammel-entfernen-blatt`"
                @bestaetigen="loescheAlle"
                @abbrechen="schliesseEntfernen"
            >
                <div class="ortsammel__wahl" role="radiogroup" :aria-label="t('ortseditor.sammel.entfernen.wie')">
                    <label class="ortsammel__wahlzeile is-aus">
                        <input type="radio" name="ortsammel-stufe" disabled />
                        <span
                            ><strong>{{ t("ortseditor.sammel.entfernen.abnehmen") }}</strong
                            ><small>{{ t("fenster.sammel.nurEinzeln") }}</small></span
                        >
                    </label>
                    <label class="ortsammel__wahlzeile">
                        <input type="radio" name="ortsammel-stufe" checked />
                        <span
                            ><strong>{{ t("ortseditor.sammel.entfernen.loeschen") }}</strong
                            ><small>{{ t("ortseditor.sammel.entfernen.loeschenSatz") }}</small></span
                        >
                    </label>
                </div>
                <p v-if="!entfernenStand" class="ortsammel__leise">{{ t("ortseditor.sammel.entfernen.laedt") }}</p>
                <ul v-else class="ortsammel__folgen" :data-testid="`${kennung}-sammel-entfernen-folgen`">
                    <li
                        v-for="ort in entfernenStand.gesperrt"
                        :key="ort.name"
                        class="ortsammel__warn"
                        :data-testid="`${kennung}-sammel-entfernen-sperre`"
                    >
                        {{ t("ortseditor.sammel.entfernen.sperre", { name: ort.name, grund: ort.grund }) }}
                    </li>
                    <li v-if="entfernenStand.staetten > 0">
                        {{
                            tPlural("ortseditor.sammel.entfernen.staetten", entfernenStand.staetten, {
                                n: formatNumber(entfernenStand.staetten, 0),
                            })
                        }}
                    </li>
                    <li v-if="entfernenStand.wegenden > 0">
                        {{
                            tPlural("ortseditor.sammel.entfernen.wegenden", entfernenStand.wegenden, {
                                n: formatNumber(entfernenStand.wegenden, 0),
                            })
                        }}
                    </li>
                    <li v-if="entfernenStand.gebiete.length > 0" class="ortsammel__warn">
                        {{ t("ortseditor.sammel.entfernen.gebiete", { gebiete: formatList(entfernenStand.gebiete) }) }}
                    </li>
                    <li>{{ t("ortseditor.sammel.entfernen.verlauf") }}</li>
                </ul>
                <p v-if="loeschFehler" class="ortsammel__warn" role="alert">{{ loeschFehler }}</p>
            </AvmBestaetigung>
            <AvmKnopf v-else :gesperrt="sperre" :testid="`${kennung}-sammel-entfernen`" @click="oeffneEntfernen">
                {{ t("ortseditor.sammel.entfernen.oeffnen") }}
            </AvmKnopf>
        </section>
    </div>
</template>

<style scoped>
.ortsammel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.ortsammel__kopf {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.ortsammel__zahl {
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

.ortsammel__streifen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.ortsammel__name {
    padding: 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.ortsammel__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ortsammel__kastenkopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
}

.ortsammel__zurueck {
    flex: none;
    width: 26px;
    height: 26px;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-sm);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
}

/* Gesperrt in einer eigenen Farbfassung, nie über Deckkraft (Guide §30.2). */
.ortsammel__zurueck:disabled {
    border-color: var(--color-border);
    background: var(--color-panel-muted);
    color: var(--color-placeholder);
    cursor: default;
}

.ortsammel__wahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.ortsammel__wahlzeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-6);
}

.ortsammel__wahlzeile small {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.ortsammel__wahlzeile.is-aus {
    color: var(--color-text-muted);
}

.ortsammel__folgen {
    margin: 0;
    padding-left: 1.1em;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--font-size-small);
}

.ortsammel__warn {
    color: var(--color-warning-soft-text);
}
</style>
