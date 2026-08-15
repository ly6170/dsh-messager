/**
 * 设置页分区组件：渲染在 设置 → 「通知&信使」分区（Agent预设下方，动态 order）。
 *
 * 数据走 webServer 配置路由（见 src/config-route.ts / fetch-scope.ts），
 * 不受 Web 设置白名单门控 —— 发行版（未打补丁）同样可读写。
 * 表单体复用 MessagerSettingsForm；文案经 face 平铺的 t() 取当前语言。
 */

import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MessagerCardFace } from './card-controller.js'
import { MessagerSettingsForm } from './settings-form.jsx'

export type MessagerSectionProps = PropsRuntime<'settings.section'> & InjectFace<MessagerCardFace>

const SECTION_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 640,
}

const TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-primary)',
}

const DESCRIPTION_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--dsw-alias-label-tertiary)',
}

const UNAVAILABLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * dsh-messager 设置分区（设置页「通知&信使」）。
 * @param props - 槽位 owner props + 注入面（useMessagerCard + 动作 + t）。
 */
export function MessagerSection(props: MessagerSectionProps) {
  const state = props.useMessagerCard(snapshot => snapshot)
  const { edit, reset, save, discard, t } = props

  return (
    <div style={SECTION_STYLE}>
      <div>
        <h2 style={TITLE_STYLE}>{t('nav')}</h2>
        <p style={DESCRIPTION_STYLE}>{t('section.description')}</p>
      </div>
      {state.available
        ? <MessagerSettingsForm state={state} actions={{ edit, reset, save, discard }} t={t} />
        : <p style={UNAVAILABLE_STYLE} role="status">{t('status.unavailable')}</p>}
    </div>
  )
}
