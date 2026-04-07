import { readFile, writeFile } from 'fs/promises';

const radarCities = JSON.parse(await readFile('./datagenerators/radarcities-raw.json'));

const result = radarCities.map((city) => {
	if (!city?.name || typeof city.lat !== 'number' || typeof city.lon !== 'number') {
		throw new Error(`Invalid radar city: ${JSON.stringify(city)}`);
	}

	return {
		name: city.name,
		lat: city.lat,
		lon: city.lon,
	};
});

await writeFile('./datagenerators/output/radarcities.json', JSON.stringify(result, null, '\t'));
