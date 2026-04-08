import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { readFile } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
	weatherProxy,
	radarProxy,
	outlookProxy,
	mesonetProxy,
	forecastProxy,
	openMeteoProxy,
	rainViewerProxy,
	arcGisServerProxy,
	arcGisServicesProxy,
} from './proxy/handlers.mjs';
import playlist from './src/playlist.mjs';
import OVERRIDES from './src/overrides.mjs';
import cache from './proxy/cache.mjs';
import devTools from './src/com.chrome.devtools.mjs';

const execAsync = promisify(exec);

const decodeHtml = (text) => text
	.replace(/&nbsp;/g, ' ')
	.replace(/&amp;/g, '&')
	.replace(/&quot;/g, '"')
	.replace(/&#39;/g, "'")
	.replace(/&rsquo;/g, "'")
	.replace(/&lsquo;/g, "'")
	.replace(/&ldquo;/g, '"')
	.replace(/&rdquo;/g, '"')
	.replace(/&mdash;/g, '-')
	.replace(/&ndash;/g, '-')
	.replace(/&hellip;/g, '...')
	.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const stripHtml = (text) => decodeHtml(text
	.replace(/<script[\s\S]*?<\/script>/gi, '')
	.replace(/<style[\s\S]*?<\/style>/gi, '')
	.replace(/<[^>]+>/g, ' ')
	.replace(/\s+([,.;:!?])/g, '$1')
	.replace(/\s+/g, ' ')
	.trim());

const trimBlurb = (text, maxLength = 120) => {
	if (text.length <= maxLength) return text;
	const shortened = text.slice(0, maxLength);
	const lastSpace = shortened.lastIndexOf(' ');
	return `${shortened.slice(0, lastSpace > 0 ? lastSpace : maxLength)}...`;
};

const parseLwnStories = (html) => {
	const headingRegex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
	const headings = [...html.matchAll(headingRegex)];
	const stories = [];

	headings.forEach((match, index) => {
		if (stories.length >= 8) return;

		const headingHtml = match[1];
		const start = match.index + match[0].length;
		const end = headings[index + 1]?.index ?? html.length;
		const sectionHtml = html.slice(start, end);

		const headline = stripHtml(headingHtml).replace(/^\[\s*\$\s*\]\s*/, '');
		if (!headline || headline === 'Welcome to LWN.net') return;

		const hrefMatch = headingHtml.match(/href="([^"]+)"/i)
			?? sectionHtml.match(/href="(\/Articles\/[^"#]+)"/i);
		const paragraphMatches = [...sectionHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
		const blurb = paragraphMatches
			.map((paragraph) => stripHtml(paragraph[1]))
			.find((paragraph) => paragraph && !paragraph.startsWith('Posted ') && !paragraph.startsWith('Read more'));

		if (!blurb) return;

		stories.push({
			headline,
			blurb: trimBlurb(blurb),
			url: hrefMatch ? new URL(hrefMatch[1], 'https://lwn.net/').toString() : 'https://lwn.net/',
		});
	});

	return stories;
};

const travelCities = JSON.parse(await readFile('./datagenerators/output/travelcities.json'));
const regionalCities = JSON.parse(await readFile('./datagenerators/output/regionalcities.json'));
const stationInfo = JSON.parse(await readFile('./datagenerators/output/stations.json'));
const radarCities = JSON.parse(await readFile('./datagenerators/output/radarcities.json'));

const app = express();
const port = process.env.WS4KP_PORT ?? 8080;

// Set X-Weatherstar header globally for playlist fallback detection
app.use((req, res, next) => {
	res.setHeader('X-Weatherstar', 'true');
	next();
});

// template engine
app.set('view engine', 'ejs');

// version
const { version } = JSON.parse(fs.readFileSync('package.json'));

// read and parse environment variables to append to the query string
// use the permalink (share) button on the web app to generate a starting point for your configuration
// then take each key/value in the querystring and append WSQS_ to the beginning, and then replace any
// hyphens with underscores in the key name
// environment variables are read from the command line and .env file via the dotenv package

const qsVars = {};

Object.entries(process.env).forEach(([key, value]) => {
	// test for key matching pattern described above
	if (key.match(/^WSQS_[A-Za-z0-9_]+$/)) {
		// convert the key to a querystring formatted key
		const formattedKey = key.replace(/^WSQS_/, '').replaceAll('_', '-');
		qsVars[formattedKey] = value;
	}
});

// single flag to determine if environment variables are present
const hasQsVars = Object.entries(qsVars).length > 0;

// turn the environment query string into search params
const defaultSearchParams = (new URLSearchParams(qsVars)).toString();

const renderIndex = (req, res, production = false) => {
	res.render('index', {
		production,
		serverAvailable: !process.env?.STATIC, // Disable caching proxy server in static mode
		version,
		OVERRIDES,
		query: req.query,
	});
};

const index = (req, res) => {
	// test for no query string in request and if environment query string values were provided
	if (hasQsVars && Object.keys(req.query).length === 0) {
		// redirect the user to the query-string appended url
		const url = new URL(`${req.protocol}://${req.host}${req.url}`);
		url.search = defaultSearchParams;
		res.redirect(307, url.toString());
		return;
	}
	// return the EJS template page in development mode (serve files from server directory directly)
	renderIndex(req, res, false);
};

const geoip = (req, res) => {
	res.set({
		'x-geoip-city': 'Orlando',
		'x-geoip-country': 'US',
		'x-geoip-country-name': 'United States',
		'x-geoip-country-region': 'FL',
		'x-geoip-country-region-name': 'Florida',
		'x-geoip-latitude': '28.52135',
		'x-geoip-longitude': '-81.41079',
		'x-geoip-postal-code': '32789',
		'x-geoip-time-zone': 'America/New_York',
		'content-type': 'application/json',
	});
	res.json({});
};

// Configure static asset caching with proper ETags and cache validation
const staticOptions = {
	etag: true, // Enable ETag generation
	lastModified: true, // Enable Last-Modified headers
	setHeaders: (res, path, stat) => {
		// Generate ETag based on file modification time and size for better cache validation
		const etag = `"${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
		res.setHeader('ETag', etag);

		if (path.match(/\.(png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/i)) {
			// Images and fonts - cache for 1 year (immutable content)
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		} else if (path.match(/\.(css|js|mjs)$/i)) {
			// Scripts and styles - use cache validation instead of no-cache
			// This allows browsers to use cached version if ETag matches (304 response)
			res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
		} else {
			// Other files - cache for 1 hour with validation
			res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
		}
	},
};

// Weather.gov API proxy (catch-all for any Weather.gov API endpoint)
// Skip setting up routes for the caching proxy server in static mode
if (!process.env?.STATIC) {
	// Server info endpoint for fastfetch output (must be before /api/ weather proxy)
	app.get('/api/server-info', async (req, res) => {
		try {
			// Use --structure to show only essential info: OS, Kernel, Uptime, CPU, GPU, Memory, Disk
			const { stdout } = await execAsync('fastfetch --structure "Title:OS:Kernel:Uptime:CPU:GPU:Memory:Disk" --pipe false');
			// Strip all ANSI escape sequences (color codes, cursor positioning, etc.)
			// eslint-disable-next-line no-control-regex
			const cleanOutput = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
			res.json({
				success: true,
				data: cleanOutput,
			});
		} catch (error) {
			// fastfetch not available or other error
			res.json({
				success: false,
				data: null,
				error: error.message,
			});
		}
	});

	app.get('/api/linux-news', async (req, res) => {
		try {
			const response = await fetch('https://lwn.net/', {
				headers: {
					'User-Agent': `ws4kp/${version}`,
				},
			});

			if (!response.ok) {
				throw new Error(`LWN request failed with status ${response.status}`);
			}

			const html = await response.text();
			const stories = parseLwnStories(html);

			if (stories.length === 0) {
				throw new Error('No LWN stories found');
			}

			res.json({
				success: true,
				stories,
			});
		} catch (error) {
			res.json({
				success: false,
				stories: [],
				error: error.message,
			});
		}
	});

	app.use('/api/', weatherProxy);

	// Cache management DELETE endpoint to allow "uncaching" specific URLs
	app.delete(/^\/cache\/.*/, (req, res) => {
		const path = req.url.replace('/cache', '');
		const cleared = cache.clearEntry(path);
		res.json({ cleared, path });
	});

	// specific proxies for other services
	app.use('/radar/', radarProxy);
	app.use('/spc/', outlookProxy);
	app.use('/mesonet/', mesonetProxy);
	app.use('/forecast/', forecastProxy);
	app.use('/open-meteo/', openMeteoProxy);
	app.use('/rainviewer/', rainViewerProxy);
	app.use('/arcgis-server/', arcGisServerProxy);
	app.use('/arcgis-services/', arcGisServicesProxy);

	// Playlist route is available in server mode (not in static mode)
	app.get('/playlist.json', playlist);
}

// Data endpoints - serve JSON data with long-term caching
const dataEndpoints = {
	travelcities: travelCities,
	regionalcities: regionalCities,
	stations: stationInfo,
	radarcities: radarCities,
};

Object.entries(dataEndpoints).forEach(([name, data]) => {
	app.get(`/data/${name}.json`, (req, res) => {
		res.set({
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Content-Type': 'application/json',
		});
		res.json(data);
	});
});

if (process.env?.DIST === '1') {
	// Production ("distribution") mode uses pre-baked files in the dist directory
	// 'npm run build' and then 'DIST=1 npm start'
	app.use('/scripts', express.static('./server/scripts', staticOptions));
	app.use('/geoip', geoip);
	app.use('/music', express.static('./server/music', staticOptions));

	// render the EJS template in production mode (serve compressed files from dist directory)
	app.get('/', (req, res) => { renderIndex(req, res, true); });

	app.use('/', express.static('./dist', staticOptions));
} else {
	// Development mode serves files from the server directory: 'npm start'
	app.get('/index.html', index);
	app.use('/geoip', geoip);
	app.use('/resources', express.static('./server/scripts/modules'));
	app.get('/', index);
	app.get('/.well-known/appspecific/com.chrome.devtools.json', devTools);
	app.get('*name', express.static('./server', staticOptions));
}

const server = app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});

// graceful shutdown
const gracefulShutdown = () => {
	server.close(() => {
		console.log('Server closed');
		process.exit(0);
	});
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
