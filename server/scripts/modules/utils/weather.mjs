import { DateTime, Duration } from '../../vendor/auto/luxon.mjs';
import parseIconUrl from '../icons/icons-parse.mjs';
import { safeJson } from './fetch.mjs';
import { debugFlag } from './debug.mjs';
import { enhanceObservationWithMapClick } from './mapclick.mjs';

const OPEN_METEO_FORECAST_PARAMETERS = [
	'daily=temperature_2m_max,temperature_2m_min,uv_index_max',
	'hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover,visibility,uv_index,is_day,sunshine_duration,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
	'timezone=auto',
	'models=best_match',
].join('&');

const OPEN_METEO_RADAR_OBSERVATION_PARAMETERS = [
	'hourly=temperature_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
	'forecast_days=1',
	'timezone=auto',
	'models=best_match',
].join('&');

const OPEN_METEO_OBSERVATION_CACHE_TTL_MS = 10 * 60 * 1000;
const OPEN_METEO_TRAVEL_FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
const NOAA_CURRENT_OBSERVATION_CACHE_TTL_MS = 5 * 60 * 1000;
const openMeteoObservationCache = new Map();
const openMeteoTravelForecastCache = new Map();
const noaaCurrentObservationCache = new Map();

const NOAA_ICON_TO_WEATHER_CODE = {
	skc: 0,
	few: 1,
	sct: 2,
	bkn: 2,
	ovc: 3,
	wind_skc: 0,
	wind_few: 1,
	wind_sct: 2,
	wind_bkn: 2,
	wind_ovc: 3,
	wind_: 0,
	fog: 45,
	haze: 45,
	smoke: 45,
	dust: 45,
	rain: 61,
	rain_showers: 80,
	rain_showers_hi: 80,
	rain_showers_high: 80,
	fzra: 66,
	rain_fzra: 66,
	snow_fzra: 67,
	sleet: 77,
	rain_sleet: 77,
	snow_sleet: 77,
	winter_mix: 77,
	snow: 71,
	blizzard: 75,
	rain_snow: 77,
	tsra: 95,
	tsra_sct: 95,
	tsra_hi: 95,
	tornado: 99,
	hurricane: 99,
	tropical_storm: 95,
	hot: 0,
	cold: 0,
};

const NOAA_FORECAST_MIN_HOURLY_COUNT = 18;
const NOAA_FORECAST_MIN_DAILY_COUNT = 3;
const NOAA_FORECAST_CORE_COMPLETENESS_THRESHOLD = 0.9;
const NOAA_FORECAST_SUPPORT_COMPLETENESS_THRESHOLD = 0.8;
const NOAA_FORECAST_MAX_FALLBACK_RATIO = 0.25;
const NOAA_OBSERVATION_MAX_AGE_MINUTES = 120;

const NOAA_GRID_FIELD_CANDIDATES = {
	relative_humidity_2m: ['relativeHumidity'],
	dew_point_2m: ['dewpoint'],
	cloud_cover: ['skyCover'],
	visibility: ['visibility'],
	pressure_msl: ['pressure', 'barometricPressure', 'seaLevelPressure'],
	surface_pressure: ['pressure', 'barometricPressure', 'seaLevelPressure'],
	wind_gusts_10m: ['windGust'],
	apparent_temperature: ['apparentTemperature'],
	wind_speed_10m: ['windSpeed'],
	wind_direction_10m: ['windDirection'],
	precipitation_probability: ['probabilityOfPrecipitation'],
	precipitation: ['quantitativePrecipitation'],
	snowfall: ['snowfallAmount'],
	uv_index: ['probabilityOfThunder'],
};

const HOURLY_FORECAST_FIELDS = [
	'temperature_2m',
	'relative_humidity_2m',
	'dew_point_2m',
	'apparent_temperature',
	'precipitation_probability',
	'precipitation',
	'rain',
	'showers',
	'snowfall',
	'snow_depth',
	'weather_code',
	'pressure_msl',
	'surface_pressure',
	'cloud_cover',
	'visibility',
	'uv_index',
	'is_day',
	'sunshine_duration',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m',
];

const DAILY_FORECAST_FIELDS = [
	'temperature_2m_max',
	'temperature_2m_min',
	'uv_index_max',
];

const getPoint = async (lat, lon) => {
	const point = await safeJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
	if (!point) {
		if (debugFlag('verbose-failures')) {
			console.warn(`Unable to get points for ${lat},${lon}`);
		}
		return false;
	}
	return point;
};

const parseNoaaValidTimeInterval = (validTime) => {
	if (!validTime || !validTime.includes('/')) return null;
	const [startIso, durationIso] = validTime.split('/');
	const start = DateTime.fromISO(startIso);
	const duration = Duration.fromISO(durationIso);
	if (!start.isValid || !duration.isValid) return null;
	return {
		start,
		end: start.plus(duration),
	};
};

const expandNoaaGridValue = (gridEntry) => {
	const interval = parseNoaaValidTimeInterval(gridEntry?.validTime);
	if (!interval) return null;
	return {
		...interval,
		value: gridEntry?.value ?? null,
	};
};

const cardinalToDegrees = (direction) => {
	const map = {
		N: 0,
		NNE: 22.5,
		NE: 45,
		ENE: 67.5,
		E: 90,
		ESE: 112.5,
		SE: 135,
		SSE: 157.5,
		S: 180,
		SSW: 202.5,
		SW: 225,
		WSW: 247.5,
		W: 270,
		WNW: 292.5,
		NW: 315,
		NNW: 337.5,
	};
	return map[(direction ?? '').trim().toUpperCase()] ?? 0;
};

const parseNoaaWindDirectionString = (directionText) => {
	if (typeof directionText !== 'string' || directionText.length === 0) return 0;
	return cardinalToDegrees(directionText);
};

const parseNoaaWindSpeedString = (windSpeedText) => {
	if (typeof windSpeedText !== 'string' || windSpeedText.length === 0) return null;
	const normalized = windSpeedText.trim().toLowerCase();
	const values = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => parseFloat(match[0]));
	if (values.length === 0) return null;
	const baseValue = values[values.length - 1];
	if (normalized.includes('kt')) return baseValue * 1.852;
	if (normalized.includes('mph')) return baseValue * 1.609344;
	if (normalized.includes('km/h')) return baseValue;
	if (normalized.includes('m/s')) return baseValue * 3.6;
	return baseValue;
};

const convertNoaaValueByUom = (value, uom) => {
	if (value === null || value === undefined) return null;
	switch (uom) {
		case 'wmoUnit:degC':
			return value;
		case 'wmoUnit:degF':
			return (value - 32) * 5 / 9;
		case 'wmoUnit:km_h-1':
			return value;
		case 'wmoUnit:m_s-1':
			return value * 3.6;
		case 'wmoUnit:kn':
			return value * 1.852;
		case 'wmoUnit:mph':
			return value * 1.609344;
		case 'wmoUnit:Pa':
			return value / 100;
		case 'wmoUnit:hPa':
			return value;
		case 'wmoUnit:m':
			return value;
		case 'wmoUnit:km':
			return value * 1000;
		case 'wmoUnit:mi':
			return value * 1609.344;
		case 'wmoUnit:percent':
		case '%':
			return value;
		case 'wmoUnit:degree_(angle)':
			return value;
		case 'wmoUnit:mm':
			return value;
		case 'wmoUnit:cm':
			return value * 10;
		case 'wmoUnit:in':
			return value * 25.4;
		default:
			return value;
	}
};

const getGridValueAtTime = (gridProperty, targetTime) => {
	const target = typeof targetTime === 'string' ? DateTime.fromISO(targetTime) : targetTime;
	if (!gridProperty?.values?.length || !target?.isValid) return null;
	for (const entry of gridProperty.values) {
		const expanded = expandNoaaGridValue(entry);
		if (!expanded) continue;
		if (target >= expanded.start && target < expanded.end) {
			return expanded.value;
		}
	}
	return null;
};

const getNearestGridValueAtTime = (gridProperty, targetTime, toleranceHours = 6) => {
	const target = typeof targetTime === 'string' ? DateTime.fromISO(targetTime) : targetTime;
	if (!gridProperty?.values?.length || !target?.isValid) return null;
	let best = null;
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const entry of gridProperty.values) {
		const expanded = expandNoaaGridValue(entry);
		if (!expanded) continue;
		const midpoint = expanded.start.plus({
			milliseconds: expanded.end.diff(expanded.start, 'milliseconds').milliseconds / 2,
		});
		const delta = Math.abs(midpoint.toMillis() - target.toMillis());
		if (delta < bestDelta) {
			bestDelta = delta;
			best = expanded.value;
		}
	}
	if (bestDelta > toleranceHours * 60 * 60 * 1000) return null;
	return best;
};

const getNormalizedGridValueAtTime = (gridProperty, targetTime) => {
	if (!gridProperty) return null;
	let value = getGridValueAtTime(gridProperty, targetTime);
	if (value === null || value === undefined) {
		value = getNearestGridValueAtTime(gridProperty, targetTime);
	}
	return convertNoaaValueByUom(value, gridProperty.uom);
};

const getGridFieldValueAtTime = (gridProperties, fieldName, targetTime) => {
	const candidates = NOAA_GRID_FIELD_CANDIDATES[fieldName] ?? [fieldName];
	for (const candidate of candidates) {
		const normalized = getNormalizedGridValueAtTime(gridProperties?.[candidate], targetTime);
		if (normalized !== null && normalized !== undefined) return normalized;
	}
	return null;
};

const inferCloudCoverFromToken = (token) => ({
	ovc: 100,
	bkn: 70,
	sct: 45,
	few: 20,
	skc: 0,
	wind_ovc: 100,
	wind_bkn: 70,
	wind_sct: 45,
	wind_few: 20,
	wind_skc: 0,
}[token] ?? null);

const mapNoaaIconTokenToWeatherCode = (token) => ({
	weatherCode: NOAA_ICON_TO_WEATHER_CODE[token] ?? 0,
	fallback: !(token in NOAA_ICON_TO_WEATHER_CODE),
});

const mapNoaaIconUrlToWeatherCode = (iconUrl, isNightTime) => {
	try {
		const { conditionIcon } = parseIconUrl(iconUrl, isNightTime);
		const mapped = mapNoaaIconTokenToWeatherCode(conditionIcon);
		return {
			...mapped,
			token: conditionIcon,
		};
	} catch {
		return {
			weatherCode: 0,
			fallback: true,
			token: 'unknown',
		};
	}
};

const inferPrecipFieldsFromToken = (token, precipitationValue, snowfallValue) => {
	const precipitation = precipitationValue ?? 0;
	const snowfall = snowfallValue ?? 0;
	return {
		rain: ['rain', 'rain_fzra', 'rain_sleet', 'rain_snow'].includes(token) ? (precipitation || 1) : 0,
		showers: ['rain_showers', 'rain_showers_hi', 'rain_showers_high'].includes(token) ? (precipitation || 1) : 0,
		snowfall: ['snow', 'blizzard', 'snow_sleet', 'snow_fzra', 'rain_snow', 'winter_mix'].includes(token) ? (snowfall || 1) : snowfall,
	};
};

const parseNoaaHourlyPeriod = (period, gridProperties) => {
	const targetTime = DateTime.fromISO(period.startTime);
	const temperatureC = convertNoaaValueByUom(period.temperature, period.temperatureUnit === 'F' ? 'wmoUnit:degF' : 'wmoUnit:degC');
	const windSpeedKmh = parseNoaaWindSpeedString(period.windSpeed);
	const windDirectionDegrees = parseNoaaWindDirectionString(period.windDirection);
	const iconMapping = mapNoaaIconUrlToWeatherCode(period.icon, !period.isDaytime);
	const precipitation = getGridFieldValueAtTime(gridProperties, 'precipitation', targetTime) ?? 0;
	const snowfall = getGridFieldValueAtTime(gridProperties, 'snowfall', targetTime) ?? 0;
	const precipFields = inferPrecipFieldsFromToken(iconMapping.token, precipitation, snowfall);
	return {
		time: period.startTime,
		temperature_2m: temperatureC,
		relative_humidity_2m: getGridFieldValueAtTime(gridProperties, 'relative_humidity_2m', targetTime),
		dew_point_2m: getGridFieldValueAtTime(gridProperties, 'dew_point_2m', targetTime) ?? temperatureC,
		apparent_temperature: getGridFieldValueAtTime(gridProperties, 'apparent_temperature', targetTime) ?? temperatureC,
		precipitation_probability: period.probabilityOfPrecipitation?.value
			?? getGridFieldValueAtTime(gridProperties, 'precipitation_probability', targetTime)
			?? 0,
		precipitation,
		rain: precipFields.rain,
		showers: precipFields.showers,
		snowfall: precipFields.snowfall,
		snow_depth: 0,
		weather_code: iconMapping.weatherCode,
		pressure_msl: getGridFieldValueAtTime(gridProperties, 'pressure_msl', targetTime),
		surface_pressure: getGridFieldValueAtTime(gridProperties, 'surface_pressure', targetTime),
		cloud_cover: getGridFieldValueAtTime(gridProperties, 'cloud_cover', targetTime) ?? inferCloudCoverFromToken(iconMapping.token),
		visibility: getGridFieldValueAtTime(gridProperties, 'visibility', targetTime),
		uv_index: getGridFieldValueAtTime(gridProperties, 'uv_index', targetTime) ?? 0,
		is_day: period.isDaytime ? 1 : 0,
		sunshine_duration: 0,
		wind_speed_10m: windSpeedKmh ?? getGridFieldValueAtTime(gridProperties, 'wind_speed_10m', targetTime) ?? 0,
		wind_direction_10m: windDirectionDegrees ?? getGridFieldValueAtTime(gridProperties, 'wind_direction_10m', targetTime) ?? 0,
		wind_gusts_10m: getGridFieldValueAtTime(gridProperties, 'wind_gusts_10m', targetTime) ?? 0,
		_weatherCodeFallback: iconMapping.fallback,
		_sourceIconToken: iconMapping.token,
	};
};

const buildNormalizedForecastResponse = (hourlyEntries) => {
	const hourly = { time: [] };
	HOURLY_FORECAST_FIELDS.forEach((field) => {
		hourly[field] = [];
	});
	const dailyBuckets = {};
	hourlyEntries.forEach((entry) => {
		hourly.time.push(entry.time);
		HOURLY_FORECAST_FIELDS.forEach((field) => {
			hourly[field].push(entry[field] ?? null);
		});
		const date = entry.time.split('T')[0];
		if (!dailyBuckets[date]) dailyBuckets[date] = [];
		dailyBuckets[date].push(entry);
	});
	const dailyDates = Object.keys(dailyBuckets).sort();
	const daily = { time: dailyDates };
	DAILY_FORECAST_FIELDS.forEach((field) => {
		daily[field] = [];
	});
	dailyDates.forEach((date) => {
		const entries = dailyBuckets[date];
		const temps = entries.map((entry) => entry.temperature_2m).filter((value) => value !== null && value !== undefined);
		const uvValues = entries.map((entry) => entry.uv_index ?? 0).filter((value) => value !== null && value !== undefined);
		daily.temperature_2m_max.push(temps.length ? Math.max(...temps) : null);
		daily.temperature_2m_min.push(temps.length ? Math.min(...temps) : null);
		daily.uv_index_max.push(uvValues.length ? Math.max(...uvValues) : 0);
	});
	return { hourly, daily };
};

const percentValid = (entries, fieldName, validator = (value) => value !== null && value !== undefined) => {
	if (!entries.length) return 0;
	return entries.filter((entry) => validator(entry[fieldName])).length / entries.length;
};

const validateNormalizedNoaaForecast = (hourlyEntries, aggregatedForecast) => {
	const reasons = [];
	const hourlyCount = hourlyEntries.length;
	const dailyCount = Object.values(aggregatedForecast ?? {}).filter((day) => day
		&& day.temperature_2m_max !== null
		&& day.temperature_2m_min !== null
		&& day.weather_code !== null
		&& day.weather_code !== undefined).length;
	const timePct = percentValid(hourlyEntries, 'time');
	const temperaturePct = percentValid(hourlyEntries, 'temperature_2m', (value) => value !== null && value !== undefined && !Number.isNaN(value));
	const weatherCodePct = percentValid(hourlyEntries, 'weather_code', Number.isInteger);
	const isDayPct = percentValid(hourlyEntries, 'is_day', (value) => value !== null && value !== undefined);
	const windSpeedPct = percentValid(hourlyEntries, 'wind_speed_10m', (value) => value !== null && value !== undefined && !Number.isNaN(value));
	const windDirectionPct = percentValid(hourlyEntries, 'wind_direction_10m', (value) => value !== null && value !== undefined && !Number.isNaN(value));
	const precipProbabilityPct = percentValid(hourlyEntries, 'precipitation_probability', (value) => value !== null && value !== undefined && !Number.isNaN(value));
	const weatherCodeFallbackPct = hourlyCount ? hourlyEntries.filter((entry) => entry._weatherCodeFallback).length / hourlyCount : 1;

	if (hourlyCount < NOAA_FORECAST_MIN_HOURLY_COUNT) reasons.push('insufficient-hourly-count');
	if (dailyCount < NOAA_FORECAST_MIN_DAILY_COUNT) reasons.push('insufficient-daily-count');
	if (timePct < NOAA_FORECAST_CORE_COMPLETENESS_THRESHOLD) reasons.push('missing-core-time');
	if (temperaturePct < NOAA_FORECAST_CORE_COMPLETENESS_THRESHOLD) reasons.push('missing-core-temperature');
	if (weatherCodePct < NOAA_FORECAST_CORE_COMPLETENESS_THRESHOLD) reasons.push('missing-core-weather-code');
	if (isDayPct < NOAA_FORECAST_CORE_COMPLETENESS_THRESHOLD) reasons.push('missing-core-day-flag');
	if (windSpeedPct < NOAA_FORECAST_SUPPORT_COMPLETENESS_THRESHOLD) reasons.push('missing-support-wind-speed');
	if (windDirectionPct < NOAA_FORECAST_SUPPORT_COMPLETENESS_THRESHOLD) reasons.push('missing-support-wind-direction');
	if (precipProbabilityPct < NOAA_FORECAST_SUPPORT_COMPLETENESS_THRESHOLD) reasons.push('missing-support-precip-probability');
	if (weatherCodeFallbackPct > NOAA_FORECAST_MAX_FALLBACK_RATIO) reasons.push('too-many-weather-code-fallbacks');

	return {
		accepted: reasons.length === 0,
		reasons,
		stats: {
			hourlyCount,
			dailyCount,
			timePct,
			temperaturePct,
			weatherCodePct,
			isDayPct,
			windSpeedPct,
			windDirectionPct,
			precipProbabilityPct,
			weatherCodeFallbackPct,
		},
	};
};

const getNoaaHourlyForecast = async (forecastHourlyUrl) => safeJson(forecastHourlyUrl);

const getNoaaDailyForecast = async (forecastUrl) => safeJson(forecastUrl);

const getNoaaForecastGridData = async (gridUrl) => safeJson(gridUrl);

const normalizeNoaaHourlyForecast = (hourlyForecast, gridData) => {
	const periods = hourlyForecast?.properties?.periods ?? [];
	const gridProperties = gridData?.properties ?? {};
	return periods.map((period) => parseNoaaHourlyPeriod(period, gridProperties));
};

const getAggregatedNoaaForecast = async (pointProperties) => {
	if (!pointProperties?.forecastHourly) return false;
	const [hourlyForecast, gridData] = await Promise.all([
		getNoaaHourlyForecast(pointProperties.forecastHourly),
		pointProperties.forecastGridData ? getNoaaForecastGridData(pointProperties.forecastGridData) : Promise.resolve(null),
	]);
	if (!hourlyForecast?.properties?.periods?.length) return false;
	const hourlyEntries = normalizeNoaaHourlyForecast(hourlyForecast, gridData);
	const normalizedForecastResponse = buildNormalizedForecastResponse(hourlyEntries);
	const aggregatedForecast = aggregateWeatherForecastData(normalizedForecastResponse);
	if (!aggregatedForecast) return false;
	const validation = validateNormalizedNoaaForecast(hourlyEntries, aggregatedForecast);
	return {
		hourlyEntries,
		forecast: normalizedForecastResponse,
		aggregatedForecast,
		validation,
	};
};

const validateNoaaCurrentObservation = (observation, now = Date.now()) => {
	if (!observation) {
		return { accepted: false, reason: 'missing-observation', ageMinutes: null };
	}
	const ageMinutes = observation.timestamp ? (now - new Date(observation.timestamp).getTime()) / 60000 : null;
	const hasCondition = observation.weatherCode !== null && observation.weatherCode !== undefined;
	if (observation.temperature === null || observation.temperature === undefined || observation.windSpeed === null || observation.windSpeed === undefined || observation.windDirection === null || observation.windDirection === undefined || !hasCondition) {
		return { accepted: false, reason: 'missing-core-fields', ageMinutes };
	}
	if (ageMinutes !== null && !Number.isNaN(ageMinutes) && ageMinutes > NOAA_OBSERVATION_MAX_AGE_MINUTES) {
		return { accepted: false, reason: 'stale-observation', ageMinutes };
	}
	return { accepted: true, reason: 'ok', ageMinutes };
};

const normalizeNoaaObservation = (properties, source = 'noaa') => {
	const iconMapping = mapNoaaIconUrlToWeatherCode(properties.icon, undefined);
	let isDay = true;
	try {
		isDay = !parseIconUrl(properties.icon).isNightTime;
	} catch {
		isDay = true;
	}
	return {
		timestamp: properties.timestamp,
		temperature: convertNoaaValueByUom(properties.temperature?.value ?? null, properties.temperature?.unitCode),
		dewPoint: convertNoaaValueByUom(properties.dewpoint?.value ?? null, properties.dewpoint?.unitCode),
		relativeHumidity: properties.relativeHumidity?.value ?? null,
		pressure: convertNoaaValueByUom(
			properties.barometricPressure?.value ?? properties.seaLevelPressure?.value ?? null,
			properties.barometricPressure?.unitCode ?? properties.seaLevelPressure?.unitCode
		),
		visibility: convertNoaaValueByUom(properties.visibility?.value ?? null, properties.visibility?.unitCode),
		windSpeed: convertNoaaValueByUom(properties.windSpeed?.value ?? null, properties.windSpeed?.unitCode),
		windGust: convertNoaaValueByUom(properties.windGust?.value ?? null, properties.windGust?.unitCode),
		windDirection: convertNoaaValueByUom(properties.windDirection?.value ?? null, properties.windDirection?.unitCode) ?? 0,
		weatherCode: iconMapping.weatherCode,
		icon: properties.icon,
		textDescription: properties.textDescription ?? '',
		isDay,
		_source: source,
	};
};

const getNoaaCurrentObservation = async (stationFeature) => {
	const stationUrl = stationFeature?.id ?? stationFeature?.properties?.['@id'];
	if (!stationUrl) return false;
	const latestObservationUrl = `${stationUrl.replace(/\/$/, '')}/observations/latest`;
	return safeJson(latestObservationUrl);
};

const getBestUsCurrentObservation = async (weatherParameters) => {
	const stationId = weatherParameters?.stationId;
	const stationFeature = weatherParameters?.stations?.find((station) => station.properties?.stationIdentifier === stationId)
		?? weatherParameters?.stations?.[0];
	if (!stationFeature || !stationId) return false;
	const cacheKey = stationId;
	const now = Date.now();
	const cached = noaaCurrentObservationCache.get(cacheKey);
	if (cached && (now - cached.fetchedAt) < NOAA_CURRENT_OBSERVATION_CACHE_TTL_MS) {
		return cached.data;
	}
	const rawObservation = await getNoaaCurrentObservation(stationFeature);
	if (!rawObservation?.properties) return false;
	const enhanced = await enhanceObservationWithMapClick(rawObservation.properties, {
		stationId,
		debugContext: 'noaa-current-observation',
		maxAgeMinutes: NOAA_OBSERVATION_MAX_AGE_MINUTES,
		requiredFields: [
			{ name: 'temperature', check: (data) => data.temperature?.value === null || data.temperature?.value === undefined },
			{ name: 'windSpeed', check: (data) => data.windSpeed?.value === null || data.windSpeed?.value === undefined },
			{ name: 'windDirection', check: (data) => data.windDirection?.value === null || data.windDirection?.value === undefined },
			{ name: 'icon', check: (data) => !data.icon && !data.textDescription },
			{ name: 'dewpoint', check: (data) => data.dewpoint?.value === null || data.dewpoint?.value === undefined, required: false },
			{ name: 'humidity', check: (data) => data.relativeHumidity?.value === null || data.relativeHumidity?.value === undefined, required: false },
			{ name: 'pressure', check: (data) => (data.barometricPressure?.value ?? data.seaLevelPressure?.value) === null || (data.barometricPressure?.value ?? data.seaLevelPressure?.value) === undefined, required: false },
			{ name: 'visibility', check: (data) => data.visibility?.value === null || data.visibility?.value === undefined, required: false },
			{ name: 'windGust', check: (data) => data.windGust?.value === null || data.windGust?.value === undefined, required: false },
		],
		maxOptionalMissing: 3,
	});
	const normalized = normalizeNoaaObservation(enhanced.data, enhanced.wasImproved ? 'mapclick' : 'noaa');
	const validation = validateNoaaCurrentObservation(normalized, now);
	const result = validation.accepted ? { observation: normalized, source: normalized._source, validation } : false;
	if (result) {
		noaaCurrentObservationCache.set(cacheKey, { data: result, fetchedAt: now });
	}
	return result;
};

const getOpenMeteoForecast = async (lat, lon) => {
	const forecast = await safeJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${OPEN_METEO_FORECAST_PARAMETERS}`);
	if (!forecast) {
		if (debugFlag('verbose-failures')) {
			console.warn(`Unable to get Open-Meteo forecast for ${lat},${lon}`);
		}
		return false;
	}
	return forecast;
};

const getAggregatedOpenMeteoForecast = async (lat, lon) => {
	const forecast = await getOpenMeteoForecast(lat, lon);
	if (!forecast) return false;

	const aggregatedForecast = aggregateWeatherForecastData(forecast);
	if (!aggregatedForecast) {
		if (debugFlag('verbose-failures')) {
			console.warn(`Unable to aggregate Open-Meteo forecast for ${lat},${lon}`);
		}
		return false;
	}

	return {
		forecast,
		aggregatedForecast,
	};
};

const getCachedAggregatedOpenMeteoForecast = async (lat, lon) => {
	const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
	const cachedEntry = openMeteoTravelForecastCache.get(cacheKey);
	const now = Date.now();
	if (cachedEntry && (now - cachedEntry.fetchedAt) < OPEN_METEO_TRAVEL_FORECAST_CACHE_TTL_MS) {
		return cachedEntry.data;
	}

	const forecast = await getAggregatedOpenMeteoForecast(lat, lon);
	if (forecast) {
		openMeteoTravelForecastCache.set(cacheKey, {
			data: forecast,
			fetchedAt: now,
		});
		return forecast;
	}

	if (cachedEntry) {
		return cachedEntry.data;
	}

	return false;
};

const getOpenMeteoObservationSnapshot = async (lat, lon) => {
	const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
	const cachedEntry = openMeteoObservationCache.get(cacheKey);
	const now = Date.now();
	if (cachedEntry && (now - cachedEntry.fetchedAt) < OPEN_METEO_OBSERVATION_CACHE_TTL_MS) {
		return cachedEntry.data;
	}

	const forecast = await safeJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${OPEN_METEO_RADAR_OBSERVATION_PARAMETERS}`);
	if (!forecast?.hourly?.time?.length) {
		if (debugFlag('verbose-failures')) {
			console.warn(`Unable to get Open-Meteo radar observation snapshot for ${lat},${lon}`);
		}
		if (cachedEntry) {
			return cachedEntry.data;
		}
		return false;
	}

	let nearestIndex = 0;
	let nearestDelta = Number.POSITIVE_INFINITY;

	forecast.hourly.time.forEach((time, index) => {
		const delta = Math.abs(new Date(time).getTime() - now);
		if (delta < nearestDelta) {
			nearestDelta = delta;
			nearestIndex = index;
		}
	});

	const snapshot = {
		time: forecast.hourly.time[nearestIndex],
		temperature: forecast.hourly.temperature_2m?.[nearestIndex] ?? null,
		weatherCode: forecast.hourly.weather_code?.[nearestIndex] ?? 0,
		isDay: Boolean(forecast.hourly.is_day?.[nearestIndex] ?? 1),
		windSpeed: forecast.hourly.wind_speed_10m?.[nearestIndex] ?? 0,
		windGusts: forecast.hourly.wind_gusts_10m?.[nearestIndex] ?? 0,
		windDirection: forecast.hourly.wind_direction_10m?.[nearestIndex] ?? 0,
		timezone: forecast.timezone,
	};

	openMeteoObservationCache.set(cacheKey, {
		data: snapshot,
		fetchedAt: now,
	});

	return snapshot;
};

const weatherConditions = [
	{ codes: [0], text: ['Clear'] },
	{ codes: [1, 2, 3], text: ['Mostly Clear', 'Some Clouds', 'Overcast'] },
	{ codes: [45, 48], text: ['Fog', 'Depositing rime fog'] },
	{ codes: [51, 53, 55], text: ['Light Drizzle', 'Moderate Drizzle', 'Dense Drizzle'] },
	{ codes: [56, 57], text: ['Light Freezing Drizzle', 'Dense Freezing Drizzle'] },
	{ codes: [61, 63, 65], text: ['Slight Rain', 'Moderate Rain', 'Heavy Rain'] },
	{ codes: [66, 67], text: ['Light Freezing Rain', 'Heavy Freezing Rain'] },
	{ codes: [71, 73, 75], text: ['Slight Snow Fall', 'Moderate Snow Fall', 'Heavy Snow Fall'] },
	{ codes: [77], text: ['Snow Grains'] },
	{ codes: [80, 81, 82], text: ['Slight Rain Showers', 'Moderate Rain Showers', 'Violent Rain Showers'] },
	{ codes: [85, 86], text: ['Slight Snow Showers', 'Heavy Snow Showers'] },
	{ codes: [95], text: ['Thunderstorm'] },
	{ codes: [96, 99], text: ['Thunderstorm with Slight Hail', 'Thunderstorm with Heavy Hail'] },
];

// Wind descriptor thresholds (km/h)
const getWindDescriptor = (windSpeedKmh, windGustsKmh) => {
	// Use max of sustained wind or weighted gusts
	const maxWind = Math.max(windSpeedKmh, (windGustsKmh || 0) * 0.8);

	if (maxWind >= 56) return 'Very Windy';
	if (maxWind >= 36) return 'Windy';
	if (maxWind >= 21) return 'Breezy';
	return null;
};

// Get condition text with wind descriptor
const getConditionTextWithWind = (weatherCode, windSpeedKmh, windGustsKmh) => {
	const baseCondition = getConditionText(weatherCode);
	const windDesc = getWindDescriptor(windSpeedKmh, windGustsKmh);

	if (windDesc) {
		// For clear sky conditions, just use the wind descriptor
		if (weatherCode === 0) {
			return windDesc;
		}
		return `${baseCondition} ${windDesc}`;
	}
	return baseCondition;
};

const getConditionText = (code) => {
	const condition = weatherConditions.find((item) => item.codes.includes(Number(code)));
	if (!condition) {
		console.warn(`Unable to determine weather condition from code: ${code}`);
		return 'Unknown Conditions';
	}

	const index = condition.codes.findIndex((item) => item === Number(code));
	return condition.text[index];
};

const aggregateWeatherForecastData = (forecastResponse) => {
	if (!forecastResponse?.hourly || !forecastResponse?.daily) {
		console.warn('aggregateWeatherForecastData: missing hourly or daily forecast data.');
		return null;
	}

	const { hourly, daily } = forecastResponse;
	const keys = Object.keys(hourly).filter((key) => key !== 'time');
	const dailyData = {};

	hourly.time.forEach((timestamp, index) => {
		const date = timestamp.split('T')[0];

		if (!dailyData[date]) {
			dailyData[date] = { hours: [], weather_code_counts: {} };
			keys.forEach((key) => {
				dailyData[date][key] = { sum: 0, count: 0 };
			});
		}

		const hourData = { time: timestamp };
		keys.forEach((key) => {
			const value = hourly[key][index];
			hourData[key] = value;
			if (value !== null) {
				dailyData[date][key].sum += value;
				dailyData[date][key].count += 1;
			}
		});

		if (hourly.weather_code?.[index] !== undefined && hourly.weather_code[index] !== null) {
			const weatherCode = hourly.weather_code[index];
			dailyData[date].weather_code_counts[weatherCode] = (dailyData[date].weather_code_counts[weatherCode] || 0) + 1;
		}

		dailyData[date].hours.push(hourData);
	});

	const dailyAverages = {};
	Object.entries(dailyData).forEach(([date, data]) => {
		dailyAverages[date] = { hours: data.hours };
		keys.forEach((key) => {
			const { sum, count } = data[key];
			dailyAverages[date][key] = count > 0 ? sum / count : null;
		});

		const weatherCodes = Object.entries(data.weather_code_counts);
		if (weatherCodes.length > 0) {
			[dailyAverages[date].weather_code] = weatherCodes.reduce((a, b) => (b[1] > a[1] ? b : a));
		}
	});

	daily.time.forEach((date, index) => {
		if (!dailyAverages[date]) {
			dailyAverages[date] = { hours: [] };
		}
		dailyAverages[date].temperature_2m_max = daily.temperature_2m_max[index];
		dailyAverages[date].temperature_2m_min = daily.temperature_2m_min[index];
		dailyAverages[date].uv_index_max = daily.uv_index_max[index];
	});

	return dailyAverages;
};

export {
	getPoint,
	getOpenMeteoForecast,
	getAggregatedNoaaForecast,
	getBestUsCurrentObservation,
	getAggregatedOpenMeteoForecast,
	getCachedAggregatedOpenMeteoForecast,
	getOpenMeteoObservationSnapshot,
	aggregateWeatherForecastData,
	getConditionText,
	getWindDescriptor,
	getConditionTextWithWind,
	validateNormalizedNoaaForecast,
	validateNoaaCurrentObservation,
};
