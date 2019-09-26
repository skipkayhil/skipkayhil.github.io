import React from "react"
import { Link } from "gatsby"

import "../style/index.css"

const HeaderLink = ({ path, to, children, ...props }) => (
  <Link
    style={{
      ...(path === to && { textDecoration: "none" }),
      color: "inherit",
    }}
    to={to}
    {...props}
  >
    {children}
  </Link>
)

class Layout extends React.Component {
  render() {
    const { title, children, smallHeader, breadcrumbs, location } = this.props
    const Heading = smallHeader ? "h3" : "h1"

    const crumbs = Object.entries(breadcrumbs || {}).map(([text, link]) => (
      <React.Fragment key={text}>
        {" / "}
        <HeaderLink to={link} path={location.pathname}>
          {text}
        </HeaderLink>
      </React.Fragment>
    ))

    const header = (
      <Heading>
        <HeaderLink to={`/`} path={location.pathname}>
          {title}
        </HeaderLink>
        {crumbs}
      </Heading>
    )

    return (
      <>
        <header>{header}</header>
        <main>{children}</main>
        <footer></footer>
      </>
    )
  }
}

export default Layout
