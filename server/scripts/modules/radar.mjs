import STATUS from './status.mjs';
import { DateTime } from '../vendor/auto/luxon.mjs';
import { safeJson } from './utils/fetch.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	createMap,
	addBaseLayers,
	setPrimaryLocationMarker,
	loadNearbyObservationMarkers,
	clearMarkers,
} from './utils/leaflet-weather-map.mjs';

const RADAR_METADATA_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_METADATA_CACHE_TTL_MS = 2 * 60 * 1000;
let radarMetadataCache = null;

const getRadarMetadataCached = async (stillWaiting) => {
	const now = Date.now();
	if (radarMetadataCache && (now - radarMetadataCache.fetchedAt) < RADAR_METADATA_CACHE_TTL_MS) {
		return radarMetadataCache.data;
	}

	const radarMetadata = await safeJson(RADAR_METADATA_URL, {
		retryCount: 2,
		stillWaiting,
	});

	if (radarMetadata?.host && radarMetadata?.radar?.past?.length) {
		radarMetadataCache = {
			data: radarMetadata,
			fetchedAt: now,
		};
		return radarMetadata;
	}

	if (radarMetadataCache) {
		return radarMetadataCache.data;
	}

	return null;
};

class Radar extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Local Radar');

		this.okToDrawCurrentConditions = false;
		this.okToDrawCurrentDateTime = false;

		this.map = null;
		this.baseLayer = null;
		this.boundaryLayer = null;
		this.locationMarker = null;
		this.nearbyMarkers = [];
		this.radarLayers = [];
		this.mapFrames = [];
		this.radarHost = '';

		this.timing.baseDelay = 500;
		this.timing.delay = 1;
		this.maxFrames = 6;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		try {
			if (!window.L) {
				throw new Error('Leaflet is not available');
			}

			await this.ensureMap();
			this.map.invalidateSize();
			this.map.setView([this.weatherParameters.latitude, this.weatherParameters.longitude], 7);
			this.updateLocationMarker();
			await this.updateNearbyMarkers();

			const radarMetadata = await getRadarMetadataCached(() => this.stillWaiting());

			const frames = radarMetadata?.radar?.past?.slice(-this.maxFrames) ?? [];
			if (!frames.length || !radarMetadata?.host) {
				this.clearRadarLayers();
				this.timing.totalScreens = 0;
				this.setStatus(STATUS.noData);
				return;
			}

			this.radarHost = radarMetadata.host;
			this.mapFrames = frames;
			this.resetRadarLayers();
			this.timing.delay = this.buildTiming();
			this.calcNavTiming();
			this.resetNavBaseCount();
			this.showFrame(this.mapFrames.length - 1);
			this.setStatus(STATUS.loaded);
		} catch (error) {
			console.error(`Failed to initialize radar: ${error.message}`);
			this.clearRadarLayers();
			this.clearNearbyMarkers();
			this.timing.totalScreens = 0;
			if (this.isEnabled) this.setStatus(STATUS.failed);
		}
	}

	async ensureMap() {
		if (this.map) return;

		const mapElement = this.elem.querySelector('.leaflet-map');
		if (!mapElement) {
			throw new Error('Radar map container not found');
		}

		this.map = createMap(mapElement);
		({ baseLayer: this.baseLayer, boundaryLayer: this.boundaryLayer } = addBaseLayers(this.map));
	}

	resetRadarLayers() {
		this.clearRadarLayers();
		this.radarLayers = this.mapFrames.map((frame) => this.createRadarLayer(frame));
	}

	clearRadarLayers() {
		if (!this.map || !this.radarLayers.length) {
			this.radarLayers = [];
			return;
		}

		this.radarLayers.forEach((layer) => {
			if (this.map.hasLayer(layer)) {
				this.map.removeLayer(layer);
			}
		});
		this.radarLayers = [];
	}

	createRadarLayer(frame) {
		const tileUrl = `${this.radarHost}${frame.path}/256/{z}/{x}/{y}/4/1_0.png`;
		const layer = window.L.tileLayer(tileUrl, {
			tileSize: 256,
			opacity: 0,
			zIndex: frame.time,
			crossOrigin: true,
			updateWhenIdle: false,
			keepBuffer: 2,
			className: 'radar-precip-layer',
		});

		layer.addTo(this.map);
		return layer;
	}

	buildTiming() {
		const latestFrameIndex = this.mapFrames.length - 1;
		const sequence = [latestFrameIndex, ...this.mapFrames.map((_, index) => index), latestFrameIndex];
		return sequence.map((screenIndex, index) => {
			let time = 1;
			if (screenIndex === latestFrameIndex) {
				time = index === sequence.length - 1 ? 12 : 4;
			}
			return { si: screenIndex, time };
		});
	}

	updateLocationMarker() {
		if (!this.map) return;
		this.locationMarker = setPrimaryLocationMarker(
			this.map,
			this.locationMarker,
			this.weatherParameters.latitude,
			this.weatherParameters.longitude,
		);
	}

	clearNearbyMarkers() {
		this.nearbyMarkers = clearMarkers(this.map, this.nearbyMarkers);
	}

	async updateNearbyMarkers() {
		if (!this.map) return;

		this.clearNearbyMarkers();
		this.nearbyMarkers = await loadNearbyObservationMarkers(this.map, {
			latitude: this.weatherParameters.latitude,
			longitude: this.weatherParameters.longitude,
		});
		this.nearbyMarkers.forEach((marker) => marker.addTo(this.map));
	}

	showFrame(screenIndex) {
		if (!this.radarLayers.length || !this.mapFrames.length) return;

		const frameIndex = Math.max(0, Math.min(screenIndex, this.radarLayers.length - 1));
		this.radarLayers.forEach((layer, index) => {
			layer.setOpacity(index === frameIndex ? 0.8 : 0);
		});

		const time = DateTime.fromSeconds(this.mapFrames[frameIndex].time)
			.setZone(this.weatherParameters.timeZone)
			.toLocaleString(DateTime.TIME_SIMPLE);
		this.elem.querySelector('.header .right .time').innerHTML = time.length >= 8 ? time : `&nbsp;${time} `;
	}

	async drawCanvas() {
		super.drawCanvas();
		if (this.map) {
			this.map.invalidateSize(false);
			this.showFrame(this.screenIndex);
		}
		this.finishDraw();
	}
}

registerDisplay(new Radar(11, 'radar'));
