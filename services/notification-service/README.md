# Notification Service

The Notification Service stores notifications in its own MongoDB database and runs on port `5005` by default. It verifies JWTs issued by Authentication Service; use the same `JWT_SECRET` in each service.

## Local setup

1. Copy `.env.example` to `.env` and configure `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. Start MongoDB.
3. Run `npm install` if needed, then `npm start`.

## API

All `/api/notifications` routes require `Authorization: Bearer <token>`.

- `POST /api/notifications` — create a notification. Students may create only for themselves; admins may target a `userId`. A student can omit `userId`, which defaults to their student ID. Optional fields include `title`, `relatedEntityType` (`event` or `complaint`), `relatedEntityId`, and `idempotencyKey`.
- `POST /api/notifications/bulk` — admin-only, idempotently create one notification for up to 500 provided `userIds` in a request. Used by Event Service for campus-wide event announcements and registered-student updates.
- `GET /api/notifications` — list only the authenticated user's notifications. Optional filters: `read`, `type`, `page`, and `limit`.
- `GET /api/notifications/unread-count` — return the unread count for the authenticated user.
- `PATCH /api/notifications/:notificationId/read` — mark one of the authenticated user's notifications as read.

Supported `type` values are `event_registration`, `event_update`, `event_deadline_reminder`, `complaint_status_change`, and `campus_announcement`. Event and Complaint Service use the event/complaint types; the admin campus-wide composer uses `campus_announcement`. When an `idempotencyKey` is supplied, it is unique per recipient; repeated requests return the existing notification rather than creating a duplicate.
