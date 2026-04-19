import { aggregateWeatherForecastData } from '../server/scripts/modules/utils/weather.mjs';

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'WeatherStar 4000+: Linhanced; marky611@gmail.com';
const OPEN_METEO_FORECAST_PARAMETERS = [
	'daily=temperature_2m_max,temperature_2m_min,uv_index_max',
	'hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover,visibility,uv_index,is_day,sunshine_duration,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
	'timezone=auto',
	'models=best_match',
].join('&');

const parseLocationKey = (locationKey) => {
	if (typeof locationKey !== 'string') return null;
	const [latText, lonText] = locationKey.split(',');
	const lat = Number.parseFloat(latText);
	const lon = Number.parseFloat(lonText);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
};

const splitLocationLabel = (locationLabel = '') => {
	const [cityPart = 'Unknown', regionPart = ''] = locationLabel.split(',').map((part) => part.trim());
	const isUsStyleState = /^[A-Z]{2}$/.test(regionPart);
	return {
		city: cityPart || 'Unknown',
		state: isUsStyleState ? regionPart : '',
		country: isUsStyleState ? 'United States' : regionPart,
		countryCode: isUsStyleState ? 'US' : '',
	};
};

const fetchJson = async (url) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': USER_AGENT,
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Fetch error ${response.status} ${response.statusText} while fetching ${url}`);
		}

		return await response.json();
	} finally {
		clearTimeout(timeoutId);
	}
};

const buildWeatherParametersForLocation = async ({ locationKey, locationLabel }) => {
	const coordinates = parseLocationKey(locationKey);
	if (!coordinates) {
		throw new Error(`Invalid location key '${locationKey}' for derived hazard refresh`);
	}

	const { lat, lon } = coordinates;
	const locationParts = splitLocationLabel(locationLabel);
	const forecast = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${OPEN_METEO_FORECAST_PARAMETERS}`);
	const aggregatedForecast = aggregateWeatherForecastData(forecast);
	if (!aggregatedForecast) {
		throw new Error(`Unable to aggregate forecast for ${locationKey}`);
	}

	return {
		latitude: lat,
		longitude: lon,
		city: locationParts.city,
		state: locationParts.state,
		country: locationParts.country,
		countryCode: locationParts.countryCode,
		timeZone: forecast?.timezone || 'UTC',
		forecast: aggregatedForecast,
		supportsNoaaAlerts: false,
		primaryForecastSource: 'open-meteo',
	};
};

export {
	buildWeatherParametersForLocation,
	parseLocationKey,
	splitLocationLabel,
};
