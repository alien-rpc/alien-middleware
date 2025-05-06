import { AdapterRequestContext } from '@hattip/core'
import { isFunction, noop } from 'radashi'
import {
  ApplyFirstMiddleware,
  ApplyMiddleware,
  ExtractMiddleware,
  IsolatedContext,
  Middleware,
  MiddlewareTypes,
  RequestContext,
  RequestMiddleware,
  ResponseMiddleware,
} from './types'
import { Awaitable } from './types/common.ts'
import { defineParsedURL } from './url.ts'

const kRequestChain = Symbol('requestChain')
const kResponseChain = Symbol('responseChain')
const kIgnoreNotFound = Symbol('ignoreNotFound')
const kMiddlewareCache = Symbol('middlewareCache')
const kResponseHeaders = Symbol('responseHeaders')

type InternalContext = AdapterRequestContext<any> & {
  [kIgnoreNotFound]?: boolean
  [kMiddlewareCache]?: Set<RequestMiddleware | ResponseMiddleware>
  [kResponseHeaders]?: Headers | undefined
  url?: URL
  setHeader?: (name: string, value: string) => void
}

export class MiddlewareChain<T extends MiddlewareTypes = any> {
  /** This property won't exist at runtime. It contains type information for inference purposes. */
  declare $MiddlewareChain: T

  /** The number of parameters when called as a function. */
  declare readonly length: 1

  protected [kRequestChain]: RequestMiddleware[] = []
  protected [kResponseChain]: ResponseMiddleware[] = []

  /**
   * Attach a middleware. If the `response` parameter is declared, it will be
   * treated as a response middleware. Otherwise, it will be treated as a
   * request middleware.
   *
   * If a middleware chain is given, its middlewares will be executed after any
   * existing middlewares in this chain.
   *
   * @returns a new `MiddlewareChain` instance
   */
  use<const TMiddleware extends ExtractMiddleware<this>>(
    middleware: TMiddleware
  ): ApplyMiddleware<this, TMiddleware> {
    if (middleware instanceof MiddlewareChain) {
      return createHandler(
        [...this[kRequestChain], ...middleware[kRequestChain]],
        [...this[kResponseChain], ...middleware[kResponseChain]]
      )
    }

    let requestChain = this[kRequestChain]
    let responseChain = this[kResponseChain]

    if (middleware.length < 2) {
      requestChain = [...requestChain, middleware as any]
    } else {
      responseChain = [...responseChain, middleware as any]
    }

    return createHandler(requestChain, responseChain)
  }

  /**
   * Create a middleware function that encapsulates this middleware chain, so
   * any modifications it makes to the request context are not leaked.
   */
  isolate(): (ctx: IsolatedContext<this>) => Awaitable<Response | void> {
    return isFunction(this) ? ctx => this(ctx) : noop
  }
}

function createHandler(
  requestChain: RequestMiddleware[],
  responseChain: ResponseMiddleware[]
): any {
  async function handler(parentContext: InternalContext) {
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

    // Avoid calling the same middleware twice.
    const cache = (context[kMiddlewareCache] ||= new Set())

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
            env ||= createExtendedEnv(context)
            Object.defineProperties(
              env,
              Object.getOwnPropertyDescriptors(result.env)
            )
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

    // Prevent response middlewares from calling `setHeader()`.
    context.setHeader = null!

    for (const middleware of responseChain) {
      if (cache.has(middleware)) {
        continue
      }
      cache.add(middleware)
      let result = middleware(context as RequestContext, response)
      if (result instanceof Promise) {
        result = await result
      }
      if (result && result instanceof Response) {
        response = result
        continue // …instead of break.
      }
    }

    return response
  }

  Object.setPrototypeOf(handler, MiddlewareChain.prototype)
  handler[kRequestChain] = requestChain
  handler[kResponseChain] = responseChain
  return handler as any
}

function createExtendedEnv(context: InternalContext) {
  const env = Object.create(null) as Record<string, string>
  const superEnv = context.env
  context.env = key => env[key] ?? superEnv(key)
  return env
}

export function chain<
  TEnv extends object = {},
  TProperties extends object = {},
  TPlatform = unknown,
>(): MiddlewareChain<{
  initial: { env: TEnv; properties: TProperties }
  current: { env: TEnv; properties: TProperties }
  platform: TPlatform
}>

export function chain<const T extends Middleware = Middleware<{}, {}, unknown>>(
  middleware: T
): ApplyFirstMiddleware<T>

export function chain(middleware?: Middleware) {
  if (middleware instanceof MiddlewareChain) {
    return middleware
  }
  const empty = new MiddlewareChain()
  return middleware ? empty.use(middleware) : empty
}

export type {
  ApplyMiddleware,
  ExtractMiddleware,
  Middleware,
  MiddlewareContext,
  RequestContext,
  RequestHandler,
  RequestMiddleware,
  RequestPlugin,
  ResponseMiddleware,
} from './types.ts'
