const { json, getTenantAccessToken, httpRequest, getUserSession, buildSetCookie, signSession } = require('./_utils')

const PROJECT_UPDATE_FIELDS = {
  progress: '进度',
  currentUpdate: '当前进展',
  nextStep: '下一步计划',
  materials: '相关材料',
}

async function updateProjectFields(recordId, fields, token) {
  const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
  const tableId = process.env.FEISHU_PROJECTS_TABLE_ID
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
  return data.data?.record || {}
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const token = await getTenantAccessToken()
      const appToken = process.env.FEISHU_BITABLE_APP_TOKEN
      const tableId = process.env.FEISHU_PROJECTS_TABLE_ID
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=200&text_field_as_array=true`
      const data = await httpRequest(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (data.code !== 0) {
        json(res, 500, { message: data.msg || 'Feishu API Error' })
        return
      }
      json(res, 200, {
        updated_at: new Date().toISOString(),
        records: (data.data?.items || []).map((item) => ({
          id: item.record_id,
          created_time: item.created_time || '',
          fields: item.fields,
        })),
      })
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

      if (payload.action !== 'update_progress') {
        json(res, 400, { message: 'Unsupported project action' })
        return
      }
      if (!session?.access_token) {
        json(res, 401, { message: '请先授权飞书账号' })
        return
      }

      const recordId = String(payload.id || '').trim()
      const progress = Number(payload.progress)
      const normalizedProgress = Number((progress / 100).toFixed(4))
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

      const record = await updateProjectFields(recordId, {
        [PROJECT_UPDATE_FIELDS.progress]: normalizedProgress,
        [PROJECT_UPDATE_FIELDS.currentUpdate]: currentUpdate,
        [PROJECT_UPDATE_FIELDS.nextStep]: nextStep,
        [PROJECT_UPDATE_FIELDS.materials]: materials,
      }, session.access_token)

      json(res, 200, { message: 'ok', record })
    } catch (error) {
      json(res, error.status || 500, { message: error.message })
    }
    return
  }

  json(res, 405, { message: 'Method Not Allowed' })
}
