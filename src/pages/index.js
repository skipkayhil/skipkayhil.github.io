import React from "react"
import { Link, graphql } from "gatsby"

import Layout from "../components/layout"
import SEO from "../components/seo"

class BlogIndex extends React.Component {
  render() {
    const { data } = this.props
    const siteTitle = data.site.siteMetadata.title

    return (
      <Layout location={this.props.location} title={siteTitle}>
        <SEO />

        <p>Full Stack developer and Computer Science major at Georgia Tech</p>

        <ul>
          <li>
            <Link to="/blog">blog</Link>
          </li>
          <li>
            <a href="/resume.pdf">resume</a>
          </li>
          <li>
            <a href="https://github.com/skipkayhil/dotfiles">dotfiles</a>
          </li>
          <li>
            <a href="https://github.com/skipkayhil">github</a>
          </li>
        </ul>

        <h2>education</h2>

        <p>
          I'm currently a Computer Science major at the Georgia Institute of
          Technology. My concentrations are{" "}
          <a href="https://www.cc.gatech.edu/content/information-internetworks">
            Information Internetworks
          </a>{" "}
          and <a href="https://www.cc.gatech.edu/content/media">Media</a>.
        </p>
      </Layout>
    )
  }
}

export default BlogIndex

export const pageQuery = graphql`
  query {
    site {
      siteMetadata {
        title
      }
    }
  }
`
