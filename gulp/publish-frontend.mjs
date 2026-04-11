import 'dotenv/config';
import {
	src, dest, series, parallel,
} from 'gulp';
import concat from 'gulp-concat';
import terser from 'gulp-terser';
import ejs from 'gulp-ejs';
import rename from 'gulp-rename';
import htmlmin from 'gulp-html-minifier-terser';
import { deleteAsync } from 'del';
import webpack from 'webpack-stream';
import TerserPlugin from 'terser-webpack-plugin';
import { readFile } from 'fs/promises';
import file from 'gulp-file';
import dartSass from 'sass';
import gulpSass from 'gulp-sass';
import OVERRIDES from '../src/overrides.mjs';
import { discoverThemes } from '../src/theme-discovery.mjs';

// get cloudfront
import reader from '../src/playlist-reader.mjs';

const sass = gulpSass(dartSass);

const clean = () => deleteAsync(['./dist/**/*', '!./dist/readme.txt']);

const RESOURCES_PATH = './dist/resources';

// Data is now served as JSON files to avoid redundancy

const webpackOptions = {
	mode: 'production',
	output: {
		filename: 'ws.min.js',
	},
	resolve: {
		roots: ['./'],
	},
	devtool: 'source-map',
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				extractComments: false,
				terserOptions: {
					// sourceMap: true,
					format: {
						comments: false,
					},
				},
			}),
		],
	},
};

const jsVendorSources = [
	'server/scripts/vendor/auto/nosleep.js',
	'server/scripts/vendor/auto/swiped-events.js',
	'server/scripts/vendor/auto/suncalc.js',
];

const compressJsVendor = () => src(jsVendorSources)
	.pipe(concat('vendor.min.js'))
	.pipe(terser())
	.pipe(dest(RESOURCES_PATH));

const mjsSources = [
	'server/scripts/modules/currentweatherscroll.mjs',
	'server/scripts/modules/hazards.mjs',
	'server/scripts/modules/currentweather.mjs',
	'server/scripts/modules/almanac.mjs',
	'server/scripts/modules/spc-outlook.mjs',
	'server/scripts/modules/icons.mjs',
	'server/scripts/modules/extendedforecast.mjs',
	'server/scripts/modules/hourly.mjs',
	'server/scripts/modules/hourly-graph.mjs',
	'server/scripts/modules/localforecast.mjs',
	'server/scripts/modules/radar.mjs',
	'server/scripts/modules/regionalforecast.mjs',
	'server/scripts/modules/travelforecast.mjs',
	'server/scripts/modules/progress.mjs',
	'server/scripts/modules/media.mjs',
	'server/scripts/modules/custom-scroll-text.mjs',
	'server/scripts/modules/serverobservations.mjs',
	'server/scripts/modules/linuxnews.mjs',
	'server/scripts/index.mjs',
];

const buildJs = () => src(mjsSources)
	.pipe(webpack(webpackOptions))
	.pipe(dest(RESOURCES_PATH));

const cssSources = [
	'server/styles/scss/**/*.scss',
];
const buildCss = () => src(cssSources)
	.pipe(sass({ style: 'compressed' }).on('error', sass.logError))
	.pipe(rename({ suffix: '.min' }))
	.pipe(dest(RESOURCES_PATH))
	.pipe(dest('./server/styles'));

const htmlSources = [
	'views/*.ejs',
];
const packageJson = await readFile('package.json');
const { version } = JSON.parse(packageJson);
const { themes, themeAssets } = await discoverThemes();

const compressHtml = async () => src(htmlSources)
	.pipe(ejs({
		production: version,
		serverAvailable: false,
		version,
		themes,
		themeAssets,
		OVERRIDES,
		query: {},
	}))
	.pipe(rename({ extname: '.html' }))
	.pipe(htmlmin({ collapseWhitespace: true }))
	.pipe(dest('./dist'));

const otherFiles = [
	'server/robots.txt',
	'server/manifest.json',
	'server/alert/**/*.mp3',
	'server/music/**/*.mp3',
];
const copyOtherFiles = () => src(otherFiles, { base: 'server/', encoding: false })
	.pipe(dest('./dist'));

const copyThemes = () => src('themes/**', { base: '.', encoding: false })
	.pipe(dest('./dist'));

// Copy JSON data files for static hosting
const copyDataFiles = () => src([
	'datagenerators/output/travelcities.json',
	'datagenerators/output/regionalcities.json',
	'datagenerators/output/stations.json',
	'datagenerators/output/radarcities.json',
]).pipe(dest('./dist/data'));

const imageSources = [
	'server/fonts/**',
	'server/images/**',
	'!server/images/gimp/**',
];

const copyImageSources = () => src(imageSources, { base: './server', encoding: false })
	.pipe(dest('./dist'));

const buildPlaylist = async () => {
	const availableFiles = await reader();
	const playlist = { availableFiles };
	return file('playlist.json', JSON.stringify(playlist)).pipe(dest('./dist'));
};

const buildDist = series(clean, parallel(buildJs, compressJsVendor, buildCss, compressHtml, copyOtherFiles, copyThemes, copyDataFiles, copyImageSources, buildPlaylist));

export default buildDist;

export {
	buildDist,
	copyThemes,
};
