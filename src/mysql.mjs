import mysql from 'mysql2/promise';

let pool;

const getConfig = () => {
	const {
		WS4KP_MYSQL_HOST = '127.0.0.1',
		WS4KP_MYSQL_PORT = '3306',
		WS4KP_MYSQL_USER,
		WS4KP_MYSQL_PASSWORD,
		WS4KP_MYSQL_DATABASE,
		WS4KP_MYSQL_SOCKET_PATH,
	} = process.env;

	if (!WS4KP_MYSQL_USER || !WS4KP_MYSQL_PASSWORD || !WS4KP_MYSQL_DATABASE) {
		throw new Error('Missing MySQL configuration. Set WS4KP_MYSQL_USER, WS4KP_MYSQL_PASSWORD, and WS4KP_MYSQL_DATABASE.');
	}

	const config = {
		user: WS4KP_MYSQL_USER,
		password: WS4KP_MYSQL_PASSWORD,
		database: WS4KP_MYSQL_DATABASE,
		waitForConnections: true,
		connectionLimit: 10,
		queueLimit: 0,
	};

	if (WS4KP_MYSQL_SOCKET_PATH) {
		config.socketPath = WS4KP_MYSQL_SOCKET_PATH;
	} else {
		config.host = WS4KP_MYSQL_HOST;
		config.port = Number(WS4KP_MYSQL_PORT);
	}

	return config;
};

const getPool = () => {
	if (!pool) {
		pool = mysql.createPool(getConfig());
	}
	return pool;
};

const checkHazardHistoryTable = async () => {
	const config = getConfig();
	const [rows] = await getPool().query(
		`SELECT 1
		FROM information_schema.tables
		WHERE table_schema = ?
		  AND table_name = 'hazard_history'
		LIMIT 1`,
		[config.database],
	);

	if (rows.length === 0) {
		throw new Error(`Hazard history database table 'hazard_history' is missing in database '${config.database}'. Run the documented CREATE TABLE statement before using Hazard List.`);
	}

	return true;
};

export {
	checkHazardHistoryTable,
	getPool,
};
