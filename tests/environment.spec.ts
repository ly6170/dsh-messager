import { describe, expect, it } from 'vitest'
import {
  applyEnvironmentDefaults, detectHostKind, environmentDefaults, userSet,
} from '../src/environment.ts'

describe('detectHostKind（v0.3.6 智能默认的环境判定）', () => {
  it('Electron 二进制 + 被 IPC 托管 → desktop（桌面壳 spawn 的 Host 子进程）', () => {
    expect(detectHostKind({ ELECTRON_RUN_AS_NODE: '1' }, { electron: '44.0.0' }, true)).toBe('desktop')
  })

  it('只有 versions.electron、没有 ELECTRON_RUN_AS_NODE 也算 Electron 托管', () => {
    expect(detectHostKind({}, { electron: '44.0.0' }, true)).toBe('desktop')
  })

  it('Electron 二进制但没有 IPC 通道 → node（经桌面版自带 CLI 跑的 dsh web，没有窗口）', () => {
    expect(detectHostKind({ ELECTRON_RUN_AS_NODE: '1' }, { electron: '44.0.0' }, false)).toBe('node')
  })

  it('普通 Node 宿主 → node', () => {
    expect(detectHostKind({}, { node: '24.21.0' }, false)).toBe('node')
    expect(detectHostKind({}, { node: '24.21.0' }, true)).toBe('node')
  })

  it('versions 非对象时不抛错：仅凭 ELECTRON_RUN_AS_NODE 也能判定 Electron 二进制', () => {
    expect(detectHostKind({ ELECTRON_RUN_AS_NODE: '1' }, undefined, true)).toBe('desktop')
    expect(detectHostKind({ ELECTRON_RUN_AS_NODE: '1' }, null, true)).toBe('desktop')
    expect(detectHostKind({}, null, true)).toBe('node')
    expect(detectHostKind({}, undefined, false)).toBe('node')
  })
})

describe('environmentDefaults', () => {
  it('桌面宿主 → system 默认关闭（原生通知交给渲染端）', () => {
    expect(environmentDefaults('desktop')).toEqual({ system: { enabled: false } })
  })

  it('普通宿主 → 不覆盖任何字段（与 v0.3.5 行为一致）', () => {
    expect(environmentDefaults('node')).toEqual({})
  })
})

describe('userSet（判断「用户显式设置过」）', () => {
  it('逐段 Object.hasOwn：值为 false 也算设置过', () => {
    expect(userSet({ system: { enabled: false } }, ['system', 'enabled'])).toBe(true)
    expect(userSet({ system: { enabled: true } }, ['system', 'enabled'])).toBe(true)
  })

  it('中途缺失 / 非对象 / undefined 层 → 未设置', () => {
    expect(userSet({ system: {} }, ['system', 'enabled'])).toBe(false)
    expect(userSet({}, ['system', 'enabled'])).toBe(false)
    expect(userSet(undefined, ['system', 'enabled'])).toBe(false)
    expect(userSet({ system: null }, ['system', 'enabled'])).toBe(false)
    expect(userSet({ system: 'x' }, ['system', 'enabled'])).toBe(false)
  })
})

describe('applyEnvironmentDefaults', () => {
  const resolved = { system: { enabled: true, verbosity: 'normal' }, browser: { enabled: true } }

  it('用户没设置过 → 环境默认值生效，同组其它字段不受影响', () => {
    expect(applyEnvironmentDefaults(resolved, {}, environmentDefaults('desktop'))).toEqual({
      system: { enabled: false, verbosity: 'normal' },
      browser: { enabled: true },
    })
  })

  it('用户显式设置过 → 用户值优先（含反向极性，两种取值都验）', () => {
    // 用户显式打开：桌面默认值不得把它关掉
    expect(applyEnvironmentDefaults(
      resolved, { system: { enabled: true } }, environmentDefaults('desktop'),
    ).system.enabled).toBe(true)
    // 反向极性：用户显式关闭 + 环境默认值想打开 → 仍以用户为准
    // （⚠️ 不能用「环境默认值也是 false」的输入做断言，那是重言式，测不出 bug）
    expect(applyEnvironmentDefaults(
      { system: { enabled: false } }, { system: { enabled: false } }, { system: { enabled: true } },
    ).system.enabled).toBe(false)
    // 无环境默认值的宿主：用户开着就保持开着
    expect(applyEnvironmentDefaults(
      resolved, { system: { enabled: true } }, environmentDefaults('node'),
    ).system.enabled).toBe(true)
  })

  it('普通宿主 → 原样返回', () => {
    expect(applyEnvironmentDefaults(resolved, {}, environmentDefaults('node'))).toEqual(resolved)
  })

  it('不修改入参（返回深拷贝）', () => {
    const input = { system: { enabled: true } }
    const output = applyEnvironmentDefaults(input, {}, environmentDefaults('desktop'))
    expect(input.system.enabled).toBe(true)
    expect(output.system.enabled).toBe(false)
  })
})
