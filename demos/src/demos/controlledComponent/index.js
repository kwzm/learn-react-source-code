import React from "react";

class ControlledComponent extends React.Component {
  state = {
    value: "123"
  };

  handleChange = e => {
    this.setState({ value: e.target.value });
  };

  render() {
    return (
      <div>
        <input
          type="text"
          value={this.state.value}
          // onChange={this.handleChange}
        />
      </div>
    );
  }
}

export default ControlledComponent;
