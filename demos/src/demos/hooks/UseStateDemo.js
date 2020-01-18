import React, { useState } from "react";

function UseStateDemo() {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    setCount(count => count + 1);
    setCount(count => count + 1);
  };

  return (
    <div>
      <button onClick={handleClick}>add 1</button>
      <div>count: {count}</div>
    </div>
  );
}

export default UseStateDemo;
