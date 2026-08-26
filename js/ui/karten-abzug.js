(function () {
	"use strict";

	// Ein Bild von einem Stueck der laufenden Karte -- der Knopf „Kartenausschnitt" im Social-Media-Hub
	// (Entwurf docs/superpowers/specs/2026-08-10-social-media-hub-design.md §5, dort seit dem
	// 10.08.2026 als „die Abkuerzung fuer ‚zeig, was sich geaendert hat'" beschrieben und bis heute
	// abgeschaltet).
	//
	// Zwei Haelften, bewusst in EINER Datei: den Rahmen aufziehen (`rahmenWaehlen`) und das Bild malen
	// (`aufnehmen`). Sie gehoeren zusammen -- ein Rahmen ohne Aufnahme ist nichts, und eine Aufnahme
	// ohne Rahmen haette keinen Aufrufer.
	//
	// 🔴 DER BROWSER KANN EINE LEAFLET-KARTE NICHT ABFOTOGRAFIEREN. Es gibt kein „Screenshot dieses
	// Elements": die Kacheln sind <img>, Orte und Beschriftungen liegen auf <canvas>, Grenzen auf
	// <svg>, jedes in einer eigenen Pane mit eigener z-Ordnung. Gemalt wird deshalb Schicht fuer
	// Schicht von Hand. Genau das ist der Grund, warum der Knopf in Stufe 1 grau blieb -- der Bauplan
	// nannte es „ein eigenes Stueck Arbeit, kein Nebeneffekt der Bild-Pipeline".
	//
	// 💣 VIER FALLEN, alle bereits einmal getreten -- in tools/layer-tiles/capture.js, das dieselbe
	//    Aufnahme fuer die sechs Ansichts-Icons macht. Das Wissen stammt von dort:
	//
	// (1) EIN BILD FREMDER HERKUNFT VERGIFTET DIE LEINWAND. Sobald ein <img> von einem anderen Origin
	//     gezeichnet wurde, wirft `toBlob` mit einem Sicherheitsfehler -- und zwar erst ganz am Ende,
	//     wenn alles gemalt ist. Deshalb wird jede Bildquelle vorher geprueft (`quelleIstEigen`).
	//
	// (2) EINE SERIALISIERTE SVG-EBENE TRAEGT IHRE CSS-REGELN NICHT MIT. Die Landschaften stehen auf
	//     fill-opacity="0.2" im Attribut, waehrend das Stylesheet 0.72 durchsetzt; ohne viewBox malt
	//     sie ausserdem in ihre eigenen, weit ausserhalb liegenden Koordinaten. Beides wird beim
	//     Klonen nachgetragen.
	//
	// (3) JEDE DATENEBENE BAUT SICH STUFENWEISE AUF. Die politische Aussengrenze steht ZULETZT
	//     (AGENTS.md §10, „VIELE Features je Gebiet"). Eine Aufnahme nach fester Wartezeit mischt
	//     neue Farben mit alten Grenzen -- die weissen Konturen laufen quer durch die Flaechen.
	//     Gewartet wird, BIS SICH NICHTS MEHR AENDERT, nicht „lange genug".
	//
	// (4) JPEG KENNT KEINE TRANSPARENZ. Ohne ausdruecklich gefuellten Untergrund kommt ein schwarzes
	//     Quadrat heraus (AGENTS.md §11, Social-Hub: dieselbe Falle hat die Bild-Pipeline schon
	//     einmal getroffen). Gefuellt wird mit der Hintergrundfarbe des Kartencontainers.
	//
	// 🔴 UND DIE UMGEKEHRTE PANE-REGEL: capture.js nimmt eine ALLOWLIST auf, weil seine Icons anonym
	//    sein muessen -- was nicht drinsteht, kann keinen Namen ins Bild tragen. Hier gilt das
	//    Gegenteil: der Owner will die Beschriftungen im Bild (26.08.2026, „aufziehbarer rahmen, mit
	//    beschriftungen"). Deshalb eine DENYLIST -- alles ist drin ausser dem, was Bedienung ist und
	//    nicht Karte. Wer hier eine Allowlist einbaut, verliert bei jeder neuen Ebene stillschweigend
	//    deren Inhalt.

	// Was Bedienung ist und nicht Karte. Ein offenes Popup, ein Tooltip, die Markierung aus „Was ist
	// hier?" und die Griffe des Messwerkzeugs sind Zustand DIESES Editors, nicht Inhalt der Karte --
	// sie haetten in einem oeffentlichen Beitrag nichts zu suchen. `leaflet-map-pane` ist der Behaelter
	// aller uebrigen Panes und wuerde jede davon ein zweites Mal malen.
	var NICHT_INS_BILD = [
		"leaflet-map-pane",
		"leaflet-popup-pane",
		"leaflet-tooltip-pane",
		"leaflet-sharePin-pane",
		"leaflet-regionHover-pane",
		"leaflet-measurement-pane",
		"leaflet-measurementHandles-pane"
	];

	var MALSTIL = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity",
		"stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity"];

	// Ein Klick ist kein Rahmen. Darunter gilt das Ziehen als Fehlgriff und nicht als winziges Bild.
	var MINDESTKANTE = 60;

	// 💣 Der Deckel ist NICHT Kosmetik. Ein grosser Ausschnitt auf einem 4K-Schirm mit doppelter
	// Punktdichte waere 7680 px breit -- ueber dem Flaechenlimit mancher Browser-Leinwaende, und der
	// Server verkleinert ohnehin auf 1440 (AVESMAPS_SOCIAL_MEDIA_MAX_WIDTH). 2048 laesst dem
	// serverseitigen Zuschnitt Luft und bleibt weit unter jeder Grenze.
	var MAX_BREITE = 2048;

	// Der Punktdichte-Deckel des Hauses. Er steht hier eigenstaendig und nicht als Aufruf von
	// `avesmapsCanvasDpr()`: jene Regel gilt dem DAUERHAFTEN Zeichnen der Karte, wo ein 3x-Telefon
	// den Speicher sprengt (docs/kartenflaechen-und-zoomblenden.md). Hier entsteht ein einzelnes Bild,
	// das gleich wieder verworfen wird -- und der Grund fuer den Deckel ist ein anderer, naemlich die
	// Bildgroesse. Zwei Regeln mit demselben Wert und verschiedenen Gruenden bleiben getrennt.
	var MAX_PUNKTDICHTE = 2;

	// Das Fenster, das die Netze annehmen: 4:5 hoch bis 1,91:1 breit (Instagram; der Server schneidet
	// alles andere zu, avesmapsSocialEncodeImageBytes). Gezeigt wird es beim Ziehen, damit der
	// Zuschnitt niemanden ueberrascht -- erzwungen wird es NICHT: fuer „Neuigkeiten" und Mastodon ist
	// jedes Verhaeltnis recht, und ein Rahmen, der sich nicht ziehen laesst, wie man will, waere die
	// schlechtere Haelfte des Tauschs.
	var VERHAELTNIS_MIN = 0.8;
	var VERHAELTNIS_MAX = 1.91;

	// ---- reine Entscheidungen (unter Test in __tests__/karten-abzug.test.js) ---------------------

	// Aus zwei Eckpunkten ein Rechteck -- in jede Zugrichtung. Ohne die Normalisierung liefert ein Zug
	// nach links oben negative Breiten, und jede Pruefung danach rechnet mit Unsinn weiter.
	function normalisiereRechteck(x1, y1, x2, y2) {
		return {
			x: Math.min(x1, x2),
			y: Math.min(y1, y2),
			breite: Math.abs(x2 - x1),
			hoehe: Math.abs(y2 - y1)
		};
	}

	// Der Rahmen darf nicht ueber die Karte hinausragen: was ausserhalb liegt, ist nicht gemalt und
	// kaeme als Hintergrundfarbe ins Bild.
	function klemmeAufFlaeche(rechteck, breite, hoehe) {
		var x = Math.max(0, Math.min(rechteck.x, breite));
		var y = Math.max(0, Math.min(rechteck.y, hoehe));
		return {
			x: x,
			y: y,
			breite: Math.max(0, Math.min(rechteck.breite, breite - x)),
			hoehe: Math.max(0, Math.min(rechteck.hoehe, hoehe - y))
		};
	}

	function istGrossGenug(rechteck) {
		return !!rechteck && rechteck.breite >= MINDESTKANTE && rechteck.hoehe >= MINDESTKANTE;
	}

	// Wie gross das Bild wird. Der Faktor hebt die Punktdichte des Schirms mit -- die Canvas-Ebenen
	// zeichnen ohnehin in dieser Aufloesung, sie wuerden sonst beim Malen heruntergerechnet und das
	// Bild waere weicher als der Bildschirm.
	function abzugMasse(rechteck, punktdichte, maxBreite) {
		var deckel = maxBreite || MAX_BREITE;
		var faktor = Math.min(punktdichte || 1, MAX_PUNKTDICHTE);
		if (rechteck.breite * faktor > deckel) { faktor = deckel / rechteck.breite; }
		return {
			breite: Math.max(1, Math.round(rechteck.breite * faktor)),
			hoehe: Math.max(1, Math.round(rechteck.hoehe * faktor)),
			faktor: faktor
		};
	}

	function paneGehoertInsBild(klassenname) {
		var name = String(klassenname || "");
		return !NICHT_INS_BILD.some(function (verboten) { return name.indexOf(verboten) >= 0; });
	}

	// Falle (1). `data:` ist immer unbedenklich (die Gebietsnamen liegen als gerastertes PNG genau so
	// vor); alles andere muss von unserem eigenen Origin kommen. Ein unlesbares src faellt auf
	// „nicht eigen" -- die sichere Richtung: ein fehlendes Wappen kostet ein Detail, eine vergiftete
	// Leinwand das ganze Bild.
	function quelleIstEigen(quelle, herkunft) {
		var src = String(quelle || "");
		// ⚠️ Ein leeres src ist kein Bild -- und ohne diese Zeile ist es „eigen": `new URL("", basis)`
		// loest auf die BASIS auf, also auf unseren eigenen Origin. Gemalt wuerde dann ein leeres
		// <img>, was zwar nichts anrichtet, aber die Absicht der Pruefung auf den Kopf stellt.
		if (src === "") { return false; }
		if (src.indexOf("data:") === 0) { return true; }
		try { return new URL(src, herkunft).origin === new URL(herkunft).origin; }
		catch (fehler) { return false; }
	}

	function verhaeltnisPasst(rechteck) {
		if (!rechteck || !rechteck.hoehe) { return false; }
		var v = rechteck.breite / rechteck.hoehe;
		return v >= VERHAELTNIS_MIN && v <= VERHAELTNIS_MAX;
	}

	// Die Zeile, die beim Ziehen unter dem Rahmen steht. Sie nennt die Masse des BILDES, nicht die des
	// Rahmens: bei doppelter Punktdichte sind das verschiedene Zahlen, und die interessante ist die,
	// die hinterher hochgeladen wird.
	function masszeile(rechteck, punktdichte) {
		if (!istGrossGenug(rechteck)) { return "Zieh einen größeren Rahmen"; }
		var masse = abzugMasse(rechteck, punktdichte, MAX_BREITE);
		var text = masse.breite + " × " + masse.hoehe + " px";
		if (!verhaeltnisPasst(rechteck)) {
			text += " · wird für Instagram zugeschnitten";
		}
		return text;
	}

	// ---- die Aufnahme ---------------------------------------------------------------------------

	function svgZuBild(svgEl, breite, hoehe) {
		return new Promise(function (fertig) {
			try {
				var klon = svgEl.cloneNode(true);
				klon.setAttribute("width", breite);
				klon.setAttribute("height", hoehe);
				if (!klon.getAttribute("viewBox")) {                                  // Falle (2)
					var box = svgEl.viewBox && svgEl.viewBox.baseVal;
					if (box && box.width) {
						klon.setAttribute("viewBox", box.x + " " + box.y + " " + box.width + " " + box.height);
					}
				}
				var quelle = svgEl.querySelectorAll("*");
				var ziel = klon.querySelectorAll("*");
				var anzahl = Math.min(quelle.length, ziel.length);
				for (var i = 0; i < anzahl; i++) {
					var stil = getComputedStyle(quelle[i]);
					for (var p = 0; p < MALSTIL.length; p++) {
						var wert = stil.getPropertyValue(MALSTIL[p]);
						if (wert) { try { ziel[i].setAttribute(MALSTIL[p], wert); } catch (e) { /* egal */ } }
					}
				}
				var bild = new Image();
				bild.onload = function () { fertig(bild); };
				bild.onerror = function () { fertig(null); };
				bild.src = "data:image/svg+xml;charset=utf-8,"
					+ encodeURIComponent(new XMLSerializer().serializeToString(klon));
			} catch (fehler) { fertig(null); }
		});
	}

	// Falle (3): warten, bis sich die Karte drei Messungen lang nicht mehr aendert. Der Fingerabdruck
	// zaehlt Elemente je Pane und tastet jede Leinwand verkleinert ab -- eine Ebene, die noch Farben
	// nachtraegt, aendert ihn.
	function warteAufRuhe(container, maxMs) {
		return new Promise(function (fertig) {
			var probe = document.createElement("canvas");
			probe.width = 40; probe.height = 40;
			var pctx = probe.getContext("2d");
			function fingerabdruck() {
				var s = "";
				container.querySelectorAll(".leaflet-pane").forEach(function (pane) {
					if (!paneGehoertInsBild(pane.className)) { return; }
					s += pane.querySelectorAll("img,canvas,svg").length + ":"
						+ pane.querySelectorAll("path").length + ";";
					pane.querySelectorAll("canvas").forEach(function (leinwand) {
						pctx.clearRect(0, 0, 40, 40);
						try { pctx.drawImage(leinwand, 0, 0, 40, 40); } catch (e) { s += "x"; return; }
						var daten = pctx.getImageData(0, 0, 40, 40).data, hash = 0;
						for (var i = 0; i < daten.length; i += 5) { hash = (hash * 33 + daten[i]) | 0; }
						s += hash + ",";
					});
				});
				return s + "|" + container.querySelectorAll(".leaflet-tile:not(.leaflet-tile-loaded)").length;
			}
			var start = Date.now(), letzter = null, gleich = 0;
			(function tick() {
				var jetzt = fingerabdruck();
				if (jetzt === letzter) { gleich++; } else { gleich = 0; letzter = jetzt; }
				if (gleich >= 3 || Date.now() - start > maxMs) {
					fertig({ ms: Date.now() - start, ruhig: gleich >= 3 });
					return;
				}
				setTimeout(tick, 300);
			})();
		});
	}

	// Malt die Karte in ein Canvas -- nur den Ausschnitt, mit Versatz statt hinterher zu schneiden.
	// Ein volles Container-Canvas bei doppelter Punktdichte waere auf grossen Schirmen zweistellige
	// Megabyte, von denen fast alles gleich wieder weggeworfen wuerde.
	async function maleAusschnitt(container, rechteck, masse) {
		var containerBox = container.getBoundingClientRect();
		var leinwand = document.createElement("canvas");
		leinwand.width = masse.breite;
		leinwand.height = masse.hoehe;
		var ctx = leinwand.getContext("2d");

		ctx.fillStyle = getComputedStyle(container).backgroundColor || "#7fb2d6";   // Falle (4)
		ctx.fillRect(0, 0, leinwand.width, leinwand.height);

		ctx.scale(masse.faktor, masse.faktor);
		ctx.translate(-rechteck.x, -rechteck.y);

		// Die Panes tragen ihre Reihenfolge im z-index, nicht im DOM -- ohne die Sortierung laege die
		// politische Flaeche ueber ihren eigenen Grenzen.
		var panes = [];
		container.querySelectorAll(".leaflet-pane").forEach(function (pane) {
			if (!paneGehoertInsBild(pane.className)) { return; }
			panes.push({ el: pane, z: parseInt(getComputedStyle(pane).zIndex || "0", 10) || 0 });
		});
		panes.sort(function (a, b) { return a.z - b.z; });

		for (var i = 0; i < panes.length; i++) {
			var elemente = panes[i].el.querySelectorAll("img, canvas, svg");
			for (var k = 0; k < elemente.length; k++) {
				var element = elemente[k];
				var tag = element.tagName.toLowerCase();
				if (tag === "img" && !quelleIstEigen(element.src, location.href)) { continue; }
				var box = element.getBoundingClientRect();
				if (box.width < 1 || box.height < 1) { continue; }
				var x = box.x - containerBox.x;
				var y = box.y - containerBox.y;
				// Was neben dem Rahmen liegt, kostet nur Zeit -- gerade die Kacheln sind zu Dutzenden da.
				if (x > rechteck.x + rechteck.breite || y > rechteck.y + rechteck.hoehe
					|| x + box.width < rechteck.x || y + box.height < rechteck.y) { continue; }
				if (tag === "svg") {
					var bild = await svgZuBild(element, box.width, box.height);
					if (bild) { ctx.drawImage(bild, x, y, box.width, box.height); }
				} else {
					try { ctx.drawImage(element, x, y, box.width, box.height); }
					catch (fehler) { /* getaintet -- lieber ohne dieses Element als ohne Bild */ }
				}
			}
		}
		return leinwand;
	}

	// 💣 JPEG, nicht PNG -- und das ist kein Geschmack: der Server encodiert ohnehin nach JPEG, weil
	// Instagram kein PNG annimmt (AGENTS.md §11). Ein PNG dazwischen kostete nur Bytes gegen die
	// 12-MB-Grenze und braechte keine Schaerfe, die den Weg ueberlebt.
	function leinwandZuBlob(leinwand) {
		return new Promise(function (fertig, ablehnen) {
			try {
				leinwand.toBlob(function (blob) {
					if (blob) { fertig(blob); } else { ablehnen(new Error("Das Bild konnte nicht erzeugt werden.")); }
				}, "image/jpeg", 0.92);
			} catch (fehler) {
				// Kommt praktisch nur von einer vergifteten Leinwand -- Falle (1) hat etwas durchgelassen.
				ablehnen(fehler);
			}
		});
	}

	// 🔴 Wirft im Fehlerfall, loest NIE mit `null` auf. Ein Aufrufer, der ein Bild erwartet und
	// stillschweigend nichts bekommt, zeigt einen leeren Medienbereich und sieht aus wie „hat
	// funktioniert" -- dieselbe Regel wie beim Vertrag der Wiki-Zuweisung (AGENTS.md §11).
	async function aufnehmen(rechteck, optionen) {
		var einstellungen = optionen || {};
		var karte = einstellungen.karte || (typeof map !== "undefined" ? map : null);
		if (!karte || typeof karte.getContainer !== "function") {
			throw new Error("Keine Karte gefunden.");
		}
		var container = karte.getContainer();
		var box = container.getBoundingClientRect();
		var ausschnitt = klemmeAufFlaeche(rechteck, box.width, box.height);
		if (!istGrossGenug(ausschnitt)) { throw new Error("Der Ausschnitt ist zu klein."); }

		await warteAufRuhe(container, einstellungen.maxWarteMs || 8000);
		var masse = abzugMasse(ausschnitt, window.devicePixelRatio || 1, MAX_BREITE);
		var leinwand = await maleAusschnitt(container, ausschnitt, masse);
		return { blob: await leinwandZuBlob(leinwand), breite: masse.breite, hoehe: masse.hoehe };
	}

	// ---- der Rahmen -----------------------------------------------------------------------------

	// Loest mit dem Rechteck auf oder mit `null`, wenn abgebrochen wurde. Hier ist `null` KEIN
	// verschluckter Fehler, sondern die Antwort „ich will doch nicht" -- der einzige Unterschied zum
	// Vertrag von `aufnehmen`, und er steht deshalb hier.
	function rahmenWaehlen(optionen) {
		var einstellungen = optionen || {};
		var karte = einstellungen.karte || (typeof map !== "undefined" ? map : null);
		if (!karte || typeof karte.getContainer !== "function") {
			return Promise.reject(new Error("Keine Karte gefunden."));
		}
		var container = karte.getContainer();

		return new Promise(function (fertig) {
			// 💣 DIE KARTE MUSS STILLSTEHEN, SONST ZIEHT LEAFLET MIT. Die Schicht liegt zwar darüber,
			// aber Ereignisse blubbern: Leaflet lauscht am Container und begänne beim selben
			// pointerdown zu schieben. Man zöge dann einen Rahmen über einer wegrutschenden Karte.
			// Zurückgegeben wird nur, was vorher an war — `enable()` auf einer Karte, deren Schieben
			// jemand anders abgeschaltet hat, wäre eine fremde Einstellung, die wir überschreiben.
			var zogVorher = !!(karte.dragging && karte.dragging.enabled());
			if (zogVorher) { karte.dragging.disable(); }

			var schicht = document.createElement("div");
			schicht.className = "kartenabzug-schicht";
			var rahmen = document.createElement("div");
			rahmen.className = "kartenabzug-rahmen";
			rahmen.hidden = true;
			var masse = document.createElement("div");
			masse.className = "kartenabzug-masse";
			masse.hidden = true;
			var hinweis = document.createElement("div");
			hinweis.className = "kartenabzug-hinweis";
			hinweis.textContent = "Rahmen aufziehen — Esc bricht ab";
			var knoepfe = document.createElement("div");
			knoepfe.className = "kartenabzug-knoepfe";
			knoepfe.hidden = true;
			var uebernehmen = document.createElement("button");
			uebernehmen.type = "button";
			uebernehmen.className = "kartenabzug-knopf kartenabzug-knopf--haupt";
			uebernehmen.textContent = "✓ Aufnehmen";
			var abbrechen = document.createElement("button");
			abbrechen.type = "button";
			abbrechen.className = "kartenabzug-knopf";
			abbrechen.textContent = "Abbrechen";
			knoepfe.append(uebernehmen, abbrechen);
			schicht.append(rahmen, masse, hinweis, knoepfe);
			container.appendChild(schicht);

			var start = null;
			var gewaehlt = null;

			function schliesse(ergebnis) {
				document.removeEventListener("keydown", beiTaste, true);
				karte.off("zoomstart", beiZoom);
				if (zogVorher) { karte.dragging.enable(); }
				if (schicht.parentNode) { schicht.parentNode.removeChild(schicht); }
				fertig(ergebnis);
			}

			// 💣 Ein gezogener Rahmen ist ein BILDSCHIRM-Rechteck. Zoomt jemand danach, liegt etwas
			// anderes darunter als beim Ziehen -- und aufgenommen würde das Neue, ohne dass es
			// auffiele. Deshalb fällt der Rahmen beim Zoomen weg und muss neu gezogen werden.
			function beiZoom() {
				start = null;
				gewaehlt = null;
				rahmen.hidden = true;
				masse.hidden = true;
				knoepfe.hidden = true;
			}

			function zeichne(rechteck) {
				rahmen.hidden = false;
				rahmen.style.left = rechteck.x + "px";
				rahmen.style.top = rechteck.y + "px";
				rahmen.style.width = rechteck.breite + "px";
				rahmen.style.height = rechteck.hoehe + "px";
				masse.hidden = false;
				masse.textContent = masszeile(rechteck, window.devicePixelRatio || 1);
				masse.classList.toggle("kartenabzug-masse--knapp", !istGrossGenug(rechteck));
				// Ueber dem Rahmen, solange oben Platz ist -- sonst darunter. Ohne das klebt die Zeile
				// bei einem Rahmen am oberen Kartenrand ausserhalb des Bildes.
				var oben = rechteck.y > 28;
				masse.style.left = rechteck.x + "px";
				masse.style.top = (oben ? rechteck.y - 26 : rechteck.y + rechteck.hoehe + 6) + "px";
			}

			function beiTaste(ereignis) {
				if (ereignis.key === "Escape") {
					ereignis.preventDefault();
					ereignis.stopPropagation();
					schliesse(null);
				}
			}

			function lage(ereignis) {
				var box = container.getBoundingClientRect();
				return { x: ereignis.clientX - box.x, y: ereignis.clientY - box.y };
			}

			schicht.addEventListener("pointerdown", function (ereignis) {
				if (ereignis.button !== 0) { return; }
				ereignis.preventDefault();
				ereignis.stopPropagation();
				knoepfe.hidden = true;
				gewaehlt = null;
				start = lage(ereignis);
				try { schicht.setPointerCapture(ereignis.pointerId); } catch (fehler) { /* egal */ }
				zeichne(normalisiereRechteck(start.x, start.y, start.x, start.y));
			});

			schicht.addEventListener("pointermove", function (ereignis) {
				if (!start) { return; }
				var jetzt = lage(ereignis);
				var box = container.getBoundingClientRect();
				zeichne(klemmeAufFlaeche(
					normalisiereRechteck(start.x, start.y, jetzt.x, jetzt.y), box.width, box.height));
			});

			schicht.addEventListener("pointerup", function (ereignis) {
				if (!start) { return; }
				var jetzt = lage(ereignis);
				var box = container.getBoundingClientRect();
				var rechteck = klemmeAufFlaeche(
					normalisiereRechteck(start.x, start.y, jetzt.x, jetzt.y), box.width, box.height);
				start = null;
				if (!istGrossGenug(rechteck)) {
					// Ein Klick ohne Zug ist kein Rahmen -- und auch kein Abbruch: wer danebengreift,
					// soll einfach noch einmal ziehen koennen.
					rahmen.hidden = true;
					masse.hidden = true;
					return;
				}
				gewaehlt = rechteck;
				zeichne(rechteck);
				// Die Knoepfe stehen UNTER dem Rahmen, wenn darunter Platz ist. Innen waeren sie im Bild
				// -- gemalt wird zwar erst nach dem Wegraeumen, aber sie verdeckten die Sicht auf das,
				// was man gerade waehlt.
				var unten = rechteck.y + rechteck.hoehe + 44 < box.height;
				knoepfe.hidden = false;
				knoepfe.style.left = rechteck.x + "px";
				knoepfe.style.top = (unten ? rechteck.y + rechteck.hoehe + 8 : Math.max(4, rechteck.y - 40)) + "px";
			});

			uebernehmen.addEventListener("click", function (ereignis) {
				ereignis.stopPropagation();
				if (gewaehlt) { schliesse(gewaehlt); }
			});
			abbrechen.addEventListener("click", function (ereignis) {
				ereignis.stopPropagation();
				schliesse(null);
			});
			// 💣 Der Knopf sitzt IN der Ziehschicht: ohne dieses Abfangen startet sein eigener
			// pointerdown einen neuen Rahmen, und der Klick trifft ins Leere.
			knoepfe.addEventListener("pointerdown", function (ereignis) { ereignis.stopPropagation(); });

			document.addEventListener("keydown", beiTaste, true);
			karte.on("zoomstart", beiZoom);
		});
	}

	if (typeof window !== "undefined") {
		window.avesmapsKartenAbzug = {
			aufnehmen: aufnehmen,
			rahmenWaehlen: rahmenWaehlen
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			normalisiereRechteck, klemmeAufFlaeche, istGrossGenug, abzugMasse,
			paneGehoertInsBild, quelleIstEigen, verhaeltnisPasst, masszeile,
			MINDESTKANTE, MAX_BREITE, MAX_PUNKTDICHTE, NICHT_INS_BILD
		};
	}
})();
