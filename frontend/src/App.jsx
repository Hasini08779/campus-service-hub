import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './api.js'
import './App.css'
import './complaints.css'
import './overview.css'
import './events.css'
import './event-registration.css'
import './notifications.css'
import AdminDashboard from './Admin.jsx'

const SESSION_KEY = 'campus-hub-session-token'
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_UTC_DATE = new Date().toISOString().slice(0, 10)
const THREE_DAYS_AHEAD_UTC_DATE = new Date(Date.parse(`${CURRENT_UTC_DATE}T00:00:00.000Z`) + (3 * 86400000)).toISOString().slice(0, 10)
const EMPTY_ITEMS = []
const departments = ['Computer Science', 'Information Technology', 'Electronics and Communication', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Business Administration', 'Other']

function getInitialSession() {
  try {
    const token = sessionStorage.getItem(SESSION_KEY)
    return { status: token ? 'checking' : 'anonymous', token: token || '', profile: null, error: '' }
  } catch {
    return { status: 'anonymous', token: '', profile: null, error: '' }
  }
}

function Brand({ light = false }) {
  return <div className={`brand${light ? ' brand-light' : ''}`}><span className="brand-mark" aria-hidden="true">✳</span><span>Campus<span className="brand-lightword">Hub</span></span></div>
}

function Field({ label, name, value, onChange, type = 'text', placeholder, autoComplete, min }) {
  return <label className="field"><span>{label}</span><input name={name} value={value} onChange={onChange} type={type} placeholder={placeholder} autoComplete={autoComplete} required minLength={min} /></label>
}

function Alert({ message, onDismiss }) {
  if (!message) return null
  return <div className="alert" role="alert"><span className="alert-mark">!</span><span>{message}</span>{onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss">×</button>}</div>
}

function formatCampusDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function complaintTimelineEntries(complaint) {
  const entries = Array.isArray(complaint.statusHistory)
    ? complaint.statusHistory.filter((entry) => entry?.status && entry.changedAt && !Number.isNaN(new Date(entry.changedAt).getTime()))
    : []
  const submittedAt = complaint.createdDate && !Number.isNaN(new Date(complaint.createdDate).getTime())
    ? complaint.createdDate
    : null

  if (entries.length === 0 && submittedAt) {
    entries.push({ status: 'Pending', changedAt: submittedAt })
  } else if (entries[0]?.status !== 'Pending' && submittedAt) {
    entries.unshift({ status: 'Pending', changedAt: submittedAt })
  }

  const hasResolutionEntry = entries.some((entry) => entry.status === 'Resolved')
  if (!hasResolutionEntry && complaint.status === 'Resolved' && complaint.resolvedAt && !Number.isNaN(new Date(complaint.resolvedAt).getTime())) {
    entries.push({ status: 'Resolved', changedAt: complaint.resolvedAt })
  }

  return entries
}

function formatComplaintTimelineDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function ComplaintRatingDisplay({ rating }) {
  const normalizedRating = Number(rating)
  if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) return null
  return <span className="complaint-rating-display" aria-label={`Your rating: ${normalizedRating} out of 5 stars`}><span className="complaint-rating-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} className={index < normalizedRating ? 'complaint-rating-filled' : 'complaint-rating-empty'}>{index < normalizedRating ? '★' : '☆'}</span>)}</span><strong>{normalizedRating}/5</strong></span>
}

function ComplaintStarSelector({ value, onSelect, disabled = false }) {
  const selectedValue = Number(value)
  return <div className="complaint-star-rating" role="radiogroup" aria-label="Resolution rating" aria-disabled={disabled}>
    <div className="complaint-star-buttons">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          aria-label={`Rate ${rating} out of 5`}
          aria-pressed={selectedValue === rating}
          className={selectedValue >= rating ? 'complaint-star-selected' : ''}
          disabled={disabled}
          onClick={() => onSelect(rating)}
        >
          <span aria-hidden="true">{selectedValue >= rating ? '★' : '☆'}</span>
        </button>
      ))}
    </div>
    <span className="complaint-star-selection">{selectedValue ? `${selectedValue} out of 5 stars selected` : 'Select 1 to 5 stars'}</span>
  </div>
}

function complaintWaitingDetails(complaint, now = Date.now()) {
  if (!['Pending', 'In Progress'].includes(complaint.status)) return null
  const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : []
  const statusEntry = [...history].reverse().find((entry) => entry.status === complaint.status && entry.changedAt)
  const since = statusEntry?.changedAt || (complaint.status === 'Pending' ? complaint.createdDate : null)
  if (!since || Number.isNaN(new Date(since).getTime())) return null

  const elapsedMs = Math.max(0, now - new Date(since).getTime())
  const days = Math.floor(elapsedMs / 86400000)
  const hours = Math.floor((elapsedMs % 86400000) / 3600000)
  const elapsed = days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'less than an hour'
  const needsAttention = complaint.status === 'Pending' ? elapsedMs >= 86400000 : elapsedMs >= 3 * 86400000
  const overdue = complaint.status === 'Pending' ? elapsedMs >= 2 * 86400000 : elapsedMs >= 5 * 86400000
  return { elapsed, needsAttention, overdue }
}

function latestResolutionEntry(complaint) {
  return [...(Array.isArray(complaint.statusHistory) ? complaint.statusHistory : [])]
    .reverse()
    .find((entry) => entry.status === 'Resolved')
}

function currentComplaintResolutionFeedback(complaint) {
  if (complaint.status !== 'Resolved') return null
  const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : []
  const cycle = Math.max(Number(complaint.resolutionCycle) || 0, history.filter((entry) => entry.status === 'Resolved').length, 1)
  const feedbackHistory = Array.isArray(complaint.resolutionFeedbackHistory) ? complaint.resolutionFeedbackHistory : []
  return feedbackHistory.find((entry) => entry.cycle === cycle)
    || (complaint.resolutionFeedback?.submittedAt && (complaint.resolutionFeedback.cycle || 1) === cycle ? complaint.resolutionFeedback : null)
}

function AuthPage({ onAuthenticated, initialError = '' }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [form, setForm] = useState({ studentId: '', name: '', email: '', password: '', department: '', semester: '' })
  const registering = mode === 'register'

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    sessionStorage.removeItem(SESSION_KEY)
    try {
      const result = registering
        ? await api.register({ ...form, semester: Number(form.semester) })
        : await api.login({ email: form.email.trim(), password: form.password })
      if (!result.token || result.user?.role !== 'student') {
        throw new Error('This portal is for student accounts. Please sign in with a student account.')
      }
      if (registering) {
        // The auth and profile APIs are independent; initialize the new profile using the
        // department and semester the student just submitted, then load its saved response.
        await api.updateStudentProfile(result.token, { department: form.department.trim(), semester: Number(form.semester) })
      }
      sessionStorage.setItem(SESSION_KEY, result.token)
      onAuthenticated(result.token)
    } catch (requestError) {
      setError(requestError.message || 'We could not complete your request. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function setTab(next) {
    setMode(next)
    setError('')
  }

  return <main className="auth-layout">
    <section className="welcome-panel">
      <div className="welcome-orbit orbit-one" /><div className="welcome-orbit orbit-two" />
      <div className="welcome-content">
        <Brand light />
        <div className="welcome-copy"><p className="eyebrow"><span /> YOUR CAMPUS, CONNECTED</p><h1>Make campus life<br />work <em>better.</em></h1><p>One place for the services, events, and support that keep your student journey moving.</p></div>
        <div className="welcome-note"><span /> Everything you need. Right where you belong.</div>
        <div className="floating-card"><span className="check-tile">✓</span><span><b>Campus, simplified</b><small>Your student hub is ready</small></span><span className="card-arrow">↗</span></div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-topline"><span>STUDENT PORTAL</span><span className="secure"><i /> Secure access</span></div>
      <div className="auth-box">
        <div className="auth-heading"><p>{registering ? 'LET’S GET YOU STARTED' : 'WELCOME BACK'}</p><h2>{registering ? 'Create your account' : 'Sign in to your hub'}</h2><span>{registering ? 'A few details and you’re ready to go.' : 'Your campus services are just a sign in away.'}</span></div>
        <div className="auth-tabs admin-auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => setTab('login')}>Student sign in</button><button type="button" role="tab" aria-selected={registering} className={registering ? 'selected' : ''} onClick={() => setTab('register')}>Create account</button></div>
        <Alert message={error} />
        <form onSubmit={submit} className="auth-form">
          {registering && <><Field label="Student ID" name="studentId" value={form.studentId} onChange={update} placeholder="e.g. STU2026001" autoComplete="off" /><Field label="Full name" name="name" value={form.name} onChange={update} placeholder="Your name as registered" autoComplete="name" /></>}
          <Field label="Student ID / College Email" name="email" type="email" value={form.email} onChange={update} placeholder="you@college.edu" autoComplete="email" />
          <Field label="Password" name="password" type="password" value={form.password} onChange={update} placeholder={registering ? 'At least 8 characters' : 'Enter your password'} autoComplete={registering ? 'new-password' : 'current-password'} min={registering ? 8 : undefined} />
          {registering && <div className="form-row"><label className="field"><span>Department</span><select name="department" value={form.department} onChange={update} required><option value="" disabled>Select department</option>{departments.map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>Semester</span><select name="semester" value={form.semester} onChange={update} required><option value="" disabled>Select</option>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Semester {value}</option>)}</select></label></div>}
          {!registering && <p className="login-hint">Having trouble signing in? Contact your campus administrator.</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy && <span className="spinner" />}{busy ? (registering ? 'Creating your account…' : 'Signing you in…') : <>{registering ? 'Create student account' : 'Sign in'} <span>→</span></>}</button>
        </form>
        <p className="terms">By continuing, you agree to use CampusHub in accordance with your institution’s policies.</p>
      </div>
      <footer className="auth-footer"><span>© {CURRENT_YEAR} Campus Service Hub</span><span>Built for campus life</span></footer>
    </section>
  </main>
}

function AdminLoginPage({ onAuthenticated, initialError = '' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [form, setForm] = useState({ email: '', password: '' })

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    sessionStorage.removeItem(SESSION_KEY)
    try {
      const result = await api.adminLogin({ email: form.email.trim(), password: form.password })
      if (!result.token || result.user?.role !== 'admin') {
        throw new Error('This access is for administrator accounts.')
      }
      sessionStorage.setItem(SESSION_KEY, result.token)
      onAuthenticated(result.token)
    } catch (requestError) {
      setError(requestError.message || 'We could not complete your request. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-layout">
    <section className="welcome-panel">
      <div className="welcome-orbit orbit-one" /><div className="welcome-orbit orbit-two" />
      <div className="welcome-content">
        <Brand light />
        <div className="welcome-copy"><p className="eyebrow"><span /> CAMPUS OPERATIONS</p><h1>Admin access<br />for campus teams.</h1><p>Manage services, reviews, and operations securely from one authorized dashboard.</p></div>
        <div className="welcome-note"><span /> Protected administration workspace</div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-topline"><span>ADMINISTRATION PORTAL</span><span className="secure"><i /> Secure access</span></div>
      <div className="auth-box">
        <div className="auth-heading"><p>CAMPUS ADMINISTRATION</p><h2>Administrator sign in</h2><span>Sign in with your administrator account.</span></div>
        <Alert message={error} />
        <form onSubmit={submit} className="auth-form">
          <Field label="Admin email" name="email" type="email" value={form.email} onChange={update} placeholder="admin@college.edu" autoComplete="email" />
          <Field label="Password" name="password" type="password" value={form.password} onChange={update} placeholder="Enter your password" autoComplete="current-password" />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing you in…' : <>Sign in as administrator <span>→</span></>}</button>
        </form>
        <p className="terms">Authorized administrative access only.</p>
      </div>
      <footer className="auth-footer"><span>© {CURRENT_YEAR} Campus Service Hub</span><span>Built for campus life</span></footer>
    </section>
  </main>
}

const profileRows = [
  ['Student ID', 'studentId', '▣'],
  ['Email address', 'email', '✉'],
  ['Department', 'department', '⌂'],
  ['Current semester', 'semester', '▤'],
  ['Phone number', 'phone', '⌕'],
]

function ComplaintPage({ token, onSessionExpired, initialComplaintId = '', onComplaintOpened }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ category: '', subject: '', description: '' })
  const [linkedComplaint, setLinkedComplaint] = useState(null)
  const [linkedComplaintLoading, setLinkedComplaintLoading] = useState(Boolean(initialComplaintId))
  const [linkedComplaintError, setLinkedComplaintError] = useState('')
  const [linkedComplaintDismissed, setLinkedComplaintDismissed] = useState(false)
  const [complaintActionId, setComplaintActionId] = useState('')
  const [complaintActionMessages, setComplaintActionMessages] = useState({})
  const [complaintActionErrors, setComplaintActionErrors] = useState({})
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [timelineExpanded, setTimelineExpanded] = useState({})

  const loadComplaints = useCallback(async () => {
    setLoadError('')
    try {
      setComplaints(await api.getMyComplaints(token))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
      } else {
        setLoadError(requestError.message)
      }
    } finally {
      setLoading(false)
    }
  }, [onSessionExpired, token])

  const refreshComplaintsOnFocus = useCallback(() => {
    setLoading(true)
    void loadComplaints()
  }, [loadComplaints])
  useRefreshOnFocus(refreshComplaintsOnFocus)

  useEffect(() => {
    let active = true
    api.getMyComplaints(token).then((items) => {
      if (active) setComplaints(items)
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
      } else {
        setLoadError(requestError.message)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [onSessionExpired, token])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      api.getMyComplaints(token).then((items) => {
        setComplaints(items)
        if (initialComplaintId) {
          const updatedComplaint = items.find((item) => item.complaintId === initialComplaintId)
          if (updatedComplaint) setLinkedComplaint(updatedComplaint)
        }
      }).catch((requestError) => {
        if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      })
    }, 5000)
    return () => window.clearInterval(interval)
  }, [initialComplaintId, onSessionExpired, token])

  useEffect(() => {
    if (!initialComplaintId) return undefined
    let active = true
    api.getComplaintDetails(token, initialComplaintId).then((complaint) => {
      if (!active) return
      setLinkedComplaint(complaint)
      document.getElementById(`complaint-${initialComplaintId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
        setLinkedComplaintError('Your session has expired. Please sign in again.')
      } else {
        setLinkedComplaintError(requestError instanceof ApiError && requestError.status === 404 ? 'This complaint is no longer available.' : 'We couldn’t load this complaint. Please try again.')
      }
    }).finally(() => {
      if (active) {
        setLinkedComplaintLoading(false)
        onComplaintOpened()
      }
    })
    return () => { active = false }
  }, [initialComplaintId, onComplaintOpened, onSessionExpired, token])

  function refreshComplaints() {
    setLoading(true)
    loadComplaints()
  }

  function updateComplaintRecord(updatedComplaint) {
    setComplaints((current) => current.map((item) => item.complaintId === updatedComplaint.complaintId ? updatedComplaint : item))
    setLinkedComplaint((current) => current?.complaintId === updatedComplaint.complaintId ? updatedComplaint : current)
  }

  async function acknowledgeResolution(complaint) {
    setComplaintActionId(complaint.complaintId)
    setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: '' }))
    try {
      const result = await api.acknowledgeComplaintResolution(token, complaint.complaintId)
      updateComplaintRecord(result.complaint)
      setComplaintActionMessages((current) => ({ ...current, [complaint.complaintId]: 'You confirmed that the issue is resolved.' }))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: requestError.message || 'We couldn’t confirm the resolution.' }))
    } finally { setComplaintActionId('') }
  }

  async function reopenComplaint(complaint) {
    if (!window.confirm('Reopen this complaint? The campus support team will be notified.')) return
    setComplaintActionId(complaint.complaintId)
    setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: '' }))
    try {
      const result = await api.reopenComplaint(token, complaint.complaintId)
      updateComplaintRecord(result.complaint)
      setFeedbackDrafts((current) => ({ ...current, [complaint.complaintId]: { rating: '', comment: '' } }))
      setComplaintActionMessages((current) => ({ ...current, [complaint.complaintId]: result.message }))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: requestError.message || 'We couldn’t reopen this complaint.' }))
    } finally { setComplaintActionId('') }
  }

  async function submitComplaintFeedback(event, complaint) {
    event.preventDefault()
    const draft = feedbackDrafts[complaint.complaintId] || { rating: '', comment: '' }
    if (!draft.rating && !draft.comment.trim()) {
      setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: 'Choose a rating or enter short feedback.' }))
      return
    }
    setComplaintActionId(complaint.complaintId)
    setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: '' }))
    try {
      const feedback = { ...(draft.rating ? { rating: Number(draft.rating) } : {}), ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}) }
      const result = await api.submitComplaintFeedback(token, complaint.complaintId, feedback)
      updateComplaintRecord(result.complaint)
      setFeedbackDrafts((current) => ({ ...current, [complaint.complaintId]: { rating: '', comment: '' } }))
      setComplaintActionMessages((current) => ({ ...current, [complaint.complaintId]: result.message }))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setComplaintActionErrors((current) => ({ ...current, [complaint.complaintId]: requestError.message || 'We couldn’t submit your feedback.' }))
    } finally { setComplaintActionId('') }
  }

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
    setSubmitError('')
    setSuccess('')
  }

  function toggleComplaintTimeline(complaintId) {
    setTimelineExpanded((current) => ({
      ...current,
      [complaintId]: !Boolean(current[complaintId]),
    }))
  }

  async function submitComplaint(event) {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError('')
    setSuccess('')
    try {
      const result = await api.createComplaint(token, {
        category: form.category.trim(),
        subject: form.subject.trim(),
        description: form.description.trim(),
      })
      setSuccess(result.message || 'Your complaint has been submitted.')
      setForm({ category: '', subject: '', description: '' })
      await loadComplaints()
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
      } else {
        setSubmitError(requestError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return <section className="complaints-page" aria-labelledby="complaints-title">
    <div className="complaints-intro"><div className="complaints-title-group"><p className="eyebrow dashboard-eyebrow">STUDENT SUPPORT</p><h1 id="complaints-title">Complaints</h1><p>Raise a concern and keep track of its progress.</p></div><div className="complaints-intro-actions"><span className="complaint-count">{complaints.length} {complaints.length === 1 ? 'complaint' : 'complaints'}</span><a className="raise-complaint-link" href="#raise-complaint-form">＋ <span>Raise complaint</span></a></div></div>
    <div className="complaint-compose-card" id="raise-complaint-form">
      <div className="complaint-form-heading"><span className="complaint-form-icon">＋</span><div><h2>Raise a complaint</h2><p>Share the details below. Your complaint will be sent to the student services team.</p></div></div>
      <Alert message={submitError} />
      {success && <div className="success-message" role="status"><span>✓</span>{success}</div>}
      <form className="complaint-form" onSubmit={submitComplaint}>
        <div className="complaint-form-row">
          <label className="field"><span>Category</span><input name="category" value={form.category} onChange={updateForm} placeholder="e.g. Facilities" maxLength={80} minLength={2} required /></label>
          <label className="field"><span>Subject</span><input name="subject" value={form.subject} onChange={updateForm} placeholder="Briefly describe the issue" maxLength={150} minLength={3} required /></label>
        </div>
        <label className="field"><span>Description</span><textarea name="description" value={form.description} onChange={updateForm} placeholder="Please provide enough detail for the team to understand and respond to your concern." maxLength={5000} minLength={10} rows={4} required /></label>
        <div className="complaint-form-footer"><span>Your complaint will be submitted privately to the campus team.</span><button className="primary-button complaint-submit" type="submit" disabled={submitting}>{submitting && <span className="spinner" />}{submitting ? 'Submitting…' : <>Submit complaint <span>→</span></>}</button></div>
      </form>
    </div>

    <section className="complaint-list-card" aria-labelledby="my-complaints-title">
      <div className="complaint-list-heading"><div><p className="section-eyebrow">YOUR SUBMISSIONS</p><h2 id="my-complaints-title">My complaints</h2></div><button type="button" className="refresh-complaints" onClick={refreshComplaints} disabled={loading}>{loading ? 'Loading…' : 'Refresh ↻'}</button></div>
      {loading && <div className="complaint-state"><span className="spinner spinner-blue" /><p>Loading your complaints…</p></div>}
      {!loading && loadError && <div className="complaint-state complaint-state-error"><span className="state-icon">!</span><h3>We couldn’t load your complaints</h3><p>{loadError}</p><button type="button" className="secondary-button" onClick={refreshComplaints}>Try again</button></div>}
      {!loading && !loadError && complaints.length === 0 && <div className="complaint-state empty-state"><span className="empty-icon">☷</span><h3>No complaints yet</h3><p>If you need help or want to report a concern, use the form above to raise a complaint.</p></div>}
      {!loading && !loadError && complaints.length > 0 && <div className="complaint-list">{complaints.map((complaint) => {
        const timeline = complaintTimelineEntries(complaint)
        const waiting = complaintWaitingDetails(complaint)
        const resolutionEntry = latestResolutionEntry(complaint)
        const resolutionNote = complaint.resolutionNote || resolutionEntry?.resolutionNote
        const currentCycleFeedback = complaint.status === 'Resolved' ? currentComplaintResolutionFeedback(complaint) : null
        const feedbackDraft = feedbackDrafts[complaint.complaintId] || { rating: '', comment: '' }
        const actionBusy = complaintActionId === complaint.complaintId
        const isTimelineExpanded = Boolean(timelineExpanded[complaint.complaintId])
        return <article className="complaint-item" id={`complaint-${complaint.complaintId}`} key={complaint.complaintId}>
          <div className="complaint-item-top"><h3>{complaint.subject}</h3><span className={`status-pill status-${complaint.status?.toLowerCase().replaceAll(' ', '-')}`}>{complaint.status}</span></div>
          <div className="complaint-metadata"><span>{complaint.category}</span><span aria-hidden="true">·</span><time dateTime={complaint.createdDate}>{complaint.createdDate ? new Date(complaint.createdDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable'}</time></div>
          <p>{complaint.description}</p>
          {waiting && <div className="complaint-age-row"><span>{complaint.status} for {waiting.elapsed}</span>{waiting.needsAttention && <span className="complaint-attention-badge">Needs Attention</span>}{waiting.overdue && <span className="complaint-overdue-badge">Overdue</span>}</div>}
          {complaint.status === 'Resolved' && <div className="complaint-resolution-message" role="status"><strong>Status: Resolved</strong><span>{resolutionEntry?.changedAt || complaint.resolvedAt ? `Resolved ${formatComplaintTimelineDate(resolutionEntry?.changedAt || complaint.resolvedAt)}` : 'Your complaint has been resolved.'}</span>{resolutionNote && <div><b>Admin response</b><p>{resolutionNote}</p></div>}</div>}
          {timeline.length > 0 && <section className="complaint-timeline-section" aria-label="Complaint timeline">
            <div className="complaint-timeline-header">
              <h4>Complaint timeline</h4>
              <button
                type="button"
                className="complaint-timeline-toggle"
                aria-expanded={isTimelineExpanded}
                onClick={() => toggleComplaintTimeline(complaint.complaintId)}
              >
                {isTimelineExpanded ? 'Hide Timeline' : 'View Timeline'}
              </button>
            </div>
            {isTimelineExpanded && <ol className="complaint-timeline">{timeline.map((entry, index) => {
              const label = entry.event === 'reopened' ? 'Reopened — In Progress' : entry.status === 'Pending' && index === 0 ? 'Submitted' : entry.status === 'In Progress' ? 'In Progress / Under Review' : entry.status
              const changedAt = new Date(entry.changedAt).toISOString()
              return <li className={`complaint-timeline-entry${index === timeline.length - 1 ? ' complaint-timeline-entry-current' : ''}`} key={`${entry.status}-${changedAt}-${index}`}>
                <span className="complaint-timeline-marker" aria-hidden="true" />
                <span className="complaint-timeline-copy"><strong>{label}</strong><time dateTime={changedAt}>{formatComplaintTimelineDate(changedAt)}</time></span>
              </li>
            })}</ol>}
          </section>}
          {complaint.status === 'Resolved' && <section className="complaint-resolution-actions" aria-label="Resolution options">
            <div className="complaint-resolution-choice"><div><strong>Is the issue resolved?</strong><span>{complaint.resolutionConfirmedAt ? `Confirmed ${formatComplaintTimelineDate(complaint.resolutionConfirmedAt)}` : 'Let the campus team know if the solution worked.'}</span></div><div className="complaint-resolution-buttons"><button type="button" className="complaint-confirm-button" onClick={() => acknowledgeResolution(complaint)} disabled={actionBusy || Boolean(complaint.resolutionConfirmedAt)}>{actionBusy ? 'Saving…' : complaint.resolutionConfirmedAt ? 'Issue Confirmed' : 'Issue Resolved'}</button><button type="button" className="complaint-reopen-button" onClick={() => reopenComplaint(complaint)} disabled={actionBusy}>{actionBusy ? 'Updating…' : 'Reopen Complaint'}</button></div></div>
            {currentCycleFeedback ? <div className="complaint-feedback-saved"><strong>Your resolution feedback</strong>{currentCycleFeedback.rating && <ComplaintRatingDisplay rating={currentCycleFeedback.rating} />}{currentCycleFeedback.comment && <p>{currentCycleFeedback.comment}</p>}<time>{formatComplaintTimelineDate(currentCycleFeedback.submittedAt)}</time></div> : <form className="complaint-feedback-form" onSubmit={(event) => submitComplaintFeedback(event, complaint)}><strong>Optional resolution feedback</strong><div className="complaint-feedback-fields"><label><span>Rating</span><ComplaintStarSelector value={feedbackDraft.rating} onSelect={(rating) => setFeedbackDrafts((current) => ({ ...current, [complaint.complaintId]: { ...feedbackDraft, rating } }))} disabled={actionBusy} /></label><label className="complaint-feedback-comment"><span>Short feedback</span><textarea value={feedbackDraft.comment} onChange={(event) => setFeedbackDrafts((current) => ({ ...current, [complaint.complaintId]: { ...feedbackDraft, comment: event.target.value } }))} maxLength={500} rows={2} placeholder="Share a brief note about the resolution" /></label><button type="submit" disabled={actionBusy}>{actionBusy ? 'Submitting…' : 'Send feedback'}</button></div></form>}
          </section>}
          {complaintActionMessages[complaint.complaintId] && <p className="complaint-action-message" role="status">{complaintActionMessages[complaint.complaintId]}</p>}
          {complaintActionErrors[complaint.complaintId] && <p className="complaint-action-error" role="alert">{complaintActionErrors[complaint.complaintId]}</p>}
          <div className="complaint-item-footer"><span className="tracking-note">Status updates appear here</span></div>
        </article>
      })}</div>}
    </section>
    {!linkedComplaintDismissed && (linkedComplaintLoading || linkedComplaint || linkedComplaintError) && <div className="registration-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLinkedComplaintDismissed(true) }}>
      <section className="registration-modal complaint-linked-modal" role="dialog" aria-modal="true" aria-labelledby="linked-complaint-title">
        <div className="registration-modal-header"><div><p className="eyebrow dashboard-eyebrow">STUDENT SUPPORT</p><h2 id="linked-complaint-title">{linkedComplaint?.subject || 'Complaint details'}</h2></div><button type="button" className="registration-modal-close" onClick={() => setLinkedComplaintDismissed(true)} aria-label="Close complaint details">×</button></div>
        {linkedComplaintLoading && <div className="complaint-linked-loading"><span className="spinner spinner-blue" /><p>Loading complaint details…</p></div>}
        {linkedComplaintError && <div className="registration-error" role="alert">{linkedComplaintError}</div>}
        {linkedComplaint && <><div className="complaint-linked-status"><span className="section-eyebrow">CURRENT STATUS</span><span className={`status-pill status-${linkedComplaint.status?.toLowerCase().replaceAll(' ', '-')}`}>{linkedComplaint.status}</span></div><dl className="complaint-linked-facts"><div><dt>Category</dt><dd>{linkedComplaint.category}</dd></div><div><dt>Submitted</dt><dd>{linkedComplaint.createdDate ? new Date(linkedComplaint.createdDate).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'}</dd></div><div><dt>Last updated</dt><dd>{linkedComplaint.updatedAt ? new Date(linkedComplaint.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not updated'}</dd></div></dl><div className="complaint-linked-description"><h3>Description</h3><p>{linkedComplaint.description}</p></div></>}
      </section>
    </div>}
  </section>
}

function Dashboard({ profile, token, onLogout, onRefresh, refreshing, error, dismissError }) {
  const firstName = profile.name?.trim().split(/\s+/)[0] || 'Student'
  const initials = profile.name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'
  const [activeSection, setActiveSection] = useState('overview')
  const [eventToOpen, setEventToOpen] = useState('')
  const [complaintToOpen, setComplaintToOpen] = useState('')
  const expireSession = useCallback(() => onLogout('Your session has expired. Please sign in again.'), [onLogout])
  const clearEventToOpen = useCallback(() => setEventToOpen(''), [])
  const clearComplaintToOpen = useCallback(() => setComplaintToOpen(''), [])
  const navigate = useCallback((section) => setActiveSection(section), [])
  const openEvent = useCallback((eventId) => {
    setEventToOpen(eventId)
    setComplaintToOpen('')
    setActiveSection('events')
  }, [])
  const openNotificationDestination = useCallback((notification) => {
    if (notification.relatedEntityType === 'event') {
      setEventToOpen(notification.relatedEntityId)
      setComplaintToOpen('')
      setActiveSection('events')
    } else if (notification.relatedEntityType === 'complaint') {
      setComplaintToOpen(notification.relatedEntityId)
      setEventToOpen('')
      setActiveSection('complaints')
    }
  }, [])

  return <main className="dashboard">
    <header className="dashboard-header"><Brand /><nav className="student-nav" aria-label="Student portal"><button type="button" className={activeSection === 'overview' ? 'active' : ''} aria-current={activeSection === 'overview' ? 'page' : undefined} onClick={() => setActiveSection('overview')}>Overview</button><button type="button" className={activeSection === 'complaints' ? 'active' : ''} aria-current={activeSection === 'complaints' ? 'page' : undefined} onClick={() => setActiveSection('complaints')}>Complaints</button><button type="button" className={activeSection === 'events' ? 'active' : ''} aria-current={activeSection === 'events' ? 'page' : undefined} onClick={() => setActiveSection('events')}>Events</button><button type="button" className={activeSection === 'notifications' ? 'active' : ''} aria-current={activeSection === 'notifications' ? 'page' : undefined} onClick={() => setActiveSection('notifications')}>Notifications</button></nav><div className="header-actions"><span className="portal-label"><i /> Student portal</span><span className="avatar avatar-small">{initials}</span><span className="header-name">{profile.name}</span><button type="button" className="logout" onClick={onLogout}>Sign out <span>↗</span></button></div></header>
    <section className="dashboard-main">
      {activeSection === 'complaints' ? <ComplaintPage token={token} onSessionExpired={expireSession} initialComplaintId={complaintToOpen} onComplaintOpened={clearComplaintToOpen} /> : activeSection === 'events' ? <EventsPage token={token} onSessionExpired={expireSession} initialEventId={eventToOpen} onEventOpened={clearEventToOpen} /> : activeSection === 'notifications' ? <NotificationsPage token={token} onSessionExpired={expireSession} onOpenNotification={openNotificationDestination} /> : <div className="overview-page">
        <section className="overview-welcome" aria-labelledby="overview-title"><div className="overview-welcome-copy"><p className="eyebrow dashboard-eyebrow">✳ &nbsp;YOUR CAMPUS AT A GLANCE</p><h1 id="overview-title">Welcome to CampusHub Events, <span>{firstName}.</span></h1><p>Discover what’s happening across campus and plan your next activity.</p></div><div className="overview-welcome-actions"><div className="overview-id-badge"><span className="overview-id-icon">✦</span><span><small>STUDENT ID</small><strong>{profile.studentId}</strong></span></div><button className="overview-refresh-button" type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh profile ↻'}</button></div></section>
        <Alert message={error} onDismiss={dismissError} />
        <StudentOverviewInsights token={token} onSessionExpired={expireSession} onNavigate={navigate} onOpenEvent={openEvent} />
        <div className="overview-grid"><section className="overview-profile-card" aria-labelledby="overview-profile-title"><div className="overview-card-heading"><div><span className="overview-section-label">STUDENT RECORD</span><h2 id="overview-profile-title">My profile</h2></div><span className="overview-verified"><span>✓</span> Verified</span></div><div className="overview-identity"><span className="avatar avatar-large">{initials}</span><div><h3>{profile.name}</h3><p>{profile.department}</p></div></div><div className="overview-details-grid">{profileRows.map(([label, key, icon]) => <div className="overview-detail" key={key}><span className="overview-detail-icon">{icon}</span><span className="overview-detail-copy"><small>{label}</small><strong>{key === 'semester' ? (profile[key] ? `Semester ${profile[key]}` : 'Not provided') : (profile[key] || 'Not provided')}</strong></span></div>)}</div><div className="overview-profile-footer"><span><i /> Profile synced from student services</span><button type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? <><span className="spinner overview-refresh-spinner" /> Refreshing…</> : <>Refresh profile <span aria-hidden="true">↻</span></>}</button></div></section><aside className="overview-aside"><section className="overview-account-card"><div className="overview-account-copy"><span className="overview-section-label">YOUR CAMPUS ACCOUNT</span><h2>All set for the semester.</h2><p>Your student profile is connected to CampusHub. More campus services will be available here as they come online.</p></div><div className="overview-account-status"><span className="overview-active-check">✓</span><span><strong>Account active</strong><small>Signed in securely</small></span></div></section><section className="overview-help-card"><span className="overview-help-icon">?</span><span className="overview-help-copy"><strong>Need a hand?</strong><small>For profile corrections, contact your student services office.</small></span><span className="overview-help-arrow" aria-hidden="true">↗</span></section></aside></div>
      </div>}
      <footer className="dashboard-footer"><span>CampusHub <i>·</i> Student services, simplified.</span><span>Your information is shown only to you.</span></footer>
    </section>
  </main>
}

function App() {
  const [session, setSession] = useState(getInitialSession)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname || '/')
  const loadAccount = useCallback(async (token) => {
    const user = await api.getCurrentUser(token)
    const profile = user.role === 'student' ? await api.getStudentProfile(token) : user
    return { role: user.role, profile }
  }, [])

  useEffect(() => {
    const syncPath = () => setCurrentPath(window.location.pathname || '/')
    window.addEventListener('popstate', syncPath)
    return () => window.removeEventListener('popstate', syncPath)
  }, [])

  useEffect(() => {
    const token = session.token
    if (!token) return undefined
    let active = true
    loadAccount(token).then(({ role, profile }) => {
      if (active) setSession({ status: 'authenticated', token, role, profile, error: '' })
    }).catch((requestError) => {
      if (!active) return
      sessionStorage.removeItem(SESSION_KEY)
      setSession({ status: 'anonymous', token: '', profile: null, error: requestError instanceof ApiError && requestError.status === 401 ? 'Your session has expired. Please sign in again.' : requestError.message })
    })
    return () => { active = false }
  }, [loadAccount, session.token])

  const logout = useCallback((message = '') => {
    sessionStorage.removeItem(SESSION_KEY)
    setRefreshing(false)
    setRefreshError('')
    if (window.location.pathname === '/admin-login') {
      window.history.pushState({}, '', '/')
      setCurrentPath('/')
    }
    setSession({ status: 'anonymous', token: '', profile: null, error: message })
  }, [])
  const authenticate = useCallback((token) => {
    sessionStorage.setItem(SESSION_KEY, token)
    setSession({ status: 'checking', token, profile: null, error: '' })
  }, [])
  const refreshProfile = useCallback(async () => {
    if (!session.token) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const { role, profile } = await loadAccount(session.token)
      setSession((current) => current.token === session.token ? { ...current, status: 'authenticated', role, profile } : current)
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) logout('Your session has expired. Please sign in again.')
      else setRefreshError(requestError.message || 'We couldn’t refresh your profile. Please try again.')
    } finally {
      setRefreshing(false)
    }
  }, [loadAccount, logout, session.token])

  if (session.status === 'checking') return <main className="session-check"><span className="spinner spinner-blue" /><p>Connecting to CampusHub…</p></main>
  if (session.status === 'authenticated' && session.role === 'admin') return <AdminDashboard profile={session.profile} token={session.token} onLogout={() => logout()} onSessionExpired={() => logout('Your session has expired. Please sign in again.')} />
  if (session.status === 'authenticated' && session.profile) return <Dashboard profile={session.profile} token={session.token} onLogout={() => logout()} onRefresh={refreshProfile} refreshing={refreshing} error={refreshError} dismissError={() => setRefreshError('')} />
  if (currentPath === '/admin-login') return <AdminLoginPage onAuthenticated={authenticate} initialError={session.error} />
  return <AuthPage onAuthenticated={authenticate} initialError={session.error} />
}

export default App

function EventsPage({ token, onSessionExpired, initialEventId = '', onEventOpened }) {
  const [events, setEvents] = useState([])
  const [registeredEvents, setRegisteredEvents] = useState([])
  const [view, setView] = useState('upcoming')
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [eventsLoading, setEventsLoading] = useState(true)
  const [registrationsLoading, setRegistrationsLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionEventId, setActionEventId] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState('success')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [registrationDetails, setRegistrationDetails] = useState([])
  const [registrationTeamName, setRegistrationTeamName] = useState('')
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false)
  const [clock, setClock] = useState(Date.now())
  const [eventToCancel, setEventToCancel] = useState(null)
  const [detailEvent, setDetailEvent] = useState(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(initialEventId))
  const [detailError, setDetailError] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const hasLoadedEvents = useRef(false)
  const handledEventId = useRef('')

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = search.trim()
      if (nextQuery !== searchQuery) {
        setEventsLoading(true)
        setError('')
        setSearchQuery(nextQuery)
      } else {
        if (hasLoadedEvents.current) setEventsLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search, searchQuery])

  useEffect(() => {
    let active = true
    api.getEvents(token, searchQuery).then((items) => {
      if (active) setEvents(items)
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError('We couldn’t load campus events. Check your connection and try again.')
    }).finally(() => {
      if (active) {
        hasLoadedEvents.current = true
        setEventsLoading(false)
      }
    })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, searchQuery, token])

  useEffect(() => {
    let active = true
    api.getMyEventRegistrations(token).then((items) => {
      if (active) setRegisteredEvents(items)
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError('We couldn’t load your registrations. Please try again.')
    }).finally(() => {
      if (active) setRegistrationsLoading(false)
    })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, token])

  const refreshEvents = useCallback(() => {
    setEventsLoading(true)
    setRegistrationsLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }, [])
  useRefreshOnFocus(refreshEvents)

  const registeredIds = useMemo(() => new Set(registeredEvents.map((event) => event.eventId)), [registeredEvents])
  const registeredEventsById = useMemo(() => new Map(registeredEvents.map((event) => [event.eventId, event])), [registeredEvents])
  const todayUtcDate = new Date(clock).toISOString().slice(0, 10)
  const dateKey = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  }
  const isCancelledEvent = (event) => event.status === 'cancelled'
  const isPastEvent = (event) => Boolean(dateKey(event.date) && dateKey(event.date) < todayUtcDate)
  const isDeadlineClosed = (event) => Boolean(event.registrationDeadline && dateKey(event.registrationDeadline) < todayUtcDate)
  const deadlineDaysRemaining = (event) => event.registrationDeadline ? Math.round((Date.parse(`${dateKey(event.registrationDeadline)}T00:00:00.000Z`) - Date.parse(`${todayUtcDate}T00:00:00.000Z`)) / 86400000) : null
  const isFull = (event) => Number.isFinite(Number(event.maxParticipants)) && Number(event.maxParticipants) > 0 && Number(event.registrationCount || 0) >= Number(event.maxParticipants)
  const capacityDetails = (event) => {
    const capacity = Number(event.maxParticipants)
    if (!Number.isFinite(capacity) || capacity < 1) return null
    const registered = Math.max(0, Number(event.registrationCount) || 0)
    const seatsLeft = Math.max(0, capacity - registered)
    return { capacity, registered, seatsLeft, almostFull: seatsLeft > 0 && (seatsLeft <= 3 || registered / capacity >= 0.9) }
  }
  const registrationUrgency = (event, capacity) => {
    if (isCancelledEvent(event)) return { label: 'Cancelled', className: 'event-urgency-muted' }
    if (isPastEvent(event) || isDeadlineClosed(event)) return { label: 'Registration Closed', className: 'event-urgency-muted' }
    if (isFull(event)) return { label: 'Full', className: 'event-urgency-full' }
    const daysRemaining = deadlineDaysRemaining(event)
    if (daysRemaining === 0) return { label: 'Last Day to Register', className: 'event-urgency-full' }
    if (daysRemaining === 1) return { label: 'Closing Tomorrow', className: 'event-urgency-soon' }
    if (capacity?.almostFull) return { label: 'Almost Full', className: 'event-urgency-soon' }
    return { label: 'Registration Open', className: 'event-urgency-open' }
  }
  const categories = ['All', 'Workshop', 'Technical', 'Cultural', 'Sports', 'Competition', 'Seminar', 'Other']
  const matchesEventFilters = (event) => {
    if (category !== 'All' && (event.category || 'Other').toLowerCase() !== category.toLowerCase()) return false
    if (searchQuery) {
      const text = [event.name, event.description, event.organizer, event.venue, event.category].join(' ').toLowerCase()
      if (!text.includes(searchQuery.toLowerCase())) return false
    }
    return true
  }
  const getEventsForView = (source, targetView) => source.filter((event) => {
    if (targetView === 'all' && isCancelledEvent(event)) return false
    if (targetView === 'upcoming' && (isPastEvent(event) || isCancelledEvent(event))) return false
    if (targetView === 'past' && !isPastEvent(event) && !isCancelledEvent(event)) return false
    return matchesEventFilters(event)
  })
  const allVisibleEvents = getEventsForView(events, 'all')
  const upcomingEvents = getEventsForView(events, 'upcoming')
  const pastEvents = getEventsForView(events, 'past')
  const registeredVisibleEvents = getEventsForView(registeredEvents, 'registered')
  const activeRegisteredVisibleEvents = registeredVisibleEvents.filter((event) => !isCancelledEvent(event))
  const visibleEvents = view === 'all'
    ? allVisibleEvents
    : view === 'past'
      ? pastEvents
      : view === 'registered'
        ? registeredVisibleEvents
        : upcomingEvents
  const unregisteredUpcoming = visibleEvents.filter((event) => view === 'upcoming' && !registeredIds.has(event.eventId))
  const registeredCategories = new Set(registeredEvents.map((event) => (event.category || 'Other').toLowerCase()))
  const recommendedEvents = unregisteredUpcoming.filter((event) => registeredCategories.has((event.category || 'Other').toLowerCase()))
  const recommendedIds = new Set(recommendedEvents.map((event) => event.eventId))
  const closingSoonEvents = unregisteredUpcoming.filter((event) => {
    const remaining = deadlineDaysRemaining(event)
    return !recommendedIds.has(event.eventId) && remaining !== null && remaining >= 0 && remaining <= 3 && !isFull(event) && !isDeadlineClosed(event)
  }).sort((a, b) => new Date(a.registrationDeadline) - new Date(b.registrationDeadline))
  const closingSoonIds = new Set(closingSoonEvents.map((event) => event.eventId))
  const otherUpcomingEvents = unregisteredUpcoming.filter((event) => !recommendedIds.has(event.eventId) && !closingSoonIds.has(event.eventId))
  const registeredUpcomingEvents = view === 'upcoming' ? getEventsForView(registeredEvents, 'upcoming') : []
  const upcomingDisplayEvents = [...registeredUpcomingEvents, ...unregisteredUpcoming]
  const availableEvents = upcomingDisplayEvents.filter((event) => !isFull(event) && !isDeadlineClosed(event))
  const registrationConflicts = selectedEvent ? registeredEvents.filter((registeredEvent) => (
    registeredEvent.eventId !== selectedEvent.eventId &&
    registeredEvent.status !== 'cancelled' &&
    !isPastEvent(registeredEvent) &&
    dateKey(registeredEvent.date) === dateKey(selectedEvent.date) &&
    registeredEvent.time === selectedEvent.time
  )) : []
  const loading = eventsLoading || registrationsLoading

  function formatEventDate(dateValue) {
    const date = new Date(dateValue)
    return Number.isNaN(date.getTime())
      ? 'Date to be announced'
      : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }

  function formatEventDateParts(dateValue) {
    const date = new Date(dateValue)
    if (Number.isNaN(date.getTime())) return { month: 'TBD', day: '—', year: '' }
    return {
      month: date.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
      day: date.toLocaleDateString(undefined, { day: '2-digit', timeZone: 'UTC' }),
      year: date.toLocaleDateString(undefined, { year: 'numeric', timeZone: 'UTC' }),
    }
  }

  function openRegistrationForm(event) {
    if (isPastEvent(event) || isCancelledEvent(event) || isDeadlineClosed(event) || isFull(event)) return
    setSelectedEvent(event)
    const participantCount = event.eventType === 'group' ? Number(event.maxTeamSize) : 1
    setRegistrationDetails(Array.from({ length: participantCount }, () => ({ name: '', email: '', phone: '', department: '', semester: '' })))
    setRegistrationTeamName('')
    setConflictAcknowledged(false)
    setRegistrationError('')
    setNotice('')
  }

  function updateParticipant(index, field, value) {
    setRegistrationDetails((current) => current.map((participant, participantIndex) => (
      participantIndex === index ? { ...participant, [field]: value } : participant
    )))
  }

  async function submitRegistration(event) {
    event.preventDefault()
    if (isPastEvent(selectedEvent) || isCancelledEvent(selectedEvent) || isDeadlineClosed(selectedEvent) || isFull(selectedEvent)) {
      setRegistrationError(isCancelledEvent(selectedEvent) ? 'This event has been cancelled.' : isPastEvent(selectedEvent) ? 'This event has ended.' : isDeadlineClosed(selectedEvent) ? 'The registration deadline has passed.' : 'This event has reached its participant limit.')
      return
    }

    const expectedParticipantCount = selectedEvent.eventType === 'group'
      ? registrationDetails.length === Number(selectedEvent.maxTeamSize)
      : registrationDetails.length === 1
    const participantDetails = registrationDetails.map((participant) => ({
      name: participant.name.trim(),
      email: participant.email.trim(),
      phone: participant.phone.trim(),
      department: participant.department.trim(),
      semester: Number(participant.semester),
    }))
    const missingDetails = !expectedParticipantCount || participantDetails.some((participant) => (
      !participant.name || !participant.email || !participant.phone || !participant.department
      || !Number.isInteger(participant.semester) || participant.semester < 1 || participant.semester > 12
    )) || (selectedEvent.eventType === 'group' && !registrationTeamName.trim())
    if (missingDetails) {
      setRegistrationError(selectedEvent.eventType === 'group'
        ? `Enter a team name and complete all five fields for exactly ${selectedEvent.maxTeamSize} participants.`
        : 'Complete all five participant fields to continue.')
      return
    }

    const conflicts = registeredEvents.filter((registeredEvent) => (
      registeredEvent.eventId !== selectedEvent.eventId &&
      registeredEvent.status !== 'cancelled' &&
      !isPastEvent(registeredEvent) &&
      dateKey(registeredEvent.date) === dateKey(selectedEvent.date) &&
      registeredEvent.time === selectedEvent.time
    ))
    if (conflicts.length > 0 && !conflictAcknowledged) {
      setRegistrationError('Confirm that you have reviewed the schedule conflict before continuing.')
      return
    }

    setActionEventId(selectedEvent.eventId)
    setRegistrationError('')
    try {
      const registrationPayload = { participants: participantDetails }
      if (selectedEvent.eventType === 'group') registrationPayload.teamName = registrationTeamName.trim()
      const result = await api.registerForEvent(token, selectedEvent.eventId, registrationPayload)
      const registeredEventName = selectedEvent.name
      setEvents((current) => current.map((item) => item.eventId === selectedEvent.eventId ? result.event : item))
      if (result.event && result.registration) {
        const registrationRecord = { ...result.event, registration: result.registration }
        setRegisteredEvents((current) => [registrationRecord, ...current.filter((item) => item.eventId !== result.event.eventId)])
      }
      setSelectedEvent(null)
      setNotice(`You have successfully registered for ${registeredEventName}.`)
      setNoticeKind('success')
      setRefreshKey((current) => current + 1)
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
      } else if (requestError instanceof ApiError && requestError.status === 409) {
        const message = requestError.message.toLowerCase()
        setRegistrationError(message.includes('already') ? 'You are already registered for this event.' : message.includes('deadline') || message.includes('closed') ? 'Registration for this event has closed.' : message.includes('full') || message.includes('participant') ? 'This event is full.' : 'Registration is no longer available for this event.')
        setNotice('')
        refreshEvents()
      } else if (requestError instanceof ApiError && requestError.status === 400) {
        setRegistrationError(requestError.message)
      } else {
        setRegistrationError(requestError instanceof ApiError && requestError.status === 404 ? 'This event is no longer available.' : 'We couldn’t submit your registration. Please try again.')
      }
    } finally {
      setActionEventId('')
    }
  }

  function cancelRegistration(event) {
    setEventToCancel(event)
  }

  async function confirmCancellation() {
    const event = eventToCancel
    if (!event) return
    setActionEventId(event.eventId)
    setEventToCancel(null)
    setNotice('')
    try {
      const result = await api.cancelEventRegistration(token, event.eventId)
      if (detailEvent?.eventId === event.eventId && result.event) setDetailEvent(result.event)
      setNotice('Your event registration has been cancelled.')
      setNoticeKind('success')
      refreshEvents()
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) {
        onSessionExpired()
      } else {
        setNotice(requestError instanceof ApiError && requestError.status === 404 ? 'This registration could not be found. Your list has been refreshed.' : 'We couldn’t cancel your registration. Please try again.')
        setNoticeKind('error')
        refreshEvents()
      }
    } finally {
      setActionEventId('')
    }
  }

  const openDetails = useCallback(async (event) => {
    setDetailEvent(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      setDetailEvent(await api.getEventDetails(token, event.eventId))
    } catch (requestError) {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setDetailError(requestError instanceof ApiError && requestError.status === 404 ? 'This event is no longer available.' : 'We couldn’t load the event details. Please try again.')
    } finally {
      setDetailLoading(false)
    }
  }, [onSessionExpired, token])

  useEffect(() => {
    if (!initialEventId || eventsLoading || handledEventId.current === initialEventId) return
    handledEventId.current = initialEventId
    api.getEventDetails(token, initialEventId).then((event) => {
      setDetailEvent(event)
    }).catch((requestError) => {
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setDetailError('This event is no longer available in the campus events list.')
    }).finally(() => {
      setDetailLoading(false)
      onEventOpened()
    })
  }, [eventsLoading, initialEventId, onEventOpened, onSessionExpired, token])

  function registrationState(event) {
    if (isCancelledEvent(event)) return { label: 'Cancelled', className: 'event-status-past' }
    const registration = registeredEventsById.get(event.eventId)?.registration
    if (registration) {
      const approvalStatus = ['Accepted', 'Rejected'].includes(registration.status) ? registration.status : 'Pending'
      return { label: approvalStatus, className: `event-status-registration-${approvalStatus.toLowerCase()}` }
    }
    if (isPastEvent(event)) return { label: 'Event ended', className: 'event-status-past' }
    if (isDeadlineClosed(event)) return { label: 'Registration Closed', className: 'event-status-full' }
    if (isFull(event)) return { label: 'Full', className: 'event-status-full' }
    return { label: 'Upcoming', className: 'event-status-upcoming' }
  }

  function renderEventCard(event) {
    const registered = registeredIds.has(event.eventId)
    const status = registrationState(event)
    const dateParts = formatEventDateParts(event.date)
    const capacity = capacityDetails(event)
    const urgency = registrationUrgency(event, capacity)
    return <article className="event-card" key={event.eventId}>
      <div className="event-card-top"><span className="event-date-block"><small>{dateParts.month}</small><strong>{dateParts.day}</strong><span>{dateParts.year}</span></span><div className="event-card-badges">{(event.category || 'Other').toLowerCase() !== 'other' && <span className="event-category-badge">{event.category}</span>}<span className="event-type-badge">{event.eventType === 'group' ? 'Group Event' : 'Individual Event'}</span>{event.eventType === 'group' && <span className="event-type-badge">Max Team Size: {event.maxTeamSize}</span>}<span className={`event-status ${status.className}`}>{status.label}</span><span className={`event-urgency-badge ${urgency.className}`}>{urgency.label}</span></div></div>
      <h2>{event.name}</h2>
      <p className="event-description">{event.description}</p>
      <div className="event-metadata"><span><i aria-hidden="true">◷</i><span>{formatEventDate(event.date)} · {event.time || 'Time to be announced'}</span></span><span><i aria-hidden="true">⌖</i><span>{event.venue || 'Venue to be announced'}</span></span><span><i aria-hidden="true">◎</i><span>{event.organizer || 'Organizer to be announced'}</span></span></div>
      <div className="event-capacity-panel">{capacity ? <><div className="event-capacity-labels"><strong>{capacity.registered} / {capacity.capacity} registered</strong><span>{capacity.seatsLeft} {capacity.seatsLeft === 1 ? 'seat' : 'seats'} left</span></div><div className="event-capacity-track" role="progressbar" aria-label="Event capacity" aria-valuemin="0" aria-valuemax={capacity.capacity} aria-valuenow={capacity.registered}><span style={{ width: `${Math.min(100, capacity.registered / capacity.capacity * 100)}%` }} /></div></> : <span className="event-capacity">Capacity information unavailable</span>}</div>
      <div className="event-card-footer"><div className="event-card-actions"><button type="button" className="events-secondary-button" onClick={() => openDetails(event)}>View details</button>{registered && !isCancelledEvent(event) ? <button type="button" className="event-action event-action-secondary" onClick={() => cancelRegistration(event)} disabled={Boolean(actionEventId)}>{actionEventId === event.eventId ? 'Updating…' : 'Cancel registration'}</button> : <button type="button" className="event-action" onClick={() => openRegistrationForm(event)} disabled={Boolean(actionEventId) || isCancelledEvent(event) || isPastEvent(event) || isDeadlineClosed(event) || isFull(event)}>{isCancelledEvent(event) ? 'Cancelled' : isPastEvent(event) ? 'Event Ended' : isDeadlineClosed(event) ? 'Registration Closed' : isFull(event) ? 'Full' : <>Register Now <span aria-hidden="true">→</span></>}</button>}</div></div>
      {registered && event.registration?.registeredAt && <p className="registration-date">Registered {formatEventDate(event.registration.registeredAt)}</p>}
    </article>
  }

  return <section className="events-page" aria-labelledby="events-title">
    <div className="events-page-heading"><div><p className="eyebrow dashboard-eyebrow">CAMPUS LIFE</p><h1 id="events-title">Campus Events</h1><p>Discover upcoming activities, workshops, competitions and events happening across the campus.</p></div><button className="events-refresh" type="button" onClick={refreshEvents} disabled={loading}>{loading ? <><span className="spinner events-spinner" /> Refreshing…</> : <>Refresh <span aria-hidden="true">↻</span></>}</button></div>
    <section className="events-summary" aria-label="Event summary">
      <article><span className="events-summary-label"><i className="summary-indicator summary-indicator-blue" />All events</span><strong>{allVisibleEvents.length}</strong></article>
      <article><span className="events-summary-label"><i className="summary-indicator summary-indicator-teal" />Upcoming</span><strong>{upcomingDisplayEvents.length}</strong></article>
      <article><span className="events-summary-label"><i className="summary-indicator summary-indicator-green" />My registrations</span><strong>{activeRegisteredVisibleEvents.length}</strong></article>
      <article><span className="events-summary-label"><i className="summary-indicator summary-indicator-amber" />Open for registration</span><strong>{availableEvents.length}</strong></article>
    </section>
    <div className="events-controls"><label className="events-search"><span aria-hidden="true">⌕</span><input aria-label="Search events" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events..." /></label><button type="button" className="events-reset" onClick={() => { setSearch(''); setCategory('All'); setView('upcoming') }} disabled={!search && category === 'All' && view === 'upcoming'}>Reset filters</button></div>
    <div className="events-toolbar"><div className="events-tabs" role="tablist" aria-label="Event list"><button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All <span>{allVisibleEvents.length}</span></button><button type="button" role="tab" aria-selected={view === 'upcoming'} className={view === 'upcoming' ? 'active' : ''} onClick={() => setView('upcoming')}>Upcoming <span>{upcomingDisplayEvents.length}</span></button><button type="button" role="tab" aria-selected={view === 'registered'} className={view === 'registered' ? 'active' : ''} onClick={() => setView('registered')}>My Registrations <span>{activeRegisteredVisibleEvents.length}</span></button><button type="button" role="tab" aria-selected={view === 'past'} className={view === 'past' ? 'active' : ''} onClick={() => setView('past')}>Past <span>{pastEvents.length}</span></button></div><span className="events-caption">{view === 'registered' ? 'Your confirmed event registrations' : view === 'upcoming' ? 'Events listed by date' : view === 'past' ? 'Previously held events' : 'All published campus events'}</span></div>
    <div className="events-categories" aria-label="Filter by category">{categories.map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {notice && <div className={`events-notice${noticeKind === 'error' ? ' events-notice-error' : ''}`} role={noticeKind === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{noticeKind === 'error' ? '!' : '✓'}</span>{notice}</div>}
    {loading && <div className="events-state"><span className="spinner spinner-blue" /><p>Loading campus events…</p></div>}
    {!loading && error && <div className="events-state events-error"><span className="events-state-icon">!</span><h2>Events are unavailable</h2><p>{error}</p><button type="button" className="events-secondary-button" onClick={refreshEvents}>Try again</button></div>}
    {!loading && !error && (view === 'upcoming' ? registeredUpcomingEvents.length + recommendedEvents.length + closingSoonEvents.length + otherUpcomingEvents.length === 0 : visibleEvents.length === 0) && <div className="events-state events-empty"><span className="events-state-icon" aria-hidden="true">✳</span><h2>{searchQuery ? 'No events match your search' : category !== 'All' ? `No ${category.toLowerCase()} events found` : view === 'registered' ? 'No event registrations yet' : view === 'past' ? 'No past events' : view === 'upcoming' ? 'No upcoming events available' : 'No events to show'}</h2><p>{view === 'registered' ? 'Explore upcoming campus events and register for activities that interest you.' : searchQuery ? 'Try another title, organizer, venue or category, or reset your filters.' : 'New campus events will appear here when they are published.'}</p>{view === 'registered' && <button type="button" className="events-secondary-button" onClick={() => setView('upcoming')}>Browse upcoming events</button>}</div>}
    {!loading && !error && view === 'upcoming' && (registeredUpcomingEvents.length + recommendedEvents.length + closingSoonEvents.length + otherUpcomingEvents.length > 0) && <div className="events-organized-list">
      {registeredUpcomingEvents.length > 0 && <section className="events-organized-section"><div className="events-section-heading"><div><p className="section-eyebrow">YOUR SCHEDULE</p><h2>My Registered Events</h2></div><span>{registeredUpcomingEvents.length} events</span></div><div className="events-grid">{registeredUpcomingEvents.map(renderEventCard)}</div></section>}
      {recommendedEvents.length > 0 && <section className="events-organized-section"><div className="events-section-heading"><div><p className="section-eyebrow">BASED ON YOUR REGISTRATIONS</p><h2>Relevant to You</h2></div><span>Matching categories from your registered events</span></div><div className="events-grid">{recommendedEvents.map(renderEventCard)}</div></section>}
      {closingSoonEvents.length > 0 && <section className="events-organized-section"><div className="events-section-heading"><div><p className="section-eyebrow">DEADLINES APPROACHING</p><h2>Closing Soon</h2></div><span>{closingSoonEvents.length} events</span></div><div className="events-grid">{closingSoonEvents.map(renderEventCard)}</div></section>}
      {otherUpcomingEvents.length > 0 && <section className="events-organized-section"><div className="events-section-heading"><div><p className="section-eyebrow">EXPLORE CAMPUS ACTIVITIES</p><h2>Upcoming</h2></div><span>{otherUpcomingEvents.length} events</span></div><div className="events-grid">{otherUpcomingEvents.map(renderEventCard)}</div></section>}
    </div>}
    {!loading && !error && view !== 'upcoming' && visibleEvents.length > 0 && <div className="events-grid">{visibleEvents.map(renderEventCard)}</div>}
    {selectedEvent && <div className="registration-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionEventId) setSelectedEvent(null) }}>
      <section className="registration-modal" role="dialog" aria-modal="true" aria-labelledby="registration-title">
        <div className="registration-modal-header"><div><p className="eyebrow dashboard-eyebrow">EVENT REGISTRATION</p><h2 id="registration-title">Enter registration details</h2><p>{selectedEvent.eventType === 'group' ? `Enter details for all ${selectedEvent.maxTeamSize} participants.` : 'Enter your details manually.'}</p></div><button type="button" className="registration-modal-close" onClick={() => setSelectedEvent(null)} disabled={Boolean(actionEventId)} aria-label="Close registration form">×</button></div>
        <div className="registration-event-summary"><strong>{selectedEvent.name}</strong><span>{selectedEvent.venue} · {formatEventDate(selectedEvent.date)} at {selectedEvent.time}</span></div>
        {registrationConflicts.length > 0 && <div className="registration-conflict-warning" role="status"><strong>Schedule conflict</strong><span>This event overlaps with another event you are registered for:</span><ul>{registrationConflicts.map((event) => <li key={event.eventId}>{event.name} · {formatEventDate(event.date)} at {event.time} · {event.venue}</li>)}</ul><label><input type="checkbox" checked={conflictAcknowledged} onChange={(event) => setConflictAcknowledged(event.target.checked)} /> I have reviewed this schedule conflict and want to continue.</label></div>}
        <form className="registration-form" onSubmit={submitRegistration}>
          {selectedEvent.eventType === 'group' && <label className="field"><span>Team Name</span><input name="teamName" value={registrationTeamName} onChange={(event) => setRegistrationTeamName(event.target.value)} autoComplete="off" maxLength={100} required /></label>}
          {registrationDetails.map((participant, index) => <fieldset className="registration-participant" key={index}><legend>{selectedEvent.eventType === 'group' ? `Participant ${index + 1}` : 'Participant details'}</legend><label className="field"><span>Name</span><input name={`participant-${index}-name`} value={participant.name} onChange={(event) => updateParticipant(index, 'name', event.target.value)} autoComplete="off" maxLength={100} required /></label><label className="field"><span>Email</span><input name={`participant-${index}-email`} type="email" value={participant.email} onChange={(event) => updateParticipant(index, 'email', event.target.value)} autoComplete="off" maxLength={254} required /></label><label className="field"><span>Phone</span><input name={`participant-${index}-phone`} type="tel" pattern="\\+?[0-9][0-9() .-]{5,29}" title="Enter a valid phone number" value={participant.phone} onChange={(event) => updateParticipant(index, 'phone', event.target.value)} autoComplete="off" maxLength={30} required /></label><label className="field"><span>Department</span><input name={`participant-${index}-department`} value={participant.department} onChange={(event) => updateParticipant(index, 'department', event.target.value)} autoComplete="off" maxLength={100} required /></label><label className="field"><span>Semester</span><select name={`participant-${index}-semester`} value={participant.semester} onChange={(event) => updateParticipant(index, 'semester', event.target.value)} required><option value="" disabled>Select semester</option>{Array.from({ length: 12 }, (_, semesterIndex) => semesterIndex + 1).map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}</select></label></fieldset>)}
          {registrationError && <div className="registration-error" role="alert">{registrationError}</div>}
          <div className="registration-form-actions"><button type="button" className="events-secondary-button" onClick={() => setSelectedEvent(null)} disabled={Boolean(actionEventId)}>Back</button><button type="submit" className="event-action" disabled={Boolean(actionEventId)}>{actionEventId === selectedEvent.eventId ? <><span className="spinner events-button-spinner" /> Submitting…</> : 'Submit Registration'}</button></div>
        </form>
      </section>
    </div>}
    {(detailLoading || detailEvent || detailError) && <div className="registration-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDetailEvent(null); setDetailError('') } }}>
      <section className="registration-modal event-details-modal" role="dialog" aria-modal="true" aria-labelledby="event-details-title">
        <div className="registration-modal-header"><div><p className="eyebrow dashboard-eyebrow">CAMPUS EVENT</p><h2 id="event-details-title">{detailEvent?.name || (detailLoading ? 'Loading event…' : 'Event details')}</h2></div><button type="button" className="registration-modal-close" onClick={() => { setDetailEvent(null); setDetailError('') }} aria-label="Close event details">×</button></div>
        {detailLoading && <div className="events-state"><span className="spinner spinner-blue" /><p>Loading event details…</p></div>}
        {detailError && <div className="registration-error" role="alert">{detailError}</div>}
        {detailEvent && <><div className="event-details-badges"><span className="event-category-badge">{detailEvent.category || 'Other'}</span><span className={`event-status ${registrationState(detailEvent).className}`}>{registrationState(detailEvent).label}</span>{registeredIds.has(detailEvent.eventId) && !isCancelledEvent(detailEvent) && !isPastEvent(detailEvent) && <span className="event-status event-status-registered">Registered</span>}</div><div className="event-details-facts"><div><small>Date</small><strong>{formatEventDate(detailEvent.date)}</strong></div><div><small>Time</small><strong>{detailEvent.time || 'To be announced'}</strong></div><div><small>Venue</small><strong>{detailEvent.venue}</strong></div><div><small>Organizer</small><strong>{detailEvent.organizer}</strong></div><div><small>Registration deadline</small><strong>{detailEvent.registrationDeadline ? formatEventDate(detailEvent.registrationDeadline) : 'Not specified'}</strong></div><div><small>Maximum capacity</small><strong>{detailEvent.maxParticipants ?? 'Not specified'}</strong></div><div><small>Available seats</small><strong>{Math.max(0, Number(detailEvent.maxParticipants || 0) - Number(detailEvent.registrationCount || 0))}</strong></div><div><small>Registration status</small><strong>{registeredIds.has(detailEvent.eventId) && !isCancelledEvent(detailEvent) ? 'You are registered' : registrationState(detailEvent).label}</strong></div></div><div className="event-details-description"><h3>About this event</h3><p>{detailEvent.description}</p></div><div className="registration-form-actions"><button type="button" className="events-secondary-button" onClick={() => { setDetailEvent(null); setDetailError('') }}>Close</button>{registeredIds.has(detailEvent.eventId) && !isCancelledEvent(detailEvent) ? <button type="button" className="event-action event-action-secondary" onClick={() => cancelRegistration(detailEvent)} disabled={Boolean(actionEventId)}>Cancel registration</button> : <button type="button" className="event-action" onClick={() => { const selected = detailEvent; setDetailEvent(null); openRegistrationForm(selected) }} disabled={isCancelledEvent(detailEvent) || isPastEvent(detailEvent) || isDeadlineClosed(detailEvent) || isFull(detailEvent)}>{isCancelledEvent(detailEvent) ? 'Event cancelled' : isPastEvent(detailEvent) ? 'Event ended' : isDeadlineClosed(detailEvent) ? 'Registration closed' : isFull(detailEvent) ? 'Event full' : registeredIds.has(detailEvent.eventId) ? 'Registered' : 'Register now'}</button>}</div></>}
      </section>
    </div>}
    {eventToCancel && <div className="registration-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventToCancel(null) }}><section className="registration-modal cancellation-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-registration-title"><div className="registration-modal-header"><div><p className="eyebrow dashboard-eyebrow">MY REGISTRATIONS</p><h2 id="cancel-registration-title">Cancel this registration?</h2><p>Your place may become available to another student.</p></div><button type="button" className="registration-modal-close" onClick={() => setEventToCancel(null)} aria-label="Close cancellation confirmation">×</button></div><div className="registration-event-summary"><strong>{eventToCancel.name}</strong><span>{formatEventDate(eventToCancel.date)} · {eventToCancel.venue}</span></div><div className="registration-form-actions"><button type="button" className="events-secondary-button" onClick={() => setEventToCancel(null)}>Keep registration</button><button type="button" className="event-action cancellation-confirm" onClick={confirmCancellation}>Confirm cancellation</button></div></section></div>}
  </section>
}

function notificationTypeLabel(type) {
  if (type === 'event_registration' || type === 'event_registration_pending' || type === 'event_update' || type === 'event_deadline_reminder') return 'Event'
  if (type?.startsWith('complaint_')) return 'Complaint'
  if (type === 'campus_announcement') return 'Announcement'
  return typeof type === 'string' && type ? type.replaceAll('_', ' ') : 'Notification'
}

function notificationCategoryClass(type) {
  if (type?.startsWith('event_')) return 'notification-category-event'
  if (type?.startsWith('complaint_')) return 'notification-category-complaint'
  return 'notification-category-general'
}

function notificationTitle(notification) {
  if (typeof notification.title === 'string' && notification.title.trim()) return notification.title.trim()
  const { type } = notification
  if (type === 'event_registration') return 'Event registration'
  if (type === 'event_update') return 'Event update'
  if (type === 'event_deadline_reminder') return 'Event deadline reminder'
  if (type === 'complaint_status_change') return 'Complaint status update'
  return notificationTypeLabel(type)
}

function notificationDateGroup(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const notificationDay = new Date(date)
  notificationDay.setHours(0, 0, 0, 0)
  if (notificationDay.getTime() === today.getTime()) return 'Today'
  if (notificationDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return 'Earlier'
}

function NotificationIcon({ type }) {
  if (type?.startsWith('event_')) return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M8 3.8v3M16 3.8v3M4 9h16M8 13h3M8 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  if (type?.startsWith('complaint_')) return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.8h7l4 4v12.4H7a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M14 4v4h4M8.5 12h7M8.5 15.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7-2.5 9h17C20.5 16 18 16 18 9ZM10 21h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function useRefreshOnFocus(refresh) {
  const lastRefresh = useRef(0)
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now()
      if (document.visibilityState === 'visible' && now - lastRefresh.current > 1500) {
        lastRefresh.current = now
        refresh()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])
}

function formatNotificationDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { relative: 'Date unavailable', absolute: '' }
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  const [unit, unitSeconds] = units.find(([, length]) => Math.abs(seconds) >= length) || ['second', 1]
  return {
    relative: new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / unitSeconds), unit),
    absolute: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function NotificationsPage({ token, onSessionExpired }) {
  const [notifications, setNotifications] = useState([])
  const [filter, setFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [expandedNotificationId, setExpandedNotificationId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState('success')
  const [actionId, setActionId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const refreshNotifications = useCallback(() => {
    setLoading(true)
    setError('')
    setRefreshKey((current) => current + 1)
  }, [])
  useRefreshOnFocus(refreshNotifications)

  useEffect(() => {
    let active = true
    api.getNotifications(token).then((items) => {
      if (active) {
        setNotifications(items)
        setHasLoaded(true)
      }
    }).catch((requestError) => {
      if (!active) return
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else setError('We couldn’t load your notifications. Please check your connection and try again.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, token])

  useEffect(() => {
    let active = true
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      api.getNotifications(token).then((items) => {
        if (!active) return
        setNotifications((current) => items.map((item) => {
          const previous = current.find((existing) => existing.notificationId === item.notificationId)
          return previous?.read ? { ...item, read: true } : item
        }))
        setHasLoaded(true)
      }).catch((requestError) => {
        if (active && requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      })
    }, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [onSessionExpired, token])

  const unreadCount = notifications.filter((item) => !item.read).length
  const readCount = notifications.length - unreadCount
  const visibleNotifications = notifications.filter((item) => {
    if (filter === 'unread' && item.read) return false
    if (filter === 'read' && !item.read) return false
    const category = item.relatedEntityType === 'event' || item.type?.startsWith('event_')
      ? 'events'
      : item.relatedEntityType === 'complaint' || item.type?.startsWith('complaint_')
        ? 'complaints'
        : 'general'
    if (categoryFilter !== 'all' && category !== categoryFilter) return false
    const query = search.trim().toLowerCase()
    return !query || [notificationTitle(item), item.message, notificationTypeLabel(item.type)].some((value) => value.toLowerCase().includes(query))
  })
  const notificationGroups = visibleNotifications.reduce((groups, notification) => {
    const group = notificationDateGroup(notification.createdDate)
    groups[group] ||= []
    groups[group].push(notification)
    return groups
  }, {})

  async function markRead(notification) {
    if (notification.read || actionId) return
    setActionId(notification.notificationId)
    setNotice('')
    setNotifications((current) => current.map((item) => item.notificationId === notification.notificationId ? { ...item, read: true } : item))
    try {
      const result = await api.markNotificationRead(token, notification.notificationId)
      if (!result.notification) throw new ApiError('The notification service returned an unexpected response.')
      setNotifications((current) => current.map((item) => item.notificationId === notification.notificationId ? result.notification : item))
      setNotice('Notification marked as read.')
      setNoticeKind('success')
    } catch (requestError) {
      setNotifications((current) => current.map((item) => item.notificationId === notification.notificationId ? notification : item))
      if (requestError instanceof ApiError && [401, 403].includes(requestError.status)) onSessionExpired()
      else {
        setNotice(requestError instanceof ApiError && requestError.status === 404 ? 'This notification is no longer available. Refresh the list to sync it.' : 'We couldn’t update this notification. Please try again.')
        setNoticeKind('error')
      }
    } finally {
      setActionId('')
    }
  }

  function openNotification(notification) {
    setExpandedNotificationId((current) => current === notification.notificationId ? '' : notification.notificationId)
    if (!notification.read) void markRead(notification)
  }

  return <section className="notifications-page" aria-labelledby="notifications-title">
    <div className="notifications-heading"><div><p className="eyebrow dashboard-eyebrow">YOUR CAMPUS INBOX</p><h1 id="notifications-title">Notifications</h1><p>Stay informed about important campus activities, events, complaints, and system updates.</p></div><div className="notifications-heading-actions">{loading ? <span className="notification-summary-chip notification-skeleton" aria-label="Loading notification summary" /> : <span className="notification-summary-chip"><strong>{hasLoaded ? notifications.length : '—'}</strong> Total <span aria-hidden="true">·</span> <strong>{hasLoaded ? unreadCount : '—'}</strong> Unread</span>}<button className="events-refresh" type="button" onClick={refreshNotifications} disabled={loading}>{loading ? <><span className="spinner events-spinner" /> Refreshing…</> : <>Refresh <span aria-hidden="true">↻</span></>}</button></div></div>
    <section className="notification-summary" aria-label="Notification summary">{loading && !hasLoaded ? <>{['Total Notifications', 'Unread', 'Read'].map((label) => <article className="notification-summary-skeleton" key={label}><span>{label}</span><i className="notification-skeleton" /></article>)}</> : <><article><span>Total Notifications</span><strong>{hasLoaded ? notifications.length : '—'}</strong></article><article><span>Unread</span><strong>{hasLoaded ? unreadCount : '—'}</strong></article><article><span>Read</span><strong>{hasLoaded ? readCount : '—'}</strong></article></>}</section>
    <div className="notification-list-heading"><div><p className="section-eyebrow">CAMPUS UPDATES</p><h2>Your Notifications</h2></div><span>{visibleNotifications.length} {visibleNotifications.length === 1 ? 'notification' : 'notifications'}</span></div>
    {loading ? <div className="notification-toolbar notification-toolbar-skeleton" aria-hidden="true"><span className="notification-skeleton notification-skeleton-tabs" /><span className="notification-skeleton notification-skeleton-search" /></div> : <div className="notification-toolbar"><div className="notification-tabs" role="tablist" aria-label="Filter notifications by read status"><button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All <span>{notifications.length}</span></button><button type="button" role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Unread <span>{unreadCount}</span></button><button type="button" role="tab" aria-selected={filter === 'read'} className={filter === 'read' ? 'active' : ''} onClick={() => setFilter('read')}>Read <span>{readCount}</span></button></div><label className="notification-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search notifications" placeholder="Search notifications..." value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>}
    {!loading && <div className="notification-category-toolbar" aria-label="Notification type filter"><span>Type</span><div className="notification-type-selector" role="tablist" aria-label="Filter notifications by type">{[['all', 'All'], ['events', 'Events'], ['complaints', 'Complaints'], ['general', 'General']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={categoryFilter === value} className={categoryFilter === value ? 'active' : ''} onClick={() => setCategoryFilter(value)}><span className="notification-type-selector-check" aria-hidden="true">✓</span><span>{label}</span></button>)}</div></div>}
    {notice && <div className={`notification-feedback${noticeKind === 'error' ? ' notification-feedback-error' : ''}`} role={noticeKind === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{noticeKind === 'error' ? '!' : '✓'}</span>{notice}</div>}
    {loading && <div className="notification-list" aria-label="Loading notifications">{[0, 1, 2].map((row) => <div className="notification-item notification-item-skeleton" key={row}><i className="notification-skeleton notification-skeleton-icon" /><div className="notification-skeleton-copy"><i className="notification-skeleton notification-skeleton-title" /><i className="notification-skeleton notification-skeleton-message" /><i className="notification-skeleton notification-skeleton-date" /></div></div>)}</div>}
    {!loading && error && <div className="notification-state notification-state-error"><span className="events-state-icon">!</span><h2>Unable to load notifications</h2><p>We couldn’t retrieve your notifications right now. Please try again.</p><button type="button" className="events-secondary-button" onClick={refreshNotifications}>Try again</button></div>}
    {!loading && !error && visibleNotifications.length === 0 && <div className="notification-state notification-empty"><span className="notification-empty-mark" aria-hidden="true">✓</span><h2>{search.trim() ? 'No matching notifications' : notifications.length === 0 ? 'No notifications yet' : categoryFilter !== 'all' ? `No ${categoryFilter} notifications` : filter === 'unread' ? 'No unread notifications' : 'No read notifications'}</h2><p>{search.trim() ? 'Try a different search term.' : notifications.length === 0 ? 'You’re all caught up. New campus updates and important alerts will appear here.' : categoryFilter !== 'all' ? `There are no ${categoryFilter} notifications matching the current filters.` : filter === 'unread' ? 'You have no unread notifications right now.' : 'Notifications you have read will appear here.'}</p>{(filter !== 'all' || categoryFilter !== 'all') && notifications.length > 0 && <button type="button" className="events-secondary-button" onClick={() => { setFilter('all'); setCategoryFilter('all') }}>View all notifications</button>}</div>}
    {!loading && !error && visibleNotifications.length > 0 && <div className="notification-groups">{Object.entries(notificationGroups).map(([group, groupNotifications]) => <section className="notification-day-group" key={group} aria-labelledby={`notifications-${group.toLowerCase()}`}><h3 id={`notifications-${group.toLowerCase()}`}>{group}</h3><div className="notification-list">{groupNotifications.map((notification) => {
      const date = formatNotificationDate(notification.createdDate)
      const isBusy = actionId === notification.notificationId
      const isExpanded = expandedNotificationId === notification.notificationId
      const title = notificationTitle(notification)
      return <article className={`notification-item ${notificationCategoryClass(notification.type)}${notification.read ? '' : ' notification-item-unread'}`} key={notification.notificationId}>
        <button type="button" className="notification-card-button" onClick={() => openNotification(notification)} disabled={Boolean(actionId)} aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} notification details${notification.read ? '' : ' and mark as read'}: ${title}`}>
          <span className={`notification-type-icon notification-type-${notification.type}`}><NotificationIcon type={notification.type} /></span>
          <span className="notification-copy">
            <span className="notification-item-heading">
              <strong>{title}</strong>
              <span className={`notification-type-label notification-label-${notification.type}`}>{notificationTypeLabel(notification.type)}</span>
              {notification.registrationStatus && <span className={`notification-registration-status notification-registration-status-${notification.registrationStatus.toLowerCase()}`}>{notification.registrationStatus}</span>}
              {!notification.read && <span className="notification-unread-dot" role="img" aria-label="Unread notification" title="Unread" />}
            </span>
            {isExpanded && (
              <span className="notification-details">
                <span className="notification-message">{notification.message}</span>
                {notification.relatedEntityType && <span className="notification-related-details">Related to {notification.relatedEntityType.replaceAll('_', ' ')}</span>}
              </span>
            )}
            <time dateTime={notification.createdDate} title={date.absolute}>{date.relative}{date.absolute && ` · ${date.absolute}`}</time>
          </span>
        </button>
        <div className="notification-card-status">
          <span className={`notification-card-badge ${notification.registrationStatus ? `notification-card-badge-${notification.registrationStatus.toLowerCase()}` : notification.read ? 'notification-card-badge-read' : 'notification-card-badge-unread'}`}>{notification.registrationStatus || (notification.read ? 'Read' : 'Unread')}</span>
        </div>
        <span className="notification-item-action" aria-hidden="true">{isBusy ? <span className="spinner events-button-spinner" /> : isExpanded ? '⌃' : '⌄'}</span>
      </article>
    })}</div></section>)}</div>}
  </section>
}

function StudentOverviewInsights({ token, onSessionExpired, onNavigate, onOpenEvent }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const currentDate = new Date(`${CURRENT_UTC_DATE}T00:00:00.000Z`)
    return { year: currentDate.getUTCFullYear(), month: currentDate.getUTCMonth() }
  })
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(CURRENT_UTC_DATE)
  const refresh = useCallback(() => { setLoading(true); setError(''); setRefreshKey((value) => value + 1) }, [])
  useRefreshOnFocus(refresh)

  useEffect(() => {
    let active = true
    Promise.allSettled([
      api.getMyComplaints(token),
      api.getEvents(token),
      api.getMyEventRegistrations(token),
      api.getNotifications(token),
    ]).then((results) => {
      if (!active) return
      const authFailure = results.find((item) => item.status === 'rejected' && item.reason instanceof ApiError && [401, 403].includes(item.reason.status))
      if (authFailure) { onSessionExpired(); return }
      setSnapshot({
        complaints: results[0].status === 'fulfilled' ? results[0].value : null,
        events: results[1].status === 'fulfilled' ? results[1].value : null,
        registrations: results[2].status === 'fulfilled' ? results[2].value : null,
        notifications: results[3].status === 'fulfilled' ? results[3].value : null,
      })
      if (results.every((result) => result.status === 'rejected')) setError('Campus information is temporarily unavailable.')
      else if (results.some((result) => result.status === 'rejected')) setError('Some campus updates are temporarily unavailable.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onSessionExpired, refreshKey, token])

  const events = snapshot?.events || EMPTY_ITEMS
  const registrations = snapshot?.registrations || EMPTY_ITEMS
  const notifications = snapshot?.notifications || EMPTY_ITEMS
  const today = CURRENT_UTC_DATE
  const datedEvents = events.filter((event) => event.status !== 'cancelled' && event.date && !Number.isNaN(new Date(event.date).getTime()))
  const liveEvents = datedEvents.filter((event) => new Date(event.date).toISOString().slice(0, 10) === today)
  const upcomingEvents = datedEvents.filter((event) => new Date(event.date).toISOString().slice(0, 10) >= today).sort((a, b) => new Date(a.date) - new Date(b.date))
  const upcomingRegistrations = registrations.filter((event) => event.status !== 'cancelled' && event.date && new Date(event.date).toISOString().slice(0, 10) >= today)
  const participationHistory = registrations.filter((event) => event.date && new Date(event.date).toISOString().slice(0, 10) < today).sort((a, b) => new Date(b.date) - new Date(a.date))
  const registeredIds = new Set(registrations.map((event) => event.eventId))
  const featuredEvent = upcomingEvents.find((event) => !registeredIds.has(event.eventId)) || upcomingEvents[0]
  const registrationUpdates = [...registrations].sort((a, b) => new Date(b.registration?.registeredAt || b.createdAt || b.date) - new Date(a.registration?.registeredAt || a.createdAt || a.date)).slice(0, 5)
  const unreadEventUpdates = notifications.filter((notification) => !notification.read && (notification.relatedEntityType === 'event' || notification.type?.startsWith('event_')))
  const registrationStatusByEventId = new Map(registrations.map((event) => [event.eventId, event.registration?.status || 'Pending']))
  const calendarEntriesByDate = datedEvents.reduce((grouped, event) => {
    const eventDateKey = new Date(event.date).toISOString().slice(0, 10)
    grouped[eventDateKey] = [...(grouped[eventDateKey] || []), {
      ...event,
      entryType: 'event',
      isRegistered: registeredIds.has(event.eventId),
      registrationStatus: registrationStatusByEventId.get(event.eventId) || 'Pending',
    }]
    if (event.registrationDeadline) {
      const deadlineDateKey = new Date(event.registrationDeadline).toISOString().slice(0, 10)
      grouped[deadlineDateKey] = [...(grouped[deadlineDateKey] || []), {
        ...event,
        entryType: 'deadline',
        isRegistered: registeredIds.has(event.eventId),
        registrationStatus: registrationStatusByEventId.get(event.eventId) || 'Pending',
      }]
    }
    return grouped
  }, {})
  const calendarMonthDate = new Date(Date.UTC(calendarMonth.year, calendarMonth.month, 1))
  const calendarDayCount = new Date(Date.UTC(calendarMonth.year, calendarMonth.month + 1, 0)).getUTCDate()
  const calendarCells = [
    ...Array.from({ length: calendarMonthDate.getUTCDay() }, () => null),
    ...Array.from({ length: calendarDayCount }, (_, index) => index + 1),
  ]
  const selectedCalendarEntries = calendarEntriesByDate[selectedCalendarDate] || []

  function shiftCalendarMonth(amount) {
    const targetMonth = new Date(Date.UTC(calendarMonth.year, calendarMonth.month + amount, 1))
    const nextDate = targetMonth.toISOString().slice(0, 10)
    setCalendarMonth({ year: targetMonth.getUTCFullYear(), month: targetMonth.getUTCMonth() })
    setSelectedCalendarDate(nextDate)
  }

  return <section className="overview-events-home" aria-label="Campus events overview">
    <div className="overview-events-heading"><div><p className="overview-section-label">CAMPUSHUB EVENTS</p><h2>Campus Activity</h2><p>Stay connected with what’s happening around campus.</p></div><button className="overview-refresh-button" type="button" onClick={refresh} disabled={loading}>{loading ? 'Updating…' : 'Refresh activity ↻'}</button></div>
    {error && <p className="overview-insights-error" role="status">{error}</p>}
    <div className="overview-activity-grid" aria-label="Campus activity summary">
      <article><span>Live Events</span><strong>{snapshot?.events ? liveEvents.length : '—'}</strong><small>Scheduled for today</small></article>
      <article><span>Upcoming Events</span><strong>{snapshot?.events ? upcomingEvents.length : '—'}</strong><small>Ready to explore</small></article>
      <article><span>My Registrations</span><strong>{snapshot?.registrations ? upcomingRegistrations.length : '—'}</strong><small>Upcoming activities</small></article>
      <article><span>Participation History</span><strong>{snapshot?.registrations ? participationHistory.length : '—'}</strong><small>Past registered events</small></article>
    </div>
    <div className="overview-events-feature-grid">
      <section className="overview-featured-event" aria-labelledby="overview-featured-title"><div className="overview-section-heading"><div><p className="overview-section-label">DON’T MISS</p><h3 id="overview-featured-title">Featured Event</h3></div><span className="overview-featured-mark" aria-hidden="true">✦</span></div>{loading && !snapshot ? <p className="overview-events-empty">Finding your next campus highlight…</p> : featuredEvent ? <button type="button" className="overview-featured-card" onClick={() => onOpenEvent(featuredEvent.eventId)}><span className="overview-featured-category">{featuredEvent.category || 'Campus event'}</span><strong>{featuredEvent.name}</strong><span>{formatCampusDate(featuredEvent.date)} · {featuredEvent.time || 'Time TBD'}</span><span>{featuredEvent.venue || 'Venue TBD'}</span><b>View event details <i aria-hidden="true">→</i></b></button> : <p className="overview-events-empty">No upcoming events are scheduled right now.</p>}</section>
      <section className="overview-registration-updates" aria-labelledby="overview-registration-updates-title"><div className="overview-section-heading"><div><p className="overview-section-label">YOUR ACTIVITY</p><h3 id="overview-registration-updates-title">Registration Updates</h3></div><button type="button" className="overview-section-link" onClick={() => onNavigate('events')}>My registrations →</button></div>{registrationUpdates.length ? <div className="overview-registration-update-list">{registrationUpdates.map((event) => { const status = event.status === 'cancelled' ? 'Cancelled' : ['Accepted', 'Rejected'].includes(event.registration?.status) ? event.registration.status : 'Pending'; return <button type="button" key={`reg-${event.eventId}`} onClick={() => onOpenEvent(event.eventId)}><span className="overview-registration-update-copy"><strong>{event.name}</strong><small>{event.registration?.registeredAt ? `Registered ${formatCampusDate(event.registration.registeredAt)}` : formatCampusDate(event.date)}</small></span><span className={`overview-registration-status overview-registration-status-${status.toLowerCase()}`}>{status}</span></button> })}</div> : <p className="overview-events-empty">No event registrations yet. Explore events to find your next activity.</p>}{unreadEventUpdates.length > 0 && <button type="button" className="overview-section-link overview-notification-link" onClick={() => onNavigate('notifications')}>{unreadEventUpdates.length} new event update{unreadEventUpdates.length === 1 ? '' : 's'} in Notifications →</button>}</section>
    </div>
    <section className="overview-upcoming-calendar" aria-labelledby="overview-calendar-title">
      <div className="overview-section-heading"><div><p className="overview-section-label">PLAN AHEAD</p><h3 id="overview-calendar-title">Upcoming Events Calendar</h3></div><button type="button" className="overview-section-link" onClick={() => onNavigate('events')}>Open Events →</button></div>
      {loading && !snapshot ? <div className="overview-events-empty">Loading your campus calendar…</div> : <>
        <div className="overview-calendar-layout">
          <div className="overview-calendar-picker">
            <div className="overview-calendar-month-heading"><strong>{calendarMonthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><div><button type="button" aria-label="Previous month" onClick={() => shiftCalendarMonth(-1)}>‹</button><button type="button" aria-label="Next month" onClick={() => shiftCalendarMonth(1)}>›</button></div></div>
            <div className="overview-calendar-grid" role="grid" aria-label="Select a calendar date">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="overview-calendar-weekday" role="columnheader" key={day}>{day}</span>)}
              {calendarCells.map((day, index) => {
                if (!day) return <span className="overview-calendar-empty-day" role="gridcell" aria-hidden="true" key={`blank-${index}`} />
                const date = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const dateEntries = calendarEntriesByDate[date] || []
                const hasEvents = dateEntries.length > 0
                const hasRegistered = dateEntries.some((entry) => entry.entryType === 'event' && entry.isRegistered)
                const hasDeadline = dateEntries.some((entry) => entry.entryType === 'deadline')
                const isSelected = date === selectedCalendarDate
                return <button type="button" role="gridcell" aria-pressed={isSelected} aria-label={`${date}${hasEvents ? `, ${dateEntries.length} entries${hasRegistered ? ', registered event' : ''}${hasDeadline ? ', last day to register' : ''}` : ', no events scheduled'}`} className={`overview-calendar-day${hasEvents ? ' has-events' : ''}${hasDeadline ? ' has-deadline' : ''}${hasRegistered ? ' has-registered' : ''}${isSelected ? ' selected' : ''}`} onClick={() => setSelectedCalendarDate(date)} key={date}><span>{day}</span>{hasEvents && <span className="overview-calendar-indicators" aria-hidden="true">{hasRegistered && <i className="overview-calendar-registered-dot" />} {hasDeadline && <i className="overview-calendar-deadline-dot" />}</span>}</button>
              })}
            </div>
            <div className="overview-calendar-legend"><span><i className="overview-calendar-registered-dot" aria-hidden="true" /> Registered event</span><span><i className="overview-calendar-deadline-dot" aria-hidden="true" /> Last Day to Register</span></div>
          </div>
          <div className="overview-selected-date-events" aria-live="polite">
            <p className="overview-section-label">{new Date(`${selectedCalendarDate}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>
            {selectedCalendarEntries.length ? <div className="overview-selected-event-list">{selectedCalendarEntries.map((entry) => {
              const isEvent = entry.entryType === 'event'
              const registrationStatusLabel = entry.registrationStatus && ['Accepted', 'Rejected', 'Pending'].includes(entry.registrationStatus) ? entry.registrationStatus : (entry.isRegistered ? 'Registered' : 'Not registered')
              const title = isEvent ? entry.name : `${entry.name} · Last Day to Register`
              return <button type="button" className="overview-selected-event" key={`selected-${entry.eventId}-${entry.entryType}`} onClick={() => onOpenEvent(entry.eventId)}>
                <strong>{title}</strong>
                {isEvent ? (entry.isRegistered ? <span className="overview-selected-badge overview-selected-badge-registered">Registered</span> : <span className="overview-selected-badge overview-selected-badge-deadline">Open</span>) : <span className="overview-selected-badge overview-selected-badge-deadline">Last Day to Register</span>}
                <span>{isEvent ? `${formatCampusDate(entry.date)} · ${entry.time || 'Time TBD'}` : `Deadline · ${formatCampusDate(entry.registrationDeadline)}`}</span>
                <span>{entry.venue || 'Venue TBD'}</span>
                <small>{isEvent ? `Event date · ${formatCampusDate(entry.date)}` : `Registration deadline · ${formatCampusDate(entry.registrationDeadline)}`}</small>
                {isEvent && <small>Registration status · {registrationStatusLabel}</small>}
                {entry.registrationDeadline && <small>Deadline · {formatCampusDate(entry.registrationDeadline)}</small>}
              </button>
            })}</div> : <p className="overview-events-empty">No events scheduled</p>}
          </div>
        </div>
      </>}
    </section>
  </section>
}
