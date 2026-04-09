// Server Observations display - shows fastfetch output
import { safeJson } from './utils/fetch.mjs';
import STATUS from './status.mjs';
import WeatherDisplay from './weatherdisplay.mjs';
import { registerDisplay } from './navigation.mjs';
import { debugFlag } from './utils/debug.mjs';
import { withBasePath } from './utils/base-path.mjs';

const LINES_PER_PAGE = 4;
const PAGE_DURATION_MS = 7000;
const ALLOWED_KEYS = new Set(['OS', 'Kernel', 'Uptime', 'CPU', 'GPU', 'Memory', 'Disk']);

const isAllowedObservationKey = (key) => ALLOWED_KEYS.has(key) || key.startsWith('Disk');

const parseServerObservationLine = (line) => {
	const trimmed = line.trim();
	if (!trimmed) return null;

	const separators = [' == ', ': '];
	const parsedLine = separators.map((separator) => {
		const separatorIndex = trimmed.indexOf(separator);
		if (separatorIndex > 0) {
			const key = trimmed.slice(0, separatorIndex).trim();
			const value = trimmed.slice(separatorIndex + separator.length).trim();
			if (key && value && isAllowedObservationKey(key)) {
				return { key, value };
			}
		}
		return null;
	}).find((entry) => entry);

	return parsedLine ?? null;
};

class ServerObservations extends WeatherDisplay {
	constructor(navId, elemId) {
		super(navId, elemId, 'Server Observations', true);
		this.timing.baseDelay = PAGE_DURATION_MS;
	}

	async getData(weatherParameters, refresh) {
		if (!super.getData(weatherParameters, refresh)) return;

		try {
			// Fetch server info from the API
			const response = await safeJson(withBasePath('api/server-info'), {
				retryCount: 0,
			});

			// Check if fastfetch is available
			if (!response || !response.success) {
				if (debugFlag('serverobservations')) {
					console.log('Server Observations: fastfetch not available');
				}
				this.setStatus(STATUS.noData);
				return;
			}

			this.data = response.data;
			this.setStatus(STATUS.loaded);
		} catch (error) {
			if (debugFlag('serverobservations')) {
				console.log('Server Observations: error fetching data:', error.message);
			}
			this.setStatus(STATUS.noData);
		}
	}

	async drawCanvas() {
		super.drawCanvas();

		// Get the output container
		const outputElem = this.elem.querySelector('.server-output');
		const container = this.elem.querySelector('.container');

		// Split the fastfetch output into lines
		const infoLines = this.data.split('\n')
			.map((line) => parseServerObservationLine(line))
			.filter((line) => line);

		const pages = [];
		for (let i = 0; i < infoLines.length; i += LINES_PER_PAGE) {
			pages.push(infoLines.slice(i, i + LINES_PER_PAGE));
		}

		outputElem.innerHTML = '';
		pages.forEach((pageLines) => {
			const pageElem = document.createElement('div');
			pageElem.className = 'server-page';

			pageLines.forEach((line) => {
				const lineDiv = document.createElement('div');
				lineDiv.className = 'server-line';
				lineDiv.textContent = `${line.key}: ${line.value}`;
				pageElem.appendChild(lineDiv);
			});

			outputElem.appendChild(pageElem);
		});

		this.pageHeight = container.offsetHeight;
		this.timing.totalScreens = Math.max(1, pages.length);
		this.timing.delay = new Array(this.timing.totalScreens).fill(1);
		this.calcNavTiming();

		const top = -this.screenIndex * this.pageHeight;
		outputElem.style.top = `${top}px`;

		this.finishDraw();
	}
}

// Register display with navId 13 (after other displays)
registerDisplay(new ServerObservations(13, 'server-observations'));
