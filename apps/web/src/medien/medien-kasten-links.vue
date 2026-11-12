<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { t } from "../i18n/i18n";
import { dreiwertOptionen } from "./medien-karte-bearbeiten-modell";
import {
    leereLinkZeile,
    linksAnfrage,
    linkZeilenAus,
    linkZeilenNachladen,
    type LinkZeile,
} from "./medien-karte-links-modell";
import MedienKasten from "./medien-kasten.vue";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";

/**
 * Der Kasten „Fundstellen“ einer Karte der Kartensammlung (WI-0287 Stufe 1, Punkt 3, Entwurf Fassung 5: `kastenLinks`, `leseLinks`). Wie jeder Kasten (`medien-kasten.vue`): „⊙ Bearbeiten“ nur mit Recht,
 * ein Speichern (`citymap.links`), ein Fehler an dieser Stelle, Konflikt mit wer und wann.
 *
 * - Lesend stehen die Links (mit „bezahlt“, wo bekannt), darunter, was Teil 4 in einen eigenen Kasten „Publikationen“ nimmt: die Quellen und die Wiki-Zuordnung (Slot `weiteres`).
 * - Bearbeitend je Zeile: Beschriftung, Adresse, „Kostenpflichtig“ (unbekannt, ja, nein) und „✕ Entfernen“; darunter „✚ Link hinzufügen“. Die erste Zeile ist der Karten-Link.
 *   Eine falsche Adresse steht als Satz an ihrer Zeile; leere Beschriftung wird „Karte“.
 * - `oeffnen()` (vom Platz „Die Karte“) öffnet den Kasten und setzt den Fokus in die erste Adresse.
 * - Nach „↺ Neu laden“ folgt, was die Redakteurin nicht angefasst hat, dem neuen Stand (`linkZeilenNachladen`).
 */
const props = defineProps<{
    karte: MamKarteDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
}>();
const emit = defineEmits<{ gespeichert: []; neuLaden: [] }>();

const offen = ref(false);
const zeilen = ref<LinkZeile[]>(linkZeilenAus(props.karte));
/** Der Stand beim Öffnen bzw. beim letzten Neuladen: Woran sich zeigt, was die Redakteurin selbst geändert hat. */
let basis: LinkZeile[] = linkZeilenAus(props.karte);
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const befunde = ref<ReadonlyMap<number, string>>(new Map());
const handlung = new Handlung();
const id = useId();

watch(offen, (jetzt) => {
    if (!jetzt) return;
    basis = linkZeilenAus(props.karte);
    zeilen.value = linkZeilenAus(props.karte);
    fehler.value = undefined;
    befunde.value = new Map();
});

watch(
    () => props.karte,
    (neu) => {
        if (!offen.value) return;
        const neueZeilen = linkZeilenAus(neu);
        zeilen.value = linkZeilenNachladen(basis, zeilen.value, neueZeilen);
        basis = neueZeilen;
    },
);

function fokussiere(index: number): void {
    void nextTick(() => document.getElementById(`${id}-url-${index}`)?.focus());
}

/** Vom Platz „Die Karte“: „✚ Link eintragen“ und „⊙ Links bearbeiten“. */
function oeffnen(): void {
    if (!props.bearbeitbar) return;
    offen.value = true;
    fokussiere(0);
}
defineExpose({ oeffnen });

function neueZeile(): void {
    zeilen.value = [...zeilen.value, leereLinkZeile()];
    fokussiere(zeilen.value.length - 1);
}

function entfernen(index: number): void {
    zeilen.value = zeilen.value.filter((_, i) => i !== index);
    befunde.value = new Map();
}

async function speichern(): Promise<void> {
    const geprueft = linksAnfrage(props.karte, zeilen.value);
    befunde.value = geprueft.befunde;
    if (geprueft.befunde.size > 0) {
        fokussiere([...geprueft.befunde.keys()][0]!);
        return;
    }
    if (geprueft.anfrage === undefined) {
        offen.value = false;
        return;
    }
    const links = geprueft.anfrage;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            props.operationen.karteLinks(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                links,
            }),
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
        :titel="t('medien.karten.abschnitt.fundstellen')"
        :bearbeitbar="bearbeitbar"
        :sendet="sendet"
        :fehler="fehler"
        :speichern-text="t('medien.karten.links.speichern')"
        testid="medien-kasten-links"
        @speichern="speichern"
        @neu-laden="neuLaden"
    >
        <p v-if="karte.links.length === 0" class="links__leer" data-testid="medien-karte-links-leer">
            {{ t("medien.karten.links.keine") }}
        </p>
        <ul v-else class="links__liste" data-testid="medien-karte-fundstellen">
            <li v-for="verweis in karte.links" :key="verweis.url" class="links__zeile-lesen">
                <FensterVerweis :ziel="verweis.url">{{ verweis.label }}</FensterVerweis>
                <span v-if="verweis.isPaid" class="links__klein">{{ t("medien.karten.bezahlt") }}</span>
            </li>
        </ul>
        <slot name="weiteres" />

        <template #bearbeiten>
            <ul class="breit links__liste" data-testid="medien-karte-links-form">
                <li v-for="(zeile, i) in zeilen" :key="i" class="links__zeile" data-testid="medien-karte-links-zeile">
                    <AvmEingabe
                        :id="`${id}-text-${i}`"
                        v-model="zeile.text"
                        :placeholder="t('medien.karten.links.beschriftung')"
                        :aria-label="t('medien.karten.links.beschriftung')"
                        testid="medien-karte-links-text"
                    />
                    <AvmEingabe
                        :id="`${id}-url-${i}`"
                        v-model="zeile.url"
                        :placeholder="t('medien.karten.links.adresse')"
                        :aria-label="t('medien.karten.links.adresse')"
                        :ungueltig="befunde.has(i)"
                        testid="medien-karte-links-url"
                    />
                    <span class="links__unten">
                        <label class="links__klein" :for="`${id}-bezahlt-${i}`">{{
                            t("medien.karten.links.bezahlt")
                        }}</label>
                        <AvmAuswahl
                            :id="`${id}-bezahlt-${i}`"
                            v-model="zeile.bezahlt"
                            :optionen="dreiwertOptionen()"
                            groesse="zeile"
                            testid="medien-karte-links-bezahlt"
                        />
                        <AvmKnopf groesse="zeile" testid="medien-karte-links-weg" @click="entfernen(i)">
                            <template #zeichen>✕</template>
                            {{ t("medien.karten.links.entfernen") }}
                        </AvmKnopf>
                    </span>
                    <span v-if="befunde.get(i)" class="links__befund" data-testid="medien-karte-links-befund">{{
                        befunde.get(i)
                    }}</span>
                </li>
            </ul>
            <div class="breit links__neu">
                <AvmKnopf groesse="zeile" testid="medien-karte-links-neu" @click="neueZeile">
                    <template #zeichen>✚</template>
                    {{ t("medien.karten.links.hinzufuegen") }}
                </AvmKnopf>
            </div>
        </template>
    </MedienKasten>
</template>

<style scoped>
.links__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.links__zeile-lesen {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
}

.links__zeile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.links__unten {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.links__klein,
.links__leer {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.links__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}
</style>
