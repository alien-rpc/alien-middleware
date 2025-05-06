import type { AdapterRequestContext, HattipHandler } from '@hattip/core'
import { InferParams } from 'pathic'
import type { MiddlewareChain } from './index.ts'
import { Awaitable, CastNever, Eval, OneOrMany } from './types/common.ts'
import { Merge } from './types/merge.ts'

type ReservedProperties = {
  /**
   * Add type-safe environment variables. These are accessed with the `env()`
   * method on the request context.
   */
  env?: object
  /**
   * Intercept the response before it's sent to the client.
   */
  onResponse?: ResponseCallback
}

/**
 * The object returned by a request middleware that is merged into the request
 * context. The same context property cannot be defined by two different
 * plugins, or an error will be thrown at runtime.
 *
 * May contain special properties:
 * - `env`: Add type-safe environment variables.
 */
export type RequestPlugin = Record<string, unknown> & ReservedProperties

export type MiddlewareTypes = {
  /** Values expected by the start of the chain. */
  initial: {
    env: object
    properties: object
  }
  /** Values provided by the end of the chain. */
  current: {
    env: object
    properties: object
  }
  /** Values from the host platform. */
  platform: unknown
}

type AnyMiddlewareTypes = {
  initial: { env: any; properties: any }
  current: { env: any; properties: any }
  platform: any
}

type AnyMiddlewareChain = MiddlewareChain<AnyMiddlewareTypes>

type Inputs<T extends AnyMiddlewareChain> = T['$MiddlewareChain']['initial']
type InputProperties<T extends AnyMiddlewareChain> = Inputs<T>['properties']
type InputEnv<T extends AnyMiddlewareChain> = Inputs<T>['env']

type Current<T extends AnyMiddlewareChain> = T['$MiddlewareChain']['current']
type Properties<T extends AnyMiddlewareChain> = Current<T>['properties']
type Env<T extends AnyMiddlewareChain> = Current<T>['env']

type Platform<T extends AnyMiddlewareChain> = T['$MiddlewareChain']['platform']

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

  /**
   * Add a callback to be called when a response is generated.
   */
  onResponse(callback: ResponseCallback): void
}

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
> = HattipContext<TPlatform, TEnv> & CastNever<TProperties, unknown>

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

export type RequestMiddleware<T extends MiddlewareChain = MiddlewareChain> = (
  context: RequestContext<InputProperties<T>, InputEnv<T>, Platform<T>>
) => Awaitable<Response | RequestPlugin | void>

export type ResponseCallback = (
  response: Response
) => Awaitable<Response | void>

export interface RequestHandler<T extends MiddlewareTypes = any>
  extends HattipHandler<T['platform']>,
    MiddlewareChain<T> {}

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
> = {
  (
    context: RequestContext<TEnv, TProperties, TPlatform>
  ): Awaitable<Response | RequestPlugin | void>

  /** This property won't exist at runtime. It contains type information for inference purposes. */
  $Middleware?: MiddlewareTypes & {
    initial: { env: TEnv; properties: TProperties }
  }
}

/**
 * Extract a `Middleware` type from a `MiddlewareChain` type.
 */
export type ExtractMiddleware<T extends MiddlewareChain> = [T] extends [never]
  ? Middleware<{}, {}, any>
  : Middleware<Env<T>, Properties<T>, Platform<T>>

/**
 * Merge a request plugin into a middleware chain.
 */
type ApplyMiddlewareResult<TParent extends MiddlewareChain, TResult> = Eval<{
  env: Merge<
    Env<TParent>,
    TResult extends { env: infer TEnv extends object | undefined }
      ? TEnv
      : undefined
  >
  properties: Merge<
    Properties<TParent>,
    TResult extends RequestPlugin
      ? Omit<TResult, keyof ReservedProperties>
      : undefined
  >
}>

type ApplyMiddlewareOutputs<
  TFirst extends MiddlewareChain,
  TSecond extends Middleware,
> = TSecond extends MiddlewareChain
  ? {
      env: Merge<Env<TFirst>, Env<TSecond>>
      properties: Merge<Properties<TFirst>, Properties<TSecond>>
    }
  : TSecond extends (...args: any[]) => Awaitable<infer TResult>
    ? ApplyMiddlewareResult<TFirst, TResult>
    : Current<TFirst>

type MiddlewareInputs<T extends Middleware> =
  T extends Middleware<infer TEnv, infer TProperties>
    ? { env: TEnv; properties: TProperties }
    : never

type MiddlewarePlatform<T extends Middleware> =
  T extends Middleware<any, any, infer TPlatform> ? TPlatform : never

/**
 * This applies a middleware to a chain. If the type `TMiddleware` is itself a
 * chain, it's treated as a nested chain, which won't leak its plugins into the
 * parent chain.
 *
 * The `TFirst` type is allowed to be `never`, which results in the middleware's
 * output types being used as the request handler's input types.
 */
export type ApplyMiddleware<
  TFirst extends MiddlewareChain,
  TSecond extends Middleware,
> =
  ApplyMiddlewareOutputs<TFirst, TSecond> extends infer TCurrent extends
    MiddlewareTypes['current']
    ? RequestHandler<{
        initial: CastNever<Inputs<TFirst>, MiddlewareInputs<TSecond>>
        current: TCurrent
        platform: CastNever<Platform<TFirst>, MiddlewarePlatform<TSecond>>
      }>
    : never

/**
 * Apply a list of middlewares to an empty middleware chain.
 */
export type ApplyMiddlewares<T extends Middleware[]> = T extends [
  ...infer TRest extends Middleware[],
  infer TLast extends Middleware,
]
  ? ApplyMiddleware<ApplyMiddlewares<TRest>, TLast>
  : ApplyFirstMiddleware<T[0]>

export type EmptyMiddlewareChain<TPlatform = unknown> = MiddlewareChain<{
  initial: { env: {}; properties: {} }
  current: { env: {}; properties: {} }
  platform: TPlatform
}>

export type ApplyFirstMiddleware<T extends Middleware> =
  T extends MiddlewareChain
    ? T
    : ApplyMiddleware<EmptyMiddlewareChain<MiddlewarePlatform<T>>, T>

export type RouteMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'OPTIONS'
  | 'HEAD'
  | (string & {})

export type RouteContext<
  T extends RouterTypes = any,
  TPathParams extends object = any,
  TMethod extends RouteMethod = RouteMethod,
> = MiddlewareContext<
  ApplyMiddleware<
    MiddlewareChain<T['$Router']>,
    () => { params: TPathParams; method: TMethod }
  >
>

export type RouteHandler<
  T extends RouterTypes = any,
  TPathParams extends object = any,
  TMethod extends RouteMethod = RouteMethod,
> = (
  context: RouteContext<T, TPathParams, TMethod>
) => Awaitable<Response | void>

export declare class RouterTypes<
  T extends MiddlewareChain = any,
> extends Function {
  /** This property won't exist at runtime. It contains type information for inference purposes. */
  declare $Router: T['$MiddlewareChain']
}

export interface Router<T extends MiddlewareChain = any>
  extends RouterTypes<T> {
  (context: AdapterRequestContext<Platform<T>>): Awaitable<void | Response>

  use<TPath extends string>(
    path: TPath,
    handler: RouteHandler<this, InferParams<TPath>>
  ): Router
  use<TPath extends string, TMethod extends RouteMethod = RouteMethod>(
    method: OneOrMany<TMethod> | '*',
    path: TPath,
    handler: RouteHandler<this, InferParams<TPath>, TMethod>
  ): Router
}
