# CampusHub Student Portal

Responsive React/Vite frontend for student account registration, sign-in, session restoration, and viewing the authenticated student profile.

## Run locally

1. Start MongoDB and the Auth Service on port `5001`, Student Service on port `5002`, Complaint Service on port `5004`, and Event Service on port `5003`.
2. From this directory, run `npm install` once if dependencies are not present.
3. Optionally copy `.env.example` to `.env` and set `VITE_AUTH_API_URL`, `VITE_STUDENT_API_URL`, `VITE_COMPLAINT_API_URL`, `VITE_EVENT_API_URL`, and `VITE_NOTIFICATION_API_URL`. The defaults use `http://localhost:5001`, `http://localhost:5002`, `http://localhost:5004`, `http://localhost:5003`, and `http://localhost:5005`.
4. Run `npm run dev` and open the local URL printed by Vite.

Run `npm run lint` and `npm run build` to validate the frontend.

## Session behavior

The bearer token is held in `sessionStorage`, allowing refresh restoration in the same browser tab and clearing automatically when that tab's session ends. Sign out removes it. Unauthorized or forbidden requests clear the session and return to sign-in. Complaint listing uses `GET /api/complaints/me`; submission sends only `category`, `subject`, and `description` to `POST /api/complaints`. Events use `GET /api/events` and `GET /api/events/registrations/me`; registration and cancellation use the Event Service's `/api/events/:eventId/register` routes. Since the existing APIs return bearer tokens rather than setting an HttpOnly cookie, this demo approach cannot protect the token from JavaScript running on the page; production deployments should use a backend-managed Secure, HttpOnly, SameSite cookie and appropriate CSRF protection.
