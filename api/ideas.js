const { json, getTenantAccessToken, httpRequest, getUserSession, buildSetCookie, signSession } = require('./_utils')
const LIKE_FIELD_CANDIDATES = ['点赞', '点赞数', 'Likes', 'likes', 'Votes', 'votes']

async function createIdea(fields, token) {
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const tableId = process.env.FEISHU_IDEAS_TABLE_ID
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`
  const data = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return data
}

function extractLikeCount(fields = {}) {
  for (const key of [process.env.FEISHU_IDEAS_LIKES_FIELD, ...LIKE_FIELD_CANDIDATES].filter(Boolean)) {
    const value = fields[key]
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return Math.max(0, Math.round(numeric))
  }
  return 0
}

function resolveLikeFieldName(fields = {}) {
  if (process.env.FEISHU_IDEAS_LIKES_FIELD) return process.env.FEISHU_IDEAS_LIKES_FIELD
  return LIKE_FIELD_CANDIDATES.find((key) => Object.prototype.hasOwnProperty.call(fields, key)) || '点赞'
}

async function fetchIdeaRecord(recordId, token) {
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const tableId = process.env.FEISHU_IDEAS_TABLE_ID
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`
  const data = await httpRequest(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return data.data?.record || {}
}

async function updateIdeaFields(recordId, fields, token) {
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const tableId = process.env.FEISHU_IDEAS_TABLE_ID
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`
  const data = await httpRequest(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return data
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const token = await getTenantAccessToken()
      const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
      const tableId = process.env.FEISHU_IDEAS_TABLE_ID
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=200&text_field_as_array=true`
      const data = await httpRequest(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (data.code !== 0) {
        json(res, 500, { message: data.msg || 'Feishu API Error' })
        return
      }
      json(res, 200, { updated_at: new Date().toISOString(), records: (data.data?.items || []).map(item => ({ id: item.record_id, created_time: item.created_time || '', fields: item.fields })) })
    } catch (error) {
      json(res, error.status || 500, { message: error.message })
    }
    return
  }

  if (req.method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const payload = body ? JSON.parse(body) : {}
      const requestedMode = String(payload.submit_mode || '').trim().toLowerCase()
      const { session, refreshed } = await getUserSession(req)
      const guestEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.FEISHU_GUEST_MODE || 'false').toLowerCase())

      if (payload.action === 'like') {
        if (!payload.id) {
          json(res, 400, { message: '缺少 idea id' })
          return
        }

        let token = null
        if (requestedMode === 'guest') {
          if (!guestEnabled) {
            json(res, 400, { message: '当前未开启游客提交' })
            return
          }
          token = await getTenantAccessToken()
        } else if (requestedMode === 'auth') {
          if (!session) {
            json(res, 401, { message: '请先授权飞书账号' })
            return
          }
          token = session.access_token
          if (refreshed) {
            res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
          }
        } else if (session) {
          token = session.access_token
          if (refreshed) {
            res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
          }
        } else if (guestEnabled) {
          token = await getTenantAccessToken()
        } else {
          json(res, 401, { message: '需要先登录授权' })
          return
        }

        const record = await fetchIdeaRecord(String(payload.id).trim(), token)
        const likeField = resolveLikeFieldName(record.fields || {})
        const nextLikes = extractLikeCount(record.fields || {}) + 1
        await updateIdeaFields(String(payload.id).trim(), { [likeField]: nextLikes }, token)
        json(res, 200, { message: 'ok', likes: nextLikes })
        return
      }

      if (!payload.title) {
        json(res, 400, { message: 'IDEA标题必填' })
        return
      }

      const fields = {
        'IDEA标题': String(payload.title).trim(),
        '状态': 'OPEN POOL',
      }
      if (payload.tag) fields['标签'] = String(payload.tag).trim()
      if (payload.problem) fields['解决的问题（必填）'] = String(payload.problem).trim()
      if (payload.plan) fields['demo的思路（非必填）'] = String(payload.plan).trim()

      if (requestedMode === 'guest') {
        if (!guestEnabled) {
          json(res, 400, { message: '当前未开启游客提交' })
          return
        }
        const token = await getTenantAccessToken()
        await createIdea(fields, token)
        json(res, 200, { message: 'ok' })
        return
      }

      if (requestedMode === 'auth') {
        if (!session) {
          json(res, 401, { message: '请先授权飞书账号' })
          return
        }
        if (refreshed) {
          res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
        }
        await createIdea(fields, session.access_token)
        json(res, 200, { message: 'ok' })
        return
      }

      if (session) {
        if (refreshed) {
          res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
        }
        await createIdea(fields, session.access_token)
        json(res, 200, { message: 'ok' })
        return
      }

      if (!guestEnabled) {
        json(res, 401, { message: '需要先登录授权' })
        return
      }

      const token = await getTenantAccessToken()
      await createIdea(fields, token)
      json(res, 200, { message: 'ok' })
    } catch (error) {
      json(res, error.status || 500, { message: error.message })
    }
    return
  }

  json(res, 405, { message: 'Method Not Allowed' })
}
