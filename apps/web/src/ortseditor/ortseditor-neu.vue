<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import {
    PLACE_FLAGS,
    PLACE_SUBTYPES,
    type PlaceCreateBody,
    type PlaceFlag,
    type PlaceSubtype,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import OrtsartWahl from "./ortsart-wahl.vue";
import "./ortseditor-formular.css";

/**
 * „✚ Neuer Ort“ (WI-0128 E16 Teil b; EDIT-0001 §4.1, §7.1 E16): Name, Ortsgröße und Art, mehr braucht ein Ort nicht zum Anlegen. Ohne
 * Lage (aus dem Menüband) steht er danach unter „Nicht auf der Karte“ (Betreiber 2026-10-11: „es kriegt das flag "nicht auf der
 * karte"“); mit Lage (Kontextmenü „Hier hinzufügen › Neuer Ort“) steht er gleich auf der Karte. Danach öffnet er sich im Ortseditor,
 * und alles Weitere geht dort wie bei jedem Ort.
 *
 * 🔴 **Dieselben Felder wie die Eigenschaften** (Betreiber 2026-10-13: „neuer ort hat immer noch nicht alle felder“). Wer
 * einen Ort anlegt, weiß in aller Regel schon, was drinsteht. Vorher waren es drei, und alles Weitere verlangte eine zweite
 * Operation gleich hinterher – zwei Zeilen im Verlauf für einen Vorgang. Pflicht bleibt allein der Name.
 *
 * 🔴 **Dieselbe Form wie die Eigenschaften, in die sie sich verwandelt.** Sie steht an derselben Stelle desselben
 * Fensters wie „Eigenschaften › Identität“ und wird nach dem Anlegen unmittelbar davon abgelöst. Sie trug eine eigene
 * Maßtafel, und darum sprangen die Felder in genau diesem Augenblick. Die Werte stehen jetzt in `ortseditor-formular.css`
 * und gelten für beide.
 */
const props = defineProps<{
    kennung: string;
    /** Wo er liegen soll, aus dem Kontextmenü; ohne Lage steht er unter „Nicht auf der Karte“. */
    position?: { x: number; y: number } | undefined;
    /** Der Satz des Servers, warum es nicht ging. */
    fehler?: string | undefined;
    sendet: boolean;
}>();
const emit = defineEmits<{
    anlegen: [body: Omit<PlaceCreateBody, "operationId">];
    abbrechen: [];
    /** Ist schon etwas eingetragen? Dann fragt eine Wahl in der Liste, bevor das Formular geht. */
    eingetragen: [ja: boolean];
}>();

const name = ref("");
const groesse = ref<PlaceSubtype>("dorf");
const art = ref("");
const groessen = PLACE_SUBTYPES.map((wert) => ({ wert, text: t(`place.${wert}` as MessageKey) }));

type Textfeld = "einwohner" | "oberhaupt" | "lage" | "description";
/** Die vier Texte der Identität, in derselben Folge wie in den Eigenschaften. */
const TEXTE: readonly { feld: Textfeld; name: MessageKey; mehrzeilig?: true }[] = [
    { feld: "einwohner", name: "infoPanel.field.einwohner" },
    { feld: "oberhaupt", name: "ortseditor.feld.herrscher" },
    { feld: "lage", name: "infoPanel.field.lage" },
    { feld: "description", name: "infoPanel.field.description", mehrzeilig: true },
];
const texte = ref<Record<Textfeld, string>>({ einwohner: "", oberhaupt: "", lage: "", description: "" });

/** Die sieben Merkmale, in derselben Folge und mit denselben Sätzen wie in den Eigenschaften (E11, D21). */
const MERKMALE: Readonly<Record<PlaceFlag, { name: MessageKey; satz: MessageKey }>> = {
    ruined: { name: "ortseditor.feld.ruine", satz: "ortseditor.merkmal.ruineSatz" },
    hidden: { name: "ortseditor.feld.verborgen", satz: "ortseditor.merkmal.verborgenSatz" },
    seaport: { name: "ortseditor.feld.seehafen", satz: "ortseditor.merkmal.seehafenSatz" },
    nodix: { name: "ortseditor.feld.nodix", satz: "ortseditor.merkmal.nodixSatz" },
    underground: { name: "ortseditor.feld.unterirdisch", satz: "ortseditor.merkmal.unterirdischSatz" },
    withdrawn: { name: "ortseditor.feld.entrueckt", satz: "ortseditor.merkmal.entruecktSatz" },
    approximate: { name: "ortseditor.feld.ungefaehr", satz: "ortseditor.merkmal.ungefaehrSatz" },
};
const merkmale = ref<Record<PlaceFlag, boolean>>({
    ruined: false,
    hidden: false,
    seaport: false,
    nodix: false,
    underground: false,
    withdrawn: false,
    approximate: false,
});

const lage = computed(() =>
    props.position
        ? `${formatNumber(props.position.x, 2)} · ${formatNumber(props.position.y, 2)}`
        : t("editorListe.karte.nicht"),
);
const ohneName = computed(() => name.value.trim() === "");

/*
 * 🔴 Der Satz, warum „Anlegen“ nicht geht, steht UNTER der Knopfreihe (Betreiber 2026-10-13: „ja, der satz unter die
 * knöpfe“). `AvmKnopf` setzt ihn sonst neben den Knopf, und zwischen „Anlegen“ und „Abbrechen“ las er sich wie ein Trenner.
 *
 * 🪤 Die Hausregel bleibt vollständig (Guide §7, §13.11; WI-0120 A8): Der Satz ist SICHTBAR, steht im selben Baustein
 * `AvmSperrgrund` wie überall, der Knopf zeigt mit `aria-describedby` auf ihn und trägt ihn als `title`. Nur die Stelle ist
 * eine andere. `gesperrt=" "` ist der dafür vorgesehene Weg: ein leerer Grund sperrt, ohne einen eigenen Satz zu setzen
 * (`sperre()` in `bedienelement.ts`).
 */
const grundId = useId();
const grund = computed(() =>
    ohneName.value ? t("ortseditor.neu.ohneName") : props.sendet ? t("ortseditor.zustand.speichert") : undefined,
);
// Ist schon etwas eingetragen? Jedes Feld zählt, nicht nur die ersten drei - sonst ginge eine Eingabe beim Wechsel verloren.
watch(
    () =>
        name.value.trim() !== "" ||
        art.value.trim() !== "" ||
        groesse.value !== "dorf" ||
        Object.values(texte.value).some((wert) => wert.trim() !== "") ||
        Object.values(merkmale.value).some((an) => an),
    (ja) => emit("eingetragen", ja),
    { immediate: true },
);

function anlegen(): void {
    if (ohneName.value || props.sendet) return;
    const kind = art.value.trim();
    const gesetzteTexte = Object.fromEntries(
        Object.entries(texte.value)
            .map(([feld, wert]) => [feld, wert.trim()] as const)
            .filter(([, wert]) => wert !== ""),
    );
    // Nur gesetzte Merkmale reisen mit: Der Vertrag hat für jedes `false` als Vorgabe, und ein leerer Körper liest sich besser.
    const gesetzteMerkmale = Object.fromEntries(
        PLACE_FLAGS.filter((feld) => merkmale.value[feld]).map((f) => [f, true]),
    );
    emit("anlegen", {
        name: name.value.trim(),
        subtype: groesse.value,
        ...(kind !== "" ? { kind } : {}),
        ...gesetzteTexte,
        ...gesetzteMerkmale,
        ...(props.position ? { position: props.position } : {}),
    });
}
</script>

<template>
    <form class="neu ortsform__kasten" :data-testid="`${kennung}-neu`" @submit.prevent="anlegen">
        <h4 class="ortsform__titel">{{ t("ortseditor.neu.titel") }}</h4>
        <label class="ortsform__zeile">
            <span class="ortsform__name">{{ t("ortseditor.feld.name") }}</span>
            <AvmEingabe v-model="name" :testid="`${kennung}-neu-name`" />
        </label>
        <label class="ortsform__zeile">
            <span class="ortsform__name">{{ t("ortseditor.feld.groesse") }}</span>
            <AvmAuswahl
                v-model="groesse"
                :optionen="groessen"
                :aria-label="t('ortseditor.feld.groesse')"
                :testid="`${kennung}-neu-groesse`"
            />
        </label>
        <div class="ortsform__zeile">
            <label :for="`${kennung}-neu-art-id`" class="ortsform__name">{{ t("ortseditor.feld.art") }}</label>
            <OrtsartWahl :id="`${kennung}-neu-art-id`" v-model="art" :testid="`${kennung}-neu-art`" />
        </div>
        <div v-for="text in TEXTE" :key="text.feld" class="ortsform__zeile">
            <label :for="`${kennung}-neu-text-${text.feld}`" class="ortsform__name">{{ t(text.name) }}</label>
            <AvmTextbereich
                v-if="text.mehrzeilig"
                :id="`${kennung}-neu-text-${text.feld}`"
                v-model="texte[text.feld]"
                :zeilen="4"
                :testid="`${kennung}-neu-text-${text.feld}`"
            />
            <AvmEingabe
                v-else
                :id="`${kennung}-neu-text-${text.feld}`"
                v-model="texte[text.feld]"
                :testid="`${kennung}-neu-text-${text.feld}`"
            />
        </div>
        <p class="ortsform__zeile">
            <span class="ortsform__name">{{ t("ortseditor.feld.position") }}</span>
            <span :data-testid="`${kennung}-neu-lage`">{{ lage }}</span>
        </p>
        <h4 class="ortsform__titel neu__zwischen">{{ t("ortseditor.abschnitt.merkmale") }}</h4>
        <AvmKaestchen
            v-for="feld in PLACE_FLAGS"
            :key="feld"
            art="checkbox"
            :checked="merkmale[feld]"
            mehrzeilig
            :testid="`${kennung}-neu-${feld}`"
            @change="(an: boolean) => (merkmale[feld] = an)"
        >
            <span
                >{{ t(MERKMALE[feld].name) }}<small class="neu__klein">{{ t(MERKMALE[feld].satz) }}</small></span
            >
        </AvmKaestchen>
        <p class="neu__leise">{{ position ? t("ortseditor.neu.mitLage") : t("ortseditor.neu.ohneLage") }}</p>
        <p v-if="fehler" class="neu__fehler" role="alert" :data-testid="`${kennung}-neu-fehler`">{{ fehler }}</p>
        <div class="neu__knoepfe">
            <AvmKnopf
                art="gefuellt"
                typ="submit"
                :gesperrt="grund === undefined ? undefined : ' '"
                :title="grund"
                :aria-describedby="grund === undefined ? undefined : grundId"
                :testid="`${kennung}-neu-anlegen`"
            >
                {{ t("ortseditor.neu.anlegen") }}
            </AvmKnopf>
            <AvmKnopf :testid="`${kennung}-neu-abbrechen`" @click="emit('abbrechen')">
                {{ t("ortseditor.neu.abbrechen") }}
            </AvmKnopf>
        </div>
        <AvmSperrgrund v-if="grund !== undefined" :id="grundId" :text="grund" />
    </form>
</template>

<style scoped>
/* Kasten, Zeilen und Beschriftungen kommen aus `ortseditor-formular.css`; hier steht nur, was dieser Form allein gehört. */
.neu__leise {
    margin: 0;
    color: var(--color-text-muted);
}

.neu__fehler {
    margin: 0;
    color: var(--color-danger);
}

.neu__zwischen {
    margin-top: var(--space-4);
}

.neu__klein {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.neu__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    align-items: center;
}
</style>
