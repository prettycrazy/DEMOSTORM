const { json, getTenantAccessToken, httpRequest, getUserSession, buildSetCookie, signSession, updateBitableRecordFields } = require('./_utils')

const PROGRESS_TABLE_ID = process.env.FEISHU_PROGRESS_TABLE_ID
const PROJECTS_TABLE_ID = process.env.FEISHU_PROJECTS_TABLE_ID

async function fetchAllProgress(token) {
  if (!PROGRESS_TABLE_ID) return []
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  let pageToken = ''
  const records = []
  while (true) {
    const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${PROGRESS_TABLE_ID}/records?page_size=200&text_field_as_array=true${suffix}`
    const data = await httpRequest(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
    records.push(...(data.data?.items || []))
    if (!data.data?.has_more || !data.data?.page_token) break
    pageToken = data.data.page_token
  }
  return records.map((item) => ({
    id: item.record_id,
    created_time: item.created_time || '',
    fields: item.fields || {},
  }))
}

async function createProgress(fields, token) {
  if (!PROGRESS_TABLE_ID) throw new Error('Missing FEISHU_PROGRESS_TABLE_ID')
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${PROGRESS_TABLE_ID}/records`
  const data = await httpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  })
  if (data.code !== 0) throw new Error(data.msg || `Feishu API Error (${data.code})`)
  return {
    id: data.data?.record?.record_id || '',
    created_time: data.data?.record?.created_time || new Date().toISOString(),
    fields: data.data?.record?.fields || fields,
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const token = await getTenantAccessToken()
      const records = await fetchAllProgress(token)
      json(res, 200, { updated_at: new Date().toISOString(), records })
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
      const { session, refreshed } = await getUserSession(req)
      if (!session) {
        json(res, 401, { message: '请先授权飞书账号' })
        return
      }

      const recordId = String(payload.id || '').trim()
      const progress = Number(payload.progress)
      const currentUpdate = String(payload.current_update || '').trim()
      const nextStep = String(payload.next_step || '').trim()
      const materials = String(payload.materials || '').trim()

      if (!recordId) {
        json(res, 400, { message: '缺少 project id' })
        return
      }
      if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
        json(res, 400, { message: '进度必须是 0 到 100 之间的数字' })
        return
      }
      if (!currentUpdate || !nextStep || !materials) {
        json(res, 400, { message: '请完整填写当前进展、下一步计划和相关材料' })
        return
      }

      if (refreshed) {
        res.setHeader('Set-Cookie', buildSetCookie(signSession(refreshed, process.env.SESSION_SECRET)))
      }

      const tenantToken = await getTenantAccessToken()
      const createdAt = Date.now()

      const progressRecord = await createProgress({
        目标记录ID: recordId,
        进度: String(Math.round(progress)),
        创建时间: createdAt,
        当前进展: currentUpdate,
        下一步计划: nextStep,
        相关材料: materials,
      }, tenantToken)

      if (PROJECTS_TABLE_ID) {
        await updateBitableRecordFields(PROJECTS_TABLE_ID, recordId, {
          进度: Math.round(progress),
        }, tenantToken)
      }

      json(res, 200, { message: 'ok', progress: progressRecord })
    } catch (error) {
      json(res, error.status || 500, { message: error.message })
    }
    return
  }

  json(res, 405, { message: 'Method Not Allowed' })
}
