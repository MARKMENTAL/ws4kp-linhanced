import { readFile, writeFile } from 'fs/promises';

const travelCitiesByRegion = JSON.parse(await readFile('./datagenerators/travelcities-raw.json'));

const validateCity = (city, region) => {
	if (!city?.Name || typeof city.Latitude !== 'number' || typeof city.Longitude !== 'number') {
		throw new Error(`Invalid travel city in region ${region}: ${JSON.stringify(city)}`);
	}

	return {
		Name: city.Name,
		Latitude: city.Latitude,
		Longitude: city.Longitude,
	};
};

const result = Object.fromEntries(Object.entries(travelCitiesByRegion).map(([region, cities]) => {
	if (!Array.isArray(cities)) {
		throw new Error(`Travel city region ${region} must be an array`);
	}

	return [region, cities.map((city) => validateCity(city, region))];
}));

await writeFile('./datagenerators/output/travelcities.json', JSON.stringify(result, null, '\t'));
