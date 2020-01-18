/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The DOM Scheduler implementation is similar to requestIdleCallback. It
// works by scheduling a requestAnimationFrame, storing the time for the start
// of the frame, then scheduling a postMessage which gets scheduled after paint.
// Within the postMessage handler do as much work as possible until time + frame
// rate. By separating the idle call into a separate event tick we ensure that
// layout, paint and other browser work is counted against the available time.
// The frame rate is dynamically adjusted.
// DOM调度器实现类似于requestIdleCallback。
// 它的工作方式是调度一个requestAnimationFrame，存储帧开始的时间，然后调度一个postMessage，在绘制之后调度。
// 在postMessage处理程序中完成尽可能多的工作，直到时间+帧速率。
// 通过将空闲调用分离到一个单独的事件标记中，我们可以确保布局、绘制和其他浏览器工作都是根据可用时间计算的。
// 帧速率是动态调整的。

export let requestHostCallback;
export let cancelHostCallback;
export let shouldYieldToHost;
export let getCurrentTime;
export let forceFrameRate;

const hasNativePerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';

// We capture a local reference to any global, in case it gets polyfilled after
// this module is initially evaluated. We want to be using a
// consistent implementation.
const localDate = Date;

// This initialization code may run even on server environments if a component
// just imports ReactDOM (e.g. for findDOMNode). Some environments might not
// have setTimeout or clearTimeout. However, we always expect them to be defined
// on the client. https://github.com/facebook/react/pull/13088
const localSetTimeout =
  typeof setTimeout === 'function' ? setTimeout : undefined;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : undefined;

// We don't expect either of these to necessarily be defined, but we will error
// later if they are missing on the client.
const localRequestAnimationFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : undefined;
const localCancelAnimationFrame =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined;

// requestAnimationFrame does not run when the tab is in the background. If
// we're backgrounded we prefer for that work to happen so that the page
// continues to load in the background. So we also schedule a 'setTimeout' as
// a fallback.
// TODO: Need a better heuristic for backgrounded work.
// 当标签在后台时，requestAnimationFrame不运行。
// 如果我们是后台的，我们更希望工作发生，这样页面继续在后台加载。
// 因此，我们还安排了一个“setTimeout”作为后备。
// TODO:需要一个更好的启发式的背景工作。
const ANIMATION_FRAME_TIMEOUT = 100;
let rAFID;
let rAFTimeoutID;
const requestAnimationFrameWithTimeout = function (callback) {
  // schedule rAF and also a setTimeout
  rAFID = localRequestAnimationFrame(function (timestamp) {
    // cancel the setTimeout
    localClearTimeout(rAFTimeoutID);
    callback(timestamp);
  });
  rAFTimeoutID = localSetTimeout(function () {
    // cancel the requestAnimationFrame
    localCancelAnimationFrame(rAFID);
    callback(getCurrentTime());
  }, ANIMATION_FRAME_TIMEOUT);
};

if (hasNativePerformanceNow) {
  const Performance = performance;
  getCurrentTime = function () {
    return Performance.now();
  };
} else {
  getCurrentTime = function () {
    return localDate.now();
  };
}

if (
  // If Scheduler runs in a non-DOM environment, it falls back to a naive
  // implementation using setTimeout.
  typeof window === 'undefined' ||
  // Check if MessageChannel is supported, too.
  typeof MessageChannel !== 'function'
) {
  // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
  // fallback to a naive implementation.
  let _callback = null;
  const _flushCallback = function (didTimeout) {
    if (_callback !== null) {
      try {
        _callback(didTimeout);
      } finally {
        _callback = null;
      }
    }
  };
  requestHostCallback = function (cb, ms) {
    if (_callback !== null) {
      // Protect against re-entrancy.
      setTimeout(requestHostCallback, 0, cb);
    } else {
      _callback = cb;
      setTimeout(_flushCallback, 0, false);
    }
  };
  cancelHostCallback = function () {
    _callback = null;
  };
  shouldYieldToHost = function () {
    return false;
  };
  forceFrameRate = function () { };
} else {
  if (typeof console !== 'undefined') {
    // TODO: Remove fb.me link
    if (typeof localRequestAnimationFrame !== 'function') {
      console.error(
        "This browser doesn't support requestAnimationFrame. " +
        'Make sure that you load a ' +
        'polyfill in older browsers. https://fb.me/react-polyfills',
      );
    }
    if (typeof localCancelAnimationFrame !== 'function') {
      console.error(
        "This browser doesn't support cancelAnimationFrame. " +
        'Make sure that you load a ' +
        'polyfill in older browsers. https://fb.me/react-polyfills',
      );
    }
  }

  let scheduledHostCallback = null;
  let isMessageEventScheduled = false;
  let timeoutTime = -1;

  let isAnimationFrameScheduled = false;

  let isFlushingHostCallback = false;

  let frameDeadline = 0;
  // We start out assuming that we run at 30fps but then the heuristic tracking
  // will adjust this value to a faster fps if we get more frequent animation
  // frames.
  let previousFrameTime = 33;
  let activeFrameTime = 33;
  let fpsLocked = false;

  shouldYieldToHost = function () {
    return frameDeadline <= getCurrentTime();
  };

  forceFrameRate = function (fps) {
    if (fps < 0 || fps > 125) {
      console.error(
        'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing framerates higher than 125 fps is not unsupported',
      );
      return;
    }
    if (fps > 0) {
      activeFrameTime = Math.floor(1000 / fps);
      fpsLocked = true;
    } else {
      // reset the framerate
      activeFrameTime = 33;
      fpsLocked = false;
    }
  };

  // We use the postMessage trick to defer idle work until after the repaint.
  // 我们使用postMessage技巧将空闲工作延迟到重新绘制之后。
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = function (event) {
    isMessageEventScheduled = false;

    const prevScheduledCallback = scheduledHostCallback;
    const prevTimeoutTime = timeoutTime;
    scheduledHostCallback = null;
    timeoutTime = -1;

    const currentTime = getCurrentTime();

    let didTimeout = false;
    if (frameDeadline - currentTime <= 0) {
      // There's no time left in this idle period. Check if the callback has
      // a timeout and whether it's been exceeded.
      // 在这段空闲时间里没有时间了。
      // 检查回调是否有超时，是否已经超时。
      if (prevTimeoutTime !== -1 && prevTimeoutTime <= currentTime) {
        // Exceeded the timeout. Invoke the callback even though there's no
        // time left.
        // 超时。即使没有时间，也要调用回调。
        didTimeout = true;
      } else {
        // No timeout.
        if (!isAnimationFrameScheduled) {
          // Schedule another animation callback so we retry later.
          isAnimationFrameScheduled = true;
          requestAnimationFrameWithTimeout(animationTick);
        }
        // Exit without invoking the callback.
        // 退出而不调用回调。
        scheduledHostCallback = prevScheduledCallback;
        timeoutTime = prevTimeoutTime;
        return;
      }
    }

    if (prevScheduledCallback !== null) {
      isFlushingHostCallback = true;
      try {
        prevScheduledCallback(didTimeout);
      } finally {
        isFlushingHostCallback = false;
      }
    }
  };

  const animationTick = function (rafTime) {
    if (scheduledHostCallback !== null) {
      // Eagerly schedule the next animation callback at the beginning of the
      // frame. If the scheduler queue is not empty at the end of the frame, it
      // will continue flushing inside that callback. If the queue *is* empty,
      // then it will exit immediately. Posting the callback at the start of the
      // frame ensures it's fired within the earliest possible frame. If we
      // waited until the end of the frame to post the callback, we risk the
      // browser skipping a frame and not firing the callback until the frame
      // after that.
      // 在帧的开头急切地安排下一个动画回调。
      // 如果调度器队列在帧结束时不是空的，它将继续在回调中刷新。
      // 如果队列*是*空的，那么它将立即退出。
      // 在框架的开始处发布回调可以确保它在尽可能早的框架内被触发。
      // 如果我们等到帧的末尾才发布回调，那么我们就冒着浏览器跳过一帧的风险，直到那之后的帧才触发回调。
      requestAnimationFrameWithTimeout(animationTick);
    } else {
      // No pending work. Exit.
      isAnimationFrameScheduled = false;
      return;
    }

    let nextFrameTime = rafTime - frameDeadline + activeFrameTime;
    if (
      nextFrameTime < activeFrameTime &&
      previousFrameTime < activeFrameTime &&
      !fpsLocked
    ) {
      if (nextFrameTime < 8) {
        // Defensive coding. We don't support higher frame rates than 120hz.
        // If the calculated frame time gets lower than 8, it is probably a bug.
        // 防御性编码。
        // 我们不支持高于120hz的帧速率。
        // 如果计算的帧时间低于8，这可能是一个bug。
        nextFrameTime = 8;
      }
      // If one frame goes long, then the next one can be short to catch up.
      // If two frames are short in a row, then that's an indication that we
      // actually have a higher frame rate than what we're currently optimizing.
      // We adjust our heuristic dynamically accordingly. For example, if we're
      // running on 120hz display or 90hz VR display.
      // Take the max of the two in case one of them was an anomaly due to
      // missed frame deadlines.
      // 如果一帧很长，那么下一帧就会很短，以便赶上。
      // 如果连续两帧都很短，那就说明我们的帧率比当前优化的帧率要高。
      // 我们相应地动态调整启发式。
      // 例如，如果我们运行120hz显示器或90hz VR显示器。
      // 以最大的两个，以防其中一个是一个异常，因为错过了框架的最后期限。
      activeFrameTime =
        nextFrameTime < previousFrameTime ? previousFrameTime : nextFrameTime;
    } else {
      previousFrameTime = nextFrameTime;
    }
    frameDeadline = rafTime + activeFrameTime;
    if (!isMessageEventScheduled) {
      isMessageEventScheduled = true;
      port.postMessage(undefined);
    }
  };

  requestHostCallback = function (callback, absoluteTimeout) {
    scheduledHostCallback = callback;
    timeoutTime = absoluteTimeout;
    if (isFlushingHostCallback || absoluteTimeout < 0) {
      // Don't wait for the next frame. Continue working ASAP, in a new event.
      //不要等到下一帧。在新的事件中，尽快继续工作。
      port.postMessage(undefined);
    } else if (!isAnimationFrameScheduled) {
      // If rAF didn't already schedule one, we need to schedule a frame.
      // TODO: If this rAF doesn't materialize because the browser throttles, we
      // might want to still have setTimeout trigger rIC as a backup to ensure
      // that we keep performing work.
      // 如果rAF还没有安排，我们需要安排一个帧。
      // TODO:如果这个rAF因为浏览器的节流而没有实现，我们可能还需要setTimeout触发器rIC作为备份，以确保我们继续执行工作。
      isAnimationFrameScheduled = true;
      requestAnimationFrameWithTimeout(animationTick);
    }
  };

  cancelHostCallback = function () {
    scheduledHostCallback = null;
    isMessageEventScheduled = false;
    timeoutTime = -1;
  };
}
