import { describe, expect, it } from 'vitest'
import { basename, dirname, joinPath, portablePath } from '../fs'

describe('portablePath', () => {
  it('turns Windows paths into forward-slash form', () => {
    expect(portablePath('C:\\Users\\Zod\\Report.pbix')).toBe('C:/Users/Zod/Report.pbix')
    expect(portablePath('\\\\nas\\share\\dir')).toBe('//nas/share/dir')
    expect(portablePath('C:/already/fine')).toBe('C:/already/fine')
  })
  it('leaves POSIX paths alone', () => {
    expect(portablePath('/home/zod/a\\b.pbix')).toBe('/home/zod/a\\b.pbix')
    expect(portablePath('/tmp/x')).toBe('/tmp/x')
  })
})

describe('joinPath', () => {
  it('joins POSIX paths', () => {
    expect(joinPath('/a/', 'b', '../c', './d')).toBe('/a/c/d')
    expect(joinPath('/')).toBe('/')
    expect(joinPath('a', 'b')).toBe('a/b')
  })
  it('keeps drive and UNC roots', () => {
    expect(joinPath('C:/Users', 'x', 'y.pbix')).toBe('C:/Users/x/y.pbix')
    expect(joinPath('C:/', '..', 'x')).toBe('C:/x')
    expect(joinPath('//nas/share', 'dir', 'f.csv')).toBe('//nas/share/dir/f.csv')
  })
})

describe('dirname / basename', () => {
  it('handles POSIX paths', () => {
    expect(dirname('/a/b/c.pbix')).toBe('/a/b')
    expect(dirname('/a')).toBe('/')
    expect(dirname('/a/b/')).toBe('/a')
    expect(basename('/a/b/c.pbix')).toBe('c.pbix')
  })
  it('handles drive and UNC roots', () => {
    expect(dirname('C:/x.pbix')).toBe('C:/')
    expect(dirname('C:/a/x.pbix')).toBe('C:/a')
    expect(dirname('//nas/share/x.csv')).toBe('//nas/share/')
    expect(basename('C:\\a\\x.pbix')).toBe('x.pbix')
  })
})
