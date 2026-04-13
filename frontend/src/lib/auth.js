import api from './api';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function removeToken() {
  localStorage.removeItem('token');
}

export function isAuthenticated() {
  const token = getToken();
  if (!token) return false;
  try {
    // JWT struktur: header.payload.signature — decode payload tanpa verifikasi
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  setToken(data.token);
  return data;
}

export async function register({ name, workspaceName, email, password }) {
  const { data } = await api.post('/auth/register', { name, businessName: workspaceName, email, password });
  setToken(data.token);
  return data;
}

export async function authenticateWithGoogle({ idToken, accessToken, workspaceName, businessType }) {
  const { data } = await api.post('/auth/google', {
    idToken,
    accessToken,
    businessName: workspaceName,
    businessType,
  });
  setToken(data.token);
  return data;
}

export function logout() {
  removeToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}
