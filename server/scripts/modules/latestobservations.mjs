// Latest Observations display - shows current conditions for 7 nearby cities
import STATUS from './status.mjs';
import { directionToNSEW } from './utils/calc.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	temperature, windSpeed,
} from './utils/units.mjs';
import { getConditionText, getOpenMeteoObservationSnapshot } from './utils/weather.mjs';
import { loadRadarCities } from './utils/leaflet-weather-map.mjs';

class LatestObservations extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Latest Observations', true);
		this.nearbyCities = [];
		this.observations = [];
	}

	async getData(weatherParameters, refresh) {
		const superResult = super.getData(weatherParameters, refresh);
		this.data = await parseData(this.weatherParameters);
		if (!this.data) {
			this.setStatus(STATUS.failed);
			return superResult;
		}
		this.setStatus(STATUS.loaded);
		return superResult;
	}

	async drawCanvas() {
		super.drawCanvas();
		if (!this.data || this.data.length === 0) {
			this.finishDraw();
			return;
		}

		// Templates are extracted by WeatherDisplay.loadTemplates(), so rebuild rows from stored templates only.
		const container = this.elem.querySelector('.observation-lines');
		container.innerHTML = '';

		// Add observation rows
		this.data.forEach((obs) => {
			const row = this.fillTemplate('observation-row', {
				city: obs.city,
				temp: obs.temp,
				conditions: obs.conditions,
				wind: obs.wind,
			});
			if (row) container.appendChild(row);
		});

		this.finishDraw();
	}
}

// Truncate city name to 15 characters
const truncateCityName = (name) => {
	if (!name) return '';
	if (name.length <= 15) return name;
	return name.substring(0, 15);
};

// Shorten weather conditions (similar to currentweather.mjs)
const shortConditions = (condition) => {
	if (!condition) return '';

	// Apply abbreviations
	let result = condition;
	result = result.replace(/Light/g, 'Lt');
	result = result.replace(/Heavy/g, 'Hvy');
	result = result.replace(/Moderate/g, 'Mod');
	result = result.replace(/Partly/g, 'Pt');
	result = result.replace(/Mostly/g, 'Mt');
	result = result.replace(/Thunderstorm/g, 'T-storm');
	result = result.replace(/Freezing Rain/g, 'Frz Rn');
	result = result.replace(/Freezing/g, 'Frz');
	result = result.replace(/Drizzle/g, 'Drzl');
	result = result.replace(/Showers/g, 'Shwrs');
	result = result.replace(/Slight/g, 'Slt');

	// Truncate to 8 characters if still too long
	if (result.length > 8) {
		result = result.substring(0, 8);
	}

	return result;
};

// Calculate distance between two lat/lng points in meters (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
	const R = 6371e3; // Earth's radius in meters
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lon2 - lon1) * Math.PI) / 180;

	const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2)
		+ Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return R * c;
};

// Select nearby cities by distance (simpler version without map dependency)
const selectNearbyCitiesSimple = (sourceLocation, cities, maxCities = 7, minDistanceMeters = 15000) => {
	const citiesWithDistance = cities
		.map((city) => ({
			...city,
			distance: calculateDistance(
				sourceLocation.latitude,
				sourceLocation.longitude,
				city.lat,
				city.lon
			),
		}))
		.filter((city) => city.distance > minDistanceMeters)
		.sort((a, b) => a.distance - b.distance);

	return citiesWithDistance.slice(0, maxCities);
};

const parseData = async (weatherParameters) => {
	if (!weatherParameters?.latitude || !weatherParameters?.longitude) {
		return null;
	}

	// Load radar cities and select 7 nearby
	const radarCities = await loadRadarCities();
	if (!radarCities || radarCities.length === 0) {
		return null;
	}

	const nearbyCities = selectNearbyCitiesSimple({
		latitude: weatherParameters.latitude,
		longitude: weatherParameters.longitude,
	}, radarCities, 7, 15000);

	if (!nearbyCities || nearbyCities.length === 0) {
		return null;
	}

	// Fetch observations for each city
	const temperatureConverter = temperature();
	const windConverter = windSpeed();

	const observations = await Promise.all(
		nearbyCities.map(async (city) => {
			try {
				const observation = await getOpenMeteoObservationSnapshot(city.lat, city.lon);
				if (!observation || observation.temperature === null) {
					return null;
				}

				// Format condition text
				const conditionText = getConditionText(observation.weatherCode);
				const shortCondition = shortConditions(conditionText);

				// Format wind
				const windDir = directionToNSEW(observation.windDirection || 0);
				const windSpd = Math.round(windConverter(observation.windSpeed));
				const windText = windSpd > 0 ? `${windDir} ${windSpd}` : 'Calm';

				return {
					city: truncateCityName(city.name),
					temp: temperatureConverter(observation.temperature),
					conditions: shortCondition,
					wind: windText,
				};
			} catch (e) {
				console.warn(`Failed to get observation for ${city.name}:`, e);
				return null;
			}
		})
	);

	// Filter out failed observations and limit to 7
	return observations.filter((obs) => obs !== null).slice(0, 7);
};

const display = new LatestObservations(2, 'latest-observations');
registerDisplay(display);

export default display;
