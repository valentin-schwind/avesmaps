<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t, type MessageKey } from "../i18n/i18n";
import {
    abbrechenCommit,
    releaseTestKnopf,
    releaseTestWiederholen,
    releaseVolltestKnopf,
    type ReleaseTest,
} from "./release-test";

/**
 * Die Knöpfe der Karte „Release-Test“ (`umgebungen-release-test.vue`): Schnelltest, Volltest, „Rote Teile wiederholen“, Abbrechen und der Satz zum
 * Weiterlaufen.
 *
 * 🔴 **Ein Knopf, der nicht geht, sagt es sichtbar** (WI-0248, Valis Abbruch am 2026-10-24): Der Grund steht als Zeile unter den Knöpfen, nicht nur im
 * Hinweis des gesperrten Knopfes (`release-test-start-grund`). Und die Karte stellt diesen Block nach oben, wenn nichts läuft; läuft etwas, steht er unter dem Lauf.
 *
 * 🔴 **Schnelltest und Volltest** (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest … sie soll auch kurz erklären, was was tut (tabelle mit den
 * tests und was wo dabei ist?)“): Der Schnelltest ist der bisherige Start (Release-Tor, Freigabe), der Volltest prüft danach alles und gibt nichts frei.
 * Die Tafel darunter sagt, welche Prüfung in welchem Test steckt und was danach geschieht. Beide halten denselben Platz: Läuft einer, steht der Grund
 * für beide als Zeile da.
 */
const props = defineProps<{ test: ReleaseTest }>();

const sicht = computed(() => props.test.sicht.value);
const knopf = computed(() => releaseTestKnopf(sicht.value));
const volltestKnopf = computed(() => releaseVolltestKnopf(sicht.value));
const wiederholen = computed(() => releaseTestWiederholen(sicht.value));
const abbrechenFuer = computed(() => abbrechenCommit(sicht.value));

/** Während eines Aufrufs und solange ein Versuch auf die Antwort des Starters wartet, gibt es keinen zweiten Druck. */
const wartet = computed(() => props.test.busy.value || props.test.versuch.value !== null);
const grundVon = (sperre: string | null): string | undefined => {
    if (sperre !== null) return t(`admin.umgebungen.releaseTest.sperre.${sperre}` as MessageKey);
    return wartet.value ? "" : undefined;
};
const startGrund = computed(() => grundVon(knopf.value.sperre));
const volltestGrund = computed(() => grundVon(volltestKnopf.value.sperre));
/** Warum „Rote Teile wiederholen“ gerade nicht geht (läuft, startet); leer, wenn es geht, `""` nur während eines Aufrufs. */
const wiederholenGrund = computed(() => grundVon(wiederholen.value.sperre));
/**
 * Der Grund als sichtbarer Satz: der des Schnelltests, sonst der des Volltests, sonst der des Wiederholknopfes; nichts, wo ein Knopf geht oder nur ein
 * Aufruf läuft. Ein grün geprüfter Stand sperrt nur den Schnelltest; der Satz sagt es, der Volltest bleibt frei.
 */
const sperrSatz = computed(() => {
    for (const grund of [startGrund.value, volltestGrund.value])
        if (typeof grund === "string" && grund !== "") return grund;
    const wieder = wiederholenGrund.value;
    return wiederholen.value.sichtbar && typeof wieder === "string" && wieder !== "" ? wieder : "";
});

/** Die Tafel „Was prüft welcher Test?“: je Zeile die Prüfung und was Schnelltest und Volltest dazu tun. */
type Zelle = "ja" | "nein" | MessageKey;
const TAFEL: readonly { readonly pruefung: MessageKey; readonly schnell: Zelle; readonly voll: Zelle }[] = [
    { pruefung: "admin.umgebungen.releaseTest.tafel.bau", schnell: "ja", voll: "ja" },
    { pruefung: "admin.umgebungen.releaseTest.tafel.daten", schnell: "ja", voll: "ja" },
    { pruefung: "admin.umgebungen.releaseTest.tafel.kern", schnell: "ja", voll: "ja" },
    { pruefung: "admin.umgebungen.releaseTest.tafel.format", schnell: "nein", voll: "ja" },
    { pruefung: "admin.umgebungen.releaseTest.tafel.vitest", schnell: "nein", voll: "ja" },
    { pruefung: "admin.umgebungen.releaseTest.tafel.browser", schnell: "nein", voll: "ja" },
    {
        pruefung: "admin.umgebungen.releaseTest.tafel.dauer",
        schnell: "admin.umgebungen.releaseTest.tafel.dauerSchnell",
        voll: "admin.umgebungen.releaseTest.tafel.dauerVoll",
    },
    {
        pruefung: "admin.umgebungen.releaseTest.tafel.gruen",
        schnell: "admin.umgebungen.releaseTest.tafel.gruenSchnell",
        voll: "admin.umgebungen.releaseTest.tafel.gruenVoll",
    },
    {
        pruefung: "admin.umgebungen.releaseTest.tafel.rot",
        schnell: "admin.umgebungen.releaseTest.tafel.rotWert",
        voll: "admin.umgebungen.releaseTest.tafel.rotWert",
    },
    {
        pruefung: "admin.umgebungen.releaseTest.tafel.bericht",
        schnell: "admin.umgebungen.releaseTest.tafel.berichtSchnell",
        voll: "admin.umgebungen.releaseTest.tafel.berichtVoll",
    },
];
const zelle = (wert: Zelle): string =>
    wert === "ja"
        ? t("admin.umgebungen.releaseTest.tafel.ja")
        : wert === "nein"
          ? t("admin.umgebungen.releaseTest.tafel.nein")
          : t(wert);
</script>

<template>
    <div class="aktionen">
        <AvmKnopf
            art="gefuellt"
            :gesperrt="startGrund"
            testid="release-test-starten"
            :title="t('admin.umgebungen.releaseTest.schnelltestHinweis')"
            @click="void props.test.starten()"
            >{{ t("admin.umgebungen.releaseTest.starten") }}</AvmKnopf
        >
        <AvmKnopf
            :gesperrt="volltestGrund"
            testid="release-test-volltest"
            :title="t('admin.umgebungen.releaseTest.volltestHinweis')"
            @click="void props.test.volltest()"
            >{{ t("admin.umgebungen.releaseTest.volltest") }}</AvmKnopf
        >
        <AvmKnopf
            v-if="wiederholen.sichtbar"
            art="gefuellt"
            :gesperrt="wiederholenGrund"
            testid="release-test-wiederholen"
            :title="t('admin.umgebungen.releaseTest.wiederholen.hinweis')"
            @click="void props.test.wiederholen()"
            >{{ t("admin.umgebungen.releaseTest.wiederholen.knopf") }}</AvmKnopf
        >
        <AvmKnopf
            v-if="abbrechenFuer !== null"
            art="gefahr"
            :gesperrt="props.test.busy.value ? '' : undefined"
            testid="release-test-abbrechen"
            @click="void props.test.abbrechen()"
            >{{ t("admin.umgebungen.releaseTest.abbrechen") }}</AvmKnopf
        >
    </div>
    <p v-if="sperrSatz !== ''" class="satz satz--leise" data-testid="release-test-start-grund">{{ sperrSatz }}</p>
    <p class="satz satz--leise" data-testid="release-test-hinweis">
        {{ t("admin.umgebungen.releaseTest.hinweis") }}
    </p>
    <details class="tafel" data-testid="release-test-tafel">
        <summary class="tafel__titel">{{ t("admin.umgebungen.releaseTest.tafel.titel") }}</summary>
        <table class="tafel__tabelle">
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.umgebungen.releaseTest.tafel.pruefung") }}</th>
                    <th scope="col">{{ t("admin.umgebungen.releaseTest.starten") }}</th>
                    <th scope="col">{{ t("admin.umgebungen.releaseTest.volltest") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="zeile in TAFEL" :key="zeile.pruefung">
                    <th scope="row">{{ t(zeile.pruefung) }}</th>
                    <td :class="{ tafel__nein: zeile.schnell === 'nein' }">{{ zelle(zeile.schnell) }}</td>
                    <td :class="{ tafel__nein: zeile.voll === 'nein' }">{{ zelle(zeile.voll) }}</td>
                </tr>
            </tbody>
        </table>
    </details>
</template>

<style scoped>
.satz {
    margin: 0;
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
}

.satz--leise {
    font-size: var(--font-size-small);
}

.aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-8) var(--space-12);
    margin-top: var(--space-8);
}

/* Was prüft welcher Test (WI-0264): aufklappbar wie der Bericht, damit die Karte nur so hoch ist wie nötig. */
.tafel {
    margin-top: var(--space-4);
}

.tafel__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    cursor: pointer;
}

.tafel__tabelle {
    width: 100%;
    margin-top: var(--space-8);
    border-collapse: collapse;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.tafel__tabelle th,
.tafel__tabelle td {
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    vertical-align: top;
}

/* Kein gerechnetes Fett (die Hausschrift hat nur den Regular): Der Kopf unterscheidet sich über die Farbe. */
.tafel__tabelle th {
    font-weight: 400;
}

.tafel__tabelle thead th {
    color: var(--color-text-muted);
}

.tafel__nein {
    color: var(--color-text-muted);
}
</style>
