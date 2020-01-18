const NoWork = 0;
const Never = 1;
const Sync = 1073741823;
const Batched = Sync - 1;
const UNIT_SIZE = 10;
const MAGIC_NUMBER_OFFSET = Batched - 1;

export const NoMode = 0b0000;
export const StrictMode = 0b0001;
export const BatchedMode = 0b0010;
export const ConcurrentMode = 0b0100;
export const ProfileMode = 0b1000;

export const ImmediatePriority: ReactPriorityLevel = 99;
export const UserBlockingPriority: ReactPriorityLevel = 98;
export const NormalPriority: ReactPriorityLevel = 97;
export const LowPriority: ReactPriorityLevel = 96;
export const IdlePriority: ReactPriorityLevel = 95;
export const NoPriority: ReactPriorityLevel = 90;

const NotWorking = 0;
const BatchedPhase = 1;
const LegacyUnbatchedPhase = 2;
const FlushSyncPhase = 3;
const RenderPhase = 4;
const CommitPhase = 5;
const BatchedEventPhase = 6;
let workPhase = NotWorking;

const HIGH_PRIORITY_EXPIRATION = 150;
const HIGH_PRIORITY_BATCH_SIZE = 100;
const LOW_PRIORITY_EXPIRATION = 5000;
const LOW_PRIORITY_BATCH_SIZE = 250;

function Scheduler_now() {
  return performance.now();
}

let initialTimeMs: number = Scheduler_now();

// 1 unit of expiration time represents 10ms.
function msToExpirationTime(ms: number): ExpirationTime {
  // Always add an offset so that we don't clash with the magic number for NoWork.
  return MAGIC_NUMBER_OFFSET - ((ms / UNIT_SIZE) | 0);
}

const now =
  initialTimeMs < 10000 ? Scheduler_now : () => Scheduler_now() - initialTimeMs;

export function requestCurrentTime() {
  return msToExpirationTime(performance.now());
}

function ceiling(num: number, precision: number): number {
  return (((num / precision) | 0) + 1) * precision;
}

function computeExpirationBucket(
  currentTime,
  expirationInMs,
  bucketSizeMs
): ExpirationTime {
  return (
    MAGIC_NUMBER_OFFSET -
    ceiling(
      MAGIC_NUMBER_OFFSET - currentTime + expirationInMs / UNIT_SIZE,
      bucketSizeMs / UNIT_SIZE
    )
  );
}

export function computeInteractiveExpiration(currentTime: ExpirationTime) {
  return computeExpirationBucket(
    currentTime,
    HIGH_PRIORITY_EXPIRATION,
    HIGH_PRIORITY_BATCH_SIZE
  );
}

export function computeAsyncExpiration(
  currentTime: ExpirationTime
): ExpirationTime {
  return computeExpirationBucket(
    currentTime,
    LOW_PRIORITY_EXPIRATION,
    LOW_PRIORITY_BATCH_SIZE
  );
}

export function computeExpirationForFiber(
  currentTime,
  mode = NoMode,
  priorityLevel = NormalPriority,
  suspenseConfig = null
) {
  if ((mode & BatchedMode) === NoMode) {
    return Sync;
  }

  if ((mode & ConcurrentMode) === NoMode) {
    return priorityLevel === ImmediatePriority ? Sync : Batched;
  }

  // if (workPhase === RenderPhase) {
  //   // Use whatever time we're already rendering
  //   return renderExpirationTime;
  // }

  let expirationTime;
  if (suspenseConfig !== null) {
    // Compute an expiration time based on the Suspense timeout.
    // expirationTime = computeSuspenseExpiration(
    //   currentTime,
    //   suspenseConfig.timeoutMs | 0 || LOW_PRIORITY_EXPIRATION
    // );
  } else {
    // Compute an expiration time based on the Scheduler priority.
    switch (priorityLevel) {
      case ImmediatePriority:
        expirationTime = Sync;
        break;
      case UserBlockingPriority:
        // TODO: Rename this to computeUserBlockingExpiration
        expirationTime = computeInteractiveExpiration(currentTime);
        break;
      case NormalPriority:
      case LowPriority: // TODO: Handle LowPriority
        // TODO: Rename this to... something better.
        expirationTime = computeAsyncExpiration(currentTime);
        break;
      case IdlePriority:
        expirationTime = Never;
        break;
      default:
        console.error("Expected a valid priority level");
    }
  }

  // If we're in the middle of rendering a tree, do not update at the same
  // expiration time that is already rendering.
  // if (workInProgressRoot !== null && expirationTime === renderExpirationTime) {
  //   // This is a trick to move this update into a separate batch
  //   expirationTime -= 1;
  // }

  return expirationTime;
}
