import Layout from "../components/Layout";
import { Link } from "../components/Router";

export default () => (
  <Layout>
    <header>
      <h1>
        <Link to="/" style={{ color: "inherit" }}>
          hm
        </Link>
        {" / "}
        <Link to="/blog" style={{ color: "inherit", textDecoration: "none" }}>
          blog
        </Link>
      </h1>
    </header>
    <main>Coming soon...</main>
  </Layout>
);
