import type { Any } from 'radashi'

export type Eval<T> = {} & { [K in keyof T]: T[K] extends infer U ? U : never }

export type Awaitable<T> = T | Promise<T>

export type OneOrMany<T> = T | readonly T[]

/**
 * Converts a type `T` to something that can be intersected with an object.
 */
export type Intersectable<T extends object> = [T] extends [never]
  ? {}
  : [T] extends [Any]
    ? Record<PropertyKey, any>
    : T
