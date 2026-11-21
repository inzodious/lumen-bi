import { describe, expect, it } from 'vitest'
import { lumenStyleCss, lumenStyleOf, parseLumenStyle } from '../lumenStyle'

describe('Lumen_Style container effects', () => {
  it('reads the annotation of a visual container', () => {
    const json = { annotations: [{ name: 'Other', value: 'x' }, { name: 'Lumen_Style', value: JSON.stringify({ blur: 14, rotate: -3 }) }] }
    expect(lumenStyleOf(json)).toEqual({ blur: 14, rotate: -3 })
    expect(lumenStyleOf({})).toBeUndefined()
    expect(lumenStyleOf({ annotations: [{ name: 'Lumen_Style', value: '{not json' }] })).toBeUndefined()
  })

  it('sanitises: hex colors only, clamped numbers, at least two gradient stops', () => {
    expect(
      parseLumenStyle({
        gradient: { angle: 135, stops: ['#7B5CFF', 'red', 'url(x)', '#FF5FA2CC'] },
        radial: { at: '30% 20%; background: red', stops: ['#FFF', '#0000'] },
        blur: 500,
        glow: { color: 'javascript:alert(1)', size: 10 },
        rotate: 90
      })
    ).toEqual({ gradient: { angle: 135, stops: ['#7B5CFF', '#FF5FA2CC'] }, radial: { at: '50% 50%', stops: ['#FFF', '#0000'] }, blur: 60, rotate: 45 })
    expect(parseLumenStyle({ gradient: { stops: ['#000'] } })).toBeUndefined()
    expect(parseLumenStyle('[]')).toBeUndefined()
  })

  it('turns into CSS: gradient layers over the fill, backdrop blur, glow shadow, rotation', () => {
    const css = lumenStyleCss(parseLumenStyle({ radial: { at: '30% 20%', stops: ['#FFFFFF33', '#FFFFFF00'] }, blur: 14, glow: { color: '#3BF0FF', size: 18, opacity: 0.5 }, rotate: -2 })!, 'rgba(255, 255, 255, 0.07)')
    expect(css).toEqual({
      background: 'radial-gradient(circle at 30% 20%, #FFFFFF33, #FFFFFF00), linear-gradient(rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07))',
      backdropFilter: 'blur(14px) saturate(140%)',
      glow: '0 0 18px rgba(59, 240, 255, 0.5)',
      transform: 'rotate(-2deg)'
    })
    expect(lumenStyleCss({ gradient: { angle: 155, stops: ['#FFFFFF1F', '#FFFFFF08'] } }, undefined).background).toBe('linear-gradient(155deg, #FFFFFF1F, #FFFFFF08)')
    // 8-digit glow colors keep their alpha
    expect(lumenStyleCss({ glow: { color: '#3BF0FF80', size: 10, opacity: 1 } }, undefined).glow).toBe('0 0 10px rgba(59, 240, 255, 0.502)')
  })
})
