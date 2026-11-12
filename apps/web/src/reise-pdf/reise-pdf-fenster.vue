<script setup lang="ts">
import { computed, inject, onBeforeUnmount, reactive, ref, shallowRef, useTemplateRef, watch } from "vue";
import type { RouteResponse, RouteUnterwegsEintrag } from "@avesmaps3d/shared";
import { phoneViewport } from "../controls/phone-viewport";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { showAktionToast, showToast } from "../feedback/toast";
import { formatNumber, inSprache, ladeTafel, locale, t, tPlural } from "../i18n/i18n";
import { kartenserie } from "../map/kartenserien-stand";
import { startansicht } from "../map/start-view";
import { PLANNER_PARAMS } from "../route-planner/planner-link";
import type { PlannerOptions } from "../route-planner/planner-model";
import type { LandscapeLines } from "../route-planner/route-landscapes";
import { nennungText } from "../screenshot/nennung";
import { ladeBilder } from "./bilder";
import { bildGrund, kartenFeld, PDF_BILDER, reiseDokument } from "./dokument";
import {
    ansichtFuer,
    dateiName,
    inhaltZaehler,
    startSprache,
    startWahl,
    vorgaben,
    wahlAus,
    wirksamerInhalt,
    type KartenWahl,
    type ReisePdfEinstellungen,
} from "./einstellungen";
import { erzeugePdf, ladePdfWerkzeug, PDF_SCHRIFT, seitenZahl, speicherePdf, type PdfWerkzeug } from "./erzeugen";
import { ausschnittBild, nimmAuf, type Aufnahme } from "./kartenbild-aufnahme";
import { REISE_PDF_KARTE } from "./karte-zugang";
import { pdfWorte, planerLink, reiseDaten, verfuegbar, type ReiseEingabe } from "./reise-daten";
import ReisePdfFormular from "./reise-pdf-formular.vue";
import ReisePdfFuss from "./reise-pdf-fuss.vue";
import ReisePdfVorschau from "./reise-pdf-vorschau.vue";

/**
 * „Reise als PDF“ (WI-0306; Entwurf Fassung 6, Vali 2026-11-10: „perfekt das bauen, pdfmake 👍“): ein Werkzeugfenster der Hülle (§12.6), mittig,
 * am Telefon ein Blatt von unten mit den Reitern „Einstellungen | Vorschau“. Links die Einstellungen (`reise-pdf-formular.vue`), rechts die
 * Vorschau des echten PDFs (`reise-pdf-vorschau.vue`), im Fuß Seiten, Format und Größe, „Abbrechen“ und „PDF erstellen“.
 *
 * - **Daten:** nur, was der Planer schon hat (Route, Landschaften und Gebiete, Vorkommen unterwegs); aufbereitet in `reise-daten.ts`, in der
 *   Sprache des PDFs (`inSprache`), gesetzt in `dokument.ts`, erzeugt mit pdfmake (`erzeugen.ts`). pdfmake, pdf.js und die Schrift laden erst,
 *   wenn das Fenster aufgeht.
 * - **Kartenbild:** `kartenbild-aufnahme.ts` nimmt es auf (Route einpassen, Serie oder Ansicht vorübergehend umschalten, zurück); je Modus
 *   und Wahl einmal, solange das Fenster offen ist. Geschnitten wird im Verhältnis des Felds auf dem Deckblatt.
 * - **Vorschau:** nach jeder Änderung neu, entprellt; „PDF erstellen“ speichert genau das PDF der Vorschau, oder erzeugt es neu, wenn sich
 *   seitdem etwas geändert hat. Danach schließt das Fenster, und der Toast nennt die Datei mit „Noch einmal“.
 * - Titel und Dateiname stehen in der Sprache der Seite vor; bleiben sie unberührt, nimmt das PDF sie in seiner eigenen Sprache.
 * - **Die Vorgaben** kommen aus den Standardwerten der Systemsteuerung (Panel „PDF Exporter“, `startansicht()`), Titel, Sprache, Datei und
 *   Karte für jede neue Reise neu. Was jemand wählt, bleibt bis zum Neuladen der Seite.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    route: RouteResponse;
    options: PlannerOptions;
    pointNames: ReadonlyMap<string, string>;
    landscapes: LandscapeLines | null;
    unterwegs: readonly RouteUnterwegsEintrag[] | null;
    customAirName?: string | undefined;
}>();

const zugang = inject(REISE_PDF_KARTE, undefined);
const serien = computed(() => zugang?.serien() ?? []);
const vorgabeSerie = (): string => zugang?.vorgabeSerie() ?? serien.value[0]?.id ?? "";

const eingabe = computed((): ReiseEingabe => ({
    route: props.route,
    options: props.options,
    pointNames: props.pointNames,
    customAirName: props.customAirName,
    landscapes: props.landscapes,
    unterwegs: props.unterwegs,
    dateiVorlage: startansicht().pdfDateiname,
}));
/** Die Daten in der Sprache der Seite: Vorgaben für Titel und Datei, und was die Reise trägt. */
const daten = computed(() => reiseDaten(eingabe.value));
const traegt = computed(() => verfuegbar(daten.value));

const e = reactive<ReisePdfEinstellungen>(vorgaben(startansicht(), "", locale.value, "", "serie:"));
const zaehler = computed(() => inhaltZaehler(e.inhalt, traegt.value));
/** Was gerade auf der Karte ist (der goldene Punkt), gelesen beim Öffnen. */
const jetzt = ref<KartenWahl | undefined>(undefined);
let fuerRoute: RouteResponse | undefined;
let titelVorgabe = "";
let dateiVorgabe = "";

function richteEin(): void {
    const ansicht = zugang?.ansicht();
    jetzt.value = ansicht === undefined ? undefined : wahlAus(ansicht, serien.value);
    if (fuerRoute === props.route) return;
    fuerRoute = props.route;
    titelVorgabe = daten.value.titel;
    dateiVorgabe = daten.value.datei;
    e.titel = titelVorgabe;
    e.datei = dateiVorgabe;
    e.notiz = "";
    const werte = startansicht();
    e.sprache = startSprache(werte.pdfSprache, locale.value);
    e.wahl = startWahl(
        werte.pdfKarte,
        jetzt.value,
        ansicht?.series ?? vorgabeSerie(),
        serien.value,
        zugang?.politischBereit() ?? false,
    );
    if (zugang === undefined) e.karte = "ohne";
}

// --- Das Kartenbild ------------------------------------------------------------------------------------------------------------

const aufnahmen = new Map<string, Aufnahme>();
const aufnahme = shallowRef<Aufnahme | undefined>(undefined);
const nimmtAuf = ref(false);
const aufnahmeFehler = ref(false);
let aufnahmeLauf = 0;

async function sorgeFuerAufnahme(): Promise<void> {
    const modus = e.karte;
    if (!offen.value || modus === "ohne" || zugang === undefined) return;
    const schluessel = `${modus}|${e.wahl}`;
    const bekannt = aufnahmen.get(schluessel);
    if (bekannt !== undefined) {
        aufnahme.value = bekannt;
        aufnahmeFehler.value = false;
        return;
    }
    const eigener = ++aufnahmeLauf;
    nimmtAuf.value = true;
    aufnahmeFehler.value = false;
    try {
        const neu = await nimmAuf(zugang, props.route, modus, e.wahl);
        aufnahmen.set(schluessel, neu);
        if (eigener === aufnahmeLauf && offen.value) aufnahme.value = neu;
    } catch (fehler) {
        console.warn("Reise als PDF: Kartenbild nicht aufgenommen.", fehler);
        if (eigener === aufnahmeLauf) {
            aufnahme.value = undefined;
            aufnahmeFehler.value = true;
        }
    } finally {
        if (eigener === aufnahmeLauf) nimmtAuf.value = false;
    }
}

/** Das Verhältnis des Kartenfelds auf dem Deckblatt (mit zwei Titelzeilen gerechnet; das PDF deckt die Abweichung). */
const feldVerhaeltnis = computed(() => {
    const feld = kartenFeld(e.format, e.lage, 2, e.notiz.trim() !== "");
    return feld.breite / feld.hoehe;
});
/** Das Kartenbild als JPEG im Verhältnis des Felds; fehlt ohne Bild oder ohne Aufnahme. */
const kartenJpeg = computed(() => {
    const roh = aufnahme.value;
    if (roh === undefined || e.karte === "ohne" || !aufnahmen.has(`${e.karte}|${e.wahl}`)) return undefined;
    return ausschnittBild(roh, e.karte, feldVerhaeltnis.value);
});

// --- Das PDF -------------------------------------------------------------------------------------------------------------------

const werkzeug = shallowRef<PdfWerkzeug | undefined>(undefined);
const bilder = shallowRef<Record<string, string>>({});
const pdf = shallowRef<{ blob: Blob; lauf: number; stand: string; seiten: number } | undefined>(undefined);
const laeuft = ref(false);
const vorschauFehler = ref(false);
const erstellt = ref(false);
let pdfLauf = 0;
let uhr: ReturnType<typeof setTimeout> | undefined;
/** Die Pause nach der letzten Änderung, bevor die Vorschau neu entsteht. */
const ENTPRELLEN_MS = 350;

/** Jedes neue Kartenbild zählt eins weiter. */
const bildStand = ref(0);
watch(kartenJpeg, () => (bildStand.value += 1));
/** Was das PDF bestimmt: die Einstellungen und das Kartenbild. Steht es still, ist die Vorschau das fertige PDF. */
const stand = computed(() => `${JSON.stringify(e)}|${String(bildStand.value)}`);

/** Die Nennung im Bild gilt der Serie, die auf dem Bild ist. */
function serieImBild(): string {
    if (zugang === undefined) return vorgabeSerie();
    return ansichtFuer(e.wahl, zugang.ansicht(), serien.value, vorgabeSerie()).series;
}

async function baue(): Promise<{ blob: Blob; stand: string; seiten: number } | undefined> {
    const w = werkzeug.value;
    if (w === undefined) return undefined;
    const fuerStand = stand.value;
    const sprache = e.sprache;
    if (sprache !== "de") await ladeTafel(sprache).catch(() => undefined);
    const { pdfDaten, worte } = inSprache(sprache, () => ({ pdfDaten: reiseDaten(eingabe.value), worte: pdfWorte() }));
    const einstellungen = { ...e, titel: e.titel === titelVorgabe ? pdfDaten.titel : e.titel };
    const serie = kartenserie(serieImBild());
    const deutsch = sprache === "de";
    const karte = kartenJpeg.value;
    const dokument = reiseDokument({
        daten: pdfDaten,
        worte,
        einstellungen,
        inhalt: wirksamerInhalt(e.inhalt, verfuegbar(pdfDaten)),
        link: planerLink(globalThis.location, PLANNER_PARAMS),
        nennung: nennungText(serie, deutsch),
        kartenNennung: (deutsch ? serie.attribution : serie.en.attribution).trim(),
        bilder: karte === undefined ? bilder.value : { ...bilder.value, karte },
        saeubern: w.saeubern,
        schrift: PDF_SCHRIFT,
        sprache,
    });
    const blob = await erzeugePdf(w, dokument);
    return { blob, stand: fuerStand, seiten: await seitenZahl(blob) };
}

async function vorschau(): Promise<void> {
    const eigener = ++pdfLauf;
    laeuft.value = true;
    vorschauFehler.value = false;
    try {
        const neu = await baue();
        if (eigener === pdfLauf && neu !== undefined && offen.value) pdf.value = { ...neu, lauf: eigener };
    } catch (fehler) {
        console.warn("Reise als PDF: Vorschau nicht erzeugt.", fehler);
        if (eigener === pdfLauf) vorschauFehler.value = true;
    } finally {
        if (eigener === pdfLauf) laeuft.value = false;
    }
}

function planeVorschau(ms = ENTPRELLEN_MS): void {
    clearTimeout(uhr);
    if (!offen.value || werkzeug.value === undefined) return;
    uhr = setTimeout(() => void vorschau(), ms);
}

async function starte(): Promise<void> {
    void sorgeFuerAufnahme();
    try {
        const [w, b] = await Promise.all([ladePdfWerkzeug(), ladeBilder(PDF_BILDER, bildGrund(e.papier))]);
        werkzeug.value = w;
        bilder.value = b;
        planeVorschau(0);
    } catch (fehler) {
        console.warn("Reise als PDF: pdfmake nicht geladen.", fehler);
        vorschauFehler.value = true;
    }
}

function raeume(): void {
    clearTimeout(uhr);
    pdfLauf += 1;
    aufnahmeLauf += 1;
    aufnahmen.clear();
    aufnahme.value = undefined;
    nimmtAuf.value = false;
    laeuft.value = false;
    pdf.value = undefined;
}

watch(
    offen,
    (auf) => {
        if (auf) {
            richteEin();
            void starte();
        } else raeume();
    },
    { immediate: true },
);
watch(
    () => [e.karte, e.wahl] as const,
    () => void sorgeFuerAufnahme(),
);
watch(stand, () => planeVorschau());
// Die Zeichen liegen auf dem Grund des Papiers (`bilder.ts`): Ein anderes Papier braucht sie auf seinem Grund, danach eine neue Vorschau.
watch(
    () => e.papier,
    async (papier) => {
        if (werkzeug.value === undefined) return;
        bilder.value = await ladeBilder(PDF_BILDER, bildGrund(papier));
        planeVorschau();
    },
);
onBeforeUnmount(() => clearTimeout(uhr));

/** „5 Seiten · DIN A4 hoch · etwa 1,2 MB“ für das PDF, das gerade steht. */
const info = computed(() => {
    const steht = pdf.value;
    if (steht === undefined) return "";
    const mb = steht.blob.size / (1024 * 1024);
    return t("reisePdf.fuss.info", {
        seiten: tPlural("reisePdf.seiten", steht.seiten, { n: formatNumber(steht.seiten, 0) }),
        format: t(`reisePdf.format.kurz.${e.format}`),
        lage: t(`reisePdf.fuss.lage.${e.lage}`),
        groesse:
            mb >= 1
                ? t("reisePdf.fuss.mb", { n: formatNumber(mb, 1) })
                : t("reisePdf.fuss.kb", { n: formatNumber(Math.max(1, Math.round(steht.blob.size / 1024)), 0) }),
    });
});

async function erstellen(): Promise<void> {
    if (erstellt.value) return;
    erstellt.value = true;
    try {
        let fertig = pdf.value;
        if (fertig === undefined || fertig.stand !== stand.value || laeuft.value) {
            clearTimeout(uhr);
            const neu = await baue();
            if (neu === undefined) throw new Error("pdfmake fehlt");
            fertig = { ...neu, lauf: ++pdfLauf };
            pdf.value = fertig;
        }
        const name = `${dateiName(e.datei === dateiVorgabe ? inSprache(e.sprache, () => reiseDaten(eingabe.value).datei) : e.datei, t("reisePdf.datei.leer"))}.pdf`;
        speicherePdf(fertig.blob, name);
        const seiten = fertig.seiten;
        offen.value = false;
        showAktionToast(
            t("reisePdf.fertig", {
                datei: name,
                seiten: tPlural("reisePdf.seiten", seiten, { n: formatNumber(seiten, 0) }),
            }),
            {
                bild: { url: "/icons/route/federundpapier.webp", alt: "" },
                aktionen: [{ text: t("reisePdf.nochmal"), tun: () => (offen.value = true), haupt: true }],
            },
            "success",
        );
    } catch (fehler) {
        console.warn("Reise als PDF: nicht erstellt.", fehler);
        showToast(t("reisePdf.fehler"), "warning");
    } finally {
        erstellt.value = false;
    }
}

// --- Telefon: zwei Reiter --------------------------------------------------------------------------------------------------------

type Reiter = "einstellungen" | "vorschau";
const reiter = ref<Reiter>("einstellungen");
const reiterListe = computed(() => [
    { id: "einstellungen" as const, name: t("reisePdf.reiter.einstellungen") },
    { id: "vorschau" as const, name: t("reisePdf.reiter.vorschau") },
]);
const vorschauTeil = useTemplateRef<InstanceType<typeof ReisePdfVorschau>>("vorschauTeil");
watch(reiter, (jetztReiter) => {
    if (jetztReiter === "vorschau") vorschauTeil.value?.zeichneNeu();
});
const tafel = (id: Reiter): Record<string, string> =>
    phoneViewport.value
        ? { id: `reise-pdf-inhalt-${id}`, role: "tabpanel", "aria-labelledby": `reise-pdf-reiter-${id}` }
        : {};
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="wege"
        rumpf="spalten"
        telefon-unten
        :titel="t('reisePdf.titel')"
        testid="reise-pdf-fenster"
    >
        <template v-if="phoneViewport" #reiter>
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('reisePdf.reiter.beschriftung')"
                kennung="reise-pdf"
                verteilt
            />
        </template>

        <div
            v-show="!phoneViewport || reiter === 'einstellungen'"
            class="rp-spalte"
            :class="{ 'rp-spalte--telefon': phoneViewport }"
            v-bind="tafel('einstellungen')"
        >
            <ReisePdfFormular
                :einstellungen="e"
                :serien="serien"
                :jetzt="jetzt"
                :verfuegbar="traegt"
                :zaehler="zaehler"
                :karten-vorschau="kartenJpeg"
                :nimmt-auf="nimmtAuf"
                :aufnahme-fehler="aufnahmeFehler"
                :ohne-karte="zugang === undefined"
                :politisch-bereit="zugang?.politischBereit() ?? false"
                :telefon="phoneViewport"
            />
        </div>
        <ReisePdfVorschau
            v-show="!phoneViewport || reiter === 'vorschau'"
            ref="vorschauTeil"
            class="rp-vorschau"
            v-bind="tafel('vorschau')"
            :pdf="pdf"
            :laeuft="laeuft"
            :fehler="vorschauFehler"
            :telefon="phoneViewport"
        />

        <template #fuss>
            <ReisePdfFuss
                :info="info"
                :erstellt="erstellt"
                :telefon="phoneViewport"
                @abbrechen="offen = false"
                @erstellen="void erstellen()"
            />
        </template>
    </AvmFenster>
</template>

<style scoped>
/* Links die Einstellungen in der Breite des Inspektors, sie rollen für sich; rechts die Vorschau mit dem Rest. */
.rp-spalte {
    flex: 0 0 var(--avm-fenster-inspektor);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--color-divider);
    scrollbar-width: thin;
}

.rp-spalte--telefon {
    flex: 1 1 auto;
    border-right: 0;
}

.rp-vorschau {
    flex: 1 1 auto;
}
</style>
