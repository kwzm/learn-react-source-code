/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  needsStateRestore,
  restoreStateIfNeeded,
} from './ReactControlledComponent';

// Used as a way to call batchedUpdates when we don't have a reference to
// the renderer. Such as when we're dispatching events or if third party
// libraries need to call batchedUpdates. Eventually, this API will go away when
// everything is batched by default. We'll then have a similar API to opt-out of
// scheduled work and instead do synchronous work.
//当我们没有渲染器的引用时，用来调用batchedUpdates。
// 例如，当我们调度事件时，或者第三方库需要调用batchedupdate时。
// 最终，这个API将在默认情况下批量处理所有内容时消失。
// 然后，我们将有一个类似的API来选择不执行计划的工作，而是执行同步工作。

// Defaults
let batchedUpdatesImpl = function (fn, bookkeeping) {
  return fn(bookkeeping);
};
let discreteUpdatesImpl = function (fn, a, b, c) {
  return fn(a, b, c);
};
let flushDiscreteUpdatesImpl = function () { };
let batchedEventUpdatesImpl = batchedUpdatesImpl;

let isBatching = false;

function batchedUpdatesFinally() {
  // Here we wait until all updates have propagated, which is important
  // when using controlled components within layers:
  // 在这里，我们一直等到所有的更新都被传播，这是很重要的，当使用控制组件层:
  // https://github.com/facebook/react/issues/1698
  // Then we restore state of any controlled component.
  // 然后我们恢复任何受控组件的状态。
  isBatching = false;
  const controlledComponentsHavePendingUpdates = needsStateRestore();
  if (controlledComponentsHavePendingUpdates) {
    // If a controlled event was fired, we may need to restore the state of
    // the DOM node back to the controlled value. This is necessary when React
    // bails out of the update without touching the DOM.
    // 如果触发了受控事件，我们可能需要将DOM节点的状态恢复到受控值。
    // 当React在不触及DOM的情况下退出更新时，这是必要的。
    flushDiscreteUpdatesImpl();
    restoreStateIfNeeded();
  }
}

export function batchedUpdates(fn, bookkeeping) {
  if (isBatching) {
    // If we are currently inside another batch, we need to wait until it
    // fully completes before restoring state.
    return fn(bookkeeping);
  }
  isBatching = true;
  try {
    return batchedUpdatesImpl(fn, bookkeeping);
  } finally {
    batchedUpdatesFinally();
  }
}

export function batchedEventUpdates(fn, bookkeeping) {
  if (isBatching) {
    // If we are currently inside another batch, we need to wait until it
    // fully completes before restoring state.
    // 如果我们当前在另一个批处理中，我们需要等待它完全完成后才能恢复状态。
    return fn(bookkeeping);
  }
  isBatching = true;
  try {
    return batchedEventUpdatesImpl(fn, bookkeeping);
  } finally {
    batchedUpdatesFinally();
  }
}

export function discreteUpdates(fn, a, b, c) {
  return discreteUpdatesImpl(fn, a, b, c);
}

export function flushDiscreteUpdates() {
  return flushDiscreteUpdatesImpl();
}

export function setBatchingImplementation(
  _batchedUpdatesImpl,
  _discreteUpdatesImpl,
  _flushDiscreteUpdatesImpl,
  _batchedEventUpdatesImpl,
) {
  batchedUpdatesImpl = _batchedUpdatesImpl;
  discreteUpdatesImpl = _discreteUpdatesImpl;
  flushDiscreteUpdatesImpl = _flushDiscreteUpdatesImpl;
  batchedEventUpdatesImpl = _batchedEventUpdatesImpl;
}
