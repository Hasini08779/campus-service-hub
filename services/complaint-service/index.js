require('dotenv').config();

const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const complaintRoutes = require('./routes/complaints');

const app = express();
const port = Number(process.env.PORT) || 5004;
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
	.split(',')
	.map((origin) => origin.trim())
	.map((origin) => {
		try {
			return new URL(origin).origin;
		} catch {
			return origin;
		}
	})
	.filter(Boolean);

app.use(cors({
	origin(origin, callback) {
		let normalizedOrigin = origin;
		try {
			normalizedOrigin = new URL(origin).origin;
		} catch {
			// Invalid Origin values will not match the configured allowlist.
		}

		if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(normalizedOrigin)) {
			return callback(null, true);
		}

		return callback(new Error('This origin is not allowed by CORS.'));
	},
	methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
	res.json({ service: 'complaint-service', status: 'ok' });
});

app.use('/api/complaints', complaintRoutes);

app.use((req, res) => {
	res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
	if (res.headersSent) {
		return next(error);
	}

	if (error.type === 'entity.parse.failed') {
		return res.status(400).json({ message: 'Request body must contain valid JSON.' });
	}

	if (error.code === 11000) {
		return res.status(409).json({ message: 'A complaint with this ID already exists.' });
	}

	if (error.name === 'ValidationError' || error.name === 'CastError') {
		return res.status(400).json({ message: 'The supplied complaint data is invalid.' });
	}

	if (error.message === 'This origin is not allowed by CORS.') {
		return res.status(403).json({ message: error.message });
	}

	console.error(error);
	return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

async function start() {
	if (!process.env.JWT_SECRET) {
		throw new Error('JWT_SECRET must be set in the complaint-service environment.');
	}
	if (!process.env.MONGODB_URI) {
		throw new Error('MONGODB_URI must be set in the complaint-service environment.');
	}

	await mongoose.connect(process.env.MONGODB_URI);
	app.listen(port, () => {
		console.log(`Complaint service listening on port ${port}.`);
	});
}

if (require.main === module) {
	start().catch((error) => {
		console.error('Could not start complaint service:', error.message);
		process.exitCode = 1;
	});
}

module.exports = app;
