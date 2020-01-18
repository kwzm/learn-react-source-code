/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { Fiber } from './ReactFiber';

import { getStackByFiberInDevAndProd } from './ReactCurrentFiber';

export type CapturedValue<T> = {
  value: T,
  source: Fiber | null,
  stack: string | null,
};

export type CapturedError = {
  componentName: ?string,
  componentStack: string,
  error: mixed,
  errorBoundary: ?Object,
  errorBoundaryFound: boolean,
  errorBoundaryName: string | null,
  willRetry: boolean,
};

export function createCapturedValue<T>(
  value: T,
  source: Fiber,
): CapturedValue<T> {
  // If the value is an error, call this function immediately after it is thrown
  // so the stack is accurate.
  // 如果该值是一个错误，则在抛出该函数后立即调用该函数，以便堆栈是准确的。
  return {
    value,
    source,
    stack: getStackByFiberInDevAndProd(source),
  };
}
