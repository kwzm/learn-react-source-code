/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Intentionally not named imports because Rollup would use dynamic dispatch for
// CommonJS interop named imports.
import * as Scheduler from 'scheduler';
import { __interactionsRef } from 'scheduler/tracing';
import {
  disableYielding,
  enableSchedulerTracing,
} from 'shared/ReactFeatureFlags';
import invariant from 'shared/invariant';

const {
  unstable_runWithPriority: Scheduler_runWithPriority,
  unstable_scheduleCallback: Scheduler_scheduleCallback,
  unstable_cancelCallback: Scheduler_cancelCallback,
  unstable_shouldYield: Scheduler_shouldYield,
  unstable_now: Scheduler_now,
  unstable_getCurrentPriorityLevel: Scheduler_getCurrentPriorityLevel,
  unstable_ImmediatePriority: Scheduler_ImmediatePriority,
  unstable_UserBlockingPriority: Scheduler_UserBlockingPriority,
  unstable_NormalPriority: Scheduler_NormalPriority,
  unstable_LowPriority: Scheduler_LowPriority,
  unstable_IdlePriority: Scheduler_IdlePriority,
} = Scheduler;

if (enableSchedulerTracing) {
  // Provide explicit error message when production+profiling bundle of e.g.
  // react-dom is used with production (non-profiling) bundle of
  // scheduler/tracing
  invariant(
    __interactionsRef != null && __interactionsRef.current != null,
    'It is not supported to run the profiling version of a renderer (for ' +
    'example, `react-dom/profiling`) without also replacing the ' +
    '`scheduler/tracing` module with `scheduler/tracing-profiling`. Your ' +
    'bundler might have a setting for aliasing both modules. Learn more at ' +
    'http://fb.me/react-profiling',
  );
}

export opaque type ReactPriorityLevel = 99 | 98 | 97 | 96 | 95 | 90;
export type SchedulerCallback = (isSync: boolean) => SchedulerCallback | null;

type SchedulerCallbackOptions = {
  timeout?: number,
};

const fakeCallbackNode = {};

// Except for NoPriority, these correspond to Scheduler priorities. We use
// ascending numbers so we can compare them like numbers. They start at 90 to
// avoid clashing with Scheduler's priorities.
// 除了NoPriority之外，这些都对应于调度器优先级。
// 我们使用升序数字，这样我们可以像比较数字一样比较它们。
// 它们从90开始，以避免与调度程序的优先级冲突。
export const ImmediatePriority: ReactPriorityLevel = 99;
export const UserBlockingPriority: ReactPriorityLevel = 98;
export const NormalPriority: ReactPriorityLevel = 97;
export const LowPriority: ReactPriorityLevel = 96;
export const IdlePriority: ReactPriorityLevel = 95;
// NoPriority is the absence of priority. Also React-only.
export const NoPriority: ReactPriorityLevel = 90;

export const shouldYield = disableYielding
  ? () => false // Never yield when `disableYielding` is on
  : Scheduler_shouldYield;

let syncQueue: Array<SchedulerCallback> | null = null;
let immediateQueueCallbackNode: mixed | null = null;
let isFlushingSyncQueue: boolean = false;
let initialTimeMs: number = Scheduler_now();

// If the initial timestamp is reasonably small, use Scheduler's `now` directly.
// This will be the case for modern browsers that support `performance.now`. In
// older browsers, Scheduler falls back to `Date.now`, which returns a Unix
// timestamp. In that case, subtract the module initialization time to simulate
// the behavior of performance.now and keep our times small enough to fit
// within 32 bits.
// 如果初始时间戳比较小，直接使用Scheduler's ' now。
// 这就是支持“performance.now”的现代浏览器的情况。
// 在较老的浏览器中，调度器会回到 'Date.now'，它返回一个Unix时间戳。
// 在这种情况下，减去模块初始化时间来模拟性能行为。
// 现在，让我们的时间足够小，以适应32位。
// TODO: Consider lifting this into Scheduler.
export const now =
  initialTimeMs < 10000 ? Scheduler_now : () => Scheduler_now() - initialTimeMs;

export function getCurrentPriorityLevel(): ReactPriorityLevel {
  switch (Scheduler_getCurrentPriorityLevel()) {
    case Scheduler_ImmediatePriority:
      return ImmediatePriority;
    case Scheduler_UserBlockingPriority:
      return UserBlockingPriority;
    case Scheduler_NormalPriority:
      return NormalPriority;
    case Scheduler_LowPriority:
      return LowPriority;
    case Scheduler_IdlePriority:
      return IdlePriority;
    default:
      invariant(false, 'Unknown priority level.');
  }
}

function reactPriorityToSchedulerPriority(reactPriorityLevel) {
  switch (reactPriorityLevel) {
    case ImmediatePriority:
      return Scheduler_ImmediatePriority;
    case UserBlockingPriority:
      return Scheduler_UserBlockingPriority;
    case NormalPriority:
      return Scheduler_NormalPriority;
    case LowPriority:
      return Scheduler_LowPriority;
    case IdlePriority:
      return Scheduler_IdlePriority;
    default:
      invariant(false, 'Unknown priority level.');
  }
}

export function runWithPriority<T>(
  reactPriorityLevel: ReactPriorityLevel,
  fn: () => T,
): T {
  const priorityLevel = reactPriorityToSchedulerPriority(reactPriorityLevel);
  return Scheduler_runWithPriority(priorityLevel, fn);
}

export function scheduleCallback(
  reactPriorityLevel: ReactPriorityLevel,
  callback: SchedulerCallback,
  options: SchedulerCallbackOptions | void | null,
) {
  const priorityLevel = reactPriorityToSchedulerPriority(reactPriorityLevel);
  return Scheduler_scheduleCallback(priorityLevel, callback, options);
}

export function scheduleSyncCallback(callback: SchedulerCallback) {
  // Push this callback into an internal queue. We'll flush these either in
  // the next tick, or earlier if something calls `flushSyncCallbackQueue`.
  // 将这个回调推入一个内部队列。
  // 我们会在下一次刷新，或者更早的时候调用‘flushSyncCallbackQueue’。
  if (syncQueue === null) {
    syncQueue = [callback];
    // Flush the queue in the next tick, at the earliest.
    // 最迟在下一次刷新队列。
    immediateQueueCallbackNode = Scheduler_scheduleCallback(
      Scheduler_ImmediatePriority,
      flushSyncCallbackQueueImpl,
    );
  } else {
    // Push onto existing queue. Don't need to schedule a callback because
    // we already scheduled one when we created the queue.
    // 推入现有队列。
    // 不需要调度回调，因为我们在创建队列时已经调度了回调。
    syncQueue.push(callback);
  }
  return fakeCallbackNode;
}

export function cancelCallback(callbackNode: mixed) {
  if (callbackNode !== fakeCallbackNode) {
    Scheduler_cancelCallback(callbackNode);
  }
}

export function flushSyncCallbackQueue() {
  if (immediateQueueCallbackNode !== null) {
    Scheduler_cancelCallback(immediateQueueCallbackNode);
  }
  flushSyncCallbackQueueImpl();
}

function flushSyncCallbackQueueImpl() {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // Prevent re-entrance.
    // 阻止重复进入
    isFlushingSyncQueue = true;
    let i = 0;
    try {
      const isSync = true;
      for (; i < syncQueue.length; i++) {
        let callback = syncQueue[i];
        do {
          callback = callback(isSync);
        } while (callback !== null);
      }
      syncQueue = null;
    } catch (error) {
      // If something throws, leave the remaining callbacks on the queue.
      // 如果有东西抛出，将剩下的回调留在队列中。
      if (syncQueue !== null) {
        syncQueue = syncQueue.slice(i + 1);
      }
      // Resume flushing in the next tick
      // 在下一个标记中继续刷新
      Scheduler_scheduleCallback(
        Scheduler_ImmediatePriority,
        flushSyncCallbackQueue,
      );
      throw error;
    } finally {
      isFlushingSyncQueue = false;
    }
  }
}
