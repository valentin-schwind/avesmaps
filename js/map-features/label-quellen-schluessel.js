// Die EINE Weiche: unter welchem Schluessel liegen die Quellen einer Beschriftung?
//
// Schritt 5 des Quellen-Umbaus (03.09.2026, Entwurf docs/superpowers/specs/2026-09-03-quellen-landschaften-design.md):
// die Flaeche traegt die Quellen, die Beschriftung zeigt sie. Eine an eine Landschaft gebundene Beschriftung
// (`properties.ecosystem_region_public_id`) liest `ecosystem:<region_public_id>`; eine freie liest wie bisher
// `region:<public_id>`. Nie beides.
//
// 🔴 Rein, kein DOM, kein Modulzustand -- und die einzige Stelle, die diese Frage beantwortet. Die Datenbox der
// Beschriftung, ihr Kanon-Etikett und der Beschriftungsdialog fragen hier; wer eine dritte Lesart baut, baut die
// Divergenz, die dieses Modul beseitigt. Gemessen 03.09.2026: 782 gebundene, 229 freie Beschriftungen.
// ⚠️ Nimmt das normalisierte Label (`ecosystemRegionPublicId`, `publicId` -- map-features-labels.js) UND die
// rohen Eigenschaften (`properties.ecosystem_region_public_id`, `properties.public_id`): beide Formen laufen
// durch dieselben Leser.

"use strict";

function avesmapsLabelQuellenSchluessel(label) {
	const l = label && typeof label === "object" ? label : {};
	const props = l.properties && typeof l.properties === "object" ? l.properties : {};
	const region = String(l.ecosystemRegionPublicId || props.ecosystem_region_public_id || "").trim();
	if (region !== "") {
		return { type: "ecosystem", id: region };
	}
	return { type: "region", id: String(l.publicId || props.public_id || "").trim() };
}

if (typeof window !== "undefined") {
	window.avesmapsLabelQuellenSchluessel = avesmapsLabelQuellenSchluessel;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsLabelQuellenSchluessel };
}
