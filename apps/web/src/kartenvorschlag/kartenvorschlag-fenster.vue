<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch } from "vue";
import { neuesFormular } from "../community/api";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { showToast } from "../feedback/toast";
import type { MessageKey } from "../i18n/de";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import {
    frischerSchutz,
    nachKopieren,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type WeiterArt,
} from "../photobox/fertig-schutz";
import LinkKasten from "../photobox/link-kasten.vue";
import { useLinkKopieren } from "../photobox/link-kopieren";
import ReisebildFertigFuss from "../photobox/reisebild-fertig-fuss.vue";
import ReisebildFormularFuss from "../photobox/reisebild-formular-fuss.vue";
import ReisebildZeichen from "../photobox/reisebild-zeichen.vue";
import { kartenvorschlagGrund } from "./ablehnung";
import { FEHLER_SATZ, fehlerArt, ladeStand, sendeDatei, sendeEinreichung, sperreBis, vorschlagAdresse } from "./api";
import KarteFormular from "./karte-formular.vue";
import KarteStatus from "./karte-status.vue";
import { kartenvorschlagBesucher, type KartenvorschlagAnzeige } from "./kartenvorschlag-besucher";
import { drahtBody, fehlendes, leererEntwurf } from "./modell";

/**
 * Das Fenster „Karte vorschlagen“ (WI-0275 Stufe C; Gestaltung: Mockup Fassung 4, vom Betreiber auf dem Stand der Reisebilder gewünscht: „näher am Photobox-Upload“). Ein MODALES Fenster der Hülle (`AvmFenster`,
 * §12.6, Breite `entscheiden`, Kopf mit Unterzeile) über der Karte beziehungsweise über der Kartensammlung, aus der es geöffnet wurde. Dieses Bauteil hält den Zustand (Entwurf, Absenden in zwei Schritten,
 * Bestätigung) und den Fuß; der Rumpf des Formulars steht in `karte-formular.vue`, die Statusseite in `karte-status.vue`, was gerechnet wird in `modell.ts`, die Aufrufe in `api.ts`.
 *
 * - **Wiederverwendet aus den Reisebildern:** der Linkkasten (`link-kasten.vue`), der Fuß des Formulars (`reisebild-formular-fuss.vue`), der Fuß der Bestätigung (`reisebild-fertig-fuss.vue`), der Schutz vor Verlust
 *   des Links (`fertig-schutz.ts`), das Kopieren (`link-kopieren.ts`) und die Stile (`formular-stil.css`).
 * - 🔴 **„Vorschlag senden“ ist gesperrt, solange etwas fehlt, aber drückbar** (`aria-disabled`): Ein Druck zeigt den Grund im Fuß, markiert das fehlende Feld, rollt es in Sicht und setzt den Fokus hinein.
 * - 🔴 **Der Weg einer Datei hat zwei Schritte** (`api.ts`): erst die Angaben, dann die Bytes. Scheitert der zweite, steht die Bestätigung trotzdem da (die Angaben sind angekommen, der Link gilt) und nennt
 *   „Die Datei ist noch nicht angekommen“ mit „Datei erneut senden“; die gewählte Datei bleibt dafür im Speicher des Fensters.
 * - **Netz weg:** Der Text bleibt, erneutes Senden trägt dieselbe Kennung und denselben Schlüssel und legt nie einen zweiten Vorschlag an (ADR-0019). **Grenze erreicht (429):** der Satz mit der Uhrzeit.
 *   **Schalter aus (503) oder `stand.einreichen` falsch:** „Kartenvorschläge sind gerade nicht möglich“ statt eines toten Knopfs.
 * - **Honigtopf und Zeitfalle** (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht, und die Zeit seit dem Öffnen; beides geht mit.
 * - **Nach dem Einreichen:** „Eingereicht.“, die Nummer, der persönliche Link `/kartenvorschlag#…` im Kasten zum Kopieren, „Stand ansehen“ und „Noch eine Karte von hier“. 🔴 **Schutz vor Verlust:** ✕, Esc,
 *   „Schließen“ und „Noch eine Karte von hier“ halten ohne kopierten Link einmal an; der zweite Versuch geht durch. „Auf diesem Gerät merken“ gibt es hier nicht.
 */
const props = defineProps<{ anzeige: KartenvorschlagAnzeige }>();

const kennung = ref(neuesFormular());
const geoeffnet = ref(performance.now());
const entwurf = reactive(leererEntwurf());
const formular = useTemplateRef<InstanceType<typeof KarteFormular>>("formular");
const fertigKasten = useTemplateRef<InstanceType<typeof LinkKasten>>("fertigKasten");
/** `undefined`: noch nicht gefragt; das Formular steht trotzdem sofort da. */
const moeglich = ref<boolean | undefined>(undefined);
const sendet = ref(false);
/** Ein Satz zu einem Fehler: entweder ein Schlüssel der Tafel (mit Platzhaltern) oder der genaue Grund des Servers, schon in der Sprache der Oberfläche (WI-0291). */
type Problem = { key: MessageKey; params?: Record<string, string> } | { satz: string };
const problem = ref<Problem | undefined>(undefined);
/** Die Antwort des Servers auf das Einreichen: die Nummer und ob die Datei noch fehlt; sonst `undefined` (das Formular steht). */
const eingegangen = ref<{ nummer: string } | undefined>(undefined);
/** Die Datei der Bestätigung: unterwegs, gescheitert (mit erneutem Senden) oder angekommen. */
const dateiStand = ref<"sendet" | "fehler" | "da" | undefined>(undefined);
const dateiProblem = ref<Problem | undefined>(undefined);
const versucht = ref(false);
const datenschutzOffen = ref(false);
/** Zeigt das Fenster die Statusseite (Link oder „Stand ansehen“) statt des Formulars? */
const statusSchluessel = ref<string | null | undefined>(
    props.anzeige.art === "status" ? props.anzeige.schluessel : undefined,
);
const imStatus = computed(() => statusSchluessel.value !== undefined);
const schutz = ref(frischerSchutz());
const offen = ref(true);

const ort = computed(() => (props.anzeige.art === "formular" ? props.anzeige.ort : undefined));
const eingereicht = computed(() => eingegangen.value !== undefined);
const linkAdresse = computed(() => vorschlagAdresse(globalThis.location.origin, kennung.value.schluessel));
const linkKopie = useLinkKopieren({
    link: () => linkAdresse.value,
    erfolg: () => {
        schutz.value = nachKopieren();
    },
    misserfolg: () => fertigKasten.value?.markiereLink(),
});

onMounted(() => {
    if (!imStatus.value) {
        void ladeStand().then((geht) => {
            moeglich.value = geht;
        });
        void nextTick(() => formular.value?.fokussiereAnfang());
    }
});
// Ein zweites Öffnen bei offenem Fenster beginnt ein frisches Formular beziehungsweise die andere Seite.
watch(
    () => props.anzeige.nr,
    () => {
        if (props.anzeige.art === "status") {
            statusSchluessel.value = props.anzeige.schluessel;
            return;
        }
        beginneNeu();
    },
);

function beginneNeu(): void {
    statusSchluessel.value = undefined;
    Object.assign(entwurf, leererEntwurf());
    kennung.value = neuesFormular();
    geoeffnet.value = performance.now();
    eingegangen.value = undefined;
    dateiStand.value = undefined;
    dateiProblem.value = undefined;
    problem.value = undefined;
    versucht.value = false;
    datenschutzOffen.value = false;
    schutz.value = frischerSchutz();
    void nextTick(() => formular.value?.fokussiereAnfang());
}

// --- Absenden ------------------------------------------------------------------------------------------------------------------

const fehlt = computed(() => fehlendes(entwurf));
/** Der Satz, warum es nicht geht: erst nach einem Druck auf den gesperrten Knopf, dann live, bis alles da ist. */
const grund = computed(() =>
    versucht.value && fehlt.value !== undefined ? t(fehlt.value.grund, fehlt.value.params) : undefined,
);
const problemText = (p: Problem): string => ("satz" in p ? p.satz : t(p.key, p.params));
const problemSatz = computed(() => (problem.value === undefined ? undefined : problemText(problem.value)));
const dateiProblemSatz = computed(() =>
    dateiProblem.value === undefined ? undefined : problemText(dateiProblem.value),
);
const formularOffen = computed(() => !imStatus.value && !eingereicht.value && moeglich.value !== false);
const warnt = computed(() => eingereicht.value && warnungSteht(schutz.value));
const datenschutzText = computed(() =>
    t(entwurf.weg === "link" ? "kartenvorschlag.datenschutz.link" : "kartenvorschlag.datenschutz.datei"),
);

function fehlerSatz(fehler: unknown): Problem {
    const art = fehlerArt(fehler);
    // WI-0291: Wo der Server einen Grund schickt (422, 400, 413, 415, 409 `…_transition`), steht er da statt des Sammelsatzes „Die Angaben wurden nicht angenommen“.
    if (art === "ungueltig" || art === "format" || art === "uebergang") {
        const satz = kartenvorschlagGrund(fehler);
        if (satz !== undefined) return { satz };
    }
    const bis = sperreBis(fehler, new Date());
    return {
        key: FEHLER_SATZ[art],
        ...(bis === undefined ? {} : { params: { uhr: relativeTime(bis, new Date(), locale.value, "zeitpunkt") } }),
    };
}

/** Der Druck auf „Vorschlag senden“: Fehlt etwas, nennt der Fuß den Grund, und das Feld wird markiert und fokussiert; sonst gehen die Angaben hinaus. */
function sendenGedrueckt(): void {
    if (sendet.value) return;
    const fehlendesFeld = fehlt.value;
    if (fehlendesFeld === undefined) {
        void einreichen();
        return;
    }
    versucht.value = true;
    formular.value?.fokussiere(fehlendesFeld.feld);
}

async function einreichen(): Promise<void> {
    sendet.value = true;
    problem.value = undefined;
    try {
        const antwort = await sendeEinreichung(
            drahtBody(kennung.value, entwurf, ort.value?.id, performance.now() - geoeffnet.value),
        );
        eingegangen.value = { nummer: antwort.nummer };
        if (antwort.dateiNoetig && entwurf.datei !== undefined) await schickeDatei();
    } catch (fehler) {
        problem.value = fehlerSatz(fehler);
    } finally {
        sendet.value = false;
    }
}

/** Der zweite Schritt: die Bytes. Scheitert er, bleibt die Bestätigung stehen und bietet das erneute Senden an. */
async function schickeDatei(): Promise<void> {
    if (entwurf.datei === undefined) return;
    dateiStand.value = "sendet";
    dateiProblem.value = undefined;
    try {
        await sendeDatei(kennung.value.schluessel, entwurf.datei);
        dateiStand.value = "da";
    } catch (fehler) {
        dateiStand.value = "fehler";
        dateiProblem.value = fehlerSatz(fehler);
    }
}

// --- Bestätigung und Schutz vor Verlust ----------------------------------------------------------------------------------------

watch(eingereicht, (steht) => {
    if (steht) void nextTick(() => fertigKasten.value?.fokussiereKopieren());
});

/** Ein Weg, der den Link aus dem Blick nimmt (✕, Esc, „Schließen“, „Noch eine Karte von hier“, „Stand ansehen“): `true`, wenn es weitergeht; `false`, wenn der erste Versuch anhält. */
function weiter(art: WeiterArt): boolean {
    if (!eingereicht.value || imStatus.value) return true;
    const ergebnis = pruefeWeiter(schutz.value, art);
    schutz.value = ergebnis.schutz;
    if (ergebnis.halt) void nextTick(() => fertigKasten.value?.zeigeLink());
    return !ergebnis.halt;
}

function schliesse(): void {
    kartenvorschlagBesucher.schliesse();
}

/** ✕ und Esc setzen `offen` an der Hülle: Das Fenster hängt an diesem Modell, dessen Setzer erst prüft, ob der Link verloren ginge. */
const huellenOffen = computed({
    get: () => offen.value,
    set: (auf: boolean) => {
        if (!auf && !weiter("zu")) return;
        offen.value = auf;
        if (!auf) schliesse();
    },
});

function fuehreAus(art: WeiterArt | undefined): void {
    if (art === "noch-eins") beginneNeu();
    else if (art === "stand") statusSchluessel.value = kennung.value.schluessel;
    else schliesse();
}
const schliessenGedrueckt = (): void => {
    if (weiter("zu")) schliesse();
};
const nochEinsGedrueckt = (): void => {
    if (weiter("noch-eins")) beginneNeu();
};
const standGedrueckt = (): void => {
    if (weiter("stand")) statusSchluessel.value = kennung.value.schluessel;
};
/** „Kopieren“ in der Warnung: kopieren, melden und dann tun, was gewollt war. Ging das Kopieren nicht, bleibt das Fenster stehen. */
async function warnKopieren(): Promise<void> {
    const art = schutz.value.gewarnt;
    if (!(await linkKopie.kopiere())) return;
    showToast(t("ui.copy.done"));
    fuehreAus(art);
}
/** „Trotzdem schließen“ beziehungsweise „Trotzdem weiter“: der zweite Versuch, jetzt ohne Halt. */
const trotzdem = (): void => fuehreAus(schutz.value.gewarnt);

onBeforeUnmount(() => {
    offen.value = false;
});

const titel = computed(() =>
    imStatus.value
        ? t("kartenvorschlag.status.titel")
        : eingereicht.value
          ? t("kartenvorschlag.fertig.titel")
          : t("kartenvorschlag.titel"),
);
const unterzeile = computed(() => {
    if (imStatus.value || moeglich.value === false) return undefined;
    if (eingereicht.value) return t("kartenvorschlag.fertig.unterzeile");
    const o = ort.value;
    if (o === undefined || o.name === "") return t("kartenvorschlag.unterzeile.ohne");
    return t(o.hatKarten ? "kartenvorschlag.unterzeile.mit" : "kartenvorschlag.unterzeile.erste", { ort: o.name });
});
</script>

<template>
    <AvmFenster
        v-model:offen="huellenOffen"
        bauart="werkzeug"
        breite="entscheiden"
        :titel="titel"
        :unterzeile="unterzeile"
        testid="kartenvorschlag-fenster"
    >
        <!-- Die Statusseite: der Link `/kartenvorschlag#…` oder „Stand ansehen“. -->
        <KarteStatus v-if="imStatus" :schluessel="statusSchluessel ?? null" />

        <!-- Eingereicht: die Bestätigung mit dem persönlichen Link im selben Fenster. -->
        <div v-else-if="eingereicht" class="kv-fertig" data-testid="kartenvorschlag-fertig">
            <p class="kv-fertig__zeile" role="status">
                <ReisebildZeichen name="haken" />{{ t("photobox.fertig.eingereicht") }}
                <span class="kv-fertig__nummer" data-testid="kartenvorschlag-nummer">{{
                    t("kartenvorschlag.fertig.nummer", { nummer: eingegangen?.nummer ?? "" })
                }}</span>
            </p>
            <p class="kv-fertig__satz">{{ t("kartenvorschlag.fertig.sichtbar") }}</p>
            <AvmHinweis
                v-if="dateiStand === 'sendet'"
                ton="neutral"
                rolle="status"
                testid="kartenvorschlag-datei-sendet"
            >
                {{ t("kartenvorschlag.fertig.dateiSendet") }}
            </AvmHinweis>
            <AvmHinweis
                v-else-if="dateiStand === 'fehler'"
                ton="gefahr"
                rolle="alert"
                testid="kartenvorschlag-datei-offen"
            >
                <span class="kv-fertig__titel">{{ t("kartenvorschlag.fertig.dateiOffen") }}</span>
                <span
                    v-if="dateiProblemSatz !== undefined"
                    class="kv-fertig__satz"
                    data-testid="kartenvorschlag-datei-grund"
                    >{{ dateiProblemSatz }}</span
                >
                <AvmKnopf groesse="zeile" testid="kartenvorschlag-datei-nochmal" @click="schickeDatei">{{
                    t("kartenvorschlag.fertig.dateiNochmal")
                }}</AvmKnopf>
            </AvmHinweis>
            <LinkKasten
                ref="fertigKasten"
                testid="kartenvorschlag-fertig"
                :link="linkAdresse"
                :kopiert="linkKopie.anzeige.value"
                :warnt="warnt"
                :merken-moeglich="false"
                :gemerkt="false"
                :satz="t('kartenvorschlag.fertig.linkHinweis')"
                @kopieren="linkKopie.kopiere()"
            />
            <div class="kv-fertig__knoepfe">
                <AvmKnopf groesse="zeile" testid="kartenvorschlag-stand" @click="standGedrueckt">{{
                    t("photobox.fertig.stand")
                }}</AvmKnopf>
                <AvmKnopf groesse="zeile" testid="kartenvorschlag-noch-eins" @click="nochEinsGedrueckt">{{
                    t("kartenvorschlag.fertig.nochEins")
                }}</AvmKnopf>
            </div>
        </div>

        <!-- Geht gerade nicht: ein Satz statt eines toten Knopfs. -->
        <AvmHinweis v-else-if="moeglich === false" ton="warnung" rolle="status" testid="kartenvorschlag-nicht-moeglich">
            {{ t("kartenvorschlag.nichtMoeglich") }} {{ t("photobox.nichtMoeglich.spaeter") }}
        </AvmHinweis>

        <KarteFormular v-else ref="formular" :entwurf="entwurf" :fehlt="versucht ? fehlt?.feld : undefined" />

        <!-- „Vorschlag senden“ steht im Fuß, damit es auch in einem niedrigen Fenster im Bild bleibt (Guide §12.6, §13.19). -->
        <template v-if="formularOffen" #fuss>
            <ReisebildFormularFuss
                v-model:datenschutz-offen="datenschutzOffen"
                kennung="kartenvorschlag"
                :knopf="t('kartenvorschlag.senden')"
                :datenschutz-text="datenschutzText"
                :gesperrt="fehlt !== undefined"
                :sendet="sendet"
                :grund="grund"
                :problem="problemSatz"
                @hochladen="sendenGedrueckt"
            />
        </template>
        <template v-else-if="eingereicht && !imStatus" #fuss>
            <ReisebildFertigFuss
                :warnt="warnt"
                :trotzdem="trotzdemSchluessel(schutz)"
                :merken-moeglich="false"
                @schliessen="schliessenGedrueckt"
                @warn-kopieren="warnKopieren"
                @trotzdem="trotzdem"
            />
        </template>
    </AvmFenster>
</template>

<style scoped>
.kv-fertig {
    display: grid;
    gap: var(--space-10);
    min-width: 0;
    padding: var(--space-4) var(--space-2) var(--space-8);
}

.kv-fertig__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    color: var(--color-success);
    font-size: var(--font-size-subhead);
    line-height: var(--leading-snug);
}

.kv-fertig__zeile svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
}

.kv-fertig__nummer {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kv-fertig__satz {
    display: block;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.kv-fertig__titel {
    display: block;
    color: var(--color-text-strong);
}

.kv-fertig__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-6);
}
</style>
