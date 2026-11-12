<script setup lang="ts">
import { computed, ref } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import SammelHinweis from "../fenster/sammel-hinweis.vue";
import type { Ueber } from "../fenster/sammel";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { artName } from "./wege-liste";
import { wegName } from "./wegeditor-texte";
import { sammelWerte, type WegSammel } from "./weg-sammel";

/**
 * Die Eigenschaften mehrerer angehakter Wege (WI-0252; Muster `kraftlinieneditor/kraftlinie-sammel.vue`, EDIT-0003 T57, Fassung 5 der
 * Gebiete). Logik: `weg-sammel.ts`.
 *
 * - Kopf: „n Wege gewählt“, darunter die ersten Namen. Reiter: „Eigenschaften“; „Verlauf“ grau mit „Nur einzeln“.
 * - Identität: Name, Wegtyp, Kennzeichen, „Name auf der Karte“ und Tunnel mit ihrem Wert, wenn er für alle Abschnitte gleich ist, sonst
 *   „gemischt“ (Vorgabe des Betreibers 2026-10-19: „gemischte eigenschaftsfelder werden als solches gekennzeichnet“). Geschrieben werden
 *   sie einzeln.
 * - Abschnitte und Form: nur einzeln (die Leiste (W) (1) (2) und die Wegkurve gehören einer Straße). Im Kasten „Form“ steht, was mit
 *   der ganzen Auswahl geht (Slots `formKnopf`, `formFrage`; „Auswahl zu neuem Weg“ aus dem Fenster).
 * - Entfernen: „Weg entfernen …“ öffnet das Blatt der Seite für alle gewählten Wege in EINER Operation (Von der Karte nehmen oder Ganz
 *   löschen, `weg-entfernen.ts`; WI-0252, Betreiber 2026-10-25: „entfernen -> ganz löschen geht noch nicht mit mehrfachauswahl“).
 */
const props = defineProps<{
    kennung: string;
    sammel: WegSammel;
    /** Darf diese Sitzung Wege schreiben? Sonst steht „Weg entfernen …“ grau. */
    darfEntfernen?: boolean | undefined;
}>();
const emit = defineEmits<{ entfernen: [] }>();

const n = computed(() => props.sammel.ids.length);
const nText = computed(() => formatNumber(n.value, 0));
const strassen = computed(() => [...props.sammel.strassen.value.values()]);
const laedt = computed(() => strassen.value.length < n.value && !props.sammel.ladeFehler.value);
const werte = computed(() => (strassen.value.length === n.value ? sammelWerte(strassen.value) : undefined));

// --- Kopf und Reiter ---
const STREIFEN = 6;
const namen = computed(() => props.sammel.zeilen().map(wegName));
const streifen = computed(() => namen.value.slice(0, STREIFEN));
const weitere = computed(() => Math.max(0, namen.value.length - STREIFEN));
const reiter = ref<"eigenschaften" | "verlauf">("eigenschaften");
const reiterListe = computed(() => [
    { id: "eigenschaften" as const, name: t("wegeditor.fenster.reiter.eigenschaften") },
    { id: "verlauf" as const, name: t("wegeditor.fenster.reiter.verlauf"), spaeter: t("fenster.sammel.nurEinzeln") },
]);

// --- Werte: gleich mit Wert, sonst „gemischt“ ---
const gemischt = computed(() => (werte.value === undefined ? "" : t("fenster.sammel.gemischt")));
const text = <T,>(ueber: Ueber<T> | undefined, wie: (wert: T) => string): string =>
    ueber === undefined || !ueber.gleich ? "" : wie(ueber.wert);
const jaNein = (an: boolean): string => (an ? t("editorListe.ja") : t("editorListe.nein"));
const name = computed(() => text(werte.value?.name, (wert) => wert));
const wegtyp = computed(() => text(werte.value?.wegtyp, artName));
const kennzeichen = computed(() =>
    text(werte.value?.karawanenroute, (an) => (an ? t("wegeditor.art.karawanenroute") : t("editorListe.nein"))),
);
const nameAufKarte = computed(() => text(werte.value?.nameAufKarte, jaNein));
const tunnel = computed(() => text(werte.value?.tunnel, jaNein));
const artikel = computed(() =>
    text(werte.value?.artikel, (titel) => (titel === "" ? t("editorListe.unter.keinArtikel") : titel)),
);
const FELDER = computed(() => [
    { id: "name", name: t("wegeditor.fenster.feld.name"), wert: name.value },
    { id: "wegtyp", name: t("wegeditor.fenster.feld.wegtyp"), wert: wegtyp.value },
    { id: "kennzeichen", name: t("wegeditor.fenster.feld.kennzeichen"), wert: kennzeichen.value },
    { id: "name-auf-karte", name: t("wegeditor.fenster.feld.nameAufKarte"), wert: nameAufKarte.value },
    { id: "tunnel", name: t("wegeditor.fenster.feld.tunnel"), wert: tunnel.value },
    { id: "wiki", name: t("kraftlinieneditor.abschnitt.wiki"), wert: artikel.value },
]);
</script>

<template>
    <div class="wegsammel" :data-testid="`${kennung}-sammel`">
        <header class="wegsammel__kopf">
            <span class="wegsammel__zahl" :data-testid="`${kennung}-sammel-zahl`">{{
                tPlural("wegeditor.mehrfach.gewaehlt", n, { n: nText })
            }}</span>
            <span class="wegsammel__streifen">
                <span v-for="(eintrag, i) in streifen" :key="`${i}-${eintrag}`" class="wegsammel__name">{{
                    eintrag
                }}</span>
                <span v-if="weitere > 0" class="wegsammel__name">{{
                    t("kraftlinieneditor.sammel.weitere", { n: formatNumber(weitere, 0) })
                }}</span>
            </span>
        </header>
        <FensterReiter
            v-model="reiter"
            :reiter="reiterListe"
            :beschriftung="t('wegeditor.fenster.reiter')"
            :kennung="`${kennung}-sammel`"
        />
        <p v-if="sammel.ladeFehler.value" class="wegsammel__leise">{{ t("wegeditor.mehrfach.ladefehler") }}</p>
        <p v-else-if="laedt" class="wegsammel__leise">{{ t("wegeditor.mehrfach.laedt") }}</p>

        <section class="wegsammel__kasten">
            <h4 class="wegsammel__titel">{{ t("kraftlinieneditor.abschnitt.identitaet") }}</h4>
            <FensterFeldzeile
                v-for="feld in FELDER"
                :key="feld.id"
                :name="feld.name"
                :fuer="`${kennung}-sammel-${feld.id}`"
                :testid="`${kennung}-sammel-zeile-${feld.id}`"
            >
                <AvmEingabe
                    :id="`${kennung}-sammel-${feld.id}`"
                    :model-value="feld.wert"
                    :placeholder="feld.wert === '' ? gemischt : ''"
                    gesperrt=""
                    :testid="`${kennung}-sammel-feld-${feld.id}`"
                />
                <SammelHinweis art="einzeln" />
            </FensterFeldzeile>
        </section>

        <section class="wegsammel__kasten" :data-testid="`${kennung}-sammel-abschnitte`">
            <h4 class="wegsammel__titel">
                {{ t("wegeditor.fenster.abschnitte", { n: formatNumber(werte?.abschnitte ?? 0, 0) }) }}
            </h4>
            <SammelHinweis art="einzeln" />
        </section>

        <section class="wegsammel__kasten" :data-testid="`${kennung}-sammel-form`">
            <h4 class="wegsammel__titel">{{ t("entwurf.form") }}</h4>
            <div class="wegsammel__knoepfe">
                <AvmKnopf :gesperrt="t('fenster.sammel.nurEinzeln')" :testid="`${kennung}-sammel-wegkurve`">{{
                    t("wegeditor.griff.wegkurve")
                }}</AvmKnopf>
                <!-- Was mit der ganzen Auswahl geht („Auswahl zu neuem Weg“, WI-0252): Knopf und Rückfrage gibt das Fenster hinein. -->
                <slot name="formKnopf" />
            </div>
            <slot name="formFrage" />
        </section>

        <section class="wegsammel__kasten" :data-testid="`${kennung}-sammel-entfernen-kasten`">
            <h4 class="wegsammel__titel">{{ t("kraftlinieneditor.sammel.entfernen.titel") }}</h4>
            <div class="wegsammel__knoepfe">
                <AvmKnopf
                    :gesperrt="
                        darfEntfernen !== true
                            ? t('editorPanel.verb.lesen')
                            : werte === undefined
                              ? t('wegeditor.mehrfach.laedt')
                              : undefined
                    "
                    :testid="`${kennung}-sammel-entfernen`"
                    @click="emit('entfernen')"
                >
                    <template #zeichen><EditorZeichen name="loeschen" /></template>
                    {{ t("wegeditor.griff.entfernen") }}
                </AvmKnopf>
            </div>
        </section>
    </div>
</template>

<style scoped>
.wegsammel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.wegsammel__kopf {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wegsammel__zahl {
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

.wegsammel__streifen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.wegsammel__name {
    padding: 1px var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.wegsammel__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Kasten wie in den Eigenschaften einer Straße (`wegeditor__abschnitt`). */
.wegsammel__kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wegsammel__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wegsammel__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
</style>
