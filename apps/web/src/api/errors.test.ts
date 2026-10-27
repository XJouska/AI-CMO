// 运行：node --test apps/web/src/api/errors.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, errorToMessage, readApiError } from './errors.ts'

const messages = {
  network: 'network',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'notFound',
  rateLimited: 'rateLimited',
  server: 'server',
  unknown: 'unknown',
}

test('通用错误码映射到固定文案', () => {
  assert.equal(errorToMessage(new ApiError(0, 'network_error', ''), messages), 'network')
  assert.equal(errorToMessage(new ApiError(401, 'unauthorized', 'leak'), messages), 'unauthorized')
  assert.equal(errorToMessage(new ApiError(403, 'forbidden', 'leak'), messages), 'forbidden')
  assert.equal(errorToMessage(new ApiError(404, 'not_found', 'leak'), messages), 'notFound')
  assert.equal(errorToMessage(new ApiError(404, 'http_404', 'leak'), messages), 'notFound')
  assert.equal(errorToMessage(new ApiError(429, 'rate_limited', 'leak'), messages), 'rateLimited')
  assert.equal(errorToMessage(new ApiError(502, 'x', 'stack trace'), messages), 'server')
  assert.equal(errorToMessage(new ApiError(500, 'account_locked', 'leak'), messages), 'server')
  assert.equal(errorToMessage(new ApiError(422, 'validation_error', '提交的信息格式不正确'), messages), '提交的信息格式不正确')
})

test('具体业务错误码展示后端文案', () => {
  assert.equal(errorToMessage(new ApiError(401, 'invalid_credentials', '邮箱或密码不正确'), messages), '邮箱或密码不正确')
  assert.equal(errorToMessage(new ApiError(429, 'account_locked', '账号已临时锁定'), messages), '账号已临时锁定')
  assert.equal(errorToMessage(new ApiError(404, 'invite_invalid', ''), messages), 'notFound')
})

test('业务错误展示后端文案，缺失时回退', () => {
  assert.equal(errorToMessage(new ApiError(422, 'invalid_url', '网址格式不正确'), messages), '网址格式不正确')
  assert.equal(errorToMessage(new ApiError(400, 'bad', ''), messages), 'unknown')
  assert.equal(errorToMessage(new Error('boom'), messages), 'unknown')
})

test('解析统一错误格式', async () => {
  const res = new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: '额度已用完' } }), { status: 402 })
  const err = await readApiError(res)
  assert.equal(err.status, 402)
  assert.equal(err.code, 'quota_exceeded')
  assert.equal(err.message, '额度已用完')
})

test('非 JSON 响应体回退为通用错误码', async () => {
  const err = await readApiError(new Response('<html>bad gateway</html>', { status: 502 }))
  assert.equal(err.code, 'http_502')
  assert.equal(err.message, '')
})
