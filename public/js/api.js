const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

const api = {
  async request(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers
    };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      
      // Handle 401 - token expired/invalid → logout
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
          window.location.href = '/index.html';
        }
        throw new Error('Session expired. Please login again.');
      }

      // Handle 403 - access denied (don't logout, just show error)
      if (response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Access denied');
      }

      // Handle network errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      // Handle network connectivity issues
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your internet connection.');
      }
      throw error;
    }
  },

  auth: {
    login: (credentials) => api.request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
    register: (userData) => api.request('/auth/register', { method: 'POST', body: JSON.stringify(userData) }),
    getProfile: () => api.request('/auth/profile')
  },

  exams: {
    getAll: () => api.request('/exams'),
    getDetails: (id) => api.request(`/exams/${id}`),
    getAttempts: (id) => api.request(`/exams/${id}/attempts`),
    getActivity: (id, limit = 100) => api.request(`/exams/${id}/activity?limit=${limit}`),
    getHeatmap: (id) => api.request(`/exams/${id}/heatmap`),
    create: (examData) => api.request('/exams', { method: 'POST', body: JSON.stringify(examData) }),
    updateStatus: (id, status) => api.request(`/exams/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
  },

  attempts: {
    start: (examId) => api.request('/attempts/start', { method: 'POST', body: JSON.stringify({ examId }) }),
    updateAnswers: (id, data) => api.request(`/attempts/${id}/answers`, { method: 'PUT', body: JSON.stringify(data) }),
    updateTimer: (id, timeRemaining) => api.request(`/attempts/${id}/timer`, { method: 'PUT', body: JSON.stringify({ time_remaining: timeRemaining }) }),
    updateStatus: (id, data) => api.request(`/attempts/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),
    logActivity: (id, activity) => api.request(`/attempts/${id}/activity`, { method: 'POST', body: JSON.stringify(activity) }),
    getActivity: (id) => api.request(`/attempts/${id}/activity`),
    startRecording: (id, data) => api.request(`/attempts/${id}/recordings/start`, { method: 'POST', body: JSON.stringify(data) }),
    uploadRecordingChunk: (id, data) => api.request(`/attempts/${id}/recordings/chunk`, { method: 'POST', body: JSON.stringify(data) }),
    stopRecording: (id, data) => api.request(`/attempts/${id}/recordings/stop`, { method: 'POST', body: JSON.stringify(data) }),
    getRecordings: (id) => api.request(`/attempts/${id}/recordings`),
    submit: (id, data) => api.request(`/attempts/${id}/submit`, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
    getStatus: (id) => api.request(`/attempts/${id}/status`)
  },

  questionBank: {
    getAll: () => api.request('/question-bank'),
    create: (data) => api.request('/question-bank', { method: 'POST', body: JSON.stringify(data) }),
    bulkImport: (questions) => api.request('/question-bank/bulk-import', { method: 'POST', body: JSON.stringify({ questions }) }),
    update: (id, data) => api.request(`/question-bank/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => api.request(`/question-bank/${id}`, { method: 'DELETE' })
  },

  ai: {
    getReport: (attemptId) => api.request(`/ai/report/${attemptId}`),
    saveReport: (attemptId, reportData) => api.request(`/ai/report/${attemptId}`, { method: 'POST', body: JSON.stringify(reportData) }),
    getStudyPlan: (attemptId) => api.request(`/ai/study-plan/${attemptId}`)
  },

  messages: {
    get: (examId) => api.request(`/messages/${examId}`),
    send: (data) => api.request('/messages', { method: 'POST', body: JSON.stringify(data) })
  },

  doubts: {
    submit: (data) => api.request('/doubts', { method: 'POST', body: JSON.stringify(data) }),
    get: (examId) => api.request(`/doubts/exam/${examId}`),
    resolve: (id, data) => api.request(`/doubts/${id}/resolve`, { method: 'PUT', body: JSON.stringify(data) })
  },

  riskProfiles: {
    getAll: () => api.request('/risk-profiles'),
    getHistory: (studentId) => api.request(`/risk-profiles/${studentId}/history`),
    updateNotes: (id, notes) => api.request(`/risk-profiles/${id}/notes`, { method: 'PUT', body: JSON.stringify({ faculty_notes: notes }) })
  }
};

window.api = api;
