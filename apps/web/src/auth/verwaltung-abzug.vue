<script setup lang="ts">
/**
 * Der Abzug für lokal im Datenabgleich (WI-0251; Vali 2026-10-24: „ja von stage und production, aber ohne die accounts, statistiken und alle
 * kartendaten auch“). Was die Oberfläche rechnet, steht in `abzug.ts`; hier steht nur, wie es aussieht.
 *
 * - **Dieselbe Listenform wie die Abgleiche** (Legacys Listen, Guide §13.17): je Zeile Name mit Kreis, die Unterzeile im Ton der Lage, ein leiser
 *   Satz, was geschieht; rechts der Knopf mit einem abstrakten Zeichen (⇄ Handlung, ✚ Datei, ↓ Herunterladen), denn Knöpfe nur für Backend-Nutzer
 *   tragen keine Bildsymbole.
 * - **Stage und Production** zeigen „Abzug für lokal“ mit „⇄ Abzug erstellen“ und darunter die fertigen Abzüge mit „↓ Herunterladen“.
 * - **Lokal** zeigt oben „Abzug holen und einspielen“ (siehe unten). Der Weg mit der Datei ist ein leiser Notweg (Vali 2026-10-25): Unter dem Holen
 *   steht der Link „Datei von Hand einspielen“, und erst sein Druck klappt „Abzug einspielen“ mit „✚ Datei wählen“ auf; die gewählte Datei steht
 *   darunter mit dem Ergebnis der Prüfung gegen diese Datenbank und mit „⇄ Jetzt einspielen“. Der Knopf fragt an der Stelle nach (`AvmBestaetigung`);
 *   erst der zweite Druck ersetzt etwas. Solange die Datei übernommen wird oder ein Einspielen mit der Datei läuft, bleibt der Weg offen
 *   (`dateiWegErzwungen`); ein Einspielen vom Holen zeigt seine Lage in der Zeile der Quelle.
 * - **Selbst abholen** (Vali 2026-10-25): Auf Stage und Production steht unter den Abzügen die Liste der **Abzugs-Schlüssel** (anlegen mit Passkey,
 *   der Wert nur einmal im Kopierfeld, widerrufen). Lokal stehen oben zwei Zeilen, Stage und Production: Schlüssel eintragen (er bleibt auf dem Rechner und
 *   kommt nie zurück in die Seite), dann „⇄ Abzug holen und einspielen“; der Fortschritt der Datei steht im Balken der Zeile.
 * - Antwortet der Server nicht mit einer Rolle (404), zeigt der Eintrag nichts.
 * - **Telefon:** der Knopf rutscht unter die Zeile und nimmt die ganze Breite.
 */
import { computed, onMounted, onUnmounted, reactive, ref, useId, watch } from "vue";
import { ABZUG_QUELLEN, ABZUG_SCHLUESSEL_TAGE, type AbzugQuelle } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKopierfeld from "../controls/avm-kopierfeld.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { kreisName } from "./abgleiche";
import {
    abzugKreis,
    anlegenSperre,
    dateiWegErzwungen,
    einspielenSperre,
    einspielenUnterzeile,
    erstellenSperre,
    erstellenUnterzeile,
    ergebnisMedien,
    faktenMitMedien,
    fortschritt,
    groesseText,
    holenQuelleGerade,
    holenSperre,
    istEinspielen,
    istErstellen,
    problemSatz,
    quellenName,
    schluesselTitel,
    schluesselUnterzeile,
    zahlText,
    type Abzug,
    type SchluesselTage,
    type Unterzeile,
} from "./abzug";
import { authState } from "./session-state";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    abzug: Abzug;
    telefon: boolean;
}>();

const darf = {
    sichern: authState.value.capabilities.includes("create_backup"),
    einspielen: authState.value.capabilities.includes("run_abzug_einspielen"),
};
const basisId = useId();

/** Die Uhr für „heute, 14:05“; tickt nur, solange der Eintrag zu sehen ist. */
const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    props.abzug.follow(true);
    void props.abzug.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    props.abzug.follow(false);
    props.abzug.cancel();
});

const sicht = computed(() => props.abzug.sicht.value);
const erstellen = computed(() => (istErstellen(sicht.value) ? sicht.value : null));
const einspielen = computed(() => (istEinspielen(sicht.value) ? sicht.value : null));
const prozent = computed(() => fortschritt(sicht.value));
const kreis = computed(() => abzugKreis(sicht.value));
const unter = computed(() =>
    erstellen.value !== null
        ? erstellenUnterzeile(erstellen.value, jetzt.value)
        : einspielen.value !== null
          ? einspielenUnterzeile(einspielen.value, jetzt.value)
          : { text: "", ton: "leise" as const },
);
const sperre = computed(() =>
    erstellen.value !== null
        ? erstellenSperre(erstellen.value, darf.sichern)
        : einspielen.value !== null
          ? einspielenSperre(einspielen.value, darf.einspielen)
          : undefined,
);
/**
 * „Datei wählen“ geht, solange keine Arbeit läuft und die Person das Recht hat. Fehlt ein Recht oder die Ablage, steht der Satz unter der Zeile; läuft
 * gerade Arbeit, sagt es schon die Unterzeile, und der Knopf steht nur gesperrt da.
 */
const dateiGrund = computed(() => {
    const s = einspielen.value;
    if (s === null) return undefined;
    if (!darf.sichern) return t("admin.sync.readOnly", { recht: t("auth.capability.create_backup") });
    if (!s.ablage) return t("admin.abzug.noStorage");
    return undefined;
});
const dateiSperre = computed(() => {
    if (dateiGrund.value !== undefined) return dateiGrund.value;
    if (props.abzug.hochladen.value) return t("admin.abzug.lokal.uebernimmt");
    if (einspielen.value?.lauf?.zustand === "laeuft") return t("admin.abzug.lokal.beschaeftigt");
    return undefined;
});

/** Stage: der Knopf „Schlüssel anlegen“ und die Wahl, wie lange er gilt. */
const anlegenGrund = computed(() =>
    erstellen.value === null ? undefined : anlegenSperre(erstellen.value, darf.sichern),
);
const tageOptionen = computed(() =>
    ABZUG_SCHLUESSEL_TAGE.map((n) => ({ value: String(n), label: t("admin.abzug.schluessel.tage", { n }) })),
);
function waehleTage(wert: string): void {
    props.abzug.waehleTage(Number(wert) as SchluesselTage);
}

/** Lokal: die Schlüsselfelder (nie aus dem Server gefüllt) und was in der Zeile einer Quelle steht. */
const eingabe = reactive<Record<AbzugQuelle, string>>({ staging: "", production: "" });
/** Von welcher Quelle das laufende Einspielen kommt: In ihrer Zeile stehen Lage und Balken, auch nachdem die Datei da ist. */
const holtVon = computed<AbzugQuelle | null>(() => holenQuelleGerade(sicht.value, props.abzug.geholtVon.value));

/**
 * Der Weg mit der Datei ist ein leiser Notweg (Vali 2026-10-25: „Behalte den Weg mit Datei nur als kleinen Notweg, sichtbar ist nur ‚Abzug holen
 * und einspielen‘“). Er steht zu, bis jemand „Datei von Hand einspielen“ drückt. Wird die Datei übernommen oder läuft ein Einspielen, das nicht vom
 * Holen kommt, klappt er von selbst auf und bleibt es, bis der Eintrag das nächste Mal geöffnet wird.
 */
const aufgeklappt = ref(false);
const erzwungen = computed(() =>
    dateiWegErzwungen(sicht.value, props.abzug.hochladen.value, props.abzug.geholtVon.value),
);
const dateiWegOffen = computed(() => aufgeklappt.value || erzwungen.value);
watch(
    erzwungen,
    (an) => {
        if (an) aufgeklappt.value = true;
    },
    { immediate: true },
);

function holenGrund(quelle: AbzugQuelle): string | undefined {
    return einspielen.value === null ? undefined : holenSperre(einspielen.value, darf.einspielen, quelle);
}

function holenUnter(quelle: AbzugQuelle): Unterzeile {
    const s = einspielen.value;
    if (s === null) return { text: "", ton: "leise" };
    // Läuft es für diese Quelle, ist das die Lage; sonst steht da, ob ein Schlüssel hinterlegt ist.
    if (holtVon.value === quelle) return unter.value;
    return s.schluessel[quelle]
        ? { text: t("admin.abzug.holen.schluesselDa"), ton: "gut" }
        : { text: t("admin.abzug.holen.schluesselFehlt"), ton: "leise" };
}

async function speichern(quelle: AbzugQuelle): Promise<void> {
    if (eingabe[quelle].trim() === "") return;
    const ergebnis = await props.abzug.setzeSchluessel(quelle, eingabe[quelle]);
    // Gespeichert: Der Wert verlässt das Feld und die Seite (er steht nur noch in der Datei des Servers).
    if (ergebnis.ok) eingabe[quelle] = "";
}

async function entfernen(quelle: AbzugQuelle): Promise<void> {
    await props.abzug.setzeSchluessel(quelle, null);
    eingabe[quelle] = "";
}

function zeitpunkt(iso: string): string {
    return relativeTime(new Date(iso), jetzt.value, locale.value, "zeitpunkt");
}

async function gewaehlt(event: Event): Promise<void> {
    const eingabe = event.target as HTMLInputElement;
    const datei = eingabe.files?.[0];
    // Dieselbe Datei muss sich noch einmal wählen lassen (etwa nach einem Fehler).
    eingabe.value = "";
    if (datei !== undefined) await props.abzug.waehleDatei(datei);
}
</script>

<template>
    <div v-if="abzug.verfuegbar.value" class="abzug" :class="{ 'abzug--telefon': props.telefon }" data-testid="abzug">
        <VerwaltungLadeproblem
            :problems="props.abzug.loadProblems.value"
            :fehlt="props.abzug.unconfirmed.value"
            testid="abzug-ladefehler"
            @bestaetigen="props.abzug.confirmAgain()"
            ><span class="abzug__block">{{ t("admin.abzug.loadFailed") }}</span></VerwaltungLadeproblem
        >

        <!-- Stage und Production: den Abzug erstellen, die fertigen herunterladen. -->
        <ul v-if="erstellen !== null" class="abzug__liste" :aria-label="t('admin.abzug.erstellen.name')">
            <li class="abzug__eintrag" data-testid="abzug-erstellen">
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{ t("admin.abzug.erstellen.name") }}</span>
                        <AvmKreis :fuellung="kreis" :name="kreisName(kreis)" testid="abzug-kreis" />
                    </span>
                    <span class="abzug__unter" :class="`abzug__unter--${unter.ton}`" data-testid="abzug-unter">{{
                        unter.text
                    }}</span>
                    <span class="abzug__was">{{ t("admin.abzug.erstellen.was") }}</span>
                    <AvmKnopf
                        :id="`${basisId}-erstellen`"
                        class="abzug__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.frage.value === 'erstellen' ? undefined : sperre"
                        :breit="props.telefon"
                        :aria-expanded="props.abzug.frage.value === 'erstellen'"
                        testid="abzug-erstellen-knopf"
                        @click="props.abzug.ask('erstellen')"
                        ><span aria-hidden="true">⇄ </span>{{ t("admin.abzug.erstellen.knopf") }}</AvmKnopf
                    >
                </div>
                <div
                    v-if="prozent !== null"
                    class="abzug__balken"
                    role="progressbar"
                    :aria-valuenow="prozent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('admin.sync.progress', { name: t('admin.abzug.erstellen.name') })"
                    data-testid="abzug-balken"
                >
                    <span class="abzug__balken-fuellung" :style="{ width: `${String(prozent)}%` }"></span>
                </div>
                <AvmBestaetigung
                    v-if="props.abzug.frage.value === 'erstellen'"
                    :frage="t('admin.abzug.erstellen.frage')"
                    :folge="t('admin.abzug.erstellen.folge')"
                    :bestaetigen="t('admin.abzug.erstellen.bestaetigen')"
                    :gesperrt="props.abzug.busy.value ? '' : undefined"
                    testid="abzug-erstellen-frage"
                    @bestaetigen="props.abzug.confirm()"
                    @abbrechen="props.abzug.cancel()"
                />
                <VerwaltungMeldung :ergebnis="props.abzug.ergebnis.value ?? undefined" testid="abzug-meldung" />
            </li>
            <li
                v-for="datei in erstellen.abzuege"
                :key="datei.kennung"
                class="abzug__eintrag"
                :data-testid="`abzug-datei-${datei.kennung}`"
            >
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{
                            t("admin.abzug.liste.titel", { time: zeitpunkt(datei.erstellt) })
                        }}</span>
                    </span>
                    <span class="abzug__unter abzug__unter--leise" :data-testid="`abzug-fakten-${datei.kennung}`">{{
                        faktenMitMedien(
                            t("admin.abzug.liste.fakten", {
                                groesse: groesseText(datei.bytes),
                                tafeln: zahlText(datei.tafeln),
                                zeilen: zahlText(datei.zeilen),
                            }),
                            datei.medien,
                            datei.medienBytes,
                        )
                    }}</span>
                    <span class="abzug__was">{{
                        t("admin.abzug.liste.bis", { time: zeitpunkt(datei.laeuftAb) })
                    }}</span>
                    <AvmKnopf
                        class="abzug__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="
                            !darf.sichern
                                ? t('admin.sync.readOnly', { recht: t('auth.capability.create_backup') })
                                : props.abzug.ladeKennung.value !== null
                                  ? t('admin.abzug.liste.holt')
                                  : undefined
                        "
                        :breit="props.telefon"
                        :testid="`abzug-herunterladen-${datei.kennung}`"
                        @click="props.abzug.herunterladen(datei.kennung)"
                        ><span aria-hidden="true">↓ </span>{{ t("admin.abzug.liste.herunterladen") }}</AvmKnopf
                    >
                </div>
            </li>
            <li v-if="erstellen.abzuege.length === 0" class="abzug__eintrag">
                <span class="abzug__leise" data-testid="abzug-leer">{{ t("admin.abzug.liste.leer") }}</span>
            </li>

            <!-- Abzugs-Schlüssel: Mit ihm holt der Entwicklungsrechner den neuesten Abzug selbst ab. -->
            <li class="abzug__eintrag" data-testid="abzug-schluessel">
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{ t("admin.abzug.schluessel.name") }}</span>
                    </span>
                    <span class="abzug__was">{{ t("admin.abzug.schluessel.was") }}</span>
                    <AvmKnopf
                        class="abzug__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.frage.value === 'schluessel' ? undefined : anlegenGrund"
                        :breit="props.telefon"
                        :aria-expanded="props.abzug.frage.value === 'schluessel'"
                        testid="abzug-schluessel-anlegen"
                        @click="props.abzug.ask('schluessel')"
                        ><span aria-hidden="true">✚ </span>{{ t("admin.abzug.schluessel.knopf") }}</AvmKnopf
                    >
                </div>
                <AvmBestaetigung
                    v-if="props.abzug.frage.value === 'schluessel'"
                    :frage="t('admin.abzug.schluessel.frage')"
                    :folge="t('admin.abzug.schluessel.folge')"
                    :bestaetigen="t('admin.abzug.schluessel.bestaetigen')"
                    :gesperrt="props.abzug.busy.value ? '' : undefined"
                    testid="abzug-schluessel-frage"
                    @bestaetigen="props.abzug.confirm()"
                    @abbrechen="props.abzug.cancel()"
                >
                    <AvmSegmente
                        :model-value="String(props.abzug.tage.value)"
                        :options="tageOptionen"
                        :label="t('admin.abzug.schluessel.gueltigFuer')"
                        testid="abzug-schluessel-tage"
                        @update:model-value="waehleTage"
                    />
                </AvmBestaetigung>
                <div
                    v-if="props.abzug.neuerSchluessel.value !== null"
                    class="abzug__neu"
                    data-testid="abzug-schluessel-neu"
                >
                    <span class="abzug__unter abzug__unter--warnung">{{ t("admin.abzug.schluessel.neu") }}</span>
                    <AvmKopierfeld
                        :wert="props.abzug.neuerSchluessel.value.schluessel"
                        :beschriftung="t('admin.abzug.schluessel.neuBeschriftung')"
                        :knopf="t('admin.abzug.schluessel.kopieren')"
                        :fertig="t('admin.abzug.schluessel.kopiert')"
                        :fehler="t('admin.abzug.schluessel.kopierFehler')"
                        testid="abzug-schluessel-kopierfeld"
                    />
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        testid="abzug-schluessel-notiert"
                        @click="props.abzug.schluesselGesehen()"
                        >{{ t("admin.abzug.schluessel.notiert") }}</AvmKnopf
                    >
                </div>
            </li>
            <li
                v-for="eintrag in erstellen.schluessel"
                :key="eintrag.id"
                class="abzug__eintrag"
                :data-testid="`abzug-schluessel-${eintrag.id}`"
            >
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{ schluesselTitel(eintrag) }}</span>
                        <AvmKreis
                            :fuellung="eintrag.zustand === 'gueltig' ? 'voll' : 'leer'"
                            :name="kreisName(eintrag.zustand === 'gueltig' ? 'voll' : 'leer')"
                        />
                    </span>
                    <span
                        class="abzug__unter"
                        :class="`abzug__unter--${schluesselUnterzeile(eintrag, jetzt).ton}`"
                        :data-testid="`abzug-schluessel-unter-${eintrag.id}`"
                        >{{ schluesselUnterzeile(eintrag, jetzt).text }}</span
                    >
                    <AvmKnopf
                        v-if="eintrag.zustand === 'gueltig'"
                        class="abzug__knopf"
                        art="gefahr"
                        groesse="zeile"
                        :gesperrt="
                            !darf.sichern
                                ? t('admin.abzug.schluessel.readOnly', { recht: t('auth.capability.create_backup') })
                                : props.abzug.widerrufId.value !== null
                                  ? t('admin.abzug.schluessel.widerrufenLaeuft')
                                  : undefined
                        "
                        :breit="props.telefon"
                        :testid="`abzug-schluessel-widerrufen-${eintrag.id}`"
                        @click="props.abzug.widerrufen(eintrag.id)"
                        >{{ t("admin.abzug.schluessel.widerrufenKnopf") }}</AvmKnopf
                    >
                </div>
            </li>
            <li v-if="erstellen.schluessel.length === 0" class="abzug__eintrag">
                <span class="abzug__leise" data-testid="abzug-schluessel-leer">{{
                    t("admin.abzug.schluessel.leer")
                }}</span>
            </li>
        </ul>

        <!-- Lokal: den Abzug holen und einspielen; als Notweg darunter die Datei von Hand. -->
        <ul v-else-if="einspielen !== null" class="abzug__liste" :aria-label="t('admin.abzug.lokal.name')">
            <!-- Abzug selbst abholen: je Quelle ein Schlüssel und ein Knopf. -->
            <li
                v-for="quelle in ABZUG_QUELLEN"
                :key="quelle"
                class="abzug__eintrag"
                :data-testid="`abzug-holen-${quelle}`"
            >
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{
                            t("admin.abzug.holen.name", { quelle: quellenName(quelle) })
                        }}</span>
                        <AvmKreis
                            :fuellung="einspielen.schluessel[quelle] ? 'voll' : 'leer'"
                            :name="kreisName(einspielen.schluessel[quelle] ? 'voll' : 'leer')"
                            :testid="`abzug-holen-kreis-${quelle}`"
                        />
                    </span>
                    <span
                        class="abzug__unter"
                        :class="`abzug__unter--${holenUnter(quelle).ton}`"
                        :data-testid="`abzug-holen-unter-${quelle}`"
                        >{{ holenUnter(quelle).text }}</span
                    >
                    <span v-if="quelle === 'staging'" class="abzug__was">{{ t("admin.abzug.holen.was") }}</span>
                    <AvmKnopf
                        class="abzug__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.frage.value === `holen:${quelle}` ? undefined : holenGrund(quelle)"
                        :breit="props.telefon"
                        :aria-expanded="props.abzug.frage.value === `holen:${quelle}`"
                        :testid="`abzug-holen-knopf-${quelle}`"
                        @click="props.abzug.ask(`holen:${quelle}`)"
                        ><span aria-hidden="true">⇄ </span>{{ t("admin.abzug.holen.knopf") }}</AvmKnopf
                    >
                </div>
                <div
                    v-if="holtVon === quelle && prozent !== null"
                    class="abzug__balken"
                    role="progressbar"
                    :aria-valuenow="prozent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="
                        t('admin.sync.progress', { name: t('admin.abzug.holen.name', { quelle: quellenName(quelle) }) })
                    "
                    :data-testid="`abzug-holen-balken-${quelle}`"
                >
                    <span class="abzug__balken-fuellung" :style="{ width: `${String(prozent)}%` }"></span>
                </div>
                <AvmBestaetigung
                    v-if="props.abzug.frage.value === `holen:${quelle}`"
                    :frage="t('admin.abzug.holen.frage', { quelle: quellenName(quelle) })"
                    :folge="t('admin.abzug.holen.folge')"
                    :bestaetigen="t('admin.abzug.holen.bestaetigen')"
                    :gesperrt="props.abzug.busy.value ? '' : undefined"
                    :testid="`abzug-holen-frage-${quelle}`"
                    @bestaetigen="props.abzug.confirm()"
                    @abbrechen="props.abzug.cancel()"
                />
                <VerwaltungMeldung
                    v-if="props.abzug.letzteQuelle.value === quelle && props.abzug.frage.value === null"
                    :ergebnis="props.abzug.ergebnis.value ?? undefined"
                    :testid="`abzug-holen-meldung-${quelle}`"
                />
                <div class="abzug__schluessel">
                    <AvmEingabe
                        v-model="eingabe[quelle]"
                        class="abzug__feld"
                        art="passwort"
                        autocomplete="off"
                        placeholder="abz_…"
                        :aria-label="t('admin.abzug.holen.feld', { quelle: quellenName(quelle) })"
                        :testid="`abzug-schluessel-feld-${quelle}`"
                        @keydown.enter="speichern(quelle)"
                    />
                    <AvmKnopf
                        v-if="eingabe[quelle].trim() !== ''"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.schluesselBusy.value ? t('admin.abzug.lokal.uebernimmt') : undefined"
                        :testid="`abzug-schluessel-speichern-${quelle}`"
                        @click="speichern(quelle)"
                        >{{ t("admin.abzug.holen.speichern") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="einspielen.schluessel[quelle]"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.schluesselBusy.value ? t('admin.abzug.lokal.uebernimmt') : undefined"
                        :testid="`abzug-schluessel-entfernen-${quelle}`"
                        @click="entfernen(quelle)"
                        >{{ t("admin.abzug.holen.entfernen") }}</AvmKnopf
                    >
                </div>
                <span v-if="quelle === 'staging'" class="abzug__leise">{{ t("admin.abzug.holen.hinweis") }}</span>
            </li>

            <!-- Der Notweg: erst ein Druck auf den Link klappt Datei wählen, Prüfung und Einspielen auf. -->
            <li class="abzug__eintrag abzug__eintrag--notweg" data-testid="abzug-notweg">
                <button
                    type="button"
                    class="abzug__notweg"
                    :aria-expanded="dateiWegOffen"
                    :disabled="erzwungen"
                    data-testid="abzug-notweg-knopf"
                    @click="aufgeklappt = !aufgeklappt"
                >
                    {{ t("admin.abzug.lokal.notweg") }}
                </button>
            </li>
            <li v-if="dateiWegOffen" class="abzug__eintrag" data-testid="abzug-lokal">
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{ t("admin.abzug.lokal.name") }}</span>
                        <AvmKreis :fuellung="kreis" :name="kreisName(kreis)" testid="abzug-kreis" />
                    </span>
                    <span class="abzug__unter" :class="`abzug__unter--${unter.ton}`" data-testid="abzug-unter">{{
                        props.abzug.hochladen.value ? t("admin.abzug.lokal.uebernimmt") : unter.text
                    }}</span>
                    <span class="abzug__was">{{ t("admin.abzug.lokal.was") }}</span>
                    <label
                        class="abzug__knopf abzug__waehlen"
                        :class="{
                            'abzug__waehlen--gesperrt': dateiSperre !== undefined,
                            'abzug__waehlen--breit': props.telefon,
                        }"
                        :title="dateiSperre"
                    >
                        <input
                            class="abzug__eingabe"
                            type="file"
                            accept=".tar,application/x-tar"
                            :disabled="dateiSperre !== undefined"
                            data-testid="abzug-datei-waehlen"
                            @change="gewaehlt"
                        />
                        <span aria-hidden="true">✚ </span>{{ t("admin.abzug.lokal.waehlen") }}
                    </label>
                </div>
                <span v-if="dateiGrund !== undefined" class="abzug__leise" data-testid="abzug-datei-sperre">{{
                    dateiGrund
                }}</span>
                <span class="abzug__leise">{{ t("admin.abzug.lokal.woher") }}</span>
                <VerwaltungMeldung
                    v-if="props.abzug.frage.value !== 'einspielen' && props.abzug.letzteQuelle.value === null"
                    :ergebnis="props.abzug.ergebnis.value ?? undefined"
                    testid="abzug-meldung"
                />
            </li>
            <li v-if="dateiWegOffen && einspielen.eingang !== null" class="abzug__eintrag" data-testid="abzug-eingang">
                <div class="abzug__zeile">
                    <span class="abzug__name">
                        <span class="abzug__text">{{ einspielen.eingang.name }}</span>
                        <AvmKreis
                            :fuellung="einspielen.eingang.probleme.length === 0 ? 'voll' : 'leer'"
                            :name="kreisName(einspielen.eingang.probleme.length === 0 ? 'voll' : 'leer')"
                            testid="abzug-eingang-kreis"
                        />
                    </span>
                    <span class="abzug__unter abzug__unter--leise" data-testid="abzug-eingang-fakten">{{
                        einspielen.eingang.kennung === ""
                            ? groesseText(einspielen.eingang.bytes)
                            : faktenMitMedien(
                                  t("admin.abzug.eingang.fakten", {
                                      quelle: t(`auth.environment.name.${einspielen.eingang.quelle}`),
                                      time: zeitpunkt(einspielen.eingang.erstellt),
                                      tafeln: zahlText(einspielen.eingang.tafeln),
                                      zeilen: zahlText(einspielen.eingang.zeilen),
                                      groesse: groesseText(einspielen.eingang.bytes),
                                  }),
                                  einspielen.eingang.medien,
                                  einspielen.eingang.medienBytes,
                                  einspielen.eingang.medienFehlend,
                              )
                    }}</span>
                    <span
                        v-if="einspielen.eingang.probleme.length === 0"
                        class="abzug__was"
                        data-testid="abzug-eingang-passt"
                        >{{ t("admin.abzug.eingang.passt") }}</span
                    >
                    <AvmKnopf
                        :id="`${basisId}-einspielen`"
                        class="abzug__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abzug.frage.value === 'einspielen' ? undefined : sperre"
                        :breit="props.telefon"
                        :aria-expanded="props.abzug.frage.value === 'einspielen'"
                        testid="abzug-einspielen-knopf"
                        @click="props.abzug.ask('einspielen')"
                        ><span aria-hidden="true">⇄ </span>{{ t("admin.abzug.eingang.knopf") }}</AvmKnopf
                    >
                </div>
                <ul v-if="einspielen.eingang.probleme.length > 0" class="abzug__probleme" data-testid="abzug-probleme">
                    <li v-for="problem in einspielen.eingang.probleme" :key="problem.code">
                        <AvmHinweis ton="warnung">{{ problemSatz(problem) }}</AvmHinweis>
                    </li>
                </ul>
                <div
                    v-if="prozent !== null && holtVon === null"
                    class="abzug__balken"
                    role="progressbar"
                    :aria-valuenow="prozent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('admin.sync.progress', { name: t('admin.abzug.lokal.name') })"
                    data-testid="abzug-balken"
                >
                    <span class="abzug__balken-fuellung" :style="{ width: `${String(prozent)}%` }"></span>
                </div>
                <AvmBestaetigung
                    v-if="props.abzug.frage.value === 'einspielen'"
                    :frage="t('admin.abzug.eingang.frage')"
                    :folge="t('admin.abzug.eingang.folge')"
                    :bestaetigen="t('admin.abzug.eingang.bestaetigen')"
                    :gesperrt="props.abzug.busy.value ? '' : undefined"
                    testid="abzug-einspielen-frage"
                    @bestaetigen="props.abzug.confirm()"
                    @abbrechen="props.abzug.cancel()"
                />
                <VerwaltungMeldung
                    v-if="props.abzug.frage.value === 'einspielen'"
                    :ergebnis="props.abzug.ergebnis.value ?? undefined"
                    testid="abzug-meldung-einspielen"
                />
            </li>
            <li
                v-if="einspielen.lauf !== null && einspielen.lauf.zustand !== 'laeuft'"
                class="abzug__eintrag"
                data-testid="abzug-ergebnis"
            >
                <span
                    class="abzug__unter"
                    :class="einspielen.lauf.zustand === 'fertig' ? 'abzug__unter--gut' : 'abzug__unter--warnung'"
                    >{{
                        einspielen.lauf.zustand === "fertig"
                            ? t("admin.abzug.ergebnis.fertig", { zeilen: zahlText(einspielen.lauf.zeilen ?? 0) })
                            : (einspielen.lauf.meldung ?? t("admin.abzug.ergebnis.fehler"))
                    }}</span
                >
                <!-- Zu steht der Weg der Datei, und mit ihm die Zeile „Zuletzt eingespielt“; sie gilt auch für das Holen. -->
                <span
                    v-if="!dateiWegOffen"
                    class="abzug__was"
                    :class="{ 'abzug__was--warnung': unter.ton === 'warnung' }"
                    data-testid="abzug-ergebnis-wann"
                    >{{ unter.text }}</span
                >
                <span
                    v-if="ergebnisMedien(einspielen.lauf) !== null"
                    class="abzug__was"
                    :class="{ 'abzug__was--warnung': ergebnisMedien(einspielen.lauf)?.ton === 'warnung' }"
                    data-testid="abzug-medien"
                    >{{ ergebnisMedien(einspielen.lauf)?.text }}</span
                >
                <span v-if="einspielen.lauf.sicherung !== null" class="abzug__was" data-testid="abzug-sicherung">{{
                    t("admin.abzug.ergebnis.sicherung", { name: einspielen.lauf.sicherung })
                }}</span>
                <span v-if="einspielen.lauf.zustand === 'fertig'" class="abzug__was">{{
                    t("admin.abzug.ergebnis.neustart")
                }}</span>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.abzug {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.abzug__block {
    display: block;
}

.abzug__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.abzug__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.abzug__eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
}

.abzug__eintrag + .abzug__eintrag {
    border-top: 1px solid var(--color-divider);
}

/* Legacys Zeile: Name mit Kreis oben, Unterzeile darunter, rechts die Handlung über beide Zeilen. */
.abzug__zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-12);
    row-gap: var(--space-2);
    align-items: center;
}

.abzug__name {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.abzug__text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.abzug__unter {
    grid-row: 2;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.abzug__unter--gut {
    color: var(--color-success-soft-text);
}

.abzug__unter--warnung {
    color: var(--color-warning-soft-text);
}

.abzug__unter--fehler {
    color: var(--color-danger-soft-text);
}

.abzug__was {
    grid-row: 3;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.abzug__was.abzug__was--warnung {
    color: var(--color-warning-soft-text);
}

.abzug__knopf {
    grid-row: 1 / span 3;
    grid-column: 2;
    justify-self: end;
}

/* Der weiche Zeilenknopf (`AvmKnopf` art weich, groesse zeile) als Feld: die echte Eingabe liegt unsichtbar darüber (Tastatur und Screenreader erreichen sie). */
.abzug__waehlen {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    box-sizing: border-box;
    min-height: var(--space-24);
    padding-inline: var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    white-space: nowrap;
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.abzug__waehlen:hover:not(.abzug__waehlen--gesperrt) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.abzug__waehlen:focus-within {
    outline: none;
    box-shadow: var(--focus-ring);
}

.abzug__waehlen--gesperrt {
    opacity: 0.55;
    cursor: not-allowed;
}

.abzug__eingabe {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: inherit;
}

/* Der Notweg „Datei von Hand einspielen“: ein leiser Link unter dem Holen, kein Knopf; die Datei ist nur der Ausweg, wenn das Holen nicht geht. */
.abzug__eintrag--notweg {
    align-items: flex-start;
    padding-block: var(--space-4);
}

.abzug__notweg {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
}

.abzug__notweg:hover:not(:disabled) {
    color: var(--color-link-hover);
}

.abzug__notweg:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Offen, weil gerade etwas läuft: Der Link sagt es nur noch, er klappt nichts zu. */
.abzug__notweg:disabled {
    text-decoration: none;
    cursor: default;
}

/* Das Schlüsselfeld lokal: Feld, dann Speichern und Entfernen in einer Reihe; schmal bricht die Reihe um. */
.abzug__schluessel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.abzug__feld {
    flex: 1 1 14rem;
    min-width: 0;
}

/* Der frisch angelegte Schlüssel: der Satz, das Kopierfeld und der Knopf, der die Anzeige schließt. */
.abzug__neu {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    min-width: 0;
}

.abzug__neu > :nth-child(2) {
    align-self: stretch;
}

.abzug__probleme {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Der Balken wie auf der Statusseite (`job-row.vue`): grob, aus dem Schritt; er zeigt, dass etwas passiert und wie weit. */
.abzug__balken {
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.abzug__balken-fuellung {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .abzug__balken-fuellung {
        transition: none;
    }
}

.abzug--telefon .abzug__zeile {
    grid-template-columns: minmax(0, 1fr);
}

.abzug--telefon .abzug__knopf {
    grid-row: 4;
    grid-column: 1;
    justify-self: stretch;
    margin-top: var(--space-4);
}

.abzug--telefon .abzug__waehlen {
    justify-content: center;
}

/* Auf dem Telefon trifft der Daumen die Zeile des Links, nicht nur die Schrift. */
.abzug--telefon .abzug__notweg {
    min-height: var(--space-24);
}
</style>
