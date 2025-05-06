import type { AdapterRequestContext, HattipHandler } from '@hattip/core'
import { Any } from 'radashi'
import type { MiddlewareChain } from './index.ts'
import { Merge } from './types/merge.ts'

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
  TEnv extends object = any,
  TProperties extends object = any,
> = {
  env: TEnv
  properties: TProperties
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

  /**
   * Set a response header from a request middleware.
   *
   * Response middlewares should use `response.headers.set()` instead.
   */
  setHeader(name: string, value: string): void
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
  TEnv extends object = any,
  TProperties extends object = never,
  TPlatform = any,
> = HattipContext<TPlatform, TEnv> & Intersectable<TProperties>

/**
 * Extract a `RequestContext` type from a `MiddlewareChain` type.
 *
 * When type `T` is `never`, a default context is returned.
 */
export type MiddlewareContext<T extends MiddlewareChain> = [T] extends [never]
  ? RequestContext<{}, never, unknown>
  : RequestContext<Env<T>, Properties<T>, Platform<T>>

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
  TEnv extends object = any,
  TProperties extends object = any,
  TPlatform = any,
> = (
  context: RequestContext<TEnv, TProperties, TPlatform>,
  response: Response
) => Awaitable<Response | RequestPlugin | void>

/**
 * Extract a `Middleware` type from a `MiddlewareChain` type.
 */
export type ExtractMiddleware<T extends MiddlewareChain> = Middleware<
  Env<T>,
  Properties<T>,
  Platform<T>
>

/**
 * Merge a request plugin into a middleware chain.
 */
type ApplyMiddlewareResult<
  TParent extends MiddlewareChain,
  TResult,
> = {} & MiddlewareTypes<
  Merge<
    Env<TParent>,
    TResult extends { env: infer TEnv extends object | undefined }
      ? TEnv
      : undefined
  >,
  Merge<
    Properties<TParent>,
    TResult extends RequestPlugin
      ? Omit<TResult, keyof RequestEnvPlugin>
      : undefined
  >
>

/**
 * This applies a middleware to a chain. If the type `TMiddleware` is itself a
 * chain, it's treated as a nested chain, which won't leak its plugins into the
 * parent chain.
 */
export type ApplyMiddleware<
  TFirst extends MiddlewareChain,
  TSecond extends Middleware<Env<TFirst>, Properties<TFirst>, Platform<TFirst>>,
> = RequestHandler<
  Inputs<TFirst>,
  TSecond extends MiddlewareChain
    ? MiddlewareTypes<
        Merge<Env<TFirst>, Env<TSecond>>,
        Merge<Properties<TFirst>, Properties<TSecond>>
      >
    : TSecond extends (...args: any[]) => Awaitable<infer TResult>
      ? ApplyMiddlewareResult<TFirst, TResult>
      : Current<TFirst>,
  Platform<TFirst>
>

export type EmptyMiddlewareChain = MiddlewareChain<
  MiddlewareTypes<{}, {}>,
  MiddlewareTypes<{}, {}>,
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
