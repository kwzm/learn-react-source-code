import React from 'react'
import { flushSync } from 'react-dom'

import './index.css'

class ConcurrentModeDemo extends React.Component {
  state = {
    num: 1,
    length: 9999,
  }

  componentDidMount() {
    this.interval = setInterval(() => {
      this.updateNum()
    }, 200)
  }

  componentWillUnmount() {
    // 别忘了清除interval
    if (this.interval) {
      clearInterval(this.interval)
    }
  }

  updateNum() {
    const newNum = this.state.num === 3 ? 0 : this.state.num + 1

    this.setState({
      num: newNum,
    })
  }

  render() {
    const children = []

    const { length, num, async } = this.state

    for (let i = 0; i < length; i++) {
      children.push(
        <div className="item" key={i}>
          {num}
        </div>,
      )
    }

    return (
      <div className="main">
        <h1>ConcurrentMode demo</h1>
        <ul>
          <li>在普通模式下在输入框内输入内容会感觉卡顿</li>
          <li>在 ConcurrentMode 模式下会流程很多</li>
        </ul>
        <br/>
        <label htmlFor="">输入框：</label>
        <input type="text"/>
        <br/>
        <div className="wrapper">{children}</div>
      </div>
    )
  }
}

export default ConcurrentModeDemo
