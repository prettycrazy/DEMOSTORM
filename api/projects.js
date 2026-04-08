const { json, getTenantAccessToken, httpRequest } = require('./_utils')

module.exports = async (req, res) => {
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
    json(res, 200, { updated_at: new Date().toISOString(), records: (data.data?.items || []).map(item => ({ id: item.record_id, created_time: item.created_time || '', fields: item.fields })) })
  } catch (error) {
    json(res, error.status || 500, { message: error.message })
  }
}
