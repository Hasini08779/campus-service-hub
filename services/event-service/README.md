# Event Service

The Event Service stores events and registrations in its own MongoDB database and runs on port `5003` by default. It verifies JWTs issued by Authentication Service; use the same `JWT_SECRET` in both services.

## Local setup

1. Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. Start MongoDB.
3. Run `npm install` if needed, then `npm start`.

`NOTIFICATION_SERVICE_URL` and `STUDENT_SERVICE_URL` default to ports `5005` and `5002`. When configured, creating a public campus event notifies students with saved profiles; event updates/cancellations notify registrants, and registration/cancellation notify the student. The Event Service also runs a lightweight hourly deadline reminder scan for events closing in three days, one day, or today, excluding registered students, full events, and cancelled/past events. Reminder writes use stable idempotency keys. These are best-effort integrations: notification failures do not fail event operations.

## API

All `/api/events` routes require `Authorization: Bearer <token>`.

Student and admin routes:
- `GET /api/events` — browse events; supports `q`, `page`, and `limit`.
- `GET /api/events/:eventId` — view event details.

Student routes:
- `POST /api/events/:eventId/register` — register for an event. Duplicate registrations, full events, events whose UTC date has passed, and registrations past the optional deadline are rejected. Student identity (`studentId`, `name`, `email`) is taken from the authenticated JWT; no registration request body is required.
- `DELETE /api/events/:eventId/register` — cancel a registration.
- `GET /api/events/registrations/me` — view registered events.

Admin routes:
- `POST /api/events` — create an event. The service generates its `eventId`.
- `PUT /api/events/:eventId` — update event fields.
- `DELETE /api/events/:eventId` — delete an event.
- `GET /api/events/:eventId/registrations` — view event registrations.

Event creation requires `name`, `description`, `date` (`YYYY-MM-DD`), `time` (`HH:mm`, 24-hour), `venue`, `organizer`, and `maxParticipants`. Optional `category` values are `Workshop`, `Technical`, `Cultural`, `Sports`, `Competition`, `Seminar`, or `Other` (the default). An optional `registrationDeadline` uses `YYYY-MM-DD`; omitting it preserves registrations without a deadline.
