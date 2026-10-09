const AUTH_API_URL = (import.meta.env.VITE_AUTH_API_URL || 'http://localhost:5001').replace(/\/$/, '')
const STUDENT_API_URL = (import.meta.env.VITE_STUDENT_API_URL || 'http://localhost:5002').replace(/\/$/, '')
const COMPLAINT_API_URL = (import.meta.env.VITE_COMPLAINT_API_URL || 'http://localhost:5004').replace(/\/$/, '')
const EVENT_API_URL = (import.meta.env.VITE_EVENT_API_URL || 'http://localhost:5003').replace(/\/$/, '')
const NOTIFICATION_API_URL = (import.meta.env.VITE_NOTIFICATION_API_URL || 'http://localhost:5005').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(url, { token, ...options } = {}) {
  let response
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError('Unable to connect to CampusHub services. Check that the backend services are running and try again.')
  }

  let result = {}
  try {
    const parsed = await response.json()
    result = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // A non-JSON response will be reported below using a safe fallback message.
  }

  if (!response.ok) {
    const message = typeof result.message === 'string' && result.message.trim()
      ? result.message
      : 'The request could not be completed. Please try again.'
    throw new ApiError(message, response.status)
  }

  return result
}

export const api = {
  register: (details) => request(`${AUTH_API_URL}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify(details),
  }),

  login: (credentials) => request(`${AUTH_API_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify(credentials),
  }),

  adminLogin: (credentials) => request(`${AUTH_API_URL}/api/auth/admin/login`, {
    method: 'POST',
    body: JSON.stringify(credentials),
  }),

  getCurrentUser: async (token) => {
    const result = await request(`${AUTH_API_URL}/api/auth/me`, { token })
    if (!result.user || !['student', 'admin'].includes(result.user.role)) {
      throw new ApiError('The authentication service returned an unexpected user response.')
    }
    return result.user
  },

  getServiceHealth: async () => {
    const services = [
      ['auth', 'Auth Service', AUTH_API_URL],
      ['students', 'Student Service', STUDENT_API_URL],
      ['events', 'Event Service', EVENT_API_URL],
      ['complaints', 'Complaint Service', COMPLAINT_API_URL],
      ['notifications', 'Notification Service', NOTIFICATION_API_URL],
    ]
    return Promise.all(services.map(async ([id, label, baseUrl]) => {
      try {
        const result = await request(`${baseUrl}/health`)
        return { id, label, online: result.status === 'ok' }
      } catch {
        return { id, label, online: false }
      }
    }))
  },

  getStudentProfile: async (token) => {
    const result = await request(`${STUDENT_API_URL}/api/students/me`, { token })
    if (!result.student || typeof result.student !== 'object') {
      throw new ApiError('The student service returned an unexpected profile response.')
    }
    return result.student
  },

  getAdminStudents: async (token, { page = 1, limit = 25, search = '', department = '', semester = '', sort = 'name' } = {}) => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search.trim()) query.set('q', search.trim())
    if (department) query.set('department', department)
    if (semester) query.set('semester', String(semester))
    if (sort !== 'name') query.set('sort', sort)
    const result = await request(`${STUDENT_API_URL}/api/students?${query}`, { token })
    if (!Array.isArray(result.students) || !result.pagination) {
      throw new ApiError('The student service returned an unexpected response.')
    }
    return result
  },

  getAdminStudentDetails: async (token, studentId) => {
    const result = await request(`${STUDENT_API_URL}/api/students/${encodeURIComponent(studentId)}`, { token })
    if (!result.student || typeof result.student !== 'object') {
      throw new ApiError('The student service returned an unexpected profile response.')
    }
    return result.student
  },

  getStudentEventRegistrations: async (token, studentId) => {
    const result = await request(`${EVENT_API_URL}/api/events/registrations/student/${encodeURIComponent(studentId)}`, { token })
    if (!Array.isArray(result.registrations)) {
      throw new ApiError('The event service returned an unexpected registrations response.')
    }
    return result
  },

  getAllStudentIds: async (token) => {
    const firstPage = await api.getAdminStudents(token, { page: 1, limit: 100 })
    const remainingPages = await Promise.all(Array.from(
      { length: Math.max(0, Number(firstPage.pagination.pages || 1) - 1) },
      (_, index) => api.getAdminStudents(token, { page: index + 2, limit: 100 }),
    ))
    return [...firstPage.students, ...remainingPages.flatMap((page) => page.students)]
      .map((student) => student.studentId)
      .filter((studentId) => typeof studentId === 'string' && studentId.trim())
  },

  updateStudentProfile: (token, details) => request(`${STUDENT_API_URL}/api/students/me`, {
    method: 'PUT',
    token,
    body: JSON.stringify(details),
  }),

  getMyComplaints: async (token) => {
    const firstPage = await request(`${COMPLAINT_API_URL}/api/complaints/me?page=1&limit=100`, { token })
    if (!Array.isArray(firstPage.complaints)) {
      throw new ApiError('The complaint service returned an unexpected response.')
    }
    const pages = Math.max(1, Number(firstPage.pagination?.pages) || 1)
    const remaining = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
      request(`${COMPLAINT_API_URL}/api/complaints/me?page=${index + 2}&limit=100`, { token }),
    ))
    if (remaining.some((page) => !Array.isArray(page.complaints))) {
      throw new ApiError('The complaint service returned an unexpected response.')
    }
    return firstPage.complaints.concat(...remaining.map((page) => page.complaints))
  },

  getComplaintDetails: async (token, complaintId) => {
    const result = await request(`${COMPLAINT_API_URL}/api/complaints/${encodeURIComponent(complaintId)}`, { token })
    if (!result.complaint || typeof result.complaint !== 'object') {
      throw new ApiError('The complaint service returned an unexpected response.')
    }
    return result.complaint
  },

  createComplaint: (token, complaint) => request(`${COMPLAINT_API_URL}/api/complaints`, {
    method: 'POST',
    token,
    body: JSON.stringify(complaint),
  }),

  getAdminComplaints: async (token, { page = 1, limit = 25, search = '', status = '', category = '' } = {}) => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search.trim()) query.set('q', search.trim())
    if (status) query.set('status', status)
    if (category.trim()) query.set('category', category.trim())
    const result = await request(`${COMPLAINT_API_URL}/api/complaints?${query}`, { token })
    if (!Array.isArray(result.complaints) || !result.pagination) {
      throw new ApiError('The complaint service returned an unexpected response.')
    }
    return result
  },

  getAdminComplaintStats: async (token) => {
    try {
      const result = await request(`${COMPLAINT_API_URL}/api/complaints/stats`, { token })
      if (result.stats && typeof result.stats === 'object') return result.stats
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) throw error
    }

    const firstPage = await api.getAdminComplaints(token, { page: 1, limit: 100 })
    const remainingPages = await Promise.all(Array.from(
      { length: Math.max(0, Number(firstPage.pagination?.pages || 1) - 1) },
      (_, index) => api.getAdminComplaints(token, { page: index + 2, limit: 100 }),
    ))
    const complaints = [...firstPage.complaints, ...remainingPages.flatMap((page) => page.complaints)]
    const stats = { total: complaints.length, pending: 0, inProgress: 0, resolved: 0, overdue: 0 }
    const now = Date.now()

    for (const complaint of complaints) {
      if (complaint.status === 'Pending') stats.pending += 1
      if (complaint.status === 'In Progress') stats.inProgress += 1
      if (complaint.status === 'Resolved') stats.resolved += 1

      if (complaint.status === 'Pending' || complaint.status === 'In Progress') {
        const history = Array.isArray(complaint.statusHistory) ? complaint.statusHistory : []
        const currentEntry = [...history].reverse().find((entry) => entry.status === complaint.status && entry.changedAt)
        const since = currentEntry?.changedAt || (complaint.status === 'Pending' ? complaint.createdDate : null)
        if (since && !Number.isNaN(new Date(since).getTime())) {
          const elapsed = Math.max(0, now - new Date(since).getTime())
          const overdueAfter = complaint.status === 'Pending' ? 2 * 86400000 : 5 * 86400000
          if (elapsed >= overdueAfter) stats.overdue += 1
        }
      }
    }
    return stats
  },

  updateComplaintStatus: (token, complaintId, status, { resolutionNote = '' } = {}) => request(`${COMPLAINT_API_URL}/api/complaints/${encodeURIComponent(complaintId)}/status`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ status, ...(status === 'Resolved' && resolutionNote.trim() ? { resolutionNote: resolutionNote.trim() } : {}) }),
  }),

  reopenComplaint: (token, complaintId) => request(`${COMPLAINT_API_URL}/api/complaints/${encodeURIComponent(complaintId)}/reopen`, {
    method: 'PATCH',
    token,
  }),

  acknowledgeComplaintResolution: (token, complaintId) => request(`${COMPLAINT_API_URL}/api/complaints/${encodeURIComponent(complaintId)}/acknowledge-resolution`, {
    method: 'PATCH',
    token,
  }),

  submitComplaintFeedback: (token, complaintId, feedback) => request(`${COMPLAINT_API_URL}/api/complaints/${encodeURIComponent(complaintId)}/feedback`, {
    method: 'POST',
    token,
    body: JSON.stringify(feedback),
  }),

  getEvents: async (token, search = '') => {
    const query = new URLSearchParams({ page: '1', limit: '100' })
    if (search.trim()) query.set('q', search.trim())
    const firstPage = await request(`${EVENT_API_URL}/api/events?${query}`, { token })
    if (!Array.isArray(firstPage.events)) {
      throw new ApiError('The event service returned an unexpected response.')
    }

    const pageCount = Number(firstPage.pagination?.pages) || 1
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        request(`${EVENT_API_URL}/api/events?${new URLSearchParams({ page: String(index + 2), limit: '100', ...(search.trim() ? { q: search.trim() } : {}) })}`, { token }),
      ),
    )
    if (remainingPages.some((page) => !Array.isArray(page.events))) {
      throw new ApiError('The event service returned an unexpected response.')
    }

    return firstPage.events.concat(...remainingPages.map((page) => page.events))
  },

  getEventDetails: async (token, eventId) => {
    const result = await request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}`, { token })
    if (!result.event || typeof result.event !== 'object') {
      throw new ApiError('The event service returned an unexpected event response.')
    }
    return result.event
  },

  createEvent: (token, eventDetails) => request(`${EVENT_API_URL}/api/events`, {
    method: 'POST',
    token,
    body: JSON.stringify(eventDetails),
  }),

  updateEvent: (token, eventId, eventDetails) => request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(eventDetails),
  }),

  deleteEvent: (token, eventId) => request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    token,
  }),

  getEventRegistrations: async (token, eventId) => {
    const result = await request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}/registrations`, { token })
    if (!Array.isArray(result.registrations)) {
      throw new ApiError('The event service returned an unexpected registrations response.')
    }
    return result
  },

  reviewEventRegistration: (token, eventId, studentId, status) => request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(studentId)}/status`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ status }),
  }),

  getMyEventRegistrations: async (token) => {
    const result = await request(`${EVENT_API_URL}/api/events/registrations/me`, { token })
    if (!Array.isArray(result.events)) {
      throw new ApiError('The event service returned an unexpected response.')
    }
    return result.events
  },

  registerForEvent: (token, eventId, registrationDetails) => request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}/register`, {
    method: 'POST',
    token,
    body: JSON.stringify(registrationDetails),
  }),

  cancelEventRegistration: (token, eventId) => request(`${EVENT_API_URL}/api/events/${encodeURIComponent(eventId)}/register`, {
    method: 'DELETE',
    token,
  }),

  getNotifications: async (token) => {
    const firstPage = await request(`${NOTIFICATION_API_URL}/api/notifications?page=1&limit=100`, { token })
    if (!Array.isArray(firstPage.notifications)) {
      throw new ApiError('The notification service returned an unexpected response.')
    }

    const pageCount = Number(firstPage.pagination?.pages) || 1
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
        request(`${NOTIFICATION_API_URL}/api/notifications?page=${index + 2}&limit=100`, { token }),
      ),
    )
    if (remainingPages.some((page) => !Array.isArray(page.notifications))) {
      throw new ApiError('The notification service returned an unexpected response.')
    }

    return firstPage.notifications.concat(...remainingPages.map((page) => page.notifications))
  },

  markNotificationRead: (token, notificationId) => request(`${NOTIFICATION_API_URL}/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'PATCH',
    token,
  }),

  createCampusAnnouncement: async (token, { title, message }) => {
    const studentIds = await api.getAllStudentIds(token)
    if (studentIds.length === 0) {
      throw new ApiError('There are no student profiles available to receive this announcement.')
    }

    const idempotencyKey = `announcement:${crypto.randomUUID()}`
    const batches = Array.from({ length: Math.ceil(studentIds.length / 500) }, (_, index) => studentIds.slice(index * 500, (index + 1) * 500))
    const results = await Promise.all(batches.map((userIds) => request(`${NOTIFICATION_API_URL}/api/notifications/bulk`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        userIds,
        title: title.trim(),
        message: message.trim(),
        type: 'campus_announcement',
        idempotencyKey,
      }),
    })))
    return {
      recipients: results.reduce((total, result) => total + (Number(result.recipients) || 0), 0),
      created: results.reduce((total, result) => total + (Number(result.created) || 0), 0),
    }
  },
}
