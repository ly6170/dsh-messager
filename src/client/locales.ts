/**
 * dsh-messager 客户端字典（zh / en），注册进 DSH locale 服务
 * （ctx.locale.register('dsh-messager', { zh, en })）。
 * 键集合必须 zh/en 一致（tests/locales.spec.ts 校验）。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件字典键（typed bind / slot locale 声明）。 */
    'dsh-messager': keyof typeof zh
  }
}

export const zh = {
  nav: '通知&信使',
  'section.description': '会话交互 / 任务完成 / 出错时的通知推送：系统通知、浏览器通知、飞书机器人。',

  'group.triggers': '触发时机',
  'group.system': '系统通知',
  'group.browser': '浏览器通知',
  'group.feishu': '第三方推送',
  'group.message': '消息内容',

  'field.triggers.interaction': '需要交互时通知',
  'field.triggers.completed': '任务完成时通知',
  'field.triggers.error': '任务出错时通知',
  'field.system.enabled': '启用系统通知',
  'field.system.icon': '图标路径',
  'field.system.verbosity': '内容繁复度',
  'field.browser.enabled': '启用浏览器通知',
  'field.browser.icon': '图标 URL',
  'field.browser.onlyWhenHidden': '仅页面隐藏时通知',
  'field.browser.verbosity': '内容繁复度',
  'field.feishu.enabled': '飞书机器人',
  'field.feishu.webhookUrl': 'Webhook 地址',
  'field.feishu.secret': '签名密钥',
  'field.feishu.timeoutMs': '请求超时（毫秒）',
  'field.feishu.verbosity': '内容繁复度',
  'field.message.titlePrefix': '标题前缀',
  'field.message.includeSessionTitle': '正文包含会话标题',
  'field.message.guiUrl': '打开链接地址',

  'hint.system.icon': 'node-notifier 需要文件绝对路径',
  'hint.feishu.secret': '留空不修改；重置可清除已存密钥',
  'hint.message.titlePrefix': '如 [DSH]',

  'action.save': '保存',
  'action.saving': '保存中…',
  'action.discard': '放弃修改',
  'action.reset': '重置',
  'badge.overridden': '已覆盖',
  'status.readOnly': '设置文档当前为只读。',
  'status.saveFailed': '保存失败，请重试。',
  'status.invalidInput': '存在无效输入，请修正后再保存。',
  'status.invalidField': '无效输入（数字/选项），请修正后再保存。',
  'status.unavailable': '配置通道不可用：配置路由未就绪（host 插件未加载或 webServer 服务缺失）。',
}

export const en = {
  nav: 'Messenger',
  'section.description': 'Notifications for interaction, task completion and errors: system toast, browser notification, Feishu bot.',

  'group.triggers': 'Triggers',
  'group.system': 'System',
  'group.browser': 'Browser',
  'group.feishu': 'Third-party',
  'group.message': 'Message',

  'field.triggers.interaction': 'Notify when interaction is needed',
  'field.triggers.completed': 'Notify when a task completes',
  'field.triggers.error': 'Notify when a task errors',
  'field.system.enabled': 'Enable system notifications',
  'field.system.icon': 'Icon path',
  'field.system.verbosity': 'Verbosity',
  'field.browser.enabled': 'Enable browser notifications',
  'field.browser.icon': 'Icon URL',
  'field.browser.onlyWhenHidden': 'Notify only when the page is hidden',
  'field.browser.verbosity': 'Verbosity',
  'field.feishu.enabled': 'Feishu bot',
  'field.feishu.webhookUrl': 'Webhook URL',
  'field.feishu.secret': 'Signing secret',
  'field.feishu.timeoutMs': 'Request timeout (ms)',
  'field.feishu.verbosity': 'Verbosity',
  'field.message.titlePrefix': 'Title prefix',
  'field.message.includeSessionTitle': 'Include session title in the body',
  'field.message.guiUrl': 'Open link URL',

  'hint.system.icon': 'node-notifier requires an absolute file path',
  'hint.feishu.secret': 'Leave blank to keep the stored secret; Reset clears it',
  'hint.message.titlePrefix': 'e.g. [DSH]',

  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.discard': 'Discard',
  'action.reset': 'Reset',
  'badge.overridden': 'Overridden',
  'status.readOnly': 'The settings document is read-only.',
  'status.saveFailed': 'Save failed, please retry.',
  'status.invalidInput': 'There are invalid inputs, fix them before saving.',
  'status.invalidField': 'Invalid input (number/option), fix it before saving.',
  'status.unavailable': 'Config channel unavailable: the config route is not ready (host plugin not loaded or webServer service missing).',
}
