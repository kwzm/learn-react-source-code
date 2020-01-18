import React, { useState, useEffect } from "react";

let timer;

function UseEffectDemo() {
  const [time, setTime] = useState(Date());

  useEffect(() => {
    timer = setTimeout(() => {
      setTime(Date());
    }, 1000);

    return () => {
      clearTimeout(timer);
    };
  }, [time]);

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div>
      <h1>useEffect demo</h1>
      <hr />
      <div>Time: {time}</div>
      <button onClick={handleReload}>reload</button>
    </div>
  );
}

export default UseEffectDemo;
