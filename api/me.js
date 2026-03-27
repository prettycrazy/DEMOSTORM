const { json, getUserSession, buildSetCookie, signSession } = require('./_utils')

module.exports = async (req, res) => {
  const guestEnabled = String(process.env.FEISHU_GUEST_MODE || 'false').toLowerCase()
  const guestMode = ['1', 'true', 'yes', 'on'].includes(guestEnabled)

  try {
    const { session, refreshed } = await getUserSession(req)
    if (!session) {
      if (guestMode) {
        json(res, 200, { user: null, guest: true })
        return
      }
      json(res, 401, { message: 'Unauthorized' })
      return
    }

    if (refreshed) {
      res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
    }

    json(res, 200, { user: session.user || null, guest: false })
  } catch (error) {
    json(res, 500, { message: error.message })
  }
}
