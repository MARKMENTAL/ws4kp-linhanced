// Hazard List display - shows the last 7 hazard alerts encountered by this server
import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';

class HazardList extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Hazard List', true);
		this.history = [];
	}

	async getData(weatherParameters, refresh) {
		const superResult = super.getData(weatherParameters, refresh);

		try {
			// Fetch hazard history from backend
			const response = await fetch('/api/hazard-history');
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();
			if (result.success) {
				this.data = result.history || [];
				this.setStatus(STATUS.loaded);
			} else {
				throw new Error(result.error || 'Failed to load hazard history');
			}
		} catch (error) {
			// In static mode or if backend is unavailable, show empty state
			this.data = [];
			if (error.message.includes('404') || error.message.includes('Failed to fetch')) {
				// Backend not available (static mode) - disable this display
				this.setStatus(STATUS.disabled);
			} else {
				this.setStatus(STATUS.failed);
			}
		}

		return superResult;
	}

	async drawCanvas() {
		super.drawCanvas();
		if (!this.data || this.data.length === 0) {
			this.showEmptyState();
			this.finishDraw();
			return;
		}

		// Templates are extracted by WeatherDisplay.loadTemplates()
		const container = this.elem.querySelector('.hazard-list-rows');
		container.innerHTML = '';

		// Add hazard rows
		this.data.forEach((hazard) => {
			const row = this.fillTemplate('hazard-list-row', {
				location: hazard.location,
				hazard: this.abbreviateHazardType(hazard.hazardType),
				date: this.formatDate(hazard.encounteredAt),
				ongoing: hazard.ongoing ? 'YES' : 'NO',
			});
			if (row) container.appendChild(row);
		});

		this.finishDraw();
	}

	showEmptyState() {
		const container = this.elem.querySelector('.hazard-list-rows');
		container.innerHTML = '';

		const emptyRow = this.fillTemplate('hazard-list-row', {
			location: 'No hazard history available',
			hazard: '',
			date: '',
			ongoing: '',
		});
		if (emptyRow) container.appendChild(emptyRow);
	}

	// Format ISO date to MM/DD
	formatDate(isoDate) {
		if (!isoDate) return '--/--';
		try {
			const date = new Date(isoDate);
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			return `${month}/${day}`;
		} catch {
			return '--/--';
		}
	}

	// Abbreviate hazard type to 8 characters max with weather-specific shortcuts
	abbreviateHazardType(type) {
		if (!type) return '';

		// Apply weather-specific abbreviations
		let abbreviated = type
			.replace(/Thunderstorm/g, 'T-storm')
			.replace(/Warning/g, 'Warn')
			.replace(/Advisory/g, 'Adv')
			.replace(/Visibility/g, 'Vis')
			.replace(/Reduced/g, 'Red')
			.replace(/Severe/g, 'Sev')
			.replace(/Extreme/g, 'Ext')
			.replace(/Weather/g, 'Wx')
			.replace(/Condition/g, 'Cond')
			.replace(/Temperature/g, 'Temp')
			.replace(/Precipitation/g, 'Precip')
			.replace(/Tornado/g, 'Torn')
			.replace(/Hurricane/g, 'Hurr')
			.replace(/Tropical/g, 'Trop')
			.replace(/Storm/g, 'Stm')
			.replace(/Wind/g, 'Wnd')
			.replace(/Snow/g, 'Snw')
			.replace(/Rain/g, 'Rn')
			.replace(/Fog/g, 'Fg')
			.replace(/Hail/g, 'Hl')
			.replace(/Freezing/g, 'Frz')
			.replace(/ Dense/g, 'Dns');

		// Hard truncate to 8 characters if still too long
		if (abbreviated.length > 8) {
			abbreviated = abbreviated.substring(0, 8);
		}

		return abbreviated;
	}
}

// register display
const display = new HazardList(15, 'hazard-list');
registerDisplay(display);

export default display;
