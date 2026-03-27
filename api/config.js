const { json } = require('./_utils')

module.exports = async (req, res) => {
  const guestEnabled = String(process.env.FEISHU_GUEST_MODE || 'false').toLowerCase()
  const guestMode = ['1', 'true', 'yes', 'on'].includes(guestEnabled)
  json(res, 200, {
    guest_mode: guestMode,
    guest_editable: false,
    projects_table_url: process.env.FEISHU_PROJECTS_TABLE_URL || 'https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblvIoMdw5nslGsy&view=vewRk0ObQk',
    ideas_table_url: process.env.FEISHU_IDEAS_TABLE_URL || 'https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblPk1wR2xYSztdL&view=vewCeUkPfz'
  })
}
