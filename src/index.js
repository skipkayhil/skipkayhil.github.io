import { app } from "hyperapp";
import { withRouter } from "./components/Router";

// Global styling
import "./global.css";

// App init imports
import routes from "./routes";

const appWithRouter = withRouter(app);

appWithRouter({
  init: {},
  view: (state) => state.view(state),
  // middleware: dispatch => (...args) => {
  //   console.log('dispatch: ', args);
  //   return dispatch(...args)
  // },
  routes,
  node: document.getElementById("app"),
});
