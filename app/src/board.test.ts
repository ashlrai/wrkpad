import { describe, expect, it } from 'vitest'
import { actions, allControlIds, hardware, profileOrder, profiles } from './board'

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
    expect(hardware.controls.find((control) => control.id === 'joyUp')).toMatchObject({ row: 1, column: 1, hardwareId: 'JOY_UP' })
    expect(hardware.controls.find((control) => control.id === 'dialPress')).toMatchObject({ row: 1, column: 4, hardwareId: 'ENC_CLK' })
    expect(hardware.controls.find((control) => control.id === 'cmd5')).toMatchObject({ row: 4, column: 2, span: 2, hardwareId: 'ACT10 + ACT11' })
    expect(hardware.firmwareControls[0]).toMatchObject({ row: 4, column: 1, bindable: false, leds: 3 })
  })
  it('never assigns different actions beneath the wide Mic cap', () => {
    for (const id of profileOrder) expect(profiles[id].mapping.cmd5).toBe(profiles[id].mapping.cmd6)
  })
  it('keeps all 20 shortcut signals unique, including both hidden Mic switches', () => {
    expect(allControlIds).toHaveLength(20)
    expect(new Set(allControlIds).size).toBe(20)
    expect(allControlIds).toEqual(expect.arrayContaining(['cmd5', 'cmd6']))
  })
})
