# Authentication Service

This service owns student/admin credentials and issues JWT access tokens. It runs independently on port `5001` by default.

## Local setup

1. From this directory, copy `.env.example` to `.env`.
2. Set `MONGODB_URI`, replace `JWT_SECRET` with a long random value, and set a strong `ADMIN_PASSWORD`.
3. Start MongoDB, then install dependencies if needed with `npm install`.
4. Run the service with `npm start`.

On startup, the service creates the configured admin account only if that email does not already exist. It never exposes an admin-registration endpoint. If either admin environment variable is missing, no admin is created.

## API

- `GET /health` — service health check.
- `POST /api/auth/register` — register a student with `studentId`, `name`, `email`, `password`, `department`, and `semester`. Registration always assigns the `student` role.
- `POST /api/auth/login` — log in a student or admin with `email` and `password`.
- `POST /api/auth/admin/login` — admin-only login.
- `GET /api/auth/me` — return the authenticated user's public profile. Send the token as `Authorization: Bearer <token>`.

Successful registration and login responses include a JWT and a public user object. Passwords are hashed with bcryptjs and are never included in API responses.
