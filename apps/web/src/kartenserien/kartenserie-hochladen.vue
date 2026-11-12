<script setup lang="ts">
/**
 * „Neue Kartenserie“ und „… ersetzen“ (WI-0220 Schnitt 3; Vorlage Fassung 4, Dialog „Neue Kartenserie“): Name, Kennung (aus dem Namen,
 * nur Kleinbuchstaben), Beschreibung, Beschriftung im Bild, Nur für Editoren, dann die Datei. Der Browser liest nur ihren Kopf und sagt
 * sofort, ob sie passt (Quadrat, 8k bis 64k). Lizenz und Herkunft trägt danach „Lizenz und Herkunft bearbeiten“ ein.
 */
import { computed, ref, watch } from "vue";
import { istKartenserieKennung, type KartenserieUploadZiel } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { kennungAus, pruefeDatei, type DateiPruefung } from "./hochladen";

const props = defineProps<{
    /** Neue Serie oder eine vorhandene ersetzen. */
    ziel: { art: "neu" } | { art: "ersetzen" | "quelle"; id: string; label: string };
    /** Kennungen, die es schon gibt (Serien, Papierkorb, in Arbeit). */
    vorhanden: readonly string[];
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{ los: [datei: File, ziel: KartenserieUploadZiel, kante: number]; abbrechen: [] }>();

const neu = computed(() => props.ziel.art === "neu");
const name = ref("");
const kennung = ref("");
const kennungVonHand = ref(false);
const beschreibung = ref("");
const imBild = ref(false);
const nurEditoren = ref(true);
const datei = ref<File | null>(null);
const pruefung = ref<DateiPruefung | null>(null);

watch(name, (wert) => {
    if (!kennungVonHand.value) kennung.value = kennungAus(wert);
});
function kennungGetippt(wert: string): void {
    kennungVonHand.value = true;
    kennung.value = wert
        .toLowerCase()
        .replace(/[^a-z]/gu, "")
        .slice(0, 24);
}
watch(imBild, (an) => {
    if (an) nurEditoren.value = true;
});

async function gewaehlt(event: Event): Promise<void> {
    const f = (event.target as HTMLInputElement).files?.[0] ?? null;
    datei.value = f;
    pruefung.value = f === null ? null : await pruefeDatei(f);
}

const kennungProblem = computed<string | undefined>(() => {
    if (!neu.value) return undefined;
    if (!istKartenserieKennung(kennung.value)) return t("admin.kartenserien.hochladen.kennungLeer");
    if (props.vorhanden.includes(kennung.value))
        return t("admin.kartenserien.hochladen.kennungVergeben", { id: kennung.value });
    return undefined;
});
const grund = computed<string | undefined>(() => {
    if (props.gesperrt !== undefined) return props.gesperrt;
    if (neu.value && name.value.trim() === "") return t("admin.kartenserien.hochladen.nameLeer");
    if (kennungProblem.value !== undefined) return kennungProblem.value;
    if (pruefung.value?.ok !== true) return t("admin.kartenserien.hochladen.dateiFehlt");
    return undefined;
});

function los(): void {
    const f = datei.value;
    const kante = pruefung.value?.kante;
    if (grund.value !== undefined || f === null || kante === null || kante === undefined) return;
    const ziel: KartenserieUploadZiel =
        props.ziel.art === "neu"
            ? {
                  art: "neu",
                  id: kennung.value,
                  anlage: {
                      label: name.value.trim(),
                      ...(beschreibung.value.trim() === "" ? {} : { description: beschreibung.value.trim() }),
                      labelsInImage: imBild.value,
                      nurEditoren: nurEditoren.value || imBild.value,
                  },
              }
            : { art: props.ziel.art, id: props.ziel.id };
    emit("los", f, ziel, kante);
}
</script>

<template>
    <FensterKarte
        :titel="
            ziel.art === 'neu'
                ? t('admin.kartenserien.hochladen.titelNeu')
                : ziel.art === 'quelle'
                  ? t('admin.kartenserien.hochladen.titelQuelle', { name: ziel.label })
                  : t('admin.kartenserien.hochladen.titelErsetzen', { name: ziel.label })
        "
        data-testid="kartenserien-hochladen"
    >
        <p class="hochladen__leise">
            {{
                ziel.art === "neu"
                    ? t("admin.kartenserien.hochladen.satzNeu")
                    : ziel.art === "quelle"
                      ? t("admin.kartenserien.hochladen.satzQuelle")
                      : t("admin.kartenserien.hochladen.satzErsetzen")
            }}
        </p>
        <div v-if="ziel.art === 'neu'" class="hochladen__felder">
            <label class="hochladen__feld">
                <span class="hochladen__leise">{{ t("admin.kartenserien.feld.name") }}</span>
                <AvmEingabe v-model="name" maxlength="60" testid="kartenserien-hochladen-name" />
            </label>
            <label class="hochladen__feld">
                <span class="hochladen__leise">{{ t("admin.kartenserien.hochladen.kennung") }}</span>
                <AvmEingabe
                    :model-value="kennung"
                    maxlength="24"
                    :ungueltig="kennungProblem !== undefined && kennung !== ''"
                    testid="kartenserien-hochladen-kennung"
                    @update:model-value="kennungGetippt"
                />
            </label>
            <label class="hochladen__feld">
                <span class="hochladen__leise">{{ t("admin.kartenserien.feld.beschreibung") }}</span>
                <AvmTextbereich
                    v-model="beschreibung"
                    :zeilen="2"
                    maxlength="300"
                    testid="kartenserien-hochladen-beschreibung"
                />
            </label>
            <AvmKaestchen
                art="checkbox"
                :checked="imBild"
                mehrzeilig
                testid="kartenserien-hochladen-imbild"
                @change="imBild = $event"
                >{{ t("admin.kartenserien.hochladen.imBild") }}</AvmKaestchen
            >
            <AvmKaestchen
                art="checkbox"
                :checked="nurEditoren || imBild"
                :gesperrt="imBild ? t('admin.kartenserien.hochladen.imBildNurEditoren') : undefined"
                testid="kartenserien-hochladen-editoren"
                @change="nurEditoren = $event"
                >{{ t("admin.kartenserien.sicht.editoren") }}</AvmKaestchen
            >
        </div>
        <div class="hochladen__datei">
            <label class="hochladen__waehlen">
                <input
                    class="hochladen__eingabe"
                    type="file"
                    accept="image/png"
                    data-testid="kartenserien-hochladen-datei"
                    @change="gewaehlt"
                />
                <span aria-hidden="true">✚</span>{{ t("admin.kartenserien.hochladen.waehlen") }}
            </label>
            <AvmHinweis
                v-if="pruefung !== null"
                :ton="pruefung.ok ? undefined : 'warnung'"
                data-testid="kartenserien-hochladen-pruefung"
                >{{ pruefung.satz }}</AvmHinweis
            >
            <span v-else class="hochladen__leise">{{ t("admin.kartenserien.hochladen.keineDatei") }}</span>
        </div>
        <div class="hochladen__knoepfe">
            <AvmKnopf testid="kartenserien-hochladen-abbrechen" @click="emit('abbrechen')">{{
                t("admin.kartenserien.lizenz.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="grund" testid="kartenserien-hochladen-los" @click="los">{{
                ziel.art === "quelle"
                    ? t("admin.kartenserien.hochladen.losQuelle")
                    : t("admin.kartenserien.hochladen.los")
            }}</AvmKnopf>
        </div>
        <span class="hochladen__leise">{{
            ziel.art === "neu"
                ? t("admin.kartenserien.hochladen.fussNeu")
                : ziel.art === "quelle"
                  ? t("admin.kartenserien.hochladen.fussQuelle")
                  : t("admin.kartenserien.hochladen.fussErsetzen")
        }}</span>
    </FensterKarte>
</template>

<style scoped>
.hochladen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.hochladen__felder {
    display: grid;
    gap: var(--space-6);
}

.hochladen__feld {
    display: grid;
    gap: var(--space-2);
}

.hochladen__datei {
    display: grid;
    gap: var(--space-6);
    margin-top: var(--space-8);
}

/* Der Knopf trägt das Feld: die echte Eingabe liegt unsichtbar darüber (Tastatur und Screenreader erreichen sie). */
.hochladen__waehlen {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    justify-self: start;
    padding: var(--space-4) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: pointer;
}

.hochladen__eingabe {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.hochladen__knoepfe {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-8);
}
</style>
