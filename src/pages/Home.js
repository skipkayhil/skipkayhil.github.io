import Layout from "../components/Layout";
import { Link } from "../components/Router";

export default () => (
  <Layout>
    <header>
      <h1>
        <Link style={{ color: "inherit", textDecoration: "none" }}>
          hartley mcguire
        </Link>
      </h1>
    </header>
    <main>
      <p>
        Full Stack developer and Georgia Tech grad working full-time at Zuora
      </p>

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
        I graduated with a BS in Computer Science from the Georgia Institute of
        Technology in May 2020. My concentrations were{" "}
        <a href="https://www.cc.gatech.edu/content/information-internetworks">
          Information Internetworks
        </a>{" "}
        and <a href="https://www.cc.gatech.edu/content/media">Media</a>.
      </p>
    </main>
  </Layout>
);
