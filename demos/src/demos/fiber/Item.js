import React from "react";

class Item extends React.Component {
  shouldComponentUpdate(nextProps) {
    return this.props.data !== nextProps.data;
  }

  render() {
    return <div className="item">{this.props.data}</div>;
  }
}

export default Item;
