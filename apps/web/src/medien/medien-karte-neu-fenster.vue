<script setup lang="ts">
import { nextTick, ref, shallowRef, useTemplateRef, watch } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { OrtWahl } from "../community/kartenvorschlaege-modell";
import { t } from "../i18n/i18n";
import MedienKarteAngaben from "./medien-karte-angaben.vue";
import MedienKarteOrte from "./medien-karte-orte.vue";
import type { KartenStand } from "./medien-karte-bearbeiten-modell";
import { leererKartenStand, neuerEintragAnfrage } from "./medien-karte-neu-modell";
import { Handlung, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Das Blatt „Neuer Eintrag“ der Kartensammlung (WI-0287 Stufe 1, Punkt 2, Entwurf Fassung 5 `BLATT_EINTRAG`): nur Name, Orte und Angaben. Karte, Vorschau, Publikation und Links kommen danach rechts im
 * Eintrag dazu. Der Name ist Pflicht; die Angaben sind dieselben Felder wie im Kasten „Angaben“ (`medien-karte-angaben.vue`), die Orte wählt dieselbe Suche wie beim Annehmen eines Vorschlags.
 * 🔴 Was niemand erfasst hat, geht nicht mit: „unbekannt“ bleibt unbekannt, nie „nein“. Danach ist der neue Eintrag gewählt (`fertig`).
 */
const props = defineProps<{ operationen: MedienOperationen }>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [id: string] }>();

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const titel = ref("");
const stand = ref<KartenStand>(leererKartenStand());
const orte = shallowRef<readonly OrtWahl[]>([]);
const versucht = ref(false);
const sendet = ref(false);
const fehler = ref<string | undefined>(undefined);
const handlung = new Handlung();

const befunde = ref<ReadonlyMap<string, string>>(new Map());
const pruefung = (): ReturnType<typeof neuerEintragAnfrage> =>
    neuerEintragAnfrage(titel.value, stand.value, orte.value);
// Nach dem ersten Versuch stehen die Befunde bei jeder Eingabe neu da.
watch(
    [titel, stand, orte],
    () => {
        if (versucht.value) befunde.value = pruefung().befunde;
    },
    { deep: true },
);

watch(
    offen,
    async (jetzt) => {
        if (!jetzt) return;
        titel.value = "";
        stand.value = leererKartenStand();
        orte.value = [];
        versucht.value = false;
        sendet.value = false;
        fehler.value = undefined;
        befunde.value = new Map();
        await nextTick();
        wurzel.value?.querySelector<HTMLInputElement>("input")?.focus();
    },
    { immediate: true },
);

async function senden(): Promise<void> {
    if (sendet.value) return;
    versucht.value = true;
    fehler.value = undefined;
    const geprueft = pruefung();
    befunde.value = geprueft.befunde;
    if (geprueft.anfrage === undefined) {
        await nextTick();
        wurzel.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        return;
    }
    const anfrage = geprueft.anfrage;
    sendet.value = true;
    try {
        const quittung = await handlung.fuehreAus((operationId) =>
            props.operationen.karteAnlegen({ operationId, ...anfrage }),
        );
        const angelegt = quittung.affected.find((eintrag) => eintrag.kind === "citymap");
        offen.value = false;
        if (angelegt !== undefined) emit("fertig", angelegt.id);
    } catch (error) {
        fehler.value = operationsFehler(error).text;
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('medien.karten.eintrag.titel')"
        testid="medien-karte-neu-fenster"
    >
        <div ref="wurzel" class="neu">
            <div class="neu__spalten">
                <section class="neu__links">
                    <div class="neu__zeilen">
                        <label for="medien-eintrag-name">{{ t("medien.karten.eintrag.name") }} *</label>
                        <span class="neu__wert">
                            <AvmEingabe
                                id="medien-eintrag-name"
                                v-model="titel"
                                :ungueltig="befunde.has('titel')"
                                :gesperrt="sendet ? '' : undefined"
                                testid="medien-eintrag-name"
                            />
                            <span v-if="befunde.get('titel')" class="neu__befund" role="alert">{{
                                befunde.get("titel")
                            }}</span>
                        </span>
                    </div>
                    <MedienKarteOrte v-model="orte" :gesperrt="sendet" />
                    <p class="neu__klein">{{ t("medien.karten.eintrag.folge") }}</p>
                </section>
                <section class="neu__rechts">
                    <MedienKarteAngaben v-model:stand="stand" :befunde="befunde" :gesperrt="sendet" />
                </section>
            </div>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-eintrag-fehler">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-eintrag-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                testid="medien-eintrag-anlegen"
                @click="senden"
                >{{ t("medien.karten.eintrag.anlegen") }}</AvmKnopf
            >
        </template>
    </AvmFenster>
</template>

<style scoped>
.neu {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

/* Zwei Blöcke nebeneinander, wo Platz ist (Guide §12.6), sonst untereinander: wie das Hochladefenster. */
.neu__spalten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--divider-gap);
}

.neu__links,
.neu__rechts {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.neu__links {
    flex: 1 1 var(--avm-fenster-spalte);
}

.neu__rechts {
    flex: 1.6 1 var(--avm-fenster-lesespalte);
}

.neu__zeilen {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-8);
}

.neu__zeilen > label {
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.neu__wert {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.neu__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.neu__klein {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}
</style>
