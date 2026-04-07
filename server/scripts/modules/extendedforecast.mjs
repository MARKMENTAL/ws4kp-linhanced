// display extended forecast graphically

import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { temperature } from './utils/units.mjs';
import { getConditionText } from './utils/weather.mjs';
import { getLargeIconFromWmoCode } from './icons.mjs';
import { preloadImg } from './utils/image.mjs';

class ExtendedForecast extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Extended Forecast', true);
		this.timing.totalScreens = 2;
	}

	async getData(weatherParameters) {
		if (!super.getData(weatherParameters)) return;
		this.data = parseForecast(this.weatherParameters);
		this.screenIndex = 0;
		this.setStatus(STATUS.loaded);
	}

	async drawCanvas() {
		super.drawCanvas();
		const forecast = this.data.slice(0 + 3 * this.screenIndex, 3 + this.screenIndex * 3);
		const days = forecast.map((day) => this.fillTemplate('day', {
			icon: { type: 'img', src: day.icon },
			condition: day.text,
			date: day.dayName,
			'value-hi': Math.round(day.high),
			...(day.low !== undefined ? { 'value-lo': Math.round(day.low) } : {}),
		}));

		const dayContainer = this.elem.querySelector('.day-container');
		dayContainer.innerHTML = '';
		dayContainer.append(...days);
		this.finishDraw();
	}
}

const parseForecast = (weatherParameters) => {
	const temperatureConverter = temperature();
	return Object.entries(weatherParameters.forecast).slice(0, 6).map(([date, period]) => {
		const text = shortenExtendedForecastText(getConditionText(period.weather_code ?? 0));
		const icon = getLargeIconFromWmoCode(period.weather_code, true);
		preloadImg(icon);
		return {
			text,
			icon,
			dayName: new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', timeZone: weatherParameters.timeZone }),
			high: temperatureConverter(period.temperature_2m_max),
			low: temperatureConverter(period.temperature_2m_min),
		};
	});
};

const shortenExtendedForecastText = (text) => text
	.replace(/Slight /gi, '')
	.replace(/Moderate /gi, '')
	.replace(/Thunderstorm/gi, 'T\'Storm')
	.split(' ')
	.slice(0, 2)
	.join(' ');

registerDisplay(new ExtendedForecast(8, 'extended-forecast'));
