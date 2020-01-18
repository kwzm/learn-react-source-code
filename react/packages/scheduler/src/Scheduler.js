/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import { enableSchedulerDebugging } from './SchedulerFeatureFlags';
import {
  requestHostCallback,
  cancelHostCallback,
  shouldYieldToHost,
  getCurrentTime,
  forceFrameRate,
} from './SchedulerHostConfig';

// TODO: Use symbols?
var ImmediatePriority = 1;
var UserBlockingPriority = 2;
var NormalPriority = 3;
var LowPriority = 4;
var IdlePriority = 5;

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY = maxSigned31BitInt;

// Callbacks are stored as a circular, doubly linked list.
var firstCallbackNode = null;

var currentHostCallbackDidTimeout = false;
// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentPriorityLevel = NormalPriority;
var currentEventStartTime = -1;
var currentExpirationTime = -1;

// This is set while performing work, to prevent re-entrancy.
var isPerformingWork = false;

var isHostCallbackScheduled = false;

function scheduleHostCallbackIfNeeded() {
  if (isPerformingWork) {
    // Don't schedule work yet; wait until the next time we yield.
    // 先不要安排工作;等到下次我们让步的时候。
    return;
  }
  if (firstCallbackNode !== null) {
    // Schedule the host callback using the earliest expiration in the list.
    // 使用列表中最早的到期时间来调度主机回调。
    var expirationTime = firstCallbackNode.expirationTime;
    if (isHostCallbackScheduled) {
      // Cancel the existing host callback.
      // 取消现有的主机回调。
      cancelHostCallback();
    } else {
      isHostCallbackScheduled = true;
    }
    requestHostCallback(flushWork, expirationTime);
  }
}

function flushFirstCallback() {
  const currentlyFlushingCallback = firstCallbackNode;

  // Remove the node from the list before calling the callback. That way the
  // list is in a consistent state even if the callback throws.
  // 在调用回调之前从列表中删除节点。
  // 这样，即使回调抛出，列表也处于一致的状态。
  var next = firstCallbackNode.next;
  if (firstCallbackNode === next) {
    // This is the last callback in the list.
    // 这是列表中的最后一个回调。
    firstCallbackNode = null;
    next = null;
  } else {
    var lastCallbackNode = firstCallbackNode.previous;
    firstCallbackNode = lastCallbackNode.next = next;
    next.previous = lastCallbackNode;
  }

  currentlyFlushingCallback.next = currentlyFlushingCallback.previous = null;

  // Now it's safe to call the callback.
  var callback = currentlyFlushingCallback.callback;
  var expirationTime = currentlyFlushingCallback.expirationTime;
  var priorityLevel = currentlyFlushingCallback.priorityLevel;
  var previousPriorityLevel = currentPriorityLevel;
  var previousExpirationTime = currentExpirationTime;
  currentPriorityLevel = priorityLevel;
  currentExpirationTime = expirationTime;
  var continuationCallback;
  try {
    const didUserCallbackTimeout =
      currentHostCallbackDidTimeout ||
      // Immediate priority callbacks are always called as if they timed out
      // 立即优先级回调总是像超时一样被调用
      priorityLevel === ImmediatePriority;
    continuationCallback = callback(didUserCallbackTimeout);
  } catch (error) {
    throw error;
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    currentExpirationTime = previousExpirationTime;
  }

  // A callback may return a continuation. The continuation should be scheduled
  // with the same priority and expiration as the just-finished callback.
  // 回调可以返回一个延续。
  // 延续应该与刚刚完成的回调具有相同的优先级和过期时间。
  if (typeof continuationCallback === 'function') {
    var continuationNode: CallbackNode = {
      callback: continuationCallback,
      priorityLevel,
      expirationTime,
      next: null,
      previous: null,
    };

    // Insert the new callback into the list, sorted by its expiration. This is
    // almost the same as the code in `scheduleCallback`, except the callback
    // is inserted into the list *before* callbacks of equal expiration instead
    // of after.
    // 将新的回调函数插入到列表中，根据它的到期时间排序。
    // 这与' scheduleCallback '中的代码几乎相同，只不过回调是插入到列表*before* callbacks中而不是后面。
    if (firstCallbackNode === null) {
      // This is the first callback in the list.
      // 这是列表中的第一个回调。
      firstCallbackNode = continuationNode.next = continuationNode.previous = continuationNode;
    } else {
      var nextAfterContinuation = null;
      var node = firstCallbackNode;
      do {
        if (node.expirationTime >= expirationTime) {
          // This callback expires at or after the continuation. We will insert
          // the continuation *before* this callback.
          // 这个回调在延续时或之后过期。
          // 我们将在这个回调之前插入延续*。
          nextAfterContinuation = node;
          break;
        }
        node = node.next;
      } while (node !== firstCallbackNode);

      if (nextAfterContinuation === null) {
        // No equal or lower priority callback was found, which means the new
        // callback is the lowest priority callback in the list.
        // 没有找到同等或较低优先级的回调，这意味着新的回调是列表中优先级最低的回调。
        nextAfterContinuation = firstCallbackNode;
      } else if (nextAfterContinuation === firstCallbackNode) {
        // The new callback is the highest priority callback in the list.
        // 新的回调是列表中优先级最高的回调。
        firstCallbackNode = continuationNode;
        scheduleHostCallbackIfNeeded();
      }

      var previous = nextAfterContinuation.previous;
      previous.next = nextAfterContinuation.previous = continuationNode;
      continuationNode.next = nextAfterContinuation;
      continuationNode.previous = previous;
    }
  }
}

function flushWork(didUserCallbackTimeout) {
  // Exit right away if we're currently paused
  // 如果我们当前暂停，立即退出
  if (enableSchedulerDebugging && isSchedulerPaused) {
    return;
  }

  // We'll need a new host callback the next time work is scheduled.
  // 我们需要一个新的 host callback 在下一次执行时调度。
  isHostCallbackScheduled = false;

  isPerformingWork = true;
  const previousDidTimeout = currentHostCallbackDidTimeout;
  currentHostCallbackDidTimeout = didUserCallbackTimeout;
  try {
    if (didUserCallbackTimeout) {
      // Flush all the expired callbacks without yielding.
      // 刷新所有过期的回调而不中断。
      while (
        firstCallbackNode !== null &&
        !(enableSchedulerDebugging && isSchedulerPaused)
      ) {
        // TODO Wrap in feature flag
        // Read the current time. Flush all the callbacks that expire at or
        // earlier than that time. Then read the current time again and repeat.
        // This optimizes for as few performance.now calls as possible.
        // TODO包装在功能标志读取当前时间。
        // 刷新在那个时间点或之前过期的所有回调。
        // 然后再读一遍当前时间并重复。
        // 这是为了更少 performance.now 调用的尽可能的优化
        var currentTime = getCurrentTime();
        if (firstCallbackNode.expirationTime <= currentTime) {
          do {
            flushFirstCallback();
          } while (
            firstCallbackNode !== null &&
            firstCallbackNode.expirationTime <= currentTime &&
            !(enableSchedulerDebugging && isSchedulerPaused)
          );
          continue;
        }
        break;
      }
    } else {
      // Keep flushing callbacks until we run out of time in the frame.
      // 一直刷新回调，直到帧中的时间用完。
      if (firstCallbackNode !== null) {
        do {
          if (enableSchedulerDebugging && isSchedulerPaused) {
            break;
          }
          flushFirstCallback();
        } while (firstCallbackNode !== null && !shouldYieldToHost());
      }
    }
  } finally {
    isPerformingWork = false;
    currentHostCallbackDidTimeout = previousDidTimeout;
    // There's still work remaining. Request another callback.
    // 还有工作要做。请求另一个回调。
    scheduleHostCallbackIfNeeded();
  }
}

function unstable_runWithPriority(priorityLevel, eventHandler) {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  var previousEventStartTime = currentEventStartTime;
  currentPriorityLevel = priorityLevel;
  currentEventStartTime = getCurrentTime();

  try {
    return eventHandler();
  } catch (error) {
    // There's still work remaining. Request another callback.
    scheduleHostCallbackIfNeeded();
    throw error;
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    currentEventStartTime = previousEventStartTime;
  }
}

function unstable_next(eventHandler) {
  let priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  var previousEventStartTime = currentEventStartTime;
  currentPriorityLevel = priorityLevel;
  currentEventStartTime = getCurrentTime();

  try {
    return eventHandler();
  } catch (error) {
    // There's still work remaining. Request another callback.
    scheduleHostCallbackIfNeeded();
    throw error;
  } finally {
    currentPriorityLevel = previousPriorityLevel;
    currentEventStartTime = previousEventStartTime;
  }
}

function unstable_wrapCallback(callback) {
  var parentPriorityLevel = currentPriorityLevel;
  return function () {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    var previousEventStartTime = currentEventStartTime;
    currentPriorityLevel = parentPriorityLevel;
    currentEventStartTime = getCurrentTime();

    try {
      return callback.apply(this, arguments);
    } catch (error) {
      // There's still work remaining. Request another callback.
      scheduleHostCallbackIfNeeded();
      throw error;
    } finally {
      currentPriorityLevel = previousPriorityLevel;
      currentEventStartTime = previousEventStartTime;
    }
  };
}

function unstable_scheduleCallback(
  priorityLevel,
  callback,
  deprecated_options,
) {
  var startTime =
    currentEventStartTime !== -1 ? currentEventStartTime : getCurrentTime();

  var expirationTime;
  if (
    typeof deprecated_options === 'object' &&
    deprecated_options !== null &&
    typeof deprecated_options.timeout === 'number'
  ) {
    // FIXME: Remove this branch once we lift expiration times out of React.
    expirationTime = startTime + deprecated_options.timeout;
  } else {
    switch (priorityLevel) {
      case ImmediatePriority:
        expirationTime = startTime + IMMEDIATE_PRIORITY_TIMEOUT;
        break;
      case UserBlockingPriority:
        expirationTime = startTime + USER_BLOCKING_PRIORITY;
        break;
      case IdlePriority:
        expirationTime = startTime + IDLE_PRIORITY;
        break;
      case LowPriority:
        expirationTime = startTime + LOW_PRIORITY_TIMEOUT;
        break;
      case NormalPriority:
      default:
        expirationTime = startTime + NORMAL_PRIORITY_TIMEOUT;
    }
  }

  var newNode = {
    callback,
    priorityLevel: priorityLevel,
    expirationTime,
    next: null,
    previous: null,
  };

  // Insert the new callback into the list, ordered first by expiration, then
  // by insertion. So the new callback is inserted after any other callback
  // with equal expiration.
  // 将新的回调函数插入到列表中，按过期顺序排序，然后按插入顺序排序。
  // 因此，新的回调被插入到任何其他具有相同到期时间的回调之后。
  if (firstCallbackNode === null) {
    // This is the first callback in the list.
    // 这是列表中的第一个回调。
    firstCallbackNode = newNode.next = newNode.previous = newNode;
    scheduleHostCallbackIfNeeded();
  } else {
    var next = null;
    var node = firstCallbackNode;
    do {
      if (node.expirationTime > expirationTime) {
        // The new callback expires before this one.
        next = node;
        break;
      }
      node = node.next;
    } while (node !== firstCallbackNode);

    if (next === null) {
      // No callback with a later expiration was found, which means the new
      // callback has the latest expiration in the list.
      // 没有找到过期时间较晚的回调，这意味着新回调在列表中拥有最新的过期时间。
      next = firstCallbackNode;
    } else if (next === firstCallbackNode) {
      // The new callback has the earliest expiration in the entire list.
      // 新的回调在整个列表中有最早的到期时间。
      firstCallbackNode = newNode;
      scheduleHostCallbackIfNeeded();
    }

    var previous = next.previous;
    previous.next = next.previous = newNode;
    newNode.next = next;
    newNode.previous = previous;
  }

  return newNode;
}

function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (firstCallbackNode !== null) {
    scheduleHostCallbackIfNeeded();
  }
}

function unstable_getFirstCallbackNode() {
  return firstCallbackNode;
}

function unstable_cancelCallback(callbackNode) {
  var next = callbackNode.next;
  if (next === null) {
    // Already cancelled.
    return;
  }

  if (next === callbackNode) {
    // This is the only scheduled callback. Clear the list.
    firstCallbackNode = null;
  } else {
    // Remove the callback from its position in the list.
    if (callbackNode === firstCallbackNode) {
      firstCallbackNode = next;
    }
    var previous = callbackNode.previous;
    previous.next = next;
    next.previous = previous;
  }

  callbackNode.next = callbackNode.previous = null;
}

function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

function unstable_shouldYield() {
  return (
    !currentHostCallbackDidTimeout &&
    ((firstCallbackNode !== null &&
      firstCallbackNode.expirationTime < currentExpirationTime) ||
      shouldYieldToHost())
  );
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  unstable_shouldYield,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};
