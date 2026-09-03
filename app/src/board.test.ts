import { describe, expect, it } from 'vitest'
import { actions, allControlIds, correctedInputProfileObserved, correctedInputProfileObservedForVariant, dualPlaneInputProfileConfigured, hardware, hybridNativeInputProfileConfigured, profileOrder, profiles } from './board'

describe('board contract', () => {
  it('maps every physical signal in every profile', () => {
    for (const id of profileOrder) {
      expect(Object.keys(profiles[id].mapping).sort()).toEqual([...allControlIds].sort())
      for (const actionId of Object.values(profiles[id].mapping)) expect(actions[actionId]).toBeDefined()
    }
  })
  it('keeps all six live agent slots stable across every software lens', () => {
    for (const id of profileOrder) {
      for (let slot = 1; slot <= 6; slot += 1) expect(profiles[id].mapping[`agent${slot}` as keyof typeof profiles[typeof id]['mapping']]).toBe(`focus_agent_${slot}`)
    }
  })
  it('requires a hold for every fleet authority mutation', () => {
    for (const id of ['pause_fleet', 'resume_fleet', 'daemon_stop']) expect(actions[id].safety).toBe('hold')
  })
  it('never exposes proposal disposition or release actions', () => {
    for (const forbidden of ['approve_proposal', 'reject_proposal', 'merge', 'deploy', 'publish']) expect(actions[forbidden]).toBeUndefined()
  })
  it('matches the verified 4x4 physical geometry', () => {
    expect(hardware.mechanicalSwitches).toBe(13)
    expect(hardware.controls.filter((control) => control.kind === 'agent')).toHaveLength(6)
    expect(hardware.controls.find((control) => control.id === 'dialPress')).toMatchObject({ row: 1, column: 1, hardwareId: 'ENC_CLK' })
    expect(hardware.controls.find((control) => control.id === 'joyUp')).toMatchObject({ row: 1, column: 4, hardwareId: 'JOY_UP' })
    expect(hardware.controls.find((control) => control.id === 'cmd5')).toMatchObject({ row: 4, column: 2, hardwareId: 'ACT10' })
    expect(hardware.controls.find((control) => control.id === 'cmd6')).toMatchObject({ row: 4, column: 3, hardwareId: 'ACT11' })
    expect(hardware.controls.find((control) => control.id === 'cmd7')).toMatchObject({ row: 4, column: 4, hardwareId: 'ACT12', cap: 'transparent' })
    expect(hardware.firmwareControls[0]).toMatchObject({ row: 4, column: 1, bindable: false, leds: 3 })
  })
  it('keeps Voice, Continue, and transparent Attention independently addressable', () => {
    for (const id of profileOrder) {
      expect(profiles[id].mapping.cmd5).toBe('stage_voice')
      expect(profiles[id].mapping.cmd6).toBe('copy_guarded_continue')
      expect(profiles[id].mapping.cmd7).toBe('stage_attention')
    }
  })
  it('keeps all 20 shortcut signals unique, including both bottom-row keys', () => {
    expect(allControlIds).toHaveLength(20)
    expect(new Set(allControlIds).size).toBe(20)
    expect(allControlIds).toEqual(expect.arrayContaining(['cmd5', 'cmd6']))
  })
  it('accepts only the uniquely named corrected Input profile receipt', () => {
    const corrected = {
      cacheStatus: 'available' as const,
      activeProfile: 'Ashlr Agent Board Corrected',
      activeLayer: 'Ashlr Daily',
      encoderDirection: 'correct' as const,
    }
    expect(correctedInputProfileObserved(corrected)).toBe(true)
    expect(correctedInputProfileObserved({ ...corrected, activeProfile: 'Ashlr Agent Board' })).toBe(false)
    expect(correctedInputProfileObserved({ ...corrected, activeLayer: 'Other' })).toBe(false)
    expect(correctedInputProfileObserved({ ...corrected, encoderDirection: 'reversed' })).toBe(false)
    const diagnostic = {
      ...corrected,
      activeProfile: 'Ashlr Flight Check Corrected - diagnostic',
      activeLayer: 'Ashlr Diagnostic',
    }
    expect(correctedInputProfileObservedForVariant(diagnostic, 'diagnostic')).toBe(true)
    expect(correctedInputProfileObservedForVariant(corrected, 'diagnostic')).toBe(false)
    expect(correctedInputProfileObservedForVariant(diagnostic, 'daily')).toBe(false)

    const dual = {
      cacheStatus: 'available' as const,
      activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
      activeLayer: null,
      encoderDirection: 'unavailable' as const,
      configuredLayers: [
        { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native' as const, encoderDirection: 'unrecognized' as const },
        { name: 'Ashlr Daily', mapping: 'ashlr_daily' as const, encoderDirection: 'correct' as const },
      ],
    }
    expect(dualPlaneInputProfileConfigured(dual)).toBe(true)
    expect(correctedInputProfileObservedForVariant(dual, 'daily')).toBe(false)
    expect(correctedInputProfileObservedForVariant(dual, 'daily', true)).toBe(true)
    expect(correctedInputProfileObservedForVariant({ ...dual, configuredLayers: [] }, 'daily', true)).toBe(false)
    expect(correctedInputProfileObservedForVariant({ ...dual, configuredLayers: [...dual.configuredLayers].reverse() }, 'daily', true)).toBe(false)
  })
  it('requires the exact ordered hybrid profile cache', () => {
    const hybrid = {
      cacheStatus: 'available' as const,
      activeProfile: 'Ashlr Hybrid Dual Plane (UNOFFICIAL)',
      activeLayer: null,
      encoderDirection: 'unavailable' as const,
      configuredLayers: [
        { name: 'Ashlr Hybrid Native (UNOFFICIAL)', mapping: 'hybrid_native' as const, encoderDirection: 'correct' as const },
        { name: 'Ashlr Daily', mapping: 'ashlr_daily' as const, encoderDirection: 'correct' as const },
      ],
    }
    expect(hybridNativeInputProfileConfigured(hybrid)).toBe(true)
    expect(hybridNativeInputProfileConfigured({ ...hybrid, activeProfile: 'Almost hybrid' })).toBe(false)
    expect(hybridNativeInputProfileConfigured({ ...hybrid, configuredLayers: [...hybrid.configuredLayers].reverse() })).toBe(false)
  })
})
