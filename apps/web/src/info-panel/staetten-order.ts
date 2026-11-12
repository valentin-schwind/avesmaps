import { ref } from "vue";
import type { StaettenOrder } from "./staetten-model";

/**
 * Die gewählte Ordnung der Stätten (WI-0122 Nachtrag) - EINE für die ganze Sitzung: Wer an Elenvina „nach Häufigkeit“ wählt,
 * findet Gareth danach ebenso geordnet. Sie lebt im Speicher der Seite und nicht im Browser, weil der Auftrag nur die Sitzung
 * verlangt („keine Speicherung über die Sitzung hinaus nötig“); ein Neuladen beginnt wieder alphabetisch.
 */
export const staettenOrder = ref<StaettenOrder>("alpha");
