function getVisualPathLatLngCoordinates(coordinates) {
	return smoothLineCoordinatesForDisplay(coordinates).map(([x, y]) => [y, x]);
}

function createLocationLookup() {
	return new Map(locationData.map((location) => [location.name, location]));
}

function getLocationDistance(firstLocation, secondLocation) {
	const [firstLat, firstLng] = firstLocation.coordinates;
	const [secondLat, secondLng] = secondLocation.coordinates;
	return calculateCoordinateDistance([firstLat, firstLng], [secondLat, secondLng]);
}

function addGraphConnection(graph, fromName, toName, connection) {
	graph[fromName][toName] = graph[fromName][toName] || [];
	graph[fromName][toName].push(connection);
}

function findNearestComponentConnection(component, connectedNodeNames, locationLookup) {
	let nearestConnection = null;

	component.nodeNames.forEach((sourceName) => {
		const sourceLocation = locationLookup.get(sourceName);
		if (!sourceLocation) {
			return;
		}

		connectedNodeNames.forEach((targetName) => {
			const targetLocation = locationLookup.get(targetName);
			if (!targetLocation) {
				return;
			}

			const distance = getLocationDistance(sourceLocation, targetLocation);
			if (!nearestConnection || distance < nearestConnection.distance) {
				nearestConnection = {
					fromLocation: sourceLocation,
					toLocation: targetLocation,
					distance,
				};
			}
		});
	});

	return nearestConnection;
}

function buildSyntheticPathSegment(fromLocation, toLocation, connectionId, routeType) {
	return {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[fromLocation.coordinates[1], fromLocation.coordinates[0]],
				[toLocation.coordinates[1], toLocation.coordinates[0]],
			],
		},
		properties: {
			id: connectionId,
			name: `${routeType}-synthetic`,
			synthetic: true,
		},
	};
}

function addSyntheticGraphConnection(graph, fromLocation, toLocation, distance, routeConfig) {
	const connectionId = `synthetic-${fromLocation.name}->${toLocation.name}`;
	const effectiveDistance = distance * SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR;
	const connection = {
		distance: effectiveDistance,
		time: effectiveDistance / routeConfig.speed,
		routeType: routeConfig.routeType,
		id: connectionId,
		synthetic: true,
	};

	addGraphConnection(graph, fromLocation.name, toLocation.name, connection);
	addGraphConnection(graph, toLocation.name, fromLocation.name, connection);
	syntheticPathSegments.set(
		connectionId,
		buildSyntheticPathSegment(fromLocation, toLocation, connectionId, routeConfig.routeType)
	);
}

function calculateRouteCore(graph, startName, endName, useShortestPath, minimizeTransfers, transferPenalty, resolveTransportOption) {
	if (!graph?.[startName] || !graph?.[endName]) {
		return [];
	}

	const distances = {};
	const previousNodes = {};
	const previousTransport = {};
	const connectionUsed = {};

	Object.keys(graph).forEach(n => distances[n] = Infinity);

	distances[startName] = 0;

	const queue = new PriorityQueue();
	queue.enqueue({ node: startName, transport: null }, 0);

	while (!queue.isEmpty()) {

		const { item, priority } = queue.dequeue();

		const currentNode = item.node;
		const currentTransport = item.transport;

		if (priority > distances[currentNode]) continue;

		for (const [neighbor, connections] of Object.entries(graph[currentNode])) {

			for (const conn of connections) {

				const transport = conn.transportOption || resolveTransportOption(conn.routeType);
				if (!transport) {
					continue;
				}

				let weight = useShortestPath ? conn.distance : conn.time;

				if (minimizeTransfers && currentTransport && transport !== currentTransport)
					weight += transferPenalty;

				const alt = distances[currentNode] + weight;

				if (alt < distances[neighbor]) {

					distances[neighbor] = alt;

					previousNodes[neighbor] = currentNode;
					previousTransport[neighbor] = transport;
					connectionUsed[neighbor] = conn.id;

					queue.enqueue({ node: neighbor, transport: transport }, alt);

				}

			}

		}

	}

	const route = [];

	for (let node = endName; node && previousNodes[node]; node = previousNodes[node]) {
		route.unshift({
			from: previousNodes[node],
			to: node,
			connectionId: connectionUsed[node]
		});
	}

	return route;
}

function findGraphComponents(graph) {
	const visitedNodeNames = new Set();
	const components = [];

	Object.keys(graph).forEach((startName) => {
		if (visitedNodeNames.has(startName)) {
			return;
		}

		const nodeNames = [];
		const stack = [startName];
		visitedNodeNames.add(startName);

		while (stack.length) {
			const currentName = stack.pop();
			nodeNames.push(currentName);

			Object.keys(graph[currentName] || {}).forEach((neighborName) => {
				if (!visitedNodeNames.has(neighborName)) {
					visitedNodeNames.add(neighborName);
					stack.push(neighborName);
				}
			});
		}

		components.push({ nodeNames });
	});

	return components;
}

function smoothLineCoordinatesForDisplay(coordinates, config = VISUAL_LINE_SMOOTHING_CONFIG) {
	if (!config?.enabled || !Array.isArray(coordinates) || coordinates.length < 3) {
		return coordinates;
	}

	if (config.method === "catmullRom") {
		return getCatmullRomSplineCoordinates(coordinates, config);
	}

	const sampleCountLimit = Math.max(1, Number.parseInt(config.maxSamples, 10) || 12);
	const smoothingFactorLimit = Math.max(0, Number(config.maxFactor) || 0.5);
	const segmentCutShareLimit = Math.max(0, Math.min(0.5, Number(config.maxSegmentCutShare) || 0.48));
	const sampleCount = Math.max(1, Math.min(sampleCountLimit, Number.parseInt(config.samples, 10) || 6));
	const smoothingFactor = Math.max(0, Math.min(smoothingFactorLimit, Number(config.factor) || 0));
	const maxDistance = Math.max(0, Number(config.maxDistance) || 0);
	const smoothingPasses = Math.max(1, Math.min(4, Number.parseInt(config.passes, 10) || 1));
	if (smoothingFactor <= 0 || maxDistance <= 0) {
		return coordinates;
	}

	let currentCoordinates = coordinates;
	for (let passIndex = 0; passIndex < smoothingPasses; passIndex += 1) {
		const smoothedCoordinates = [currentCoordinates[0]];
		for (let index = 1; index < currentCoordinates.length - 1; index += 1) {
			const prev = currentCoordinates[index - 1];
			const curr = currentCoordinates[index];
			const next = currentCoordinates[index + 1];
			const distanceToPrev = getCoordinateDistance(curr, prev);
			const distanceToNext = getCoordinateDistance(curr, next);
			const cornerSmoothingMultiplier = getCornerSmoothingMultiplier(prev, curr, next);
			const adjustedSmoothingFactor = Math.max(smoothingFactor, smoothingFactor * cornerSmoothingMultiplier);
			const cutDistance = Math.min(
				distanceToPrev * adjustedSmoothingFactor,
				distanceToNext * adjustedSmoothingFactor,
				distanceToPrev * segmentCutShareLimit,
				distanceToNext * segmentCutShareLimit,
				maxDistance
			);
			if (cutDistance < 0.5 || distanceToPrev === 0 || distanceToNext === 0) {
				smoothedCoordinates.push(curr);
				continue;
			}

			const curveStart = moveCoordinateTowards(curr, prev, cutDistance / distanceToPrev);
			const curveEnd = moveCoordinateTowards(curr, next, cutDistance / distanceToNext);
			smoothedCoordinates.push(curveStart);
			for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
				smoothedCoordinates.push(getQuadraticBezierPoint(curveStart, curr, curveEnd, sampleIndex / sampleCount));
			}
			smoothedCoordinates.push(curveEnd);
		}
		smoothedCoordinates.push(currentCoordinates[currentCoordinates.length - 1]);
		currentCoordinates = smoothedCoordinates;
	}
	return currentCoordinates;
}

function getCatmullRomSplineCoordinates(coordinates, config = VISUAL_LINE_CATMULL_ROM_CONFIG) {
	const sampleCount = Math.max(1, Number.parseInt(config.samples, 10) || 8);
	const tension = Math.max(0, Math.min(1, Number(config.tension) || 0.5));
	const smoothedCoordinates = [coordinates[0]];

	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const previous = coordinates[Math.max(0, index - 1)];
		const current = coordinates[index];
		const next = coordinates[index + 1];
		const following = coordinates[Math.min(coordinates.length - 1, index + 2)];

		for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
			smoothedCoordinates.push(getCatmullRomPoint(previous, current, next, following, sampleIndex / sampleCount, tension));
		}
	}

	return smoothedCoordinates;
}

function getCatmullRomPoint(previous, current, next, following, t, tension) {
	const t2 = t * t;
	const t3 = t2 * t;
	const tangentScale = tension;
	const tangentStartX = (Number(next[0]) - Number(previous[0])) * tangentScale;
	const tangentStartY = (Number(next[1]) - Number(previous[1])) * tangentScale;
	const tangentEndX = (Number(following[0]) - Number(current[0])) * tangentScale;
	const tangentEndY = (Number(following[1]) - Number(current[1])) * tangentScale;
	const basisStart = 2 * t3 - 3 * t2 + 1;
	const basisTangentStart = t3 - 2 * t2 + t;
	const basisEnd = -2 * t3 + 3 * t2;
	const basisTangentEnd = t3 - t2;

	return [
		basisStart * Number(current[0]) + basisTangentStart * tangentStartX + basisEnd * Number(next[0]) + basisTangentEnd * tangentEndX,
		basisStart * Number(current[1]) + basisTangentStart * tangentStartY + basisEnd * Number(next[1]) + basisTangentEnd * tangentEndY,
	];
}

function getCoordinateDistance(first, second) {
	const deltaX = Number(first?.[0]) - Number(second?.[0]);
	const deltaY = Number(first?.[1]) - Number(second?.[1]);
	return Math.hypot(deltaX, deltaY);
}

function getCornerSmoothingMultiplier(prev, curr, next) {
	const incomingX = Number(curr?.[0]) - Number(prev?.[0]);
	const incomingY = Number(curr?.[1]) - Number(prev?.[1]);
	const outgoingX = Number(next?.[0]) - Number(curr?.[0]);
	const outgoingY = Number(next?.[1]) - Number(curr?.[1]);
	const incomingLength = Math.hypot(incomingX, incomingY);
	const outgoingLength = Math.hypot(outgoingX, outgoingY);
	if (incomingLength === 0 || outgoingLength === 0) {
		return 1;
	}

	const dotProduct = (incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength);
	const turnAngle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
	const turnStrength = Math.max(0, Math.min(1, turnAngle / Math.PI));
	return 1 + Math.pow(turnStrength, 1.35) * 0.85;
}

function moveCoordinateTowards(from, to, ratio) {
	return [
		Number(from[0]) + (Number(to[0]) - Number(from[0])) * ratio,
		Number(from[1]) + (Number(to[1]) - Number(from[1])) * ratio,
	];
}

function getQuadraticBezierPoint(start, control, end, t) {
	const inverseT = 1 - t;
	return [
		inverseT * inverseT * Number(start[0]) + 2 * inverseT * t * Number(control[0]) + t * t * Number(end[0]),
		inverseT * inverseT * Number(start[1]) + 2 * inverseT * t * Number(control[1]) + t * t * Number(end[1]),
	];
}
