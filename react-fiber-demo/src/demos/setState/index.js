import React from "react";

class SetState extends React.Component {
  state = {
    count: 0
  };

  // 无法实现一次加 3，只能加 2
  handleAdd = () => {
    this.setState({ count: this.state.count + 1 });
    console.log("count: ", this.state.count);
    this.setState({ count: this.state.count + 2 });
    console.log("count: ", this.state.count);
  };

  // 实现一次加 3 的方法一：传递回调函数
  // handleAdd = () => {
  //   this.setState(prevState => ({ count: prevState.count + 1 }));
  //   console.log("count: ", this.state.count);
  //   this.setState(prevState => ({ count: prevState.count + 2 }));
  //   console.log("count: ", this.state.count);
  // };

  // 实现一次加 3 的方法二：setTimeout
  // handleAdd = () => {
  //   setTimeout(() => {
  //     this.setState({ count: this.state.count + 1 });
  //     console.log("count: ", this.state.count);
  //     this.setState({ count: this.state.count + 2 });
  //     console.log("count: ", this.state.count);
  //   }, 0);
  // };

  render() {
    return (
      <div>
        <h1>setState demo</h1>
        <hr />
        <button onClick={this.handleAdd}>add</button>
        <p>count: {this.state.count}</p>
      </div>
    );
  }
}

export default SetState;
