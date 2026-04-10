const { json, API_BASE } = require('./_utils')

module.exports = async (req, res) => {
  const redirectUri = process.env.FEISHU_REDIRECT_URI
  if (!redirectUri) {
    json(res, 500, { message: 'Missing FEISHU_REDIRECT_URI' })
    return
  }
  const scope = process.env.FEISHU_OAUTH_SCOPE || 'auth:user.id:read bitable:app base:record:create base:record:read base:record:update'
  const params = new URLSearchParams({
    app_id: process.env.FEISHU_APP_ID || '',
    redirect_uri: redirectUri,
    scope,
    state: 'workboard',
  })
  const authUrl = `${API_BASE}/authen/v1/index?${params.toString()}`
  json(res, 200, { auth_url: authUrl })
}
