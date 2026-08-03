/*
 * Reisekosten einer geplanten Route.
 *
 * Was hier NICHT passiert: eine Tagesleistung annehmen. Die Naechte kommen aus der „Gesamten
 * Reisezeit", die der Reiseplan ohnehin ausrechnet.
 *
 * 💣 DAS IST DIE ZENTRALE REGEL DIESER DATEI. Der Planer rechnet derzeit rund 70 Meilen am Tag
 * fuer eine berittene Gruppe, die Geographia Aventurica nennt auf S. 118 „kaum mehr als 40" --
 * die Korrektur ist ein eigener Vorgang (docs/reisemodell-ueberarbeitung-instruction.md). Solange
 * die Kosten die Naechte aus der Reisezeit LESEN statt sie selbst zu rechnen, wandern sie mit,
 * sobald der Fehler behoben ist, und niemand muss diese Datei anfassen.
 *
 * Quellenlage und die Deckungspruefung Posten fuer Posten: docs/reisekosten-quellenlage.md.
 */

// Schrittweite der Grenz-Abtastung in Karteneinheiten (1 Einheit = 3 Meilen -> 1,2 Meilen je Schritt).
const TRAVEL_COST_BORDER_SAMPLE_STEP = 0.4;
// 💣 Laeufe unter dieser Laenge sind KEIN Grenzuebertritt. Eine Strasse, die an einer Grenze hin- und
// herpendelt, erzeugt Dutzende Geometrieschnitte -- der Reisende zahlt einmal. Ohne diesen Filter
// meldete die Route Gareth->Fasar 39 Uebertritte statt 4.
const TRAVEL_COST_BORDER_MIN_RUN_MILES = 5;

// Die deutschen Vorgabetexte zu den DYNAMISCHEN i18n-Schluesseln.
// 💣 `tr(key, default)` faellt ohne diese Tabellen auf den Schluessel selbst zurueck -- im deutschen
// Panel staende dann „bett" statt „Bett im Gemeinschaftszimmer". Ein Schluessel, der zur Laufzeit
// zusammengesetzt wird, kann seinen Default nicht im Aufruf tragen.
const TRAVEL_COST_LODGING_LABEL_DE = {
	frei: "im Freien",
	strohsack: "Strohsack im Schlafsaal",
	bett: "Bett im Gemeinschaftszimmer",
	zimmer: "Einzelzimmer",
};
// Geographia S. 115: der Zoellner veranlagt nach der angenommenen Profession. Das Buch nennt die
// Stufen selbst -- 1 H Tageloehner, 5 H Schustergeselle, 1 D Soeldner, bis 5 D gutverdienende Berufe.
const TRAVEL_COST_TOLL_LABEL_DE = {
	frei: "als Tagelöhner veranlagt",
	strohsack: "als Schustergeselle veranlagt",
	bett: "als Söldner veranlagt",
	zimmer: "als gutverdienender Beruf veranlagt",
};

let travelCostSovereignPromise = null;

/**
 * Die souveraenen Herrschaftsgebiete mit Geometrie, einmal je Sitzung.
 *
 * ⚠️ zoom=0 ist ABSICHT und nicht die kleinere Zahl: die Antwort ist kleiner als bei zoom=6
 * (163 statt 962 Flaechen) und enthaelt trotzdem JEDES souveraene Gebiet -- gegen den Live-Bestand
 * geprueft, 72 gegen 58. Die tieferen Baender bringen nur Provinzen und Baronien, und die sind
 * keine Zollgrenzen (Geographia S. 115).
 *
 * Souveraen = ohne Elternteil. Das Feld `status` taugt dafuer NICHT: live stehen dort neben
 * „eigenstaendiger Staat" auch „abhaenige Provinz" (Tippfehler), „unabhaengiug" und 91 Leerwerte.
 */
function avesmapsTravelCostEnsureSovereignTerritories() {
	if (travelCostSovereignPromise) {
		return travelCostSovereignPromise;
	}
	if (typeof fetchPoliticalTerritories !== "function" || !POLITICAL_TERRITORIES_API_URL) {
		travelCostSovereignPromise = Promise.resolve([]);
		return travelCostSovereignPromise;
	}

	travelCostSovereignPromise = fetchPoliticalTerritories({ action: "layer", zoom: 0 })
		.then((payload) => {
			const features = Array.isArray(payload?.features) ? payload.features : [];
			return features
				.filter((feature) => !feature?.properties?.parent_public_id)
				.map((feature) => avesmapsTravelCostPrepareTerritory(feature))
				.filter(Boolean);
		})
		.catch((error) => {
			console.warn("Herrschaftsgebiete für die Zollrechnung nicht ladbar:", error);
			return [];
		});

	return travelCostSovereignPromise;
}

/** Flaechen in flache Ringlisten + Huellrechteck -- der Punkttest laeuft je Route ~500-mal. */
function avesmapsTravelCostPrepareTerritory(feature) {
	const geometry = feature?.geometry;
	const type = geometry?.type;
	if (type !== "Polygon" && type !== "MultiPolygon") {
		return null;
	}

	const polygons = type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
	const rings = [];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	polygons.forEach((polygon) => {
		if (!Array.isArray(polygon)) {
			return;
		}
		const prepared = [];
		polygon.forEach((ring, ringIndex) => {
			if (!Array.isArray(ring) || ring.length < 4) {
				return;
			}
			prepared.push(ring);
			if (ringIndex === 0) {
				ring.forEach((point) => {
					if (point[0] < minX) minX = point[0];
					if (point[0] > maxX) maxX = point[0];
					if (point[1] < minY) minY = point[1];
					if (point[1] > maxY) maxY = point[1];
				});
			}
		});
		if (prepared.length) {
			rings.push(prepared);
		}
	});

	if (!rings.length) {
		return null;
	}

	return {
		name: String(feature.properties?.name || ""),
		rings,
		bbox: [minX, minY, maxX, maxY],
	};
}

/** Strahlensatz-Punkttest, Loecher zaehlen als aussen. */
function avesmapsTravelCostRingContains(ring, x, y) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

function avesmapsTravelCostTerritoryContains(territory, x, y) {
	const [minX, minY, maxX, maxY] = territory.bbox;
	if (x < minX || x > maxX || y < minY || y > maxY) {
		return false;
	}
	return territory.rings.some((polygon) => {
		if (!avesmapsTravelCostRingContains(polygon[0], x, y)) {
			return false;
		}
		for (let i = 1; i < polygon.length; i += 1) {
			if (avesmapsTravelCostRingContains(polygon[i], x, y)) {
				return false; // im Loch
			}
		}
		return true;
	});
}

/**
 * Zahl der Staatsgrenz-Uebertritte entlang der Route.
 *
 * 💣 Gezaehlt werden LAUFLAENGEN, nicht Geometrieschnitte -- siehe die Konstante oben. Und
 * abgetastet wird JE ETAPPE: die Segment-Geometrie liegt in Speicherfolge vor, nicht in
 * Reisefolge, ein Aneinanderhaengen erzeugt Sprunglinien quer ueber die Karte.
 */
function avesmapsCountRouteStateBorders(segments, territories) {
	if (!Array.isArray(segments) || !segments.length || !Array.isArray(territories) || !territories.length) {
		return null;
	}

	const runs = [];
	segments.forEach((segment) => {
		const coordinates = segment?.geometry?.coordinates;
		if (!Array.isArray(coordinates) || coordinates.length < 2) {
			return;
		}
		for (let index = 0; index < coordinates.length - 1; index += 1) {
			const [x0, y0] = coordinates[index];
			const [x1, y1] = coordinates[index + 1];
			const span = Math.hypot(x1 - x0, y1 - y0);
			const steps = Math.max(1, Math.round(span / TRAVEL_COST_BORDER_SAMPLE_STEP));
			const stepMiles = (span / steps) * DISTANCE_SCALING_FACTOR;
			for (let step = 0; step < steps; step += 1) {
				const ratio = step / steps;
				const x = x0 + (x1 - x0) * ratio;
				const y = y0 + (y1 - y0) * ratio;
				const hit = territories.find((territory) => avesmapsTravelCostTerritoryContains(territory, x, y));
				const name = hit ? hit.name : "";
				if (runs.length && runs[runs.length - 1].name === name) {
					runs[runs.length - 1].miles += stepMiles;
				} else {
					runs.push({ name, miles: stepMiles });
				}
			}
		}
	});

	// Rauschlaeufe in den Vorlauf schlucken, danach gleiche Nachbarn erneut verschmelzen.
	const merged = [];
	runs.forEach((run) => {
		if (run.miles < TRAVEL_COST_BORDER_MIN_RUN_MILES && merged.length) {
			merged[merged.length - 1].miles += run.miles;
			return;
		}
		if (merged.length && merged[merged.length - 1].name === run.name) {
			merged[merged.length - 1].miles += run.miles;
			return;
		}
		merged.push({ ...run });
	});
	const collapsed = [];
	merged.forEach((run) => {
		if (collapsed.length && collapsed[collapsed.length - 1].name === run.name) {
			collapsed[collapsed.length - 1].miles += run.miles;
			return;
		}
		collapsed.push(run);
	});

	// Offene See traegt keinen Zoll: ein Wechsel VON oder ZU „kein Gebiet" ist kein Uebertritt.
	let crossings = 0;
	for (let index = 1; index < collapsed.length; index += 1) {
		if (collapsed[index].name && collapsed[index - 1].name) {
			crossings += 1;
		}
	}
	return crossings;
}

/** Reittiere der Gruppe: keine Eingabe, sondern eine Folge des Landtransportmittels. */
function avesmapsTravelCostMountCount(travellers) {
	const transport = typeof getTransportOption === "function" ? getTransportOption("Strasse") : "";
	const perTraveller = TRAVEL_COST_MOUNTS_PER_TRAVELLER[transport];
	return travellers * (Number.isFinite(perTraveller) ? perTraveller : 0);
}

/**
 * Wo endet welcher Reisetag, und bietet die Wegart dort ein Dach?
 * Liefert je Nacht "inn" | "aboard" | "open".
 */
function avesmapsTravelCostNightKinds(planEntries, nightCount, lodgingKey) {
	const boundaries = [];
	let elapsed = 0;
	const marks = [];
	for (let night = 1; night <= nightCount; night += 1) {
		marks.push(night * getPlannerTravelHoursPerDay());
	}
	let markIndex = 0;
	planEntries.forEach((entry) => {
		const until = elapsed + (Number(entry.travelTime) || 0);
		while (markIndex < marks.length && marks[markIndex] <= until) {
			boundaries.push(entry.type);
			markIndex += 1;
		}
		elapsed = until;
	});
	while (boundaries.length < nightCount) {
		boundaries.push(planEntries[planEntries.length - 1]?.type || "");
	}

	return boundaries.map((subtype) => {
		const shelter = TRAVEL_COST_SHELTER_BY_SUBTYPE[subtype] || null;
		if (shelter === "aboard") {
			return "aboard";
		}
		if (lodgingKey === "frei") {
			return "open";
		}
		return (shelter === "inn" || shelter === "maybe") ? "inn" : "open";
	});
}

/**
 * Die Kostenzeilen. `stateBorders` darf null sein -- dann steht die Zollzeile als „wird geladen"
 * da und wird nachgetragen, sobald die Herrschaftsgebiete da sind.
 */
function buildTravelCostRows(planEntries, summary, options = {}) {
	const lodgingKey = options.lodging || getPlannerLodging();
	const lodging = TRAVEL_COST_LODGING[lodgingKey] || TRAVEL_COST_LODGING.bett;
	const travellers = Number.isFinite(options.travellers) ? options.travellers : getPlannerTravellerCount();
	const mounts = avesmapsTravelCostMountCount(travellers);
	const totalHours = Number(summary?.totalHours) || 0;
	const nightCount = Math.max(0, Math.floor(totalHours / 24));
	const dayCount = Math.max(1, Math.ceil(totalHours / 24));
	const nightKinds = avesmapsTravelCostNightKinds(planEntries, nightCount, lodgingKey);
	const innNights = nightKinds.filter((kind) => kind === "inn").length;
	const openNights = nightKinds.filter((kind) => kind === "open").length;
	const aboardNights = nightKinds.filter((kind) => kind === "aboard").length;

	// Wasserstrecke je Richtung -- stromauf kostet nach Geographia S. 129 das Dreifache.
	let riverMiles = 0;
	let upstreamMiles = 0;
	planEntries.forEach((entry) => {
		if (entry.type !== "Flussweg") {
			return;
		}
		const miles = Number(entry.distance) || 0;
		riverMiles += miles;
		if (entry.flowState === "upstream") {
			upstreamMiles += miles;
		}
	});

	const rows = [];

	rows.push({
		key: "lodging",
		label: tr("planner.cost.lodging", "Übernachtung"),
		heller: lodging.bed * innNights * travellers,
		note: innNights
			? tr("planner.cost.lodging.note", "{n} × {what}", {
				n: formatDecimalNumber(innNights, 0),
				what: tr(`planner.cost.lodging.${lodgingKey}`, TRAVEL_COST_LODGING_LABEL_DE[lodgingKey] || lodgingKey),
			})
			: tr("planner.cost.lodging.none", "durchweg im Freien"),
	});

	rows.push({
		key: "food",
		label: tr("planner.cost.food", "Verpflegung"),
		heller: lodging.food * dayCount * travellers,
		note: tr("planner.cost.food.note", "{n} Reisetage", { n: formatDecimalNumber(dayCount, 0) }),
	});

	if (mounts > 0) {
		const shoes = TRAVEL_COST_SHOE_PER_HOOF * TRAVEL_COST_HOOVES_PER_MOUNT * mounts;
		const stabling = lodging.stableNight === null
			? lodging.feedPerWeek * (dayCount / 7) * mounts
			: lodging.stableNight * innNights * mounts;
		rows.push({
			key: "mounts",
			label: tr("planner.cost.mounts", "Reittiere"),
			heller: stabling + shoes,
			note: lodging.stableNight === null
				? tr("planner.cost.mounts.own", "{n} Tiere, eigenes Futter und Hufbeschlag", { n: formatDecimalNumber(mounts, 0) })
				: tr("planner.cost.mounts.stable", "{n} Tiere im Stall und Hufbeschlag", { n: formatDecimalNumber(mounts, 0) }),
		});
	}

	// Zoll: nur die Landesgrenzen. Der Binnenobolus (1 Heller) faellt weg -- die Geographia knuepft
	// ihn an „eigentlich nur die Provinzen des Mittelreichs und des Horasreichs" (S. 115) und
	// nimmt Reichsstrassen ganz aus (S. 113); auf einer geprueften Route blieben null zahlbare uebrig.
	//
	// 💣 DREI ZUSTAENDE, NICHT ZWEI. `stateBorders` ist eine Zahl (gerechnet), `null` (laeuft noch)
	// oder `false` (die Herrschaftsgebiete sind hier gar nicht abrufbar -- lokal ohne Datenbank ist
	// POLITICAL_TERRITORIES_API_URL leer). „Nicht abrufbar" darf NIEMALS als 0 durchgehen: eine Reise
	// quer durch drei Reiche saehe dann zollfrei aus, und das waere keine fehlende Angabe, sondern
	// eine falsche.
	const stateBorders = options.stateBorders;
	const bordersKnown = Number.isFinite(stateBorders);
	rows.push({
		key: "tolls",
		label: tr("planner.cost.tolls", "Zölle"),
		heller: bordersKnown ? lodging.tollPerson * stateBorders * travellers : null,
		note: bordersKnown
			? tr("planner.cost.tolls.note", "{n} Landesgrenzen, {how}", {
				n: formatDecimalNumber(stateBorders, 0),
				how: tr(`planner.cost.toll.${lodgingKey}`, TRAVEL_COST_TOLL_LABEL_DE[lodgingKey] || lodgingKey),
			})
			: stateBorders === false
				? tr("planner.cost.tolls.unavailable", "Grenzen hier nicht ermittelbar")
				: tr("planner.cost.tolls.pending", "Grenzen werden ermittelt …"),
	});

	if (riverMiles > 0) {
		const downstreamMiles = Math.max(0, riverMiles - upstreamMiles);
		const passengerHeller = (downstreamMiles + upstreamMiles * TRAVEL_COST_RIVER_UPSTREAM_FACTOR)
			/ 100 * lodging.riverPer100;
		// Das Pferd faehrt wie ein Passagier (S. 129/131) -- aber immer zum Kahnpreis, auch wenn der
		// Mensch eine Kabine nimmt.
		const mountHeller = (downstreamMiles + upstreamMiles * TRAVEL_COST_RIVER_UPSTREAM_FACTOR)
			/ 100 * TRAVEL_COST_LODGING.bett.riverPer100;
		rows.push({
			key: "river",
			label: tr("planner.cost.river", "Flusspassage"),
			heller: passengerHeller * travellers + mountHeller * mounts,
			note: tr("planner.cost.river.note", "{n} Meilen", { n: formatDecimalNumber(riverMiles, 1) }),
		});
	}

	return {
		rows,
		travellers,
		mounts,
		nightCount,
		dayCount,
		innNights,
		openNights,
		aboardNights,
		lodgingKey,
	};
}
