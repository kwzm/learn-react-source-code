import React from "react";
import Item from "./Item";
import "./List.css";

class List extends React.Component {
  state = {
    data: [1, 2, 3]
  };

  handleClick = () => {
    this.setState(state => {
      const newData = state.data.map(item => Math.pow(item, 2));

      return {
        data: newData
      };
    });
  };

  render() {
    const { data } = this.state;

    return (
      <div className="list">
        <button className="square" onClick={this.handleClick}>
          ^2
        </button>
        {data.map(value => (
          <Item key={value} data={value} />
        ))}
      </div>
    );
  }
}

export default List;
