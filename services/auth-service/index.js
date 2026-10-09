require('dotenv').config();

const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const User = require('./models/User');

const app = express();
const port = Number(process.env.PORT) || 5001;

const allowedOrigins = (process.env.CORS_ORIGIN || '*')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);

app.use(cors({
	origin(origin, callback) {
		if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
			return callback(null, true);
		}

		return callback(new Error('This origin is not allowed by CORS.'));
	},
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
	res.json({ service: 'auth-service', status: 'ok' });
});

app.use('/api/auth', authRoutes);

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
		const field = Object.keys(error.keyPattern || {})[0] || 'value';
		return res.status(409).json({ message: `A user with this ${field} already exists.` });
	}

	if (error.name === 'ValidationError') {
		const details = Object.values(error.errors).map((item) => item.message);
		return res.status(400).json({ message: 'Validation failed.', details });
	}

	if (error.message === 'This origin is not allowed by CORS.') {
		return res.status(403).json({ message: error.message });
	}

	console.error(error);
	return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

async function createInitialAdmin() {
	const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.ADMIN_PASSWORD;

	if (!email || !password) {
		console.warn('ADMIN_EMAIL or ADMIN_PASSWORD is missing; no initial admin was created.');
		return;
	}

	const existingUser = await User.findOne({ email });
	if (existingUser) {
		if (existingUser.role !== 'admin') {
			throw new Error('ADMIN_EMAIL is already registered as a student. Use a different email.');
		}
		return;
	}

	await User.create({ email, password, role: 'admin', name: 'Campus Administrator' });
	console.log(`Initial admin account created for ${email}.`);
}

async function start() {
	if (!process.env.JWT_SECRET) {
		throw new Error('JWT_SECRET must be set in the auth-service environment.');
	}
	if (!process.env.MONGODB_URI) {
		throw new Error('MONGODB_URI must be set in the auth-service environment.');
	}

	await mongoose.connect(process.env.MONGODB_URI);
	await createInitialAdmin();

	app.listen(port, () => {
		console.log(`Authentication service listening on port ${port}.`);
	});
}

if (require.main === module) {
	start().catch((error) => {
		console.error('Could not start authentication service:', error.message);
		process.exitCode = 1;
	});
}

module.exports = app;
