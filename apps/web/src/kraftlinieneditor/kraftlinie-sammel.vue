<script setup lang="ts">
import { computed, ref } from "vue";
import { POWERLINE_SAMMEL_MAX } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { showToast } from "../feedback/toast";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import { ueberAlle } from "../fenster/sammel";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { felderAus } from "./kraftlinie-art";
import { eigeneJeFeld, type KraftlinieSammel, type SammelEntfernen } from "./kraftlinie-sammel";
import type { KraftlinieWikiFeld } from "./kraftlinie-wiki-felder";

/**
 * Die Eigenschaften mehrerer angehakter Kraftlinien (WI-0238, EDIT-0003 T57; Vorlage Fassung 5 der Gebiete, wie am Ort
 * `ortseditor-sammel.vue`). Logik: `kraftlinie-sammel.ts`, `fenster/sammel.ts`.
 *
 * - Kopf: „n Kraftlinien gewählt“, darunter die ersten Namen. Reiter: nur „Eigenschaften“; „Verlauf“ grau mit „Nur einzeln“.
 * - Identität: Name, Beschriftung und Beschreibung mit ihrem Wert, wenn er für alle gleich ist, sonst „gemischt“; geschrieben werden sie
 *   nur einzeln. Name und Beschreibung tragen ↺ „für alle auf den Wiki-Wert“ (gesperrt, wenn keine Linie dort einen eigenen Wert hat);
 *   danach steht „auf Wiki-Werte, gilt für alle n“ daran, und „Fertig“ in der Leiste schreibt EINE Operation.
 * - Nodices und Kurve: nur einzeln. „Entfernen …“ fragt wie an einer Linie, in zwei Stufen, für alle; sofort nach der Bestätigung.
 */
const props = defineProps<{
    kennung: string;
    sammel: KraftlinieSammel;
    /** Darf Felder schreiben (`edit_map_objects`) und die Form (`edit_map_geometry`), und ist Bearbeiten an? */
    darfFelder?: boolean | undefined;
    darfForm?: boolean | undefined;
}>();
const emit = defineEmits<{ entfernt: [] }>();

const n = computed(() => props.sammel.ids.length);
const nText = computed(() => formatNumber(n.value, 0));
const details = computed(() => [...props.sammel.details.value.values()]);
const laedt = computed(() => details.value.length < n.value && !props.sammel.ladeFehler.value);
const entwurf = computed(() => props.sammel.entwurf);
const zuViele = computed(() =>
    n.value > POWERLINE_SAMMEL_MAX
        ? t("kraftlinieneditor.sammel.zuViele", { n: formatNumber(POWERLINE_SAMMEL_MAX, 0) })
        : undefined,
);
const sperre = computed(() => zuViele.value ?? (props.darfFelder === true ? undefined : t("editorPanel.verb.lesen")));

// --- Kopf und Reiter ---
const STREIFEN = 6;
const namen = computed(() => props.sammel.zeilen().map((zeile) => zeile.name));
const streifen = computed(() => namen.value.slice(0, STREIFEN));
const weitere = computed(() => Math.max(0, namen.value.length - STREIFEN));
const reiter = ref<"eigenschaften" | "verlauf">("eigenschaften");
const reiterListe = computed(() => [
    { id: "eigenschaften" as const, name: t("kraftlinieneditor.reiter.eigenschaften") },
    { id: "verlauf" as const, name: t("kraftlinieneditor.reiter.verlauf"), spaeter: t("fenster.sammel.nurEinzeln") },
]);

// --- Identität ---
const werte = computed(() => {
    const felder = details.value.map(felderAus);
    const wert = <T,>(ueber: { gleich: true; wert: T } | { gleich: false }): T | undefined =>
        ueber.gleich ? ueber.wert : undefined;
    return {
        name: wert(ueberAlle(felder, (f) => f.name)),
        description: wert(ueberAlle(felder, (f) => f.description)),
        labelVisible: wert(ueberAlle(felder, (f) => f.labelVisible)),
    };
});
const gemischt = computed(() => (details.value.length > 0 ? t("fenster.sammel.gemischt") : ""));
const eigene = computed(() => eigeneJeFeld(details.value));
const WIKI_FELDER: readonly KraftlinieWikiFeld[] = ["name", "description"];
const offeneWiki = computed(() =>
    WIKI_FELDER.filter((feld) => eigene.value[feld] > 0 && !entwurf.value.geaendert(feld)),
);
function zurueckSatz(feld: KraftlinieWikiFeld): string {
    return t("kraftlinieneditor.sammel.wikiFuerAlle", { n: nText.value, k: formatNumber(eigene.value[feld], 0) });
}
const zurueckGesperrt = (feld: KraftlinieWikiFeld): boolean =>
    sperre.value !== undefined || laedt.value || eigene.value[feld] === 0 || entwurf.value.geaendert(feld);
function alleZurueck(): void {
    for (const feld of offeneWiki.value) entwurf.value.aufWiki(feld);
}

// --- Entfernen …: wie an einer Linie, in zwei Stufen, für alle ---
const fragt = ref(false);
const wahl = ref<SammelEntfernen>("abnehmen");
const laeuft = ref(false);
const satz = ref<string | undefined>(undefined);
const TITEL = {
    abnehmen: () => t("kraftlinieneditor.entfernen.abnehmen"),
    loeschen: () => t("kraftlinieneditor.entfernen.loeschen"),
} as const;
const SATZ = {
    abnehmen: () => t("kraftlinieneditor.entfernen.abnehmenSatz"),
    loeschen: () => t("kraftlinieneditor.entfernen.loeschenSatz"),
} as const;
/** Von der Karte nehmen ist die Lage (`edit_map_geometry`, wie an einer Linie), ganz löschen die Sache (`edit_map_objects`). */
const darfWahl = (art: SammelEntfernen): boolean => (art === "abnehmen" ? props.darfForm : props.darfFelder) === true;
/** Was nicht mehr auf der Karte ist, kann nicht mit; die Auswahl muss dann kleiner werden. */
const nichtAufKarte = computed(() => details.value.find((linie) => linie.state !== undefined));
const entfernenGrund = computed(() => {
    if (zuViele.value !== undefined) return zuViele.value;
    if (laeuft.value) return t("kraftlinieneditor.bearbeiten.speichert");
    if (laedt.value) return t("kraftlinieneditor.sammel.laedt");
    if (!darfWahl(wahl.value)) return t("editorPanel.verb.lesen");
    // Mitten im ↺ für alle wird nicht entfernt: erst „Fertig“ oder verwerfen (wie an einer Linie).
    if (entwurf.value.lage.value.aktiv) return t("verlauf.gesperrtBearbeitung");
    const weg = nichtAufKarte.value;
    return weg === undefined ? undefined : t("kraftlinieneditor.sammel.nichtAufKarte", { name: weg.name });
});
function oeffneEntfernen(): void {
    fragt.value = true;
    satz.value = undefined;
    if (!darfWahl(wahl.value)) wahl.value = wahl.value === "abnehmen" ? "loeschen" : "abnehmen";
}
async function entferne(): Promise<void> {
    if (entfernenGrund.value !== undefined) return;
    const wie = wahl.value;
    laeuft.value = true;
    satz.value = await props.sammel.entferne(wie);
    laeuft.value = false;
    if (satz.value !== undefined) return;
    fragt.value = false;
    showToast(
        tPlural(
            wie === "abnehmen" ? "kraftlinieneditor.sammel.abgenommen" : "kraftlinieneditor.sammel.geloescht",
            n.value,
            { n: nText.value },
        ),
        "success",
    );
    emit("entfernt");
}
</script>

<template>
    <div class="kraftliniesammel" :data-testid="`${kennung}-sammel`">
        <header class="kraftliniesammel__kopf">
            <span class="kraftliniesammel__zahl" :data-testid="`${kennung}-sammel-zahl`">{{
                tPlural("kraftlinieneditor.sammel.gewaehlt", n, { n: nText })
            }}</span>
            <span class="kraftliniesammel__streifen">
                <span v-for="name in streifen" :key="name" class="kraftliniesammel__name">{{ name }}</span>
                <span v-if="weitere > 0" class="kraftliniesammel__name">{{
                    t("kraftlinieneditor.sammel.weitere", { n: formatNumber(weitere, 0) })
                }}</span>
            </span>
        </header>
        <FensterReiter
            v-model="reiter"
            :reiter="reiterListe"
            :beschriftung="t('kraftlinieneditor.reiter')"
            :kennung="`${kennung}-sammel`"
        />
        <p v-if="sperre" class="kraftliniesammel__leise" :data-testid="`${kennung}-sammel-gesperrt`">{{ sperre }}</p>
        <p v-if="sammel.ladeFehler.value" class="kraftliniesammel__leise">
            {{ t("kraftlinieneditor.sammel.ladefehler") }}
        </p>
        <p v-else-if="laedt" class="kraftliniesammel__leise">{{ t("kraftlinieneditor.sammel.laedt") }}</p>

        <section class="kraftliniesammel__kasten">
            <div class="kraftliniesammel__kastenkopf">
                <h4 class="kraftliniesammel__titel">{{ t("kraftlinieneditor.abschnitt.identitaet") }}</h4>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="offeneWiki.length === 0 || sperre !== undefined ? '' : undefined"
                    :testid="`${kennung}-sammel-alle-wiki`"
                    @click="alleZurueck"
                >
                    {{ t("kraftlinieneditor.sammel.alleWiki", { n: nText }) }}
                </AvmKnopf>
            </div>
            <FensterFeldzeile
                :name="t('kraftlinieneditor.feld.name')"
                :fuer="`${kennung}-sammel-name`"
                :testid="`${kennung}-sammel-zeile-name`"
            >
                <AvmEingabe
                    :id="`${kennung}-sammel-name`"
                    :model-value="werte.name ?? ''"
                    :placeholder="werte.name === undefined ? gemischt : ''"
                    gesperrt=""
                    :testid="`${kennung}-sammel-feld-name`"
                />
                <SammelHinweis
                    :art="entwurf.geaendert('name') ? 'wiki' : 'einzeln'"
                    :n="n"
                    :testid="`${kennung}-sammel-hinweis-name`"
                />
                <template #zurueck>
                    <button
                        type="button"
                        class="kraftliniesammel__zurueck"
                        :disabled="zurueckGesperrt('name')"
                        :title="zurueckSatz('name')"
                        :aria-label="zurueckSatz('name')"
                        :data-testid="`${kennung}-sammel-wiki-name`"
                        @click="entwurf.aufWiki('name')"
                    >
                        ↺
                    </button>
                </template>
            </FensterFeldzeile>
            <FensterFeldzeile
                :name="t('kraftlinieneditor.feld.beschriftung')"
                :testid="`${kennung}-sammel-zeile-beschriftung`"
            >
                <AvmKaestchen
                    v-if="werte.labelVisible !== undefined"
                    art="checkbox"
                    :checked="werte.labelVisible"
                    :gesperrt="t('fenster.sammel.nurEinzeln')"
                    :testid="`${kennung}-sammel-feld-beschriftung`"
                >
                    {{ t("kraftlinieneditor.feld.beschriftungAn") }}
                </AvmKaestchen>
                <AvmEingabe v-else model-value="" :placeholder="gemischt" gesperrt="" />
                <SammelHinweis art="einzeln" />
            </FensterFeldzeile>
            <FensterFeldzeile
                :name="t('kraftlinieneditor.feld.beschreibung')"
                :fuer="`${kennung}-sammel-beschreibung`"
                :testid="`${kennung}-sammel-zeile-beschreibung`"
            >
                <AvmEingabe
                    :id="`${kennung}-sammel-beschreibung`"
                    :model-value="werte.description ?? ''"
                    :placeholder="werte.description === undefined ? gemischt : ''"
                    gesperrt=""
                    :testid="`${kennung}-sammel-feld-beschreibung`"
                />
                <SammelHinweis
                    :art="entwurf.geaendert('description') ? 'wiki' : 'einzeln'"
                    :n="n"
                    :testid="`${kennung}-sammel-hinweis-beschreibung`"
                />
                <template #zurueck>
                    <button
                        type="button"
                        class="kraftliniesammel__zurueck"
                        :disabled="zurueckGesperrt('description')"
                        :title="zurueckSatz('description')"
                        :aria-label="zurueckSatz('description')"
                        :data-testid="`${kennung}-sammel-wiki-beschreibung`"
                        @click="entwurf.aufWiki('description')"
                    >
                        ↺
                    </button>
                </template>
            </FensterFeldzeile>
        </section>

        <section class="kraftliniesammel__kasten">
            <h4 class="kraftliniesammel__titel">{{ t("kraftlinieneditor.sammel.nodices") }}</h4>
            <SammelHinweis art="einzeln" />
        </section>

        <section class="kraftliniesammel__kasten">
            <h4 class="kraftliniesammel__titel">{{ t("entwurf.form") }}</h4>
            <AvmKnopf :gesperrt="t('fenster.sammel.nurEinzeln')" :testid="`${kennung}-sammel-kurve`">{{
                t("kraftlinieneditor.bearbeiten.form")
            }}</AvmKnopf>
        </section>

        <section class="kraftliniesammel__kasten">
            <h4 class="kraftliniesammel__titel">{{ t("kraftlinieneditor.sammel.entfernen.titel") }}</h4>
            <AvmBestaetigung
                v-if="fragt"
                :frage="tPlural('kraftlinieneditor.sammel.entfernen.frage', n, { n: nText })"
                :bestaetigen="
                    tPlural(
                        wahl === 'abnehmen'
                            ? 'kraftlinieneditor.sammel.entfernen.abnehmenKnopf'
                            : 'kraftlinieneditor.sammel.entfernen.loeschenKnopf',
                        n,
                        { n: nText },
                    )
                "
                :gesperrt="entfernenGrund"
                :testid="`${kennung}-sammel-entfernen-blatt`"
                @bestaetigen="entferne"
                @abbrechen="fragt = false"
            >
                <div
                    class="kraftliniesammel__wahl"
                    role="radiogroup"
                    :aria-label="t('kraftlinieneditor.griff.entfernen')"
                >
                    <AvmKaestchen
                        v-for="art in ['abnehmen', 'loeschen'] as const"
                        :key="art"
                        art="radio"
                        :name="`${kennung}-sammel-entfernen-wahl`"
                        mehrzeilig
                        :checked="wahl === art"
                        :gesperrt="darfWahl(art) ? undefined : t('editorPanel.verb.lesen')"
                        :testid="`${kennung}-sammel-entfernen-${art}`"
                        @change="wahl = art"
                    >
                        <span class="kraftliniesammel__wahlzeichen" aria-hidden="true"
                            ><EditorZeichen :name="art === 'loeschen' ? 'loeschen' : 'abnehmen'"
                        /></span>
                        <span class="kraftliniesammel__wahltext">
                            <strong>{{ TITEL[art]() }}</strong>
                            <small>{{ SATZ[art]() }}</small>
                        </span>
                    </AvmKaestchen>
                </div>
                <ul class="kraftliniesammel__folgen" :data-testid="`${kennung}-sammel-entfernen-folgen`">
                    <li>{{ t("kraftlinieneditor.sammel.entfernen.folge") }}</li>
                    <li>{{ t("kraftlinieneditor.sammel.entfernen.verlauf") }}</li>
                </ul>
                <p v-if="satz" class="kraftliniesammel__warn" role="alert">{{ satz }}</p>
            </AvmBestaetigung>
            <AvmKnopf
                v-else
                :gesperrt="
                    zuViele ?? (darfWahl('abnehmen') || darfWahl('loeschen') ? undefined : t('editorPanel.verb.lesen'))
                "
                :testid="`${kennung}-sammel-entfernen`"
                @click="oeffneEntfernen"
            >
                {{ t("kraftlinieneditor.sammel.entfernen.oeffnen") }}
            </AvmKnopf>
        </section>
    </div>
</template>

<style scoped>
.kraftliniesammel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.kraftliniesammel__kopf {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.kraftliniesammel__zahl {
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

.kraftliniesammel__streifen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.kraftliniesammel__name {
    padding: 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.kraftliniesammel__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Kasten wie in den Eigenschaften einer Linie (`kraftlinieneditor__abschnitt`). */
.kraftliniesammel__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kraftliniesammel__kastenkopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
}

.kraftliniesammel__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kraftliniesammel__zurueck {
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
.kraftliniesammel__zurueck:disabled {
    border-color: var(--color-border);
    background: var(--color-panel-muted);
    color: var(--color-placeholder);
    cursor: default;
}

.kraftliniesammel__wahl {
    display: grid;
    gap: var(--space-4);
}

.kraftliniesammel__wahltext {
    display: grid;
    gap: var(--space-2);
}

.kraftliniesammel__wahltext small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kraftliniesammel__folgen {
    margin: 0;
    padding-left: 1.1em;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--font-size-small);
}

.kraftliniesammel__warn {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}
</style>
