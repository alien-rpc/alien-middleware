import type { AdapterRequestContext, HattipHandler } from '@hattip/core'
import { Any } from 'radashi'
import type { MiddlewareChain } from './index.ts'

type RequestEnvPlugin = {
  /**
   * Add type-safe environment variables. These are accessed with the `env()`
   * method on the request context.
   */
  env?: object
}

/**
 * The object returned by a request middleware that is merged into the request
 * context. The same context property cannot be defined by two different
 * plugins, or an error will be thrown at runtime.
 *
 * May contain special properties:
 * - `env`: Add type-safe environment variables.
 */
export type RequestPlugin = Record<string, unknown> & RequestEnvPlugin

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

/**
 * An extensible Hattip context object.
 *
 * NOTE: When using this type on the right side of an `extends` clause, you
 * should prefer `RequestContext<any>` over `RequestContext` (no type
 * parameters), as the default type is stricter.
 */
export type RequestContext<
  TProperties extends object = never,
  TEnv extends object = any,
  TPlatform = any,
> = HattipContext<TPlatform, TEnv> & Intersectable<TProperties>

/**
 * Extract a `RequestContext` type from a `MiddlewareChain` type.
 *
 * When type `T` is `never`, a default context is returned.
 */
export type MiddlewareContext<T extends MiddlewareChain> = [T] extends [never]
  ? RequestContext<{}, {}, unknown>
  : RequestContext<Properties<T>, Env<T>, Platform<T>>

export type IsolatedContext<T extends MiddlewareChain> = RequestContext<
  InputProperties<T>,
  InputEnv<T>,
  Platform<T>
>

type Awaitable<T> = T | Promise<T>

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

/**
 * Extract a `Middleware` type from a `MiddlewareChain` type.
 */
export type ExtractMiddleware<T extends MiddlewareChain> = Middleware<
  Properties<T>,
  Env<T>,
  Platform<T>
>

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
  properties: Merge<Properties<TParent>, Omit<TPlugin, keyof RequestEnvPlugin>>
  env: Merge<Env<TParent>, TPlugin['env']>
}

/**
 * This applies a middleware to a chain. If the type `TMiddleware` is itself a
 * chain, it's treated as a nested chain, which won't leak its plugins into the
 * parent chain.
 */
export type ApplyMiddleware<
  TFirst extends MiddlewareChain,
  TSecond extends Middleware<Properties<TFirst>, Env<TFirst>, Platform<TFirst>>,
> = RequestHandler<
  Inputs<TFirst>,
  TSecond extends MiddlewareChain
    ? {
        properties: Merge<Properties<TFirst>, Properties<TSecond>>
        env: Merge<Env<TFirst>, Env<TSecond>>
      }
    : TSecond extends () => Awaitable<infer TResult>
      ? TResult extends RequestPlugin
        ? ApplyRequestPlugin<TFirst, TResult>
        : Current<TFirst>
      : Current<TFirst>,
  Platform<TFirst>
>

export type EmptyMiddlewareChain = MiddlewareChain<
  { properties: {}; env: {} },
  { properties: {}; env: {} },
  unknown
>

export type ApplyFirstMiddleware<T extends Middleware> =
  T extends MiddlewareChain ? T : ApplyMiddleware<EmptyMiddlewareChain, T>

export type RouteMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'OPTIONS'
  | 'HEAD'

export type RouterContext<
  T extends MiddlewareChain = any,
  TPathParams extends object = any,
  TMethod extends RouteMethod = RouteMethod,
> = MiddlewareContext<T> & { params: TPathParams; method: TMethod }

export type RouteHandler<
  T extends MiddlewareChain = any,
  TPathParams extends object = any,
  TMethod extends RouteMethod = RouteMethod,
> = (
  context: RouterContext<T, TPathParams, TMethod>
) => Awaitable<Response | void>
