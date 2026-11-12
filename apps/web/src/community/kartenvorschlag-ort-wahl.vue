<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { BEZUG_RUHE_MS } from "../photobox/bezug-suche";
import { fetchSearch, hitTypeLabel } from "../search/search-client";
import { trefferAusSuche } from "../medien/medien-karte-orte-modell";
import { orteAusTreffern, type OrtWahl } from "./kartenvorschlaege-modell";

/**
 * Der Ort im Blatt „Annehmen“ (WI-0275): Annehmen übernahm nur den Ort des Vorschlags, ein Vorschlag ohne Ort ergab eine Karte in keiner Infobox. Hier wählt die Redaktion ihn über die Suche der Karte, oder nimmt einen falschen weg. Gewählt steht er als
 * Name mit ✕ da, sonst das Suchfeld mit den Treffern (ab zwei Zeichen, nach 250 ms Ruhe, höchstens fünf Orte).
 *
 * 🔴 `regionen` (WI-0287 Stufe 3, nur „Neuer Eintrag“ der Kartensammlung): dieselbe Suche bringt auch derographische Regionen, mit Art und Gruppe als zweiter Zeile (`trefferAusSuche`). Das Annehmen eines
 * Vorschlags bleibt bei Orten (der Ort hängt am Vorschlag selbst, `citymap_suggestion.place_id`).
 */
const wahl = defineModel<OrtWahl | null>({ required: true });
const props = defineProps<{ gesperrt?: boolean | undefined; regionen?: boolean | undefined }>();

const MIN_ZEICHEN = 2;
const suche = ref("");
const treffer = shallowRef<OrtWahl[]>([]);
const fehlt = ref(false);
const nichts = ref(false);
let uhr: ReturnType<typeof setTimeout> | undefined;
let lauf: AbortController | undefined;

function halteAn(): void {
    if (uhr !== undefined) clearTimeout(uhr);
    lauf?.abort();
}
onBeforeUnmount(halteAn);

function aendern(wert: string): void {
    suche.value = wert;
    halteAn();
    fehlt.value = false;
    nichts.value = false;
    if (wert.trim().length < MIN_ZEICHEN) {
        treffer.value = [];
        return;
    }
    uhr = setTimeout(() => {
        lauf = new AbortController();
        const signal = lauf.signal;
        fetchSearch(wert.trim(), signal)
            .then((antwort) => {
                if (signal.aborted) return;
                treffer.value =
                    props.regionen === true
                        ? trefferAusSuche(antwort.hits, new Set()).map((ziel) => ({
                              id: ziel.id,
                              name: ziel.name,
                              typ: ziel.zeile2,
                              kind: ziel.kind,
                          }))
                        : orteAusTreffern(antwort.hits, hitTypeLabel);
                nichts.value = treffer.value.length === 0;
            })
            .catch(() => {
                if (!signal.aborted) fehlt.value = true;
            });
    }, BEZUG_RUHE_MS);
}

function waehle(ort: OrtWahl): void {
    halteAn();
    wahl.value = ort;
    suche.value = "";
    treffer.value = [];
}
</script>

<template>
    <div class="ortwahl" data-testid="community-karte-ortwahl">
        <div v-if="wahl !== null" class="ortwahl__gewaehlt">
            <span class="ortwahl__name" data-testid="community-karte-ortwahl-name">{{ wahl.name }}</span>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="props.gesperrt ? '' : undefined"
                :title="t('kartenvorschlag.redaktion.ort.weg')"
                :aria-label="t('kartenvorschlag.redaktion.ort.weg')"
                testid="community-karte-ortwahl-weg"
                @click="wahl = null"
                >✕</AvmKnopf
            >
        </div>
        <template v-else>
            <AvmEingabe
                :model-value="suche"
                art="suche"
                :gesperrt="props.gesperrt ? '' : undefined"
                :placeholder="
                    props.regionen
                        ? t('medien.karten.eintrag.ortPlatzhalter')
                        : t('kartenvorschlag.redaktion.ort.platzhalter')
                "
                :aria-label="
                    props.regionen ? t('medien.karten.eintrag.orte') : t('kartenvorschlag.redaktion.blatt.ort')
                "
                testid="community-karte-ortwahl-suche"
                @update:model-value="aendern"
            />
            <ul v-if="treffer.length > 0" class="ortwahl__treffer" data-testid="community-karte-ortwahl-treffer">
                <li v-for="ort in treffer" :key="ort.id">
                    <button type="button" @click="waehle(ort)">
                        <span>{{ ort.name }}</span>
                        <span class="ortwahl__klein">{{ ort.typ }}</span>
                    </button>
                </li>
            </ul>
            <p v-else-if="nichts" class="ortwahl__klein" role="status">
                {{
                    props.regionen
                        ? t("medien.karten.orteRegionen.keinTreffer")
                        : t("kartenvorschlag.redaktion.ort.nichts")
                }}
            </p>
            <p v-else-if="fehlt" class="ortwahl__klein" role="alert">{{ t("kartenvorschlag.redaktion.ort.fehlt") }}</p>
        </template>
    </div>
</template>

<style scoped>
.ortwahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.ortwahl__gewaehlt {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.ortwahl__name {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ortwahl__klein {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.ortwahl__treffer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.ortwahl__treffer button {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.ortwahl__treffer button:hover {
    background: var(--color-hover-wash);
}

.ortwahl__treffer button:active {
    background: var(--color-active-wash);
}

.ortwahl__treffer button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
