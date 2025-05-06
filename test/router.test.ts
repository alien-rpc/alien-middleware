import { AdapterRequestContext } from '@hattip/core'
import { noop } from 'radashi'
import { chain } from '../src/index.ts'
import { routes } from '../src/router.ts'
import { RouteContext } from '../src/types.ts'

const context: AdapterRequestContext = {
  env: () => undefined,
  ip: '',
  platform: {},
  request: new Request('http://localhost/users/123'),
  passThrough: noop,
  waitUntil: noop,
}

describe('router', () => {
  test('basic routing', async () => {
    const router = routes()
    const handler = vi.fn(() => new Response('Hello'))

    router.use('/users/:id', handler)

    const response = await router(context)

    expect(response).toBeInstanceOf(Response)
    expect(handler).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ params: { id: '123' } })
    )
  })

  test('method-specific routing', async () => {
    const router = routes()
    const getHandler = vi.fn(() => new Response('GET'))
    const postHandler = vi.fn(() => new Response('POST'))

    router.use('GET', '/users/:id', getHandler)
    router.use('POST', '/users/:id', postHandler)

    // Test GET request
    await router({
      ...context,
      request: new Request('http://localhost/users/123', { method: 'GET' }),
    })

    expect(getHandler).toHaveBeenCalled()
    expect(postHandler).not.toHaveBeenCalled()

    // Test POST request
    await router({
      ...context,
      request: new Request('http://localhost/users/123', { method: 'POST' }),
    })

    expect(postHandler).toHaveBeenCalled()
  })

  test('multiple methods', async () => {
    const router = routes()
    const handler = vi.fn(() => new Response('OK'))

    router.use(['GET', 'POST'], '/api', handler)

    // Test GET request
    await router({
      ...context,
      request: new Request('http://localhost/api', { method: 'GET' }),
    })

    expect(handler).toHaveBeenCalledTimes(1)

    // Test POST request
    await router({
      ...context,
      request: new Request('http://localhost/api', { method: 'POST' }),
    })

    expect(handler).toHaveBeenCalledTimes(2)

    // Test DELETE request (this should be ignored)
    const deleteContext = {
      ...context,
      request: new Request('http://localhost/api', { method: 'DELETE' }),
    }
    await router(deleteContext)

    expect(handler).not.toHaveBeenCalledTimes(3)
  })

  test('wildcard method', async () => {
    const router = routes()
    const handler = vi.fn(() => new Response('OK'))

    router.use('*', '/wildcard', handler)

    await router({
      ...context,
      request: new Request('http://localhost/wildcard', { method: 'DELETE' }),
    })

    expect(handler).toHaveBeenCalled()
  })

  test('with middleware chain', async () => {
    const app = chain().use(() => ({ env: { API_KEY: '123' } }))
    const router = routes(app)
    const handler = vi.fn((ctx: RouteContext) => {
      expect(ctx.env('API_KEY')).toBe('123')
      return new Response('OK')
    })

    router.use('/users/:id', handler)

    const response = await router(context)

    expect(response).toBeInstanceOf(Response)
    expect(handler).toHaveBeenCalled()
  })
})
