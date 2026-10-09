import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from './api.js'
import './admin.css'

const ADMIN_NAV = [
  ['dashboard', 'Dashboard', 'D'],
  ['students', 'Students', 'S'],
  ['events', 'Events', 'E'],
  ['complaints', 'Complaints', 'C'],
  ['notifications', 'Notifications', 'N'],
]
const COMPLAINT_STATUSES = ['Pending', 'In Progress', 'Resolved']
const EVENT_CATEGORIES = ['Workshop', 'Technical', 'Cultural', 'Sports', 'Competition', 'Seminar', 'Other']
const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics and Communication', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Business Administration', 'Other']
const EMPTY_LIST = []
const ADMIN_UTC_DATE = new Date().toISOString().slice(0, 10)

function initialsFor(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
}

function displayDate(value, options = {}) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...options })
}

function displayDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ComplaintRating({ rating }) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null
  return <span className="admin-complaint-rating" aria-label={`Student rating: ${rating} out of 5 stars`}><span aria-hidden="true">{'★'.repeat(rating)}<span className="admin-complaint-rating-empty">{'☆'.repeat(5 - rating)}</span></span><strong>{rating}/5</strong></span>
}

function ComplaintFeedbackHistory({ complaint }) {
  const history = Array.isArray(complaint.resolutionFeedbackHistory) && complaint.resolutionFeedbackHistory.length
    ? complaint.resolutionFeedbackHistory
    : complaint.resolutionFeedback?.submittedAt ? [complaint.resolutionFeedback] : []
  if (history.length === 0) return null
  return <div className="admin-complaint-feedback"><h3>Student feedback</h3>{history.map((entry, index) => <div className="admin-complaint-feedback-cycle" key={entry.cycle || index}><strong>Resolution {entry.cycle || index + 1}</strong>{entry.rating && <div className="admin-complaint-feedback-rating"><span>Student Rating</span><ComplaintRating rating={entry.rating} /></div>}{entry.comment && <div><span>Student Feedback</span><p>{entry.comment}</p></div>}{entry.submittedAt && <small>Feedback submitted {displayDateTime(entry.submittedAt)}</small>}</div>)}</div>
}

function complaintWaitingDetails(complaint) {
  if (!['Pending', 'In Progress'].includes(complaint.status)) return null
  const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : []
  const entry = [...history].reverse().find((item) => item.status === complaint.status && item.changedAt)
  const since = entry?.changedAt || (complaint.status === 'Pending' ? complaint.createdDate : null)
  if (!since || Number.isNaN(new Date(since).getTime())) return null
  const elapsedMs = Math.max(0, Date.now() - new Date(since).getTime())
  const days = Math.floor(elapsedMs / 86400000)
  const hours = Math.floor((elapsedMs % 86400000) / 3600000)
  const age = days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'less than an hour'
  const needsAttention = complaint.status === 'Pending' ? elapsedMs >= 86400000 : elapsedMs >= 3 * 86400000
  const overdue = complaint.status === 'Pending' ? elapsedMs >= 2 * 86400000 : elapsedMs >= 5 * 86400000
  return { age, needsAttention, overdue }
}

function safeAdminError(error, fallback) {
  if (error instanceof ApiError && error.status === 401) return 'Your session has expired. Please sign in again.'
  if (error instanceof ApiError && error.status === 403) return 'You do not have permission to perform this action.'
  if (error instanceof ApiError && error.status === 409) return 'This change conflicts with current records. Review the details and try again.'
  if (error instanceof ApiError && error.status === 400) return error.message
  return fallback
}

function AdminNotice({ message, kind = 'success' }) {
  if (!message) return null
  return <div className={`admin-notice admin-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{kind === 'error' ? '!' : '✓'}</span>{message}</div>
}

function LoadingRows({ count = 4 }) {
  return <div className="admin-skeleton-list" aria-label="Loading"><span className="admin-skeleton admin-skeleton-heading" />{Array.from({ length: count }, (_, index) => <span className="admin-skeleton admin-skeleton-row" key={index} />)}</div>
}

function AdminHeading({ eyebrow = 'CAMPUSHUB ADMINISTRATION', title, description, action }) {
  return <div className="admin-page-heading"><div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>
}

function AdminDashboard({ profile, token, onLogout, onSessionExpired }) {
  const [section, setSection] = useState('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [complaintToOpen, setComplaintToOpen] = useState('')
  const clearComplaintToOpen = useCallback(() => setComplaintToOpen(''), [])

  const titles = Object.fromEntries(ADMIN_NAV.map(([id, label]) => [id, label]))
  const navigate = (next) => {
    setSection(next)
    setMobileNavOpen(false)
    if (next !== 'events') setEventFormOpen(false)
  }

  const navigateToCreateEvent = () => {
    setEventFormOpen(true)
    setSection('events')
    setMobileNavOpen(false)
  }

  const openComplaintFromNotification = (complaintId) => {
    setComplaintToOpen(complaintId)
    setSection('complaints')
    setMobileNavOpen(false)
  }

  return <div className="admin-app">
    {mobileNavOpen && <button type="button" className="admin-drawer-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
    <aside className={`admin-sidebar${mobileNavOpen ? ' admin-sidebar-open' : ''}`} aria-label="Admin navigation">
      <div className="admin-brand"><span className="admin-brand-mark">C</span><span><strong>CampusHub</strong><small>Administration Portal</small></span></div>
      <p className="admin-nav-label">WORKSPACE</p>
      <nav className="admin-nav">{ADMIN_NAV.map(([id, label, icon]) => <button key={id} type="button" className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => navigate(id)}><span className="admin-nav-icon" aria-hidden="true">{icon}</span>{label}</button>)}</nav>
      <div className="admin-sidebar-footer"><span className="admin-avatar">{initialsFor(profile.name)}</span><span className="admin-sidebar-identity"><strong>{profile.name || 'Administrator'}</strong><small>{profile.email || 'Administrator'}</small></span><button type="button" className="admin-sidebar-logout" onClick={onLogout} aria-label="Sign out">↗</button></div>
    </aside>
    <div className="admin-main-shell">
      <header className="admin-topbar"><button type="button" className="admin-menu-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">☰</button><div className="admin-topbar-title"><span className="admin-topbar-kicker">ADMINISTRATION</span><strong>{titles[section]}</strong></div><div className="admin-topbar-user"><span className="admin-role-pill">Administrator</span><span className="admin-avatar admin-avatar-small">{initialsFor(profile.name)}</span><span className="admin-topbar-name">{profile.name}</span><button type="button" className="admin-topbar-logout" onClick={onLogout}>Logout <span aria-hidden="true">↗</span></button></div></header>
      <main className="admin-content">
        {section === 'dashboard' && <AdminHome token={token} onNavigate={navigate} onCreateEvent={navigateToCreateEvent} onSessionExpired={onSessionExpired} />}
        {section === 'students' && <StudentsPage token={token} onSessionExpired={onSessionExpired} />}
        {section === 'events' && <EventsManagementPage token={token} onSessionExpired={onSessionExpired} openCreateSignal={eventFormOpen} onCreateOpened={() => setEventFormOpen(false)} />}
        {section === 'complaints' && <AdminComplaintsPage token={token} onSessionExpired={onSessionExpired} initialComplaintId={complaintToOpen} onComplaintOpened={clearComplaintToOpen} />}
        {section === 'notifications' && <AnnouncementsPage token={token} onSessionExpired={onSessionExpired} onOpenComplaint={openComplaintFromNotification} />}
        <footer className="admin-footer"><span>CampusHub <i>·</i> Administration Portal</span><span>Campus services, coordinated.</span></footer>
      </main>
    </div>
  </div>
}

function AdminHome({ token, onNavigate, onCreateEvent, onSessionExpired }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const lastFocusRefresh = useRef(0)
  const refreshDashboard = useCallback(() => {
    const now = Date.now()
    if (document.visibilityState === 'visible' && now - lastFocusRefresh.current > 1500) {
      lastFocusRefresh.current = now
      setRefreshKey((value) => value + 1)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('focus', refreshDashboard)
    document.addEventListener('visibilitychange', refreshDashboard)
    return () => {
      window.removeEventListener('focus', refreshDashboard)
      document.removeEventListener('visibilitychange', refreshDashboard)
    }
  }, [refreshDashboard])

  useEffect(() => {
    let active = true
    Promise.allSettled([
      api.getAdminStudents(token, { page: 1, limit: 6, sort: 'recent' }),
      api.getEvents(token),
      api.getAdminComplaints(token, { page: 1, limit: 6 }),
      api.getAdminComplaints(token, { page: 1, limit: 1, status: 'Pending' }),
      api.getNotifications(token),
      api.getServiceHealth(),
    ]).then((results) => {
      if (!active) return
      const unauthorized = results.find((result) => result.status === 'rejected' && result.reason instanceof ApiError && [401, 403].includes(result.reason.status))
      if (unauthorized) {
        onSessionExpired()
        return
      }
      const [studentsResult, eventsResult, complaintsResult, pendingResult, notificationsResult, healthResult] = results
      const values = {
        students: studentsResult.status === 'fulfilled' ? studentsResult.value : null,
        events: eventsResult.status === 'fulfilled' ? eventsResult.value : null,
        complaints: complaintsResult.status === 'fulfilled' ? complaintsResult.value : null,
        pending: pendingResult.status === 'fulfilled' ? pendingResult.value : null,
        notifications: notificationsResult.status === 'fulfilled' ? notificationsResult.value : null,
        health: healthResult.status === 'fulfilled' ? healthResult.value : null,
      }
      setSnapshot(values)
      if (results.every((result) => result.status === 'rejected')) setError('Campus services are temporarily unavailable. Try refreshing the dashboard.')
      else if (results.some((result) => result.status === 'rejected')) setError('Some dashboard information could not be loaded. Refresh to try again.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, token])

  const events = snapshot?.events || EMPTY_LIST
  const today = ADMIN_UTC_DATE
  const upcoming = events.filter((event) => event.status !== 'cancelled' && new Date(event.date).toISOString().slice(0, 10) >= today).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5)
  const recentStudents = snapshot?.students?.students || EMPTY_LIST
  const recentComplaints = snapshot?.complaints?.complaints || EMPTY_LIST
  const recentActivity = useMemo(() => {
    const activities = [
      ...(recentStudents.map((student) => ({ key: `student-${student.studentId}`, label: 'Student profile added', detail: `${student.name} · ${student.studentId}`, date: student.createdAt, section: 'students' }))),
      ...(events.map((event) => ({ key: `event-${event.eventId}`, label: 'Campus event created', detail: event.name, date: event.createdAt, section: 'events' }))),
      ...(recentComplaints.map((complaint) => ({ key: `complaint-${complaint.complaintId}`, label: 'Complaint submitted', detail: complaint.subject, date: complaint.createdDate, section: 'complaints' }))),
    ]
    return activities.filter((activity) => activity.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6)
  }, [events, recentComplaints, recentStudents])

  return <section className="admin-home">
    <AdminHeading eyebrow="CAMPUS OPERATIONS" title="Welcome back, Admin" description="Manage students, events, complaints, and campus activities from one place." action={<button type="button" className="admin-button admin-button-secondary" onClick={() => { setLoading(true); setError(''); setRefreshKey((value) => value + 1) }} disabled={loading}>{loading ? 'Loading…' : 'Refresh overview ↻'}</button>} />
    <AdminNotice message={error} kind={error ? 'error' : 'success'} />
    {loading && !snapshot ? <LoadingRows count={5} /> : <>
      <div className="admin-stat-grid">
        <article className="admin-stat-card"><span className="admin-stat-icon stat-blue">S</span><span className="admin-stat-copy"><small>Student Profiles</small><strong>{snapshot?.students?.pagination?.total ?? '—'}</strong><em>Saved in Student Service</em></span></article>
        <article className="admin-stat-card"><span className="admin-stat-icon stat-teal">E</span><span className="admin-stat-copy"><small>Upcoming Events</small><strong>{events.filter((event) => event.status !== 'cancelled' && new Date(event.date).toISOString().slice(0, 10) >= today).length}</strong><em>Scheduled campus events</em></span></article>
        <article className="admin-stat-card"><span className="admin-stat-icon stat-amber">C</span><span className="admin-stat-copy"><small>Pending Complaints</small><strong>{snapshot?.pending?.pagination?.total ?? '—'}</strong><em>Awaiting a response</em></span></article>
        <article className="admin-stat-card"><span className="admin-stat-icon stat-slate">N</span><span className="admin-stat-copy"><small>Unread Admin Notices</small><strong>{snapshot?.notifications ? snapshot.notifications.filter((item) => !item.read).length : '—'}</strong><em>For this administrator account</em></span></article>
      </div>
      <section className="admin-panel admin-quick-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">GET STARTED</p><h2>Quick actions</h2></div></div><div className="admin-quick-actions"><button type="button" onClick={onCreateEvent}><span>＋</span><strong>Create event</strong><small>Publish a campus activity</small></button><button type="button" onClick={() => onNavigate('students')}><span>→</span><strong>Manage students</strong><small>Search student profiles</small></button><button type="button" onClick={() => onNavigate('complaints')}><span>→</span><strong>Review complaints</strong><small>Follow up on submissions</small></button><button type="button" onClick={() => onNavigate('notifications')}><span>＋</span><strong>New announcement</strong><small>Share a campus update</small></button></div></section>
      <div className="admin-dashboard-columns">
        <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">WHAT’S NEXT</p><h2>Upcoming events</h2></div><button type="button" className="admin-text-link" onClick={() => onNavigate('events')}>View all events <span>→</span></button></div>{snapshot?.events === null ? <p className="admin-inline-empty">Event information is unavailable.</p> : upcoming.length === 0 ? <p className="admin-inline-empty">No upcoming events are scheduled.</p> : <div className="admin-compact-list">{upcoming.map((event) => <article className="admin-compact-item" key={event.eventId}><span className="admin-date-tile"><small>{displayDate(event.date, { month: 'short' }).split(' ')[0]}</small><strong>{new Date(event.date).getUTCDate()}</strong></span><span className="admin-compact-copy"><strong>{event.name}</strong><small>{displayDate(event.date)} · {event.time} · {event.venue}</small></span><span className={`admin-status ${event.registrationCount >= event.maxParticipants ? 'status-warning' : 'status-info'}`}>{event.registrationCount >= event.maxParticipants ? 'Full' : `${event.registrationCount}/${event.maxParticipants}`}</span></article>)}</div>}</section>
        <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">NEEDS ATTENTION</p><h2>Recent complaints</h2></div><button type="button" className="admin-text-link" onClick={() => onNavigate('complaints')}>View all <span>→</span></button></div>{snapshot?.complaints === null ? <p className="admin-inline-empty">Complaint information is unavailable.</p> : recentComplaints.length === 0 ? <p className="admin-inline-empty">No complaints have been submitted.</p> : <div className="admin-compact-list">{recentComplaints.slice(0, 5).map((complaint) => <article className="admin-compact-item" key={complaint.complaintId}><span className="admin-complaint-mark">C</span><span className="admin-compact-copy"><strong>{complaint.subject}</strong><small>{complaint.studentId} · {displayDate(complaint.createdDate)}</small></span><span className={`admin-status ${complaint.status === 'Resolved' ? 'status-success' : complaint.status === 'Pending' ? 'status-warning' : 'status-info'}`}>{complaint.status}</span></article>)}</div>}</section>
      </div>
      <div className="admin-dashboard-columns">
        <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">STUDENT RECORDS</p><h2>Recently registered students</h2></div><button type="button" className="admin-text-link" onClick={() => onNavigate('students')}>View directory <span>→</span></button></div>{snapshot?.students === null ? <p className="admin-inline-empty">Student information is unavailable.</p> : recentStudents.length === 0 ? <p className="admin-inline-empty">No student profiles found.</p> : <div className="admin-recent-students">{recentStudents.slice(0, 5).map((student) => <article key={student.studentId}><span className="admin-avatar">{initialsFor(student.name)}</span><span><strong>{student.name}</strong><small>{student.studentId} · {student.department} · Semester {student.semester}</small></span><time>{displayDate(student.createdAt)}</time></article>)}</div>}</section>
        <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">LATEST RECORDS</p><h2>Recent activity</h2></div></div>{recentActivity.length === 0 ? <p className="admin-inline-empty">No recent records are available.</p> : <div className="admin-activity-list">{recentActivity.map((activity) => <button type="button" key={activity.key} onClick={() => onNavigate(activity.section)}><i /><span><strong>{activity.label}</strong><small>{activity.detail}</small></span><time>{displayDateTime(activity.date)}</time></button>)}</div>}</section>
      </div>
      <section className="admin-panel admin-service-health"><div className="admin-panel-heading"><div><p className="admin-eyebrow">MICROSERVICE OVERVIEW</p><h2>Service status</h2></div></div>{snapshot?.health ? <div className="admin-service-list">{snapshot.health.map((service) => <div key={service.id}><i className={service.online ? 'service-online' : 'service-offline'} /><span>{service.label}</span><strong>{service.online ? 'Online' : 'Unavailable'}</strong></div>)}</div> : <p className="admin-inline-empty">Service health could not be checked.</p>}</section>
    </>}
  </section>
}

function StudentsPage({ token, onSessionExpired }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openEvents, setOpenEvents] = useState({})
  const [registrationsByEvent, setRegistrationsByEvent] = useState({})
  const [loadingByEvent, setLoadingByEvent] = useState({})
  const [errorsByEvent, setErrorsByEvent] = useState({})
  const [reviewingId, setReviewingId] = useState('')

  useEffect(() => {
    let active = true
    api.getEvents(token).then((items) => {
      if (active) setEvents(items)
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError(safeAdminError(requestError, 'We couldn’t load events.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onSessionExpired, token])

  async function toggleEvent(eventId) {
    const willOpen = !openEvents[eventId]
    setOpenEvents((current) => ({ ...current, [eventId]: willOpen }))
    if (!willOpen || Object.prototype.hasOwnProperty.call(registrationsByEvent, eventId)) return
    setLoadingByEvent((current) => ({ ...current, [eventId]: true }))
    setErrorsByEvent((current) => ({ ...current, [eventId]: '' }))
    try {
      const result = await api.getEventRegistrations(token, eventId)
      setRegistrationsByEvent((current) => ({ ...current, [eventId]: result.registrations || [] }))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setErrorsByEvent((current) => ({ ...current, [eventId]: safeAdminError(requestError, 'Could not load this event’s registrations.') }))
    } finally {
      setLoadingByEvent((current) => ({ ...current, [eventId]: false }))
    }
  }

  async function review(eventId, registration, status) {
    const studentId = registration.studentId
    const key = `${eventId}:${studentId}`
    if (!studentId || reviewingId === key) return
    setReviewingId(key)
    try {
      await api.reviewEventRegistration(token, eventId, studentId, status)
      setRegistrationsByEvent((current) => ({
        ...current,
        [eventId]: (current[eventId] || []).map((item) => item.studentId === studentId
          ? { ...item, status, participants: Array.isArray(item.participants) ? item.participants.map((member) => ({ ...member, status })) : [] }
          : item),
      }))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setErrorsByEvent((current) => ({ ...current, [eventId]: safeAdminError(requestError, `Could not ${status.toLowerCase()} this registration.`) }))
    } finally {
      setReviewingId('')
    }
  }

  function reviewButtons(event, registration, status) {
    if (status !== 'Pending') return null
    const key = `${event.eventId}:${registration.studentId}`
    const busy = reviewingId === key
    return <div className="admin-registration-actions"><button type="button" className="admin-button admin-button-primary admin-button-compact" onClick={() => review(event.eventId, registration, 'Accepted')} disabled={busy}>{busy ? 'Saving…' : 'Accept'}</button><button type="button" className="admin-button admin-button-danger-quiet admin-button-compact" onClick={() => review(event.eventId, registration, 'Rejected')} disabled={busy}>Reject</button></div>
  }

  function registrationDetailsTable(members, registrationStatus, showStatus = true) {
    return <div className="admin-student-event-registration-table-wrap"><table className="admin-student-event-registration-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Department</th><th>Semester</th>{showStatus && <th>Status</th>}</tr></thead><tbody>{members.map((member, index) => {
      const status = member.status || registrationStatus
      const statusClass = status === 'Accepted' ? 'admin-registration-status-accepted' : status === 'Rejected' ? 'admin-registration-status-rejected' : 'admin-registration-status-pending'
      return <tr key={`${member.email || member.name || 'member'}-${index}`}><td>{member.name || '—'}</td><td>{member.email || '—'}</td><td>{member.phone || '—'}</td><td>{member.department || '—'}</td><td>{member.semester ? `Semester ${member.semester}` : '—'}</td>{showStatus && <td><span className={`admin-registration-status ${statusClass}`}>{status}</span></td>}</tr>
    })}</tbody></table></div>
  }

  return <section className="admin-section-page">
    <AdminHeading eyebrow="STUDENT SERVICES" title="Students" description="Review registrations by event." />
    <section className="admin-panel admin-student-event-list" aria-labelledby="student-event-registrations-title">
      <div className="admin-panel-heading"><div><p className="admin-eyebrow">EVENT ROSTERS</p><h2 id="student-event-registrations-title">Event Registrations</h2></div><span className="admin-count-chip">{events.length} events</span></div>
      <AdminNotice message={error} kind="error" />
      {loading ? <LoadingRows count={3} /> : events.length === 0 ? <div className="admin-empty"><strong>No events available</strong></div> : <div className="admin-student-event-registrations">{events.map((event) => {
        const open = Boolean(openEvents[event.eventId])
        const registrations = registrationsByEvent[event.eventId] || []
        return <article className="admin-student-event-registration" key={event.eventId}>
          <div className="admin-student-event-registration-header"><div><strong>{event.name}</strong><small>{event.eventType === 'group' ? 'Group event' : 'Individual event'} · {event.registrationCount ?? registrations.length} registrations</small></div><button type="button" className="admin-button admin-button-secondary admin-button-compact" aria-expanded={open} onClick={() => toggleEvent(event.eventId)}>{open ? 'Hide Registrations ▴' : 'View Registrations ▾'}</button></div>
          {open && <div className="admin-student-event-registration-groups">{loadingByEvent[event.eventId] ? <LoadingRows count={2} /> : errorsByEvent[event.eventId] ? <AdminNotice message={errorsByEvent[event.eventId]} kind="error" /> : registrations.length === 0 ? <p className="admin-inline-empty">No students have registered for this event.</p> : event.eventType === 'group' ? registrations.map((registration) => {
            const status = registration.status || 'Pending'
            const statusClass = status === 'Accepted' ? 'admin-registration-status-accepted' : status === 'Rejected' ? 'admin-registration-status-rejected' : 'admin-registration-status-pending'
            const members = Array.isArray(registration.participants) && registration.participants.length ? registration.participants : [registration]
            return <div className="admin-student-event-registration-group" key={`${event.eventId}:${registration.studentId}`}><div className="admin-student-event-registration-group-header"><div><strong>Team: {registration.teamName || 'Team registration'}</strong><span className={`admin-registration-status ${statusClass}`}>{status}</span></div>{reviewButtons(event, registration, status)}</div>{registrationDetailsTable(members, status, false)}</div>
          }) : registrations.map((registration) => {
            const status = registration.status || 'Pending'
            const statusClass = status === 'Accepted' ? 'admin-registration-status-accepted' : status === 'Rejected' ? 'admin-registration-status-rejected' : 'admin-registration-status-pending'
            const student = registration.participants?.[0] || registration
            return <div className="admin-student-event-registration-group" key={`${event.eventId}:${registration.studentId}`}><div className="admin-student-event-registration-group-header"><div><strong>{student.name || registration.name || 'Student'}</strong><span className={`admin-registration-status ${statusClass}`}>{status}</span></div>{reviewButtons(event, registration, status)}</div>{registrationDetailsTable([student], status)}</div>
          })}</div>}
        </article>
      })}</div>}
    </section>
  </section>
}

const EMPTY_EVENT_FORM = { name: '', description: '', category: 'Other', eventType: 'individual', maxTeamSize: '', date: '', time: '', venue: '', organizer: '', maxParticipants: '', registrationDeadline: '' }

function EventsManagementPage({ token, onSessionExpired, openCreateSignal, onCreateOpened }) {
  const [events, setEvents] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState('success')
  const [refreshKey, setRefreshKey] = useState(0)
  const [editing, setEditing] = useState(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [actionId, setActionId] = useState('')

  useEffect(() => {
    let active = true
    api.getEvents(token, search).then((items) => { if (active) { setEvents(items); setError('') } }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError(safeAdminError(requestError, 'We couldn’t load events. Please try again.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, search, token])

  function startCreate() { setEditing(null); setCreateModalOpen(true); setEventForm(EMPTY_EVENT_FORM); setFormError('') }
  function startEdit(event) {
    setCreateModalOpen(false)
    setEditing(event)
    setEventForm({ name: event.name || '', description: event.description || '', category: event.category || 'Other', eventType: event.eventType || 'individual', maxTeamSize: String(event.maxTeamSize ?? ''), date: event.date ? new Date(event.date).toISOString().slice(0, 10) : '', time: event.time || '', venue: event.venue || '', organizer: event.organizer || '', maxParticipants: String(event.maxParticipants ?? ''), registrationDeadline: event.registrationDeadline ? new Date(event.registrationDeadline).toISOString().slice(0, 10) : '' })
    setFormError('')
  }
  function updateEventForm(event) { setEventForm((current) => ({ ...current, [event.target.name]: event.target.value })); setFormError('') }
  async function submitEvent(event) {
    event.preventDefault()
    if (!eventForm.name.trim() || !eventForm.description.trim() || !eventForm.date || !eventForm.time || !eventForm.venue.trim() || !eventForm.organizer.trim() || !eventForm.maxParticipants) return setFormError('Complete all required fields before saving this event.')
    if (!Number.isInteger(Number(eventForm.maxParticipants)) || Number(eventForm.maxParticipants) < 1) return setFormError('Capacity must be a whole number greater than zero.')
    if (eventForm.eventType === 'group' && (!Number.isInteger(Number(eventForm.maxTeamSize)) || Number(eventForm.maxTeamSize) < 2 || Number(eventForm.maxTeamSize) > 100)) return setFormError('Maximum team size must be a whole number between 2 and 100.')
    setSaving(true); setFormError('')
    try {
      const payload = { ...eventForm, maxTeamSize: eventForm.eventType === 'group' ? Number(eventForm.maxTeamSize) : 1, maxParticipants: Number(eventForm.maxParticipants), registrationDeadline: eventForm.registrationDeadline || null }
      if (editing) await api.updateEvent(token, editing.eventId, payload); else await api.createEvent(token, payload)
      setNotice(editing ? 'Event updated successfully.' : 'Event created and campus notifications queued.'); setNoticeKind('success'); setEditing(null); setCreateModalOpen(false); setEventForm(EMPTY_EVENT_FORM); onCreateOpened(); setLoading(true); setRefreshKey((value) => value + 1)
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setFormError(safeAdminError(requestError, 'We couldn’t save this event. Please review the details and try again.'))
    } finally { setSaving(false) }
  }
  async function confirmDelete() {
    if (!deleting) return
    setActionId(deleting.eventId)
    try { await api.deleteEvent(token, deleting.eventId); setNotice('Event marked as cancelled. Registered students have been notified where applicable.'); setNoticeKind('success'); setDeleting(null); setLoading(true); setRefreshKey((value) => value + 1) }
    catch (requestError) { if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired(); else { setNotice(safeAdminError(requestError, 'We couldn’t cancel this event. Please try again.')); setNoticeKind('error') } }
    finally { setActionId('') }
  }
  const today = ADMIN_UTC_DATE
  const visibleEvents = useMemo(() => events.filter((event) => {
    const day = new Date(event.date).toISOString().slice(0, 10)
    if (statusFilter === 'cancelled') return event.status === 'cancelled'
    if (statusFilter === 'upcoming' && (event.status === 'cancelled' || day < today)) return false
    if (statusFilter === 'past' && day >= today) return false
    return true
  }), [events, statusFilter, today])
  return <section className="admin-section-page">
    <AdminHeading eyebrow="CAMPUS CALENDAR" title="Events" description="Create and manage campus events, capacity, and registrations." action={<button type="button" className="admin-button admin-button-primary" onClick={startCreate}>＋ Create event</button>} />
    <AdminNotice message={notice} kind={noticeKind} />
    <div className="admin-filter-bar"><label className="admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search events" placeholder="Search title, venue, organizer, or category" value={search} onChange={(event) => { setSearch(event.target.value); setLoading(true) }} /></label><div className="admin-segmented" role="group" aria-label="Filter events">{[['all', 'All'], ['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled']].map(([value, label]) => <button key={value} className={statusFilter === value ? 'active' : ''} type="button" onClick={() => setStatusFilter(value)}>{label}</button>)}</div><button type="button" className="admin-button admin-button-secondary" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1) }} disabled={loading}>Refresh</button></div>
    {error && <AdminNotice message={error} kind="error" />}
    {loading && events.length === 0 ? <LoadingRows count={5} /> : visibleEvents.length === 0 ? <div className="admin-panel admin-empty"><strong>{search ? 'No events match your search' : 'No events found'}</strong><span>Create an event or adjust your search and filters.</span></div> : <section className="admin-event-grid">{visibleEvents.map((event) => {
      const day = new Date(event.date).toISOString().slice(0, 10); const full = Number(event.registrationCount) >= Number(event.maxParticipants); const available = Math.max(0, Number(event.maxParticipants) - Number(event.registrationCount)); const state = event.status === 'cancelled' ? 'Cancelled' : day < today ? 'Completed' : full ? 'Full' : 'Upcoming'
      return <article className={`admin-event-card${event.status === 'cancelled' ? ' admin-event-card-cancelled' : ''}`} key={event.eventId}><div className="admin-event-card-top"><span className="admin-category-pill">{event.category || 'Other'}</span><span className={`admin-status ${state === 'Completed' || state === 'Cancelled' ? 'status-slate' : state === 'Full' ? 'status-warning' : 'status-info'}`}>{state}</span></div><h2>{event.name}</h2><p>{event.description}</p><div className="admin-event-facts"><span><small>Date &amp; time</small><strong>{displayDate(event.date)} · {event.time}</strong></span><span><small>Venue</small><strong>{event.venue}</strong></span><span><small>Organizer</small><strong>{event.organizer}</strong></span><span><small>Seats</small><strong>{available} available · {event.registrationCount}/{event.maxParticipants}</strong></span>{event.registrationDeadline && <span><small>Registration closes</small><strong>{displayDate(event.registrationDeadline)}</strong></span>}</div><div className="admin-card-actions">{event.status !== 'cancelled' && <><button type="button" className="admin-button admin-button-secondary" onClick={() => startEdit(event)}>Edit</button><button type="button" className="admin-button admin-button-danger-quiet" onClick={() => setDeleting(event)}>Cancel</button></>}</div></article>
    })}</section>}
    {(editing || createModalOpen || openCreateSignal) && <div className="admin-modal-backdrop"><section className="admin-modal admin-modal-wide" role="dialog" aria-modal="true" aria-labelledby="event-form-title"><div className="admin-modal-heading"><div><p className="admin-eyebrow">CAMPUS CALENDAR</p><h2 id="event-form-title">{editing ? 'Edit event' : 'Create event'}</h2></div><button type="button" className="admin-icon-button" onClick={() => { setEditing(null); setCreateModalOpen(false); setEventForm(EMPTY_EVENT_FORM); onCreateOpened() }} disabled={saving} aria-label="Close event form">×</button></div><form className="admin-form" onSubmit={submitEvent}><div className="admin-form-grid"><label className="admin-field admin-field-wide"><span>Event title</span><input name="name" value={eventForm.name} onChange={updateEventForm} maxLength={150} required /></label><label className="admin-field admin-field-wide"><span>Description</span><textarea name="description" value={eventForm.description} onChange={updateEventForm} maxLength={2000} rows={4} required /></label><label className="admin-field"><span>Category</span><select name="category" value={eventForm.category} onChange={updateEventForm}>{EVENT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="admin-field"><span>Event Type</span><select name="eventType" value={eventForm.eventType} onChange={updateEventForm}><option value="individual">Individual</option><option value="group">Group</option></select></label>{eventForm.eventType === 'group' && <label className="admin-field"><span>Maximum Team Size</span><input name="maxTeamSize" type="number" min="2" max="100" step="1" value={eventForm.maxTeamSize} onChange={updateEventForm} required /></label>}<label className="admin-field"><span>Date</span><input name="date" type="date" value={eventForm.date} onChange={updateEventForm} required /></label><label className="admin-field"><span>Time</span><input name="time" type="time" value={eventForm.time} onChange={updateEventForm} required /></label><label className="admin-field"><span>Registration deadline</span><input name="registrationDeadline" type="date" value={eventForm.registrationDeadline} onChange={updateEventForm} /></label><label className="admin-field"><span>Venue</span><input name="venue" value={eventForm.venue} onChange={updateEventForm} maxLength={150} required /></label><label className="admin-field"><span>Organizer</span><input name="organizer" value={eventForm.organizer} onChange={updateEventForm} maxLength={150} required /></label><label className="admin-field"><span>Maximum participants</span><input name="maxParticipants" type="number" min="1" max="1000000" value={eventForm.maxParticipants} onChange={updateEventForm} required /></label></div>{formError && <AdminNotice message={formError} kind="error" />}<div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={() => { setEditing(null); setCreateModalOpen(false); setEventForm(EMPTY_EVENT_FORM); onCreateOpened() }} disabled={saving}>Close</button><button type="submit" className="admin-button admin-button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create event'}</button></div></form></section></div>}
    {deleting && <div className="admin-modal-backdrop"><section className="admin-modal admin-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-event-title"><div className="admin-modal-heading"><div><p className="admin-eyebrow">CAMPUS CALENDAR</p><h2 id="cancel-event-title">Cancel this event?</h2></div></div><p className="admin-confirm-copy">“{deleting.name}” will be marked cancelled. Registered students will be notified.</p><div className="admin-modal-actions"><button type="button" className="admin-button admin-button-secondary" onClick={() => setDeleting(null)} disabled={Boolean(actionId)}>Keep event</button><button type="button" className="admin-button admin-button-danger" onClick={confirmDelete} disabled={Boolean(actionId)}>{actionId ? 'Cancelling…' : 'Cancel event'}</button></div></section></div>}
  </section>
}

function AdminComplaintsPage({ token, onSessionExpired, initialComplaintId = '', onComplaintOpened }) {
  const [filters, setFilters] = useState({ search: '', status: '', page: 1 })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusDrafts, setStatusDrafts] = useState({})
  const [resolutionNotes, setResolutionNotes] = useState({})
  const [savingId, setSavingId] = useState('')
  const [stats, setStats] = useState(null)
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([api.getAdminComplaints(token, { ...filters, limit: 20 }), api.getAdminComplaintStats(token)]).then(([complaintResult, statResult]) => { if (active) { setData(complaintResult); setStats(statResult); setError('') } }).catch((requestError) => { if (!active) return; if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired(); else setError(safeAdminError(requestError, 'We couldn’t load complaints.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, onSessionExpired, refreshKey, token])
  const openComplaint = useCallback(async (complaintId) => {
    setDetailLoading(true); setDetailError('')
    try { setSelectedComplaint(await api.getComplaintDetails(token, complaintId)) } catch (requestError) { if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired(); else setDetailError(safeAdminError(requestError, 'We couldn’t load this complaint.')) } finally { setDetailLoading(false) }
  }, [onSessionExpired, token])
  useEffect(() => { if (initialComplaintId) { void openComplaint(initialComplaintId); onComplaintOpened() } }, [initialComplaintId, onComplaintOpened, openComplaint])
  async function saveStatus(complaint) {
    const status = statusDrafts[complaint.complaintId] || complaint.status
    if (status === complaint.status) return
    setSavingId(complaint.complaintId)
    try {
      const result = await api.updateComplaintStatus(token, complaint.complaintId, status, { resolutionNote: resolutionNotes[complaint.complaintId] || '' })
      setData((current) => current && ({ ...current, complaints: current.complaints.map((item) => item.complaintId === complaint.complaintId ? result.complaint : item) }))
      if (selectedComplaint?.complaintId === complaint.complaintId) setSelectedComplaint(result.complaint)
      setNotice('Complaint status updated and the student has been notified.')
      setRefreshKey((value) => value + 1)
    } catch (requestError) { if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired(); else setNotice(safeAdminError(requestError, 'Could not update this complaint.')) }
    finally { setSavingId('') }
  }
  const complaints = data?.complaints || []
  return <section className="admin-section-page"><AdminHeading eyebrow="STUDENT SUPPORT" title="Complaints" description="Review student concerns and keep status updates moving." action={<span className="admin-count-chip">{data?.pagination?.total ?? '—'} records</span>} /><AdminNotice message={notice} /><section className="admin-stat-grid admin-complaint-stat-grid">{[['Total', stats?.total], ['Pending', stats?.pending], ['In Progress', stats?.inProgress], ['Resolved', stats?.resolved], ['Overdue', stats?.overdue]].map(([label, value]) => <article className="admin-stat-card" key={label}><span className="admin-stat-copy"><small>{label}</small><strong>{value ?? '—'}</strong></span></article>)}</section><form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); setLoading(true); setFilters((current) => ({ ...current, page: 1 })); setRefreshKey((value) => value + 1) }}><label className="admin-search-field"><span aria-hidden="true">⌕</span><input aria-label="Search complaints" placeholder="Search subject, student ID, or complaint" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label><select aria-label="Filter complaints by status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All statuses</option>{COMPLAINT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><button className="admin-button admin-button-primary" type="submit">Apply</button><button className="admin-button admin-button-secondary" type="button" onClick={() => { setLoading(true); setFilters({ search: '', status: '', page: 1 }); setRefreshKey((value) => value + 1) }}>Reset</button></form><AdminNotice message={error} kind="error" /><section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">CASE MANAGEMENT</p><h2>Complaint queue</h2></div><button type="button" className="admin-button admin-button-secondary" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1) }} disabled={loading}>Refresh</button></div>{loading && !data ? <LoadingRows /> : complaints.length === 0 ? <div className="admin-empty"><strong>No complaints found</strong></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Complaint</th><th>Student</th><th>Submitted</th><th>Status</th><th>Update status</th><th /></tr></thead><tbody>{complaints.map((complaint) => <tr key={complaint.complaintId}><td><strong>{complaint.subject}</strong><small className="admin-cell-subtext">{complaint.category}</small></td><td>{complaint.studentId}</td><td>{displayDate(complaint.createdDate)}</td><td><span className="admin-status status-info">{complaint.status}</span></td><td><div className="admin-status-editor"><select aria-label={`New status for ${complaint.subject}`} value={statusDrafts[complaint.complaintId] ?? complaint.status} onChange={(event) => setStatusDrafts((current) => ({ ...current, [complaint.complaintId]: event.target.value }))}>{COMPLAINT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><button type="button" className="admin-button admin-button-secondary admin-button-compact" onClick={() => saveStatus(complaint)} disabled={savingId === complaint.complaintId || (statusDrafts[complaint.complaintId] ?? complaint.status) === complaint.status}>{savingId === complaint.complaintId ? 'Saving…' : 'Save'}</button></div></td><td><button type="button" className="admin-text-link" onClick={() => openComplaint(complaint.complaintId)}>View details</button></td></tr>)}</tbody></table></div>}</section>{(detailLoading || selectedComplaint || detailError) && <div className="admin-modal-backdrop"><section className="admin-modal admin-modal-wide" role="dialog" aria-modal="true"><div className="admin-modal-heading"><div><p className="admin-eyebrow">COMPLAINT DETAILS</p><h2>{selectedComplaint?.subject || 'Complaint details'}</h2></div><button type="button" className="admin-icon-button" aria-label="Close" onClick={() => { setSelectedComplaint(null); setDetailError('') }}>×</button></div>{detailLoading && <LoadingRows count={2} />}{detailError && <AdminNotice message={detailError} kind="error" />}{selectedComplaint && <><dl className="admin-detail-grid"><div><dt>Student</dt><dd>{selectedComplaint.studentId}</dd></div><div><dt>Category</dt><dd>{selectedComplaint.category}</dd></div><div><dt>Status</dt><dd>{selectedComplaint.status}</dd></div><div><dt>Submitted</dt><dd>{displayDateTime(selectedComplaint.createdDate)}</dd></div></dl><div className="admin-description-block"><h3>Description</h3><p>{selectedComplaint.description}</p></div><ComplaintFeedbackHistory complaint={selectedComplaint} /></>}</section></div>}</section>
}

function AnnouncementsPage({ token, onSessionExpired, onOpenComplaint }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [systemNotifications, setSystemNotifications] = useState([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxError, setInboxError] = useState('')
  const [notificationActionId, setNotificationActionId] = useState('')

  useEffect(() => {
    let active = true
    const loadNotifications = () => {
      api.getNotifications(token).then((items) => {
        if (!active) return
        setSystemNotifications(items)
        setInboxError('')
      }).catch((requestError) => {
        if (!active) return
        if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
        else setInboxError('We couldn’t load administrative notifications. Please try again.')
      }).finally(() => {
        if (active) setInboxLoading(false)
      })
    }
    loadNotifications()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadNotifications()
    }, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [onSessionExpired, token])

  async function openSystemNotification(notification) {
    if (notification.read || notificationActionId) {
      if (notification.read && notification.relatedEntityType === 'complaint' && notification.relatedEntityId) {
        onOpenComplaint(notification.relatedEntityId)
      }
      return
    }
    setNotificationActionId(notification.notificationId)
    setInboxError('')
    try {
      const result = await api.markNotificationRead(token, notification.notificationId)
      setSystemNotifications((current) => current.map((item) => item.notificationId === notification.notificationId
        ? result.notification
        : item))
      if (notification.relatedEntityType === 'complaint' && notification.relatedEntityId) {
        onOpenComplaint(notification.relatedEntityId)
      }
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setInboxError(safeAdminError(requestError, 'We couldn’t update this notification.'))
      if (notification.relatedEntityType === 'complaint' && notification.relatedEntityId) {
        onOpenComplaint(notification.relatedEntityId)
      }
    } finally {
      setNotificationActionId('')
    }
  }

  async function reviewEventRegistration(notification, status) {
    if (notificationActionId || notification.registrationStatus !== 'Pending') return
    setNotificationActionId(notification.notificationId)
    setInboxError('')
    try {
      await api.reviewEventRegistration(token, notification.relatedEntityId, notification.registrationStudentId, status)
      if (!notification.read) await api.markNotificationRead(token, notification.notificationId)
      setSystemNotifications((current) => current.map((item) => item.notificationId === notification.notificationId
        ? { ...item, registrationStatus: status, read: true }
        : item))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setInboxError(safeAdminError(requestError, `Could not ${status.toLowerCase()} this registration.`))
    } finally {
      setNotificationActionId('')
    }
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!title.trim()) return setError('Announcement title is required.')
    if (!message.trim()) return setError('Announcement message is required.')
    setLoading(true)
    try {
      const result = await api.createCampusAnnouncement(token, { title: title.trim(), message: message.trim() })
      setLastResult(result)
      setSuccess(`Announcement sent to ${result.recipients} student profiles. ${result.created} notifications were created.`)
      setTitle('')
      setMessage('')
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError(safeAdminError(requestError, 'We couldn’t send this announcement. Please try again.'))
    } finally { setLoading(false) }
  }

  return <section className="admin-section-page">
    <AdminHeading eyebrow="CAMPUS COMMUNICATIONS" title="Notifications & Announcements" description="Review operational updates and send campus-wide announcements using the existing Notification Service." />
    <section className="admin-panel admin-operational-inbox" aria-labelledby="admin-notifications-title"><div className="admin-panel-heading"><div><p className="admin-eyebrow">SYSTEM ACTIVITY</p><h2 id="admin-notifications-title">Administrative notifications</h2></div><span className="admin-count-chip">{systemNotifications.filter((item) => !item.read).length} unread</span></div><AdminNotice message={inboxError} kind="error" />{inboxLoading ? <LoadingRows count={3} /> : systemNotifications.length === 0 ? <div className="admin-empty"><strong>No administrative notifications</strong><span>Complaint submissions, reopen requests, event registrations, and other operational updates will appear here.</span></div> : <div className="admin-operational-notification-list">{systemNotifications.map((notification) => {
      const isPendingRegistration = notification.type === 'event_registration_pending' && notification.registrationStatus === 'Pending'
      const isReviewing = notificationActionId === notification.notificationId
      return <article className={`admin-operational-notification${notification.read ? '' : ' admin-operational-notification-unread'}`} key={notification.notificationId}><div className="admin-operational-notification-copy"><div><strong>{notification.title || 'Administrative notification'}</strong><span className={`admin-notification-read-state${notification.read ? '' : ' admin-notification-unread-state'}`}>{notification.read ? 'Read' : 'Unread'}</span>{notification.registrationStatus && <span className={`admin-registration-status admin-registration-status-${notification.registrationStatus.toLowerCase()}`}>{notification.registrationStatus}</span>}</div><p>{notification.message}</p>{Array.isArray(notification.registrationParticipants) && <div className="admin-registration-participants">{notification.registrationParticipants.map((participant, index) => <p key={`${participant.email}-${index}`}><strong>{participant.name}</strong><span>{participant.email} · {participant.phone} · {participant.department} · Semester {participant.semester}</span></p>)}</div>}<time>{displayDateTime(notification.createdDate)}</time></div>{isPendingRegistration ? <div className="admin-registration-actions"><button type="button" className="admin-button admin-button-primary admin-button-compact" onClick={() => reviewEventRegistration(notification, 'Accepted')} disabled={Boolean(notificationActionId)}> {isReviewing ? 'Saving…' : 'Accept'}</button><button type="button" className="admin-button admin-button-danger-quiet admin-button-compact" onClick={() => reviewEventRegistration(notification, 'Rejected')} disabled={Boolean(notificationActionId)}>Reject</button></div> : notification.relatedEntityType === 'complaint' && <button type="button" className="admin-button admin-button-secondary admin-button-compact" onClick={() => openSystemNotification(notification)} disabled={isReviewing}>{isReviewing ? 'Opening…' : 'Open complaint'}</button>}</article>
    })}</div>}</section>
    <div className="admin-announcement-layout"><section className="admin-panel admin-announcement-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">NEW CAMPUS UPDATE</p><h2>Create announcement</h2></div><span className="admin-announcement-mark">A</span></div><p className="admin-panel-intro">This announcement will be delivered to all student profiles currently registered with Student Service. Department- or semester-based audiences are not available in the existing audience model.</p><AdminNotice message={error} kind="error" /><AdminNotice message={success} /><form className="admin-form" onSubmit={submit}><label className="admin-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Campus maintenance update" maxLength={150} required /></label><label className="admin-field"><span>Message</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a clear update for students…" maxLength={500} rows={6} required /><small className="admin-field-hint">Up to 500 characters. The message will appear in each recipient’s Notifications inbox.</small></label><div className="admin-form-footer"><span>No notification is sent until you choose Send announcement.</span><button type="submit" className="admin-button admin-button-primary" disabled={loading}>{loading ? 'Sending…' : 'Send announcement'}</button></div></form></section><aside className="admin-panel admin-announcement-side"><p className="admin-eyebrow">DELIVERY</p><h2>Campus-wide audience</h2><p>Recipients are collected from the authenticated admin-only student directory. The service sends in bounded batches and deduplicates each delivery by recipient and request key.</p>{lastResult && <div className="admin-delivery-result"><strong>Last send</strong><span>{lastResult.recipients} recipient profiles</span><span>{lastResult.created} new notifications</span></div>}</aside></div>
  </section>
}

export default AdminDashboard
