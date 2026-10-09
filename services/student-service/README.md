# Student Service

The Student Service stores student profile data in its own MongoDB database and runs on port `5002` by default. It verifies JWTs issued by the Authentication Service; set the same `JWT_SECRET` value in both services.

## Local setup

1. Copy `.env.example` to `.env` and configure `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. Start MongoDB.
3. Run `npm install` if dependencies are not installed, then run `npm start`.

## API

Every `/api/students` endpoint except `GET /health` requires `Authorization: Bearer <token>`.

- `GET /api/students/me` — student views their profile.
- `PUT /api/students/me` — student creates or updates their profile. On first use, provide `department` and `semester`; `name`, `email`, and `studentId` are taken from the verified token. Optional fields include `name` and `phone`.
- `GET /api/students` — admin lists/searches students. Optional query parameters: `q`, `department`, `semester`, `page`, `limit` (maximum 100), and `sort` (`name` by default or `recent` by profile creation date).
- `GET /api/students/:studentId` — admin views a student profile.

Students cannot change the identity fields issued by Authentication Service. Student profile documents are stored independently from authentication accounts.
