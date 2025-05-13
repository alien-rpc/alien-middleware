import { AdapterRequestContext } from '@hattip/core'
import { createServer } from 'node:http'
import { AddressInfo } from 'node:net'
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
    const ware = vi.fn((ctx: RequestContext<{}, { foo: boolean }>) => {
      expect(ctx.foo).toBe(true)
    })
    await app.use(() => ({ foo: true })).use(ware)(context)
    expect(ware).toHaveBeenCalled()
  })

  test('extend environment variables', async () => {
    const ware = vi.fn((ctx: RequestContext<{ bar: boolean }>) => {
      expect(ctx.env('bar')).toBe(true)
      // Expect missing keys are undefined.
      expect(ctx.env('foo' as any)).toBe(undefined)
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

  test('use context.passThrough() to skip remaining middlewares', async () => {
    const ware = vi.fn((ctx: RequestContext) => {
      ctx.passThrough()
    })
    const responseHandler = vi.fn(
      (ctx: RequestContext, response: Response) => {}
    )

    const response = await app
      .use(ware)
      .use(() => new Response(null, { status: 418 }))
      .use(responseHandler)(context)

    expect(ware).toHaveBeenCalled()
    expect(response.status).toBe(404)
    expect(responseHandler).not.toHaveBeenCalled()
  })

  test('access the parsed URL through context.url', async () => {
    const ware = vi.fn((ctx: RequestContext) => {
      const url = ctx.url
      expect(url).toBe(ctx.url) // The URL is cached.
      expect(url).toBeInstanceOf(URL)
      expect(url.pathname).toBe('/')
    })
    await app.use(ware)(context)
    expect(ware).toHaveBeenCalled()
  })

  test('set a response header', async () => {
    const response = await app
      .use(ctx => {
        ctx.setHeader('x-foo', 'true')
        ctx.setHeader('x-bar', 'true')
      })
      .use(ctx => {
        ctx.setHeader('x-bar', 'false')
      })(context)

    expect(response.headers.get('x-foo')).toBe('true')
    expect(response.headers.get('x-bar')).toBe('false')
  })
})

describe('response callbacks', () => {
  test('receives the response', async () => {
    const ware = vi.fn(() => ({
      onResponse(response: Response) {
        expect(response.status).toBe(418)
      },
    }))

    const response = await app
      .use(ware)
      .use(() => new Response(null, { status: 418 }))(context)

    expect(response.status).toBe(418)
    expect(ware).toHaveBeenCalled()
  })

  test('override response', async () => {
    const ware = vi.fn(() => ({
      onResponse() {
        return new Response(null, { status: 404 })
      },
    }))

    const response = await app
      .use(ware)
      .use(() => new Response(null, { status: 418 }))(context)

    expect(response.status).toBe(404)
    expect(ware).toHaveBeenCalled()
  })

  test('called even if no response is generated', async () => {
    const ware = vi.fn(() => ({
      onResponse(response: Response) {
        expect(response.status).toBe(404)
      },
    }))

    const response = await app.use(ware)(context)
    expect(response.status).toBe(404)
    expect(ware).toHaveBeenCalled()
  })

  test('register with context.onResponse()', async () => {
    const ware = vi.fn((ctx: RequestContext) => {
      ctx.onResponse(response => {
        expect(response.status).toBe(404)
      })
    })

    const response = await app.use(ware)(context)
    expect(response.status).toBe(404)
    expect(ware).toHaveBeenCalled()
  })
})

describe('merging middleware chains', () => {
  test('request middlewares are merged', async () => {
    const nestedApp = chain(() => ({ foo: true }))

    const first = vi.fn((ctx: RequestContext<{}, { foo?: unknown }>) => {
      expect(ctx.foo).toBe(undefined)
    })

    const last = vi.fn((ctx: RequestContext<{}, { foo: boolean }>) => {
      expect(ctx.foo).toBe(true)
    })

    const app = chain().use(first).use(nestedApp).use(last)

    const response = await app.use(first)(context)
    expect(response.status).toBe(404)
    expect(first).toHaveBeenCalled()
    expect(last).toHaveBeenCalled()
  })

  test('response middlewares are merged', async () => {
    let calls = 0

    const nestedWare = vi.fn((ctx: RequestContext) => {
      ctx.onResponse(response => {
        expect(calls++).toBe(1)
        expect(response.status).toBe(418)
      })
    })

    const nestedApp = chain()
      .use(nestedWare)
      .use(() => new Response(null, { status: 418 }))

    const first = vi.fn((ctx: RequestContext) => {
      ctx.onResponse(response => {
        expect(calls++).toBe(0)
        expect(response.status).toBe(418)
      })
    })

    // This middleware will never run, because the nestedApp will always return
    // a response before then.
    const last = vi.fn((ctx: RequestContext) => {
      ctx.onResponse(() => {
        expect.fail('Should not be called')
      })
    })

    const app = chain().use(first).use(nestedApp).use(last)

    const response = await app.use(first)(context)
    expect(response.status).toBe(418)
    expect(nestedWare).toHaveBeenCalled()
    expect(first).toHaveBeenCalled()
    expect(last).not.toHaveBeenCalled()
  })
})

test('middleware chains can be isolated', async () => {
  const nestedApp = chain(() => ({ foo: true }))

  const ware = vi.fn((ctx: RequestContext) => {
    expect('foo' in ctx).toBe(false)
  })

  await app.use(nestedApp.isolate()).use(ware)(context)
  expect(ware).toHaveBeenCalled()

  // An empty chain returns noop.
  expect(chain().isolate()).toBe(noop)
})

test('chain is a no-op if a middleware chain is passed', () => {
  const chain1 = chain().use(noop)
  const chain2 = chain(chain1)

  expect(chain2).toBe(chain1)
})

test('response is cloned if its type is not "default"', async () => {
  const fetcher = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        const server = createServer((req, res) => {
          res.end('Hello, world!')
        })
        server.listen(() => {
          const { port } = server.address() as AddressInfo
          resolve(
            fetch(`http://localhost:${port}/`).finally(() => {
              server.close()
            })
          )
        })
      })
  )

  const response = await app
    .use(ctx => {
      ctx.onResponse(response => {
        response.headers.set('x-test', 'test')
      })
    })
    .use(fetcher)(context)

  expect(fetcher).toHaveBeenCalled()
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('Hello, world!')
  expect(response.headers.get('x-test')).toBe('test')
})
