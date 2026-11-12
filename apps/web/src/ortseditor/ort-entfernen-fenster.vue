<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { PLACE_REMOVAL_WAYS, STAETTEN_WAYS, type PlaceRemoval, type PlaceRemovalWay } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen, { type EditorZeichenName } from "../controls/editor-zeichen.vue";
import { showToast } from "../feedback/toast";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterAbschnitt from "../fenster/fenster-abschnitt.vue";
import { t } from "../i18n/i18n";
import {
    entferne,
    entfernenBitte,
    entfernenStand,
    fliegeNebenDasBlatt,
    melde,
    type EntfernenApi,
    type EntfernenWahl,
} from "./ort-entfernen";

/**
 * Das Blatt „Ort entfernen“ (WI-0128 E22; Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau das wollte ich“, Blatt
 * `review/wi-0128/ort-entfernen-blatt.png`): modal mittig über der Karte, weil der Knopf an vier Stellen sitzt und die Entscheidung mehr
 * trifft als den einen Ort. Drei Abschnitte mit Linie und Überschrift (Guide §13.43): Der Ort (eine Wahl, Pflicht, je mit ihrem Zeichen),
 * Innerorts (nur mit Stätten), Folgen (nur angezeigt). Der Gefahrknopf nennt die Handlung. Was gilt, rechnet `ort-entfernen.ts`.
 *
 * Es hängt im Editorpanel und hört auf `entfernenBitte`; nach dem Entfernen meldet es `entfernenMeldung` und schließt sich.
 */
const props = defineProps<{
    api: EntfernenApi;
    rechte: readonly string[];
}>();

/** Je Wahl ihr Zeichen (Blatt): Nadel mit Minus, Pfeile, Eimer. */
const ZEICHEN: Record<PlaceRemovalWay, EditorZeichenName> = {
    abnehmen: "abnehmen",
    staette: "verlagern",
    loeschen: "loeschen",
};
/** So viele Stätten stehen mit Namen da, bevor „und n weitere“ den Rest zusammenfasst. */
const NAMEN = 4;

const offen = ref(false);
const vorschau = shallowRef<PlaceRemoval | undefined>(undefined);
const laedt = ref(false);
const ladefehler = ref(false);
const laeuft = ref(false);
const satz = ref<string | undefined>(undefined);
const alleNamen = ref(false);
const wahl = ref<EntfernenWahl>({ ort: undefined, staetten: "bleiben" });
let abbruch: AbortController | undefined;

const stand = computed(() =>
    vorschau.value === undefined ? undefined : entfernenStand(vorschau.value, wahl.value, props.rechte),
);
const namen = computed(() => {
    const alle = stand.value?.staetten?.namen ?? [];
    if (alleNamen.value || alle.length <= NAMEN + 1) return { zeigen: alle, rest: 0 };
    return { zeigen: alle.slice(0, NAMEN), rest: alle.length - NAMEN };
});

async function lade(publicId: string): Promise<void> {
    abbruch?.abort();
    const eigene = new AbortController();
    abbruch = eigene;
    vorschau.value = undefined;
    ladefehler.value = false;
    laedt.value = true;
    try {
        const antwort = await props.api.entfernenVorschau(publicId, eigene.signal);
        if (eigene.signal.aborted) return;
        if (antwort === null) ladefehler.value = true;
        else {
            vorschau.value = antwort;
            fliegeNebenDasBlatt(antwort);
        }
    } catch {
        if (!eigene.signal.aborted) ladefehler.value = true;
    } finally {
        if (abbruch === eigene) laedt.value = false;
    }
}

watch(entfernenBitte, (bitte) => {
    if (bitte === undefined) return;
    const publicId = bitte.publicId;
    wahl.value = { ort: undefined, staetten: "bleiben" };
    satz.value = undefined;
    alleNamen.value = false;
    offen.value = true;
    void lade(publicId);
});
watch(offen, (jetzt) => {
    if (!jetzt) abbruch?.abort();
});
onBeforeUnmount(() => abbruch?.abort());

const knopfGrund = computed(() => {
    if (laeuft.value) return t("ortseditor.entfernen.laeuft");
    if (stand.value === undefined)
        return t(ladefehler.value ? "ortseditor.entfernen.ladefehler" : "ortseditor.entfernen.laedt");
    return stand.value.grund;
});

async function los(): Promise<void> {
    const ort = vorschau.value;
    if (ort === undefined || laeuft.value || knopfGrund.value !== undefined) return;
    laeuft.value = true;
    satz.value = undefined;
    try {
        const ergebnis = await entferne(props.api, ort, wahl.value);
        if (!ergebnis.ok) {
            satz.value = ergebnis.satz;
            return;
        }
        showToast(t(`ortseditor.entfernen.fertig.${ergebnis.weg}`, { name: ort.name }), "success");
        melde(ort.publicId, ergebnis.weg === "loeschen" ? "geloescht" : "abgenommen", ergebnis.quittung.mapRevision);
        offen.value = false;
    } finally {
        laeuft.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="entscheiden"
        :titel="t('ortseditor.entfernen')"
        :zusatz="vorschau?.name"
        testid="ort-entfernen"
    >
        <p v-if="laedt" class="entfernen__leise" role="status">{{ t("ortseditor.entfernen.laedt") }}</p>
        <AvmHinweis v-else-if="ladefehler" ton="gefahr" rolle="alert" testid="ort-entfernen-ladefehler">
            {{ t("ortseditor.entfernen.ladefehler") }}
        </AvmHinweis>
        <template v-else-if="stand">
            <AvmHinweis v-if="stand.sperre" ton="gefahr" rolle="alert" testid="ort-entfernen-sperre">
                {{ stand.sperre }}
            </AvmHinweis>

            <section class="entfernen__abschnitt" data-testid="ort-entfernen-ort">
                <h3 class="entfernen__aufschrift">{{ t("ortseditor.entfernen.ort") }}</h3>
                <div class="entfernen__wahlen" role="radiogroup" :aria-label="t('ortseditor.entfernen.ort')">
                    <AvmKaestchen
                        v-for="weg in PLACE_REMOVAL_WAYS"
                        :key="weg"
                        art="radio"
                        name="ort-entfernen-ort"
                        mehrzeilig
                        class="entfernen__wahl"
                        :class="{ 'entfernen__wahl--gefahr': weg === 'loeschen' }"
                        :checked="wahl.ort === weg"
                        :gesperrt="stand.orte[weg].grund"
                        :testid="`ort-entfernen-${weg}`"
                        @change="wahl = { ...wahl, ort: weg }"
                    >
                        <span class="entfernen__zeichen" aria-hidden="true"
                            ><EditorZeichen :name="ZEICHEN[weg]"
                        /></span>
                        <span class="entfernen__text">
                            <span class="entfernen__titel">{{ stand.orte[weg].titel }}</span>
                            <span class="entfernen__satz">{{ stand.orte[weg].hinweis ?? stand.orte[weg].satz }}</span>
                        </span>
                    </AvmKaestchen>
                </div>
            </section>

            <FensterAbschnitt v-if="stand.staetten" data-testid="ort-entfernen-innerorts">
                <div class="entfernen__abschnitt">
                    <!-- „Einzeln wählen“ (Blatt, Fall d) kommt mit E18: Bis dahin gibt es je Stätte nur „bleiben“. -->
                    <h3 class="entfernen__aufschrift">
                        {{ t("ortseditor.entfernen.innerorts", { n: stand.staetten.namen.length }) }}
                    </h3>
                    <p class="entfernen__namen" data-testid="ort-entfernen-namen">
                        {{ namen.zeigen.join(", ")
                        }}<template v-if="namen.rest > 0">
                            <button type="button" class="entfernen__weitere" @click="alleNamen = true">
                                {{ t("ortseditor.entfernen.weitere", { n: namen.rest }) }}
                            </button></template
                        >
                    </p>
                    <div class="entfernen__wahlen" role="radiogroup">
                        <AvmKaestchen
                            v-for="weg in STAETTEN_WAYS"
                            :key="weg"
                            art="radio"
                            name="ort-entfernen-staetten"
                            mehrzeilig
                            class="entfernen__wahl"
                            :checked="wahl.staetten === weg"
                            :gesperrt="stand.staetten.optionen[weg].grund"
                            :testid="`ort-entfernen-staetten-${weg}`"
                            @change="wahl = { ...wahl, staetten: weg }"
                        >
                            <span class="entfernen__text">
                                <span class="entfernen__titel">{{ stand.staetten.optionen[weg].titel }}</span>
                                <span class="entfernen__satz">{{
                                    stand.staetten.optionen[weg].hinweis ?? stand.staetten.optionen[weg].satz
                                }}</span>
                            </span>
                        </AvmKaestchen>
                    </div>
                </div>
            </FensterAbschnitt>

            <FensterAbschnitt v-if="stand.folgen.length > 0" data-testid="ort-entfernen-folgen">
                <div class="entfernen__abschnitt">
                    <h3 class="entfernen__aufschrift">{{ t("ortseditor.entfernen.folgen") }}</h3>
                    <dl class="entfernen__folgen">
                        <template v-for="(folge, i) in stand.folgen" :key="i">
                            <dt :class="{ 'entfernen__folge--gefahr': folge.gefahr }">{{ folge.titel }}</dt>
                            <dd>
                                {{ folge.text }}
                                <span v-if="folge.leise" class="entfernen__leise">{{ folge.leise }}</span>
                            </dd>
                        </template>
                    </dl>
                </div>
            </FensterAbschnitt>

            <AvmHinweis v-if="satz" ton="gefahr" rolle="alert" testid="ort-entfernen-satz">{{ satz }}</AvmHinweis>
        </template>

        <template #fuss-hinweis>{{ knopfGrund === undefined ? stand?.zurueck : undefined }}</template>
        <template #fuss-haupt>
            <AvmKnopf testid="ort-entfernen-abbrechen" @click="offen = false">
                {{ t("ortseditor.entfernen.abbrechen") }}
            </AvmKnopf>
            <AvmKnopf art="gefahr" :gesperrt="knopfGrund" testid="ort-entfernen-los" @click="los">
                {{ stand?.handlung ?? t("ortseditor.entfernen") }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.entfernen__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

/* Wie die Abschnittsköpfe des Ortseditors (`felder__titel`). */
.entfernen__aufschrift {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.entfernen__wahlen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.entfernen__zeichen {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-top: calc((1lh - var(--icon-sm)) / 2);
    color: var(--color-text-muted);
}

.entfernen__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.entfernen__titel {
    color: var(--color-text-strong);
}

.entfernen__satz,
.entfernen__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.entfernen__wahl--gefahr:not(.kaestchen--gesperrt) .entfernen__titel,
.entfernen__wahl--gefahr:not(.kaestchen--gesperrt) .entfernen__zeichen {
    color: var(--color-danger);
}

.kaestchen--gesperrt .entfernen__titel {
    color: var(--color-text-muted);
}

.entfernen__namen {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.entfernen__weitere {
    margin-left: 0.25em;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    text-underline-offset: 0.15em;
    cursor: pointer;
}

/* Die Feldliste des Ortseditors (`felder__liste`). */
.entfernen__folgen {
    display: grid;
    grid-template-columns: minmax(7em, auto) minmax(0, 1fr);
    gap: var(--space-4) var(--space-10);
    margin: 0;
}

.entfernen__folgen dt {
    color: var(--color-text-muted);
}

.entfernen__folgen dd {
    margin: 0;
    color: var(--color-text);
}

.entfernen__folge--gefahr {
    color: var(--color-danger);
}
</style>
