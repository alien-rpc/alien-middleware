import { AdapterRequestContext } from '@hattip/core'
import { noop } from 'radashi'
import { chain } from '../src/index.ts'
import { RequestContext } from '../src/types.ts'

const app = chain()

const context: AdapterRequestContext = {
  env: () => undefined,
  ip: '',
  platform: {},
  request: new Request('http://localhost'),
  passThrough: noop,
  waitUntil: noop,
}

test('chaining is pure', async () => {
  const ware = vi.fn()

  expect(app).not.toBe(app.use(ware))

  const response = await app.use(noop)(context)
  expect(response.status).toBe(404)
  expect(ware).not.toHaveBeenCalled()
})

describe('request middleware', () => {
  test('define new properties', async () => {
    const ware = vi.fn((ctx: RequestContext<{ foo: boolean }>) => {
      expect(ctx.foo).toBe(true)
    })
    await app.use(() => ({ define: { foo: true } })).use(ware)(context)
    expect(ware).toHaveBeenCalled()
  })

  test('extend environment variables', async () => {
    const ware = vi.fn((ctx: RequestContext<{}, { bar: boolean }>) => {
      expect(ctx.env('bar')).toBe(true)
    })
    await app.use(() => ({ env: { bar: true } })).use(ware)(context)
    expect(ware).toHaveBeenCalled()
  })

  test('skips remaining "request middlewares" if a response is generated', async () => {
    const ware = vi.fn((ctx: RequestContext) => {
      return new Response(null, { status: 404 })
    })
    await app.use(() => new Response(null, { status: 418 })).use(ware)(context)
    expect(ware).not.toHaveBeenCalled()
  })
})

describe('response middleware', () => {
  test('receives the response', async () => {
    const ware = vi.fn((ctx: RequestContext, response: Response) => {
      expect(response.status).toBe(418)
    })

    const response = await app
      .use(() => new Response(null, { status: 418 }))
      .use(ware)(context)

    expect(response.status).toBe(418)
    expect(ware).toHaveBeenCalled()
  })

  test('override response', async () => {
    const ware = vi.fn((ctx: RequestContext, response: Response) => {
      return new Response(null, { status: 404 })
    })

    const response = await app
      .use(() => new Response(null, { status: 418 }))
      .use(ware)(context)

    expect(response.status).toBe(404)
    expect(ware).toHaveBeenCalled()
  })

  test('called even if no response is generated', async () => {
    const ware = vi.fn((ctx: RequestContext, response: Response) => {
      expect(response.status).toBe(404)
    })

    const response = await app.use(ware)(context)
    expect(response.status).toBe(404)
    expect(ware).toHaveBeenCalled()
  })
})

describe('nested middleware chains', () => {
  test('plugins do not leak', async () => {
    const nestedApp = chain(() => ({
      define: { foo: true },
    }))

    const ware = vi.fn((ctx: RequestContext) => {
      expect('foo' in ctx).toBe(false)
    })

    await app.use(nestedApp).use(ware)(context)
    expect(ware).toHaveBeenCalled()
  })
})
