<script setup lang="ts">
import { computed, watch } from "vue";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import KartenvorschlagAnsicht from "./kartenvorschlag-ansicht.vue";
import { erzeugeAnsicht } from "./kartenvorschlag-ansicht-zustand";
import { redaktion } from "./redaktion";

/**
 * Das Fenster EINES Kartenvorschlags der Redaktion (WI-0275, Entwurf Fassung 2). Ein Werkzeugfenster der Hülle und der Fensterverwaltung (`werkzeug` `kartenvorschlag`), angedockt links neben dem Panel, wie das einer Bewertung; ein zweiter Vorschlag ersetzt den
 * ersten im selben Fenster (`redaktion.ts`), eine Eingabe geht dabei nicht verloren.
 *
 * Seit WI-0068 OPS-000093 ist es eine schmale Hülle: Zustand und Schritte (Laden, Blätter „Annehmen“ und „Ablehnen“, Revisionsschutz, Kartensperre) stehen in `kartenvorschlag-ansicht-zustand.ts`, die Anzeige (Kästen, Blätter, Fuß)
 * in `kartenvorschlag-ansicht.vue`; dieselben trägt die dritte Spalte der Medienverwaltung. Hier bleiben, was nur das Werkzeugfenster tut:
 * - die Fächer der Hülle füllen (Leiste, Rumpf, Fuß) und den Kopftitel nachführen („K-1047 Titel“),
 * - ein Grund im Blatt ist eine Eingabe: Das Fenster legt sich ab, statt ihn zu verwerfen (`ungespeichert`),
 * - das ⊘ der Community-Liste öffnet das Blatt „Ablehnen“ (`blattWunsch`),
 * - die Karte steht still, bis der Vorschlag geöffnet wird; dann fliegt sie zum Ort (nie ein Sprung, nur über `camera.ts`).
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Eintrag der Fensterverwaltung: `gegenstand` ist die öffentliche Kennung des Vorschlags. */
    fenster: WerkzeugFenster;
    rechte: readonly string[];
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
    ablageZiel?: (() => DOMRect | undefined) | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

const z = erzeugeAnsicht({
    id: () => props.fenster.gegenstand ?? "",
    rechte: () => props.rechte,
    sichtbar: () => props.lage !== "versenkt",
    fliegen: true,
    vorlaeufigerTitel: () => props.fenster.titel,
});

const kopfTitel = computed(() => z.kopfTitel);
watch(
    kopfTitel,
    (titel) => {
        if (titel !== props.fenster.titel) redaktion.fenster.value?.markiere(props.fenster.id, { titel });
    },
    { immediate: true },
);

// Ein Grund ist eine Eingabe: Das Fenster legt sich ab, statt ihn zu verwerfen.
watch(
    () => z.grund.trim() !== "",
    (ja) => {
        if (ja !== props.fenster.ungespeichert) {
            redaktion.fenster.value?.markiere(props.fenster.id, { ungespeichert: ja });
        }
    },
    { immediate: true },
);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="links-unten"
        hoehe="inhalt"
        :titel="kopfTitel"
        :ablage-ziel="props.ablageZiel"
        testid="community-karte-fenster"
        @update:lage="(neu, neueBox) => emit('update:lage', neu, neueBox)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <template v-if="z.detail !== undefined" #leiste>
            <KartenvorschlagAnsicht :zustand="z" teil="leiste" />
        </template>

        <KartenvorschlagAnsicht :zustand="z" teil="rumpf" />

        <!-- Der Fuß je Zustand: der Satz zur Wirkung, links das Ablehnen, rechts das Annehmen. Solange ein Blatt offen ist, gehört der Platz dem Blatt. -->
        <template v-if="z.detail !== undefined && z.fuss !== undefined && z.blatt === undefined" #fuss-hinweis>
            <KartenvorschlagAnsicht :zustand="z" teil="fuss" />
        </template>
    </AvmFenster>
</template>
