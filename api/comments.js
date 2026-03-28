const { json, getTenantAccessToken, httpRequest, getUserSession, buildSetCookie, signSession } = require('./_utils')

const COMMENT_TABLE_ID = process.env.FEISHU_COMMENTS_TABLE_ID || 'tblc9a0rQHutXXHu'
const APP_TOKEN = () => process.env.FEISHU_BITABLE_APP_TOKEN

const FIELD_ALIASES = {
  content: ['评论内容', '内容', 'Comment', '评论'],
  targetType: ['目标类型', 'Target Type', 'type'],
  targetRecordId: ['目标记录ID', '目标记录Id', 'Target Record ID', 'record_id'],
  parentId: ['父评论ID', 'Parent Comment ID', 'parent_id'],
  likes: ['点赞数', '点赞', 'Likes', 'likes'],
  status: ['状态', 'Status', 'status'],
  creator: ['创建人', '作者名和OpenID'],
  createdAt: ['创建时间', 'Created Time', 'created_at'],
}

function pickField(fields = {}, aliases = []) {
  for (const key of aliases) {
    if (fields[key] !== undefined && fields[key] !== null) return fields[key]
  }
  return ''
}

function extractPersonName(value) {
  if (Array.isArray(value) && value.length) {
    const person = value[0] || {}
    return person.name || person.en_name || person.id || 'Unknown'
  }
  if (value && typeof value === 'object') {
    return value.name || value.en_name || value.id || 'Unknown'
  }
  if (typeof value === 'string' && value.trim()) return value.trim()
  return 'Unknown'
}

function normalizeLikes(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(0, Math.round(numeric))
  return 0
}

function normalizeComment(record) {
  const fields = record.fields || {}
  return {
    id: record.record_id || record.id,
    content: String(pickField(fields, FIELD_ALIASES.content) || '').trim(),
    target_type: String(pickField(fields, FIELD_ALIASES.targetType) || '').trim().toLowerCase(),
    target_record_id: String(pickField(fields, FIELD_ALIASES.targetRecordId) || '').trim(),
    parent_id: String(pickField(fields, FIELD_ALIASES.parentId) || '').trim(),
    likes: normalizeLikes(pickField(fields, FIELD_ALIASES.likes)),
    status: String(pickField(fields, FIELD_ALIASES.status) || 'active').trim().toLowerCase(),
    author_name: extractPersonName(pickField(fields, FIELD_ALIASES.creator)),
    created_at: pickField(fields, FIELD_ALIASES.createdAt) || '',
  }
}

async function fetchAllComments(token) {
  const appToken = APP_TOKEN()
  let pageToken = ''
  const records = []
  while (true) {
    const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${COMMENT_TABLE_ID}/records?page_size=200${suffix}`
    const data = await httpRequest(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
    const items = data.data?.items || []
    records.push(...items)
    if (!data.data?.has_more || !data.data?.page_token) break
    pageToken = data.data.page_token
  }
  return records.map(normalizeComment).filter((item) => item.status !== 'deleted')
}

async function fetchCommentRecord(recordId, token) {
  const appToken = APP_TOKEN()
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${COMMENT_TABLE_ID}/records/${recordId}`
  const data = await httpRequest(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return data.data?.record || {}
}

async function updateCommentFields(recordId, fields, token) {
  const appToken = APP_TOKEN()
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${COMMENT_TABLE_ID}/records/${recordId}`
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

async function createComment(fields, token) {
  const appToken = APP_TOKEN()
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${COMMENT_TABLE_ID}/records`
  const data = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return normalizeComment({ record_id: data.data?.record?.record_id, fields: data.data?.record?.fields || fields })
}

function resolveLikeFieldName(fields = {}) {
  return FIELD_ALIASES.likes.find((key) => Object.prototype.hasOwnProperty.call(fields, key)) || '点赞数'
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const token = await getTenantAccessToken()
      const url = new URL(req.url, 'http://localhost')
      const targetType = String(url.searchParams.get('target_type') || '').trim().toLowerCase()
      const targetRecordId = String(url.searchParams.get('target_record_id') || '').trim()
      const summaryOnly = ['1', 'true', 'yes'].includes(String(url.searchParams.get('summary') || '').toLowerCase())
      const comments = await fetchAllComments(token)

      if (summaryOnly) {
        const summary = {}
        comments.forEach((comment) => {
          if (!comment.target_type || !comment.target_record_id || comment.status === 'hidden') return
          const key = `${comment.target_type}:${comment.target_record_id}`
          summary[key] = (summary[key] || 0) + 1
        })
        json(res, 200, { updated_at: new Date().toISOString(), summary })
        return
      }

      const filtered = comments
        .filter((comment) => {
          if (comment.status === 'hidden') return false
          if (targetType && comment.target_type !== targetType) return false
          if (targetRecordId && comment.target_record_id !== targetRecordId) return false
          return true
        })
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

      json(res, 200, { updated_at: new Date().toISOString(), comments: filtered })
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

      const withAuthHeaders = {}
      let sessionToken = session?.access_token || null
      if (refreshed) {
        sessionToken = refreshed.access_token
        withAuthHeaders['Set-Cookie'] = buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET))
      }

      const resolveToken = async () => {
        if (requestedMode === 'guest') {
          if (!guestEnabled) {
            const err = new Error('当前未开启游客提交')
            err.status = 400
            throw err
          }
          return await getTenantAccessToken()
        }
        if (requestedMode === 'auth') {
          if (!sessionToken) {
            const err = new Error('请先授权飞书账号')
            err.status = 401
            throw err
          }
          return sessionToken
        }
        if (sessionToken) return sessionToken
        if (guestEnabled) return await getTenantAccessToken()
        const err = new Error('需要先登录授权')
        err.status = 401
        throw err
      }

      const token = await resolveToken()

      if (payload.action === 'like') {
        const recordId = String(payload.id || '').trim()
        if (!recordId) {
          json(res, 400, { message: '缺少 comment id' })
          return
        }
        const record = await fetchCommentRecord(recordId, token)
        const likeField = resolveLikeFieldName(record.fields || {})
        const nextLikes = normalizeLikes(record.fields?.[likeField]) + 1
        await updateCommentFields(recordId, { [likeField]: nextLikes }, token)
        json(res, 200, { message: 'ok', likes: nextLikes }, withAuthHeaders)
        return
      }

      const content = String(payload.content || '').trim()
      const targetType = String(payload.target_type || '').trim().toLowerCase()
      const targetRecordId = String(payload.target_record_id || '').trim()
      const parentId = String(payload.parent_id || '').trim()

      if (!content) {
        json(res, 400, { message: '评论内容不能为空' })
        return
      }
      if (!['project', 'idea'].includes(targetType) || !targetRecordId) {
        json(res, 400, { message: '目标记录参数无效' })
        return
      }

      const fields = {
        评论内容: content,
        目标类型: targetType,
        目标记录ID: targetRecordId,
        点赞数: 0,
        状态: 'active',
      }
      if (parentId) fields.父评论ID = parentId

      const comment = await createComment(fields, token)
      json(res, 200, { message: 'ok', comment }, withAuthHeaders)
    } catch (error) {
      json(res, error.status || 500, { message: error.message })
    }
    return
  }

  json(res, 405, { message: 'Method Not Allowed' })
}
