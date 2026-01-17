import { AdapterRequestContext } from '@hattip/core'
import { isFunction, noop } from 'radashi'
import {
  AnyMiddleware,
  AnyMiddlewareChain,
  ApplyFirstMiddleware,
  ApplyMiddleware,
  ExtractMiddleware,
  IsolatedContext,
  Middleware,
  MiddlewareTypes,
  RequestContext,
  RequestHandler,
  RequestMiddleware,
  ResponseCallback,
} from './types'
import { Awaitable } from './types/common.ts'
import { defineParsedURL } from './url.ts'

const kRequestChain = Symbol('requestChain')
const kIgnoreNotFound = Symbol('ignoreNotFound')
const kMiddlewareCache = Symbol('middlewareCache')
const kResponseHeaders = Symbol('responseHeaders')

type InternalContext = AdapterRequestContext<any> & {
  [kIgnoreNotFound]?: boolean
  [kMiddlewareCache]?: Set<RequestMiddleware>
  [kResponseHeaders]?: Headers | undefined
  url?: URL
  setHeader?: (name: string, value: string) => void
  onResponse?: (callback: ResponseCallback) => void
}

export class MiddlewareChain<T extends MiddlewareTypes = any> {
  /** This property won't exist at runtime. It contains type information for inference purposes. */
  declare $MiddlewareChain: T

  /** The number of parameters when called as a function. */
  declare readonly length: 1

  // Any properties added here must also be set in the `createHandler` function.
  protected [kRequestChain]: RequestMiddleware[] = []

  get middlewareCount(): number {
    return this[kRequestChain].length
  }

  /**
   * Add a request middleware to the end of the chain.
   *
   * If a middleware chain is given, its middlewares will be executed after any
   * existing middlewares in this chain.
   *
   * @returns a new `MiddlewareChain` instance
   */
  use<const TMiddleware extends ExtractMiddleware<this>>(
    middleware: TMiddleware | null
  ): RequestHandler<ApplyMiddleware<this, TMiddleware>> {
    if (!middleware) {
      return this.toHandler()
    }
    return createHandler<ApplyMiddleware<this, TMiddleware>>(
      middleware instanceof MiddlewareChain
        ? [...this[kRequestChain], ...middleware[kRequestChain]]
        : [...this[kRequestChain], middleware]
    )
  }

  /**
   * Create a middleware function that encapsulates this middleware chain, so
   * any modifications it makes to the request context are not leaked.
   */
  isolate(): (ctx: IsolatedContext<this>) => Awaitable<Response | void> {
    return isFunction(this) ? ctx => this(ctx) : noop
  }

  /**
   * @internal You should not need to call this method, unless you want a
   * `RequestHandler` type from an empty middleware chain. If your middleware
   * chain is **not** empty, you won't need this.
   */
  toHandler<T2 extends MiddlewareTypes = T>(): RequestHandler<T2> {
    return createHandler(this[kRequestChain])
  }
}

/** Create an extended environment object that delegates to the parent context. */
function createExtendedEnv(context: InternalContext) {
  const env = Object.create(null) as Record<string, string>
  const superEnv = context.env
  context.env = key => env[key] ?? superEnv(key)
  return env
}

/** Run a middleware chain with a Hattip context. */
async function runMiddlewareChain(
  requestChain: RequestMiddleware[],
  parentContext: InternalContext
) {
  const context = Object.create(parentContext) as InternalContext
  context[kIgnoreNotFound] = true
  defineParsedURL(context)

  const { passThrough } = context

  let shouldPassThrough = false
  context.passThrough = () => {
    shouldPassThrough = true
  }

  context.setHeader = (name, value) => {
    // Avoid leaking headers into the parent context. This condition also
    // passes if no headers have been set yet.
    if (context[kResponseHeaders] === parentContext[kResponseHeaders]) {
      context[kResponseHeaders] = new Headers(parentContext[kResponseHeaders])
    }
    context[kResponseHeaders]!.set(name, value)
  }

  const responseChain: ResponseCallback[] = []

  context.onResponse = callback => {
    responseChain.push(callback)
  }

  // Avoid calling the same middleware twice.
  const cache = (context[kMiddlewareCache] = new Set(
    parentContext[kMiddlewareCache]
  ))

  let response: Response | undefined
  let env: Record<string, string> | undefined

  for (const middleware of requestChain) {
    if (cache.has(middleware)) {
      continue
    }
    cache.add(middleware)
    let result = middleware(context as RequestContext)
    if (result instanceof Promise) {
      result = await result
    }
    if (shouldPassThrough) {
      break
    }
    // If defined, it's a response or a plugin.
    if (result) {
      if (result instanceof Response) {
        response = result
        break
      }
      for (const key in result) {
        if (key === 'env') {
          if (result.env) {
            env ||= createExtendedEnv(context)
            Object.defineProperties(
              env,
              Object.getOwnPropertyDescriptors(result.env)
            )
          }
        } else if (key === 'onResponse') {
          if (result.onResponse) {
            responseChain.push(result.onResponse)
          }
        } else {
          const descriptor = Object.getOwnPropertyDescriptor(result, key)!

          // Plugins cannot redefine context properties from other plugins.
          descriptor.configurable = false
          Object.defineProperty(context, key, descriptor)
        }
      }
    }
  }

  if (!response) {
    if (parentContext[kIgnoreNotFound]) {
      return // …instead of issuing a 404 Response.
    }
    response = new Response('Not Found', { status: 404 })
    if (shouldPassThrough) {
      passThrough()
      return response
    }
  }
  // Ensure the response's headers can be modified.
  else if (response.type !== 'default') {
    response = new Response(response.body, response)
  }

  context[kResponseHeaders]?.forEach((value, name) => {
    response!.headers.set(name, value)
  })

  // Prevent response callbacks from using `setHeader()`.
  context.setHeader = null!

  for (const plugin of responseChain) {
    let result = plugin(response)
    if (result instanceof Promise) {
      result = await result
    }
    if (result) {
      response = result
      continue // …instead of break.
    }
  }

  return response
}

/** Create a request handler that's also a middleware chain. */
function createHandler<T extends MiddlewareTypes>(
  requestChain: RequestMiddleware[]
) {
  const handler = runMiddlewareChain.bind(
    null,
    requestChain
  ) as RequestHandler<T>

  Object.setPrototypeOf(handler, MiddlewareChain.prototype)
  handler[kRequestChain] = requestChain
  return handler
}

export function chain<
  TEnv extends object = {},
  TProperties extends object = {},
  TPlatform = unknown,
>(): MiddlewareChain<MiddlewareTypes<TEnv, TProperties, TPlatform>>

export function chain<T extends AnyMiddleware>(
  middleware: T
): T extends AnyMiddlewareChain ? T : RequestHandler<ApplyFirstMiddleware<T>>

export function chain(middleware?: Middleware) {
  if (middleware instanceof MiddlewareChain) {
    return middleware
  }
  const empty = new MiddlewareChain()
  return middleware ? empty.use(middleware) : empty
}

export { filterPlatform } from './middleware/filterPlatform.ts'

export type {
  AnyMiddleware,
  AnyMiddlewareChain,
  ApplyMiddleware,
  ApplyMiddlewares,
  EmptyMiddlewareChain,
  EnvAccessor,
  ExtractMiddleware,
  HattipContext,
  Middleware,
  MiddlewareContext,
  MiddlewareTypes,
  RequestContext,
  RequestHandler,
  RequestMiddleware,
  RequestPlugin,
  ResponseCallback,
} from './types.ts'
