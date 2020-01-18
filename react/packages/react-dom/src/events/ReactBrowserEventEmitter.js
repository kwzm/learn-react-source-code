/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import { registrationNameDependencies } from 'events/EventPluginRegistry';
import type { DOMTopLevelEventType } from 'events/TopLevelEventTypes';
import {
  TOP_BLUR,
  TOP_CANCEL,
  TOP_CLOSE,
  TOP_FOCUS,
  TOP_INVALID,
  TOP_RESET,
  TOP_SCROLL,
  TOP_SUBMIT,
  getRawEventName,
  mediaEventTypes,
} from './DOMTopLevelEventTypes';
import {
  setEnabled,
  isEnabled,
  trapBubbledEvent,
  trapCapturedEvent,
} from './ReactDOMEventListener';
import isEventSupported from './isEventSupported';

/**
 * Summary of `ReactBrowserEventEmitter` event handling:
 * “ReactBrowserEventEmitter”事件处理总结:
 *
 *  - Top-level delegation is used to trap most native browser events. This
 *    may only occur in the main thread and is the responsibility of
 *    ReactDOMEventListener, which is injected and can therefore support
 *    pluggable event sources. This is the only work that occurs in the main
 *    thread.
 *    顶级委托用于捕获大多数本机浏览器事件。
 *    这可能只发生在主线程中，并且是ReactDOMEventListener的职责，它被注入，因此可以支持可插入的事件源。
 *    这是主线程中发生的唯一工作。
 *
 *  - We normalize and de-duplicate events to account for browser quirks. This
 *    may be done in the worker thread.
 *    我们对事件进行规范化和去复制，以解决浏览器的问题。
 *    这可以在工作线程中完成。
 *
 *  - Forward these native events (with the associated top-level type used to
 *    trap it) to `EventPluginHub`, which in turn will ask plugins if they want
 *    to extract any synthetic events.
 *    将这些本地事件(以及相关的用于捕获它的顶级类型)转发给“EventPluginHub”，
 *    后者将反过来询问插件是否想要提取任何合成事件。
 *
 *  - The `EventPluginHub` will then process each event by annotating them with
 *    "dispatches", a sequence of listeners and IDs that care about that event.
 *    然后，“EventPluginHub”将使用“dispatches”对每个事件进行注释，
 *    dispatches是与该事件相关的侦听器和id序列。
 *
 *  - The `EventPluginHub` then dispatches the events.
 *    “EventPluginHub”然后分发事件。
 *
 * Overview of React and the event system:
 *
 * +------------+    .
 * |    DOM     |    .
 * +------------+    .
 *       |           .
 *       v           .
 * +------------+    .
 * | ReactEvent |    .
 * |  Listener  |    .
 * +------------+    .                         +-----------+
 *       |           .               +--------+|SimpleEvent|
 *       |           .               |         |Plugin     |
 * +-----|------+    .               v         +-----------+
 * |     |      |    .    +--------------+                    +------------+
 * |     +-----------.--->|EventPluginHub|                    |    Event   |
 * |            |    .    |              |     +-----------+  | Propagators|
 * | ReactEvent |    .    |              |     |TapEvent   |  |------------|
 * |  Emitter   |    .    |              |<---+|Plugin     |  |other plugin|
 * |            |    .    |              |     +-----------+  |  utilities |
 * |     +-----------.--->|              |                    +------------+
 * |     |      |    .    +--------------+
 * +-----|------+    .                ^        +-----------+
 *       |           .                |        |Enter/Leave|
 *       +           .                +-------+|Plugin     |
 * +-------------+   .                         +-----------+
 * | application |   .
 * |-------------|   .
 * |             |   .
 * |             |   .
 * +-------------+   .
 *                   .
 *    React Core     .  General Purpose Event Plugin System
 */

const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;
const elementListeningSets:
  | WeakMap
  | Map<
    Document | Element | Node,
    Set<DOMTopLevelEventType | string>,
  > = new PossiblyWeakMap();

export function getListeningSetForElement(
  element: Document | Element | Node,
): Set<DOMTopLevelEventType | string> {
  let listeningSet = elementListeningSets.get(element);
  if (listeningSet === undefined) {
    listeningSet = new Set();
    elementListeningSets.set(element, listeningSet);
  }
  return listeningSet;
}

/**
 * We listen for bubbled touch events on the document object.
 * 我们监听文档对象上冒泡的触摸事件。
 *
 * Firefox v8.01 (and possibly others) exhibited strange behavior when
 * mounting `onmousemove` events at some node that was not the document
 * element. The symptoms were that if your mouse is not moving over something
 * contained within that mount point (for example on the background) the
 * top-level listeners for `onmousemove` won't be called. However, if you
 * register the `mousemove` on the document object, then it will of course
 * catch all `mousemove`s. This along with iOS quirks, justifies restricting
 * top-level listeners to the document object only, at least for these
 * movement types of events and possibly all events.
 *
 * @see http://www.quirksmode.org/blog/archives/2010/09/click_event_del.html
 *
 * Also, `keyup`/`keypress`/`keydown` do not bubble to the window on IE, but
 * they bubble to document.
 *
 * @param {string} registrationName Name of listener (e.g. `onClick`).
 * @param {object} mountAt Container where to mount the listener
 */
export function listenTo(
  registrationName: string,
  mountAt: Document | Element | Node,
): void {
  const listeningSet = getListeningSetForElement(mountAt);
  const dependencies = registrationNameDependencies[registrationName];

  for (let i = 0; i < dependencies.length; i++) {
    const dependency = dependencies[i];
    if (!listeningSet.has(dependency)) {
      switch (dependency) {
        case TOP_SCROLL:
          trapCapturedEvent(TOP_SCROLL, mountAt);
          break;
        case TOP_FOCUS:
        case TOP_BLUR:
          trapCapturedEvent(TOP_FOCUS, mountAt);
          trapCapturedEvent(TOP_BLUR, mountAt);
          // We set the flag for a single dependency later in this function,
          // but this ensures we mark both as attached rather than just one.
          listeningSet.add(TOP_BLUR);
          listeningSet.add(TOP_FOCUS);
          break;
        case TOP_CANCEL:
        case TOP_CLOSE:
          if (isEventSupported(getRawEventName(dependency))) {
            trapCapturedEvent(dependency, mountAt);
          }
          break;
        case TOP_INVALID:
        case TOP_SUBMIT:
        case TOP_RESET:
          // We listen to them on the target DOM elements.
          // Some of them bubble so we don't want them to fire twice.
          break;
        default:
          // By default, listen on the top level to all non-media events.
          // Media events don't bubble so adding the listener wouldn't do anything.
          const isMediaEvent = mediaEventTypes.indexOf(dependency) !== -1;
          if (!isMediaEvent) {
            trapBubbledEvent(dependency, mountAt);
          }
          break;
      }
      listeningSet.add(dependency);
    }
  }
}

export function isListeningToAllDependencies(
  registrationName: string,
  mountAt: Document | Element,
): boolean {
  const listeningSet = getListeningSetForElement(mountAt);
  const dependencies = registrationNameDependencies[registrationName];

  for (let i = 0; i < dependencies.length; i++) {
    const dependency = dependencies[i];
    if (!listeningSet.has(dependency)) {
      return false;
    }
  }
  return true;
}

export { setEnabled, isEnabled, trapBubbledEvent, trapCapturedEvent };
