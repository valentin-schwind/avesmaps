<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { MediaSlotSubjectKind, MediaSubjectSlots } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { authState } from "../auth/session-state";
import { t } from "../i18n/i18n";
import MedienAuswahlFenster from "./medien-auswahl-fenster.vue";
import { istAbbruch } from "./medien-client";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import type { HochladenWeg } from "./medien-formular-modell";
import { bildName, freigabe, herkunft, ohneWappen } from "./medien-platz-text";

/**
 * DER Wappen-Kasten an einem Ort oder Gebiet (Editor-Orchestrierung 2026-10-19: „Ein gemeinsamer Wappen-Kasten aus dem Teil des
 * Ortseditors“): das gebundene Wappen mit Herkunft und Freigabe, „✚ Wappen hinzufügen …“ bzw. „⇄ Wappen ersetzen …“ über die Auswahl
 * der Medienverwaltung und „✕ Wappen entfernen“ („bewusst ohne“) nach einer Rückfrage. Der Ortseditor (Reiter „Bilder“) und die
 * Eigenschaften der Herrschaftsgebiete nehmen beide dieses Bauteil; kein Editor trägt einen eigenen.
 *
 * - Der Kasten lädt den Wappenplatz seines Subjekts selbst (`plaetze`) und nach jeder Handlung neu; danach meldet er `geaendert`.
 * - Jede Handlung ist EINE Operation der Medienverwaltung (`medien-operationen.ts`), sie wirkt sofort, ohne die Speicherleiste des
 *   Editors. Der gesehene Stand der Bindung geht mit: Ein Konflikt sagt, wer schneller war, und der Platz lädt neu.
 * - `darfAendern`: Der Editor schreibt gerade (nicht nur lesend). Bindungen ändern braucht dazu `upload_media`; das prüft der Kasten
 *   an der Sitzung. Ohne steht das Wappen nur da.
 * - Der Kasten steht im Reiter „Bilder“ (Ort und Herrschaftsgebiet) mit Rahmen, Titel und dem Verweis oben. Eine Form im Feld einer Feldzeile gibt es nicht mehr (WI-0253: das Wappen
 *   des Gebiets zog in den Reiter „Bilder“).
 */
const props = defineProps<{
    subjekt: { kind: MediaSlotSubjectKind; id: string; name: string };
    kennung: string;
    darfAendern: boolean;
    /** „Medienverwaltung › Wappen“ zeigen (wer die Medienverwaltung öffnen darf); der Klick meldet `medien`. */
    verweis?: boolean | undefined;
    /** Woher ein Upload aus der Auswahl kommt, im Formular unter „Weg“. */
    weg: Exclude<HochladenWeg, "medien">;
    operationen?: MedienOperationen | undefined;
}>();
const emit = defineEmits<{
    medien: [];
    /** Die Bindung hat sich geändert: Liste und Infopanel des Editors lesen neu. */
    geaendert: [];
}>();

const ops = props.operationen ?? createMedienOperationen();
const plaetze = shallowRef<MediaSubjectSlots | undefined>();
const ladeFehler = ref<string | undefined>();
const fehler = ref<OperationsFehler | undefined>();
const sendet = ref(false);
const fragen = ref(false);
const auswahlOffen = ref(false);
/** Erst nach dem ersten Öffnen steht das Auswahlfenster im Baum; danach bleibt es, `offen` schaltet es. */
const auswahlDa = ref(false);
/** Je Handlung eine Kennung: Ein unklarer Ausgang wiederholt dieselbe Handlung mit derselben Kennung. */
const handlungen = new Map<string, Handlung>();

let lauf: AbortController | undefined;
async function lade(): Promise<void> {
    lauf?.abort();
    const eigener = new AbortController();
    lauf = eigener;
    try {
        const stand = await ops.plaetze(props.subjekt.kind, props.subjekt.id, eigener.signal);
        if (!eigener.signal.aborted) {
            plaetze.value = stand;
            ladeFehler.value = undefined;
        }
    } catch (error) {
        if (!istAbbruch(error) && !eigener.signal.aborted) ladeFehler.value = operationsFehler(error).text;
    }
}

watch(
    () => `${props.subjekt.kind}:${props.subjekt.id}`,
    () => {
        plaetze.value = undefined;
        fehler.value = undefined;
        fragen.value = false;
        auswahlOffen.value = false;
        void lade();
    },
    { immediate: true },
);
onBeforeUnmount(() => lauf?.abort());

const wappen = computed(() => plaetze.value?.coat.asset ?? undefined);
const darf = computed(() => props.darfAendern && authState.value.capabilities.includes("upload_media"));
const gesperrt = computed(() => (sendet.value ? t("medien.bearbeiten.sendet") : undefined));
const folge = computed(() =>
    t(props.subjekt.kind === "territory" ? "medien.wappen.entfernenFolgeGebiet" : "ortseditor.bilder.entfernenFolge"),
);

function waehle(): void {
    fehler.value = undefined;
    auswahlDa.value = true;
    auswahlOffen.value = true;
}

function gebunden(): void {
    void lade();
    emit("geaendert");
}

async function wappenEntfernen(): Promise<void> {
    const baseRevision = plaetze.value?.coat.revision ?? null;
    if (baseRevision === null) return;
    const schluessel = `wappen-weg:${String(baseRevision)}`;
    sendet.value = true;
    fehler.value = undefined;
    const handlung = handlungen.get(schluessel) ?? new Handlung();
    handlungen.set(schluessel, handlung);
    try {
        await handlung.fuehreAus((operationId) =>
            ops.wappenBewusstOhne({
                operationId,
                subject: { kind: props.subjekt.kind, id: props.subjekt.id },
                baseRevision,
            }),
        );
        handlungen.delete(schluessel);
        fragen.value = false;
        emit("geaendert");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
        await lade();
    }
}
</script>

<template>
    <section class="wappen wappen--kasten" :data-testid="`${kennung}-bilder-wappen`">
        <div class="wappen__kopf">
            <h4 class="wappen__titel">{{ t("ortseditor.bilder.wappen") }}</h4>
            <button
                v-if="verweis"
                type="button"
                class="wappen__verweis"
                :data-testid="`${kennung}-medien-wappen`"
                @click="emit('medien')"
            >
                {{ t("ortseditor.bilder.zuWappen") }}
            </button>
        </div>
        <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" :testid="`${kennung}-bilder-wappen-ladefehler`">{{
            ladeFehler
        }}</AvmHinweis>
        <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" :testid="`${kennung}-bilder-wappen-fehler`">{{
            fehler.text
        }}</AvmHinweis>
        <div v-if="wappen" class="wappen__gebunden">
            <img
                v-if="wappen.preview"
                class="wappen__bild"
                :src="wappen.preview.url"
                :width="wappen.preview.width"
                :height="wappen.preview.height"
                alt=""
            />
            <span v-else class="wappen__bild wappen__bild--leer" aria-hidden="true"></span>
            <span class="wappen__text">
                <span class="wappen__name" :data-testid="`${kennung}-bilder-wappen-name`">{{ bildName(wappen) }}</span>
                <span class="wappen__leise">{{ herkunft(wappen) }}</span>
            </span>
            <AvmPille
                :ton="freigabe(wappen).ton"
                :title="freigabe(wappen).grund"
                :testid="`${kennung}-bilder-wappen-freigabe`"
                >{{ freigabe(wappen).text }}</AvmPille
            >
        </div>
        <p v-else-if="plaetze" class="wappen__leise" :data-testid="`${kennung}-bilder-ohne-wappen`">
            {{ ohneWappen(plaetze) }}
        </p>
        <div v-if="darf && plaetze" class="wappen__knoepfe">
            <AvmKnopf groesse="zeile" :gesperrt="gesperrt" :testid="`${kennung}-bilder-wappen-waehlen`" @click="waehle">
                {{ t(wappen ? "ortseditor.bilder.wappenErsetzen" : "ortseditor.bilder.wappenHinzu") }}
            </AvmKnopf>
            <AvmKnopf
                v-if="wappen && !fragen"
                groesse="zeile"
                art="gefahr"
                :gesperrt="gesperrt"
                :testid="`${kennung}-bilder-wappen-entfernen`"
                @click="fragen = true"
            >
                {{ t("ortseditor.bilder.wappenEntfernen") }}
            </AvmKnopf>
        </div>
        <AvmBestaetigung
            v-if="fragen && wappen"
            :frage="t('ortseditor.bilder.entfernenFrage', { ort: subjekt.name })"
            :folge="folge"
            :bestaetigen="t('ortseditor.bilder.entfernenKnopf')"
            :gesperrt="gesperrt"
            :testid="`${kennung}-bilder-wappen-frage`"
            @bestaetigen="wappenEntfernen"
            @abbrechen="fragen = false"
        />
        <MedienAuswahlFenster
            v-if="auswahlDa"
            v-model:offen="auswahlOffen"
            :subjekt="subjekt"
            rolle="coat"
            :darf-hochladen="darf"
            :weg="weg"
            :operationen="ops"
            @gebunden="gebunden"
        />
    </section>
</template>

<style scoped>
.wappen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.wappen--kasten {
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wappen__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.wappen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wappen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wappen__verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-decoration: underline;
}

.wappen__verweis:hover {
    color: var(--color-link-hover);
}

.wappen__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wappen__gebunden {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.wappen__bild {
    flex: none;
    width: var(--avm-fenster-daumen);
    height: auto;
}

.wappen__bild--leer {
    height: calc(var(--avm-fenster-daumen) * 1.2);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-sm);
}

.wappen__text {
    display: flex;
    flex: 1 1 12em;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.wappen__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.wappen__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}
</style>
