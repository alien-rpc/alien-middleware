export type Eval<T> = {} & { [K in keyof T]: T[K] extends infer U ? U : never }

export type Awaitable<T> = T | Promise<T>

export type OneOrMany<T> = T | readonly T[]

export type CastNever<T, U> = [T] extends [never] ? U : T
