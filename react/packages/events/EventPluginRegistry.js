/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { DispatchConfig } from './ReactSyntheticEventType';
import type {
  AnyNativeEvent,
    PluginName,
    PluginModule,
} from './PluginModuleType';

import invariant from 'shared/invariant';

type NamesToPlugins = { [key: PluginName]: PluginModule<AnyNativeEvent> };
type EventPluginOrder = null | Array<PluginName>;

/**
 * Injectable ordering of event plugins.
 */
let eventPluginOrder: EventPluginOrder = null;

/**
 * Injectable mapping from names to event plugin modules.
 * 从名称到事件插件模块的可注入映射。
 */
const namesToPlugins: NamesToPlugins = {};

/**
 * Recomputes the plugin list using the injected plugins and plugin ordering.
 * 使用注入的插件和插件顺序重新计算插件列表。
 *
 * @private
 */
function recomputePluginOrdering(): void {
  if (!eventPluginOrder) {
    // Wait until an `eventPluginOrder` is injected.
    return;
  }
  for (const pluginName in namesToPlugins) {
    const pluginModule = namesToPlugins[pluginName];
    const pluginIndex = eventPluginOrder.indexOf(pluginName);
    invariant(
      pluginIndex > -1,
      'EventPluginRegistry: Cannot inject event plugins that do not exist in ' +
      'the plugin ordering, `%s`.',
      pluginName,
    );
    if (plugins[pluginIndex]) {
      continue;
    }
    invariant(
      pluginModule.extractEvents,
      'EventPluginRegistry: Event plugins must implement an `extractEvents` ' +
      'method, but `%s` does not.',
      pluginName,
    );
    plugins[pluginIndex] = pluginModule;
    const publishedEvents = pluginModule.eventTypes;
    // const eventTypes = {
    //   change: {
    //     phasedRegistrationNames: {
    //       bubbled: 'onChange',
    //       captured: 'onChangeCapture',
    //     },
    //     dependencies: [
    //       TOP_BLUR,
    //       TOP_CHANGE,
    //       TOP_CLICK,
    //       TOP_FOCUS,
    //       TOP_INPUT,
    //       TOP_KEY_DOWN,
    //       TOP_KEY_UP,
    //       TOP_SELECTION_CHANGE,
    //     ],
    //   },
    // };
    for (const eventName in publishedEvents) {
      invariant(
        publishEventForPlugin(
          publishedEvents[eventName], // ChangeEventPlugin.eventTypes.change
          pluginModule, // ChangeEventPlugin
          eventName, // change
        ),
        'EventPluginRegistry: Failed to publish event `%s` for plugin `%s`.',
        eventName,
        pluginName,
      );
    }
  }
}

/**
 * Publishes an event so that it can be dispatched by the supplied plugin.
 * 发布一个事件，以便它可以由提供的插件来分派。
 *
 * @param {object} dispatchConfig Dispatch configuration for the event.
 * @param {object} PluginModule Plugin publishing the event.
 * @return {boolean} True if the event was successfully published.
 * @private
 */
function publishEventForPlugin(
  dispatchConfig: DispatchConfig, // ChangeEventPlugin.eventTypes.change
  pluginModule: PluginModule<AnyNativeEvent>, // ChangeEventPlugin
  eventName: string, // change
): boolean {
  invariant(
    !eventNameDispatchConfigs.hasOwnProperty(eventName),
    'EventPluginHub: More than one plugin attempted to publish the same ' +
    'event name, `%s`.',
    eventName,
  );
  eventNameDispatchConfigs[eventName] = dispatchConfig;

  const phasedRegistrationNames = dispatchConfig.phasedRegistrationNames;
  // change: {
  //   phasedRegistrationNames: {
  //     bubbled: 'onChange',
  //     captured: 'onChangeCapture',
  //   },
  //   ...
  // }
  if (phasedRegistrationNames) {
    for (const phaseName in phasedRegistrationNames) {
      if (phasedRegistrationNames.hasOwnProperty(phaseName)) {
        const phasedRegistrationName = phasedRegistrationNames[phaseName]; // onChange or onChangeCapture
        publishRegistrationName(
          phasedRegistrationName, // onChange or onChangeCapture
          pluginModule, // ChangeEventPlugin
          eventName, // change
        );
      }
    }
    return true;
  } else if (dispatchConfig.registrationName) {
    publishRegistrationName(
      dispatchConfig.registrationName,
      pluginModule,
      eventName,
    );
    return true;
  }
  return false;
}

/**
 * Publishes a registration name that is used to identify dispatched events.
 * 发布用于标识已调度事件的注册名称。
 *
 * @param {string} registrationName Registration name to add.
 * @param {object} PluginModule Plugin publishing the event.
 * @private
 */
function publishRegistrationName(
  registrationName: string, // onChange or onChangeCapture
  pluginModule: PluginModule<AnyNativeEvent>, // ChangeEventPlugin
  eventName: string, // change
): void {
  invariant(
    !registrationNameModules[registrationName],
    'EventPluginHub: More than one plugin attempted to publish the same ' +
    'registration name, `%s`.',
    registrationName,
  );
  registrationNameModules[registrationName] = pluginModule;
  registrationNameDependencies[registrationName] =
    pluginModule.eventTypes[eventName].dependencies;

  if (__DEV__) {
    const lowerCasedName = registrationName.toLowerCase();
    possibleRegistrationNames[lowerCasedName] = registrationName;

    if (registrationName === 'onDoubleClick') {
      possibleRegistrationNames.ondblclick = registrationName;
    }
  }
}

/**
 * Registers plugins so that they can extract and dispatch events.
 *
 * @see {EventPluginHub}
 */

/**
 * Ordered list of injected plugins.
 * 有序的注入插件列表。
 */
export const plugins = [];

/**
 * Mapping from event name to dispatch config
 * 从事件名映射到分派配置
 */
export const eventNameDispatchConfigs = {};

/**
 * Mapping from registration name to plugin module
 * 从注册名映射到插件模块
 */
export const registrationNameModules = {};

/**
 * Mapping from registration name to event name
 * 从注册名映射到事件名
 */
export const registrationNameDependencies = {};

/**
 * Mapping from lowercase registration names to the properly cased version,
 * used to warn in the case of missing event handlers. Available
 * only in __DEV__.
 * @type {Object}
 */
export const possibleRegistrationNames = __DEV__ ? {} : (null: any);
// Trust the developer to only use possibleRegistrationNames in __DEV__

/**
 * Injects an ordering of plugins (by plugin name). This allows the ordering
 * to be decoupled from injection of the actual plugins so that ordering is
 * always deterministic regardless of packaging, on-the-fly injection, etc.
 * 插入插件的顺序(按插件名)。
 * 这使得排序与实际插件的注入解耦，因此无论打包、动态注入等如何，排序总是确定的。
 *
 * @param {array} InjectedEventPluginOrder
 * @internal
 * @see {EventPluginHub.injection.injectEventPluginOrder}
 */
// injectedEventPluginOrder = [
//   'ResponderEventPlugin',
//   'SimpleEventPlugin',
//   'EnterLeaveEventPlugin',
//   'ChangeEventPlugin',
//   'SelectEventPlugin',
//   'BeforeInputEventPlugin',
// ];
export function injectEventPluginOrder(
  injectedEventPluginOrder: EventPluginOrder,
): void {
  invariant(
    !eventPluginOrder,
    'EventPluginRegistry: Cannot inject event plugin ordering more than ' +
    'once. You are likely trying to load more than one copy of React.',
  );
  // Clone the ordering so it cannot be dynamically mutated.
  // 克隆排序，这样就不能动态地改变它。
  eventPluginOrder = Array.prototype.slice.call(injectedEventPluginOrder);
  recomputePluginOrdering();
}

/**
 * Injects plugins to be used by `EventPluginHub`. The plugin names must be
 * in the ordering injected by `injectEventPluginOrder`.
 * 注入被“EventPluginHub”使用的插件。
 * 插件名必须是按照‘injectEventPluginOrder’的顺序注入的。
 *
 * Plugins can be injected as part of page initialization or on-the-fly.
 * 插件可以作为页面初始化的一部分注入，也可以动态注入。
 *
 * @param {object} injectedNamesToPlugins Map from names to plugin modules.
 * @internal
 * @see {EventPluginHub.injection.injectEventPluginsByName}
 */
// injectedNamesToPlugins: {
//   SimpleEventPlugin: SimpleEventPlugin,
//   EnterLeaveEventPlugin: EnterLeaveEventPlugin,
//   ChangeEventPlugin: ChangeEventPlugin,
//   SelectEventPlugin: SelectEventPlugin,
//   BeforeInputEventPlugin: BeforeInputEventPlugin,
// }
export function injectEventPluginsByName(
  injectedNamesToPlugins: NamesToPlugins,
): void {
  let isOrderingDirty = false;
  for (const pluginName in injectedNamesToPlugins) {
    if (!injectedNamesToPlugins.hasOwnProperty(pluginName)) {
      continue;
    }
    const pluginModule = injectedNamesToPlugins[pluginName];
    if (
      !namesToPlugins.hasOwnProperty(pluginName) ||
      namesToPlugins[pluginName] !== pluginModule
    ) {
      invariant(
        !namesToPlugins[pluginName],
        'EventPluginRegistry: Cannot inject two different event plugins ' +
        'using the same name, `%s`.',
        pluginName,
      );
      namesToPlugins[pluginName] = pluginModule;
      isOrderingDirty = true;
    }
  }
  if (isOrderingDirty) {
    recomputePluginOrdering();
  }
}
