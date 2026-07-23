// `lib` in tsconfig is ES2022; Promise.withResolvers is ES2024 but runs fine
// on the Chromium/Node versions this app ships on. One shared ambient
// augmentation (needs `export {}` to make this a module — `declare global`
// is a no-op/incorrect in a non-module .d.ts) instead of bumping the whole
// renderer's lib target or redeclaring this per call site.
export {};

declare global {
  interface PromiseConstructor {
    withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void };
  }
}
