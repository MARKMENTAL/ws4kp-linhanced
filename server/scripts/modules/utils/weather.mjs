import { safeJson } from './fetch.mjs';
import { debugFlag } from './debug.mjs';

const OPEN_METEO_FORECAST_PARAMETERS = [
	'daily=temperature_2m_max,temperature_2m_min,uv_index_max',
	'hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover,visibility,uv_index,is_day,sunshine_duration,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
	'timezone=auto',
	'models=best_match',
].join('&');

const OPEN_METEO_RADAR_OBSERVATION_PARAMETERS = [
	'hourly=temperature_2m,weather_code,is_day',
	'forecast_days=1',
	'timezone=auto',
	'models=best_match',
].join('&');

const OPEN_METEO_OBSERVATION_CACHE_TTL_MS = 10 * 60 * 1000;
const OPEN_METEO_TRAVEL_FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
const openMeteoObservationCache = new Map();
const openMeteoTravelForecastCache = new Map();

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
		timezone: forecast.timezone,
	};

	openMeteoObservationCache.set(cacheKey, {
		data: snapshot,
		fetchedAt: now,
	});

	return snapshot;
};

const weatherConditions = [
	{ codes: [0], text: ['Clear sky'] },
	{ codes: [1, 2, 3], text: ['Mainly clear', 'Partly cloudy', 'Overcast'] },
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
	getAggregatedOpenMeteoForecast,
	getCachedAggregatedOpenMeteoForecast,
	getOpenMeteoObservationSnapshot,
	aggregateWeatherForecastData,
	getConditionText,
};
