import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isEmail, joinList, normalizeUrl, parseYear, passwordProblem, splitList } from './validation.ts'

describe('isEmail', () => {
  it('接受常见邮箱，拒绝格式错误', () => {
    assert.equal(isEmail('sales@factory.com'), true)
    assert.equal(isEmail('  a.b+c@x.co '), true)
    for (const bad of ['', 'a@b', 'a@b.c', 'a b@c.com', '@c.com', 'a@.com']) assert.equal(isEmail(bad), false, bad)
  })
})

describe('passwordProblem', () => {
  it('与后端规则一致：至少 8 位，同时有字母和数字', () => {
    assert.equal(passwordProblem('abc123'), 'tooShort')
    assert.equal(passwordProblem('abcdefgh'), 'needMix')
    assert.equal(passwordProblem('12345678'), 'needMix')
    assert.equal(passwordProblem('Factory123'), null)
  })
})

describe('normalizeUrl', () => {
  it('补全协议并只接受 http / https', () => {
    assert.equal(normalizeUrl('demo-valve.com'), 'https://demo-valve.com/')
    assert.equal(normalizeUrl(' http://a.com/x '), 'http://a.com/x')
    assert.equal(normalizeUrl('javascript:alert(1)'), null)
    assert.equal(normalizeUrl('ftp://a.com'), null)
    assert.equal(normalizeUrl('localhost'), null)
    assert.equal(normalizeUrl(''), null)
    assert.equal(normalizeUrl('http://'), null)
  })
})

describe('列表与年份', () => {
  it('splitList 支持中英文分隔符并去重', () => {
    assert.deepEqual(splitList('Germany, USA，巴西、Germany\n;'), ['Germany', 'USA', '巴西'])
    assert.equal(joinList(['a', 'b']), 'a, b')
    assert.equal(joinList(undefined), '')
  })
  it('parseYear', () => {
    assert.equal(parseYear('', 2026), null)
    assert.equal(parseYear('2008', 2026), 2008)
    assert.equal(parseYear('1800', 2026), undefined)
    assert.equal(parseYear('2030', 2026), undefined)
    assert.equal(parseYear('20o8', 2026), undefined)
  })
})
