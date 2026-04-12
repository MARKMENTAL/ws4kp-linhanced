// regional observations display

import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	createMap,
	addBaseLayers,
	setPrimaryLocationMarker,
	loadNearbyObservationMarkers,
	clearMarkers,
} from './utils/leaflet-weather-map.mjs';

class RegionalForecast extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Regional Observations', true);
		this.timing.totalScreens = 1;
		this.map = null;
		this.baseLayer = null;
		this.boundaryLayer = null;
		this.locationMarker = null;
		this.nearbyMarkers = [];
		this.nearbyMarkersKey = '';
		this.refreshingMarkers = false;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		try {
			if (!window.L) {
				throw new Error('Leaflet is not available');
			}

			await this.ensureMap();
			this.map.invalidateSize();
			this.map.setView([this.weatherParameters.latitude, this.weatherParameters.longitude], 6);
			this.locationMarker = setPrimaryLocationMarker(
				this.map,
				this.locationMarker,
				this.weatherParameters.latitude,
				this.weatherParameters.longitude,
			);
			this.nearbyMarkers = clearMarkers(this.map, this.nearbyMarkers);
			this.nearbyMarkersKey = '';

			this.timing.totalScreens = 1;
			this.setStatus(STATUS.loaded);
		} catch (error) {
			console.error(`Failed to initialize regional observations: ${error.message}`);
			this.nearbyMarkers = clearMarkers(this.map, this.nearbyMarkers);
			this.timing.totalScreens = 0;
			if (this.isEnabled) this.setStatus(STATUS.failed);
		}
	}

	async refreshNearbyMarkers() {
		if (!this.map || !this.active || this.refreshingMarkers) return;

		this.refreshingMarkers = true;

		try {
			this.map.invalidateSize(false);
			this.map.setView([this.weatherParameters.latitude, this.weatherParameters.longitude], 6);

			const bounds = this.map.getBounds();
			const markerKey = [
				this.weatherParameters.latitude.toFixed(2),
				this.weatherParameters.longitude.toFixed(2),
				bounds.getSouth().toFixed(2),
				bounds.getWest().toFixed(2),
				bounds.getNorth().toFixed(2),
				bounds.getEast().toFixed(2),
			].join(':');

			if (this.nearbyMarkers.length > 0 && this.nearbyMarkersKey === markerKey) return;

			this.nearbyMarkers = clearMarkers(this.map, this.nearbyMarkers);
			this.nearbyMarkers = await loadNearbyObservationMarkers(this.map, {
				latitude: this.weatherParameters.latitude,
				longitude: this.weatherParameters.longitude,
			});
			this.nearbyMarkers.forEach((marker) => marker.addTo(this.map));
			this.nearbyMarkersKey = markerKey;
		} finally {
			this.refreshingMarkers = false;
		}
	}

	async ensureMap() {
		if (this.map) return;

		const mapElement = this.elem.querySelector('.leaflet-map');
		if (!mapElement) {
			throw new Error('Regional observations map container not found');
		}

		this.map = createMap(mapElement);
		({ baseLayer: this.baseLayer, boundaryLayer: this.boundaryLayer } = addBaseLayers(this.map));
	}

	drawCanvas() {
		super.drawCanvas();
		const titleTop = this.elem.querySelector('.title.dual .top');
		const titleBottom = this.elem.querySelector('.title.dual .bottom');
		titleTop.innerHTML = 'Regional';
		titleBottom.innerHTML = 'Observations';

		if (this.map) {
			this.map.invalidateSize(false);
		}

		this.finishDraw();
	}

	async showCanvas(navCmd) {
		super.showCanvas(navCmd);
		await this.refreshNearbyMarkers();
	}
}

registerDisplay(new RegionalForecast(6, 'regional-forecast'));
