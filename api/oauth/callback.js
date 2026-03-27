const { exchangeCode, buildSetCookie, signSession } = require('../_utils')

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const code = url.searchParams.get('code')
    if (!code) {
      res.statusCode = 400
      res.end('Missing code')
      return
    }
    const redirectUri = process.env.FEISHU_REDIRECT_URI
    if (!redirectUri) {
      res.statusCode = 500
      res.end('Missing FEISHU_REDIRECT_URI')
      return
    }
    const auth = await exchangeCode(code, redirectUri)
    const secret = process.env.SESSION_SECRET
    const token = signSession(auth, secret)
    res.statusCode = 302
    res.setHeader('Set-Cookie', buildSetCookie(token))
    res.setHeader('Location', '/')
    res.end()
  } catch (error) {
    res.statusCode = 500
    res.end(error.message)
  }
}
