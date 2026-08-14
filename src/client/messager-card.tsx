/**
 * 设置页卡片组件：渲染在 DSH 设置 → Plugins 标签页。
 *
 * 外观与 DSH 内置卡片（终端/Agent循环/网页搜索）一致：
 * - 折叠卡片外壳（点击标题展开，未保存时标题带“未保存”徽标 + 旋转箭头）；
 * - 字段行沿用 ValueField 布局（标签 + 已覆盖徽标 + 重置 + 控件 + 提示）；
 * - 底部操作栏右对齐（放弃修改 / 保存），全部使用 DSH 主题变量
 *   （--dsw-alias-*，由 Web shell 注入，内联样式可直接引用）。
 */

import { useState } from 'react'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { CARD_FIELDS, isFieldGated } from './card-controller.js'
import type { CardFieldSpec, MessagerCardActions, MessagerCardFace, MessagerCardState } from './card-controller.js'

export type MessagerCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<MessagerCardFace>

const GROUP_TITLES: Record<string, string> = {
  triggers: '触发时机',
  system: '系统通知',
  browser: '浏览器通知',
  feishu: '第三方推送',
  message: '消息内容',
}

// ---- DSH 主题变量（PluginCard.module.css / fields.module.css 同源） ----

const CARD_STYLE: React.CSSProperties = {
  listStyle: 'none',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
}

const CARD_OPEN_STYLE: React.CSSProperties = {
  ...CARD_STYLE,
  background: 'var(--dsw-alias-bg-layer-2)',
  borderColor: 'var(--dsw-alias-label-dimmed)',
}

const HEADER_STYLE: React.CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
}

const HEAD_TEXT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const NAME_STYLE: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-primary)',
}

const DESCRIPTION_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const PENDING_STYLE: React.CSSProperties = {
  flex: 'none',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  lineHeight: '17px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
}

const CHEVRON_STYLE: React.CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
  transition: 'transform .16s',
}

const BODY_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  paddingBottom: 8,
}

const GROUP_HEADING_STYLE: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const READ_ONLY_STYLE: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const FOOTER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 0 4px',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  marginTop: 12,
}

const FAILED_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-error)',
}

const BUTTON_BASE: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '5px 14px',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  cursor: 'pointer',
}

const DISCARD_STYLE: React.CSSProperties = {
  ...BUTTON_BASE,
  borderColor: 'var(--dsw-alias-border-l2)',
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
}

const SAVE_STYLE: React.CSSProperties = {
  ...BUTTON_BASE,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}

// ---- 字段行（ValueField 同款布局） ----

const FIELD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '12px 0',
}

const FIELD_HEAD_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const FIELD_LABEL_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
}

const BADGE_STYLE: React.CSSProperties = {
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  lineHeight: '17px',
  whiteSpace: 'nowrap',
  fontWeight: 500,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
}

const RESET_STYLE: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
}

const INPUT_STYLE: React.CSSProperties = {
  height: 34,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-primary)',
}

const HINT_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const INVALID_STYLE: React.CSSProperties = {
  ...HINT_STYLE,
  color: 'var(--dsw-alias-label-error)',
}

/** 渲染一个字段行（DSH ValueField 同款；toggle 标签与勾选框同一行）。 */
function FieldRow({ spec, state, actions, disabled }: {
  spec: CardFieldSpec
  state: MessagerCardState['fields'][string]
  actions: MessagerCardActions
  disabled: boolean
}) {
  const id = `dsh-messager-${spec.group}-${spec.field}`
  const overriddenBadge = state.overridden && (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={BADGE_STYLE}>已覆盖</span>
      <button type="button" style={RESET_STYLE} disabled={disabled} onClick={() => actions.reset(spec.group, spec.field)}>
        重置
      </button>
    </span>
  )

  if (spec.kind === 'toggle') {
    // 勾选框与描述同一行：标签占满左侧，徽标/重置与勾选框靠右
    return (
      <div style={{ ...FIELD_STYLE, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 34 }}>
        <label style={{ ...FIELD_LABEL_STYLE, flex: '1 1 auto', cursor: disabled ? 'default' : 'pointer' }} htmlFor={id}>
          {spec.label}
        </label>
        {overriddenBadge}
        <input
          id={id}
          type="checkbox"
          checked={state.text === 'true'}
          disabled={disabled}
          onChange={(event) => actions.edit(spec.group, spec.field, String(event.target.checked))}
          style={{ flex: 'none', accentColor: 'var(--dsw-alias-brand-primary)' }}
        />
        {spec.hint !== undefined && <p style={{ ...HINT_STYLE, flexBasis: '100%' }}>{spec.hint}</p>}
      </div>
    )
  }

  let control: React.ReactNode
  if (spec.kind === 'select') {
    control = (
      <select
        id={id}
        value={state.text}
        disabled={disabled}
        onChange={(event) => actions.edit(spec.group, spec.field, event.target.value)}
        style={{ ...INPUT_STYLE, cursor: 'pointer' }}
      >
        {spec.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  } else {
    control = (
      <input
        id={id}
        type="text"
        inputMode={spec.kind === 'number' ? 'numeric' : undefined}
        value={state.text}
        placeholder={spec.secret === true ? '留空不修改' : undefined}
        disabled={disabled}
        aria-invalid={state.invalid}
        onChange={(event) => actions.edit(spec.group, spec.field, event.target.value)}
        style={state.invalid ? { ...INPUT_STYLE, borderColor: 'var(--dsw-alias-label-error)' } : INPUT_STYLE}
      />
    )
  }
  return (
    <div style={FIELD_STYLE}>
      <div style={FIELD_HEAD_STYLE}>
        <label style={FIELD_LABEL_STYLE} htmlFor={id}>{spec.label}</label>
        {overriddenBadge}
      </div>
      {control}
      <p style={state.invalid ? INVALID_STYLE : HINT_STYLE}>
        {state.invalid ? '无效输入（数字/选项），请修正后再保存。' : spec.hint ?? ''}
      </p>
    </div>
  )
}

/**
 * dsh-messager 设置卡片（DSH Plugins 页统一折叠卡片样式）。
 * @param props - 运行时槽位 props + 注入面（useMessagerCard + 动作）。
 */
export function MessagerCard(props: MessagerCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useMessagerCard(snapshot => snapshot)
  const { edit, reset, save, discard } = props

  if (!state.available) {
    const hint = state.mode === 'memory'
      ? '当前通过非 loopback 地址访问，设置读写仅限本机回环；请用 http://127.0.0.1:3080 打开。'
      : state.status === 'loading'
        ? '命名空间已注册但客户端解码未完成（刷新页面重试）。'
        : 'host 插件已加载但命名空间未暴露给 Web 端 —— 源码运行 DSH 时请确认 apiproxy 的 WEB_SETTINGS_NAMESPACES 已包含 "messager"（见 README）。'
    return (
      <li style={CARD_STYLE}>
        <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>{hint}</div>
      </li>
    )
  }

  const groups = [...new Set(Object.keys(state.fields).map(key => key.split('.')[0]!))]
  const actionsDisabled = !state.writable || state.saving
  const blocked = !state.dirty || state.invalid || state.saving

  return (
    <li style={open ? CARD_OPEN_STYLE : CARD_STYLE}>
      <button
        type="button"
        style={HEADER_STYLE}
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: dsh-messager 通知`}
        onClick={() => { setOpen(!open) }}
      >
        <span style={HEAD_TEXT_STYLE}>
          <span style={NAME_STYLE}>dsh-messager 通知</span>
          <span style={DESCRIPTION_STYLE}>会话交互 / 任务完成 / 出错时的通知推送</span>
        </span>
        {state.dirty && <span style={PENDING_STYLE}>未保存</span>}
        <span style={{ display: 'inline-flex', ...CHEVRON_STYLE, ...(open ? { transform: 'rotate(180deg)' } : {}) }}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && (
        <div style={BODY_STYLE}>
          {!state.writable && <p style={READ_ONLY_STYLE} role="status">设置文档当前为只读。</p>}
          {groups.map(group => (
            <div key={group}>
              <p style={GROUP_HEADING_STYLE}>{GROUP_TITLES[group] ?? group}</p>
              {Object.entries(state.fields)
                .filter(([key]) => key.startsWith(`${group}.`))
                .map(([key, field]) => {
                  const fieldName = key.slice(key.indexOf('.') + 1)
                  const spec = CARD_FIELD_LOOKUP[key]
                  if (spec === undefined) return null
                  if (isFieldGated(spec, state.fields)) return null // 门控关闭：不渲染子配置
                  return (
                    <FieldRow
                      key={key}
                      spec={spec}
                      state={field}
                      actions={{ edit, reset, save, discard }}
                      disabled={actionsDisabled}
                    />
                  )
                })}
            </div>
          ))}
          <div style={FOOTER_STYLE}>
            {state.failed && <p style={FAILED_STYLE} role="status">保存失败，请重试。</p>}
            {state.invalid && !state.failed && <p style={FAILED_STYLE} role="status">存在无效输入，请修正后再保存。</p>}
            <button
              type="button"
              style={{ ...DISCARD_STYLE, ...((!state.dirty && !state.failed) || state.saving ? { opacity: 0.4, cursor: 'default' } : {}) }}
              disabled={!state.dirty || state.saving}
              onClick={discard}
            >
              放弃修改
            </button>
            <button
              type="button"
              style={{ ...SAVE_STYLE, ...(blocked ? { opacity: 0.4, cursor: 'default' } : {}) }}
              disabled={blocked}
              onClick={save}
            >
              {state.saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** key → spec 查找表（渲染时用）。 */
const CARD_FIELD_LOOKUP: Record<string, CardFieldSpec> = Object.fromEntries(
  CARD_FIELDS.map(spec => [`${spec.group}.${spec.field}`, spec]),
)
