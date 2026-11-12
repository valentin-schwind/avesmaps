<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { KARTE_TEXT_MAX, type KarteTyp, type MamKarteDetail } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import {
    artOptionen,
    dreiwertOptionen,
    farbOptionen,
    kartenAnfrage,
    kartenStandAus,
    kartenStandNachladen,
    typOptionen,
    type KartenStand,
} from "./medien-karte-bearbeiten-modell";
import { kartenZeilen } from "./medien-karten-modell";
import MedienFeldliste from "./medien-feldliste.vue";
import MedienKasten from "./medien-kasten.vue";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";

/**
 * Der Kasten „Angaben“ einer Karte der Kartensammlung (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“): lesend die Zeilen des Katalogs und die
 * internen, bearbeitend alle Eigenschaften aus 0069 und die Typen (`citymap.update`). Wie jeder Kasten eines Werks (`medien-kasten.vue`):
 * „⊙ Bearbeiten“ nur mit `upload_media`, ein Speichern, ein Fehler an dieser Stelle, Konflikt mit wer und wann.
 *
 * - 🔴 Dreiwertig: „unbekannt“ ist eine eigene Wahl, nie „nein“.
 * - Der Satz unter den Feldern sagt die Folge: Danach lässt der Legacy-Zug die Karte stehen und meldet Abweichungen als Befund.
 * - Nach „↺ Neu laden“ folgt, was die Redakteurin nicht angefasst hat, dem neuen Stand (`kartenStandNachladen`); sonst überschriebe
 *   das nächste Speichern still die Änderung der anderen Person.
 */
const props = defineProps<{
    karte: MamKarteDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
}>();
const emit = defineEmits<{ gespeichert: []; neuLaden: [] }>();

const offen = ref(false);
const stand = ref<KartenStand>(kartenStandAus(props.karte));
/** Der Stand beim Öffnen bzw. beim letzten Neuladen: Woran sich zeigt, was die Redakteurin selbst geändert hat. */
let basis: KartenStand = kartenStandAus(props.karte);
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const befunde = ref<ReadonlyMap<keyof KartenStand, string>>(new Map());
const handlung = new Handlung();
const id = useId();

watch(offen, (jetzt) => {
    if (!jetzt) return;
    basis = kartenStandAus(props.karte);
    stand.value = kartenStandAus(props.karte);
    fehler.value = undefined;
    befunde.value = new Map();
});

watch(
    () => props.karte,
    (neu) => {
        if (!offen.value) return;
        const neuerStand = kartenStandAus(neu);
        stand.value = kartenStandNachladen(basis, stand.value, neuerStand);
        basis = neuerStand;
    },
);

const MERKMALE = [
    ["mehrstoeckig", "catalog.citymaps.fact.multilevel"],
    ["beschriftet", "catalog.citymaps.fact.labeled"],
    ["offiziell", "catalog.citymaps.fact.official"],
    ["spoiler", "catalog.citymaps.filter.spoiler"],
    ["massstab", "catalog.citymaps.fact.scale"],
] as const;
const TEXTE = [
    ["format", "catalog.citymaps.fact.format", KARTE_TEXT_MAX.format],
    ["zeichner", "catalog.citymaps.fact.author", KARTE_TEXT_MAX.author],
    ["verlag", "catalog.citymaps.fact.publisher", KARTE_TEXT_MAX.publisher],
] as const;
const ZAHLEN = [
    ["breite", "medien.karten.bearbeiten.breite"],
    ["hoehe", "medien.karten.bearbeiten.hoehe"],
    ["ab", "medien.karten.bearbeiten.ab"],
    ["bis", "medien.karten.bearbeiten.bis"],
] as const;

const typen = computed(() => typOptionen());

function schalteTyp(typ: KarteTyp, an: boolean): void {
    const ohne = stand.value.typen.filter((eintrag) => eintrag !== typ);
    stand.value.typen = an ? [...ohne, typ] : ohne;
}

async function speichern(): Promise<void> {
    const geprueft = kartenAnfrage(props.karte, stand.value);
    befunde.value = geprueft.befunde;
    if (geprueft.befunde.size > 0) return;
    const anfrage = geprueft.anfrage;
    if (anfrage === undefined) {
        offen.value = false;
        return;
    }
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            props.operationen.karteAendern(props.karte.id, { ...anfrage, operationId }),
        );
        offen.value = false;
        emit("gespeichert");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}

function neuLaden(): void {
    fehler.value = undefined;
    emit("neuLaden");
}
</script>

<template>
    <MedienKasten
        v-model:offen="offen"
        :titel="t('medien.karten.abschnitt.angaben')"
        :bearbeitbar="bearbeitbar"
        :sendet="sendet"
        :fehler="fehler"
        :speichern-text="t('medien.karten.bearbeiten.speichern')"
        testid="medien-kasten-karte"
        @speichern="speichern"
        @neu-laden="neuLaden"
    >
        <MedienFeldliste :zeilen="kartenZeilen(karte)" testid="medien-karte-angaben" />
        <template #bearbeiten>
            <label :for="`${id}-titel`">{{ t("medien.karten.bearbeiten.titel") }}</label>
            <span class="medien-kasten__wert">
                <AvmEingabe
                    :id="`${id}-titel`"
                    v-model="stand.titel"
                    :maxlength="KARTE_TEXT_MAX.title"
                    :ungueltig="befunde.has('titel')"
                    testid="medien-karte-bearbeiten-titel"
                />
                <span v-if="befunde.get('titel')" class="medien-kasten__befund">{{ befunde.get("titel") }}</span>
            </span>

            <label :for="`${id}-art`">{{ t("catalog.citymaps.fact.art") }}</label>
            <AvmAuswahl
                :id="`${id}-art`"
                v-model="stand.art"
                :optionen="artOptionen()"
                testid="medien-karte-bearbeiten-art"
            />
            <label :for="`${id}-farbe`">{{ t("catalog.citymaps.fact.colour") }}</label>
            <AvmAuswahl
                :id="`${id}-farbe`"
                v-model="stand.farbe"
                :optionen="farbOptionen()"
                testid="medien-karte-bearbeiten-farbe"
            />

            <span class="medien-kasten__beschriftung oben">{{ t("catalog.citymaps.fact.types") }}</span>
            <span class="medien-kasten-karte__typen" data-testid="medien-karte-bearbeiten-typen">
                <AvmKaestchen
                    v-for="typ in typen"
                    :key="typ.wert"
                    art="checkbox"
                    :checked="stand.typen.includes(typ.wert)"
                    :testid="`medien-karte-bearbeiten-typ-${typ.wert}`"
                    @change="schalteTyp(typ.wert, $event)"
                    >{{ typ.text }}</AvmKaestchen
                >
            </span>

            <template v-for="[feld, wort] in MERKMALE" :key="feld">
                <label :for="`${id}-${feld}`">{{ t(wort) }}</label>
                <AvmAuswahl
                    :id="`${id}-${feld}`"
                    v-model="stand[feld]"
                    :optionen="dreiwertOptionen()"
                    :testid="`medien-karte-bearbeiten-${feld}`"
                />
            </template>

            <template v-for="[feld, wort] in ZAHLEN" :key="feld">
                <label :for="`${id}-${feld}`">{{ t(wort) }}</label>
                <span class="medien-kasten__wert">
                    <AvmEingabe
                        :id="`${id}-${feld}`"
                        v-model="stand[feld]"
                        inputmode="numeric"
                        :ungueltig="befunde.has(feld)"
                        :testid="`medien-karte-bearbeiten-${feld}`"
                    />
                    <span v-if="befunde.get(feld)" class="medien-kasten__befund">{{ befunde.get(feld) }}</span>
                    <span v-if="feld === 'bis'" class="medien-kasten__klein">{{
                        t("medien.karten.bearbeiten.bisHinweis")
                    }}</span>
                </span>
            </template>

            <template v-for="[feld, wort, max] in TEXTE" :key="feld">
                <label :for="`${id}-${feld}`">{{ t(wort) }}</label>
                <span class="medien-kasten__wert">
                    <AvmEingabe
                        :id="`${id}-${feld}`"
                        v-model="stand[feld]"
                        :maxlength="max"
                        :ungueltig="befunde.has(feld)"
                        :testid="`medien-karte-bearbeiten-${feld}`"
                    />
                    <span v-if="befunde.get(feld)" class="medien-kasten__befund">{{ befunde.get(feld) }}</span>
                </span>
            </template>

            <label :for="`${id}-notiz`" class="oben">{{ t("catalog.citymaps.fact.note") }}</label>
            <span class="medien-kasten__wert">
                <AvmTextbereich
                    :id="`${id}-notiz`"
                    v-model="stand.notiz"
                    :zeilen="3"
                    :maxlength="KARTE_TEXT_MAX.note"
                    :ungueltig="befunde.has('notiz')"
                    testid="medien-karte-bearbeiten-notiz"
                />
                <span v-if="befunde.get('notiz')" class="medien-kasten__befund">{{ befunde.get("notiz") }}</span>
            </span>

            <p class="breit medien-kasten-karte__folge" data-testid="medien-karte-bearbeiten-folge">
                {{ t("medien.karten.bearbeiten.folge") }}
            </p>
        </template>
    </MedienKasten>
</template>

<style scoped>
.medien-kasten-karte__typen {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: var(--space-2) var(--space-6);
    min-width: 0;
}

.medien-kasten-karte__folge {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
