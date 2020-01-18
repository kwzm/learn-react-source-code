/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { Fiber } from './ReactFiber';
import type { StackCursor } from './ReactFiberStack';

import { isFiberMounted } from 'react-reconciler/reflection';
import { ClassComponent, HostRoot } from 'shared/ReactWorkTags';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';
import checkPropTypes from 'prop-types/checkPropTypes';

import { setCurrentPhase, getCurrentFiberStackInDev } from './ReactCurrentFiber';
import { startPhaseTimer, stopPhaseTimer } from './ReactDebugFiberPerf';
import { createCursor, push, pop } from './ReactFiberStack';

let warnedAboutMissingGetChildContext;

if (__DEV__) {
  warnedAboutMissingGetChildContext = {};
}

export const emptyContextObject = {};
if (__DEV__) {
  Object.freeze(emptyContextObject);
}

// A cursor to the current merged context object on the stack.
// 指向堆栈上当前合并上下文对象的指针。
let contextStackCursor: StackCursor<Object> = createCursor(emptyContextObject);
// A cursor to a boolean indicating whether the context has changed.
// 一个指示上下文是否改变的布尔值的指针。
let didPerformWorkStackCursor: StackCursor<boolean> = createCursor(false);
// Keep track of the previous context object that was on the stack.
// We use this to get access to the parent context after we have already
// pushed the next context provider, and now need to merge their contexts.
let previousContext: Object = emptyContextObject;

function getUnmaskedContext(
  workInProgress: Fiber,
  Component: Function,
  didPushOwnContextIfProvider: boolean,
): Object {
  if (didPushOwnContextIfProvider && isContextProvider(Component)) {
    // If the fiber is a context provider itself, when we read its context
    // we may have already pushed its own child context on the stack. A context
    // provider should not "see" its own child context. Therefore we read the
    // previous (parent) context instead for a context provider.
    // 如果 fiber 本身是一个上下文提供程序，当我们读取它的上下文时，我们可能已经将它自己的子上下文压入堆栈。
    // 上下文提供者不应该“看到”自己的子上下文。
    // 因此，我们读取以前的(父)上下文而不是上下文提供者。
    return previousContext;
  }
  return contextStackCursor.current;
}

function cacheContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
  maskedContext: Object,
): void {
  const instance = workInProgress.stateNode;
  instance.__reactInternalMemoizedUnmaskedChildContext = unmaskedContext;
  instance.__reactInternalMemoizedMaskedChildContext = maskedContext;
}

function getMaskedContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
): Object {
  const type = workInProgress.type;
  const contextTypes = type.contextTypes;
  if (!contextTypes) {
    return emptyContextObject;
  }

  // Avoid recreating masked context unless unmasked context has changed.
  // Failing to do this will result in unnecessary calls to componentWillReceiveProps.
  // This may trigger infinite loops if componentWillReceiveProps calls setState.
  // 避免重新创建 masked 的上下文，除非 unmasked 的上下文已经更改。
  // 如果不这样做，就会导致对componentWillReceiveProps的不必要调用。
  // 如果componentWillReceiveProps调用setState，则可能触发无限循环。
  const instance = workInProgress.stateNode;
  if (
    instance &&
    instance.__reactInternalMemoizedUnmaskedChildContext === unmaskedContext
  ) {
    return instance.__reactInternalMemoizedMaskedChildContext;
  }

  const context = {};
  for (let key in contextTypes) {
    context[key] = unmaskedContext[key];
  }

  if (__DEV__) {
    const name = getComponentName(type) || 'Unknown';
    checkPropTypes(
      contextTypes,
      context,
      'context',
      name,
      getCurrentFiberStackInDev,
    );
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // Context is created before the class component is instantiated so check for instance.
  // 缓存非掩码上下文，这样我们可以避免重新创建掩码上下文，除非有必要。
  // Context是在类组件实例化之前创建的，所以检查实例。
  if (instance) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return context;
}

function hasContextChanged(): boolean {
  return didPerformWorkStackCursor.current;
}

function isContextProvider(type: Function): boolean {
  const childContextTypes = type.childContextTypes;
  return childContextTypes !== null && childContextTypes !== undefined;
}

function popContext(fiber: Fiber): void {
  pop(didPerformWorkStackCursor, fiber);
  pop(contextStackCursor, fiber);
}

function popTopLevelContextObject(fiber: Fiber): void {
  pop(didPerformWorkStackCursor, fiber);
  pop(contextStackCursor, fiber);
}

function pushTopLevelContextObject(
  fiber: Fiber,
  context: Object,
  didChange: boolean,
): void {
  invariant(
    contextStackCursor.current === emptyContextObject,
    'Unexpected context found on stack. ' +
    'This error is likely caused by a bug in React. Please file an issue.',
  );

  push(contextStackCursor, context, fiber);
  push(didPerformWorkStackCursor, didChange, fiber);
}

function processChildContext(
  fiber: Fiber,
  type: any,
  parentContext: Object,
): Object {
  const instance = fiber.stateNode;
  const childContextTypes = type.childContextTypes;

  // TODO (bvaughn) Replace this behavior with an invariant() in the future.
  // It has only been added in Fiber to match the (unintentional) behavior in Stack.
  if (typeof instance.getChildContext !== 'function') {
    if (__DEV__) {
      const componentName = getComponentName(type) || 'Unknown';

      if (!warnedAboutMissingGetChildContext[componentName]) {
        warnedAboutMissingGetChildContext[componentName] = true;
        warningWithoutStack(
          false,
          '%s.childContextTypes is specified but there is no getChildContext() method ' +
          'on the instance. You can either define getChildContext() on %s or remove ' +
          'childContextTypes from it.',
          componentName,
          componentName,
        );
      }
    }
    return parentContext;
  }

  let childContext;
  if (__DEV__) {
    setCurrentPhase('getChildContext');
  }
  startPhaseTimer(fiber, 'getChildContext');
  childContext = instance.getChildContext();
  stopPhaseTimer();
  if (__DEV__) {
    setCurrentPhase(null);
  }
  for (let contextKey in childContext) {
    invariant(
      contextKey in childContextTypes,
      '%s.getChildContext(): key "%s" is not defined in childContextTypes.',
      getComponentName(type) || 'Unknown',
      contextKey,
    );
  }
  if (__DEV__) {
    const name = getComponentName(type) || 'Unknown';
    checkPropTypes(
      childContextTypes,
      childContext,
      'child context',
      name,
      // In practice, there is one case in which we won't get a stack. It's when
      // somebody calls unstable_renderSubtreeIntoContainer() and we process
      // context from the parent component instance. The stack will be missing
      // because it's outside of the reconciliation, and so the pointer has not
      // been set. This is rare and doesn't matter. We'll also remove that API.
      getCurrentFiberStackInDev,
    );
  }

  return { ...parentContext, ...childContext };
}

function pushContextProvider(workInProgress: Fiber): boolean {
  const instance = workInProgress.stateNode;
  // We push the context as early as possible to ensure stack integrity.
  // If the instance does not exist yet, we will push null at first,
  // and replace it on the stack later when invalidating the context.
  // 我们尽可能早地推送上下文以确保堆栈的完整性。
  // 如果实例还不存在，我们将首先推送null，然后在使上下文无效时在堆栈上替换它。
  const memoizedMergedChildContext =
    (instance && instance.__reactInternalMemoizedMergedChildContext) ||
    emptyContextObject;

  // Remember the parent context so we can merge with it later.
  // Inherit the parent's did-perform-work value to avoid inadvertently blocking updates.
  // 记住父上下文，以便我们以后可以合并它。
  // 继承父进程的did-perform-work值，以避免无意中阻塞更新。
  previousContext = contextStackCursor.current;
  push(contextStackCursor, memoizedMergedChildContext, workInProgress);
  push(
    didPerformWorkStackCursor,
    didPerformWorkStackCursor.current,
    workInProgress,
  );

  return true;
}

function invalidateContextProvider(
  workInProgress: Fiber,
  type: any,
  didChange: boolean,
): void {
  const instance = workInProgress.stateNode;
  invariant(
    instance,
    'Expected to have an instance by this point. ' +
    'This error is likely caused by a bug in React. Please file an issue.',
  );

  if (didChange) {
    // Merge parent and own context.
    // Skip this if we're not updating due to sCU.
    // This avoids unnecessarily recomputing memoized values.
    // 合并父进程和自己的上下文。
    // 如果我们因为sCU而没有更新，请跳过这个。
    // 这避免了不必要的重新计算记忆值。
    const mergedContext = processChildContext(
      workInProgress,
      type,
      previousContext,
    );
    instance.__reactInternalMemoizedMergedChildContext = mergedContext;

    // Replace the old (or empty) context with the new one.
    // It is important to unwind the context in the reverse order.
    // 用新的上下文替换旧的(或空的)上下文。
    // 按相反的顺序展开上下文是很重要的。
    pop(didPerformWorkStackCursor, workInProgress);
    pop(contextStackCursor, workInProgress);
    // Now push the new context and mark that it has changed.
    // 现在推动新的上下文并标记它已经改变。
    push(contextStackCursor, mergedContext, workInProgress);
    push(didPerformWorkStackCursor, didChange, workInProgress);
  } else {
    pop(didPerformWorkStackCursor, workInProgress);
    push(didPerformWorkStackCursor, didChange, workInProgress);
  }
}

function findCurrentUnmaskedContext(fiber: Fiber): Object {
  // Currently this is only used with renderSubtreeIntoContainer; not sure if it
  // makes sense elsewhere
  invariant(
    isFiberMounted(fiber) && fiber.tag === ClassComponent,
    'Expected subtree parent to be a mounted class component. ' +
    'This error is likely caused by a bug in React. Please file an issue.',
  );

  let node = fiber;
  do {
    switch (node.tag) {
      case HostRoot:
        return node.stateNode.context;
      case ClassComponent: {
        const Component = node.type;
        if (isContextProvider(Component)) {
          return node.stateNode.__reactInternalMemoizedMergedChildContext;
        }
        break;
      }
    }
    node = node.return;
  } while (node !== null);
  invariant(
    false,
    'Found unexpected detached subtree parent. ' +
    'This error is likely caused by a bug in React. Please file an issue.',
  );
}

export {
  getUnmaskedContext,
  cacheContext,
  getMaskedContext,
  hasContextChanged,
  popContext,
  popTopLevelContextObject,
  pushTopLevelContextObject,
  processChildContext,
  isContextProvider,
  pushContextProvider,
  invalidateContextProvider,
  findCurrentUnmaskedContext,
};
