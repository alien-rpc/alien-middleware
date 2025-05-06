import type { Merge } from '../../src/types/merge.ts'

describe('Merge<TSource, TOverrides>', () => {
  test('override with optional property', () => {
    type Result = Merge<{ a: 1 }, { a?: 2 }>
    expectTypeOf<Result>().toEqualTypeOf<{ a: 1 | 2 }>()
  })
  test('override with undefined property', () => {
    type Result = Merge<{ a: 1 }, { a: 2 | undefined }>
    expectTypeOf<Result>().toEqualTypeOf<{ a: 2 | undefined }>()
  })
  test('add a new property', () => {
    type Result = Merge<{ a: 1 }, { b: 2 }>
    expectTypeOf<Result>().toEqualTypeOf<{ a: 1; b: 2 }>()
  })
  test('override with a union', () => {
    type Result1 = Merge<{ a: 1 }, { a: 2 } | { a: 3 }>
    expectTypeOf<Result1>().toEqualTypeOf<{ a: 2 | 3 }>()

    type Result2 = Merge<{ a: 1 }, { a: 2 } | { b: 3 }>
    expectTypeOf<Result2>().toEqualTypeOf<{ a: 1 | 2; b: 3 | undefined }>()
  })
})
