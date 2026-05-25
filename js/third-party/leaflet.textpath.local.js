(function () {
	if (!window.L || !L.Polyline) {
		return;
	}

	let nextTextPathId = 1;

	function ensurePathId(layer) {
		if (!layer._path) {
			return "";
		}
		if (!layer._path.id) {
			layer._path.id = `leaflet-text-path-${nextTextPathId}`;
			nextTextPathId += 1;
		}
		return layer._path.id;
	}

	function removeTextPath(layer) {
		if (layer._textPathElement?.parentNode) {
			layer._textPathElement.parentNode.removeChild(layer._textPathElement);
		}
		layer._textPathElement = null;
		layer._textPathNode = null;
	}

	L.Polyline.include({
		setText(text, options = {}) {
			this._textPathText = String(text || "");
			this._textPathOptions = options || {};
			if (this._map) {
				this._updateTextPath();
			}
			return this;
		},

		removeText() {
			this._textPathText = "";
			removeTextPath(this);
			return this;
		},

		_updateTextPath() {
			removeTextPath(this);
			if (!this._textPathText || !this._path) {
				return;
			}

			const pathId = ensurePathId(this);
			if (!pathId) {
				return;
			}

			const namespace = "http://www.w3.org/2000/svg";
			const textElement = document.createElementNS(namespace, "text");
			const textPathElement = document.createElementNS(namespace, "textPath");
			const options = this._textPathOptions || {};

			textElement.setAttribute("class", options.className || "leaflet-text-path");
			textElement.setAttribute("dy", options.dy || "-4");
			textElement.setAttribute("text-anchor", options.textAnchor || "middle");
			textElement.setAttribute("pointer-events", "none");
			if (options.style) {
				Object.entries(options.style).forEach(([key, value]) => {
					textElement.style[key] = value;
				});
			}

			textPathElement.setAttribute("href", `#${pathId}`);
			textPathElement.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${pathId}`);
			textPathElement.setAttribute("startOffset", options.offset || "50%");
			textPathElement.textContent = this._textPathText;
			textElement.appendChild(textPathElement);

			this._path.parentNode?.appendChild(textElement);
			this._textPathElement = textElement;
			this._textPathNode = textPathElement;
		},
	});

	const originalOnAdd = L.Polyline.prototype.onAdd;
	const originalOnRemove = L.Polyline.prototype.onRemove;
	const originalSetLatLngs = L.Polyline.prototype.setLatLngs;
	const originalSetStyle = L.Polyline.prototype.setStyle;

	L.Polyline.prototype.onAdd = function (map) {
		originalOnAdd.call(this, map);
		if (this._textPathText) {
			this._updateTextPath();
		}
	};

	L.Polyline.prototype.onRemove = function (map) {
		removeTextPath(this);
		originalOnRemove.call(this, map);
	};

	L.Polyline.prototype.setLatLngs = function (latlngs) {
		const result = originalSetLatLngs.call(this, latlngs);
		if (this._textPathText) {
			this._updateTextPath();
		}
		return result;
	};

	L.Polyline.prototype.setStyle = function (style) {
		const result = originalSetStyle.call(this, style);
		if (this._textPathText) {
			this._updateTextPath();
		}
		return result;
	};
})();
