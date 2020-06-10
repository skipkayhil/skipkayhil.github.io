import { h } from "hyperapp";
// TODO: get match from react-router

const getBestPath = (routes, href) => {
  let bestPath = null;
  let bestValue = -1;

  for (let path in routes) {
    const pathValue = href.pathname === path ? 1 : -1;

    if (pathValue > bestValue) {
      bestPath = path;
      bestValue = pathValue;
    }
  }

  return bestPath || "/404";
};

const routerFx = (dispatch, { routes }) => {
  const setRoute = (href) => {
    const bestPath = getBestPath(routes, href);

    const params = {};

    // console.log(routes[bestPath]);
    dispatch(routes[bestPath], { params });
  };

  const pop = (e) => setRoute(e.target.location);
  addEventListener("popstate", pop);

  const push = (e) => {
    setRoute(e.detail.href);
    history.pushState(null, "", e.detail.href);
    window.scroll({ top: 0, left: 0 });
  };
  addEventListener("pushstate", push);

  return () => {
    removeEventListener("popstate", pop);
    removeEventListener("pushstate", push);
  };
};

const navigateFx = (_, { href }) =>
  dispatchEvent(new CustomEvent("pushstate", { detail: { href } }));

const Navigate = (state, href) => [state, [navigateFx, { href }]];

export const Link = ({ to, ...props }, children) =>
  h(
    "a",
    {
      href: to,
      onclick: [
        Navigate,
        (e) => {
          e.preventDefault();
          return new URL(e.target.href);
        },
      ],
      ...props,
    },
    children
  );

const parseInit = (init) => (Array.isArray(init) ? init : [init]);

export const withRouter = (app) => ({ routes, init, ...props }) => {
  const initialPath = getBestPath(routes, window.location);
  const params = {};

  // const routeAction = [routes[initialPath], { params }];
  const routeActionFx = [
    (dispatch) => dispatch(routes[initialPath], { params }),
  ];
  // let newInit;
  // const [state, ...effects] = [].concat(init);
  // if (typeof route === "function") {
  //   newInit = effects ? [route(state), ...effects] : route(state);
  // } else {
  //   const [routeA, ...routeE] = route;
  //   newInit = [routeA(state), ...routeE, ...effects];
  // }

  // if (Array.isArray(init)) {
  //   newInit = init.concat(routeEffects);
  // } else {
  //   newInit = [init].concat(routeEffects);
  // }

  // const initArray = Array.isArray(init) ? init : [init];
  //

  // const viewFX = (setView) => [
  //   function viewEffect(dispatch) {
  //     dispatch(setView);
  //   },
  // ];

  const newInit = (state) => [
    ...parseInit(typeof init === "function" ? init(state) : init),
    routeActionFx,
  ];

  // if routeDispatch is nested array, then extract first element to dispatch
  // dispatch([SetView, { view }])
  // const routeInit =
  //   Array.isArray(routeDispatch) && Array.isArray(routeDispatch[0])
  //     ? [viewFX(routeDispatch[0]), ...routeDispatch.slice(1)]
  //     : [viewFX(routeDispatch)];

  // console.log("path: ", initialPath);
  // console.log("action fx: ", routeActionFx);
  // console.log("new init: ", newInit);

  return app({
    ...props,
    init: newInit, // initArray.concat(routeInit), //: [initialAction(state), ...effects],
    subscriptions: (state) => [
      ...(props.subscriptions ? props.subscriptions(state) : []),
      [routerFx, { routes }],
    ],
  });
};
