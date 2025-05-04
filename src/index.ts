import { AdapterRequestContext } from '@hattip/core'
import { isPromise } from 'radashi'
import {
  ApplyFirstMiddleware,
  ApplyMiddleware,
  Middleware,
  MiddlewareTypes,
  RequestMiddleware,
  ResponseMiddleware,
} from './types'

const kRequestChain = Symbol('requestChain')
const kResponseChain = Symbol('responseChain')
const kIgnoreNotFound = Symbol('ignoreNotFound')
const kMiddlewareCache = Symbol('middlewareCache')

type InternalContext = AdapterRequestContext<any> & {
  [kMiddlewareCache]?: Set<RequestMiddleware | ResponseMiddleware>
  [kIgnoreNotFound]?: boolean
}

export class MiddlewareChain<
  /** Values expected by the start of the chain. */
  TInputs extends MiddlewareTypes = any,
  /** Values provided by the end of the chain. */
  TCurrent extends MiddlewareTypes = any,
  /** Values from the host platform. */
  TPlatform = any,
> {
  /** This property won't exist at runtime. It contains type information for inference purposes. */
  declare $: {
    input: TInputs
    current: TCurrent
    platform: TPlatform
  }

  /** The number of parameters when called as a function. */
  declare readonly length: 1

  protected [kRequestChain]: RequestMiddleware[] = []
  protected [kResponseChain]: ResponseMiddleware[] = []

  /**
   * Attach a middleware. If the `response` paramter is declared, it will be
   * treated as a response middleware. Otherwise, it will be treated as a
   * request middleware.
   *
   * @returns a new `MiddlewareChain` instance
   */
  use<
    const TMiddleware extends Middleware<
      TCurrent['properties'],
      TCurrent['env'],
      TPlatform
    >,
  >(middleware: TMiddleware): ApplyMiddleware<this, TMiddleware> {
    let requestChain = this[kRequestChain]
    let responseChain = this[kResponseChain]

    if (middleware.length < 2) {
      requestChain = [...requestChain, middleware as any]
    } else {
      responseChain = [...responseChain, middleware as any]
    }

    async function handler(parentContext: InternalContext) {
      const context = Object.create(parentContext)
      context[kIgnoreNotFound] = true

      // Avoid calling the same middleware twice.
      const cache = (context[kMiddlewareCache] ||= new Set())

      let response: Response | undefined
      let env: Record<string, string> | undefined

      for (const middleware of requestChain) {
        if (cache.has(middleware)) {
          continue
        }
        cache.add(middleware)
        let result = middleware(context)
        if (isPromise(result)) {
          result = await result
        }
        // If defined, it's a response or a plugin.
        if (result) {
          if (result instanceof Response) {
            response = result
            break
          }
          if (result.define) {
            Object.assign(context, result.define)
          }
          if (result.env) {
            env ||= createExtendedEnv(context)
            Object.assign(env, result.env)
          }
        }
      }

      if (!response) {
        if (parentContext[kIgnoreNotFound]) {
          return // …instead of issuing a 404 Response.
        }
        response = new Response('Not Found', { status: 404 })
      }

      for (const middleware of responseChain) {
        if (cache.has(middleware)) {
          continue
        }
        cache.add(middleware)
        let result = middleware(context, response)
        if (isPromise(result)) {
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
}

function createExtendedEnv(context: InternalContext) {
  const env = Object.create(null) as Record<string, string>
  const superEnv = context.env
  context.env = key => env[key] ?? superEnv(key)
  return env
}

export function chain<
  TPlatform = unknown,
  TEnv extends object = {},
  TProperties extends object = {},
>(): MiddlewareChain<
  { env: TEnv; properties: TProperties },
  { env: TEnv; properties: TProperties },
  TPlatform
>

export function chain<const T extends Middleware = Middleware>(
  middleware: T
): ApplyFirstMiddleware<T>

export function chain<const T extends Middleware = Middleware>(middleware?: T) {
  const handler = new MiddlewareChain()
  return middleware ? handler.use(middleware) : handler
}
