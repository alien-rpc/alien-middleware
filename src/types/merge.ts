import { Eval } from './common'

type Keys<T> = T extends any ? keyof T : never

type IsOptional<T, K> = K extends keyof T
  ? T[K] extends Required<T>[K]
    ? false
    : true
  : true

type PossiblyUndefined<T, K extends keyof T> = undefined extends Required<T>[K]
  ? true
  : false

type MergeProperty<TSource, TOverrides, K> =
  | (K extends keyof TOverrides
      ? PossiblyUndefined<TOverrides, K> extends true
        ? TOverrides[K]
        : Exclude<TOverrides[K], undefined>
      : never)
  | (IsOptional<TOverrides, K> extends true
      ? K extends keyof TSource
        ? TSource[K]
        : undefined
      : never) extends infer TProperty
  ? TProperty
  : never

/**
 * Merge a union of object types (possibly undefined) into a single object type.
 *
 * **FIXME:** Optional properties resolve as `foo: Foo | undefined` instead of `foo?: Foo`.
 */
export type Merge<
  TSource extends object,
  TOverrides extends object | undefined,
> = Eval<
  Omit<TSource, Keys<TOverrides>> & {
    [K in Keys<TOverrides>]: TOverrides extends any
      ? MergeProperty<TSource, TOverrides, K>
      : never
  }
>
