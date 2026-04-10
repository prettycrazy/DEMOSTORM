const crypto = require('crypto')

const API_BASE = 'https://open.feishu.cn/open-apis'
const TENANT_TOKEN_URL = `${API_BASE}/auth/v3/tenant_access_token/internal`
const APP_TOKEN_URL = `${API_BASE}/auth/v3/app_access_token/internal`
const USER_TOKEN_URL = `${API_BASE}/authen/v1/access_token`
const USER_REFRESH_URL = `${API_BASE}/authen/v1/refresh_access_token`

function json(res, status, payload, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v))
  res.end(JSON.stringify(payload))
}

async function httpRequest(url, options = {}) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

async function getTenantAccessToken() {
  const payload = {
    app_id: process.env.FEISHU_APP_ID,
    app_secret: process.env.FEISHU_APP_SECRET,
  }
  const data = await httpRequest(TENANT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  if (data.code !== 0) throw new Error(`Tenant token error: ${data.msg || data.code}`)
  return data.tenant_access_token
}

async function getAppAccessToken() {
  const payload = {
    app_id: process.env.FEISHU_APP_ID,
    app_secret: process.env.FEISHU_APP_SECRET,
  }
  const data = await httpRequest(APP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  if (data.code !== 0) throw new Error(`App token error: ${data.msg || data.code}`)
  return data.app_access_token
}

async function exchangeCode(code, redirectUri) {
  const appToken = await getAppAccessToken()
  const payload = {
    grant_type: 'authorization_code',
    client_id: process.env.FEISHU_APP_ID,
    client_secret: process.env.FEISHU_APP_SECRET,
    code,
    redirect_uri: redirectUri,
  }
  const data = await httpRequest(USER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (data.code !== 0) throw new Error(`User token error: ${data.msg || data.code}`)
  const now = Math.floor(Date.now() / 1000)
  const auth = data.data || {}
  return {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at: now + (auth.expires_in || 0),
    refresh_expires_at: now + (auth.refresh_expires_in || 0),
    user: {
      name: auth.name,
      en_name: auth.en_name,
      open_id: auth.open_id,
      union_id: auth.union_id,
      email: auth.email,
    },
  }
}

async function refreshUserToken(refreshToken) {
  const appToken = await getAppAccessToken()
  const payload = {
    grant_type: 'refresh_token',
    client_id: process.env.FEISHU_APP_ID,
    client_secret: process.env.FEISHU_APP_SECRET,
    refresh_token: refreshToken,
  }
  const data = await httpRequest(USER_REFRESH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (data.code !== 0) throw new Error(`Refresh token error: ${data.msg || data.code}`)
  const now = Math.floor(Date.now() / 1000)
  const auth = data.data || {}
  return {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token || refreshToken,
    expires_at: now + (auth.expires_in || 0),
    refresh_expires_at: now + (auth.refresh_expires_in || 0),
    user: {
      name: auth.name,
      en_name: auth.en_name,
      open_id: auth.open_id,
      union_id: auth.union_id,
      email: auth.email,
    },
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return header.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=')
    if (!k) return acc
    acc[k] = decodeURIComponent(v.join('='))
    return acc
  }, {})
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64urlDecode(input) {
  const pad = input.length % 4
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function signSession(payload, secret) {
  if (!secret) throw new Error('Missing SESSION_SECRET')
  const body = base64url(JSON.stringify(payload))
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

function verifySession(token, secret) {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = base64url(crypto.createHmac('sha256', secret).update(body).digest())
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    return JSON.parse(base64urlDecode(body))
  } catch (e) {
    return null
  }
}

function buildSetCookie(value) {
  const secure = process.env.NODE_ENV === 'production'
  const parts = [
    `wb_session=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

async function getUserSession(req) {
  const secret = process.env.SESSION_SECRET
  if (!secret) return { session: null, refreshed: null }
  const cookies = parseCookies(req)
  const raw = cookies.wb_session
  const session = verifySession(raw, secret)
  if (!session) return { session: null, refreshed: null }
  const now = Math.floor(Date.now() / 1000)
  if (session.expires_at && session.expires_at - 60 > now) {
    return { session, refreshed: null }
  }
  if (!session.refresh_token) return { session: null, refreshed: null }
  const refreshed = await refreshUserToken(session.refresh_token)
  return { session: refreshed, refreshed }
}

async function updateBitableRecordFields(tableId, recordId, fields, token) {
  if (!tableId) throw new Error('Missing table id')
  if (!recordId) throw new Error('Missing record id')
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const url = `${API_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`
  const data = await httpRequest(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return data.data?.record || {}
}

module.exports = {
  API_BASE,
  json,
  httpRequest,
  getTenantAccessToken,
  exchangeCode,
  buildSetCookie,
  getUserSession,
  signSession,
  updateBitableRecordFields,
}
