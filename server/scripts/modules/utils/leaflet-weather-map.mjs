import { safePromiseAll } from './fetch.mjs';
import { loadData } from './data-loader.mjs';
import { getSmallIconFromWmoCode } from '../icons.mjs';
import { getOpenMeteoObservationSnapshot } from './weather.mjs';
import { temperature } from './units.mjs';
import { withBasePath } from './base-path.mjs';

const getBaseMapUrl = () => (window.WS4KP_SERVER_AVAILABLE
	? withBasePath('arcgis-server/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}')
	: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}');
const getBoundaryMapUrl = () => (window.WS4KP_SERVER_AVAILABLE
	? withBasePath('arcgis-services/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}')
	: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}');
const DEFAULT_MAX_NEARBY_MARKERS = 7;
const MIN_CITY_DISTANCE_METERS = 25000;
const MIN_MARKER_PIXEL_DISTANCE = 85;

let radarCitiesCache = null;

const createMap = (mapElement) => window.L.map(mapElement, {
	zoomControl: false,
	dragging: false,
	touchZoom: false,
	scrollWheelZoom: false,
	doubleClickZoom: false,
	boxZoom: false,
	keyboard: false,
	tap: false,
	attributionControl: false,
	preferCanvas: true,
});

const addBaseLayers = (map) => {
	const baseLayer = window.L.tileLayer(getBaseMapUrl(), {
		maxZoom: 10,
		minZoom: 1,
		crossOrigin: true,
		className: 'radar-base-layer',
	}).addTo(map);

	const boundaryLayer = window.L.tileLayer(getBoundaryMapUrl(), {
		maxZoom: 10,
		minZoom: 1,
		opacity: 0.6,
		crossOrigin: true,
		className: 'radar-boundary-layer',
	}).addTo(map);

	return { baseLayer, boundaryLayer };
};

const setPrimaryLocationMarker = (map, existingMarker, latitude, longitude) => {
	if (existingMarker && map.hasLayer(existingMarker)) {
		map.removeLayer(existingMarker);
	}

	return window.L.circleMarker([latitude, longitude], {
		radius: 5,
		color: '#000',
		weight: 2,
		fillColor: '#ff0',
		fillOpacity: 1,
		interactive: false,
		className: 'location-marker',
	}).addTo(map);
};

const loadRadarCities = async () => {
	if (!radarCitiesCache) {
		radarCitiesCache = await loadData('radarcities');
	}
	return radarCitiesCache ?? [];
};

const selectNearbyCities = (map, sourceLocation, cities, options = {}) => {
	const {
		maxMarkers = DEFAULT_MAX_NEARBY_MARKERS,
		minCityDistanceMeters = MIN_CITY_DISTANCE_METERS,
		minMarkerPixelDistance = MIN_MARKER_PIXEL_DISTANCE,
	} = options;

	const bounds = map.getBounds();
	const currentLatLng = window.L.latLng(sourceLocation.latitude, sourceLocation.longitude);
	const visibleCities = cities
		.filter((city) => bounds.contains([city.lat, city.lon]))
		.filter((city) => currentLatLng.distanceTo([city.lat, city.lon]) > minCityDistanceMeters)
		.map((city) => ({
			...city,
			distance: currentLatLng.distanceTo([city.lat, city.lon]),
			point: map.latLngToContainerPoint([city.lat, city.lon]),
		}))
		.sort((a, b) => a.distance - b.distance);

	const selected = [];
	visibleCities.forEach((city) => {
		if (selected.length >= maxMarkers) return;
		const overlaps = selected.some((existingCity) => existingCity.point.distanceTo(city.point) < minMarkerPixelDistance);
		if (!overlaps) selected.push(city);
	});

	if (selected.length === 0 && visibleCities.length > 0) {
		selected.push(visibleCities[0]);
	}

	return selected;
};

const buildNearbyWeatherMarker = (city, observation) => {
	const temperatureConverter = temperature();
	const icon = getSmallIconFromWmoCode(observation.weatherCode, observation.isDay);
	const markerHtml = `
		<div class="nearby-weather-marker-inner">
			<div class="city">${city.name}</div>
			<div class="details">
				<div class="temp">${temperatureConverter(observation.temperature)}</div>
				<img src="${icon}" alt="${city.name} weather" />
			</div>
		</div>`;

	return window.L.marker([city.lat, city.lon], {
		icon: window.L.divIcon({
			html: markerHtml,
			className: 'nearby-weather-marker',
			iconSize: [108, 52],
			iconAnchor: [54, 26],
		}),
		interactive: false,
		zIndexOffset: 500,
	});
};

const clearMarkers = (map, markers) => {
	if (!map || !markers?.length) return [];
	markers.forEach((marker) => {
		if (map.hasLayer(marker)) map.removeLayer(marker);
	});
	return [];
};

const loadNearbyObservationMarkers = async (map, sourceLocation, options = {}) => {
	const radarCities = await loadRadarCities();
	const nearbyCities = selectNearbyCities(map, sourceLocation, radarCities, options);
	if (!nearbyCities.length) return [];

	const nearbyObservations = await safePromiseAll(nearbyCities.map(async (city) => {
		const observation = await getOpenMeteoObservationSnapshot(city.lat, city.lon);
		if (!observation || observation.temperature === null) return null;
		return { city, observation };
	}));

	return nearbyObservations
		.filter((entry) => entry)
		.map(({ city, observation }) => buildNearbyWeatherMarker(city, observation));
};

export {
	createMap,
	addBaseLayers,
	setPrimaryLocationMarker,
	loadNearbyObservationMarkers,
	clearMarkers,
};
