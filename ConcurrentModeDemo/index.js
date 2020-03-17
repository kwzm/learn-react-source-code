import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

// 如果你之前的代码是：
//
ReactDOM.render(<App />, document.getElementById('root'));
//
// 你可以用下面的代码引入 concurrent 模式：

// ReactDOM.createRoot(
//   document.getElementById('root')
// ).render(<App />);
