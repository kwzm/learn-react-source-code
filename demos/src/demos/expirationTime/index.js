import React from "react";
import {
  NoMode,
  BatchedMode,
  ConcurrentMode,
  UserBlockingPriority,
  requestCurrentTime,
  computeExpirationForFiber
} from "./expiration-time-test";

class ExpirationTime extends React.Component {
  render() {
    return (
      <div>
        <h1>Expiration time demo</h1>
        <hr />
        <p>currentTime: {requestCurrentTime()}</p>

        <h2>ReactDOM.render(NoMode)</h2>
        <p>
          expirationTime:{" "}
          {computeExpirationForFiber(requestCurrentTime(), NoMode)}
        </p>

        <h2>NormalPriority or LowPriority in ConcurrentMode and BatchedMode</h2>
        <p>
          <span>currentTime: 522 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(522, ConcurrentMode | BatchedMode)}
          </span>
        </p>
        <p>
          <span>currentTime: 523 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(523, ConcurrentMode | BatchedMode)}
          </span>
        </p>
        <p>
          <span>currentTime: 524 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(524, ConcurrentMode | BatchedMode)}
          </span>
        </p>
        <p>......</p>
        <p>
          <span>currentTime: 547 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(547, ConcurrentMode | BatchedMode)}
          </span>
        </p>

        <h2>UserBlockingPriority in ConcurrentMode and BatchedMode</h2>
        <p>
          <span>currentTime: 522 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(
              522,
              ConcurrentMode | BatchedMode,
              UserBlockingPriority
            )}
          </span>
        </p>
        <p>
          <span>currentTime: 523 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(
              523,
              ConcurrentMode | BatchedMode,
              UserBlockingPriority
            )}
          </span>
        </p>
        <p>
          <span>currentTime: 524 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(
              524,
              ConcurrentMode | BatchedMode,
              UserBlockingPriority
            )}
          </span>
        </p>
        <p>......</p>
        <p>
          <span>currentTime: 532 </span>
          <span>
            expirationTime:{" "}
            {computeExpirationForFiber(
              532,
              ConcurrentMode | BatchedMode,
              UserBlockingPriority
            )}
          </span>
        </p>
      </div>
    );
  }
}

export default ExpirationTime;
