import type { AdapterRequestContext, HattipHandler } from '@hattip/core'
import { Any } from 'radashi'
import type { MiddlewareChain } from './index.ts'

export type RequestPlugin = {
  /**
   * Define properties on the request context.
   */
  define?: object
  /**
   * Add type-safe environment variables.
   */
  env?: object
}

type Inputs<T extends MiddlewareChain> = T['$']['input']
type Platform<T extends MiddlewareChain> = T['$']['platform']

type InputProperties<T extends MiddlewareChain> = Inputs<T>['properties']
type InputEnv<T extends MiddlewareChain> = Inputs<T>['env']

type Current<T extends MiddlewareChain> = T['$']['current']
type Properties<T extends MiddlewareChain> = Current<T>['properties']
type Env<T extends MiddlewareChain> = Current<T>['env']

export type MiddlewareTypes<
  TProperties extends object = any,
  TEnv extends object = any,
> = {
  properties: TProperties
  env: TEnv
}

// This interface exists to reduce visual noise when hovering on a
// RequestContext variable in your IDE.
interface HattipContext<TPlatform, TEnv extends object>
  extends AdapterRequestContext<TPlatform> {
  /**
   * The `request.url` string parsed into a `URL` object. Parsing is performed
   * on-demand and the result is cached.
   */
  url: URL

  env<K extends keyof TEnv>(key: Extract<K, string>): TEnv[K]
  // Prevent unsafe access.
  env(key: never): string | undefined
}

/**
 * Converts a type `T` to something that can be intersected with an object.
 */
type Intersectable<T extends object> = [T] extends [never]
  ? {}
  : [T] extends [Any]
    ? Record<PropertyKey, any>
    : T

export type RequestContext<
  TProperties extends object = any,
  TEnv extends object = any,
  TPlatform = any,
> = HattipContext<TPlatform, TEnv> & Intersectable<TProperties>

type Awaitable<T> = T | PromiseLike<T>

export type RequestMiddleware<T extends MiddlewareChain = MiddlewareChain> = (
  context: RequestContext<InputProperties<T>, InputEnv<T>, Platform<T>>
) => Awaitable<Response | RequestPlugin | void>

export type ResponseMiddleware<T extends MiddlewareChain = MiddlewareChain> = (
  context: RequestContext<InputProperties<T>, InputEnv<T>, Platform<T>>,
  response: Response
) => Awaitable<Response | void>

export type RequestHandler<
  TInputs extends MiddlewareTypes = any,
  TCurrent extends MiddlewareTypes = any,
  TPlatform = any,
> = HattipHandler<TPlatform> & MiddlewareChain<TInputs, TCurrent, TPlatform>

/**
 * Either a request middleware or a response middleware.
 *
 * If your middleware declares the `response` parameter, it's treated as a
 * response middleware. This means it will run *after* a `Response` is generated
 * by a request middleware.
 */
export type Middleware<
  TProperties extends object = any,
  TEnv extends object = any,
  TPlatform = any,
> = (
  context: RequestContext<TProperties, TEnv, TPlatform>,
  response: Response
) => Awaitable<Response | RequestPlugin | void>

type Merge<
  TSource extends object,
  TOverrides extends object | undefined,
> = {} & (TOverrides extends object
  ? {
      [K in keyof TSource | keyof TOverrides]: K extends keyof TOverrides
        ? TOverrides[K]
        : K extends keyof TSource
          ? TSource[K]
          : never
    }
  : TSource)

type ApplyRequestPlugin<
  TParent extends MiddlewareChain,
  TPlugin extends RequestPlugin,
> = {
  properties: Merge<Properties<TParent>, TPlugin['define']>
  env: Merge<Env<TParent>, TPlugin['env']>
}

/**
 * This applies a middleware to a chain. If the type `TMiddleware` is itself a
 * chain, it's treated as a nested chain, which won't leak its plugins into the
 * parent chain.
 */
export type ApplyMiddleware<
  TParent extends MiddlewareChain,
  TMiddleware,
> = TMiddleware extends MiddlewareChain
  ? RequestHandler<Inputs<TParent>, Current<TParent>, Platform<TParent>>
  : TMiddleware extends () => Awaitable<infer TPlugin extends RequestPlugin>
    ? RequestHandler<
        Inputs<TParent>,
        ApplyRequestPlugin<TParent, TPlugin>,
        Platform<TParent>
      >
    : RequestHandler<Inputs<TParent>, Current<TParent>, Platform<TParent>>

export type ApplyFirstMiddleware<T extends Middleware> =
  T extends MiddlewareChain
    ? T
    : ApplyMiddleware<
        MiddlewareChain<
          { properties: {}; env: {} },
          { properties: {}; env: {} },
          unknown
        >,
        T
      >

export type MergeMiddleware<
  TFirst extends MiddlewareChain,
  TSecond extends Middleware<Properties<TFirst>, Env<TFirst>, Platform<TFirst>>,
> = RequestHandler<
  Inputs<TFirst>,
  TSecond extends MiddlewareChain
    ? {
        properties: Merge<Properties<TFirst>, Properties<TSecond>>
        env: Merge<Env<TFirst>, Env<TSecond>>
      }
    : TSecond extends () => Awaitable<infer TPlugin extends RequestPlugin>
      ? ApplyRequestPlugin<TFirst, TPlugin>
      : Current<TFirst>,
  Platform<TFirst>
>
