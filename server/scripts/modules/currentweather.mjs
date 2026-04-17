// current weather conditions display
import STATUS from './status.mjs';
import { preloadImg } from './utils/image.mjs';
import { directionToNSEW } from './utils/calc.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import {
	temperature, windSpeed, pressure, distanceKilometers, distanceMeters,
} from './utils/units.mjs';
import { getConditionTextWithWind, getBestUsCurrentObservation } from './utils/weather.mjs';
import { getLargeIconFromWmoCodeWithWind } from './icons.mjs';

class CurrentWeather extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Current Conditions', true);
	}

	async getData(weatherParameters, refresh) {
		const superResult = super.getData(weatherParameters, refresh);
		this.data = await parseData(this.weatherParameters);

		if (!this.data) {
			if (this.isEnabled) this.setStatus(STATUS.failed);
			this.getDataCallback(undefined);
			return;
		}

		this.getDataCallback();

		if (!superResult) return;

		this.timing.totalScreens = 1;
		preloadImg(this.data.Icon);
		this.setStatus(STATUS.loaded);
	}

	async drawCanvas() {
		super.drawCanvas();

		let condition = getConditionTextWithWind(
		this.data.TextConditions,
		this.data.WindSpeedRaw,
		this.data.WindGustRaw
	);
		if (condition.length > 23) {
			condition = shortConditions(condition);
		}

		const wind = this.data.WindSpeed > 0
			? this.data.WindDirection.padEnd(3, '') + this.data.WindSpeed.toString().padStart(3, ' ')
			: 'Calm';
		const isDefaultTheme = (document.documentElement.dataset.theme ?? 'default') === 'default';
		const windText = !isDefaultTheme && this.data.WindGust > 0
			? `${wind} - Gusts to ${this.data.WindGust}`
			: wind;

		const fill = {
			temp: this.data.Temperature + String.fromCharCode(176),
			condition,
			wind: windText,
			location: this.data.city.substr(0, 20),
			humidity: `${this.data.Humidity}%`,
			dewpoint: this.data.DewPoint + String.fromCharCode(176),
			ceiling: this.data.Ceiling === 0 ? 'Unlimited' : `${this.data.Ceiling}${this.data.CeilingUnit}`,
			visibility: `${this.data.Visibility}${this.data.VisibilityUnit}`,
			pressure: this.data.PressureDirection ? `${this.data.Pressure} ${this.data.PressureDirection}` : this.data.Pressure,
			icon: { type: 'img', src: this.data.Icon },
		};

		if (isDefaultTheme && this.data.WindGust > 0) fill['wind-gusts'] = `Gusts to ${this.data.WindGust}`;

		const area = this.elem.querySelector('.main');
		area.innerHTML = '';
		area.append(this.fillTemplate('weather', fill));

		this.finishDraw();
	}

	async getCurrentWeather(stillWaiting) {
		this.setAutoReload();
		if (stillWaiting) this.stillWaitingCallbacks.push(stillWaiting);
		return new Promise((resolve) => {
			if (this.data) resolve({ data: this.data, parameters: this.weatherParameters });
			this.getDataCallbacks.push(() => resolve({ data: this.data, parameters: this.weatherParameters }));
		});
	}
}

const shortConditions = (_condition) => {
	let condition = _condition;
	condition = condition.replace(/Light/g, 'L');
	condition = condition.replace(/Heavy/g, 'H');
	condition = condition.replace(/Partly/g, 'P');
	condition = condition.replace(/Mostly/g, 'M');
	condition = condition.replace(/Thunderstorm/g, 'T\'storm');
	condition = condition.replace(/ and /g, ' ');
	condition = condition.replace(/Freezing Rain/g, 'Frz Rn');
	condition = condition.replace(/Freezing/g, 'Frz');
	condition = condition.replace(/ with /g, '/');
	return condition;
};

const getCurrentWeatherByHourFromTime = (data) => {
	const currentTime = new Date();
	const currentDateKey = currentTime.toLocaleDateString('en-CA', { timeZone: data.timeZone });
	const availableTimes = data.forecast[currentDateKey]?.hours ?? Object.values(data.forecast)[0]?.hours ?? [];
	if (availableTimes.length === 0) return null;

	const closestTime = availableTimes.reduce((prev, curr) => {
		const prevDiff = Math.abs(new Date(prev.time) - currentTime);
		const currDiff = Math.abs(new Date(curr.time) - currentTime);
		return currDiff < prevDiff ? curr : prev;
	});

	const threeHoursAgo = new Date(currentTime.getTime() - 3 * 60 * 60 * 1000);
	const previousHour = availableTimes
		.filter((entry) => new Date(entry.time) <= currentTime && new Date(entry.time) >= threeHoursAgo)
		.reduce((prev, curr) => {
			const prevDiff = Math.abs(new Date(prev.time) - threeHoursAgo);
			const currDiff = Math.abs(new Date(curr.time) - threeHoursAgo);
			return currDiff < prevDiff ? curr : prev;
		}, availableTimes[0]);

	const currentPressure = closestTime.pressure_msl;
	const previousPressure = previousHour.pressure_msl;
	let pressureTrend = '';
	if (Number.isFinite(currentPressure) && Number.isFinite(previousPressure)) {
		const diff = currentPressure - previousPressure;
		pressureTrend = 'Steady';
		if (diff > 0.5) pressureTrend = 'Rising';
		if (diff < -0.5) pressureTrend = 'Falling';
	}
	closestTime.pressureTrend = pressureTrend;
	closestTime.uv_index_max = data.forecast[currentDateKey]?.uv_index_max ?? closestTime.uv_index ?? 0;
	return closestTime;
};

const parseData = async (weatherParameters) => {
	if (weatherParameters.supportsNoaaDisplays && weatherParameters.stationId) {
		const observationResult = await getBestUsCurrentObservation(weatherParameters);
		if (observationResult?.observation) {
			weatherParameters.primaryObservationSource = observationResult.source;
			const currentForecast = getCurrentWeatherByHourFromTime(weatherParameters) ?? {};
			const observation = observationResult.observation;
			const temperatureConverter = temperature();
			const windConverter = windSpeed();
			const pressureConverter = pressure();
			const ceilingConverter = distanceMeters();
			const visibilityConverter = distanceKilometers();
			const ceilingMeters = Math.max(0, ((observation.temperature ?? 0) - (observation.dewPoint ?? 0)) * 68);
			const pressureValue = observation.pressure ?? currentForecast.pressure_msl ?? null;
			const resolvedWindGust = observation.windGust ?? currentForecast.wind_gusts_10m ?? 0;
			return {
				city: weatherParameters.city,
				timeZone: weatherParameters.timeZone,
				Temperature: temperatureConverter(observation.temperature),
				TemperatureUnit: temperatureConverter.units,
				DewPoint: temperatureConverter(observation.dewPoint),
				Ceiling: ceilingConverter(ceilingMeters),
				CeilingUnit: ceilingConverter.units,
				Visibility: visibilityConverter(observation.visibility),
				VisibilityUnit: visibilityConverter.units,
				WindSpeed: windConverter(observation.windSpeed),
				WindSpeedRaw: observation.windSpeed,
				WindDirection: directionToNSEW(observation.windDirection ?? 0),
				Pressure: pressureValue === null ? '-' : pressureConverter(pressureValue * 100),
				PressureDirection: pressureValue === null ? '' : (currentForecast.pressureTrend ?? ''),
				Humidity: Math.round(observation.relativeHumidity ?? currentForecast.relative_humidity_2m ?? 0),
				WindGust: windConverter(resolvedWindGust),
				WindGustRaw: resolvedWindGust,
				WindUnit: windConverter.units,
				TextConditions: Number(observation.weatherCode ?? 0),
				Icon: getLargeIconFromWmoCodeWithWind(
					observation.weatherCode,
					Boolean(observation.isDay),
					observation.windSpeed,
					resolvedWindGust
				),
			};
		}
	}

	weatherParameters.primaryObservationSource = 'forecast';
	const currentForecast = getCurrentWeatherByHourFromTime(weatherParameters);
	if (!currentForecast) return null;

	const temperatureConverter = temperature();
	const windConverter = windSpeed();
	const pressureConverter = pressure();
	const ceilingConverter = distanceMeters();
	const visibilityConverter = distanceKilometers();
	const ceilingMeters = Math.max(0, ((currentForecast.temperature_2m ?? 0) - (currentForecast.dew_point_2m ?? 0)) * 68);

	return {
		city: weatherParameters.city,
		timeZone: weatherParameters.timeZone,
		Temperature: temperatureConverter(currentForecast.temperature_2m),
		TemperatureUnit: temperatureConverter.units,
		DewPoint: temperatureConverter(currentForecast.dew_point_2m),
		Ceiling: ceilingConverter(ceilingMeters),
		CeilingUnit: ceilingConverter.units,
		Visibility: visibilityConverter(currentForecast.visibility),
		VisibilityUnit: visibilityConverter.units,
		WindSpeed: windConverter(currentForecast.wind_speed_10m),
		WindSpeedRaw: currentForecast.wind_speed_10m,
		WindDirection: directionToNSEW(currentForecast.wind_direction_10m ?? 0),
		Pressure: pressureConverter((currentForecast.pressure_msl ?? 0) * 100),
		PressureDirection: currentForecast.pressureTrend,
		Humidity: Math.round(currentForecast.relative_humidity_2m ?? 0),
		WindGust: windConverter(currentForecast.wind_gusts_10m),
		WindGustRaw: currentForecast.wind_gusts_10m,
		WindUnit: windConverter.units,
		TextConditions: Number(currentForecast.weather_code ?? 0),
		Icon: getLargeIconFromWmoCodeWithWind(
			currentForecast.weather_code,
			Boolean(currentForecast.is_day),
			currentForecast.wind_speed_10m,
			currentForecast.wind_gusts_10m
		),
	};
};

const display = new CurrentWeather(1, 'current-weather');
registerDisplay(display);

export default display.getCurrentWeather.bind(display);
