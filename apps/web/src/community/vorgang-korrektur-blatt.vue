<script setup lang="ts">
import { computed, onMounted, shallowRef, useId, useTemplateRef } from "vue";
import type { KorrekturKandidaten } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { REDAKTION_FEHLER_SATZ, ladeKorrekturKandidaten, redaktionFehler } from "./redaktion-api";
import {
    kandidatenKopf,
    kandidatenLeer,
    korrekturFehlerSatz,
    korrekturSperre,
    korrekturZeile,
} from "./verknuepfen-modell";

/**
 * Das kleine Blatt „Korrektur verknüpfen“ im Vorgangsfenster (WI-0268 C7; Fachkonzept WI-0263 §6): Eine Änderung an der Karte, die nicht aus dem Vorgang heraus entstand (⚙ trägt die Herkunft selbst mit),
 * gehört von Hand zu ihm. Das Blatt zeigt die letzten 15 Änderungen am Bezugsobjekt (ohne Objekt: die eigenen) zur Wahl; die Wahl führt das Fenster aus (`verknuepfe`).
 *
 * - **Es lädt beim Öffnen** (`korrektur-kandidaten`): Was schon verknüpft ist, fehlt. Ohne Kandidaten steht ein Satz, kein leeres Blatt; ein Fehler beim Laden steht als Satz mit „Erneut laden“.
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19): „Verknüpfen“ nennt, was noch fehlt. Esc bricht das Blatt ab, nicht das ganze Fenster.
 * - Verknüpfen ändert weder Zustand noch Revision des Vorgangs; abgeschlossen wird er trotzdem eigens.
 */
const props = defineProps<{
    nummer: string;
    /** Eine Handlung läuft: alles gesperrt. */
    sendet: boolean;
    /** Ein Fehler des letzten Versuchs (der Satz der Oberfläche). */
    fehler?: MessageKey | undefined;
    /** Der genaue Grund des Servers in den Sätzen der Redaktion (WI-0291); er geht dem allgemeinen Satz vor. */
    fehlerGrund?: string | undefined;
}>();
const emit = defineEmits<{ verknuepfe: [ziel: string]; abbrechen: [] }>();

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly kandidaten: KorrekturKandidaten };

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const gruppe = useId();
const grundId = useId();
const stand = shallowRef<Stand>({ art: "laedt" });
const gewaehlt = shallowRef<string | undefined>(undefined);
let lauf = 0;

async function lade(): Promise<void> {
    const mein = ++lauf;
    stand.value = { art: "laedt" };
    try {
        const kandidaten = await ladeKorrekturKandidaten(props.nummer);
        if (mein !== lauf) return;
        stand.value = { art: "da", kandidaten };
        gewaehlt.value = undefined;
    } catch (fehler) {
        if (mein !== lauf) return;
        stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[redaktionFehler(fehler)] };
    }
}

const zeilen = computed(() =>
    stand.value.art === "da" ? stand.value.kandidaten.kandidaten.map((kandidat) => korrekturZeile(kandidat)) : [],
);
const sperre = computed((): MessageKey | undefined => korrekturSperre(gewaehlt.value));
const sperrText = computed(() => {
    if (props.sendet) return "";
    return sperre.value === undefined ? undefined : t(sperre.value);
});
const titel = computed(() => t("community.verknuepfen.korrektur.titel", { nummer: props.nummer }));
const fehlerSatz = computed(() =>
    props.fehler === undefined ? undefined : (props.fehlerGrund ?? t(korrekturFehlerSatz(props.fehler))),
);

function verknuepfe(): void {
    if (sperre.value !== undefined || props.sendet || gewaehlt.value === undefined) return;
    emit("verknuepfe", gewaehlt.value);
}

/** Beim Erscheinen ins Bild holen: Das Blatt steht oben im Rumpf, der Rumpf kann gerollt sein. */
onMounted(() => {
    wurzel.value?.scrollIntoView({ block: "nearest" });
    void lade();
});

function esc(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc bricht das Blatt ab, nicht das ganze Fenster.
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <section ref="wurzel" class="blatt" :aria-label="titel" data-testid="community-blatt-korrektur" @keydown="esc">
        <h3 class="blatt__titel avm-versalmitte">{{ titel }}</h3>

        <p
            v-if="stand.art === 'laedt'"
            class="blatt__leise"
            role="status"
            data-testid="community-blatt-korrektur-laedt"
        >
            {{ t("community.redaktion.laedt") }}
        </p>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-blatt-korrektur-ladefehler">{{
                t(stand.key)
            }}</AvmHinweis>
            <div class="blatt__knoepfe">
                <AvmKnopf testid="community-blatt-korrektur-erneut" @click="lade">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </div>
        </template>
        <template v-else>
            <p class="blatt__leise">{{ t("community.verknuepfen.korrektur.erklaerung") }}</p>
            <p v-if="zeilen.length === 0" class="blatt__leise" data-testid="community-blatt-korrektur-leer">
                {{ t(kandidatenLeer(stand.kandidaten.quelle)) }}
            </p>
            <fieldset v-else class="blatt__feld" data-testid="community-blatt-korrektur-liste">
                <legend class="blatt__label">{{ t(kandidatenKopf(stand.kandidaten.quelle)) }}</legend>
                <AvmKaestchen
                    v-for="zeile in zeilen"
                    :key="zeile.operationId"
                    art="radio"
                    mehrzeilig
                    :name="gruppe"
                    :checked="gewaehlt === zeile.operationId"
                    :gesperrt="props.sendet ? '' : undefined"
                    :testid="`community-blatt-korrektur-${zeile.operationId}`"
                    @change="gewaehlt = zeile.operationId"
                >
                    <span class="kandidat">
                        <span class="kandidat__titel">{{ zeile.titel }}</span>
                        <span v-if="zeile.satz !== undefined" class="blatt__leise">{{ zeile.satz }}</span>
                        <span class="blatt__leise">{{ zeile.wann }}</span>
                    </span>
                </AvmKaestchen>
            </fieldset>
        </template>

        <AvmHinweis v-if="fehlerSatz !== undefined" ton="gefahr" rolle="alert" testid="community-blatt-fehler">{{
            fehlerSatz
        }}</AvmHinweis>

        <div class="blatt__knoepfe">
            <AvmKnopf
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-abbrechen"
                @click="emit('abbrechen')"
                >{{ t("ui.confirm.cancel") }}</AvmKnopf
            >
            <AvmKnopf
                v-if="stand.art === 'da' && zeilen.length > 0"
                art="gefuellt"
                :gesperrt="sperrText"
                :grund-bei="grundId"
                testid="community-blatt-los"
                @click="verknuepfe"
                >{{ t("community.verknuepfen.korrektur.verknuepfen") }}</AvmKnopf
            >
        </div>
        <!-- Der Grund, warum „Verknüpfen“ noch nicht geht, steht sichtbar neben den Knöpfen (Guide §7, §13.19). -->
        <p
            v-if="sperrText !== undefined && sperrText !== '' && zeilen.length > 0"
            :id="grundId"
            class="blatt__sperre"
            role="note"
        >
            {{ sperrText }}
        </p>
    </section>
</template>

<style scoped>
/* Dieselbe Bauart wie das Blatt „Abschließen“ (`vorgang-blatt.vue`): ein Kasten mit goldbrauner Kante am Anfang des Rumpfs. */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-accent-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.blatt__label {
    padding: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.blatt__leise,
.blatt__sperre {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.kandidat {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
}

.kandidat__titel {
    color: var(--color-text-strong);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
