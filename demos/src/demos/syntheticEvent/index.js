import React from "react";

class SyntheticEvent extends React.Component {
  handleClick = event => {
    console.log("handleClick", event.nativeEvent);
    // event.persist();
    setTimeout(() => {
      console.log("get event again", event.nativeEvent);
    }, 0);
  };

  handleClickCapture = () => {
    console.log("handleClickCapture");
  };

  render() {
    return (
      <div onClickCapture={this.handleClickCapture}>
        <h1>Synthetic event demo</h1>
        <hr />
        <button onClick={this.handleClick}>click</button>
      </div>
    );
  }
}

export default SyntheticEvent;
