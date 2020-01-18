import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import List from "./demos/fiber";
import ExpirationTime from "./demos/expirationTime";
import SetState from "./demos/setState";
import ControlledComponent from "./demos/controlledComponent";
import SyntheticEvent from "./demos/syntheticEvent";
import UseStateDemo from "./demos/hooks/UseStateDemo";
import UseEffectDemo from "./demos/hooks/UseEffectDemo";
import * as serviceWorker from "./serviceWorker";

// ReactDOM.render(<List />, document.getElementById("list-container"));
// ReactDOM.render(<ExpirationTime />, document.getElementById("root"));
// ReactDOM.render(<SetState />, document.getElementById("root"));
// ReactDOM.render(<ControlledComponent />, document.getElementById("root"));
// ReactDOM.render(<SyntheticEvent />, document.getElementById("root"));
// ReactDOM.render(<UseStateDemo />, document.getElementById("root"));
ReactDOM.render(<UseEffectDemo />, document.getElementById("root"));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
