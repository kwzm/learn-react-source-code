/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { Fiber } from './ReactFiber';
import type {
  Instance,
    TextInstance,
    HydratableInstance,
    SuspenseInstance,
    Container,
    HostContext,
} from './ReactFiberHostConfig';

import {
  HostComponent,
  HostText,
  HostRoot,
  SuspenseComponent,
  DehydratedSuspenseComponent,
} from 'shared/ReactWorkTags';
import { Deletion, Placement } from 'shared/ReactSideEffectTags';
import invariant from 'shared/invariant';

import { createFiberFromHostInstanceForDeletion } from './ReactFiber';
import {
  shouldSetTextContent,
  supportsHydration,
  canHydrateInstance,
  canHydrateTextInstance,
  canHydrateSuspenseInstance,
  getNextHydratableSibling,
  getFirstHydratableChild,
  hydrateInstance,
  hydrateTextInstance,
  getNextHydratableInstanceAfterSuspenseInstance,
  didNotMatchHydratedContainerTextInstance,
  didNotMatchHydratedTextInstance,
  didNotHydrateContainerInstance,
  didNotHydrateInstance,
  didNotFindHydratableContainerInstance,
  didNotFindHydratableContainerTextInstance,
  didNotFindHydratableContainerSuspenseInstance,
  didNotFindHydratableInstance,
  didNotFindHydratableTextInstance,
  didNotFindHydratableSuspenseInstance,
} from './ReactFiberHostConfig';
import { enableSuspenseServerRenderer } from 'shared/ReactFeatureFlags';

// The deepest Fiber on the stack involved in a hydration context.
// This may have been an insertion or a hydration.
let hydrationParentFiber: null | Fiber = null;
let nextHydratableInstance: null | HydratableInstance = null;
let isHydrating: boolean = false;

function enterHydrationState(fiber: Fiber): boolean {
  if (!supportsHydration) {
    return false;
  }

  const parentInstance = fiber.stateNode.containerInfo;
  nextHydratableInstance = getFirstHydratableChild(parentInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  return true;
}

function reenterHydrationStateFromDehydratedSuspenseInstance(
  fiber: Fiber,
): boolean {
  if (!supportsHydration) {
    return false;
  }

  const suspenseInstance = fiber.stateNode;
  nextHydratableInstance = getNextHydratableSibling(suspenseInstance);
  popToNextHostParent(fiber);
  isHydrating = true;
  return true;
}

function deleteHydratableInstance(
  returnFiber: Fiber,
  instance: HydratableInstance,
) {
  if (__DEV__) {
    switch (returnFiber.tag) {
      case HostRoot:
        didNotHydrateContainerInstance(
          returnFiber.stateNode.containerInfo,
          instance,
        );
        break;
      case HostComponent:
        didNotHydrateInstance(
          returnFiber.type,
          returnFiber.memoizedProps,
          returnFiber.stateNode,
          instance,
        );
        break;
    }
  }

  const childToDelete = createFiberFromHostInstanceForDeletion();
  childToDelete.stateNode = instance;
  childToDelete.return = returnFiber;
  childToDelete.effectTag = Deletion;

  // This might seem like it belongs on progressedFirstDeletion. However,
  // these children are not part of the reconciliation list of children.
  // Even if we abort and rereconcile the children, that will try to hydrate
  // again and the nodes are still in the host tree so these will be
  // recreated.
  if (returnFiber.lastEffect !== null) {
    returnFiber.lastEffect.nextEffect = childToDelete;
    returnFiber.lastEffect = childToDelete;
  } else {
    returnFiber.firstEffect = returnFiber.lastEffect = childToDelete;
  }
}

function insertNonHydratedInstance(returnFiber: Fiber, fiber: Fiber) {
  fiber.effectTag |= Placement;
  if (__DEV__) {
    switch (returnFiber.tag) {
      case HostRoot: {
        const parentContainer = returnFiber.stateNode.containerInfo;
        switch (fiber.tag) {
          case HostComponent:
            const type = fiber.type;
            const props = fiber.pendingProps;
            didNotFindHydratableContainerInstance(parentContainer, type, props);
            break;
          case HostText:
            const text = fiber.pendingProps;
            didNotFindHydratableContainerTextInstance(parentContainer, text);
            break;
          case SuspenseComponent:
            didNotFindHydratableContainerSuspenseInstance(parentContainer);
            break;
        }
        break;
      }
      case HostComponent: {
        const parentType = returnFiber.type;
        const parentProps = returnFiber.memoizedProps;
        const parentInstance = returnFiber.stateNode;
        switch (fiber.tag) {
          case HostComponent:
            const type = fiber.type;
            const props = fiber.pendingProps;
            didNotFindHydratableInstance(
              parentType,
              parentProps,
              parentInstance,
              type,
              props,
            );
            break;
          case HostText:
            const text = fiber.pendingProps;
            didNotFindHydratableTextInstance(
              parentType,
              parentProps,
              parentInstance,
              text,
            );
            break;
          case SuspenseComponent:
            didNotFindHydratableSuspenseInstance(
              parentType,
              parentProps,
              parentInstance,
            );
            break;
        }
        break;
      }
      default:
        return;
    }
  }
}

function tryHydrate(fiber, nextInstance) {
  switch (fiber.tag) {
    case HostComponent: {
      const type = fiber.type;
      const props = fiber.pendingProps;
      const instance = canHydrateInstance(nextInstance, type, props);
      if (instance !== null) {
        fiber.stateNode = (instance: Instance);
        return true;
      }
      return false;
    }
    case HostText: {
      const text = fiber.pendingProps;
      const textInstance = canHydrateTextInstance(nextInstance, text);
      if (textInstance !== null) {
        fiber.stateNode = (textInstance: TextInstance);
        return true;
      }
      return false;
    }
    case SuspenseComponent: {
      if (enableSuspenseServerRenderer) {
        const suspenseInstance = canHydrateSuspenseInstance(nextInstance);
        if (suspenseInstance !== null) {
          // Downgrade the tag to a dehydrated component until we've hydrated it.
          fiber.tag = DehydratedSuspenseComponent;
          fiber.stateNode = (suspenseInstance: SuspenseInstance);
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function tryToClaimNextHydratableInstance(fiber: Fiber): void {
  if (!isHydrating) {
    return;
  }
  let nextInstance = nextHydratableInstance;
  if (!nextInstance) {
    // Nothing to hydrate. Make it an insertion.
    insertNonHydratedInstance((hydrationParentFiber: any), fiber);
    isHydrating = false;
    hydrationParentFiber = fiber;
    return;
  }
  const firstAttemptedInstance = nextInstance;
  if (!tryHydrate(fiber, nextInstance)) {
    // If we can't hydrate this instance let's try the next one.
    // We use this as a heuristic. It's based on intuition and not data so it
    // might be flawed or unnecessary.
    // 如果这次不行，那就下次吧。
    // 我们把这当作一种启发。
    // 它是基于直觉而不是数据，所以它可能是有缺陷的或不必要的。
    nextInstance = getNextHydratableSibling(firstAttemptedInstance);
    if (!nextInstance || !tryHydrate(fiber, nextInstance)) {
      // Nothing to hydrate. Make it an insertion.
      insertNonHydratedInstance((hydrationParentFiber: any), fiber);
      isHydrating = false;
      hydrationParentFiber = fiber;
      return;
    }
    // We matched the next one, we'll now assume that the first one was
    // superfluous and we'll delete it. Since we can't eagerly delete it
    // we'll have to schedule a deletion. To do that, this node needs a dummy
    // fiber associated with it.
    // 我们匹配了下一个，我们现在假设第一个是多余的，我们将删除它。
    // 由于我们不能立即删除它，我们将不得不安排一个删除。
    // 为此，这个节点需要一个与它相关联的 fiber。
    deleteHydratableInstance(
      (hydrationParentFiber: any),
      firstAttemptedInstance,
    );
  }
  hydrationParentFiber = fiber;
  nextHydratableInstance = getFirstHydratableChild((nextInstance: any));
}

function prepareToHydrateHostInstance(
  fiber: Fiber,
  rootContainerInstance: Container,
  hostContext: HostContext,
): boolean {
  if (!supportsHydration) {
    invariant(
      false,
      'Expected prepareToHydrateHostInstance() to never be called. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  const instance: Instance = fiber.stateNode;
  const updatePayload = hydrateInstance(
    instance,
    fiber.type,
    fiber.memoizedProps,
    rootContainerInstance,
    hostContext,
    fiber,
  );
  // TODO: Type this specific to this type of component.
  fiber.updateQueue = (updatePayload: any);
  // If the update payload indicates that there is a change or if there
  // is a new ref we mark this as an update.
  // 如果更新 payload 表明有一个变化，或者如果有一个新的ref，我们把它标记为一个更新。
  if (updatePayload !== null) {
    return true;
  }
  return false;
}

function prepareToHydrateHostTextInstance(fiber: Fiber): boolean {
  if (!supportsHydration) {
    invariant(
      false,
      'Expected prepareToHydrateHostTextInstance() to never be called. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  const textInstance: TextInstance = fiber.stateNode;
  const textContent: string = fiber.memoizedProps;
  const shouldUpdate = hydrateTextInstance(textInstance, textContent, fiber);
  if (__DEV__) {
    if (shouldUpdate) {
      // We assume that prepareToHydrateHostTextInstance is called in a context where the
      // hydration parent is the parent host component of this host text.
      const returnFiber = hydrationParentFiber;
      if (returnFiber !== null) {
        switch (returnFiber.tag) {
          case HostRoot: {
            const parentContainer = returnFiber.stateNode.containerInfo;
            didNotMatchHydratedContainerTextInstance(
              parentContainer,
              textInstance,
              textContent,
            );
            break;
          }
          case HostComponent: {
            const parentType = returnFiber.type;
            const parentProps = returnFiber.memoizedProps;
            const parentInstance = returnFiber.stateNode;
            didNotMatchHydratedTextInstance(
              parentType,
              parentProps,
              parentInstance,
              textInstance,
              textContent,
            );
            break;
          }
        }
      }
    }
  }
  return shouldUpdate;
}

function skipPastDehydratedSuspenseInstance(fiber: Fiber): void {
  if (!supportsHydration) {
    invariant(
      false,
      'Expected skipPastDehydratedSuspenseInstance() to never be called. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
    );
  }
  let suspenseInstance = fiber.stateNode;
  invariant(
    suspenseInstance,
    'Expected to have a hydrated suspense instance. ' +
    'This error is likely caused by a bug in React. Please file an issue.',
  );
  nextHydratableInstance = getNextHydratableInstanceAfterSuspenseInstance(
    suspenseInstance,
  );
}

function popToNextHostParent(fiber: Fiber): void {
  let parent = fiber.return;
  while (
    parent !== null &&
    parent.tag !== HostComponent &&
    parent.tag !== HostRoot &&
    parent.tag !== DehydratedSuspenseComponent
  ) {
    parent = parent.return;
  }
  hydrationParentFiber = parent;
}

function popHydrationState(fiber: Fiber): boolean {
  if (!supportsHydration) {
    return false;
  }
  if (fiber !== hydrationParentFiber) {
    // We're deeper than the current hydration context, inside an inserted
    // tree.
    // 我们比当前的 hydration context 更深入，在一棵插入的树里。
    return false;
  }
  if (!isHydrating) {
    // If we're not currently hydrating but we're in a hydration context, then
    // we were an insertion and now need to pop up reenter hydration of our
    // siblings.
    // 如果我们目前没有 hydrating，但我们处于 hydration context 中，那么我们是一个插入，现在需要弹出重新进入我们的兄弟节点的 hydration。
    popToNextHostParent(fiber);
    isHydrating = true;
    return false;
  }

  const type = fiber.type;

  // If we have any remaining hydratable nodes, we need to delete them now.
  // We only do this deeper than head and body since they tend to have random
  // other nodes in them. We also ignore components with pure text content in
  // side of them.
  // 如果我们有任何剩余的 hydratable 节点，我们现在需要删除它们。
  // 我们这样做的深度只比 head 和 body 深，因为它们往往有随机的其他节点。
  // 我们还忽略了纯文本内容的组件。
  // TODO: Better heuristic.
  if (
    fiber.tag !== HostComponent ||
    (type !== 'head' &&
      type !== 'body' &&
      !shouldSetTextContent(type, fiber.memoizedProps))
  ) {
    let nextInstance = nextHydratableInstance;
    while (nextInstance) {
      deleteHydratableInstance(fiber, nextInstance);
      nextInstance = getNextHydratableSibling(nextInstance);
    }
  }

  popToNextHostParent(fiber);
  nextHydratableInstance = hydrationParentFiber
    ? getNextHydratableSibling(fiber.stateNode)
    : null;
  return true;
}

function resetHydrationState(): void {
  if (!supportsHydration) {
    return;
  }

  hydrationParentFiber = null;
  nextHydratableInstance = null;
  isHydrating = false;
}

export {
  enterHydrationState,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  tryToClaimNextHydratableInstance,
  prepareToHydrateHostInstance,
  prepareToHydrateHostTextInstance,
  skipPastDehydratedSuspenseInstance,
  popHydrationState,
};
