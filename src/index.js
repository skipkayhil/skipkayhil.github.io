import { h, app } from '../lib/hyperapp.min.js';

console.log("test");

const view = () => (
    h("div", {}, "under construction...")
);

app({}, {}, view, document.body);
