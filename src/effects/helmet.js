const HELMET_ATTR = "data-ha-helmet";
const head = document.head;

const helmet = (_, props) => {
  const { title, meta } = props;

  // console.log(title);
  if (title) document.title = title;

  // TODO: figure out if react-helmet's strategy to skip removing nodes that
  //       you would immediately add back is faster vs not iterating as much?

  head.querySelectorAll(`[${HELMET_ATTR}]`).forEach((n) => head.removeChild(n));

  for (const tag of meta || []) {
    const newElement = document.createElement("meta");

    for (const attribute in tag) {
      newElement.setAttribute(attribute, tag[attribute]);
    }

    newElement.setAttribute(HELMET_ATTR, "true");

    head.appendChild(newElement);
  }
};

export default (props) => [helmet, props];
