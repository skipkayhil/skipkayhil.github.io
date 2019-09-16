import { h, app } from "../lib/hyperapp.min.js";

console.log("test");

const view = () =>
  h("div", { class: "header" }, [
    h("h1", {}, "Hartley McGuire"),
    h("p", {}, "Computer Science Major | Georgia Institute of Technology"),
    h("button", {}, "Projects")
  ]);

app({}, {}, view, document.body);
