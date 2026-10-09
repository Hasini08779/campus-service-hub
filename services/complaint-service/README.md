# Complaint Service

The Complaint Service stores complaints in its own MongoDB database and runs on port `5004` by default. It verifies JWTs issued by Authentication Service; use the same `JWT_SECRET` in both services.

## Local setup

1. Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN`.
2. Start MongoDB.
3. Run `npm install` if needed, then `npm start`.

`NOTIFICATION_SERVICE_URL` is optional. When configured, complaint submission and status changes trigger best-effort notifications to the complaint owner. A notification service failure does not fail complaint operations.

## API

- `GET /health` — health check.
- `POST /api/complaints` — student submits a complaint. `studentId` and initial `Pending` status are assigned by the service.
- `GET /api/complaints/me` — student views their own complaints. Supports `status`, `page`, and `limit`.
- `GET /api/complaints/:complaintId` — student views only their own complaint; admin can view any complaint.
- `GET /api/complaints` — admin views all complaints. Supports `status`, `category`, `q`, `page`, and `limit`.
- `PATCH /api/complaints/:complaintId/status` — admin updates status to `Pending`, `In Progress`, or `Resolved`.

All `/api/complaints` endpoints require `Authorization: Bearer <token>`.
