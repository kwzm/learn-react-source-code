/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Module that is injectable into `EventPluginHub`, that specifies a
 * deterministic ordering of `EventPlugin`s. A convenient way to reason about
 * plugins, without having to package every one of them. This is better than
 * having plugins be ordered in the same order that they are injected because
 * that ordering would be influenced by the packaging order.
 * `ResponderEventPlugin` must occur before `SimpleEventPlugin` so that
 * preventing default on events is convenient in `SimpleEventPlugin` handlers.
 * 可注入到“EventPluginHub”中的模块，它指定了“EventPlugin”的确定性排序。
 * 一个方便的方式来推理插件，而不必打包每一个。
 * 这比按照插件被注入的顺序排序要好，因为顺序会受到打包顺序的影响。
 * ' ResponderEventPlugin '必须出现在' SimpleEventPlugin '之前，这样在' SimpleEventPlugin '处理程序中防止默认事件是很方便的。
 */
const DOMEventPluginOrder = [
  'ResponderEventPlugin',
  'SimpleEventPlugin',
  'EnterLeaveEventPlugin',
  'ChangeEventPlugin',
  'SelectEventPlugin',
  'BeforeInputEventPlugin',
];

export default DOMEventPluginOrder;
