import helmet from "./effects/helmet";

import Home from "./pages/Home";
import Blog from "./pages/Blog";
import FOF from "./pages/404";

const createRoute = (view, helmetData) => (state) =>
  helmetData ? [{ ...state, view }, helmet(helmetData)] : { ...state, view };

export default {
  "/": createRoute(Home, {
    title: "hartley mcguire",
    meta: [{ name: "description", content: "helmet testing :D" }],
  }),
  "/blog": createRoute(Blog, { title: "blog - hartley mcguire" }),
  "/404": createRoute(FOF, { title: "404 - hartley mcguire" }),
};
