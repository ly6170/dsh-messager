/**
 * dsh-messager 设置表单体（设置页分区共用）。
 *
 * 渲染全部字段分组（FieldRow）+ 底部操作栏（放弃修改 / 保存），
 * 样式沿用 DSH 主题变量（--dsw-alias-*），与 ValueField 布局同源。
 * 文案经 t() 取当前语言（字典见 locales.ts）；字段 label/hint 为翻译键。
 */

import type { ReactNode } from 'react'
import { CARD_FIELDS, isFieldGated } from './card-controller.js'
import type { CardFieldSpec, MessagerCardActions, MessagerCardState } from './card-controller.js'

/** 分组标题的翻译键（键见 locales.ts；导出供字典一致性测试）。 */
export const GROUP_TITLE_KEYS: Record<string, string> = {
  triggers: 'group.triggers',
  system: 'group.system',
  browser: 'group.browser',
  feishu: 'group.feishu',
  message: 'group.message',
}

// ---- DSH 主题变量（fields.module.css 同源） ----

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

/** 渲染一个字段行（DSH ValueField 同款；toggle 标签与勾选框同一行）。 */
function FieldRow({ spec, state, actions, t, disabled }: {
  spec: CardFieldSpec
  state: MessagerCardState['fields'][string]
  actions: MessagerCardActions
  t: (key: string) => string
  disabled: boolean
}) {
  const id = `dsh-messager-${spec.group}-${spec.field}`
  const label = t(spec.label)
  const overriddenBadge = state.overridden && (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={BADGE_STYLE}>{t('badge.overridden')}</span>
      <button type="button" style={RESET_STYLE} disabled={disabled} onClick={() => actions.reset(spec.group, spec.field)}>
        {t('action.reset')}
      </button>
    </span>
  )

  if (spec.kind === 'toggle') {
    // 勾选框与描述同一行：标签占满左侧，徽标/重置与勾选框靠右
    return (
      <div style={{ ...FIELD_STYLE, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 34 }}>
        <label style={{ ...FIELD_LABEL_STYLE, flex: '1 1 auto', cursor: disabled ? 'default' : 'pointer' }} htmlFor={id}>
          {label}
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
        {spec.hint !== undefined && <p style={{ ...HINT_STYLE, flexBasis: '100%' }}>{t(spec.hint)}</p>}
      </div>
    )
  }

  let control: ReactNode
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
        placeholder={spec.secret === true ? t('hint.feishu.secret') : undefined}
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
        <label style={FIELD_LABEL_STYLE} htmlFor={id}>{label}</label>
        {overriddenBadge}
      </div>
      {control}
      <p style={state.invalid ? INVALID_STYLE : HINT_STYLE}>
        {state.invalid ? t('status.invalidField') : spec.hint === undefined ? '' : t(spec.hint)}
      </p>
    </div>
  )
}

/** key → spec 查找表（渲染时用）。 */
const FIELD_LOOKUP: Record<string, CardFieldSpec> = Object.fromEntries(
  CARD_FIELDS.map(spec => [`${spec.group}.${spec.field}`, spec]),
)

/**
 * 设置表单体：全部字段分组 + 底部操作栏。
 * @param state - 控制器快照（useMessagerCard 的返回）。
 * @param actions - 控制器动作（edit/reset/save/discard）。
 * @param t - 翻译函数（键 → 当前语言文案）。
 */
export function MessagerSettingsForm({ state, actions, t }: {
  state: MessagerCardState
  actions: MessagerCardActions
  t: (key: string) => string
}) {
  const groups = [...new Set(Object.keys(state.fields).map(key => key.split('.')[0]!))]
  const actionsDisabled = !state.writable || state.saving
  const blocked = !state.dirty || state.invalid || state.saving

  return (
    <>
      {!state.writable && <p style={READ_ONLY_STYLE} role="status">{t('status.readOnly')}</p>}
      {groups.map(group => (
        <div key={group}>
          <p style={GROUP_HEADING_STYLE}>{t(GROUP_TITLE_KEYS[group] ?? group)}</p>
          {Object.entries(state.fields)
            .filter(([key]) => key.startsWith(`${group}.`))
            .map(([key, field]) => {
              const fieldName = key.slice(key.indexOf('.') + 1)
              const spec = FIELD_LOOKUP[key]
              if (spec === undefined) return null
              if (isFieldGated(spec, state.fields)) return null // 门控关闭：不渲染子配置
              return (
                <FieldRow
                  key={key}
                  spec={spec}
                  state={field}
                  actions={actions}
                  t={t}
                  disabled={actionsDisabled}
                />
              )
            })}
        </div>
      ))}
      <div style={FOOTER_STYLE}>
        {state.failed && <p style={FAILED_STYLE} role="status">{t('status.saveFailed')}</p>}
        {state.invalid && !state.failed && <p style={FAILED_STYLE} role="status">{t('status.invalidInput')}</p>}
        <button
          type="button"
          style={{ ...DISCARD_STYLE, ...((!state.dirty && !state.failed) || state.saving ? { opacity: 0.4, cursor: 'default' } : {}) }}
          disabled={!state.dirty || state.saving}
          onClick={actions.discard}
        >
          {t('action.discard')}
        </button>
        <button
          type="button"
          style={{ ...SAVE_STYLE, ...(blocked ? { opacity: 0.4, cursor: 'default' } : {}) }}
          disabled={blocked}
          onClick={actions.save}
        >
          {state.saving ? t('action.saving') : t('action.save')}
        </button>
      </div>
    </>
  )
}
